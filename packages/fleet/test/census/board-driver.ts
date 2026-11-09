import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productRoot } from './census-report.js';
import { startSession, type Session, type SessionEnd } from './census-session.js';
import type { Sandbox } from './sandbox.js';

/** The page's stream, held by a client that follows the page's protocol: one `GET /api/events`. */
export type SseClient = { detach: () => Promise<void> };

export type BoardRun = {
  session: Session;
  /** The board server's pid, as the host reported it. */
  pid: number;
  port: number;
  /** Starts the mark image `label` in the traced tree and waits until it ran. */
  mark: (label: string) => Promise<void>;
  /** One `GET /api/board`, as a page's first read. */
  read: () => Promise<number>;
  /** Opens the page's event stream; `detach` closes it, as a hidden page does. */
  attach: () => Promise<SseClient>;
  /**
   * Waits until the board has had no descendant process for `quietMs`, polled
   * from this untraced process, or until `timeoutMs` has passed. Returns true
   * when the board went quiet, false on the timeout.
   */
  quiet: (quietMs: number, timeoutMs: number) => Promise<boolean>;
  /** Stops the board's group and the host, and returns the session's end. */
  stop: () => Promise<SessionEnd>;
};

/** The object reader's process, which lives as long as the board and never counts as activity. */
const OBJECT_READER = /\bgit cat-file --batch-command\b/;

/** The pids `ps` lists below `root` now, found by parent pid; the object reader is left out. */
export const descendantsOf = (root: number, listing: string): number[] => {
  const children = new Map<number, number[]>();
  for (const line of listing.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
    if (m === null || OBJECT_READER.test(m[3] ?? '')) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift() ?? -1) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

const POLL_MS = 100;

const listProcesses = (): string =>
  spawnSync('ps', ['-A', '-o', 'pid=,ppid=,args='], { encoding: 'utf8' }).stdout ?? '';

const waitQuiet = async (root: number, quietMs: number, timeoutMs: number): Promise<boolean> => {
  const until = Date.now() + timeoutMs;
  let quietSince: number | null = null;
  while (Date.now() < until) {
    const now = Date.now();
    if (descendantsOf(root, listProcesses()).length > 0) quietSince = null;
    else if (quietSince === null) quietSince = now;
    else if (now - quietSince >= quietMs) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
};

const HOST = fileURLToPath(new URL('./board-host.mjs', import.meta.url));

/** The built board the census runs: the product's shipped `board-server.mjs`. */
export const boardArtifact = (product: string = productRoot()): string =>
  join(product, 'skills/plot/scripts/board/board-server.mjs');

/**
 * Starts the product's board server in `box` under `board-host.mjs`,
 * optionally under `strace -f`, and waits until it listens.
 */
export const startBoard = async (box: Sandbox, options: { trace: boolean }): Promise<BoardRun> => {
  const session = startSession({
    command: process.execPath,
    args: [HOST, boardArtifact()],
    cwd: box.repo,
    env: box.env,
    trace: options.trace,
  });
  const ready = await session.waitFor(/^census: board \d+ \d+$/, 60_000);
  const [, pid, port] = /^census: board (\d+) (\d+)$/.exec(ready) ?? [];
  const base = `http://127.0.0.1:${port}`;
  return {
    session,
    pid: Number(pid),
    port: Number(port),
    mark: async (label) => {
      session.send(`mark ${label}`);
      await session.waitFor(new RegExp(`^census: marked ${label}$`), 30_000);
    },
    read: async () => {
      const res = await fetch(`${base}/api/board`);
      await res.arrayBuffer();
      return res.status;
    },
    attach: async () => {
      const abort = new AbortController();
      const res = await fetch(`${base}/api/events`, { signal: abort.signal });
      const reader = res.body?.getReader();
      const draining = (async () => {
        try {
          for (;;) if ((await reader?.read())?.done ?? true) return;
        } catch {
          // aborted
        }
      })();
      return {
        detach: async () => {
          abort.abort();
          await draining;
        },
      };
    },
    quiet: (quietMs, timeoutMs) => waitQuiet(Number(pid), quietMs, timeoutMs),
    stop: async () => {
      session.send('stop');
      return session.end(60_000);
    },
  };
};

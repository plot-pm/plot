import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeTree } from '../rm-tree.mjs';
import { parseStraceExecs, type ExecRecord, type StraceCensus } from './strace-execs.js';
import { requireStrace, STRACE_ARGS } from './strace-run.js';

/** The first argument every mark image carries; `fleetd-census-entry.ts` and `board-host.mjs` start it. */
export const MARK_ARG = 'census-mark';

export type SessionOptions = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Runs the command under `strace -f` and returns the census at the end. */
  trace: boolean;
};

export type SessionEnd = {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The census of the whole run; `null` for an untraced session. */
  census: StraceCensus | null;
  stdout: string;
  stderr: string;
};

export type Session = {
  /** The pid of the process started: `strace` for a traced session. */
  pid: number;
  /** Writes one line to the command's stdin. */
  send: (line: string) => void;
  /** Resolves with the first stdout line from now on, or already seen, that matches. */
  waitFor: (pattern: RegExp, timeoutMs?: number) => Promise<string>;
  /** Closes stdin, waits for the exit, and returns the census; kills the group after `timeoutMs`. */
  end: (timeoutMs?: number) => Promise<SessionEnd>;
};

/**
 * Starts a long-running command, optionally under `strace -f`, with piped
 * stdio. `strace` passes stdin and stdout through to the traced command. The
 * `strace` log lives in a `mkdtempSync` directory removed by its exact name
 * when the session ends.
 *
 * @param options - the command, its environment, and whether to trace it.
 * @returns the running session.
 */
export const startSession = ({ command, args, cwd, env, trace }: SessionOptions): Session => {
  const dir = trace ? mkdtempSync(join(tmpdir(), 'plot-census-log-')) : null;
  const log = dir === null ? null : join(dir, 'strace.log');
  const [file, argv] =
    log === null
      ? [command, [...args]]
      : [requireStrace(env['PATH'] ?? ''), [...STRACE_ARGS, '-o', log, '--', command, ...args]];
  const child: ChildProcess = spawn(file, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  if (child.pid === undefined) throw new Error(`process census: ${command} did not start`);
  const pid = child.pid;
  let stdout = '';
  let stderr = '';
  const lines: string[] = [];
  const waiters: { pattern: RegExp; resolve: (l: string) => void }[] = [];
  let pending = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    pending += text;
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) {
      lines.push(line);
      for (const w of [...waiters]) {
        if (w.pattern.test(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );
  const killGroup = (): void => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  };

  const waitFor = (pattern: RegExp, timeoutMs = 120_000): Promise<string> => {
    const seen = lines.find((l) => pattern.test(l));
    if (seen !== undefined) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`process census: no line matching ${pattern} within ${timeoutMs} ms\nstderr: ${stderr.slice(-4000)}`));
      }, timeoutMs);
      const waiter = {
        pattern,
        resolve: (l: string) => {
          clearTimeout(timer);
          resolve(l);
        },
      };
      waiters.push(waiter);
      void exited.then(() => {
        if (!waiters.includes(waiter)) return;
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(timer);
        reject(new Error(`process census: ${command} exited before a line matched ${pattern}\nstderr: ${stderr.slice(-4000)}`));
      });
    });
  };

  const end = async (timeoutMs = 60_000): Promise<SessionEnd> => {
    child.stdin?.end();
    const timer = setTimeout(killGroup, timeoutMs);
    const { code, signal } = await exited;
    clearTimeout(timer);
    try {
      const census = log === null ? null : parseStraceExecs(readFileSync(log, 'utf8'));
      return { code, signal, census, stdout, stderr };
    } finally {
      if (dir !== null) removeTree(dir);
    }
  };

  return {
    pid,
    send: (line) => {
      child.stdin?.write(`${line}\n`);
    },
    waitFor,
    end,
  };
};

export const isMark = (exec: Pick<ExecRecord, 'argv'>): boolean => exec.argv[1] === MARK_ARG;

/**
 * Returns the images started after the mark `from` (or from the start, for
 * `null`) and before the mark `to`, with every mark image left out. Throws
 * when a named mark is not in the census, so a window that was never
 * delimited cannot read as an empty one.
 *
 * @param execs - the census, in log order.
 * @param from - the opening mark's label, or `null`.
 * @param to - the closing mark's label.
 */
export const between = (execs: readonly ExecRecord[], from: string | null, to: string): ExecRecord[] => {
  const at = (label: string): number => {
    const i = execs.findIndex((e) => isMark(e) && e.argv[2] === label);
    if (i < 0) throw new Error(`process census: no mark ${label} in the census`);
    return i;
  };
  const start = from === null ? 0 : at(from) + 1;
  return execs.slice(start, at(to)).filter((e) => !isMark(e));
};

/**
 * Returns every image the process `root` or a descendant of it started, the
 * root's own image included. Reads the fork tree from both the images and the
 * forks that never exec'd, so a subshell between two images keeps the chain.
 */
export const treeOf = (census: StraceCensus, execs: readonly ExecRecord[], root: number): ExecRecord[] => {
  const parent = new Map<number, number | null>();
  for (const f of census.forksWithoutExec) parent.set(f.pid, f.ppid);
  for (const e of census.execs) if (!parent.has(e.pid) || e.ppid !== null) parent.set(e.pid, e.ppid);
  const inTree = (pid: number): boolean => {
    for (let p: number | null | undefined = pid, hops = 0; p != null && hops < 10_000; p = parent.get(p), hops += 1) {
      if (p === root) return true;
    }
    return false;
  };
  return execs.filter((e) => inTree(e.pid));
};

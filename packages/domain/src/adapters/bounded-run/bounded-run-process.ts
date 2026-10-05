import { openSync, closeSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { BoundedRun, BoundedRunOptions, BoundedRunResult } from '../../ports/bounded-run.js';
import type { Processes } from '../../ports/processes.js';

/**
 * Signals a pid and every descendant the process table reports, descendants
 * read FIRST.
 *
 * Matches `_kill_tree` (`plot-worker-loop.sh:2054`) exactly, and for the same
 * reason: killing the root before reading its children loses the window
 * between the read and the kill, and reading after loses the children outright
 * — once the root is gone they reparent to pid 1 and a read taken then finds
 * none of them. So the snapshot is taken first, the root dies, and the
 * snapshot is walked (recursively — a grandchild the root's child spawned is
 * in the snapshot of ITS children, not the root's).
 *
 * @param processes - where to read descendants from.
 * @param pid - the root to end.
 */
const killTree = async (processes: Processes, pid: number): Promise<void> => {
  const kids = await processes.childrenOf(pid);
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  if (kids.ok) {
    for (const kid of kids.value) {
      await killTree(processes, kid);
    }
  }
};

/**
 * The SAME WALK as {@link killTree}, synchronous — because Node's `'exit'`
 * event cannot await anything. The event loop stops the instant every
 * `'exit'` listener returns, so a handler that scheduled `killTree`'s async
 * read would leave it never run at all; measured directly, a caller that
 * called `process.exit()` after starting a bounded run left the prompt
 * running with nothing to reap it.
 *
 * `pgrep -P`, matching the port's own adapter (`processes-shell.ts`), called
 * through `execFileSync` rather than the `Processes` port: there is no
 * synchronous member on that port for this reading, and inventing one just
 * for an exit handler would put a sync requirement on a port every other
 * caller uses asynchronously.
 *
 * @param pid - the root to end.
 */
const killTreeSync = (pid: number): void => {
  let kids: readonly number[] = [];
  try {
    kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    /* no children, or pgrep found none — either way, none to walk */
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  for (const kid of kids) killTreeSync(kid);
};

/**
 * Runs a bounded child process, backed by `node:child_process` and the real
 * process table.
 *
 * **NEVER `detached`.** The child inherits this process's own process group,
 * which is what lets an external `kill -TERM -<pgid>` reach it — see the
 * port's own doc comment for the incident this refuses to repeat.
 *
 * @param processes - where to read a pid's descendants from, for the kill this
 *   adapter performs on its own bound.
 * @returns a `BoundedRun` backed by a real child process.
 */
export const boundedRunProcess = (processes: Processes): BoundedRun => ({
  run: (command, args, options: BoundedRunOptions): Promise<PortResult<BoundedRunResult>> =>
    new Promise((resolve) => {
      let out: number;
      try {
        out = openSync(options.outFile, 'a');
      } catch {
        resolve(failed<BoundedRunResult>());
        return;
      }

      const startedAt = Date.now();
      // NO `detached`. The child stays in THIS process's group, which is the
      // whole contract — see the port's doc comment.
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: ['ignore', out, out],
      });

      let settled = false;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;

      const onCallerExit = (): void => {
        // SYNC, DELIBERATELY. `process.once('exit', ...)` cannot await
        // anything — see {@link killTreeSync}'s own doc comment.
        if (child.pid !== undefined) killTreeSync(child.pid);
      };
      process.once('exit', onCallerExit);

      const finish = (status: number | null): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        process.removeListener('exit', onCallerExit);
        try {
          closeSync(out);
        } catch {
          /* already closed */
        }
        resolve(
          answered<BoundedRunResult>({
            status,
            timedOut,
            ranSeconds: Math.round((Date.now() - startedAt) / 1000),
          }),
        );
      };

      child.on('error', () => finish(1));
      child.on('close', (code) => finish(code));

      if (options.boundSeconds > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          if (child.pid !== undefined) void killTree(processes, child.pid);
        }, options.boundSeconds * 1000);
      }
    }),
});

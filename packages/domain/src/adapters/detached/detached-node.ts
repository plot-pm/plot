import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import type { Detached } from '../../ports/detached.js';

/**
 * The real {@link Detached}, backed by `child_process.spawn` with `detached: true`.
 *
 * @returns the {@link Detached} port.
 */
export const detachedNode = (): Detached => ({
  node: (script, args, cwd, logFile) => {
    const out = openSync(logFile, 'w');
    let code: number | null = null;
    const child = spawn(process.execPath, [script, ...args], { cwd, detached: true, stdio: ['ignore', out, out] });
    closeSync(out);
    child.on('exit', (c) => {
      code = c ?? 1;
    });
    child.unref();
    return { pid: child.pid ?? 0, exitCode: () => code };
  },
});

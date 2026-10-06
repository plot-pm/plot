import { unaskable, failed } from '../../port-result.js';
import type { Reexec } from '../../ports/reexec.js';

/** The slice of `process` this adapter needs — narrowed so a test can fake it without a real process. */
export interface ExecveHost {
  execve?(execPath: string, args: readonly string[], env: NodeJS.ProcessEnv): never;
}

/**
 * The real {@link Reexec}, backed by `process.execve`.
 *
 * `unaskable` where the given process carries no `execve` — a Node before
 * 22.15 — never `failed`: the platform cannot be asked, it was not asked and
 * broke. A `failed` result is reserved for a Node that HAS the primitive but
 * whose call threw, which `execve` does synchronously rather than through a
 * rejected promise.
 *
 * @param host - the process to call `execve` on; defaults to the real one.
 * @returns the {@link Reexec} port.
 */
export const processExec = (host: ExecveHost = process): Reexec => ({
  replace: async (command, args, env) => {
    if (typeof host.execve !== 'function') return unaskable<never>();
    try {
      host.execve(command, args, env);
    } catch {
      return failed<never>();
    }
    /* v8 ignore next -- execve replaces the process image and never returns on success */
    return failed<never>();
  },
});

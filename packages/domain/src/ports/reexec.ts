import type { PortResult } from '../port-result.js';

/** Replaces the calling process's image under the same pid. */
export interface Reexec {
  /**
   * Replaces the current process image with a new run of the given command.
   *
   * Returns only when the replacement did not start; on success the calling
   * code does not run again.
   *
   * @param command - the executable path to run in the new image.
   * @param args - the new image's whole argument vector, the program name first, as `execve` takes it.
   * @param env - the environment the new image starts with.
   * @returns `unaskable` where this Node has no `process.execve`; `failed` where
   *   the call threw.
   */
  replace(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<PortResult<never>>;
}

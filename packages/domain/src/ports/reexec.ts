import type { PortResult } from '../port-result.js';

/**
 * Replaces the calling process's own image — the one restart mechanism that
 * keeps the process's pid.
 *
 * EXACTLY ONE CALLER: the worker-loop entry, after its own self-check of the
 * candidate bundle has passed. `spawn` plus `exit` gives the loop a new pid,
 * which breaks the dispatch wrapper's `wait` and the manifest's recorded
 * `pid` — `process.execve` is the only primitive that replaces the image
 * without replacing the pid, and nothing here wraps it in a spawn fallback.
 */
export interface Reexec {
  /**
   * Replaces the current process image with a new run of the given command.
   *
   * Never returns on success: the calling process ceases to exist as the code
   * that called it, and a new image starts in its place under the same pid.
   * It can only return by failing to start the replacement.
   *
   * `unaskable`, NEVER `failed`, where `process.execve` does not exist on this
   * Node — the primitive is experimental from Node 22.15, and a Node lacking
   * it cannot be asked at all rather than having been asked and broken.
   *
   * @param command - the executable path to run in the new image.
   * @param args - the new image's whole argument vector, the program name first, as `execve` takes it.
   * @param env - the environment the new image starts with.
   * @returns a `failed` result where the platform has `process.execve` but it
   *   refused to start the replacement; never returns at all on success.
   */
  replace(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<PortResult<never>>;
}

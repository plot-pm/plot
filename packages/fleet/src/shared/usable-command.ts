/**
 * A configured command that can be run, or `''` when the project declared none.
 *
 * `none` is the DELIBERATE absence a project writes for a role it does not run
 * (`Worker command: none`, `Implementation home: none`). It is distinct from a
 * missing key and it must never be run — a bare emptiness check would spawn
 * `none: command not found` and log that as the reason a plan does not exist.
 *
 * @param configured - the value read from `## Plot Config`.
 * @returns the trimmed command, or `''` for an absent or `none` value.
 */
export const usableCommand = (configured: string): string => {
  const cmd = (configured || '').trim();
  return cmd === 'none' || cmd === 'NONE' || cmd === 'None' ? '' : cmd;
};

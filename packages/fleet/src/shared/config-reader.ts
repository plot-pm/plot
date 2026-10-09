import { scriptsShell } from '@plot-pm/domain/adapters';

/** Where a `## Plot Config` key is read from — the adopting project. */
export interface ConfigReadOptions {
  repoRoot: string;
  scriptsDir: string;
}

/**
 * Reads one `## Plot Config` key, synchronously.
 *
 * Absent is not false: a missing key, or a read that fails, answers
 * `fallback` rather than an empty string a caller might read as a decision.
 *
 * @param opts - the repository and the scripts directory to read through.
 * @param key - the config key.
 * @param fallback - what to answer when the key is absent or unreadable.
 * @returns the trimmed value, or `fallback`.
 */
export const readConfig = (opts: ConfigReadOptions, key: string, fallback: string): string => {
  const answer = scriptsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }).configSync(
    key,
    fallback,
  );
  return answer.ok ? answer.value.trim() || fallback : fallback;
};

/**
 * The same lookup, awaited — so a caller on an event loop does not block it.
 *
 * @param opts - the repository and the scripts directory to read through.
 * @param key - the config key.
 * @param fallback - what to answer when the key is absent or unreadable.
 * @returns the trimmed value, or `fallback`.
 */
export const readConfigAsync = async (
  opts: ConfigReadOptions,
  key: string,
  fallback: string,
): Promise<string> => {
  const answer = await scriptsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }).config(
    key,
    fallback,
  );
  return answer.ok ? answer.value.trim() || fallback : fallback;
};

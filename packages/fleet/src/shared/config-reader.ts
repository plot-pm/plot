import { scriptsShell, scriptsConfigCached } from '@plot-pm/domain/adapters';
import type { Scripts } from '@plot-pm/domain';

/** Where a `## Plot Config` key is read from -- the adopting project. */
export interface ConfigReadOptions {
  repoRoot: string;
  scriptsDir: string;
}

/**
 * One cached `Scripts` per (repoRoot, scriptsDir), so every caller that reads
 * through this module -- regardless of how many times it builds its own
 * options object -- shares one held-answers cache rather than each call
 * starting a cache of its own.
 */
const cachedByRoot = new Map<string, Scripts>();

const scriptsFor = (opts: ConfigReadOptions): Scripts => {
  const mapKey = `${opts.repoRoot}\u0000${opts.scriptsDir}`;
  const existing = cachedByRoot.get(mapKey);
  if (existing) return existing;
  const built = scriptsConfigCached(
    scriptsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    opts.repoRoot,
  );
  cachedByRoot.set(mapKey, built);
  return built;
};

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
  const answer = scriptsFor(opts).configSync(key, fallback);
  return answer.ok ? answer.value.trim() || fallback : fallback;
};

/**
 * The same lookup, awaited -- so a caller on an event loop does not block it.
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
  const answer = await scriptsFor(opts).config(key, fallback);
  return answer.ok ? answer.value.trim() || fallback : fallback;
};

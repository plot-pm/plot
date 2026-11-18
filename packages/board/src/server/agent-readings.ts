import path from 'node:path';
import { lastRunIndex, type LastRunIndex } from '@plot-pm/domain';
import { readConfigAsync, spendRecordFor, type BuildBoardOptions } from './board.js';
import { fileStatKey, statCache, type StatCache } from './stat-cache.js';

/**
 * `Worker bound` in seconds, or `null` where the key is absent or not a
 * positive whole number of seconds.
 *
 * @param value - the key's text.
 */
export const workerBoundOf = (value: string): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * `Worker bound`, read once and again only where one stat of the config files
 * shows a change.
 *
 * `plot-config.sh` reads `CLAUDE.md` first and `AGENTS.md` second, so the key
 * is the pair of their stats. The read is an uncached config subprocess
 * (0.12 to 0.94 s measured), and `/api/fleet` polls every 4 s per viewer.
 *
 * @param statKey - one stat of the declaring files.
 * @param read - reads the key's text.
 * @returns the cache.
 */
export const workerBoundCache = (
  statKey: () => Promise<string | null>,
  read: () => Promise<string>,
): StatCache<number | null> =>
  statCache(statKey, async () => ({ ok: true, value: workerBoundOf(await read()) }));

/**
 * The record's last finished run per branch and role, parsed once and again
 * only where one stat of the record shows a new size or modification time.
 *
 * @param statKey - one stat of the record.
 * @param lines - the record's lines; `ok: false` where the read failed.
 * @returns the cache; its value is `null` where the read failed.
 */
export const lastRunCache = (
  statKey: () => Promise<string | null>,
  lines: () => Promise<{ ok: true; value: readonly string[] } | { ok: false }>,
): StatCache<LastRunIndex | null> =>
  statCache(statKey, async () => {
    const read = await lines();
    return read.ok ? { ok: true, value: lastRunIndex(read.value) } : { ok: false, value: null };
  });

const workerBounds = new Map<string, StatCache<number | null>>();
const lastRuns = new Map<string, StatCache<LastRunIndex | null>>();

/** `Worker bound` for this board's repository, from the process-wide cache. */
export const workerBoundFor = (opts: BuildBoardOptions): Promise<number | null> => {
  let cache = workerBounds.get(opts.repoRoot);
  if (cache === undefined) {
    const files = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(opts.repoRoot, f));
    cache = workerBoundCache(
      async () => {
        const keys = await Promise.all(files.map(fileStatKey));
        return keys.includes(null) ? null : keys.join('|');
      },
      () => readConfigAsync(opts, 'Worker bound', ''),
    );
    workerBounds.set(opts.repoRoot, cache);
  }
  return cache.get();
};

/** The last finished run of every branch for this board, from the process-wide cache; `null` where the record could not be read. */
export const lastRunsFor = (opts: BuildBoardOptions): Promise<LastRunIndex | null> => {
  if (opts.spendRecord !== undefined) {
    // A held fixture has no file to stat: one parse per call.
    return lastRunCache(async () => null, () => opts.spendRecord!.lines()).get();
  }
  let cache = lastRuns.get(opts.repoRoot);
  if (cache === undefined) {
    const record = spendRecordFor(opts);
    cache = lastRunCache(
      async () => {
        const where = record.location();
        return where.ok ? fileStatKey(where.value) : null;
      },
      () => record.lines(),
    );
    lastRuns.set(opts.repoRoot, cache);
  }
  return cache.get();
};

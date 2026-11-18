import path from 'node:path';
import { finishedRuns, lastRunIndexOf, type DayBounds, type FinishedRun, type LastRunIndex } from '@plot-pm/domain';
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

/** One parse of the spend record: every finished run, and the last of each branch and role. */
export interface SpendParse {
  readonly runs: readonly FinishedRun[];
  readonly index: LastRunIndex;
}

/**
 * The local day `now` falls in, as the instants it spans.
 *
 * @param now - the instant, in epoch milliseconds.
 */
export const localDayBounds = (now: number): DayBounds => {
  const d = new Date(now);
  return { startMs: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), endMs: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
};

/** The local day `now` falls in as the tooltip names it, `2026-11-18`. */
export const localDayLabel = (now: number): string => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * The record's finished runs, and the last run per branch and role, parsed once and again
 * only where one stat of the record shows a new size or modification time.
 *
 * @param statKey - one stat of the record.
 * @param lines - the record's lines; `ok: false` where the read failed.
 * @returns the cache; its value is `null` where the read failed.
 */
export const spendCache = (
  statKey: () => Promise<string | null>,
  lines: () => Promise<{ ok: true; value: readonly string[] } | { ok: false }>,
): StatCache<SpendParse | null> =>
  statCache(statKey, async () => {
    const read = await lines();
    if (!read.ok) return { ok: false, value: null };
    const runs = finishedRuns(read.value);
    return { ok: true, value: { runs, index: lastRunIndexOf(runs) } };
  });

const workerBounds = new Map<string, StatCache<number | null>>();
const spends = new Map<string, StatCache<SpendParse | null>>();

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

/** The spend record's one parse for this board, from the process-wide cache; `null` where the record could not be read. */
export const spendFor = (opts: BuildBoardOptions): Promise<SpendParse | null> => {
  if (opts.spendRecord !== undefined) {
    // A held fixture has no file to stat: one parse per call.
    return spendCache(async () => null, () => opts.spendRecord!.lines()).get();
  }
  let cache = spends.get(opts.repoRoot);
  if (cache === undefined) {
    const record = spendRecordFor(opts);
    cache = spendCache(
      async () => {
        const where = record.location();
        return where.ok ? fileStatKey(where.value) : null;
      },
      () => record.lines(),
    );
    spends.set(opts.repoRoot, cache);
  }
  return cache.get();
};

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExecRecord } from './strace-execs.js';

// The census report: what a census row records, and what the merge-base
// comparison reads. No relative runtime import, so `census-gate.mjs` loads this
// file under Node's own type stripping.

/** Names the JSON Lines file a census row appends its entry to. Unset: rows record nothing. */
export const CENSUS_REPORT_ENV = 'PLOT_CENSUS_REPORT';

/** Names the repository root whose shipped scripts and built bundles a row runs. */
export const CENSUS_PRODUCT_ENV = 'PLOT_CENSUS_PRODUCT';

export type CensusHost = 'github' | 'bitbucket';

/** The fixture size a count belongs to. */
export type CensusFixture = { desks: number; openPrs: number; host: CensusHost };

/**
 * How far a count may grow past the merge base. `'strict'` allows no growth
 * over a merge-base count of 0, and `NOISE_TOLERANCE` over any other; it is the
 * only tolerance a structural zero takes.
 */
export type CensusTolerance = { ratio: number; plus: number } | 'strict';

/** One recorded count. `commands` maps a command key to its `execve` count. */
export type CensusEntry = {
  id: string;
  fixture: CensusFixture;
  count: number;
  unit: string;
  tolerance: CensusTolerance;
  commands: Record<string, number>;
};

export type CensusRecord = Omit<CensusEntry, 'tolerance' | 'commands'> & {
  tolerance?: CensusTolerance;
  /** The traced images the count was taken over; they give the per-command figures. */
  execs?: readonly ExecRecord[];
};

/**
 * Returns the key that groups an image for the "commands that grew" listing:
 * the image's basename, plus its first argument's basename when that argument
 * is not an option. `git rev-parse`, `bash plot-host.sh`, `sleep`. A path is
 * reduced to its basename so two worktrees give one key.
 */
export const commandKey = (exec: Pick<ExecRecord, 'path' | 'argv'>): string => {
  const first = exec.argv[1];
  const image = basename(exec.path);
  return first === undefined || first === '' || first.startsWith('-') ? image : `${image} ${basename(first)}`;
};

/** Counts `execs` by `commandKey`. */
export const commandCounts = (execs: readonly Pick<ExecRecord, 'path' | 'argv'>[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const exec of execs) {
    const key = commandKey(exec);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

/**
 * Appends one entry to the file `PLOT_CENSUS_REPORT` names, and returns its
 * path. Returns `null` and writes nothing when the variable is unset. A
 * missing `tolerance` is `'strict'`.
 */
export const recordCensus = (record: CensusRecord, env: NodeJS.ProcessEnv = process.env): string | null => {
  const path = env[CENSUS_REPORT_ENV];
  if (path === undefined || path === '') return null;
  const entry: CensusEntry = {
    id: record.id,
    fixture: record.fixture,
    count: record.count,
    unit: record.unit,
    tolerance: record.tolerance ?? 'strict',
    commands: commandCounts(record.execs ?? []),
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  return path;
};

/**
 * Returns the repository root a census row runs the product from: the
 * `PLOT_CENSUS_PRODUCT` value, or this checkout's root when it is unset.
 */
export const productRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const set = env[CENSUS_PRODUCT_ENV];
  return set !== undefined && set !== '' ? resolve(set) : resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
};

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isTolerance = (v: unknown): v is CensusTolerance =>
  v === 'strict' ||
  (typeof v === 'object' && v !== null && isCount((v as { ratio?: unknown }).ratio) && isCount((v as { plus?: unknown }).plus));

const isEntry = (v: unknown): v is CensusEntry => {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  const f = e['fixture'] as Record<string, unknown> | undefined;
  return (
    typeof e['id'] === 'string' &&
    typeof f === 'object' &&
    f !== null &&
    isCount(f['desks']) &&
    isCount(f['openPrs']) &&
    (f['host'] === 'github' || f['host'] === 'bitbucket') &&
    isCount(e['count']) &&
    typeof e['unit'] === 'string' &&
    isTolerance(e['tolerance']) &&
    typeof e['commands'] === 'object' &&
    e['commands'] !== null &&
    Object.values(e['commands']).every(isCount)
  );
};

/**
 * Reads a census report. A missing file reads as no entries. Throws, naming
 * the file and line, on a line that is not a census entry.
 */
export const readCensusReport = (path: string): CensusEntry[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`${path}:${i + 1}: not JSON`);
      }
      if (!isEntry(parsed)) throw new Error(`${path}:${i + 1}: not a census entry`);
      return [parsed];
    });
};

/** The comparison key: one scenario on one fixture. */
export const entryKey = ({ id, fixture }: Pick<CensusEntry, 'id' | 'fixture'>): string =>
  `${id} ${fixture.host} desks=${fixture.desks} prs=${fixture.openPrs}`;

/**
 * The tolerance a `'strict'` row takes when its merge-base count is above 0.
 * A count over a wall-clock window jitters on a loaded runner; a zero does not.
 */
export const NOISE_TOLERANCE = { ratio: 0.1, plus: 2 } as const satisfies CensusTolerance;

const growth = (base: number, t: { ratio: number; plus: number }): number => base * (1 + t.ratio) + t.plus;

/**
 * The highest count `tolerance` allows over a merge-base count of `base`.
 * `'strict'` allows `base` when `base` is 0, and `NOISE_TOLERANCE` otherwise.
 */
export const allowedCount = (base: number, tolerance: CensusTolerance): number =>
  tolerance !== 'strict' ? growth(base, tolerance) : base === 0 ? 0 : growth(base, NOISE_TOLERANCE);

const percent = (t: { ratio: number; plus: number }): string => `${Math.round(t.ratio * 1000) / 10} % + ${t.plus}`;

const describeTolerance = (t: CensusTolerance, base: number): string =>
  t !== 'strict' ? percent(t) : base === 0 ? 'strict' : `strict→noise ${percent(NOISE_TOLERANCE)} (base > 0)`;

/** The five command keys whose count grew most from `base` to `head`, largest first. */
export const grownCommands = (
  base: Record<string, number>,
  head: Record<string, number>,
): { key: string; base: number; head: number }[] =>
  Object.entries(head)
    .map(([key, n]) => ({ key, base: base[key] ?? 0, head: n }))
    .filter((c) => c.head > c.base)
    .sort((a, b) => b.head - b.base - (a.head - a.base) || a.key.localeCompare(b.key))
    .slice(0, 5);

export type CensusComparison = { ok: boolean; lines: string[] };

const lastByKey = (entries: readonly CensusEntry[]): Map<string, CensusEntry> =>
  new Map(entries.map((e) => [entryKey(e), e]));

/**
 * Compares HEAD's entries with the merge base's. An entry fails when its HEAD
 * count is above `allowedCount(base, tolerance)`, the tolerance read from
 * HEAD. An entry the merge base did not record passes with one "no before"
 * line. Where a report holds one key twice, the last entry counts.
 */
export const compareCensus = (base: readonly CensusEntry[], head: readonly CensusEntry[]): CensusComparison => {
  const before = lastByKey(base);
  const after = lastByKey(head);
  const lines: string[] = [];
  let ok = true;
  for (const [key, h] of after) {
    const b = before.get(key);
    if (b === undefined) {
      lines.push(`${key}: no before (${h.count} ${h.unit} on HEAD; the merge base recorded none) - passes`);
      continue;
    }
    const limit = allowedCount(b.count, h.tolerance);
    const verdict = `${key}: HEAD ${h.count}, merge base ${b.count} ${h.unit}; tolerance ${describeTolerance(h.tolerance, b.count)}, limit ${Math.round(limit * 100) / 100}`;
    if (h.count <= limit) {
      lines.push(`ok   ${verdict}`);
      continue;
    }
    ok = false;
    lines.push(`FAIL ${verdict}`);
    const grown = grownCommands(b.commands, h.commands);
    if (grown.length === 0) lines.push('     no command key grew (the count has no per-command figures)');
    for (const g of grown) lines.push(`     +${g.head - g.base}  ${g.key} (${g.base} -> ${g.head})`);
  }
  for (const key of before.keys()) {
    if (!after.has(key)) lines.push(`${key}: recorded on the merge base only (HEAD recorded none) - passes`);
  }
  return { ok, lines };
};

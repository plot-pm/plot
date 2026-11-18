import { decodeSliceSpend, isRunLine, type SliceSpendRun, type TokenCountsRecord } from '../entities/slice-spend.js';
import type { AgentRole } from './delivery-placement.js';

/** The `role` a run line carries for an agent role: the worker loop writes `worker`, every other role its own name. */
export const runLineRoleOf = (role: AgentRole): string => (role === 'loop' ? 'worker' : role);

const ZERO: TokenCountsRecord = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

const sumModels = (run: SliceSpendRun): TokenCountsRecord =>
  Object.values(run.models).reduce<TokenCountsRecord>((sum, m) => ({
    inputTokens: sum.inputTokens + m.inputTokens,
    outputTokens: sum.outputTokens + m.outputTokens,
    cacheCreationTokens: sum.cacheCreationTokens + m.cacheCreationTokens,
    cacheReadTokens: sum.cacheReadTokens + m.cacheReadTokens,
  }), ZERO);

const nonNegativeDifference = (a: TokenCountsRecord, b: TokenCountsRecord): TokenCountsRecord => ({
  inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
  outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  cacheCreationTokens: Math.max(0, a.cacheCreationTokens - b.cacheCreationTokens),
  cacheReadTokens: Math.max(0, a.cacheReadTokens - b.cacheReadTokens),
});

/** The last finished run of each branch and role, from one pass over the record. */
export type LastRunIndex = ReadonlyMap<string, TokenCountsRecord>;

const indexKey = (branch: string, role: string): string => `${role}\0${branch}`;

/** One finished run line's own figure and the instant it was written; `atMs` is `null` where `at` does not parse as a date. */
export interface FinishedRun {
  readonly branch: string;
  readonly role: string;
  readonly atMs: number | null;
  readonly tokens: TokenCountsRecord;
}

/**
 * Every finished run line of the record, in file order, each with its own figure.
 *
 * Run lines carry cumulative counters for their session, so a run's own figure
 * is the difference against the previous line of the same session, floored at
 * zero; the first line of a session is its own figure. The four counters stay
 * apart: no total is built. A seal line and an unparseable line add nothing.
 *
 * @param lines - the record's raw lines.
 * @returns one entry per run line.
 */
export const finishedRuns = (lines: readonly string[]): FinishedRun[] => {
  const previous = new Map<string, TokenCountsRecord>();
  const runs: FinishedRun[] = [];
  for (const line of lines) {
    const record = decodeSliceSpend(line);
    if (record === null || !isRunLine(record)) continue;
    const total = sumModels(record);
    const session = `${record.branch}\0${record.sessionId}`;
    const at = Date.parse(record.at);
    runs.push({
      branch: record.branch,
      role: record.role,
      atMs: Number.isNaN(at) ? null : at,
      tokens: nonNegativeDifference(total, previous.get(session) ?? ZERO),
    });
    previous.set(session, total);
  }
  return runs;
};

/**
 * Every branch's last finished run per role, from runs {@link finishedRuns} read.
 *
 * The newest line, in file order, is the last run.
 *
 * @param runs - the record's finished runs.
 * @returns the index; ask it through {@link lastRunTokens}.
 */
export const lastRunIndexOf = (runs: readonly FinishedRun[]): LastRunIndex => {
  const last = new Map<string, TokenCountsRecord>();
  for (const run of runs) last.set(indexKey(run.branch, run.role), run.tokens);
  return last;
};

/**
 * Every branch's last finished run per role, read in one pass over the record.
 *
 * @param lines - the record's raw lines.
 * @returns the index; ask it through {@link lastRunTokens}.
 */
export const lastRunIndex = (lines: readonly string[]): LastRunIndex => lastRunIndexOf(finishedRuns(lines));

/** A calendar day as the instants it spans: `startMs` inclusive, `endMs` exclusive. */
export interface DayBounds {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * The four counters summed over the finished runs written within one day.
 *
 * A run line whose `at` does not parse counts for no day. Every run of a branch
 * counts, not only its last.
 *
 * @param runs - {@link finishedRuns} of the record, or `null` where the record could not be read.
 * @param day - the day to sum.
 * @returns the summed counters, `0` for each where the record holds no run that day, and `null` for an unreadable record.
 */
export const tokensOnDay = (runs: readonly FinishedRun[] | null, day: DayBounds): TokenCountsRecord | null => {
  if (runs === null) return null;
  return runs.reduce<TokenCountsRecord>((sum, run) => {
    if (run.atMs === null || run.atMs < day.startMs || run.atMs >= day.endMs) return sum;
    return {
      inputTokens: sum.inputTokens + run.tokens.inputTokens,
      outputTokens: sum.outputTokens + run.tokens.outputTokens,
      cacheCreationTokens: sum.cacheCreationTokens + run.tokens.cacheCreationTokens,
      cacheReadTokens: sum.cacheReadTokens + run.tokens.cacheReadTokens,
    };
  }, ZERO);
};

/**
 * The four counters of a branch's last finished run for one role.
 *
 * @param index - {@link lastRunIndex} of the record, or `null` where the read failed.
 * @param branch - the branch the agent works on.
 * @param role - the agent's role.
 * @returns the counters, or `null` for an unreadable record and for a branch with no run line.
 */
export const lastRunTokens = (index: LastRunIndex | readonly string[] | null, branch: string, role: AgentRole): TokenCountsRecord | null => {
  if (index === null || branch === '') return null;
  const built = Array.isArray(index) ? lastRunIndex(index as readonly string[]) : (index as LastRunIndex);
  return built.get(indexKey(branch, runLineRoleOf(role))) ?? null;
};

/**
 * An output-token count as the cell shows it: `842`, `12.3k`, `1.2M`.
 *
 * @param n - output tokens.
 * @returns the shortest readable figure.
 */
export const tokenCountValue = (n: number): string => {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};

/** The Fleet header's tokens figure: the text it shows and the tooltip that holds the other counters. */
export interface FleetTokensFigure {
  readonly text: string;
  readonly title: string;
}

/**
 * The Fleet header's figure: today's finished-run output tokens, with the other three counters in the tooltip.
 *
 * The figure is the `outputTokens` counter alone; the tooltip lists the other
 * three on their own lines and builds no total.
 *
 * @param today - {@link tokensOnDay}, `null` for an unreadable record.
 * @param dayLabel - the day the figure covers, as the tooltip names it.
 * @returns the text and tooltip; the text is `—` for an unreadable record and `0 output tokens today, finished runs` for a record with no run that day.
 */
export const fleetTokensFigure = (today: TokenCountsRecord | null, dayLabel: string): FleetTokensFigure => {
  if (today === null) return { text: '—', title: 'The spend record could not be read, so there is no figure for today' };
  const lines = [
    `Finished runs on ${dayLabel}, the board's local day. Running agents and runs ended at the bound are not counted.`,
    `input tokens: ${tokenCountValue(today.inputTokens)}`,
    `cache creation tokens: ${tokenCountValue(today.cacheCreationTokens)}`,
    `cache read tokens: ${tokenCountValue(today.cacheReadTokens)}`,
  ];
  return { text: `${tokenCountValue(today.outputTokens)} output tokens today, finished runs`, title: lines.join('\n') };
};

/**
 * One Fleet group's count as the header line words it: `3 working`, `1 blocked`, `2 free`.
 *
 * @param group - the group key.
 * @param count - the number of agents placed in the group.
 */
export const fleetCountText = (group: string, count: number): string => `${count} ${group}`;

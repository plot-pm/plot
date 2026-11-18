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

/**
 * Every branch's last finished run per role, read in one pass over the record.
 *
 * Run lines carry cumulative counters for their session, so a run's own figure
 * is the difference against the previous line of the same session; the first
 * line of a session is its own figure. The newest line, in file order, is the
 * last run. The four counters stay apart: no total is built. A seal line and an
 * unparseable line add nothing.
 *
 * @param lines - the record's raw lines.
 * @returns the index; ask it through {@link lastRunTokens}.
 */
export const lastRunIndex = (lines: readonly string[]): LastRunIndex => {
  const previous = new Map<string, TokenCountsRecord>();
  const last = new Map<string, TokenCountsRecord>();
  for (const line of lines) {
    const record = decodeSliceSpend(line);
    if (record === null || !isRunLine(record)) continue;
    const total = sumModels(record);
    last.set(indexKey(record.branch, record.role), nonNegativeDifference(total, previous.get(`${record.branch}\0${record.sessionId}`) ?? ZERO));
    previous.set(`${record.branch}\0${record.sessionId}`, total);
  }
  return last;
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

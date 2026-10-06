import {
  decodeSliceSpend,
  isRunLine,
  type SliceSpend,
  type SliceSpendRun,
  type SliceSpendSeal,
  type TokenCountsRecord,
} from '../entities/slice-spend.js';

/**
 * What one read of the record found for one branch.
 *
 * **`measured` IS A WORD, NOT A BOOLEAN, AND THAT IS THE WHOLE POINT.** A
 * reader on a machine holding no record must be told *not measured here* rather
 * than shown a zero: a recorded zero is indistinguishable from a free run, and
 * a sum over one is wrong in the direction nobody checks.
 *
 * - `measured` — a record was found; `latest` carries it.
 * - `absent` — the record was read and holds nothing for this branch. The run
 *   may have taken the bound path, may have run on another machine, or may
 *   never have started.
 * - `unreadable` — the record itself could not be read. Distinct from `absent`
 *   for the reason `plot-worker-state.sh` keeps them apart: a failed call and
 *   an empty result are different answers.
 */
export type SpendReadState = 'measured' | 'absent' | 'unreadable';

/** A zero of every counter — the identity a sum starts from, never an answer. */
const noTokens = (): TokenCountsRecord => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

/** Adds one model's counters into a running total, in place. */
const addModelTokens = (total: TokenCountsRecord, add: TokenCountsRecord): void => {
  total.inputTokens += add.inputTokens;
  total.outputTokens += add.outputTokens;
  total.cacheCreationTokens += add.cacheCreationTokens;
  total.cacheReadTokens += add.cacheReadTokens;
};

/** Whether a run line's figures are all zero — a run that did not start. */
const isZeroedRun = (run: SliceSpendRun): boolean =>
  run.costUsd === 0 && Object.values(run.models).every((m) => Object.values(m).every((v) => v === 0));

/**
 * What one session's run lines added, read in file order.
 *
 * **EACH LINE ADDS ITS VALUE MINUS THE PREVIOUS LINE'S, NEVER THE NEWEST
 * LINE'S VALUE ALONE.** A resumed session's lines are cumulative, so the
 * second line of a two-line session restates the first line's figures plus
 * what the second run itself added — summing the lines directly would double
 * the first run's cost.
 *
 * **A LINE LOWER THAN THE PREVIOUS (a counter reset) ADDS ITS OWN VALUE**,
 * because a lower cumulative figure means the session's own counter restarted
 * and the previous total no longer applies as a baseline.
 *
 * **A ZEROED LINE ADDS NOTHING AND DOES NOT BECOME THE PREVIOUS LINE.** The
 * SDK writes an all-zero result for a run that did not start
 * (`sdk.d.ts:5698`); reading it as the new baseline would make the NEXT run's
 * full cumulative figure read as a `turns`-only increase. So lines of $10, $0,
 * $15 read $15 — the zeroed line is skipped entirely, both as a contribution
 * and as a baseline.
 *
 * @param runs - one session's run lines, in file order.
 * @returns the tokens, by model, and the cost this session actually added.
 */
const sessionIncrease = (
  runs: readonly SliceSpendRun[],
): { models: Record<string, TokenCountsRecord>; costUsd: number } => {
  const models: Record<string, TokenCountsRecord> = {};
  let costUsd = 0;
  let previous: SliceSpendRun | null = null;
  for (const run of runs) {
    if (isZeroedRun(run)) continue;
    if (previous === null) {
      for (const [model, spend] of Object.entries(run.models)) {
        models[model] = { ...(models[model] ?? noTokens()) };
        addModelTokens(models[model]!, spend);
      }
      costUsd += run.costUsd;
      previous = run;
      continue;
    }
    const reset = run.costUsd < previous.costUsd;
    for (const [model, spend] of Object.entries(run.models)) {
      const prior = previous.models[model];
      const delta = reset || prior === undefined ? spend : subtractTokens(spend, prior);
      models[model] = { ...(models[model] ?? noTokens()) };
      addModelTokens(models[model]!, delta);
    }
    costUsd += reset ? run.costUsd : run.costUsd - previous.costUsd;
    previous = run;
  }
  return { models, costUsd };
};

/** The increase from `prior` to `spend` — never negative per counter. */
const subtractTokens = (
  spend: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
  prior: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
): TokenCountsRecord => ({
  inputTokens: Math.max(0, spend.inputTokens - prior.inputTokens),
  outputTokens: Math.max(0, spend.outputTokens - prior.outputTokens),
  cacheCreationTokens: Math.max(0, spend.cacheCreationTokens - prior.cacheCreationTokens),
  cacheReadTokens: Math.max(0, spend.cacheReadTokens - prior.cacheReadTokens),
});

/**
 * What a reader learns about one branch's spend.
 *
 * ONE ANSWER RATHER THAN THREE CALLS, the shape `spendRate` takes in
 * `budget-record.ts`: every caller wants the state AND the newest record AND
 * the history, and a caller composing them itself composes them differently.
 */
export interface SpendRead {
  /** Whether this branch was measured here at all. */
  state: SpendReadState;
  /**
   * The newest record for the branch, or null.
   *
   * THE NEWEST, NOT THE ONLY. A second run writes a second record rather than
   * mutating the first, so a branch re-dispatched after a correction carries
   * several — and the newest is what the branch cost on its last run.
   */
  latest: SliceSpend | null;
  /** Every record for the branch, in file order — oldest first. */
  history: readonly SliceSpend[];
  /** How many lines could not be read at all — torn tails, newer formats. */
  unreadable: number;
  /**
   * The branch's total tokens, by model, summed over every session's increase
   * plus the seal line's own total where the branch has one.
   *
   * **THE DERIVED VERDICT, NEVER A STORED ONE.** This is what `readSpend`
   * computes on each read; nothing persists it. Null where nothing was
   * measured.
   */
  tokens: TokenCountsRecord | null;
  /** The branch's cost over its run lines' sessions; `null` where it has no run line, because a seal line records no cost. */
  costUsd: number | null;
  /** How many distinct SDK sessions (run lines) contributed to `tokens`. */
  runCount: number;
  /** How many turns `tokens` covers — every run's own turns plus the newest seal's. */
  turns: number;
  /** Every model that contributed to `tokens`, first-seen order. */
  models: readonly string[];
}

/**
 * Reads one branch's spend out of the record's raw lines.
 *
 * **LINES AS VALUES, NEVER A PATH.** The domain does not touch the disk: the
 * adapter decides what it read and this decides what it means, which is the
 * same contract `readWindow` takes in `budget-record.ts`.
 *
 * **A LINE BELONGING TO ANOTHER BRANCH IS NOT THIS BRANCH'S BUSINESS** and is
 * neither returned nor counted unreadable. One file holds every branch the
 * machine has measured.
 *
 * **RUN LINES GROUP BY `sessionId` IN FILE ORDER AND SUM EACH SESSION'S
 * INCREASE; THE SEAL LINE ADDS ITS OWN TOTAL.** A seal line is written only for
 * sessions with no run line (`entry/slice-spend.ts`), so the two never double
 * a session: the branch's derived total is the sum over every session's
 * increase plus the newest seal line's tokens, if any.
 *
 * @param lines - the record's raw lines, in file order; null where the record
 *   itself could not be read.
 * @param branch - the branch to ask about.
 * @returns the state, the newest record, the history, the unreadable count,
 *   and the derived totals.
 */
export const readSpend = (lines: readonly string[] | null, branch: string): SpendRead => {
  if (lines === null) {
    return {
      state: 'unreadable',
      latest: null,
      history: [],
      unreadable: 0,
      tokens: null,
      costUsd: null,
      runCount: 0,
      turns: 0,
      models: [],
    };
  }
  const history: SliceSpend[] = [];
  let unreadable = 0;
  const bySession = new Map<string, SliceSpendRun[]>();
  let sealLatest: SliceSpendSeal | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const record = decodeSliceSpend(line);
    if (record === null) {
      unreadable += 1;
      continue;
    }
    if (record.branch !== branch) continue;
    history.push(record);
    if (isRunLine(record)) {
      const existing = bySession.get(record.sessionId);
      if (existing === undefined) bySession.set(record.sessionId, [record]);
      else existing.push(record);
    } else {
      sealLatest = record;
    }
  }

  const latest = history.at(-1);
  if (latest === undefined) {
    return {
      state: 'absent',
      latest: null,
      history,
      unreadable,
      tokens: null,
      costUsd: null,
      runCount: 0,
      turns: 0,
      models: [],
    };
  }

  const combined = noTokens();
  let totalCost = 0;
  let totalTurns = 0;
  const models: string[] = [];
  const seenModels = new Set<string>();
  const addModel = (model: string): void => {
    if (seenModels.has(model)) return;
    seenModels.add(model);
    models.push(model);
  };
  for (const runs of bySession.values()) {
    const increase = sessionIncrease(runs);
    for (const [model, add] of Object.entries(increase.models)) {
      addModelTokens(combined, add);
      addModel(model);
    }
    totalCost += increase.costUsd;
    totalTurns += runs.reduce((sum, r) => sum + r.turns, 0);
  }
  if (sealLatest !== null) {
    addModelTokens(combined, sealLatest.tokens);
    totalTurns += sealLatest.turns;
    for (const model of sealLatest.models) addModel(model);
  }

  return {
    state: 'measured',
    latest,
    history,
    unreadable,
    tokens: combined,
    // A SEAL LINE RECORDS NO COST, so a branch with no run line has none.
    costUsd: bySession.size > 0 ? totalCost : null,
    runCount: bySession.size,
    turns: totalTurns,
    models,
  };
};

/**
 * How a reader is told what the record holds for a branch.
 *
 * **THE ABSENT CASES NAME THEMSELVES AND NEVER RENDER A NUMBER.** This is the
 * sentence that keeps *no record here* apart from *a free run* at the point a
 * person reads it — the honesty the plan calls the deliverable.
 *
 * @param read - what {@link readSpend} found.
 * @returns a sentence for a person.
 */
export const spendSummary = (read: SpendRead): string => {
  if (read.state === 'unreadable') return 'spend record unreadable';
  if (read.state === 'absent' || read.latest === null || read.tokens === null) {
    return 'not measured here';
  }
  const { tokens } = read;
  const counts = [
    `in ${tokens.inputTokens}`,
    `out ${tokens.outputTokens}`,
    `cache-write ${tokens.cacheCreationTokens}`,
    `cache-read ${tokens.cacheReadTokens}`,
  ].join(', ');
  const on = read.models.length === 0 ? 'model unrecorded' : read.models.join(', ');
  return `${counts} over ${read.turns} turns on ${on}`;
};

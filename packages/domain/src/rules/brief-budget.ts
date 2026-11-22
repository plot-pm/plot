/**
 * How many brief writers auto-dispatch may start in one pass.
 *
 * A brief writer is an agent process, so it is charged against the
 * `Parallel agents` cap like any other. An ask holds a slot only while its
 * brief is still missing from `origin/<main>`.
 *
 * @concept brief-budget
 */

/** What one pass read before it computes the brief budget. */
export interface BriefBudgetReadings {
  /** The configured `Parallel agents` cap. */
  readonly cap: number;
  /** Live agents that hold a branch. A free agent is not counted. */
  readonly busyAgents: number;
  /** Branches dispatched and not yet held by a live agent, across every board. */
  readonly inFlight: number;
  /** Brief asks still outstanding, as {@link outstandingAsks} answers them. */
  readonly outstanding: number;
}

/**
 * How many times a brief run that ended without a brief is asked again.
 *
 * A branch whose run ended `BRIEF_ASK_RETRIES + 1` times with its brief still
 * missing is {@link BriefAskState | spent}: no pass asks for it again until a
 * person writes the brief or clears the hold.
 */
export const BRIEF_ASK_RETRIES = 1;

/**
 * Where one branch's brief ask stands.
 *
 * - `asked`: a run is live, or its last run ended at the usage limit and the reset lies ahead.
 * - `free`: never asked, or its runs ended fewer than `BRIEF_ASK_RETRIES + 1` times; a pass may ask.
 * - `spent`: its runs ended `BRIEF_ASK_RETRIES + 1` times and the brief is still missing; no pass asks.
 */
export type BriefAskState = 'asked' | 'free' | 'spent';

/** What one pass read of the brief asks before it answers {@link briefAskState}. */
export interface BriefAskReadings {
  /** Branches a brief run was started for and that have not ended since. */
  readonly asked: ReadonlySet<string>;
  /** Branches this pass found with no brief on `origin/<main>`. */
  readonly missingBriefs: ReadonlySet<string>;
  /** Reset epoch in seconds per branch whose last run ended at the usage limit. */
  readonly waits?: ReadonlyMap<string, number>;
  /** How many runs ended without a usage-limit reset, per branch. */
  readonly ends?: ReadonlyMap<string, number>;
  /** The clock reading in epoch seconds; read only where `waits` names the branch. */
  readonly now?: number;
}

/**
 * Where one branch's brief ask stands, from the readings alone.
 *
 * A branch still in `missingBriefs` whose end count reaches
 * `BRIEF_ASK_RETRIES + 1` is `spent`, whether or not `asked` names it. Otherwise
 * an asked branch is `asked` while it has no wait or `now` lies before its
 * reset, and every other branch is `free`.
 *
 * @param branch The branch to answer for.
 * @param readings What this pass read.
 * @returns `asked`, `free` or `spent`.
 */
export const briefAskState = (branch: string, readings: BriefAskReadings): BriefAskState => {
  const { asked, missingBriefs, waits = new Map(), ends = new Map(), now = 0 } = readings;
  if (missingBriefs.has(branch) && (ends.get(branch) ?? 0) >= BRIEF_ASK_RETRIES + 1) return 'spent';
  if (!asked.has(branch)) return 'free';
  const resetEpoch = waits.get(branch);
  return resetEpoch === undefined || now < resetEpoch ? 'asked' : 'free';
};

/**
 * The asked branches whose brief is still missing and that may not be asked again yet.
 *
 * @param asked Branches a brief writer was started for and that have not ended since.
 * @param missingBriefs Branches this pass found with no brief on `origin/<main>`.
 * @param waits Reset epoch in seconds per branch whose last ask ended at the usage limit.
 * @param ends How many runs ended without a usage-limit reset, per branch.
 * @param now The clock reading in epoch seconds; read only where `waits` names a branch.
 * @returns A new set holding each asked branch that is still in `missingBriefs`
 *   and that {@link briefAskState} answers `asked`. A branch whose brief landed,
 *   that is no longer a candidate, whose reset has come, or that is `spent` is dropped.
 */
export const outstandingAsks = (
  asked: ReadonlySet<string>,
  missingBriefs: ReadonlySet<string>,
  waits: ReadonlyMap<string, number> = new Map(),
  ends: ReadonlyMap<string, number> = new Map(),
  now = 0,
): Set<string> =>
  new Set(
    [...asked].filter(
      (branch) =>
        missingBriefs.has(branch) &&
        briefAskState(branch, { asked, missingBriefs, waits, ends, now }) === 'asked',
    ),
  );

/**
 * The end counts that still belong to a missing brief.
 *
 * @param ends How many runs ended without a usage-limit reset, per branch.
 * @param missingBriefs Branches this pass found with no brief on `origin/<main>`.
 * @returns A new map holding the count of each branch still in `missingBriefs`.
 *   A branch whose brief landed, or that is no longer a candidate, is dropped.
 */
export const outstandingEnds = (
  ends: ReadonlyMap<string, number>,
  missingBriefs: ReadonlySet<string>,
): Map<string, number> => new Map([...ends].filter(([branch]) => missingBriefs.has(branch)));

/**
 * The usage-limit waits that still belong to an outstanding ask.
 *
 * @param waits Reset epoch in seconds per branch.
 * @param outstanding The branches {@link outstandingAsks} kept.
 * @returns A new map holding each wait whose branch is in `outstanding`.
 */
export const outstandingWaits = (
  waits: ReadonlyMap<string, number>,
  outstanding: ReadonlySet<string>,
): Map<string, number> => new Map([...waits].filter(([branch]) => outstanding.has(branch)));

/**
 * How many brief writers this pass may start.
 *
 * @param readings The cap and the three counts charged against it.
 * @returns `cap - (busyAgents + inFlight + outstanding)`, and never less than 0.
 */
export const briefAskBudget = ({
  cap,
  busyAgents,
  inFlight,
  outstanding,
}: BriefBudgetReadings): number => Math.max(0, cap - (busyAgents + inFlight + outstanding));

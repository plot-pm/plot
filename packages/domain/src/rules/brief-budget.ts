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
 * The asked branches whose brief is still missing.
 *
 * @param asked Branches a brief writer was started for.
 * @param missingBriefs Branches this pass found with no brief on `origin/<main>`.
 * @returns A new set holding each asked branch that is still in `missingBriefs`.
 *   A branch whose brief landed, or that is no longer a candidate, is dropped.
 */
export const outstandingAsks = (
  asked: ReadonlySet<string>,
  missingBriefs: ReadonlySet<string>,
): Set<string> => new Set([...asked].filter((branch) => missingBriefs.has(branch)));

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

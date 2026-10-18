import type { PlanStatePhase, PlanStateWrite } from '../ports/tracker.js';

/**
 * The status words a repository configured, one per finishing phase.
 *
 * `''` means that phase writes nothing. It is not a status to write.
 */
export interface IssueStatusWords {
  /** The word an `Approved` plan writes; `''` where the phase writes nothing. */
  readonly approved: string;
  /** The word a `Delivered` plan writes; `''` where the phase writes nothing. */
  readonly delivered: string;
  /** The word a `Released` plan writes; `''` where the phase writes nothing. */
  readonly released: string;
}

/** What a finished plan is read as, for the status it owes. */
export interface IssueStatusReading {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, in the order the plan names them. */
  readonly issues: readonly string[];
  /** The configured status words. */
  readonly words: IssueStatusWords;
}

/** One status a tracker is owed: the issue and the word to write to it. */
export interface IssueStatusWrite {
  /** The issue's identifier, verbatim — a number on one tracker, a key on another. */
  readonly issue: string;
  /** The status word, verbatim from configuration. */
  readonly status: string;
}

/**
 * Decides which status writes a plan owes its tracker.
 *
 * Only `approved`, `delivered` and `released` owe a write, each through its
 * own word. A `draft` plan owes none: it has no status word. A phase whose word
 * is empty owes nothing: one key never stands in for another.
 *
 * @param reading - the plan's phase, its issues and the configured words.
 * @returns one write per issue; empty where the phase owes none, the plan names
 *   no issue, or that phase's word is empty.
 */
export const issueStatusWrites = (reading: IssueStatusReading): readonly IssueStatusWrite[] => {
  const status =
    reading.phase === 'approved'
      ? reading.words.approved
      : reading.phase === 'delivered'
        ? reading.words.delivered
        : reading.phase === 'released'
          ? reading.words.released
          : '';
  if (status === '') return [];
  return reading.issues.filter((issue) => issue !== '').map((issue) => ({ issue, status }));
};

const PLAN_STATE_PHASES: readonly PlanStatePhase[] = ['draft', 'approved', 'delivered', 'released'];

/** Whether `phase` is one of the four {@link PlanStatePhase} values. */
export const isPlanStatePhase = (phase: string): phase is PlanStatePhase => (PLAN_STATE_PHASES as readonly string[]).includes(phase);

/** What a plan's phase owes a {@link import('../ports/tracker.js').Tracker.planStateWrite}. */
export interface PlanStateReading {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, in the order the plan names them. */
  readonly issues: readonly string[];
  /** The plan's address at this phase — the caller resolves where it lives. */
  readonly planLink: string;
  /** The release version; read for `released` and ignored otherwise. */
  readonly version?: string;
}

/**
 * Decides which plan-state writes a plan owes its tracker.
 *
 * Unlike {@link issueStatusWrites}, every one of the four phases owes a write —
 * `draft` included, because the label is the phase name itself and needs no
 * configured word. A phase outside the four (e.g. `design`) owes nothing.
 *
 * @param reading - the plan's phase, its issues, its link and, at release, the version.
 * @returns one write per issue; empty where the phase is not one of the four, or
 *   the plan names no issue.
 */
export const planStateWrites = (reading: PlanStateReading): readonly PlanStateWrite[] => {
  if (!isPlanStatePhase(reading.phase)) return [];
  const phase = reading.phase;
  return reading.issues
    .filter((issue) => issue !== '')
    .map((issue) => ({ issue, phase, planLink: reading.planLink, ...(reading.version === undefined ? {} : { version: reading.version }) }));
};

/** What one owed tracker write came to — a status write or a plan-state write alike. */
export type TrackerWriteOutcome = 'written' | 'no-target' | 'unaskable' | 'failed';

const WORST_LAST: readonly TrackerWriteOutcome[] = ['written', 'no-target', 'unaskable', 'failed'];

/**
 * Reduces a run's write outcomes to the one a caller reports.
 *
 * One failed write among several is a failed report, because the person
 * reading the summary is the one who repairs it — so the worst outcome
 * present wins: the last of {@link WORST_LAST} that appears in `outcomes`.
 *
 * @param outcomes - one per write this run attempted; empty means none was owed.
 * @returns the worst outcome present, or `'none'` when `outcomes` is empty.
 */
export const trackerWriteSummary = (outcomes: readonly TrackerWriteOutcome[]): TrackerWriteOutcome | 'none' => {
  let summary: TrackerWriteOutcome | 'none' = 'none';
  for (const candidate of WORST_LAST) if (outcomes.includes(candidate)) summary = candidate;
  return summary;
};

/** One finished run of a tracker-write script, as its caller received it. */
export interface TrackerRun {
  /** The script's standard output. */
  readonly stdout: string;
  /** The script's standard error. */
  readonly stderr: string;
  /** The script's exit code. */
  readonly code: number;
}

/** What a caller reports of one tracker-write run. */
export interface TrackerReport {
  /** The per-issue lines, then, on a failed run, the script's own reason. */
  readonly lines: readonly string[];
  /** The run's outcome, as its `summary: tracker=` line names it. */
  readonly outcome: TrackerWriteOutcome | 'none';
}

const SUMMARY_WORDS: readonly string[] = ['none', ...WORST_LAST];

/**
 * Reads a tracker-write script's run into the lines and the outcome its caller reports.
 *
 * A run that exits non-zero, or prints no `summary: tracker=<outcome>` line
 * naming a known outcome, is `failed`, and its stderr becomes the reason: the
 * caller reports it and continues, and never blocks the lifecycle step.
 *
 * @param run - the script's stdout, stderr and exit code.
 * @returns the per-issue lines (plus the reason on a failed run) and the outcome.
 */
export const trackerReportOf = (run: TrackerRun): TrackerReport => {
  const out = run.stdout.split('\n').filter((line) => line.length > 0);
  const lines = out.filter((line) => !line.startsWith('summary: '));
  const said = out.map((line) => /^summary: tracker=([a-z-]+)$/.exec(line)?.[1]).find((word) => word !== undefined);
  if (run.code === 0 && said !== undefined && SUMMARY_WORDS.includes(said)) {
    return { lines, outcome: said as TrackerWriteOutcome | 'none' };
  }
  const why = run.stderr.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return { lines: [...lines, ...(why.length > 0 ? why : [`exited ${run.code} with no tracker summary`])], outcome: 'failed' };
};

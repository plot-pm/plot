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
  /** The plan's merged-slice progress, rendered verbatim; absent where the caller has none to report. */
  readonly sliceProgress?: string;
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
    .map((issue) => ({
      issue,
      phase,
      planLink: reading.planLink,
      ...(reading.version === undefined ? {} : { version: reading.version }),
      ...(reading.sliceProgress === undefined ? {} : { sliceProgress: reading.sliceProgress }),
    }));
};

/** Why a release left an issue open instead of closing it. */
export type ReleaseSkipReason = 'another-plan-unfinished' | 'unreadable' | 'already' | 'unreachable' | 'no-target' | 'unaskable' | 'failed';

/** One issue a release either closed, or left open with a reason. */
export interface ReleaseIssueDecision {
  /** The issue's identifier, verbatim. */
  readonly issue: string;
  /** `null` where the issue closes; the reason it stays open otherwise. */
  readonly skip: ReleaseSkipReason | null;
}

/**
 * Decides which of a released plan's issues to close, ahead of any tracker write.
 *
 * An issue also named by a plan that is not yet `released` stays open: it is
 * shared, and the last plan to release is the one that closes it. Where the
 * sibling read itself is `'unreadable'`, every issue stays open — an unreadable
 * read is not the same as a read that found no sibling, and must never behave
 * like one. Every other issue is handed to the tracker, which decides
 * `no-target`, `unaskable` or `failed` on its own terms — this rule never
 * answers those itself.
 *
 * @param issues - the issues the released plan names.
 * @param unfinishedIssues - issues named by any OTHER plan not yet `released`,
 *   or `'unreadable'` where that read could not be trusted.
 * @returns one decision per issue, in the order `issues` names them.
 */
export const releaseIssueDecisions = (
  issues: readonly string[],
  unfinishedIssues: ReadonlySet<string> | 'unreadable',
): readonly ReleaseIssueDecision[] =>
  issues.map((issue) => ({
    issue,
    skip: unfinishedIssues === 'unreadable' ? 'unreadable' : unfinishedIssues.has(issue) ? 'another-plan-unfinished' : null,
  }));

/** One plan's phase and issues, as read from one `plot-plan-meta.sh` line. */
export interface PlanSiblingRecord {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, as strings — `plot-plan-meta.sh` reports them as numbers. */
  readonly issues: readonly string[];
}

/**
 * Parses one `plot-plan-meta.sh` line into a {@link PlanSiblingRecord}.
 *
 * Never throws: a line that is not JSON, or JSON of no known shape, reads as
 * `null`, which the caller must treat as unreadable rather than as holding no
 * issues.
 *
 * @param line - one line of `plot-plan-meta.sh` output.
 * @returns the phase and issues, or `null` where the line cannot be trusted.
 */
export const parsePlanSiblingLine = (line: string): PlanSiblingRecord | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { phase, issues } = parsed as { phase?: unknown; issues?: unknown };
  if (typeof phase !== 'string' || !Array.isArray(issues)) return null;
  if (!issues.every((issue) => typeof issue === 'string' || typeof issue === 'number')) return null;
  return { phase, issues: issues.map(String) };
};

/**
 * Collects the issues every unreleased sibling plan still owes.
 *
 * Reads every non-blank line as a {@link PlanSiblingRecord}; a `released`
 * sibling's issues are excluded, because that sibling no longer owes them —
 * every other phase's issues are unioned into the result. Where any one
 * non-blank line fails to parse, the whole read is `'unreadable'`: a partial
 * union built from the lines that DID parse would look the same as a complete
 * one, and the caller cannot tell "no sibling owes this" from "the read broke
 * partway through."
 *
 * @param lines - one `plot-plan-meta.sh` line per sibling plan.
 * @returns the union of unreleased siblings' issues, or `'unreadable'` where
 *   any line could not be parsed.
 */
export const unfinishedIssuesOf = (lines: readonly string[]): ReadonlySet<string> | 'unreadable' => {
  const issues = new Set<string>();
  for (const line of lines) {
    if (line.trim() === '') continue;
    const record = parsePlanSiblingLine(line);
    if (record === null) return 'unreadable';
    if (record.phase === 'released') continue;
    for (const issue of record.issues) issues.add(issue);
  }
  return issues;
};

/** How many issues a release closed, and how many it left open, with each reason. */
export interface ReleaseIssueSummary {
  /** How many issues were closed. */
  readonly closed: number;
  /** How many issues were left open, across every reason. */
  readonly leftOpen: number;
  /** How many issues were left open for each reason, omitting reasons with zero. */
  readonly reasons: Readonly<Partial<Record<ReleaseSkipReason, number>>>;
}

/**
 * Tallies a release's per-issue outcomes into the counts its summary reports.
 *
 * @param outcomes - one per issue the release considered: `'closed'`, or the
 *   reason it was left open.
 * @returns the closed and left-open counts, and left-open counts by reason.
 */
export const releaseIssueSummary = (outcomes: readonly ('closed' | ReleaseSkipReason)[]): ReleaseIssueSummary => {
  let closed = 0;
  const reasons: Partial<Record<ReleaseSkipReason, number>> = {};
  for (const outcome of outcomes) {
    if (outcome === 'closed') closed += 1;
    else reasons[outcome] = (reasons[outcome] ?? 0) + 1;
  }
  const leftOpen = outcomes.length - closed;
  return { closed, leftOpen, reasons };
};

/**
 * What a status write came to where the tracker offered no transition to the
 * wanted status.
 *
 * @param current - the issue's status before the write, as the tracker names it.
 * @param want - the status the write asked for.
 * @returns `already` where the issue holds the wanted status, compared without
 *   regard to case as the transition lookup compares; `unreachable` otherwise.
 */
export const noTransitionOutcome = (current: string, want: string): 'already' | 'unreachable' =>
  current.toLowerCase() === want.toLowerCase() ? 'already' : 'unreachable';

/** What one owed tracker write came to — a status write or a plan-state write alike. */
export type TrackerWriteOutcome = 'written' | 'already' | 'no-target' | 'unreachable' | 'unaskable' | 'failed';

// `already` ranks with `written` — the issue already held the wanted status,
// so nothing is out of step. `unreachable` ranks worse than `no-target`: the
// tracker holds no board at all is the ordinary case for untracked work, while
// a status existing but unreachable from here means the tracker is behind the
// plan, which is the fact this plan exists to surface.
const WORST_LAST: readonly TrackerWriteOutcome[] = ['written', 'already', 'no-target', 'unreachable', 'unaskable', 'failed'];

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

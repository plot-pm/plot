/** One plan as the backfill reads it: its phase and the issues its `Issue:` line names. */
export interface LabelPlan {
  /** The plan's phase, lowercase (`released`, `rejected`, `approved`, …). */
  phase: string;
  /** The issue identifiers the plan names, verbatim. */
  issues: readonly (string | number)[];
}

/** One tracker issue as the backfill reads it. */
export interface LabelIssue {
  /** The tracker's identifier. */
  id: string;
  /** The tracker's state word: `open` or `closed`. */
  status: string;
  /** The labels the issue carries. */
  labels: readonly string[];
}

/** Why an issue named by a Released plan is not written. */
export type LabelSkipReason = 'open' | 'live-plan' | 'already-labelled' | 'unread';

/** What {@link releasedLabelTargets} decides. */
export interface ReleasedLabelTargets {
  /** The issues that are owed the `plan:released` label, in numeric order. */
  write: readonly string[];
  /** The issues left alone, each with the reason. */
  skip: readonly { issue: string; reason: LabelSkipReason }[];
}

/** The label a Released plan's issue carries. */
export const RELEASED_LABEL = 'plan:released';

/** The phases whose plans still own an issue's label. Rejected and Superseded plans do not. */
const LIVE_PHASES: ReadonlySet<string> = new Set(['draft', 'design', 'approved', 'delivered']);

const byIssue = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
};

/**
 * Decides which issues named by a Released plan are owed the `plan:released` label.
 *
 * An issue is skipped, checked in this order, when it is `open`, when a
 * Draft/Design/Approved/Delivered plan also names it (`live-plan`), when it
 * already carries the label (`already-labelled`), or when the read returned no
 * row for it (`unread`). Every other issue is written. Rejected and Superseded
 * plans never block.
 *
 * @param plans - every plan's phase and issues.
 * @param issues - the tracker rows read.
 * @returns the `write` list and the `skip` list with reasons.
 */
export const releasedLabelTargets = (
  plans: readonly LabelPlan[],
  issues: readonly LabelIssue[],
): ReleasedLabelTargets => {
  const released = new Set<string>();
  const live = new Set<string>();
  for (const plan of plans) {
    const target = plan.phase === 'released' ? released : LIVE_PHASES.has(plan.phase) ? live : null;
    for (const issue of plan.issues) target?.add(String(issue));
  }
  const rows = new Map(issues.map((row) => [row.id, row]));
  const write: string[] = [];
  const skip: { issue: string; reason: LabelSkipReason }[] = [];
  for (const issue of [...released].sort(byIssue)) {
    const row = rows.get(issue);
    if (row === undefined) skip.push({ issue, reason: 'unread' });
    else if (row.status.toLowerCase() === 'open') skip.push({ issue, reason: 'open' });
    else if (live.has(issue)) skip.push({ issue, reason: 'live-plan' });
    else if (row.labels.includes(RELEASED_LABEL)) skip.push({ issue, reason: 'already-labelled' });
    else write.push(issue);
  }
  return { write, skip };
};

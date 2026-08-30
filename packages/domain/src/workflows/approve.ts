import { type Outcome, type Write, decide, refuse } from './decision.js';

/**
 * Why `approve` refused.
 *
 * Transcribed from `plot-approve.sh`, whose three refusal blocks are the
 * phase, the review channel and the PR — plus the two the script dies on
 * before reaching them.
 */
export type ApproveRefusal =
  | 'plan-not-found'
  | 'plan-unparseable'
  | 'phase-terminal'
  | 'phase-unreadable'
  | 'phase-wrong'
  | 'review-human'
  | 'review-unrecognised'
  | 'pr-closed'
  | 'pr-absent';

/** What `approve` reads about the plan it would approve. */
export interface ApproveReadings {
  /** The plan's slug. */
  slug: string;
  /**
   * The plan file's path, or `''` when no plan was found for the slug.
   *
   * The lookup is the adapter's — it globs two configured directories — and
   * its emptiness is the reading that produces `plan-not-found`.
   */
  file: string;
  /** Whether the parser could read the file at all. */
  parsed: boolean;
  /** The phase, normalized; `''` or `NONE` where the file stated none. */
  phase: string;
  /** The declared review channel; `NONE` for a plan that recorded no answer. */
  review: string;
  /** The declared implementation home, normalized. */
  impl: string;
  /** Every branch the plan names, across all of its slices. */
  branches: readonly string[];
  /** The sprint slug the plan belongs to, or `''`. */
  sprint: string;
  /** The sprint file naming this plan, or `''` when none does. */
  sprintFile: string;
  /** The `Approved:` record as written, or `''`. */
  approvedRecord: string;
  /** What the host says about the plan PR. */
  pr: ApprovePrReading;
}

/** What the host answered about the branch carrying the plan. */
export interface ApprovePrReading {
  /** The PR's number; 0 where the host holds none. */
  number: number;
  /** The state as the host reports it. */
  state: 'MERGED' | 'OPEN' | 'CLOSED' | 'NONE';
  /** Whether it is still a draft. */
  draft: boolean;
  /** The branch the PR belongs to. */
  branch: string;
}

/** What `approve` records beyond the plan. */
export interface ApproveInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** The name to record as approver. */
  who: string;
}

/** What an approval decided, beyond its writes. */
export interface ApproveDetail {
  /** The plan approved. */
  slug: string;
  /** The PR the approval rode on. */
  pr: number;
  /**
   * Whether the plan rides the work branch.
   *
   * The merge is skipped when it does: that PR merges once, at the end,
   * carrying the implementation with it.
   */
  sameBranch: boolean;
  /** Whether the phase and record were already on the default branch. */
  alreadyRecorded: boolean;
}

/**
 * Decides what approving a plan would write.
 *
 * Transcribed from `plot-approve.sh`, whose seven steps are the writes below.
 * A merged PR is not a refusal and neither is an already-Approved phase: both
 * are the idempotent case the script exists to repair, since its one
 * irreversible step is the merge and every step after it is local.
 *
 * @param readings - what the adapters measured about the plan and its PR.
 * @param input - the date and approver to record.
 * @returns a decision naming every write, or a refusal naming the rule that
 *   fired: `plan-not-found`, `plan-unparseable`, `phase-terminal`,
 *   `phase-unreadable`, `phase-wrong`, `review-human`, `review-unrecognised`,
 *   `pr-closed` or `pr-absent`.
 */
export const approve = (
  readings: ApproveReadings,
  input: ApproveInput,
): Outcome<ApproveDetail, ApproveRefusal> => {
  const { slug } = readings;
  const no = (reason: ApproveRefusal, detail: string) => refuse('approve', reason, detail);

  if (readings.file === '') {
    return no('plan-not-found', `no plan found for '${slug}'.`);
  }
  if (!readings.parsed) {
    return no(
      'plan-unparseable',
      `cannot parse '${readings.file}' — refusing rather than guessing.`,
    );
  }

  // `draft` and `design` both approve — Design is the transitional phase before
  // Approved, and approving it is its forward exit. `approved` is the
  // idempotent case: holds may still be set and the record may still be
  // missing.
  switch (readings.phase) {
    case 'draft':
    case 'design':
    case 'approved':
      break;
    case 'delivered':
    case 'released':
      return no('phase-terminal', `plan '${slug}' is already ${readings.phase} — nothing to approve.`);
    case 'NONE':
    case '':
      return no(
        'phase-unreadable',
        `cannot read the phase of '${slug}' (${readings.file}) — refusing rather than guessing.`,
      );
    default:
      return no(
        'phase-wrong',
        `plan '${slug}' is in phase '${readings.phase}' — only a Draft or Design plan can be approved.`,
      );
  }

  // NONE is a pre-Plot-2 plan on an idea branch, which the skill documents as
  // `pr`. An unrecognised value is refused rather than defaulted: treating one
  // as `pr` approves a plan nobody discussed, with a commit indistinguishable
  // from a legitimate one.
  switch (readings.review) {
    case 'pr':
    case 'NONE':
    case '':
      break;
    case 'in-session':
      return no(
        'review-human',
        `plan '${slug}' declares 'Review: in-session' — the reviewer is a human in the room.`,
      );
    case 'ballot':
      return no('review-human', `plan '${slug}' declares 'Review: ballot' — the tally is the approval.`);
    default:
      return no(
        'review-unrecognised',
        `plan '${slug}' records an unrecognised 'Review:' answer ('${readings.review}'). Refusing rather than treating it as 'pr'.`,
      );
  }

  switch (readings.pr.state) {
    case 'MERGED':
    case 'OPEN':
      break;
    case 'CLOSED':
      return no(
        'pr-closed',
        `the plan PR for '${slug}' (#${readings.pr.number}) is closed. Reopen it or create a new one.`,
      );
    default:
      return no(
        'pr-absent',
        `no PR found for branch '${readings.pr.branch}'. Run /plot-idea first, or push the branch.`,
      );
  }

  const sameBranch = readings.impl === 'same-branch';
  const writes: Write[] = [];

  // Step 2 — the PR. Skipped entirely under `same branch`, where merging here
  // would land an unfinished implementation on the default branch.
  if (!sameBranch && readings.pr.state !== 'MERGED') {
    // Ready BEFORE merge, because the reverse cannot exist: a draft PR is not
    // mergeable on either host.
    if (readings.pr.draft) writes.push({ kind: 'pr-ready', pr: readings.pr.number });
    writes.push({ kind: 'pr-merge', pr: readings.pr.number, deleteBranch: true });
  }

  // Step 3 — the phase. Already flipped is nothing to write, not a refusal.
  const phaseWritten = readings.phase === 'approved';
  if (!phaseWritten) {
    writes.push({ kind: 'plan-phase', file: readings.file, phase: 'Approved' });
  }

  // Step 4 — the record. The phase and the record travel together because they
  // came apart in practice: a flip written without its record made a plan
  // invisible to the scan.
  const recordWritten = readings.approvedRecord.trim() !== '';
  if (!recordWritten) {
    const channel = sameBranch
      ? `plan-PR #${readings.pr.number} reviewed`
      : `plan-PR #${readings.pr.number} merged`;
    writes.push({
      kind: 'plan-record',
      file: readings.file,
      field: 'Approved',
      value: `${input.on}, ${input.who}, ${channel}`,
    });
  }

  // Step 5 — the holds, one write per branch. Keyed by branch because the
  // phase gate matches the branch name, and entries this plan never named must
  // stay: approving one piece of work must not release someone else's gate.
  for (const branch of readings.branches) {
    writes.push({ kind: 'hold-clear', branch });
  }

  // Step 6 — the sprint annotation. A plan in no sprint is a no-op, and so is
  // a sprint whose file does not name it; neither is an error.
  if (readings.sprint !== '' && readings.sprintFile !== '') {
    writes.push({
      kind: 'sprint-annotation',
      file: readings.sprintFile,
      plan: slug,
      status: 'approved',
      pr: readings.pr.number,
      branch: readings.branches[0] ?? '',
    });
  }

  // Step 7 — the commit and the push. Only the plan file and the two
  // bookkeeping paths are staged: an `add -A` here would stage whatever else
  // the booking worktree held and hand the phase gate a reason to block.
  const planWrites = writes.filter((w) => w.kind !== 'pr-ready' && w.kind !== 'pr-merge');
  if (planWrites.length > 0) {
    writes.push({ kind: 'commit', message: `plot: approve ${slug}`, paths: stagedPaths(readings) });
    writes.push({ kind: 'push', branch: sameBranch ? '' : `plot/approve-${slug}`, onto: sameBranch ? '' : 'default' });
  }

  return decide('approve', writes, {
    slug,
    pr: readings.pr.number,
    sameBranch,
    alreadyRecorded: phaseWritten && recordWritten,
  });
};

/**
 * The paths an approval stages, and no others.
 *
 * @param readings - the plan being approved.
 * @returns the plan file, the hold file where branches were cleared, and the
 *   sprint file where its annotation was rewritten.
 */
const stagedPaths = (readings: ApproveReadings): string[] => {
  const paths = [readings.file];
  if (readings.branches.length > 0) paths.push('.plot/hold');
  if (readings.sprint !== '' && readings.sprintFile !== '') paths.push(readings.sprintFile);
  return paths;
};

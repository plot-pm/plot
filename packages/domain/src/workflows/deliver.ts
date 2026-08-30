import { type Outcome, type Write, decide, refuse } from './decision.js';

/**
 * Why `deliver` refused.
 *
 * Transcribed from `plot-deliver.sh`: its two refusal blocks are the phase and
 * the unmerged branches, plus the two it dies on before reaching them.
 */
export type DeliverRefusal =
  | 'plan-not-found'
  | 'plan-unparseable'
  | 'phase-terminal'
  | 'phase-too-early'
  | 'phase-unreadable'
  | 'phase-wrong'
  | 'branches-unmerged';

/** One branch of the plan being delivered, with what the host said about it. */
export interface DeliverBranchReading {
  /** The branch name. */
  branch: string;
  /** Whether the plan gave it up rather than finishing it. */
  deferred: boolean;
  /** Whether the host merged its PR. */
  merged: boolean;
}

/** What `deliver` reads about the plan it would deliver. */
export interface DeliverReadings {
  /** The plan's slug. */
  slug: string;
  /** The plan file's path, or `''` when no plan was found for the slug. */
  file: string;
  /** Whether the parser could read the file at all. */
  parsed: boolean;
  /** The phase, normalized; `''` or `NONE` where the file stated none. */
  phase: string;
  /**
   * The plan's branches, with their merge state.
   *
   * An empty list is a plan with nothing to verify, which the script proceeds
   * on. That is only safe because the adapter reads all three section
   * spellings — a `## Slices` plan parsed to zero branches here on 2026-08-30
   * and the gate passed because it found nothing to check.
   */
  branches: readonly DeliverBranchReading[];
  /** The `Delivered:` record as written, or `''`. */
  deliveredRecord: string;
  /** The plan's `active/` index link, or `''` when it has none. */
  activeLink: string;
  /** Where the link goes once delivered, or `''` when there is no index. */
  deliveredLink: string;
  /** The sprint slug the plan belongs to, or `''`. */
  sprint: string;
  /** The sprint file naming this plan, or `''` when none does. */
  sprintFile: string;
}

/** What `deliver` records beyond the plan. */
export interface DeliverInput {
  /** The date to record, ISO-8601. */
  on: string;
}

/** What a delivery decided, beyond its writes. */
export interface DeliverDetail {
  /** The plan delivered. */
  slug: string;
  /** How many non-deferred branches were verified merged. */
  merged: number;
  /** How many branches the plan gave up. */
  deferred: number;
  /** Whether the phase and record were already on the default branch. */
  alreadyRecorded: boolean;
}

/**
 * Decides what delivering a plan would write.
 *
 * Transcribed from `plot-deliver.sh`. The unmerged-branch check is one of
 * Plot's four phase guardrails: a branch is outstanding unless the host merged
 * its PR or the plan gave it up, and the reading comes from the host rather
 * than from the plan file, which carries no merge record.
 *
 * `delivered` is not refused — it is the idempotent case, and the run still
 * has a record to check, an index link to move and an annotation to update.
 *
 * @param readings - what the adapters measured about the plan and its branches.
 * @param input - the date to record.
 * @returns a decision naming every write, or a refusal naming the rule that
 *   fired: `plan-not-found`, `plan-unparseable`, `phase-terminal`,
 *   `phase-too-early`, `phase-unreadable`, `phase-wrong` or
 *   `branches-unmerged`.
 */
export const deliver = (
  readings: DeliverReadings,
  input: DeliverInput,
): Outcome<DeliverDetail, DeliverRefusal> => {
  const { slug } = readings;
  const no = (reason: DeliverRefusal, detail: string) => refuse('deliver', reason, detail);

  if (readings.file === '') {
    return no('plan-not-found', `no plan found for '${slug}'.`);
  }
  if (!readings.parsed) {
    return no('plan-unparseable', `cannot parse '${readings.file}' — refusing rather than guessing.`);
  }

  switch (readings.phase) {
    case 'approved':
    case 'delivered':
      break;
    case 'released':
      return no('phase-terminal', `plan '${slug}' is already released — nothing to deliver.`);
    case 'draft':
    case 'design':
      return no('phase-too-early', `plan '${slug}' is still '${readings.phase}' — approve it first.`);
    case 'NONE':
    case '':
      return no(
        'phase-unreadable',
        `cannot read the phase of '${slug}' (${readings.file}) — refusing rather than guessing.`,
      );
    default:
      return no(
        'phase-wrong',
        `plan '${slug}' is in phase '${readings.phase}' — only an Approved plan can be delivered.`,
      );
  }

  const outstanding = readings.branches.filter((b) => !b.deferred && !b.merged);
  if (outstanding.length > 0) {
    const names = outstanding.map((b) => b.branch).join(', ');
    return no(
      'branches-unmerged',
      `cannot deliver: ${outstanding.length} branch(es) not merged: ${names}. Merge them first, or mark them deferred with \`<!-- deferred: <reason> -->\`.`,
    );
  }

  const writes: Write[] = [];

  const phaseWritten = readings.phase === 'delivered';
  if (!phaseWritten) {
    writes.push({ kind: 'plan-phase', file: readings.file, phase: 'Delivered' });
  }

  const recordWritten = readings.deliveredRecord.trim() !== '';
  if (!recordWritten) {
    writes.push({ kind: 'plan-record', file: readings.file, field: 'Delivered', value: input.on });
  }

  // The index link moves, unlike a release's. A phase flip without it reports
  // drift and fails the reconcile gate — the link is how the estate browses by
  // phase, and a plan that skipped the move is invisible where people look.
  if (readings.activeLink !== '' && readings.deliveredLink !== '') {
    writes.push({ kind: 'index-move', from: readings.activeLink, to: readings.deliveredLink });
  }

  if (readings.sprint !== '' && readings.sprintFile !== '') {
    writes.push({
      kind: 'sprint-annotation',
      file: readings.sprintFile,
      plan: slug,
      status: 'delivered',
      pr: null,
      branch: '',
    });
  }

  if (writes.length > 0) {
    writes.push({ kind: 'commit', message: `plot: deliver ${slug}`, paths: stagedPaths(readings) });
    writes.push({ kind: 'push', branch: `plot/deliver-${slug}`, onto: 'default' });
  }

  const deferred = readings.branches.filter((b) => b.deferred).length;
  return decide('deliver', writes, {
    slug,
    merged: readings.branches.length - deferred,
    deferred,
    alreadyRecorded: phaseWritten && recordWritten,
  });
};

/**
 * The paths a delivery stages, and no others.
 *
 * @param readings - the plan being delivered.
 * @returns the plan file, the index directories where the link moved, and the
 *   sprint file where its annotation was rewritten.
 */
const stagedPaths = (readings: DeliverReadings): string[] => {
  const paths = [readings.file];
  if (readings.activeLink !== '' && readings.deliveredLink !== '') {
    paths.push(readings.activeLink, readings.deliveredLink);
  }
  if (readings.sprint !== '' && readings.sprintFile !== '') paths.push(readings.sprintFile);
  return paths;
};

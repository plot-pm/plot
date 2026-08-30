import { type Outcome, type Write, decide, refuse } from './decision.js';

/**
 * Why `implement` refused.
 *
 * FIXTURE-VERIFIED ONLY — transcribed from `skills/plot-implement/SKILL.md`,
 * which has no exit code. See `EVIDENCE` in `./decision.js`: the prose is the
 * specification, and it is what every agent running this workflow follows
 * today, but no corpus comparison and no sandbox check can fail on it.
 *
 * The five are the skill's own: two phase refusals from step 1, the two
 * `PLOT-UNASKED` stops, and step 3's nothing-claimable.
 */
export type ImplementRefusal =
  | 'phase-too-early'
  | 'phase-terminal'
  | 'plan-ambiguous'
  | 'drift-unresolved'
  | 'nothing-claimable';

/** What the staleness preflight measured. Step 2. */
export interface DriftReading {
  /** Whether anything moved under the plan since it was approved. */
  found: boolean;
  /** What moved, one line each, for a person to act on. */
  what: readonly string[];
}

/** What `implement` reads about the plan it would start. */
export interface ImplementReadings {
  /** The plan's slug, or `''` when the caller named none. */
  slug: string;
  /** The plan file's path. */
  file: string;
  /** The phase, normalized. */
  phase: string;
  /** The declared implementation home, normalized. */
  impl: string;
  /**
   * How many approved plans the caller could have meant.
   *
   * Read only where no slug was named: one is proposed, several are a stop.
   */
  candidates: number;
  /** What the staleness preflight found. */
  drift: DriftReading;
  /**
   * The branch the fleet scan offers, or `''` when nothing is claimable.
   *
   * Empty is a normal state rather than an error: every eligible branch is
   * taken, or the next slice is blocked on unmerged work.
   */
  nextBranch: string;
  /** Whether that branch already exists, locally or on the remote. */
  branchExists: boolean;
  /** The repository's default branch. */
  defaultBranch: string;
  /** The `Started:` records the plan already carries. */
  startedRecords: readonly string[];
}

/** What `implement` records beyond the plan. */
export interface ImplementInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** The name to record as starter. */
  who: string;
  /**
   * Whether a person is there to answer a question.
   *
   * `PLOT_UNATTENDED` answers *may I ask?* and never *may I proceed?*: a
   * variable set in the least-supervised environment has strictly less power
   * than the operator, so it converts no refusal into a pass.
   */
  unattended?: boolean;
}

/** What starting implementation decided, beyond its writes. */
export interface ImplementDetail {
  /** The plan started. */
  slug: string;
  /** The branch claimed, or `''` for a plan with no branches to set up. */
  branch: string;
  /** Whether this re-orients an existing branch rather than creating one. */
  resume: boolean;
  /** Questions that were not asked because nobody was there, as the skill names them. */
  unasked: readonly string[];
}

/**
 * Decides what starting implementation of a plan would write.
 *
 * FIXTURE-VERIFIED ONLY. Transcribed from `skills/plot-implement/SKILL.md` —
 * six numbered steps, five named refusals, two `PLOT-UNASKED` shapes. That
 * prose is the specification, and this expresses it; what it cannot do is fail
 * mechanically, so this workflow is proven against fixtures and nothing else.
 *
 * The claim is the push, and it is the whole locking mechanism: pushing a ref
 * that already exists is rejected, so two sessions racing for one branch cannot
 * both win. That is why the branch write carries `push: true` and why it is
 * ordered before the brief — claim first, work second.
 *
 * @param readings - what the adapters measured about the plan and the fleet.
 * @param input - the date and starter to record, and whether anyone is present.
 * @returns a decision naming every write, or a refusal naming the rule that
 *   fired: `phase-too-early`, `phase-terminal`, `plan-ambiguous`,
 *   `drift-unresolved` or `nothing-claimable`.
 */
export const implement = (
  readings: ImplementReadings,
  input: ImplementInput,
): Outcome<ImplementDetail, ImplementRefusal> => {
  const no = (reason: ImplementRefusal, detail: string) => refuse('implement', reason, detail);
  const unasked: string[] = [];

  // Step 1 — locate the plan. A slug nobody named is only resolvable where
  // exactly one approved plan is waiting.
  if (readings.slug === '' && readings.candidates !== 1) {
    if (input.unattended) {
      return no(
        'plan-ambiguous',
        `PLOT-UNASKED: Which plan should implementation start on? — stopped — ${readings.candidates} candidates listed; no branch created`,
      );
    }
    return no(
      'plan-ambiguous',
      `${readings.candidates} approved plans are ready — name the one to start.`,
    );
  }

  switch (readings.phase) {
    case 'approved':
      break;
    case 'draft':
    case 'design':
      return no(
        'phase-too-early',
        `plan isn't approved yet — review it and run /plot-approve ${readings.slug} first.`,
      );
    default:
      return no(
        'phase-terminal',
        `plan '${readings.slug}' is ${readings.phase} — nothing to start.`,
      );
  }

  // Step 2 — the staleness preflight. Drift is a verdict rather than a default,
  // and with nobody present there is no one to give it: the plan and the
  // worktree are left untouched.
  if (readings.drift.found && input.unattended) {
    return no(
      'drift-unresolved',
      `PLOT-UNASKED: How should this plan's drift be handled? — stopped — drift reported; no branch created and no amendment written. Moved: ${readings.drift.what.join('; ')}`,
    );
  }

  const writes: Write[] = [];
  const resume = readings.startedRecords.length > 0;

  // Step 3 — branch setup, per the plan's recorded `Impl:` answer. Never
  // re-decided here.
  let branch = '';
  const setsUpBranches = readings.impl === 'own-branches' || readings.impl === 'same-branch';
  if (readings.impl === 'own-branches') {
    if (readings.nextBranch === '') {
      return no(
        'nothing-claimable',
        'Nothing claimable: every eligible branch is taken, or the next slice is blocked on unmerged work. Run /plot-fleet to see why.',
      );
    }
    branch = readings.nextBranch;
    // An existing branch is a resume, not a re-creation: plans approved under
    // pre-Plot-2 flows arrive here with branches and no `Started:` record.
    if (!readings.branchExists) {
      writes.push({
        kind: 'branch-create',
        branch,
        base: `origin/${readings.defaultBranch}`,
        push: true,
      });
    }
  } else if (readings.impl === 'same-branch') {
    // The plan already rides the work branch; it is checked out, not created.
    branch = readings.slug;
  }

  // Step 4 — the hand-off brief. Written to a file because a brief that exists
  // only in the dispatching session's scrollback dies with that session.
  if (setsUpBranches && branch !== '') {
    writes.push({
      kind: 'brief',
      file: `.plot/briefs/${branch.replace(/\//g, '-')}.md`,
      branch,
    });
  }

  // Step 5 — the Started record, one line per started branch. The board derives
  // Ready from its absence and In progress from its presence.
  const started = `${input.on}, ${input.who}, \`${branch}\``;
  const alreadyStarted = readings.startedRecords.some((r) => r.includes(`\`${branch}\``));
  if (branch !== '' && !alreadyStarted) {
    writes.push({ kind: 'plan-record', file: readings.file, field: 'Started', value: started });
  }

  // Staged from the writes themselves rather than re-derived: a path list built
  // a second way is one that can name a file no write touched.
  if (writes.length > 0) {
    const paths = writes.flatMap((w) => (w.kind === 'brief' ? [w.file] : []));
    writes.push({
      kind: 'commit',
      message: `plot: start ${readings.slug}`,
      paths: [readings.file, ...paths],
    });
  }

  if (readings.drift.found) {
    unasked.push(
      `PLOT-UNASKED: How should this plan's drift be handled? — asked — ${readings.drift.what.length} signals reported`,
    );
  }

  return decide('implement', writes, { slug: readings.slug, branch, resume, unasked });
};

import { type Outcome, type Refusal, type Write, decide, refuse } from './decision.js';

/**
 * Why `dispatch` refused a whole run.
 *
 * Transcribed from `plot-dispatch.sh`. Every one of these stops the run before
 * a single branch is considered, which is what separates them from
 * {@link BranchRefusal}: a phase gate that fired says nothing was dispatchable,
 * while a held worktree says one branch was not.
 *
 * The four verbs refuse for different reasons and the names carry which, so a
 * caller branching on `worker-alive` never has to ask which mode produced it.
 */
export type DispatchRefusal =
  | 'not-a-repository'
  | 'slug-missing'
  | 'max-not-a-number'
  | 'ref-unreadable'
  | 'plan-not-found'
  | 'plan-unreadable'
  | 'phase-draft'
  | 'phase-terminal'
  | 'phase-unreadable'
  | 'phase-wrong'
  | 'impl-same-branch'
  | 'impl-other-repo'
  | 'impl-none'
  | 'impl-unrecognised'
  | 'branch-missing'
  | 'no-worktree'
  | 'reached-review'
  | 'worker-alive'
  | 'blocked-marker'
  | 'root-unconfigured'
  | 'root-is-legacy';

/**
 * Why one branch was not dispatched, while the run went on.
 *
 * Per-branch and therefore never a `Refusal`: the run that skipped a held
 * branch and claimed three others decided, and reporting it as a refusal would
 * lose the three.
 */
export type BranchRefusal =
  /** A worktree on this disk holds the branch with work that has not landed. */
  | 'held'
  /** Another session's claim push landed first; its worktree is left alone. */
  | 'claim-lost'
  /** `git worktree add` failed on both the new-branch and existing-branch forms. */
  | 'worktree-uncreatable'
  /** The operator's `--max`, which is a bound rather than a fact about the branch. */
  | 'max-reached';

/**
 * How a `Worker command` was answered, and whether this run may use it.
 *
 * `declined` is the repo's sentinel for *asked, and we start them by hand* —
 * a deliberate absence, distinct from `unconfigured` precisely so the skill
 * stops asking. `none` is never run as a command.
 */
export type AgentCommandConfig = 'unconfigured' | 'declined' | 'configured' | 'suppressed';

/** What the plan gate read, and where it read it. */
export interface PlanGateReadings {
  /**
   * Whether `origin/<main>` resolved to a commit.
   *
   * The gate FAILS CLOSED on false. `plot-phase-gate.sh` fails open because it
   * is a PreToolUse hook and a broken gate there locks every commit in the
   * repo; this is a command the operator invoked, so refusing costs one
   * confused re-run while proceeding costs several agents doing unapproved
   * work. The damage is asymmetric, so the default is too.
   */
  refResolved: boolean;
  /**
   * The plan file's path as found ON THE REF, or `''` when the ref holds none.
   *
   * Never a working-tree path unless {@link DispatchInput.allowLocal} is set:
   * reading the working tree got this gate wrong in BOTH directions, and the
   * permissive direction accepts an approval nobody else can see.
   */
  file: string;
  /** Whether the plan's blob could be materialised and parsed. */
  parsed: boolean;
  /** The phase, normalized; `''` or `NONE` where the file stated none. */
  phase: string;
  /** The declared implementation home, normalized. */
  impl: string;
  /** What the gate read, for a message: the ref and sha, or the working tree. */
  source: string;
}

/** One branch the fleet scan offered, and what this machine holds for it. */
export interface DispatchCandidate {
  /** The branch, as the plan names it. */
  branch: string;
  /**
   * The worktree git says holds this branch, or `''` when none does.
   *
   * FOUND BY ASKING GIT, never by rebuilding the path from the branch name.
   * Hand-made worktrees are the population with no claim ref — the entire
   * reason the held gate exists — and they rarely follow dispatch's naming; a
   * path-guessing check can only catch branches that were already claimed.
   */
  heldBy: string;
  /**
   * Whether that worktree holds work that has not landed.
   *
   * Uncommitted changes OR commits not in the default branch, and the
   * uncommitted half is what makes it correct: a worktree cut minutes ago and a
   * merged leftover are both `ahead=0, behind=N`, so no walk of the history
   * separates them and only the files do.
   */
  heldWorkUnlanded: boolean;
  /**
   * The worktree this run would create or adopt, at dispatch's own naming.
   *
   * The CREATION side, which is the only place a path is composed rather than
   * asked for. The whole branch name is flattened, not just its last segment:
   * `feature/api` and `bug/api` are different work and must not share a desk.
   */
  worktree: string;
  /** Whether that path is already a registered worktree, to be adopted rather than duplicated. */
  worktreeExists: boolean;
  /**
   * Whether `git worktree add` would succeed, on either of its two forms.
   *
   * The script tries the new-branch form and falls back to attaching an
   * existing local branch; only both failing is the refusal. Defaults to
   * creatable, because a candidate the scan offered normally is.
   */
  worktreeCreatable?: boolean;
  /**
   * Whether this run's claim push would land.
   *
   * A rejection means another session won the race. Defaults to winning: a
   * reading that could not be taken is not evidence somebody else claimed it,
   * and the performer finds out for certain when it pushes.
   */
  claimWins?: boolean;
  /** Whether a readable, non-empty brief exists ON `origin/<main>` for this branch. */
  briefPresent: boolean;
}

/** What `dispatch` reads before deciding anything. */
export interface DispatchReadings {
  /** Whether the caller is inside a git repository at all. */
  inRepository: boolean;
  /** The plan's slug; `''` where none was given. */
  slug: string;
  /** The repository's default branch. */
  defaultBranch: string;
  /** What the phase gate read; absent for the verbs that run before it. */
  gate?: PlanGateReadings;
  /** The branches the fleet scan called eligible and unclaimed, in the order it offered them. */
  candidates: readonly DispatchCandidate[];
  /** How the repo answered `Worker command`. */
  workerCommand: 'unconfigured' | 'declined' | 'configured';
}

/** What one fan-out was asked to do. */
export interface DispatchInput {
  /** Print what would happen and write nothing. */
  dryRun?: boolean;
  /** Prepare worktrees and claims, start no workers. */
  noStart?: boolean;
  /** Start a worker even where its branch has no brief. */
  noBrief?: boolean;
  /** Read the phase from the working tree when `origin/<main>` cannot be resolved. */
  allowLocal?: boolean;
  /** Dispatch at most this many branches; 0 for no bound. */
  max?: number;
  /** Whether `--max` was given a value that is a number at all. */
  maxIsNumeric?: boolean;
}

/** One branch this run would not dispatch, and why. */
export interface DispatchSkipped {
  /** The branch. */
  branch: string;
  /** Which rule fired. */
  reason: BranchRefusal;
  /** The worktree involved, where one is; `''` otherwise. */
  worktree: string;
}

/** One branch this run would prepare, and how far it would take it. */
export interface DispatchPrepared {
  /** The branch. */
  branch: string;
  /** The worktree it would get. */
  worktree: string;
  /** Whether an existing worktree is adopted rather than created. */
  reused: boolean;
  /** Whether a worker would be started in it. */
  started: boolean;
  /**
   * Why no worker would start, or `''` where one would.
   *
   * A brief gate that fired is not a skip: the worktree and the claim above
   * are correct and stay, and only the launch is refused.
   */
  notStartedBecause: '' | 'no-brief' | 'no-start' | 'worker-unconfigured' | 'worker-declined';
}

/** What a fan-out decided, beyond its writes. */
export interface DispatchDetail {
  /** The plan fanned out. */
  slug: string;
  /** The branches it would newly claim, in order. */
  dispatched: readonly string[];
  /** The branches whose existing worktree it would adopt. */
  reused: readonly string[];
  /** Every branch it would not take, with the reason. */
  skipped: readonly DispatchSkipped[];
  /** Every branch it would prepare, claimed or adopted, with how far. */
  prepared: readonly DispatchPrepared[];
  /** How many workers it would start. */
  started: number;
  /** How the summary's `worker=` field would read. */
  worker: AgentCommandConfig;
  /** Whether this run writes nothing by construction. */
  dryRun: boolean;
}

/**
 * Decides what fanning out a plan would do, and refuses where the script does.
 *
 * Transcribed from `plot-dispatch.sh`, the one script in the fleet that
 * writes. Every refusal below is a MEASUREMENT rather than a judgement — a
 * live pid, a marker file, files in a tree, a phase on a shared ref — which is
 * exactly what makes them expressible here at all: an agent asked *is this
 * safe?* can talk itself past any of them, and a decision computed from
 * measurements cannot.
 *
 * The run-level refusals stop everything; a branch that cannot be taken is
 * recorded in {@link DispatchDetail.skipped} and the run goes on, because one
 * branch's occupied desk says nothing about the next.
 *
 * @param readings - what the adapters measured about the plan, the fleet and
 *   this machine's worktrees.
 * @param input - the verb and flags this run was given.
 * @returns a decision naming every write, or a refusal naming the rule.
 */
export const dispatch = (
  readings: DispatchReadings,
  input: DispatchInput = {},
): Outcome<DispatchDetail, DispatchRefusal> => {
  const no = (reason: DispatchRefusal, detail: string) => refuse('dispatch', reason, detail);
  const dryRun = input.dryRun ?? false;

  if (!readings.inRepository) return no('not-a-repository', 'not a git repository.');
  if (input.maxIsNumeric === false) {
    return no('max-not-a-number', 'plot-dispatch: --max needs a number.');
  }
  if (readings.slug === '') return no('slug-missing', 'plot-dispatch: need a plan slug.');

  const gateRefusal = plangate(readings, input);
  if (gateRefusal) return gateRefusal;

  const max = input.max ?? 0;
  const worker = workerConfig(readings.workerCommand, input.noStart ?? false);

  const writes: Write[] = [];
  const dispatched: string[] = [];
  const reused: string[] = [];
  const skipped: DispatchSkipped[] = [];
  const prepared: DispatchPrepared[] = [];
  let started = 0;

  for (const candidate of readings.candidates) {
    // The bound is the operator's and is checked against what was CLAIMED,
    // matching the script's loop guard: a skipped branch consumed no slot.
    if (max > 0 && dispatched.length >= max) {
      skipped.push({ branch: candidate.branch, reason: 'max-reached', worktree: '' });
      continue;
    }

    // THE HELD GATE APPLIES TO A DRY RUN IDENTICALLY, by construction: one
    // predicate, consulted before the dry-run branch below rather than inside
    // it. A dry run that offers what a real run would refuse is worse than no
    // dry run — it is the same wrong answer with a reassurance attached.
    if (isHeld(candidate)) {
      skipped.push({ branch: candidate.branch, reason: 'held', worktree: candidate.heldBy });
      continue;
    }

    if (dryRun) {
      // NOTHING IS WRITTEN, and the branch is still counted as dispatched —
      // the script's dry loop reports `dispatched=N` for what a real run would
      // take. The absence of writes is the whole difference.
      dispatched.push(candidate.branch);
      prepared.push({
        branch: candidate.branch,
        worktree: candidate.worktree,
        reused: false,
        started: false,
        // A dry run starts nothing BY CONSTRUCTION, so naming a cause here
        // would report the config on a run that never consulted it.
        notStartedBecause: '',
      });
      continue;
    }

    if (candidate.worktreeExists) {
      // Adopted, never duplicated: a dispatcher that died halfway through a
      // fan-out is safe to re-run. A reused desk books no `Started:` record —
      // the run that first claimed it booked one.
      reused.push(candidate.branch);
    } else {
      if (!canCreateWorktree(candidate)) {
        skipped.push({
          branch: candidate.branch,
          reason: 'worktree-uncreatable',
          worktree: candidate.worktree,
        });
        continue;
      }
      if (!canClaim(candidate)) {
        skipped.push({ branch: candidate.branch, reason: 'claim-lost', worktree: candidate.worktree });
        continue;
      }
      // THE CLAIM, and it carries an EMPTY COMMIT. Pushing a branch that merely
      // points at `origin/<main>` is a no-op — the remote already has that
      // commit, so both dispatchers' pushes succeed and both believe they own
      // the branch. Mutual exclusion needs the refs to DIVERGE, so the loser's
      // push is rejected as non-fast-forward. That rejection is the whole lock.
      writes.push({
        kind: 'branch-create',
        branch: candidate.branch,
        base: `origin/${readings.defaultBranch}`,
        push: true,
      });
      dispatched.push(candidate.branch);
    }

    const launch = launchable(candidate, worker, input.noBrief ?? false);
    prepared.push({
      branch: candidate.branch,
      worktree: candidate.worktree,
      reused: candidate.worktreeExists,
      started: launch === '',
      notStartedBecause: launch,
    });
    if (launch === '') started += 1;
  }

  // BOOKED AFTER THE FAN-OUT, in one commit, and only for branches this run
  // NEWLY CLAIMED. A `Started:` record for a branch another dispatcher won
  // would be a lie in the file, and a re-run books nothing it merely adopted.
  if (dispatched.length > 0 && !dryRun && readings.gate) {
    for (const branch of dispatched) {
      writes.push({
        kind: 'plan-record',
        file: readings.gate.file,
        field: 'Started',
        value: branch,
      });
    }
    writes.push({
      kind: 'commit',
      message: `plot: record start of ${readings.slug}`,
      paths: [readings.gate.file],
    });
    writes.push({ kind: 'push', branch: '', onto: 'default' });
  }

  return decide('dispatch', writes, {
    slug: readings.slug,
    dispatched,
    reused,
    skipped,
    prepared,
    started,
    worker,
    dryRun,
  });
};

/**
 * Whether a branch is HELD — a desk on this disk with somebody's work at it.
 *
 * Both halves are required, because either alone is wrong. Without a worktree
 * there is no desk and nobody at it, and a local branch on its own is not a
 * hold: plenty exist for other reasons. And a worktree whose work already
 * landed is a leftover desk rather than a held one — 6 of 36 on this disk when
 * the gate was written — so refusing those would fire on exactly the branches
 * that are safe, the fastest way to teach an operator to route around a gate.
 *
 * `--allow-local` does not reach here and must never be wired to it: that flag
 * says something about reading a PHASE, and nothing whatever about whether a
 * human is mid-edit in a worktree.
 *
 * @param candidate - the branch and what this machine holds for it.
 * @returns true when a worktree holds it with unlanded work.
 */
const isHeld = (candidate: DispatchCandidate): boolean =>
  candidate.heldBy !== '' && candidate.heldWorkUnlanded;

/**
 * Whether `git worktree add` would succeed, on either of its two forms.
 *
 * The script tries the new-branch form and falls back to attaching an existing
 * local branch; only both failing is the refusal.
 *
 * @param candidate - the branch to prepare a desk for.
 * @returns true when a worktree can be created.
 */
const canCreateWorktree = (candidate: DispatchCandidate): boolean =>
  candidate.worktreeCreatable !== false;

/**
 * Whether this run's claim push would land.
 *
 * A rejection means another session won the race, and its worktree is left
 * alone — never forced. Forcing here is precisely what would let a second
 * dispatcher take a branch someone is working on.
 *
 * @param candidate - the branch being claimed.
 * @returns true when the push would be a fast-forward this run wins.
 */
const canClaim = (candidate: DispatchCandidate): boolean => candidate.claimWins !== false;

/**
 * How the summary's `worker=` field reads for this run.
 *
 * `--no-start` wins over the config and does NOT mean the config is missing: a
 * repo that has a `Worker command` and was told not to use it is reporting a
 * choice, not a gap. Conflating them is the one-label-two-states mistake.
 *
 * @param configured - how the repo answered `Worker command`.
 * @param noStart - whether this run was told to start nothing.
 * @returns the field's value.
 */
const workerConfig = (
  configured: DispatchReadings['workerCommand'],
  noStart: boolean,
): AgentCommandConfig => (noStart ? 'suppressed' : configured);

/**
 * Why a prepared branch would not get a worker, or `''` where it would.
 *
 * THE BRIEF GATE sits between preparing and starting, and that placement is
 * the rule: prepared work stands and only the launch is conditional. The
 * worker's first instruction is to read its brief, so without one it reads
 * nothing and improvises — the one thing the brief exists to prevent.
 *
 * @param candidate - the branch and whether its brief is on the shared ref.
 * @param worker - how this run may start workers at all.
 * @param noBrief - whether the operator named the escape.
 * @returns the cause, or `''` when a worker would start.
 */
const launchable = (
  candidate: DispatchCandidate,
  worker: AgentCommandConfig,
  noBrief: boolean,
): DispatchPrepared['notStartedBecause'] => {
  if (worker === 'suppressed') return 'no-start';
  if (worker === 'unconfigured') return 'worker-unconfigured';
  if (worker === 'declined') return 'worker-declined';
  if (!candidate.briefPresent && !noBrief) return 'no-brief';
  return '';
};

/**
 * The phase and ceremony gate, or nothing where it passes.
 *
 * A GATE rather than a rule: fanning out is the one place a caller can do real
 * damage — branches and worker processes for a plan nobody approved — and
 * prose in a SKILL.md is something an agent rationalises around and a direct
 * caller bypasses entirely.
 *
 * @param readings - what the gate read, and where.
 * @param input - whether the working-tree escape was named.
 * @returns the refusal, or undefined when the plan may be fanned out.
 */
const plangate = (
  readings: DispatchReadings,
  input: DispatchInput,
): Refusal<DispatchRefusal> | undefined => {
  const no = (reason: DispatchRefusal, detail: string) => refuse('dispatch', reason, detail);
  const gate = readings.gate;
  const allowLocal = input.allowLocal ?? false;
  const slug = readings.slug;

  if (!gate) {
    return no(
      'plan-not-found',
      `no plan read for '${slug}' — the gate must run before anything is dispatched.`,
    );
  }

  // FAIL CLOSED. There is deliberately no fallback to the working tree: that
  // would reintroduce the bug exactly where nothing can catch it.
  if (!gate.refResolved && !allowLocal) {
    return no(
      'ref-unreadable',
      `cannot resolve 'origin/${readings.defaultBranch}' — refusing to dispatch. An approval only you can see cannot open this gate; fetch, or pass --allow-local.`,
    );
  }

  if (gate.file === '') {
    return no(
      'plan-not-found',
      allowLocal
        ? `no plan found for '${slug}'.`
        : `no plan for '${slug}' on the shared ref — a plan that exists only in this working tree has not been shared yet.`,
    );
  }

  if (!gate.parsed) {
    return no(
      'plan-unreadable',
      `could not read '${gate.source}' — refusing to dispatch rather than falling back to the working tree.`,
    );
  }

  switch (gate.phase) {
    case 'approved':
      break;
    case 'draft':
      return no(
        'phase-draft',
        `plan '${slug}' is still Draft on ${gate.source} — nothing may be dispatched. If you approved it locally, push that approval.`,
      );
    case 'delivered':
    case 'released':
      return no('phase-terminal', `plan '${slug}' is already ${gate.phase} — its work is done.`);
    case 'NONE':
    case '':
      return no(
        'phase-unreadable',
        `cannot read the phase of '${slug}' (${gate.source}). Refusing rather than guessing — dispatching starts real work.`,
      );
    default:
      return no('phase-wrong', `plan '${slug}' is in phase '${gate.phase}', not Approved.`);
  }

  // NONE is a pre-Plot-2 plan that never recorded an answer — allowed, since
  // those predate the question.
  switch (gate.impl) {
    case 'own-branches':
    case 'NONE':
    case '':
      return undefined;
    case 'same-branch':
      return no(
        'impl-same-branch',
        `plan '${slug}' records 'Impl: same branch' — plan and code travel on one branch, so there is nothing to fan out.`,
      );
    case 'other-repo':
      return no(
        'impl-other-repo',
        `plan '${slug}' records 'Impl: other repo' — dispatch from the implementation repo instead.`,
      );
    case 'none':
      return no('impl-none', `plan '${slug}' records 'Impl: none' — knowledge-only work.`);
    default:
      return no(
        'impl-unrecognised',
        `plan '${slug}' records an unrecognised 'Impl:' answer ('${gate.impl}'). Refusing rather than guessing.`,
      );
  }
};

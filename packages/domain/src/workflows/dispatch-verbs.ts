import { type Outcome, type Write, decide, refuse } from './decision.js';
import type { WorkerState } from '../entities/fleet.js';
import type { DispatchRefusal } from './dispatch.js';

/**
 * The three verbs that run BEFORE the phase gate, and why they must.
 *
 * `--stop`, `--restart` and `--migrate` all act on work that is already in
 * flight. A branch that is already claimed and already has a worktree is
 * somebody's desk, and the plan's phase says nothing about whether a stopped
 * worker on it should be replaced or a finished checkout moved. Refusing on
 * phase would strand exactly the branches these exist to rescue.
 *
 * They are expressed apart from `dispatch` for the same reason they sit apart
 * in the script: each reads a different thing. A fan-out reads a plan and a
 * fleet; these read one worktree, or every worktree, and nothing else.
 */

/** What was measured of one worktree, for the verbs that act on one. */
export interface WorktreeReading {
  /** The branch it holds. */
  branch: string;
  /**
   * The worktree git says holds that branch, or `''` when none does.
   *
   * ASKED OF GIT, never rebuilt from the branch name. This file's own rule:
   * path-guessing is confined to CREATION, because a second naming convention
   * gives it a second way to be wrong — and it matters most here, where the
   * population includes the worktree a person made by hand when the tool had
   * no verb for them.
   */
  path: string;
  /** The worker's state, from the one shared classifier. */
  state: WorkerState;
  /** The live worker's pid, or `''` where none is. */
  pid: string;
  /** The `PLOT-BLOCKED*` file waiting on a person, or `''` where none is. */
  blockedMarker: string;
  /** Whether the tree holds uncommitted work, by the shared filter. */
  dirty: boolean;
}

/** What the host answered about a branch's pull requests. */
export interface BranchPrReading {
  /**
   * Whether ANY PR for the branch exists, open or merged.
   *
   * ASKED FIRST, before the state word, and that ordering is a measurement
   * rather than a preference: five of five `failed` worktrees in this estate
   * held a PR — four open, one already merged. `plot-worker-state.sh` refines
   * `finished` by the tree but deliberately does NOT refine `failed`, because a
   * recorded non-zero exit is a specific answer about the PROCESS — and silent
   * about the WORK. A gate on the state word alone restarts all five and
   * discards exactly what the `finished` refusal protects.
   */
  reachedReview: boolean;
  /** The PR's number, 0 where none. */
  number: number;
  /** The state as the host reports it. */
  state: string;
}

/** What `--stop` reads. */
export interface StopReadings {
  /** The branch named on the command line; `''` where none was. */
  branch: string;
  /** The worktree and worker, or null where no worktree holds the branch. */
  tree: WorktreeReading | null;
}

/** What stopping decided. */
export interface StopDetail {
  /** The branch. */
  branch: string;
  /** The pid that would be signalled, or `''` where nothing is running. */
  pid: string;
  /** The state that was found. */
  state: WorkerState;
  /** Whether a signal would actually be sent. */
  signalling: boolean;
}

/**
 * Decides whether stopping a branch's worker would signal anything.
 *
 * An explicit branch is REQUIRED and there is no "all": a `--stop` that could
 * mean everything is one fat-finger away from killing a whole fleet.
 *
 * A branch with no running worker is a DECISION WITH NO WRITES rather than a
 * refusal — the operator asked for it to be stopped and it is stopped, which
 * is the answer they wanted. The worktree and its claim are left in place
 * either way: the branch is still taken, and deleting either would be a write
 * this design avoids.
 *
 * @param readings - the branch and what was measured of its desk.
 * @returns a decision naming the signal, or `branch-missing` / `no-worktree`.
 */
export const stopWorker = (
  readings: StopReadings,
): Outcome<StopDetail, DispatchRefusal> => {
  const no = (reason: DispatchRefusal, detail: string) => refuse('dispatch', reason, detail);

  if (readings.branch === '') {
    return no(
      'branch-missing',
      'plot-dispatch: --stop needs a branch name. Refusing to guess — stopping the wrong worker discards its work.',
    );
  }
  if (readings.tree === null) {
    return no('no-worktree', `plot-dispatch: no worktree for '${readings.branch}'.`);
  }

  const { state, pid } = readings.tree;
  const signalling = state === 'running';
  return decide(
    'dispatch',
    signalling ? [{ kind: 'worker-signal', pid, branch: readings.branch }] : [],
    { branch: readings.branch, pid: signalling ? pid : '', state, signalling },
  );
};

/** What `--restart` reads. */
export interface RestartReadings {
  /** The branch named on the command line; `''` where none was. */
  branch: string;
  /** The worktree and worker, or null where no worktree holds the branch. */
  tree: WorktreeReading | null;
  /** What the host said about the branch's PRs. */
  pr: BranchPrReading;
}

/** What restarting decided. */
export interface RestartDetail {
  /** The branch handed to a new worker. */
  branch: string;
  /** The worktree it inherits, exactly as it stands. */
  worktree: string;
  /** The state the old worker left behind. */
  state: WorkerState;
  /**
   * Whether the inherited tree holds uncommitted work.
   *
   * Reported rather than acted on. A `stalled` worktree holds uncommitted work
   * — that is what `stalled` MEANS, and a measured stall in this repo left 324
   * finished lines on the floor. Nothing here cleans, resets or stashes: a
   * restart that discards that is worse than the missing affordance, because it
   * looks like a supported operation.
   */
  inheritsUncommitted: boolean;
}

/**
 * Decides whether a claimed branch may be handed to a new worker.
 *
 * The counterpart to `--stop`, and the only way to hand a stopped branch to a
 * new worker through Plot: `--next` fills its offer only where a branch is
 * `open` — meaning NO REF EXISTS — so a branch that has ever been claimed was
 * never offered, and a slug dispatch answered `dispatched=0`. That is an empty
 * set rather than a refusal with a reason, and it has nothing to say about
 * what it filtered out. So this is a SECOND QUESTION, asked only when a person
 * asks it, and the branch is never auto-selected.
 *
 * `stalled`, `failed`, `ended` and `none` all restart. Including `failed` is
 * the point rather than an oversight: a gate that simply refused it would pass
 * every refusal test here and leave the verb unable to do the one thing it
 * exists for. The PR question above is what makes that safe.
 *
 * There is no `--force`. A flag overriding the live-worker refusal is the flag
 * typed reflexively, and what it would override is another agent's work in
 * progress.
 *
 * @param readings - the branch, its desk and its PRs.
 * @returns a decision naming the launch, or `branch-missing`, `no-worktree`,
 *   `reached-review`, `worker-alive` or `blocked-marker`.
 */
export const restartWorker = (
  readings: RestartReadings,
): Outcome<RestartDetail, DispatchRefusal> => {
  const no = (reason: DispatchRefusal, detail: string) => refuse('dispatch', reason, detail);

  if (readings.branch === '') {
    return no(
      'branch-missing',
      'plot-dispatch: --restart needs a branch name. A slug is not enough: which stopped branch to hand to a new worker is your call.',
    );
  }
  if (readings.tree === null) {
    return no(
      'no-worktree',
      `plot-dispatch: no worktree holds '${readings.branch}' — --restart hands an EXISTING checkout to a new worker; it creates none.`,
    );
  }

  // THE PR IS ASKED FIRST, BEFORE THE STATE WORD.
  if (readings.pr.reachedReview) {
    return no(
      'reached-review',
      `plot-dispatch: ${readings.branch} has a pull request (#${readings.pr.number}, ${readings.pr.state}) — the work reached review, whatever the worker's exit code says.`,
    );
  }

  const { state, pid, path, blockedMarker, dirty } = readings.tree;
  if (state === 'running') {
    return no(
      'worker-alive',
      `plot-dispatch: a worker is alive on ${readings.branch} (pid ${pid}) — stop it first if you mean to replace it.`,
    );
  }
  if (state === 'waiting') {
    // A person owes this branch an answer. A new worker meets the same
    // question and writes the same marker.
    return no(
      'blocked-marker',
      `plot-dispatch: ${readings.branch} is blocked on a question — the question is in ${path}/${blockedMarker}. Answer it and delete the marker, then restart.`,
    );
  }

  // Started through the ORDINARY DISPATCH PATH, so the manifest is written by
  // one writer. A restart that spawned a worker without one would reproduce the
  // exact defect it exists to prevent: an unregistered agent, showing a branch
  // name where the board expects an agent name.
  return decide('dispatch', [{ kind: 'worker-start', branch: readings.branch, worktree: path }], {
    branch: readings.branch,
    worktree: path,
    state,
    inheritsUncommitted: dirty,
  });
};

/** One legacy worktree `--migrate` considered. */
export interface MigrationCandidate {
  /** What was measured of it. */
  tree: WorktreeReading;
  /**
   * Whether it holds commits its own upstream does not.
   *
   * Only the branch's OWN upstream answers *pushed?*; an absent upstream leaves
   * the question unanswerable, and an unanswered question is not a refusal —
   * counting against the default branch marked every clean branch stalled in a
   * remote-less repo. So `false` is the honest reading for no upstream, and it
   * falls through to movable.
   */
  unpushedCommits: boolean;
}

/** What `--migrate` reads. */
export interface MigrateReadings {
  /** The configured `Worktree root:`, resolved absolute; `''` where none is set. */
  configuredRoot: string;
  /** Where legacy worktrees live today — beside the repo. */
  legacyRoot: string;
  /** Every legacy worktree found, in the order they were listed. */
  candidates: readonly MigrationCandidate[];
}

/** What `--migrate` was asked to do. */
export interface MigrateInput {
  /** Actually move them; the default is a dry run. */
  yes?: boolean;
  /** Move at most this many; 0 for no bound. */
  max?: number;
}

/** Why one worktree stays where it is. */
export type MigrateKeptReason =
  | 'worker-alive'
  | 'blocked-marker'
  | 'uncommitted'
  | 'unpushed-commits'
  | 'max-reached';

/** One worktree this run would not move, and why. */
export interface MigrateKept {
  /** Its current path. */
  path: string;
  /** Which rule fired. */
  reason: MigrateKeptReason;
}

/** One worktree this run would move, and where to. */
export interface MigrateMove {
  /** Its current path. */
  from: string;
  /** Where it would go. */
  to: string;
}

/** What a migration decided. */
export interface MigrateDetail {
  /** The moves, in order. */
  moving: readonly MigrateMove[];
  /** Every worktree kept where it is, with the reason. */
  kept: readonly MigrateKept[];
  /** Whether this run writes nothing by construction. */
  dryRun: boolean;
}

/**
 * Decides which legacy worktrees would move into the configured root.
 *
 * THE REFUSALS ARE THE FEATURE. `git worktree move` on a checkout an agent is
 * writing to breaks it mid-run, so a worktree moves only with NO LIVE WORKER
 * AND NO UNLANDED WORK — two independent measurements, exactly as in
 * `plot-reap.sh`. Folding them into one verdict is a hole: the worker state is
 * keyed on the worker RECORDS, so a hand-made worktree that never ran a Plot
 * worker reads `none` however dirty its tree is, and the hand-made worktrees
 * are precisely the estate this verb exists to tidy.
 *
 * A MIXED ESTATE IS AN ORDINARY STATE, not a transition to complete. Every
 * read asks git, so worktrees left behind keep working; a repo that adopts
 * `Worktree root:` and never migrates is correctly configured. That is why a
 * worktree this refuses is not an error.
 *
 * @param readings - the roots and the legacy worktrees found.
 * @param input - whether to move, and any bound.
 * @returns a decision naming every move, or `root-unconfigured` /
 *   `root-is-legacy` where there is nowhere to move to.
 */
export const migrateWorktrees = (
  readings: MigrateReadings,
  input: MigrateInput = {},
): Outcome<MigrateDetail, DispatchRefusal> => {
  const no = (reason: DispatchRefusal, detail: string) => refuse('dispatch', reason, detail);

  if (readings.configuredRoot === '') {
    return no(
      'root-unconfigured',
      "no 'Worktree root:' configured — nothing to migrate. Without one there is no destination.",
    );
  }
  if (readings.configuredRoot === readings.legacyRoot) {
    return no(
      'root-is-legacy',
      `target root matches legacy root (${readings.legacyRoot}) — the worktrees are already in the right place.`,
    );
  }

  const max = input.max ?? 0;
  const dryRun = !(input.yes ?? false);
  const moving: MigrateMove[] = [];
  const kept: MigrateKept[] = [];
  const writes: Write[] = [];

  for (const { tree, unpushedCommits } of readings.candidates) {
    if (max > 0 && moving.length >= max) {
      kept.push({ path: tree.path, reason: 'max-reached' });
      continue;
    }

    const reason = migrationRefusal(tree, unpushedCommits);
    if (reason) {
      kept.push({ path: tree.path, reason });
      continue;
    }

    // The destination flattens the branch name and drops the legacy prefix:
    // under a dedicated root the directory already says what it is, so the
    // prefix answers a question nobody is asking.
    const to = `${readings.configuredRoot}/${tree.branch.replace(/\//g, '-')}`;
    moving.push({ from: tree.path, to });
    if (!dryRun) writes.push({ kind: 'worktree-move', from: tree.path, to });
  }

  return decide('dispatch', writes, { moving, kept, dryRun });
};

/**
 * Why one worktree may not be moved, or undefined where it may.
 *
 * Ordered as the script asks: liveness first, because it is the only signal
 * describing someone acting right now, then the two shapes of unlanded work.
 *
 * @param tree - what was measured of the worktree.
 * @param unpushedCommits - whether it holds commits its upstream does not.
 * @returns the reason it stays, or undefined.
 */
const migrationRefusal = (
  tree: WorktreeReading,
  unpushedCommits: boolean,
): MigrateKeptReason | undefined => {
  if (tree.state === 'running') return 'worker-alive';
  if (tree.state === 'waiting') return 'blocked-marker';
  if (tree.dirty) return 'uncommitted';
  if (unpushedCommits) return 'unpushed-commits';
  return undefined;
};

import {
  type ClaimRefReadings,
  type DirtyTreeReadings,
  type LeftoverKind,
  type LocalBranchReadings,
  dirtyTreeOwner,
  firstBranchRefusal,
  firstClaimRefusal,
  isUnownedDirtyTree,
} from '../rules/sweepable.js';
import { type Decision, type Refusal, decide, refuse } from './decision.js';
import { type ReapReadings, reap } from './reap.js';

/**
 * What a reconcile was asked about.
 *
 * A SCOPE IS NOT A FILTER OVER ONE OUTPUT. A plan-scoped reconcile can afford
 * to ask the host about that plan's PRs; an estate-scoped one cannot ask 253
 * times, which is why the sweep bundles a single `pr-list`. The scope changes
 * what is cheap to read, so it is an input to the rule rather than a `grep`
 * after it — the same placement `proposeStack` gave the thresholds
 * `plot-detect-repo.sh` used to hold.
 */
export type ReconcileScope =
  | { readonly kind: 'plan'; readonly slug: string }
  | { readonly kind: 'sprint'; readonly slug: string }
  | { readonly kind: 'workspace' };

/**
 * What kind of drift a finding is about.
 *
 * {@link LeftoverKind}'s three kinds are carried through unchanged rather than
 * respelled: `sweepable.ts` already answers `local-branch`, `claim-ref` and
 * `dirty-tree` with their own refusals, and a fourth copy of those conditions
 * is the drift this workflow exists to report. The kinds added here are the
 * ones no existing rule names.
 *
 * `worktree` is added deliberately, and it is the one kind `sweepable.ts`
 * excludes by name: that file leaves the population to `reapable.ts` because
 * *a backstop that guesses is worse than none*. Nothing guesses here — the
 * verdict comes from {@link reap}, which holds the five refusals, and this
 * workflow reports what that rule decided without re-deciding it.
 */
export type DriftKind =
  | LeftoverKind
  | 'worktree'
  | 'phase-symlink-drift'
  | 'merged-not-delivered'
  | 'concurrent-delivery'
  | 'needs-attention'
  | 'delivered-not-released'
  | 'sprint-tally-stale'
  | 'sprint-outlived-release';

/**
 * One thing that has drifted, and what repairs it.
 *
 * NAMED, NEVER RUN. The `repair` is the exact command an operator would type,
 * carried as text because this workflow performs nothing — the judgement of
 * whether a branch is still relevant, or a plan should be delivered rather
 * than rejected, stays with the person reading it.
 */
export interface DriftFinding {
  /** What kind of drift this is. */
  readonly kind: DriftKind;
  /** What drifted — the plan slug, the branch, the ref, or the desk path. */
  readonly subject: string;
  /** The measurement behind it, for a person deciding what to do. */
  readonly evidence: string;
  /**
   * The command that repairs it, or `''` where only a person can.
   *
   * Empty is a stated answer rather than a gap: a desk holding uncommitted work
   * has no command that resolves it safely, and printing one would invite the
   * removal the finding exists to prevent.
   */
  readonly repair: string;
  /**
   * Whether this finding stops a delivery.
   *
   * Carried as a PROPERTY rather than derived from a section number by the
   * caller. `plot-reconcile-scan.sh` prints an `== blocking sections end ==`
   * marker for the same reason: its gate once read *to section 7*, meaning
   * *the first non-blocking section*, and the scan has been renumbered twice
   * since. Each time the agreement held only because somebody noticed.
   */
  readonly blocking: boolean;
}

/** What the shell measured about one plan, for a plan- or sprint-scoped run. */
export interface PlanDrift {
  /** The plan's slug. */
  readonly slug: string;
  /** Whether the plan's phase and its index symlink disagree. */
  readonly phaseSymlinkDrift: boolean;
  /** Whether every branch the plan names has merged while the plan is not Delivered. */
  readonly mergedNotDelivered: boolean;
  /** Whether the plan is Delivered while a sibling plan is mid-delivery. */
  readonly concurrentDelivery: boolean;
  /** What could not be parsed or resolved, or `''` when the plan reads cleanly. */
  readonly attention: string;
  /** Whether the plan is Delivered and its release has already been tagged. */
  readonly deliveredNotReleased: boolean;
}

/** What the shell measured about one sprint, beyond its member plans. */
export interface SprintDrift {
  /** The sprint's slug. */
  readonly slug: string;
  /** The slugs of the plans the sprint names. */
  readonly members: readonly string[];
  /**
   * Items still unchecked whose plan is Delivered or Released.
   *
   * The sprint's own drift and not any member's: the plan landed correctly and
   * nobody re-ticked the box, so no plan-scoped run can report it.
   */
  readonly staleTally: readonly string[];
  /** The sprint's declared release, when it is tagged and the sprint is not Closed. */
  readonly shippedRelease: string;
}

/** What `reconcile` reads about the estate. */
export interface ReconcileReadings {
  /** What was measured of every plan in scope. */
  readonly plans: readonly PlanDrift[];
  /** What was measured of every sprint in scope. */
  readonly sprints: readonly SprintDrift[];
  /** Every local branch considered, with what was measured of each. */
  readonly branches: readonly LocalBranchReadings[];
  /** Every orphaned claim ref considered. */
  readonly claims: readonly ClaimRefReadings[];
  /** Every worktree considered, dirty or not. */
  readonly trees: readonly DirtyTreeReadings[];
  /**
   * The desks, as {@link reap} reads them.
   *
   * Passed through untouched so one condition set serves two blast radii:
   * `/plot-reap --yes` performs the writes this workflow discards.
   */
  readonly desks: ReapReadings;
}

/** What a reconcile decided. */
export interface ReconcileDetail {
  /** The scope it answered for. */
  readonly scope: ReconcileScope;
  /** Everything that has drifted, blocking findings first. */
  readonly findings: readonly DriftFinding[];
  /**
   * How many findings stop a delivery.
   *
   * Counted here rather than by the caller, so a gate reading *only an empty
   * result clears it* asks one field instead of re-deriving the blocking set.
   */
  readonly blocking: number;
}

/** Why a reconcile refused. */
export type ReconcileRefusal = 'no-such-plan' | 'no-such-sprint';

/**
 * A scope that named something the readings do not hold.
 *
 * It carries the SLUG it failed on, because only the branch that failed still
 * knows it: a workspace scope has no slug and can never be refused, so a caller
 * re-deriving one downstream needs an arm for a case that cannot happen.
 */
interface Unresolved {
  /** The rule that fired. */
  readonly reason: ReconcileRefusal;
  /** Which kind of scope it was. */
  readonly kind: 'plan' | 'sprint';
  /** The name nothing answered to. */
  readonly slug: string;
}

/**
 * Resolves a scope against the readings, or names why it cannot be.
 *
 * THE SPRINT IS RETURNED RATHER THAN RE-FOUND. Looking it up here and again in
 * the body would be two answers to one question, and the second lookup would
 * need a `!== undefined` guard for a case this function has already excluded —
 * an unreachable branch that no test can honestly cover.
 *
 * @param scope - what the caller asked about.
 * @param readings - what the shell measured.
 * @returns the refusal, the resolved sprint, or `null` for a scope that needs
 *   no resolving.
 */
const resolveScope = (
  scope: ReconcileScope,
  readings: ReconcileReadings,
): Unresolved | SprintDrift | null => {
  if (scope.kind === 'plan') {
    return readings.plans.some((p) => p.slug === scope.slug)
      ? null
      : { reason: 'no-such-plan', kind: 'plan', slug: scope.slug };
  }
  if (scope.kind === 'sprint') {
    return (
      readings.sprints.find((s) => s.slug === scope.slug) ?? {
        reason: 'no-such-sprint',
        kind: 'sprint',
        slug: scope.slug,
      }
    );
  }
  return null;
};

/**
 * The plans one scope asks about.
 *
 * @param scope - what the caller asked about.
 * @param readings - what the shell measured.
 * @param sprint - the sprint a sprint scope resolved to, or `null`.
 * @returns the plans in scope, in the order they were read.
 */
const plansInScope = (
  scope: ReconcileScope,
  readings: ReconcileReadings,
  sprint: SprintDrift | null,
): readonly PlanDrift[] => {
  if (scope.kind === 'plan') {
    return readings.plans.filter((p) => p.slug === scope.slug);
  }
  if (sprint !== null) {
    const members = new Set(sprint.members);
    return readings.plans.filter((p) => members.has(p.slug));
  }
  return readings.plans;
};

/**
 * What has drifted about one plan.
 *
 * @param plan - what the shell measured of it.
 * @returns its findings, blocking ones in the scan's own order.
 */
const planFindings = (plan: PlanDrift): DriftFinding[] => {
  const findings: DriftFinding[] = [];
  if (plan.phaseSymlinkDrift) {
    findings.push({
      kind: 'phase-symlink-drift',
      subject: plan.slug,
      evidence: 'the plan phase and the index symlink disagree',
      repair: `/plot-reconcile --plan ${plan.slug}`,
      blocking: true,
    });
  }
  if (plan.mergedNotDelivered) {
    findings.push({
      kind: 'merged-not-delivered',
      subject: plan.slug,
      evidence: 'every branch merged while the plan is not Delivered',
      repair: `/plot-deliver ${plan.slug}`,
      blocking: true,
    });
  }
  if (plan.concurrentDelivery) {
    findings.push({
      kind: 'concurrent-delivery',
      subject: plan.slug,
      evidence: 'another plan is mid-delivery',
      repair: '',
      blocking: true,
    });
  }
  if (plan.attention !== '') {
    findings.push({
      kind: 'needs-attention',
      subject: plan.slug,
      evidence: plan.attention,
      repair: '',
      blocking: true,
    });
  }
  if (plan.deliveredNotReleased) {
    findings.push({
      kind: 'delivered-not-released',
      subject: plan.slug,
      evidence: 'the plan is Delivered and its release is tagged',
      repair: `/plot-release ${plan.slug}`,
      blocking: true,
    });
  }
  return findings;
};

/**
 * What has drifted about one sprint, beyond its member plans.
 *
 * THE UNION IS NECESSARY AND NOT SUFFICIENT. A sprint holds two facts no member
 * plan holds: an unchecked item whose plan is Delivered — the plan landed
 * correctly and nobody re-ticked the box — and a `Release:` already tagged
 * while the sprint is not Closed. Neither is reachable from a plan scope,
 * which is what makes the sprint scope a scope rather than a filter.
 *
 * @param sprint - what the shell measured of it.
 * @returns its own findings, which never block a delivery.
 */
const sprintFindings = (sprint: SprintDrift): DriftFinding[] => {
  const findings: DriftFinding[] = [];
  for (const item of sprint.staleTally) {
    findings.push({
      kind: 'sprint-tally-stale',
      subject: sprint.slug,
      evidence: `unchecked item over a delivered plan: ${item}`,
      repair: '',
      blocking: false,
    });
  }
  if (sprint.shippedRelease !== '') {
    findings.push({
      kind: 'sprint-outlived-release',
      subject: sprint.slug,
      evidence: `${sprint.shippedRelease} is tagged and the sprint is not Closed`,
      repair: '',
      blocking: false,
    });
  }
  return findings;
};

/**
 * The kept-reasons a person must resolve, as opposed to simply waiting out.
 *
 * NOT EVERY REFUSAL IS DRIFT, and reporting all five would bury the two that
 * matter. `live-worker` is somebody working right now. `no-merged-pr` is a desk
 * that is merely unfinished — which is every active branch on the estate, so
 * reporting it would make the sweep's output grow with the fleet's health
 * rather than with its problems.
 *
 * The three here each describe work that goes nowhere without a person:
 * `uncommitted-changes` is work that exists nowhere else (`plot-reap.sh:77`),
 * measured twice on 2026-09-09 — one desk held 75 finished lines of tests and
 * another 324, and both were rescued only because a person read the tree.
 * `blocked-marker` is an agent that stopped to ask something. `on-default-branch`
 * is a desk whose dispatched branch was never checked out, so nothing about its
 * state was ever measured.
 */
const NEEDS_A_PERSON: ReadonlySet<string> = new Set([
  'uncommitted-changes',
  'blocked-marker',
  'on-default-branch',
]);

/**
 * What has drifted about the desks, as {@link reap} judges them.
 *
 * THE CONDITIONS COME FROM `reap()` AND THE WRITES ARE DISCARDED. That is
 * deliberate rather than wasteful: one condition set serves two blast radii.
 * `/plot-reap --yes` performs the writes; this reports what they would have
 * been, which is what lets a reconcile sweep the whole estate while the reaper
 * stays per-invocation.
 *
 * A DESK A LIVE WORKER SITS AT IS NOT REPORTED AT ALL — a finding an operator
 * cannot act on is noise — and a desk holding uncommitted work is reported with
 * NO repair command, because that is the shape that strands finished code.
 *
 * @param readings - the desks, as the reaper reads them.
 * @returns one finding per desk whose work has landed or whose tree needs a person.
 */
const deskFindings = (readings: ReapReadings): DriftFinding[] => {
  const decision = reap(readings);
  const findings: DriftFinding[] = [];
  for (const path of decision.detail.reaping) {
    findings.push({
      kind: 'worktree',
      subject: path,
      evidence: 'the desk is finished — its PR merged and nothing runs in it',
      repair: `git worktree remove ${path}`,
      blocking: false,
    });
  }
  for (const kept of decision.detail.kept) {
    if (!NEEDS_A_PERSON.has(kept.reason)) continue;
    findings.push({
      kind: 'worktree',
      subject: kept.path,
      evidence: `needs a person: ${kept.reason}`,
      repair: '',
      blocking: false,
    });
  }
  return findings;
};

/**
 * What has drifted about the branches, claims and trees the sweep reads.
 *
 * Every verdict comes from `sweepable.ts` rather than a second copy: the
 * refusals it names are the ones that keep a squash-merged branch and a
 * checked-out one apart, and re-deriving them here is the drift this workflow
 * reports about everything else.
 *
 * @param readings - what the shell measured.
 * @returns the leftover findings, in the order they were read.
 */
const leftoverFindings = (readings: ReconcileReadings): DriftFinding[] => {
  const findings: DriftFinding[] = [];
  for (const branch of readings.branches) {
    const refusal = firstBranchRefusal(branch);
    if (refusal === null) {
      findings.push({
        kind: 'local-branch',
        subject: branch.branch,
        evidence: 'merged on the host and held by no worktree',
        repair: `git branch -D ${branch.branch}`,
        blocking: false,
      });
    }
  }
  for (const claim of readings.claims) {
    if (firstClaimRefusal(claim) === null) {
      findings.push({
        kind: 'claim-ref',
        subject: claim.branch,
        evidence: 'an empty claim its plan already gave up',
        repair: `git push origin --delete ${claim.branch}`,
        blocking: false,
      });
    }
  }
  for (const tree of readings.trees) {
    if (isUnownedDirtyTree(tree)) {
      findings.push({
        kind: 'dirty-tree',
        subject: tree.path,
        evidence: `${tree.dirtyCount} uncommitted paths, owned by ${dirtyTreeOwner(tree)}`,
        repair: '',
        blocking: false,
      });
    }
  }
  return findings;
};

/**
 * Reports what has drifted, at one scope, and repairs nothing.
 *
 * The tenth lifecycle action to become a controller endpoint, and the one that
 * decides least: it composes {@link reap} and `rules/sweepable.ts` and
 * contributes no condition of its own. What it adds is the SCOPE and the
 * composition — one question, one answer, three scopes.
 *
 * IT PERFORMS NOTHING, AND THERE IS NO `--yes` AT ANY SCOPE. The decision
 * always carries an empty write list. A gated apply was considered and refused:
 * the value of a sweep an operator runs casually is that running it cannot cost
 * anything, and a flag that *sometimes* acts turns every invocation into a
 * decision. Acting stays with the tools that own each repair — `/plot-reap
 * --yes`, `/plot-deliver`, `/plot-reslice` — each of which the findings name.
 *
 * A SCOPE NAMING SOMETHING THAT DOES NOT EXIST IS REFUSED. An empty finding
 * list reads as *nothing has drifted*, which is the one direction a drift
 * report must never be lenient in.
 *
 * @param readings - what the shell measured, at the scope it was asked for.
 * @param scope - the plan, the sprint, or the whole workspace.
 * @returns the findings, or the refusal naming a scope nothing answers.
 */
export const reconcile = (
  readings: ReconcileReadings,
  scope: ReconcileScope,
): Decision<ReconcileDetail> | Refusal<ReconcileRefusal> => {
  const resolved = resolveScope(scope, readings);
  if (resolved !== null && 'reason' in resolved) {
    return refuse(
      'reconcile',
      resolved.reason,
      `no ${resolved.kind} named '${resolved.slug}' was read — an empty result would read as nothing has drifted`,
    );
  }

  const findings: DriftFinding[] = [];
  for (const plan of plansInScope(scope, readings, resolved)) {
    findings.push(...planFindings(plan));
  }
  if (resolved !== null) {
    findings.push(...sprintFindings(resolved));
  }
  if (scope.kind === 'workspace') {
    for (const sprint of readings.sprints) findings.push(...sprintFindings(sprint));
    findings.push(...leftoverFindings(readings));
    findings.push(...deskFindings(readings.desks));
  }

  const ordered = [
    ...findings.filter((f) => f.blocking),
    ...findings.filter((f) => !f.blocking),
  ];
  // No writes, at any scope. The empty list IS the property: a decision that
  // carried one would be a different tool with a different blast radius.
  return decide('reconcile', [], {
    scope,
    findings: ordered,
    blocking: ordered.filter((f) => f.blocking).length,
  });
};

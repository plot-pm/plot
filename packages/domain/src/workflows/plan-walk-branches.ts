import { mergeSubjectForms } from '../adapters/host/merge-subjects.js';
import type { Pr } from '../entities/pr.js';
import { answered, failed, type PortResult } from '../port-result.js';
import type { Host } from '../ports/host.js';
import type { Containment, Refs } from '../ports/refs.js';
import {
  namedSlices,
  type BranchReadings,
  type HostReach,
  type PrReading,
  type WaitsReading,
} from '../rules/branch-state.js';
import { realCommits } from '../rules/empty-claim.js';
import { encodeListingKey, type CarriedPrStates } from '../rules/scan-listing.js';
import { mergeDetectOf, mergedBySubject, type MergeDetect } from '../rules/merge-subject.js';
import { ownerOfRemote } from '../rules/remote-owner.js';
import type { Estate } from './plan-walk-estate.js';

/** The plan phases whose branches the stage does not read. */
const SKIPPED_PHASES: ReadonlySet<string> = new Set(['released', 'rejected', 'superseded']);

/** How many merge commits the subject lookup walks, as the shell scan caps it. */
const MERGE_WALK = 20000;

/** How many pull requests the host list asks for, as the shell scan caps it. */
const PR_LIST_LIMIT = 1000;

/** How many changed paths one branch reports. */
const CHANGED_PATHS_CAP = 40;

/** The wordings a host CLI uses when it has no identity: the question was never put. */
const UNASKED_PATTERNS: readonly RegExp[] = [
  /token/i,
  /auth/i,
  /login/i,
  /credential/i,
  /not logged/i,
  /no git remotes?/i,
];

/** What the branch stage is asked. */
export interface BranchStageInput {
  /** The default branch's name, such as `main`. */
  mainBranch: string;
  /** The plan directory, such as `docs/plans/`. */
  planDir: string;
  /**
   * The PR listing the caller already holds. Where present, the stage calls
   * no `Host.prList`: `listed` answers each branch from `states`, and
   * `unread` reads every PR as `unreadable`, with `hostReach` `failed`, or `unasked` where `said` names a host that could not be asked. Where
   * absent, the stage asks the host for its list.
   */
  prs?: BranchStagePrs;
  /**
   * Whether the caller runs `--loose`: the stage then asks the host for the
   * rich list and records each branch's {@link PrDetail}.
   */
  loose?: boolean;
  /**
   * Called once per live plan, in plan order, as soon as that plan's branches
   * are read and before the next plan's are. The walk fails if the call throws.
   */
  onPlan?: (plan: string, branches: readonly BranchReading[]) => Promise<void> | void;
}

/**
 * What the host's list said about one branch's PR, for the `--loose` readiness
 * question: a row with its state, check rollup and draft flag, or the reason
 * no row could be read.
 */
export type PrDetail =
  | 'no-host'
  | 'no-cache'
  | 'none'
  | { state: 'OPEN' | 'MERGED' | 'CLOSED'; checks: string; draft: boolean };

/** A PR listing handed to the branch stage instead of a host call. */
export type BranchStagePrs =
  | { kind: 'listed'; listing: CarriedPrStates }
  | { kind: 'unread'; said?: string };

/** One branch of one plan, with every reading the branch rule takes. */
export interface BranchReading {
  /** The plan file the branch line sits in. */
  plan: string;
  /** The branch as the plan names it. */
  branch: string;
  /** The readings `branchState` takes. */
  readings: BranchReadings;
  /**
   * The commits the slice line names as its completion, each with whether the
   * default branch contains it. Empty where the line names none.
   */
  landed: ReadonlyArray<{ commit: string; contained: Containment }>;
  /**
   * The paths the branch changed against the default branch, at most
   * {@link CHANGED_PATHS_CAP}. Empty for a branch with no ref or no commit
   * ahead.
   */
  changedPaths: readonly string[];
  /** The PR row the list held for the branch; present only under `input.loose`. */
  prDetail?: PrDetail;
}

/** What the branch stage reads: one entry per branch line of every live plan. */
export interface BranchStageReadings {
  /** The default branch's commit the stage read at; the estate's. */
  mainSha: string;
  /** The host's backend word, or `''` where it could not be read. */
  backend: string;
  /** The `origin` URL, or `''` where it could not be read. */
  origin: string;
  /** How far the PR list reached; every branch's `hostReach` carries the same word. */
  hostReach: HostReach;
  /** The merge commits the subject lookup walked, newest first. */
  merges: ReadonlyArray<{ sha: string; subject: string }>;
  /** Each plan file to the commit that first added it, for the plans that have one. */
  added: ReadonlyMap<string, string>;
  /** One entry per branch line, in plan order and then slice order. */
  branches: readonly BranchReading[];
}

/**
 * Classifies a failed host list call into the reach the branch rule takes.
 *
 * @param kind - the refusal's kind, or `null` where the host named none.
 * @param said - what the connector said.
 * @returns the reach.
 */
const reachOfRefusal = (kind: 'throttled' | 'secondary' | 'failed' | null, said: string): HostReach => {
  if (kind === 'throttled' || kind === 'secondary') return kind;
  return UNASKED_PATTERNS.some((pattern) => pattern.test(said)) ? 'unasked' : 'failed';
};

/** The rank of a PR state when several PRs share a head: open beats merged beats the rest. */
const rank = (pr: Pr): number => (pr.state === 'OPEN' ? 0 : pr.mergedAt !== null ? 1 : 2);

/**
 * Reads the branches of every live plan: the walk's second stage.
 *
 * GATHERS AND DECIDES NOTHING. Each entry carries the readings `branchState`
 * takes and the evidence `withPlanLandings` takes; the rules stay where they
 * are and the caller applies them. The one judgement made here is whether a
 * merge subject or a named commit counts as found, and only for a branch with
 * no remote ref: the ref check stays in front of the lookup, so
 * `mergeSubjectFound` is true only where `refTip` is `null`.
 *
 * AN UNREADABLE SNAPSHOT FAILS THE BEAT. The branch tips, the merge walk, the
 * plan additions, an ancestry batch or a commit range that cannot be read each
 * answer `failed`: a partial reading would show an
 * unreadable branch as `open`. A host that cannot be asked is not a snapshot
 * failure; it is spelled in `hostReach` and `pr`, as the rule expects.
 *
 * ANCESTRY IS BATCHED. The age rule's merge-versus-addition pairs and the
 * named commits' containment in the default branch go to {@link Refs.containsMany}
 * in one call. An `unknown` answer proves nothing.
 *
 * A changed-path list git cannot make reads as no changed paths: it is
 * evidence for a reader and decides no state.
 *
 * A WORKTREE ESTATE HAS NO DEFAULT-BRANCH REF. The stage then walks no merges,
 * reads no plan additions, asks no ancestry and counts no commits ahead:
 * `mainTip` is `null` and every named commit reads `unknown`.
 *
 * A PR LISTING THE CALLER HOLDS REPLACES THE HOST CALL. With `input.prs`
 * the stage calls no `Host.prList`; see {@link BranchStageInput.prs}.
 *
 * Conflicts are read after assembly, by {@link readBranchConflicts}: which
 * branches are asked depends on their assembled state.
 *
 * @param refs - the ref reader.
 * @param host - the git host.
 * @param estate - the estate stage's answer.
 * @param input - the configuration the stage needs.
 * @returns the readings, or a failure when any part of the snapshot is unreadable.
 */
export const readBranchReadings = async (
  refs: Refs,
  host: Host,
  estate: Estate,
  input: BranchStageInput,
): Promise<PortResult<BranchStageReadings>> => {
  const mainRef = `origin/${input.mainBranch}`;
  // A prefix, not a glob: `refs/remotes/origin/*` does not match a name with a
  // slash in it, so every `feature/...` branch would read as having no ref.
  const tips = await refs.branchTips(['refs/remotes/origin/']);
  if (!tips.ok) return failed<BranchStageReadings>();
  const tipOf = new Map(tips.value.map((tip) => [tip.branch, tip.sha] as const));

  const backendAnswer = await host.backend();
  const backend = backendAnswer.ok ? String(backendAnswer.value) : '';
  const originAnswer = await refs.remoteUrl('origin');
  const origin = originAnswer.ok ? originAnswer.value : '';

  let hostReach: HostReach = 'ok';
  let prListComplete = false;
  let listed = false;
  let heldPr: (branch: string) => PrReading | undefined = () => undefined;
  let detailOf: (branch: string) => PrDetail = () => 'no-host';
  if (backend === 'none') {
    // A repository with no git host has no pull requests to ask about: the
    // question is never put, as `plot-fleet-scan.sh` reads a `none` backend.
    // Asked before `prs`, which a caller hands in for every backend.
    hostReach = 'unasked';
  } else if (input.prs?.kind === 'listed') {
    const { states, complete } = input.prs.listing;
    listed = true;
    prListComplete = complete;
    heldPr = (branch) => {
      const key = encodeListingKey(branch);
      const state = key === null ? undefined : states.get(key);
      if (state === undefined) return undefined;
      return state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : 'unreadable';
    };
    detailOf = () => 'no-cache';
  } else if (input.prs?.kind === 'unread') {
    // What the host said when the caller's own read was refused: a host that
    // could not be asked at all is `unasked`, as `plot-fleet-scan.sh` read it.
    hostReach = reachOfRefusal('failed', input.prs.said ?? '');
  } else {
    const list = await host.prList('all', PR_LIST_LIMIT, undefined, input.loose === true);
    const prByBranch = new Map<string, Pr>();
    if (list.ok) {
      listed = true;
      prListComplete = list.value.length > 0 && list.value.length < PR_LIST_LIMIT;
      for (const pr of list.value) {
        const held = prByBranch.get(pr.head);
        if (held === undefined || rank(pr) < rank(held)) prByBranch.set(pr.head, pr);
      }
    } else {
      const refusal = host.lastRefusal();
      hostReach = reachOfRefusal(refusal?.kind ?? null, refusal?.said ?? '');
    }
    heldPr = (branch) => {
      const held = prByBranch.get(branch);
      if (held === undefined) return undefined;
      if (held.state === 'OPEN') return 'OPEN';
      if (held.mergedAt !== null) return 'MERGED';
      return held.state === 'CLOSED' || held.state === 'MERGED' ? 'CLOSED' : 'unreadable';
    };
    detailOf = (branch) => {
      if (!listed) return 'no-host';
      const held = prByBranch.get(branch);
      if (held === undefined) return prListComplete ? 'none' : 'no-cache';
      return { state: held.state, checks: held.checks, draft: held.draft };
    };
  }
  const prFor = (branch: string): PrReading =>
    heldPr(branch) ?? (listed && prListComplete ? 'none' : 'unreadable');

  // A worktree estate has no default-branch ref: no merge walk, no plan
  // additions, no ancestry and no commits ahead, as `plot-fleet-scan.sh` reads
  // `origin/<main>` when it does not resolve.
  const noMain = estate.source === 'worktree';
  const merges = noMain ? answered<ReadonlyArray<{ sha: string; subject: string }>>([]) : await refs.mergeSubjects(mainRef, MERGE_WALK);
  if (!merges.ok) return failed<BranchStageReadings>();
  const additions = noMain ? answered<ReadonlyMap<string, string>>(new Map()) : await refs.planAdditions(mainRef, input.planDir);
  if (!additions.ok) return failed<BranchStageReadings>();

  const live = estate.plans.filter((p) => !SKIPPED_PHASES.has(p.record.phase));
  const sliceNames = namedSlices(
    estate.plans.map((p) => ({
      phase: p.record.phase,
      slices: p.record.slices.flatMap((s) => s.branches.map((b) => ({ branch: b.branch, deferred: b.deferred }))),
    })),
  );

  const forms = mergeSubjectForms(backend);
  const owner = ownerOfRemote(origin);
  const mainTip = estate.mainSha;

  // Every ancestry question goes out in one batch: (merge, added) pairs for the
  // age rule, and (commit, main) pairs for the commits a slice line names.
  const pairs: Array<{ ancestor: string; descendant: string }> = [];
  const wanted: Array<{
    plan: string;
    branch: string;
    ageAt: number[];
    commitAt: Array<{ commit: string; at: number }>;
  }> = [];
  for (const { record } of live) {
    const added = additions.value.get(record.file) ?? null;
    for (const slice of record.slices) {
      for (const line of slice.branches) {
        const entry = { plan: record.file, branch: line.branch, ageAt: [] as number[], commitAt: [] as Array<{ commit: string; at: number }> };
        if (!tipOf.has(line.branch)) {
          if (added !== null) {
            for (const hit of mergedBySubject({ subjects: merges.value, branches: [line.branch], forms, owner })) {
              entry.ageAt.push(pairs.length);
              pairs.push({ ancestor: hit.sha, descendant: added });
            }
          }
          for (const commit of noMain ? [] : line.commits ?? []) {
            entry.commitAt.push({ commit, at: pairs.length });
            pairs.push({ ancestor: commit, descendant: mainTip });
          }
        }
        wanted.push(entry);
      }
    }
  }
  const contained = await refs.containsMany(pairs);
  if (!contained.ok) return failed<BranchStageReadings>();

  const branches: BranchReading[] = [];
  let at = 0;
  for (const { record } of live) {
    const planStart = branches.length;
    for (const slice of record.slices) {
      for (const line of slice.branches) {
        const entry = wanted[at++]!;
        const refTip = tipOf.get(line.branch) ?? null;
        const landed = noMain && refTip === null
          ? (line.commits ?? []).map((commit) => ({ commit, contained: 'unknown' as const }))
          : entry.commitAt.map(({ commit, at: i }) => ({ commit, contained: contained.value[i]! }));
        // A merge proves the branch only when it is NOT an ancestor of the
        // commit that added the plan: a merge that predates the plan belongs to
        // an earlier use of the name.
        const proven = entry.ageAt.some((i) => contained.value[i] === 'no');
        const commitsLanded = landed.length > 0 && landed.every((l) => l.contained === 'yes');

        let commitsAhead = 0;
        let realCommitsAhead = 0;
        let changedPaths: readonly string[] = [];
        if (refTip !== null && !noMain) {
          const range = await refs.commitSubjects(`${mainRef}..origin/${line.branch}`);
          if (!range.ok) return failed<BranchStageReadings>();
          commitsAhead = range.value.length;
          realCommitsAhead = realCommits(range.value);
          if (commitsAhead > 0) {
            // Evidence only: a diff git cannot make, such as a branch with no
            // merge base, reads as no changed paths, as `plot-fleet-scan.sh`'s
            // `changed_paths_of` reads it.
            const files = await refs.changedFiles(`origin/${line.branch}`, input.mainBranch);
            changedPaths = files.ok ? files.value.slice(0, CHANGED_PATHS_CAP) : [];
          }
        }
        const waits: WaitsReading[] = line.waitsOn.map((name) => ({
          branch: name,
          pr: prFor(name),
          namedSlice: sliceNames.has(name),
        }));
        branches.push({
          plan: record.file,
          branch: line.branch,
          readings: {
            deferredByPlan: line.deferred,
            refTip,
            mainTip: noMain ? null : mainTip,
            mergeSubjectFound: refTip === null && (proven || commitsLanded),
            hostReach,
            pr: prFor(line.branch),
            prListComplete,
            commitsAhead,
            realCommitsAhead,
            waits,
          },
          landed,
          changedPaths,
          ...(input.loose === true ? { prDetail: detailOf(line.branch) } : {}),
        });
      }
    }
    if (input.onPlan !== undefined) await input.onPlan(record.file, branches.slice(planStart));
  }

  const addedByPlan = new Map<string, string>();
  for (const { record } of live) {
    const added = additions.value.get(record.file);
    if (added !== undefined) addedByPlan.set(record.file, added);
  }
  return answered({
    mainSha: mainTip,
    backend,
    origin,
    hostReach,
    merges: merges.value,
    added: addedByPlan,
    branches,
  });
};

/** One assembled branch as {@link readBranchConflicts} reads it. */
export interface ConflictCandidate {
  /** The branch as the plan names it. */
  branch: string;
  /** The branch's assembled state. */
  state: string;
  /** Whether the remote holds a ref for the branch. */
  refHeld: boolean;
  /** Paths the branch changed against the default branch. */
  changedPaths: readonly string[];
}

/** The states whose branches carry unlanded work of their own. */
const CONFLICT_STATES: ReadonlySet<string> = new Set(['wip', 'claimed']);

/**
 * Reads which paths each branch with unlanded changes would conflict on when
 * merged into the default branch.
 *
 * Asks {@link Refs.conflictPaths} once per distinct branch, one at a time, whose state is
 * `wip` or `claimed`, whose remote ref exists and whose changed paths are not
 * empty. A branch outside that set, or one whose merge git cannot compute, is
 * absent from the answer: its conflicts are not known.
 *
 * @param refs - the ref reader.
 * @param mainBranch - the default branch's name, such as `main`.
 * @param candidates - the assembled branches.
 * @returns each asked branch to its conflicting paths; empty where it merges cleanly.
 */
export const readBranchConflicts = async (
  refs: Refs,
  mainBranch: string,
  candidates: readonly ConflictCandidate[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
  const asked = [...new Set(
    candidates
      .filter((c) => CONFLICT_STATES.has(c.state) && c.refHeld && c.changedPaths.length > 0)
      .map((c) => c.branch),
  )];
  const known = new Map<string, readonly string[]>();
  for (const branch of asked) {
    const answer = await refs.conflictPaths(`origin/${mainBranch}`, `origin/${branch}`);
    if (answer.ok) known.set(branch, answer.value);
  }
  return known;
};

/**
 * The `merge_detect` word for a scan that reports the given plans.
 *
 * A refless branch of a reported plan is what the subject lookup asks about;
 * the walk counts as truncated where it read as many merges as its cap.
 *
 * @param stage - the branch stage's readings.
 * @param plans - the plan files the scan reports.
 * @returns the word.
 */
export const stageMergeDetect = (stage: BranchStageReadings, plans: ReadonlySet<string>): MergeDetect =>
  mergeDetectOf({
    subjects: stage.merges,
    forms: mergeSubjectForms(stage.backend),
    asked: stage.branches.some((b) => plans.has(b.plan) && b.readings.refTip === null),
    truncated: stage.merges.length >= MERGE_WALK,
  });

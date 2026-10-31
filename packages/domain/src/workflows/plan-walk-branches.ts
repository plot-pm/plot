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
import { mergedBySubject } from '../rules/merge-subject.js';
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
}

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
}

/** What the branch stage reads: one entry per branch line of every live plan. */
export interface BranchStageReadings {
  /** The default branch's commit the stage read at; the estate's. */
  mainSha: string;
  /** The host's backend word, or `''` where it could not be read. */
  backend: string;
  /** The `origin` URL, or `''` where it could not be read. */
  origin: string;
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
 * plan additions, an ancestry batch, a commit range or a changed-path list
 * that cannot be read each answer `failed`: a partial reading would show an
 * unreadable branch as `open`. A host that cannot be asked is not a snapshot
 * failure; it is spelled in `hostReach` and `pr`, as the rule expects.
 *
 * ANCESTRY IS BATCHED. The age rule's merge-versus-addition pairs and the
 * named commits' containment in the default branch go to {@link Refs.containsMany}
 * in one call. An `unknown` answer proves nothing.
 *
 * `conflicts` has no port operation yet and is not read here.
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
  const tips = await refs.branchTips(['refs/remotes/origin/*']);
  if (!tips.ok) return failed<BranchStageReadings>();
  const tipOf = new Map(tips.value.map((tip) => [tip.branch, tip.sha] as const));

  const backendAnswer = await host.backend();
  const backend = backendAnswer.ok ? String(backendAnswer.value) : '';
  const originAnswer = await refs.remoteUrl('origin');
  const origin = originAnswer.ok ? originAnswer.value : '';

  const list = await host.prList('all', PR_LIST_LIMIT);
  let hostReach: HostReach = 'ok';
  let prListComplete = false;
  const prByBranch = new Map<string, Pr>();
  if (list.ok) {
    prListComplete = list.value.length > 0 && list.value.length < PR_LIST_LIMIT;
    for (const pr of list.value) {
      const held = prByBranch.get(pr.head);
      if (held === undefined || rank(pr) < rank(held)) prByBranch.set(pr.head, pr);
    }
  } else {
    const refusal = host.lastRefusal();
    hostReach = reachOfRefusal(refusal?.kind ?? null, refusal?.said ?? '');
  }
  const prFor = (branch: string): PrReading => {
    const held = prByBranch.get(branch);
    if (held !== undefined) {
      if (held.state === 'OPEN') return 'OPEN';
      if (held.mergedAt !== null) return 'MERGED';
      return held.state === 'CLOSED' || held.state === 'MERGED' ? 'CLOSED' : 'unreadable';
    }
    return list.ok && prListComplete ? 'none' : 'unreadable';
  };

  const merges = await refs.mergeSubjects(mainRef, MERGE_WALK);
  if (!merges.ok) return failed<BranchStageReadings>();
  const additions = await refs.planAdditions(mainRef, input.planDir);
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
          for (const commit of line.commits ?? []) {
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
    for (const slice of record.slices) {
      for (const line of slice.branches) {
        const entry = wanted[at++]!;
        const refTip = tipOf.get(line.branch) ?? null;
        const landed = entry.commitAt.map(({ commit, at: i }) => ({ commit, contained: contained.value[i]! }));
        // A merge proves the branch only when it is NOT an ancestor of the
        // commit that added the plan: a merge that predates the plan belongs to
        // an earlier use of the name.
        const proven = entry.ageAt.some((i) => contained.value[i] === 'no');
        const commitsLanded = landed.length > 0 && landed.every((l) => l.contained === 'yes');

        let commitsAhead = 0;
        let realCommitsAhead = 0;
        let changedPaths: readonly string[] = [];
        if (refTip !== null) {
          const range = await refs.commitSubjects(`${mainRef}..origin/${line.branch}`);
          if (!range.ok) return failed<BranchStageReadings>();
          commitsAhead = range.value.length;
          realCommitsAhead = realCommits(range.value);
          if (commitsAhead > 0) {
            const files = await refs.changedFiles(`origin/${line.branch}`);
            if (!files.ok) return failed<BranchStageReadings>();
            changedPaths = files.value.slice(0, CHANGED_PATHS_CAP);
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
            mainTip,
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
        });
      }
    }
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
    merges: merges.value,
    added: addedByPlan,
    branches,
  });
};

import { mergeSubjectForms } from '../adapters/host/merge-subjects.js';
import type { Pr } from '../entities/pr.js';
import { answered, failed, type PortResult } from '../port-result.js';
import type { Host, HostRefusal } from '../ports/host.js';
import type { Containment, Refs } from '../ports/refs.js';
import {
  branchState,
  namedSlices,
  type BranchReadings,
  type HostReach,
  type PrReading,
  type WaitsReading,
} from '../rules/branch-state.js';
import { realCommits } from '../rules/empty-claim.js';
import { encodeListingKey, type CarriedPrStates, type ReportedListingRow } from '../rules/scan-listing.js';
import { mergeDetectOf, mergedBySubject, type MergeDetect } from '../rules/merge-subject.js';
import { ownerOfRemote } from '../rules/remote-owner.js';
import type { Estate } from './plan-walk-estate.js';

/** The plan phases whose branches the stage does not read. */
const SKIPPED_PHASES: ReadonlySet<string> = new Set(['released', 'rejected', 'superseded']);

/** How many merge commits the subject lookup walks, as the shell scan caps it. */
const MERGE_WALK = 20000;

/**
 * The effective merge walk cap: `PLOT_MERGE_SCAN_LIMIT` where it parses as a
 * positive integer, {@link MERGE_WALK} otherwise.
 *
 * The cap guards against a pathological history rather than saving time
 * (measured: cap 500 = 7.7ms, no cap = 11.8ms on 2000 merges), and a capped
 * walk reports `merge_detect=truncated` so an `open` it could not disprove
 * stays readable as such.
 *
 * @returns the number of merge commits to walk.
 */
export const mergeWalkLimit = (): number => {
  const raw = process.env.PLOT_MERGE_SCAN_LIMIT;
  if (raw === undefined || !/^\d+$/.test(raw)) return MERGE_WALK;
  const parsed = Number(raw);
  return parsed > 0 ? parsed : MERGE_WALK;
};

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
   * `unread` reads every PR as `unreadable`, with `hostReach` the `reach` it
   * carries, or else `failed`, or `unasked` where `said` names a host that could not be asked. Where
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
  /**
   * Whether the host may not be asked at all (`--offline` outside an offer):
   * the stage calls no `Host.prList` and no `Host.prState`, reads every PR as
   * `unreadable` with `hostReach` `unasked`, and asks `Host.backend` only where
   * a merge subject needs its form.
   */
  offline?: boolean;
  /**
   * Whether the stage asks `Host.prState` once per name the PR list does not
   * answer: each branch with no remote ref, and each `waits:` prerequisite.
   * A complete list answers `none` for a name it omits, and the name is not
   * asked unless `askAlways` is set. A failed or partial list does not stop
   * the asks. Absent or false, the list alone answers.
   */
  askAbsent?: boolean;
  /** Under `askAbsent`, asks every name the list omits even where the list is complete. */
  askAlways?: boolean;
  /**
   * The heads the PR index holds a merged, non-draft row for. A branch with no
   * remote ref that a merge subject or a landed commit proves reads `pr`
   * `MERGED` where its head is in the set and no `OPEN` row names it. A head
   * absent from the set changes no reading: the index answers `MERGED` and
   * never `none`. Absent, no branch reads from the index.
   */
  indexMerged?: ReadonlySet<string>;
  /**
   * The heads the PR index holds an `OPEN` row for. Where present, this set
   * and not the PR listing decides whether an `OPEN` row blocks
   * {@link BranchStageInput.indexMerged}: a listing reused across beats can
   * still carry the `OPEN` row of a PR that has merged since. Absent, an `OPEN`
   * row in the listing blocks the index.
   */
  indexOpen?: ReadonlySet<string>;
  /** How many pull requests each host list call asks for; {@link PR_LIST_LIMIT} where absent. */
  listLimit?: number;
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
  | { kind: 'unread'; said?: string; reach?: HostReach };

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
  /**
   * The commits on the local branch `refs/heads/<branch>` that its remote ref
   * does not hold; 0 where either ref is absent or git cannot count them.
   * Read from refs, so a local branch no worktree holds is counted too.
   */
  localAhead?: number;
  /**
   * Whether a merge subject names the branch and every such merge predates the
   * plan, so the age rule refused it; a branch with a remote ref reads false.
   */
  subjectPredatesPlan?: boolean;
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
  /**
   * The PR listing the stage held: read from the host or handed in. Absent
   * where no listing arrived, so a caller that reports it reports nothing.
   */
  listing?: { rows: readonly ReportedListingRow[]; complete: boolean; tracked: number };
}

/**
 * Classifies a failed host list call into the reach the branch rule takes.
 *
 * @param kind - the refusal's kind, or `null` where the host named none.
 * @param said - what the connector said.
 * @returns the reach.
 */
const reachOfRefusal = (kind: HostRefusal['kind'] | null, said: string): HostReach => {
  if (kind === 'throttled' || kind === 'secondary') return kind;
  if (kind === 'auth') return 'unasked';
  return UNASKED_PATTERNS.some((pattern) => pattern.test(said)) ? 'unasked' : 'failed';
};

/** Whether a host row says the PR merged: a `mergedAt` stamp, or the list's own `MERGED` word. */
const isMerged = (pr: Pr): boolean => pr.mergedAt !== null || pr.state === 'MERGED';

/** The rank of a PR state when several PRs share a head: open beats merged beats the rest. */
const rank = (pr: Pr): number => (pr.state === 'OPEN' ? 0 : isMerged(pr) ? 1 : 2);

/**
 * Reads one host PR row as the branch rule's word.
 *
 * @param pr - the row, or null where the host holds no PR.
 * @returns `OPEN`, `MERGED`, `CLOSED` or `none`.
 */
const readingOfPr = (pr: Pr | null): PrReading => {
  if (pr === null) return 'none';
  if (pr.state === 'OPEN') return 'OPEN';
  return isMerged(pr) ? 'MERGED' : 'CLOSED';
};

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
 * THE PR INDEX CONFIRMS A PROVEN LANDING. A refless branch that a merge
 * subject or a landed commit proves reads `MERGED` where
 * {@link BranchStageInput.indexMerged} holds its head; see that field.
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
  // Local heads, for the commits a remote ref does not hold. A local read that
  // fails reads as no local heads: the count is evidence and decides no state.
  const localTips = await refs.branchTips(['refs/heads/']);
  const localTipOf = new Map(localTips.ok ? localTips.value.map((tip) => [tip.branch, tip.sha] as const) : []);

  // A worktree estate has no default-branch ref: no merge walk, no plan
  // additions, no ancestry and no commits ahead, as `plot-fleet-scan.sh` reads
  // `origin/<main>` when it does not resolve.
  const noMain = estate.source === 'worktree';
  const merges = noMain ? answered<ReadonlyArray<{ sha: string; subject: string }>>([]) : await refs.mergeSubjects(mainRef, mergeWalkLimit());
  if (!merges.ok) return failed<BranchStageReadings>();
  const additions = noMain ? answered<ReadonlyMap<string, string>>(new Map()) : await refs.planAdditions(mainRef, input.planDir);
  if (!additions.ok) return failed<BranchStageReadings>();

  // An offline stage asks the backend only for a merge subject's form: with no
  // merge commit to match, it makes no host call at all.
  const offline = input.offline === true;
  const backendAnswer = offline && merges.value.length === 0 ? null : await host.backend();
  const backend = backendAnswer !== null && backendAnswer.ok ? String(backendAnswer.value) : '';
  const originAnswer = await refs.remoteUrl('origin');
  const origin = originAnswer.ok ? originAnswer.value : '';
  const listLimit = input.listLimit ?? PR_LIST_LIMIT;

  let hostReach: HostReach = 'ok';
  let prListComplete = false;
  let listed = false;
  let heldPr: (branch: string) => PrReading | undefined = () => undefined;
  let listingRows: readonly ReportedListingRow[] = [];
  let detailOf: (branch: string) => PrDetail = () => 'no-host';
  if (offline || backend === 'none') {
    // A repository with no git host has no pull requests to ask about: the
    // question is never put, as `plot-fleet-scan.sh` reads a `none` backend.
    // Asked before `prs`, which a caller hands in for every backend.
    hostReach = 'unasked';
  } else if (input.prs?.kind === 'listed') {
    const { states, complete } = input.prs.listing;
    listed = true;
    prListComplete = complete;
    listingRows = input.prs.listing.rows;
    heldPr = (branch) => {
      const key = encodeListingKey(branch);
      const state = key === null ? undefined : states.get(key);
      if (state === undefined) return undefined;
      return state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : 'unreadable';
    };
    // The listing's own words for `--loose`: a row with no rollup reads `unknown` checks.
    const rowOf = new Map(input.prs.listing.rows.map((row) => [row.key, row] as const));
    detailOf = (branch) => {
      const key = encodeListingKey(branch);
      const row = key === null ? undefined : rowOf.get(key);
      // A branch the listing names no row for has no rollup to read, as the shell's `pr_ready` read it.
      if (row === undefined) return 'no-cache';
      const state = row.state === 'OPEN' || row.state === 'MERGED' ? row.state : 'CLOSED';
      return { state, checks: row.checks === '-' ? 'unknown' : row.checks, draft: row.draft === 'true' };
    };
  } else if (input.prs?.kind === 'unread') {
    // What the host said when the caller's own read was refused: a host that
    // could not be asked at all is `unasked`, as `plot-fleet-scan.sh` read it.
    hostReach = input.prs.reach ?? reachOfRefusal('failed', input.prs.said ?? '');
  } else {
    // Open first, then settled: a PR that merges between the two calls carries an OPEN row and a MERGED one, and the rank keeps OPEN.
    // A failed open call decides alone; the settled call is not made.
    const open = await host.prList('open', listLimit, undefined, input.loose === true);
    const settled = open.ok && host.lastRefusal() === null ? await host.prList('settled', listLimit) : open;
    // A partial answer (exit 7) is `ok` with its refusal recorded; the listing is a whole answer or none, so a refusal discards the rows.
    // A row that names no head branch is not a PR row and is neither joined nor counted.
    const keyed = (rows: readonly Pr[]): readonly Pr[] => rows.filter((pr) => encodeListingKey(pr.head) !== null);
    const pages = open.ok && settled.ok && host.lastRefusal() === null ? [keyed(open.value), keyed(settled.value)] : null;
    const prByBranch = new Map<string, Pr>();
    if (pages !== null) {
      listed = true;
      const rows = pages.flat();
      prListComplete = rows.length > 0 && pages.every((page) => page.length < listLimit);
      for (const pr of rows) {
        const held = prByBranch.get(pr.head);
        if (held === undefined || rank(pr) < rank(held)) prByBranch.set(pr.head, pr);
      }
      listingRows = [...prByBranch.values()].map((pr) => {
        // A row the list carried no rollup for reads `unknown`; the report says `-`, as a plain row does.
        const rich = pr.checks !== 'unknown';
        return { key: encodeListingKey(pr.head) as string, state: pr.state, checks: rich ? pr.checks : '-', draft: rich ? String(pr.draft) : '-' };
      });
    } else {
      const refusal = host.lastRefusal();
      hostReach = reachOfRefusal(refusal?.kind ?? null, refusal?.said ?? '');
    }
    heldPr = (branch) => {
      const held = prByBranch.get(branch);
      return held === undefined ? undefined : readingOfPr(held);
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

  // THE ONE PER-NAME HOST QUESTION, and it is bounded by names the list cannot
  // answer: a branch with no remote ref (a squash merge deletes it) and a
  // prerequisite (its plan may be delivered and its ref gone). A branch with a
  // ref is never asked here, so a recreated name cannot inherit an earlier
  // merge. Each name is asked once per walk; a failed ask reads `unreadable`.
  const asked = new Map<string, PrReading>();
  const mayAsk = input.askAbsent === true && !offline && backend !== 'none';
  const askHost = async (branch: string): Promise<PrReading> => {
    const known = asked.get(branch);
    if (known !== undefined) return known;
    const answer = await host.prState(branch);
    const reading = answer.ok ? readingOfPr(answer.value) : 'unreadable';
    asked.set(branch, reading);
    return reading;
  };
  const askedPrFor = async (branch: string): Promise<PrReading> => {
    const held = heldPr(branch);
    if (held !== undefined) return held;
    if (!mayAsk || (listed && prListComplete && input.askAlways !== true)) return prFor(branch);
    return askHost(branch);
  };
  const indexMerged = input.indexMerged ?? new Set<string>();

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
        const predates = !proven && entry.ageAt.some((i) => contained.value[i] === 'yes');
        const commitsLanded = landed.length > 0 && landed.every((l) => l.contained === 'yes');

        let commitsAhead = 0;
        let realCommitsAhead = 0;
        let changedPaths: readonly string[] = [];
        if (refTip !== null && !noMain) {
          const range = await refs.commitSubjects(`${mainTip}..${refTip}`);
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
        let localAhead = 0;
        const localTip = localTipOf.get(line.branch);
        if (refTip !== null && localTip !== undefined && localTip !== refTip) {
          // By oid, as every main-relative range here: a name would be read again later.
          const ahead = await refs.commitSubjects(`${refTip}..${localTip}`);
          localAhead = ahead.ok ? ahead.value.length : 0;
        }
        const waits: WaitsReading[] = [];
        for (const name of line.waitsOn) {
          waits.push({ branch: name, pr: await askedPrFor(name), namedSlice: sliceNames.has(name) });
        }
        // A branch with a ref answers from the list alone; a merge subject or a
        // landed commit already proves a refless one, so neither is asked.
        const listedPr = refTip === null && !proven && !commitsLanded ? await askedPrFor(line.branch) : prFor(line.branch);
        // The index confirms a landing a subject or a named commit proves, with
        // a terminal answer only: a head it does not hold keeps the list's word.
        // An OPEN row blocks it; the index's own OPEN rows decide where given.
        const openRow = input.indexOpen === undefined ? listedPr === 'OPEN' : input.indexOpen.has(line.branch);
        const pr: PrReading =
          refTip === null && (proven || commitsLanded) && !openRow && indexMerged.has(line.branch) ? 'MERGED' : listedPr;
        branches.push({
          plan: record.file,
          branch: line.branch,
          readings: {
            deferredByPlan: line.deferred,
            refTip,
            mainTip: noMain ? null : mainTip,
            mergeSubjectFound: refTip === null && (proven || commitsLanded),
            hostReach,
            pr,
            prListComplete,
            commitsAhead,
            realCommitsAhead,
            waits,
          },
          landed,
          changedPaths,
          localAhead,
          subjectPredatesPlan: predates,
          ...(input.loose === true ? { prDetail: detailOf(line.branch) } : {}),
        });
      }
    }
    // A DELIVERY CANDIDATE ASKS THE HOST about its subject-proven branches: an
    // approved plan whose every non-deferred branch reads merged is next
    // delivered, and a delivery is refused while a subject alone proves a
    // branch. Asked only where the list arrived; a refused host is not asked.
    // A complete list that omits the branch is asked too: its `none` cannot
    // confirm a landing.
    if (record.phase === 'approved' && listed && mayAsk) {
      const own = branches.slice(planStart);
      const candidate = own.every((b) => b.readings.deferredByPlan || branchState({ ...b.readings, waits: [] }) === 'merged');
      for (let i = planStart; candidate && i < branches.length; i += 1) {
        const b = branches[i]!;
        if (!b.readings.mergeSubjectFound || b.readings.pr === 'MERGED') continue;
        branches[i] = { ...b, readings: { ...b.readings, pr: await askHost(b.branch) } };
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
    ...(listed
      ? { listing: { rows: listingRows, complete: prListComplete, tracked: [...tipOf.keys()].filter((b) => b !== 'HEAD').length } }
      : {}),
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
    truncated: stage.merges.length >= mergeWalkLimit(),
  });

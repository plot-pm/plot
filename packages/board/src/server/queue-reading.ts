import {
  behindUnknownLanding,
  planQueue,
  settled,
  type QueuedBranch,
  type PlanOrderedSlice,
  type QueueAgent,
  type MergedSetState,
  type QueueReadings,
  type QueuedSlice,
} from '@plot-pm/domain/rules/queue';
import type { LandedAnswer } from '@plot-pm/domain/rules/landed';
import {
  VIEWS_PER_PASS,
  blockingBranches,
  knownPrFor,
  landedSource,
} from '@plot-pm/domain/rules/known-pr';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { PlanRecord, PlanRecordSlice } from '@plot-pm/domain';

import type { AgentEntry } from './registry.js';

/**
 * What the queue is read through, so a test can hand it an estate.
 *
 * Every member is a question the fleet scan and the dispatch gate already ask.
 * **Nothing here is a new source** — which is the whole of the queue being
 * derived: an eligible slice with a brief and no claim IS queued, so reading
 * the queue means re-asking three questions whose answers already exist rather
 * than opening a file that records them.
 *
 * Everything is a READ. There is no way to spawn, claim or write through this
 * interface, so a bug here reports the wrong queue and can destroy nothing.
 */
export interface QueueWorld {
  /** Every plan on the estate, as the plan store parses them. */
  plans(): Promise<readonly PlanRecord[]>;
  /** The remote branches that exist — a ref IS a claim. */
  claimedBranches(): Promise<ReadonlySet<string>>;
  /** Whether a usable brief sits on the ref the agent will read. */
  briefPresent(branch: string): Promise<boolean>;
  /** Whether the branch this agent holds has landed. */
  sliceHasMerged(branch: string): Promise<boolean>;
  /**
   * Every branch the host has merged a PR for, in ONE call.
   *
   * **THE BUNDLE IS THE POINT.** It answers *did this land* for a branch with
   * no ref — the only way to tell finished work from unstarted work once
   * merging has deleted the ref. Asked per branch it cost 426 calls and took a
   * tick from 25 s to 357 s (measured 2026-09-06); asked once it costs one.
   *
   * An unreachable host answers with an empty set and `whole: false`, so
   * nothing is promoted on silence; a partial answer keeps its rows and is not
   * whole either.
   */
  mergedBranches(): Promise<MergedListing>;
  /**
   * The PR index's rows, read from disk and never from the host.
   *
   * Asked only when the listing was not whole: a merged row answers a branch
   * for no call, and any row names the number {@link QueueWorld.viewLanded}
   * asks by. Empty where there is no index.
   */
  prIndexRows(): Promise<readonly PrIndexRow[]>;
  /**
   * Whether the PR with this number merged, asked by number rather than listed.
   *
   * A listing and a lookup by number are separate requests on the host, and
   * one answered under a rate limit while the other refused (#1140). A lookup
   * that does not answer reads `unknown`.
   */
  viewLanded(number: number): Promise<LandedAnswer>;
  /**
   * Whether the host merged any PR for a QUEUED branch.
   *
   * **A DIFFERENT SUBJECT FROM {@link QueueWorld.sliceHasMerged}, WHICH IS WHY
   * IT IS A SECOND MEMBER.** That one asks about the branch an agent is
   * holding and answers a boolean, because `free.ts` reads it as *this agent
   * is done*. This one asks about work nobody holds, and its three-valued
   * answer is the point: a host that could not be asked must hold the slice
   * rather than offer it.
   */
  queuedHasLanded(branch: string): Promise<LandedAnswer>;
  /**
   * The refless branches a merge subject on the default branch proves landed,
   * per plan.
   *
   * Local git readings only, and no host call. A branch is proven for a plan
   * only where its merge is not contained in the commit that added the plan
   * file, so a reused name merged before the plan existed proves nothing.
   *
   * @param plans - the plans to answer for.
   * @param claimed - branch names to leave out; each one keeps its own host
   *   question.
   * @returns each plan's file to the branches proven for it, or `null` where
   *   the readings could not be taken.
   */
  subjectProven(
    plans: readonly PlanRecord[],
    claimed: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, ReadonlySet<string>> | null>;
  /** Whether a worker process is alive in this desk. */
  workerAlive(worktree: string): Promise<boolean>;
  /** Whether the desk carries a `PLOT-BLOCKED*` marker. */
  blocked(worktree: string): Promise<boolean>;
  /**
   * Whether an agent was handed this branch and wrote a marker rather than
   * working it.
   *
   * **A BRANCH, NOT A WORKTREE.** By the time the supervisor looks, the desk
   * that held the refusal may carry no manifest naming the branch at all — of
   * 250 desks measured 2026-10-03 behind one refused slice, the manifests had
   * already been cleared. {@link QueueWorld.blocked} answers for a desk an
   * agent is REGISTERED to; this answers for a branch no agent may still be
   * registered to, which is the queue's own question.
   *
   * Latches to false the moment the underlying record clears — the marker is
   * gone, or the record naming the branch is removed — so a daemon reads the
   * current refusal each pass rather than one it remembers.
   */
  refused(branch: string): Promise<boolean>;
}

/**
 * What a hand-over is checked against, immediately before it is made.
 *
 * **ASKED ONLY FOR A BRANCH ABOUT TO BE HANDED OVER**, so at most the tick's
 * free agents pay for it — `startAgents` asks this world once per
 * `agent-assign` write, not once per queued slice.
 */
export interface HandOverWorld {
  /** The branch's remote ref, asked again at hand-over time. */
  remoteHead(branch: string): Promise<'present' | 'absent' | 'unknown'>;
  /** Whether the branch's work landed, asked again at hand-over time. */
  queuedHasLanded(branch: string): Promise<LandedAnswer>;
  /** The current time, epoch milliseconds — a parameter so a test can pin it. */
  now(): number;
}

/** The merged listing: the heads it named, and whether it answered whole. */
export interface MergedListing {
  /** Every head a merged PR names, from the rows that arrived. */
  merged: ReadonlySet<string>;
  /** Whether the listing answered in full; false on a failure or a partial answer. */
  whole: boolean;
  /**
   * The refusal's kind where the listing did not answer whole, else `null`.
   *
   * **IT TRAVELS WITH THE LISTING BECAUSE ONLY THE CALLER THAT ASKED CAN READ
   * IT.** `host.lastRefusal()` is the connector's most recent refusal, and a
   * later reading would name a different request's. The caller takes it beside
   * the answer, and {@link QueueReadings.mergedSet} carries it to the tick line.
   */
  kind: 'throttled' | 'secondary' | 'failed' | null;
  /**
   * Whether the listing request itself failed, as against answering with a
   * refusal left behind.
   *
   * `whole: false` cannot separate the two, and the tick line names them apart:
   * a `partial` listing holds rows that may be incomplete, an `unaskable` one
   * holds none.
   */
  failed: boolean;
}

export type { QueuedBranch };

/**
 * Derives the queue from one plan — the board's call into the domain's fold.
 *
 * **THE DECISION IS `planQueue`'s.** The slice order, the merged-only
 * `settled` rule, the slug and the `waits:` hold live in
 * `packages/domain/src/rules/queue.ts` as a pure function.
 *
 * **IT ANSWERS NONE OF THE ASKED READINGS**, which is what `QueuedBranch`'s
 * `Omit` names: the brief, the landing and the refusal are questions for the
 * machine, the host and a worker's own record, and this function reads one
 * plan record.
 * `readQueue` asks them, under the bound documented there.
 *
 * @param plan - the plan, as the plan store parsed it.
 * @param claimed - the remote branches that exist.
 * @param merged - the branches the merged listing (and its fallback) named.
 * @param listingWhole - whether the merged listing answered in full.
 * @returns one entry per branch this plan has queued, in plan order.
 */
export const queueOfPlan = (
  plan: PlanRecord,
  claimed: ReadonlySet<string>,
  merged: ReadonlySet<string> = new Set<string>(),
  listingWhole = true,
): readonly QueuedBranch[] => planQueue(plan, claimed, merged, listingWhole);

/**
 * Reads the queue and the fleet, for one matching pass.
 *
 * **IT KEEPS NOTHING.** Every reading is re-taken, so a daemon restarted
 * mid-pass loses one pass's readings and no assignment — there is nothing to
 * lose, because the queue is a function of the plans, the refs and the briefs.
 *
 * The brief is asked only of a slice that could otherwise be handed over. It
 * is a `git cat-file` per branch, and asking it of a slice already held by its
 * plan's phase would pay for an answer nothing reads.
 *
 * **THE HOST IS ASKED UNDER THE SAME BOUND, AND HERE IT IS THE POINT RATHER
 * THAN A SAVING.** The brief is a local `git cat-file`; the landing question is
 * a call to the one reading with an account and a rate limit behind it. This
 * estate had **454 queued slices** on the tick that found the defect, and a
 * daemon asking the host about every one of them each minute would spend its
 * whole budget on branches three other words were already holding. So the
 * question goes only to a slice that {@link isHandOverReady} would otherwise
 * pass, which is the only place its answer changes an outcome.
 *
 * **A SLICE NOBODY ASKED ABOUT READS `not-landed`, AND THAT IS SAFE HERE WHILE
 * `unknown` WOULD NOT BE.** It is unasked rather than unanswered: the slice is
 * already held by its plan, its ordering or a missing brief, so no hand-over
 * can follow it and the word only decides which reason gets printed.
 * `unknown` is reserved for a host that was ASKED and did not answer — the one
 * case where silence must withhold work.
 *
 * @param entries - the registry's manifests, as `readAgentRegistry` reports them.
 * @param world - what to read the estate through.
 * @returns the queue and the fleet, as one pass measured them.
 */
export const readQueue = async (
  entries: readonly AgentEntry[],
  world: QueueWorld,
): Promise<QueueReadings> => {
  const [plans, claimed] = await Promise.all([world.plans(), world.claimedBranches()]);

  // WHICH REFLESS BRANCHES ALREADY MERGED, ASKED IN ONE CALL FOR THE WHOLE PASS.
  //
  // The host is the only thing that can separate *unstarted* from *landed*,
  // since merging deletes the ref and both end up refless.
  //
  // **IT IS ONE BUNDLED CALL, NEVER ONE PER BRANCH**, and that was measured
  // rather than assumed. A first version asked `prMerged` per branch: correct,
  // and it took the tick from 25 s to **357 s** across 426 branches on 136
  // multi-slice plans — a 14x bill on the one reading with an account and a
  // rate limit behind it, paid every 60 s. `mergedBranches` asks the host for
  // its merged PRs once and joins by head branch, which is what
  // `plot-fleet-scan.sh` has always done for the same question.
  //
  // SILENCE LEAVES THE SLICE BLOCKED. A failed reading yields an empty set, so
  // every branch stays outstanding and the slices behind it stay held.
  // Promoting on silence would hand an agent a slice whose predecessor may
  // still be running — the opposite of the reaper's direction, and stated here
  // because the two are easy to confuse.
  //
  // A LISTING THAT IS NOT WHOLE IS NOT THE LAST WORD. A known PR number is
  // asked by number, a request that answered on Bitbucket while the listing
  // returned HTTP 429 (#1140). `landedWithoutListing` bounds those lookups.
  const listing = await world.mergedBranches();
  const merged = new Set(listing.merged);
  const provenFor = await subjectProofOf(plans, claimed, merged, world);
  const answered = listing.whole
    ? new Map<string, LandedAnswer>()
    : await landedWithoutListing(plans, merged, provenFor, world);

  const slices: QueuedSlice[] = [];
  for (const plan of plans) {
    // THE PLAN'S SLICES ARE COLLECTED BEFORE ANY IS MARKED, because the mark is
    // a statement about the plan rather than about one branch: whether a slice
    // is held behind an unanswered landing cannot be known until every earlier
    // slice of the SAME plan has its answer. `behindUnknownLanding` is asked
    // once per plan and decides; nothing here does.
    const ofPlan: QueuedSlice[] = [];
    const ordered: PlanOrderedSlice[] = [];
    for (const entry of queueOfPlan(
      plan,
      claimed,
      new Set([...merged, ...provenFor(plan)]),
      listing.whole,
    )) {
      const briefPresent = entry.claimable ? await world.briefPresent(entry.branch) : false;
      const landed: LandedAnswer =
        // A BRANCH THE NUMBER LOOKUP ALREADY ANSWERED IS NOT ASKED AGAIN. Every
        // other branch goes to the per-branch question, as it did before the
        // listing could fail.
        entry.claimable && briefPresent
          ? answered.get(entry.branch) ?? (await world.queuedHasLanded(entry.branch))
          : 'not-landed';
      // ASKED ONLY OF A CLAIMABLE SLICE, the same bound `whyNotReady` tests it
      // under: an unclaimable slice reads `not-claimable` regardless, and asking
      // would pay for an answer nothing reads.
      const refused = entry.claimable ? await world.refused(entry.branch) : false;
      const { slice, ...queued } = entry;
      ofPlan.push({ ...queued, briefPresent, landed, priorUnknown: false, refused });
      ordered.push({ branch: entry.branch, slice, claimable: entry.claimable, landed });
    }

    const behind = new Set(behindUnknownLanding(ordered));
    for (const slice of ofPlan) {
      slices.push(behind.has(slice.branch) ? { ...slice, priorUnknown: true } : slice);
    }
  }

  const agents: QueueAgent[] = [];
  for (const entry of entries) {
    agents.push({
      session: entry.session,
      worktree: entry.worktree,
      reading: {
        state: await stateOf(entry, world),
        branch: entry.branch,
        sliceHasMerged: entry.branch === '' ? false : await world.sliceHasMerged(entry.branch),
      },
    });
  }

  // THE LISTING'S STATE TRAVELS WITH THE SLICES IT EXPLAINS. Every `unknown`
  // landing and every slice held behind one came from this answer, and the tick
  // line prints it so a reader is not left to infer a host outage from a count.
  return { slices, agents, mergedSet: mergedSetOf(listing) };
};

/**
 * How fully the listing answered, as the tick line reports it.
 *
 * `whole` carries no kind: there was no refusal to name. `unaskable` is a
 * request that failed and `partial` one that answered and left a refusal, and
 * the two are kept apart because their rows differ — a partial listing's rows
 * may be incomplete, an unaskable one has none.
 *
 * A listing that is not whole and names no kind reads `failed`: something
 * refused it, and `null` would print a state with no cause.
 *
 * @param listing - the merged listing, as the world answered it.
 * @returns the state and the refusal's kind.
 */
const mergedSetOf = (listing: MergedListing): MergedSetState => {
  if (listing.whole) return { state: 'whole', kind: null };
  return { state: listing.failed ? 'unaskable' : 'partial', kind: listing.kind ?? 'failed' };
};

/** No branch, for a plan the merge subjects prove nothing about. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * The branches a merge subject proves for each plan, as a lookup.
 *
 * **NO PROOF UNDER THE `'*'` SENTINEL.** `claimedBranches` answers `{'*'}` when
 * the ref list could not be read, and `'*'` names no branch. A subject naming
 * an in-flight branch would then settle it, so no proof is asked for.
 *
 * Names the listing already merged are left out with the claimed ones: the
 * proof adds nothing for them, and leaving them out saves their ancestry tests.
 *
 * @param plans - every plan on the estate.
 * @param claimed - the remote branches that exist.
 * @param merged - the heads the listing named.
 * @param world - what to read the estate through.
 * @returns a lookup from a plan to the branches proven for it, empty where
 *   nothing was proven or nothing could be asked.
 */
const subjectProofOf = async (
  plans: readonly PlanRecord[],
  claimed: ReadonlySet<string>,
  merged: ReadonlySet<string>,
  world: QueueWorld,
): Promise<(plan: PlanRecord) => ReadonlySet<string>> => {
  if (claimed.has('*')) return () => NONE;
  const proven = await world.subjectProven(plans, new Set([...claimed, ...merged]));
  return (plan) => proven?.get(plan.file) ?? NONE;
};

/**
 * Answers *did this land* for the branches the queue needs, without the listing.
 *
 * **ONLY THE BRANCHES THAT DECIDE ARE ASKED.** Per plan that is the unsettled
 * branches of the first slice that is not complete ({@link blockingBranches}).
 * When every one of them landed, the next slice is asked in the same pass, so a
 * plan whose earlier slices all merged reaches its queued slice in one pass.
 *
 * **A MERGED INDEX ROW ANSWERS FOR NO CALL**, and a known number costs one
 * lookup, at most {@link VIEWS_PER_PASS} per pass. A branch past the cap reads
 * `unknown`; a branch with no number is left to the per-branch question. Either
 * way it stays unsettled, so the slices behind it stay held. Nothing is
 * promoted on a lookup that did not answer.
 *
 * It writes nothing. The board's refresh is the only writer of the PR index.
 *
 * @param plans - every plan on the estate.
 * @param merged - the heads the listing named; landed branches are added to it.
 * @param provenFor - the branches a merge subject proves, per plan. A proven
 *   branch is settled for its own plan only, and is asked nothing.
 * @param world - what to read the estate through.
 * @returns the answers taken by index row or by number, keyed by branch.
 */
const landedWithoutListing = async (
  plans: readonly PlanRecord[],
  merged: Set<string>,
  provenFor: (plan: PlanRecord) => ReadonlySet<string>,
  world: QueueWorld,
): Promise<ReadonlyMap<string, LandedAnswer>> => {
  const answered = new Map<string, LandedAnswer>();
  const rows = await world.prIndexRows();
  let views = 0;
  for (const plan of plans) {
    const proven = provenFor(plan);
    // THE ORDER'S OWN RULE: merged-only, as `planQueue` reads it. A claimed
    // branch still blocks this walk exactly as it blocks the queue's order.
    const landedHere = (branch: string): boolean =>
      settled(branch, merged) || proven.has(branch);
    const slices = plan.slices.map((slice: PlanRecordSlice) => slice.branches);
    for (;;) {
      const needed = blockingBranches(plan.phase, slices, landedHere);
      let moved = needed.length > 0;
      for (const branch of needed) {
        const known = knownPrFor(rows, branch);
        const source = landedSource(false, known);
        let answer: LandedAnswer | null = null;
        if (source === 'index') answer = 'landed';
        else if (source === 'number') {
          // PAST THE CAP A KNOWN NUMBER READS `unknown`. It is not sent to the
          // per-branch question, which asks the same listing that just failed.
          answer = views < VIEWS_PER_PASS ? await world.viewLanded(known.number as number) : 'unknown';
          views += 1;
        }
        if (answer !== null) answered.set(branch, answer);
        if (answer === 'landed') merged.add(branch);
        else moved = false;
      }
      if (!moved) break;
    }
  }
  return answered;
};

/**
 * The one process word {@link isAgentFree} tests, plus the one desk word that
 * withholds it.
 *
 * **`running` AND `waiting` ARE THE ONLY TWO THAT MATTER HERE**, and the rule
 * says why: it tests `state !== 'running'` and nothing else, so every other
 * process word is already refused by not being `running`. `waiting` is spelled
 * out because it is the one case where a LIVE process must not be handed work
 * — the agent is blocked on a person, holds a machine slot, and can take
 * nothing. `whyNotFree` prints it, so a reader gets *blocked on a person*
 * rather than *holds feature/x*.
 *
 * @param entry - the agent's manifest.
 * @param world - what to read the estate through.
 * @returns `running`, `waiting`, or `none`.
 */
const stateOf = async (entry: AgentEntry, world: QueueWorld): Promise<string> => {
  if (!(await world.workerAlive(entry.worktree))) return 'none';
  return (await world.blocked(entry.worktree)) ? 'waiting' : 'running';
};

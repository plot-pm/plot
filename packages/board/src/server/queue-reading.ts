import { sliceVerdicts } from '@plot-pm/domain/rules/eligible';
import type { QueueAgent, QueueReadings, QueuedSlice } from '@plot-pm/domain/rules/queue';
import type { LandedAnswer } from '@plot-pm/domain/rules/landed';
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
  /** Whether a worker process is alive in this desk. */
  workerAlive(worktree: string): Promise<boolean>;
  /** Whether the desk carries a `PLOT-BLOCKED*` marker. */
  blocked(worktree: string): Promise<boolean>;
}

/**
 * The plan slug, as `plot-dispatch.sh` resolves it — the file's basename with
 * its date prefix and `.md` removed.
 *
 * The agent's own scope follows the slice, so the slug travels with the
 * assignment rather than being re-derived at the desk.
 *
 * @param file - the plan's path, relative to the repository root.
 * @returns the slug.
 */
export const slugOf = (file: string): string => {
  const base = (file.split('/').pop() ?? file).replace(/\.md$/, '');
  return base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
};

/**
 * Derives the queue from one plan.
 *
 * **THE ORDERING IS THE PLAN'S, AND `sliceVerdicts` OWNS IT.** A slice is
 * `eligible` only where every slice before it is `complete`, so the fold is
 * the same one the fleet scan runs — re-implementing the ordering here would
 * give the queue and the board two answers about one plan.
 *
 * A branch the plan deferred is skipped: the plan gave it up rather than
 * finishing it, so it is not work waiting for anybody.
 *
 * **IT ANSWERS NEITHER OF THE TWO ASKED READINGS**, which is what the `Omit`
 * names: the brief and the landing are questions for the machine and the host,
 * and this function reads one plan record. `readQueue` asks them, under the
 * bound documented there.
 *
 * @param plan - the plan, as the plan store parsed it.
 * @param claimed - the remote branches that exist.
 * @returns one entry per branch this plan has queued, in plan order.
 */
export const queueOfPlan = (
  plan: PlanRecord,
  claimed: ReadonlySet<string>,
): readonly Omit<QueuedSlice, 'briefPresent' | 'landed'>[] => {
  const slug = slugOf(plan.file);
  // OUTSTANDING IS COUNTED FROM THE REFS, the same reading `--offline` takes.
  // A branch with a ref has been started by somebody; one without has not.
  const verdicts = sliceVerdicts(
    plan.slices.map((slice: PlanRecordSlice) => ({
      outstanding: slice.branches.filter(
        (line) => !line.deferred && !claimed.has(line.branch),
      ).length,
      phase: plan.phase,
    })),
  );

  const queued: Omit<QueuedSlice, 'briefPresent' | 'landed'>[] = [];
  plan.slices.forEach((slice: PlanRecordSlice, index: number) => {
    const claimable = verdicts[index] === 'eligible';
    for (const line of slice.branches) {
      if (line.deferred) continue;
      // A CLAIMED BRANCH IS OUT OF THE QUEUE, and that is the derivation
      // rather than a filter over it: the ref is what says somebody took the
      // slice, and it is the same fact `isClaimable` reads as `state === 'open'`.
      if (claimed.has(line.branch)) continue;
      queued.push({ branch: line.branch, slug, claimable });
    }
  });
  return queued;
};

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

  const slices: QueuedSlice[] = [];
  for (const plan of plans) {
    for (const entry of queueOfPlan(plan, claimed)) {
      const briefPresent = entry.claimable ? await world.briefPresent(entry.branch) : false;
      slices.push({
        ...entry,
        briefPresent,
        landed:
          entry.claimable && briefPresent
            ? await world.queuedHasLanded(entry.branch)
            : 'not-landed',
      });
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

  return { slices, agents };
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

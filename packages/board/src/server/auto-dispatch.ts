import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { BuildBoardOptions } from './board.js';
import type { FleetSettings } from './fleet-settings.js';
import { LIVE_STATES, type SourceBranch, type FleetPulse } from '../contract/schema.js';
import {
  isFree,
  dispatchDefers,
  deferralMessage,
  hasRoomToDispatch,
  type Machine as MachineEntity,
} from '@plot-pm/domain';
import type { AgentEntry } from './registry.js';
import { dispatchLogPath } from './dispatch.js';

/**
 * WAVE 3: the switch does something.
 *
 * Waves 1 and 2 made the fleet controls a stored intention nobody read. This is
 * the reader. While `autoDispatch` is on, eligible waves of approved plans fan
 * out with no click, wrapping `plot-dispatch.sh` — which still owns the claim,
 * the abandoned-desk refusal, the in-flight file report and the worktree
 * fan-out, so every refusal that protects a watched dispatch protects an
 * unwatched one.
 *
 * ## NOT a route, by construction
 *
 * This rides the SCAN's clock inside `refresh`'s success path, called right
 * after `maybeRepair` — the board's first "one automatic write". It is the
 * second of that same kind: on the scan's timer, from a pulse that actually
 * landed (a dispatch from a failed scan would act on refs that may have moved),
 * and off the request path entirely. It never becomes an `/api/*` route, so it
 * joins no `WRITE_ROUTES` list and reuses no same-origin guard: there is
 * nothing to reach.
 *
 * ## The cross-pulse cap — the hard part
 *
 * `--max N` bounds ONE invocation of the script. Two pulses each passing N reach
 * 2N live workers, which is the property `--max` alone cannot promise. So each
 * pulse the board counts what is already live and dispatches only the
 * DIFFERENCE: `parallelAgents − live`. See {@link liveAgentCount} for what
 * "live" means, and {@link planAutoDispatch} for the split across plans.
 *
 * ## Never kill; lowering only withholds the next dispatch
 *
 * The control governs STARTING, not stopping. Lowering `parallelAgents` or
 * turning the switch off shrinks or zeros the next pulse's budget and touches no
 * running worker — a half-done branch killed mid-run leaves uncommitted work
 * nobody can see. A budget that has gone negative (the cap was lowered below the
 * live count) clamps to zero: nothing new starts, everything running keeps
 * running.
 */

/** One plan to fan out this pulse, and the per-invocation `--max` to pass it. */
export interface AutoDispatchPlan {
  /** The plan slug, as `plot-dispatch.sh` resolves it — see {@link planSlug}. */
  slug: string;
  /**
   * The `--max` for THIS invocation: at most this many branches start. Always
   * ≥ 1 (a plan with a zero budget is not named at all) and never more than the
   * plan has startable branches, so the script's own fan-out cannot exceed the
   * board's remaining budget even if the plan gained branches since the pulse.
   */
  max: number;
}

/**
 * The plan slug `plot-dispatch.sh` will use to find the plan file — the basename
 * with its `YYYY-MM-DD-` prefix and `.md` suffix stripped, the exact spelling
 * the `/api/dispatch` route already sends and `deriveWaves` writes into a row's
 * `plan`.
 */
export function planSlug(file: string): string {
  return path.basename(file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
}

/**
 * The states that OCCUPY A SLOT are exactly the LIVE ones — {@link LIVE_STATES},
 * imported from the contract rather than restated here.
 *
 * The cap is measured against the same set the board's WORKING section renders,
 * so the dispatcher and the board cannot drift on what a worker is. Starting
 * another agent against the cap while one merely `waits` would let the fleet
 * exceed the stepper the moment a worker paused, which is why `waiting` counts;
 * `finished`, `stalled` and `unknown` do not.
 *
 * @see LIVE_STATES for why the definition lives in `schema.ts` and not here.
 */

/**
 * How many registry entries occupy a concurrency slot right now.
 *
 * Read from the registry the scan just refreshed, so it is this pulse's liveness
 * and not a stale one. It is HALF of the budget denominator; the other half is
 * the in-flight set of branches dispatched but not yet visible here — see
 * {@link planAutoDispatch}.
 *
 * A live agent ALWAYS occupies a slot, even if its branch has already merged.
 * The pulse argument is kept for API compatibility but no longer affects the
 * count — every live agent consumes a machine (CPU, memory, worktree) regardless
 * of what its branch did.
 *
 * Measured 2026-08-25: eleven workers whose branches had merged sat at zero CPU
 * for up to ten hours, none counted against the cap (bug/a-landed-branch-still-
 * holds-a-slot). The "liveness takes two facts" rule inverted the defect: it
 * excluded landed agents and let the fleet grow unbounded.
 *
 * This is the simpler rule: a live agent counts. The loop's timeout
 * (bug/the-loop-bounds-its-child) is what makes hung agents exit; excluding them
 * from the count only hid them from the cap while they held their machines.
 */
export function liveAgentCount(agents: AgentEntry[], _pulse?: FleetPulse): number {
  return agents.filter((a) => LIVE_STATES.has(a.state)).length;
}

/**
 * The branches that occupy concurrency slots right now — the names behind
 * {@link liveAgentCount}'s number.
 *
 * Returned when auto-dispatch refuses at the cap so the refusal names what
 * holds the slots, not just how many are held. A count says "you're at the
 * cap"; the branches say "these agents are the cap".
 *
 * MUST stay consistent with {@link liveAgentCount} — the two must not diverge.
 * The refusal message explains the number. See bug/a-landed-branch-still-holds-
 * a-slot plan requirement #10.
 */
export function liveAgentBranches(agents: AgentEntry[], _pulse?: FleetPulse): string[] {
  return agents
    .filter((a) => LIVE_STATES.has(a.state))
    .map((a) => a.branch)
    .filter((b): b is string => Boolean(b));
}

/**
 * The branches this pulse reports as landed — the source for `isFree`'s
 * `sliceHasMerged` argument.
 *
 * READ FROM THE PULSE, NEVER ASKED OF THE HOST. The scan already pays the host
 * round trip once and publishes `state: 'merged'` per branch; asking again per
 * agent would spend a request per pulse per agent to re-learn a fact already in
 * hand. `isFree` takes the answer as an argument precisely so the caller can
 * source it from whatever it already knows.
 *
 * A branch the pulse does not mention is absent from the set, so `isFree` sees
 * `false` for it — an agent on a branch nothing reports as merged is treated as
 * still holding it. Silence is never taken as landed.
 */
export function mergedBranches(pulse: FleetPulse): Set<string> {
  const merged = new Set<string>();
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        if (b.state === 'merged') merged.add(b.branch);
      }
    }
  }
  return merged;
}

/**
 * How many live agents could take a slice right now — {@link isFree} counted
 * over the registry, with `sliceHasMerged` sourced from the pulse.
 *
 * THE SECOND QUESTION, NOT A REPLACEMENT FOR THE FIRST. {@link liveAgentCount}
 * answers *does this agent consume a machine?* and protects the cap;  this
 * answers *can this agent take a slice?* and protects against waiting for a slot
 * that is already free. A landed-branch agent is **occupied and free at once**,
 * so both answers are true of it and neither is redundant.
 *
 * Merging the two reintroduces a measured defect. Measured 2026-08-25: eleven
 * workers whose branches had merged sat at zero CPU for up to ten hours, none
 * counted against the cap (bug/a-landed-branch-still-holds-a-slot) — the
 * "liveness takes two facts" rule excluded landed agents and let the fleet grow
 * unbounded. This function adds a READER and changes no arithmetic.
 *
 * `waiting` is not free: it is live and blocked on a person, so it holds a slot
 * and can take nothing. That rule lives in `isFree` and is not restated here.
 */
export function freeAgentCount(agents: AgentEntry[], pulse: FleetPulse): number {
  return freeAgents(agents, pulse).length;
}

/**
 * The branches behind {@link freeAgentCount}'s number — what a dispatch names
 * when it proceeds against a free agent rather than an empty slot.
 *
 * MUST stay consistent with {@link freeAgentCount}, for the same reason
 * {@link liveAgentBranches} must stay consistent with {@link liveAgentCount}:
 * the count is the decision and the names are the explanation, so a divergence
 * makes the message describe a different fleet than the one that was counted.
 *
 * An agent between slices holds no branch, so it contributes `(between slices)`
 * rather than an empty string — the reason a slot is reusable is worth reading.
 */
export function freeAgentLabels(agents: AgentEntry[], pulse: FleetPulse): string[] {
  return freeAgents(agents, pulse).map((a) => a.branch || '(between slices)');
}

/**
 * The live agents that can take a slice — the one place `isFree` is asked, so
 * the count and the names cannot answer differently.
 */
function freeAgents(agents: AgentEntry[], pulse: FleetPulse): AgentEntry[] {
  const merged = mergedBranches(pulse);
  // `isFree` reads `state` and `branch` only, and an `AgentEntry` carries both
  // with the same meanings — so the registry entry answers the domain's
  // question directly, with no cast between two state vocabularies that are
  // not in fact the same set.
  return agents.filter((a) => isFree(a, merged.has(a.branch)));
}

/**
 * A branch the pulse shows as still startable — open or wip, not yet claimed,
 * merged or deferred. The claim ref is the one mechanism that makes a taken
 * branch safe, and the pulse reflects it as `state: 'claimed'`; a startable
 * branch is one no ref has taken and no merge has closed.
 *
 * STATE-ONLY, and it stays that way. `wip` means *there is work here*, and
 * accepting it is deliberate — a wave someone began and abandoned should be
 * resumable. This is the ROW predicate's original purpose and the client's
 * `isStartable(row)` keeps the same shape; auto-dispatch layers a second
 * question on top of it in {@link dispatchable}, never inside here.
 */
function isStartable(state: string): boolean {
  return state === 'open' || state === 'wip';
}

/**
 * Whether the branch's own ref already blocks a claim `plot-dispatch.sh` would
 * try to push — the difference between *is there work here?* and *would spawning
 * a dispatch change anything?*.
 *
 * `plot-dispatch.sh` claims by pushing an empty commit and REFUSES a
 * non-fast-forward against a ref that is already there — Plot's whole locking
 * mechanism. So auto-dispatch spending budget on a branch whose ref exists buys
 * a dispatch the script immediately discards, every pulse, forever.
 *
 * THE FIX FOR `a-claimed-branch-is-not-startable`. Before this wave, the check
 * was `state === 'wip'`, which ASSUMES a ref because `wip` is derived by walking
 * `origin/<branch>`. But a branch can be `open` (no work commits) AND have a
 * claim ref — three of four branches measured in the plan had that exact shape.
 * A dispatch against `open` with a ref is refused identically.
 *
 * Now the check reads `ref_held` directly: the fact the scan publishes, derived
 * from the same refs `plot-dispatch.sh` checks. The two answers are now the same
 * question asked of the same source.
 *
 * DEFENSIVE: `state === 'wip'` remains as a fallback. A pulse from a scan
 * predating `ref_held` reports false for every branch (the schema default), so
 * the old `wip` logic keeps working until the scan is updated. The fallback is
 * one-directional: it can only ADD refusals, never remove one `ref_held` would
 * have made.
 */
function refBlocksClaim(branch: SourceBranch): boolean {
  // Primary: ref_held is the direct answer from the scan.
  // Fallback: state === 'wip' implies a ref (derived from walking it).
  return branch.ref_held || branch.state === 'wip';
}

/**
 * Would a dispatch of this branch this pulse actually claim it? Startable AND
 * not already blocked by its own ref. This, not {@link isStartable}, is the
 * question auto-dispatch spends budget against — see {@link refBlocksClaim}.
 */
function dispatchable(branch: SourceBranch): boolean {
  return isStartable(branch.state) && !refBlocksClaim(branch);
}

export interface PlanAutoDispatchInput {
  controls: FleetSettings;
  pulse: FleetPulse;
  /**
   * This pulse's machine reading, for the OTHER question a dispatch asks: not
   * *is an agent free* but *has the machine room*. See {@link machineDefers}.
   *
   * A READING, not a port — the caller measures and passes the value, so this
   * function stays pure and synchronous. Absent means the question was not
   * asked, which dispatches: silence is never a refusal.
   */
  machine?: MachineEntity;
  /** Live registry entries this pulse — see {@link liveAgentCount}. */
  liveCount: number;
  /**
   * The registry this pulse, for the SECOND question a dispatch asks: not *how
   * many slots are taken* but *can any agent take a slice?* — see
   * {@link freeAgentCount}.
   *
   * Optional, and absent means no free agent rather than an error: a caller
   * that does not pass it gets exactly the cap-only behaviour that predates
   * this field. `liveCount` stays a separate input and is NOT re-derived from
   * this list — the two counts answer different questions and the caller has
   * already computed the first.
   */
  agents?: AgentEntry[];
  /**
   * Branches this board has dispatched whose claim/manifest the pulse cannot yet
   * confirm. `plot-dispatch.sh` is spawned detached, so a branch dispatched last
   * pulse may show neither a manifest nor a claim ref on the next one; counting
   * only the registry would dispatch it a second time and reach 2N. These count
   * against the budget AND are removed from the startable set, so an in-flight
   * branch is neither re-dispatched nor double-charged.
   */
  inFlight: Set<string>;
  /**
   * Branches whose brief does not exist on `origin/main`. A wave with no brief
   * is not started — see `a-worker-starts-with-its-brief.md`.
   *
   * INJECTED, not computed here, so `planAutoDispatch` stays pure. The caller
   * reads git once per pulse and passes the set; this function treats it as any
   * other exclusion filter.
   */
  missingBriefs: Set<string>;
}

/**
 * Decide which plans to fan out this pulse, and with what per-plan `--max`.
 *
 * PURE — no spawn, no disk, no clock. Every output is a function of its inputs,
 * which is what lets the cross-pulse cap be asserted over repeated calls in a
 * unit test rather than through a live fleet.
 *
 * A dispatch asks TWO questions, and a refusal names which one failed: *is
 * there a slot?* (`parallelAgents` against the live count) and *is there a free
 * agent?* ({@link freeAgentCount}). A spent budget falls through to the second,
 * because an agent between slices or holding a landed branch can take work now
 * on a slot already paid for. The cap is never raised by it — see the fall-
 * through comment in the body.
 *
 * The budget is `parallelAgents − (liveCount + inFlight.size)`, clamped at zero.
 * It is spent across approved plans' eligible waves in document order, each plan
 * taking `min(remaining budget, its startable branches not already in flight)`,
 * and a plan that would take zero is not named at all. The SUM of every returned
 * `max` never exceeds the budget — that sum, held below the cap across every
 * pulse, is the property the whole wave exists to guarantee.
 */
/**
 * Whether the machine is clear enough that a dispatch costs nothing to explain.
 *
 * THE OTHER MACHINE QUESTION, and it is not the gate. {@link hasRoomToDispatch}
 * is true only on `clear`, so a `tight` machine answers false here and
 * dispatches anyway — `tight` is fit to work on, and only `starved` defers.
 * The two are kept apart for the same reason `liveAgentCount` and `isFree` are:
 * *is the machine clear?* and *should a dispatch wait?* are different
 * questions, and collapsing them would stop the fleet on every `tight` reading.
 *
 * Used to say so in the log: a dispatch proceeding on a non-clear machine is
 * worth one sentence, because it is the reading an operator wants when the
 * fleet feels slow and nothing is refusing.
 *
 * @returns true when the reading exists and is `clear`.
 */
export function machineIsClear(machine: MachineEntity | undefined): boolean {
  return machine !== undefined && hasRoomToDispatch(machine);
}

/**
 * Whether this pulse's machine reading defers a dispatch, and what it measured.
 *
 * THE OVERRIDE LIVES HERE, because §10 of `DESIGN-machine.md` makes this a
 * deferral and not a veto: *"the operator can always say now anyway — and that
 * is what keeps this a deferral rather than a veto."* `machineOverride` is that
 * sentence in code; when it is set the reading is still measured and still
 * logged, and it simply stops gating.
 *
 * ABSENT DISPATCHES. No reading means the question was not asked, which is the
 * `unmeasured` case by another route — and `unmeasured` dispatches, because a
 * reading nobody can date is not evidence of harm. Silence is never a refusal.
 *
 * Only `starved` defers. `tight` does not, which is why this asks
 * {@link dispatchDefers} rather than negating `hasRoomToDispatch` — that
 * function answers *is the machine clear?* and `tight` fails it while still
 * being fit to work on.
 *
 * @returns the deferral sentence when a dispatch should wait, else null.
 */
export function machineDefers(
  machine: MachineEntity | undefined,
  controls: FleetSettings,
): string | null {
  if (!machine) return null;
  if (controls.machineOverride) return null;
  if (!dispatchDefers(machine)) return null;
  return deferralMessage(machine);
}

export function planAutoDispatch(input: PlanAutoDispatchInput): AutoDispatchPlan[] {
  const { controls, agents = [], pulse, liveCount, inFlight, missingBriefs, machine } = input;
  if (!controls.autoDispatch) return [];

  // THE MACHINE QUESTION, beside the budget and before it is spent. A dispatch
  // asks two things — *is an agent free* and *has the machine room* — and this
  // is the second. See {@link machineDefers} for why only `starved` defers and
  // why an absent reading does not.
  //
  // TODO(decision): does a starved reading also stop the free-agent
  // fall-through below? See the discussion in the PR.
  if (machineDefers(machine, controls)) return [];

  let budget = controls.parallelAgents - (liveCount + inFlight.size);

  // AT THE CAP IS NOT THE SAME ANSWER AS NO FREE AGENT, and this is where the
  // two part. The slot budget being spent says every machine is held; it does
  // NOT say every agent is busy. An agent between slices, or one whose branch
  // has landed, is running and can take the next unit of work right now — its
  // slot is already paid for.
  //
  // So a spent budget falls through to the free agents rather than refusing:
  // the fleet reuses a slot it already holds instead of waiting for one to be
  // released. `parallelAgents` is still the ceiling — a free agent is an
  // EXISTING slot, never an extra one — which is why the budget becomes the
  // free count and is not added to it. Adding them would raise the cap and
  // re-invert bug/a-landed-branch-still-holds-a-slot (2026-08-25).
  if (budget <= 0) {
    budget = freeAgentCount(agents, pulse);
    if (budget <= 0) return [];
  }

  const plans: AutoDispatchPlan[] = [];
  for (const plan of pulse.plans) {
    if (budget <= 0) break;
    // Only approved plans. The script gates on this too (it refuses a Draft),
    // but naming a Draft here would spend budget on a spawn the script rejects,
    // so the phase is read from the pulse first.
    if (plan.phase !== 'approved') continue;

    // Every startable branch across this plan's ELIGIBLE waves, minus the ones
    // already in flight or missing a brief. A blocked or complete wave
    // contributes nothing: the scan's verdict is the eligibility arithmetic,
    // not re-derived here.
    let startable = 0;
    for (const wave of plan.slices) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        // `dispatchable`, not `isStartable`: a branch whose ref already exists
        // is one a dispatch cannot claim, so naming its plan spends budget on a
        // spawn the script refuses — see {@link refBlocksClaim}.
        // A branch with no brief is excluded too — the worker would spend its
        // first hour re-deriving what the brief already says.
        if (
          dispatchable(b) &&
          !inFlight.has(b.branch) &&
          !missingBriefs.has(b.branch)
        ) {
          startable += 1;
        }
      }
    }
    if (startable === 0) continue;

    const max = Math.min(budget, startable);
    plans.push({ slug: planSlug(plan.file), max });
    budget -= max;
  }
  return plans;
}

/**
 * The branches an eligible wave of an approved plan currently offers to start —
 * the set that should enter `inFlight` when this pulse's plan is dispatched.
 *
 * Kept beside the planner because both read the same "startable, eligible,
 * approved, not-yet-in-flight" rule, and a second spelling of it is a second
 * place for the two to disagree about what a dispatch will claim. The spawn side
 * marks these in flight so the NEXT pulse counts them before the detached script
 * has pushed their refs.
 */
export function startableBranches(
  pulse: FleetPulse,
  slug: string,
  inFlight: Set<string>,
  missingBriefs: Set<string> = new Set(),
): string[] {
  const out: string[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase !== 'approved') continue;
    if (planSlug(plan.file) !== slug) continue;
    for (const wave of plan.slices) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        // The spawn side must mark exactly what a dispatch will claim, so this
        // uses the same `dispatchable` rule the planner counts by: a ref-held
        // branch is refused, so it is neither dispatched nor marked in flight.
        // A branch with no brief is excluded too.
        if (
          dispatchable(b) &&
          !inFlight.has(b.branch) &&
          !missingBriefs.has(b.branch)
        ) {
          out.push(b.branch);
        }
      }
    }
  }
  return out;
}

/**
 * The branches auto-dispatch DECLINED to start because their own ref already
 * blocks a claim — `ref_held` is true. See {@link refBlocksClaim}.
 *
 * Named across every approved plan's eligible waves so the refusal can be
 * reported once per pulse: a budget that buys nothing is the failure this wave
 * removes, and a budget WITHHELD for a stated reason is a decision the operator
 * can act on. Skips branches already in flight — those are this board's own
 * dispatches, not a claim it is declining.
 */
export function skippedClaimedBranches(pulse: FleetPulse, inFlight: Set<string>): string[] {
  const out: string[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase !== 'approved') continue;
    for (const wave of plan.slices) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        if (refBlocksClaim(b) && !inFlight.has(b.branch)) out.push(b.branch);
      }
    }
  }
  return out;
}

/**
 * All branches that auto-dispatch would consider starting this pulse — the
 * candidates whose briefs must exist before a dispatch is allowed.
 *
 * Returns every dispatchable branch across approved plans' eligible waves, minus
 * those already in flight. The result is the set `findMissingBriefs` checks.
 */
export function dispatchCandidates(pulse: FleetPulse, inFlight: Set<string>): string[] {
  const out: string[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase !== 'approved') continue;
    for (const wave of plan.slices) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        if (dispatchable(b) && !inFlight.has(b.branch)) out.push(b.branch);
      }
    }
  }
  return out;
}

/**
 * The brief path for a branch — `.plot/briefs/<slug>.md`, where slug is the
 * branch name after its last `/`. This is the convention `/plot-implement`
 * writes and the `Worker command` reads.
 */
export function briefPath(branch: string): string {
  const slug = branch.split('/').pop() ?? branch;
  return `.plot/briefs/${slug}.md`;
}

/**
 * Branches from `candidates` whose brief does not exist on `origin/main`.
 *
 * Reads git, not the filesystem, so the board cannot be wrong about main
 * even when its own checkout lags. Measured cost: ~8-27 ms per branch, so
 * 11 candidates cost ~100-300 ms against the 5 s pulse cadence — affordable.
 *
 * The spike's numbers (2026-08-26): a board checkout 20+ commits behind held
 * 150 briefs where main held 157. Three briefs that exist would have read as
 * missing under a filesystem check. This is why we read git.
 *
 * @param repoRoot The repository root where git is run
 * @param candidates Branches to check
 * @returns The subset of candidates whose brief is missing
 */
export function findMissingBriefs(repoRoot: string, candidates: string[]): Set<string> {
  const missing = new Set<string>();
  for (const branch of candidates) {
    const gitPath = `origin/main:${briefPath(branch)}`;
    try {
      // `git cat-file -e` exits 0 if the object exists, non-zero otherwise.
      // spawnSync is synchronous, which is fine: we're already on the scan's
      // success path and the cost is measured and bounded.
      const result = spawnSync('git', ['cat-file', '-e', gitPath], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      if (result.status !== 0) {
        missing.add(branch);
      }
    } catch {
      // If git fails entirely, treat as missing — the worker would face the
      // same problem.
      missing.add(branch);
    }
  }
  return missing;
}

/**
 * The branches whose in-flight mark can be RETIRED: the pulse now confirms them
 * one way or another. A branch stays in flight only while the board cannot see
 * what its dispatch did; once the pulse reports it claimed, merged, gone from
 * every plan, or a live registry entry holds it, the mark has served its purpose
 * and keeping it would over-charge the budget forever.
 *
 * Returns the pruned set rather than mutating in place, so the caller decides
 * when to install it — the same one-directional discipline the rest of the cache
 * keeps.
 */
export function pruneInFlight(
  inFlight: Set<string>,
  pulse: FleetPulse,
  agents: AgentEntry[],
): Set<string> {
  if (inFlight.size === 0) return inFlight;
  // A branch the pulse still shows as startable in an eligible wave, and which
  // no live registry entry holds, is one whose dispatch has not landed yet — it
  // stays in flight. Everything else is confirmed and drops.
  const stillPending = new Set<string>();
  const liveBranches = new Set(
    agents.filter((a) => LIVE_STATES.has(a.state) && a.branch).map((a) => a.branch),
  );
  for (const branch of inFlight) {
    if (liveBranches.has(branch)) continue; // the registry caught up — confirmed
    let stillStartable = false;
    for (const plan of pulse.plans) {
      for (const wave of plan.slices) {
        for (const b of wave.branches) {
          // Still open in the pulse AND not yet claimed: the claim ref this
          // dispatch pushes has not appeared, so the mark still stands.
          if (b.branch === branch && isStartable(b.state)) stillStartable = true;
        }
      }
    }
    if (stillStartable) stillPending.add(branch);
  }
  return stillPending;
}

/**
 * Fan out this pulse's plan of dispatches, detached, and return the branches
 * newly put in flight so the caller can fold them into the cache's set.
 *
 * Each plan is ONE `plot-dispatch.sh --max <n> <slug>` — the script fans out up
 * to `n` of its own eligible branches, claiming each by ref push. Detached and
 * unwaited, exactly as `/api/dispatch` spawns it: a dispatch creates a worktree
 * and pushes a claim, strictly slower than the scan that must not block on it.
 * Output goes to the same per-slug dispatcher log the route writes, so an
 * operator reads one file whether the dispatch was clicked or automatic.
 *
 * The branches marked in flight are the plan's startable ones, capped at the
 * invocation's `max`: the script may start fewer (a branch may lose its claim
 * race), and over-marking would only make the board briefly more conservative,
 * never less — the safe direction. They are retired by {@link pruneInFlight}
 * once the pulse confirms them.
 */
export function runAutoDispatch(
  opts: BuildBoardOptions,
  pulse: FleetPulse,
  plans: AutoDispatchPlan[],
  inFlight: Set<string>,
  missingBriefs: Set<string> = new Set(),
): string[] {
  const newlyInFlight: string[] = [];
  for (const plan of plans) {
    const log = dispatchLogPath(opts.repoRoot, plan.slug);
    let out: number;
    try {
      out = fs.openSync(log, 'a');
    } catch (err) {
      console.error(`auto-dispatch could not open ${log}:`, err);
      continue;
    }
    const child = spawn(
      'bash',
      [path.join(opts.scriptsDir, 'plot-dispatch.sh'), '--max', String(plan.max), plan.slug],
      { cwd: opts.repoRoot, detached: true, stdio: ['ignore', out, out] },
    );
    child.on('error', (err) => console.error('auto-dispatch failed to spawn:', err));
    child.unref();
    fs.closeSync(out);

    // Mark the branches this invocation may claim so the next pulse counts them
    // before the detached script has pushed their refs. Capped at `max`: the
    // script starts at most that many.
    const branches = startableBranches(pulse, plan.slug, inFlight, missingBriefs).slice(0, plan.max);
    newlyInFlight.push(...branches);
  }
  return newlyInFlight;
}

/**
 * Decide and dispatch in one call — the whole of auto-dispatch as `refresh` sees
 * it. Reads the controls fresh (a switch flipped this pulse takes effect now),
 * counts liveness from the registry the scan just refreshed, plans against the
 * budget, spawns, and returns the in-flight set the cache should hold next
 * pulse.
 *
 * The returned set is the pruned old set plus the newly dispatched branches, so
 * the caller assigns it whole rather than mutating — the cache's one-directional
 * rule.
 *
 * AT THE CAP, REFUSES AND NAMES THE BRANCHES. Refusing silently is what made
 * the cap invisible — see `a-worker-asks-for-the-next-wave.md`, "Counted" wave.
 * The log line names the branches occupying the slots, not just the count.
 */
export function maybeAutoDispatch(
  opts: BuildBoardOptions,
  pulse: FleetPulse,
  controls: FleetSettings,
  agents: AgentEntry[],
  inFlight: Set<string>,
  machine?: MachineEntity,
): Set<string> {
  const pruned = pruneInFlight(inFlight, pulse, agents);
  const liveCount = liveAgentCount(agents, pulse);

  // THE MACHINE DEFERS, AND IT SAYS WHAT IT MEASURED. Logged before the cap
  // arithmetic because it outranks it: a starved machine is not a full one, and
  // an operator reading "at cap" while the real answer is "spawn cost 287 ms"
  // would raise the dial and make it worse.
  //
  // `"too much load"` is not answerable and load average is never the verdict;
  // the sentence carries the number so a person can act on it — including by
  // setting `Machine override` and saying now anyway.
  if (controls.autoDispatch) {
    const deferral = machineDefers(machine, controls);
    if (deferral) {
      const hasEligible = pulse.plans.some(
        (p) => p.phase === 'approved' && p.slices.some((w) => w.verdict === 'eligible'),
      );
      // Same rule as the cap refusal: a deferral with nothing to dispatch is
      // routine, not a decision anybody needs to read every five seconds.
      if (hasEligible) console.log(`auto-dispatch: ${deferral}`);
      return pruned;
    }
    // NOT CLEAR, BUT NOT STARVED EITHER — the `tight` band, which dispatches.
    // Said out loud because a fleet that feels slow while nothing refuses is
    // the case an operator otherwise has no reading for; this is the one line
    // that distinguishes *the machine is working hard* from *Plot is stuck*.
    if (machine && !machineIsClear(machine) && !dispatchDefers(machine)) {
      console.log(
        `auto-dispatch: machine reads ${machine.headroom} ` +
        `(spawn cost ${machine.spawnCostMs?.toFixed(1) ?? 'unmeasured'} ms); dispatching anyway`,
      );
    }
  }

  // Check if we're at the cap BEFORE calling planAutoDispatch, so we can log
  // meaningfully. The switch being off is a deliberate absence, not a refusal;
  // the cap being reached is what needed visibility.
  if (controls.autoDispatch) {
    const budget = controls.parallelAgents - (liveCount + pruned.size);
    if (budget <= 0) {
      // THE SAME ARITHMETIC AND THE SAME SECOND QUESTION as `planAutoDispatch`.
      // These two must not diverge: this branch decides whether to log a
      // refusal, and the planner decides whether to dispatch. If this refused
      // where the planner dispatches, the board would print "refusing" on the
      // pulse it started a worker.
      const free = freeAgentCount(agents, pulse);
      if (free <= 0) {
        const liveBranches = liveAgentBranches(agents, pulse);
        const inFlightList = [...pruned];
        // Only log when there IS something to dispatch — a cap hit with no
        // eligible work is routine, not a refusal.
        const hasEligible = pulse.plans.some(
          (p) => p.phase === 'approved' && p.slices.some((w) => w.verdict === 'eligible'),
        );
        if (hasEligible) {
          // NAMES WHICH OF THE TWO IT IS. "At the cap" alone was ambiguous
          // between *every machine is held* and *nobody can take work*; the
          // second clause is what tells a reader whether waiting will help.
          console.log(
            `auto-dispatch: at cap (${controls.parallelAgents}) and no free agent, ` +
            `refusing new dispatch. Slots held by: ` +
            `${[...liveBranches, ...inFlightList].join(', ') || '(in-flight only)'}`,
          );
        }
        return pruned;
      }
      // At the cap, but an agent can take a slice — the slot is already paid
      // for, so this is not a refusal and the planner proceeds below.
      console.log(
        `auto-dispatch: at cap (${controls.parallelAgents}) but ${free} free ` +
        `agent(s) can take a slice: ${freeAgentLabels(agents, pulse).join(', ')}`,
      );
    }
  }

  // NAMES A CLAIMED BRANCH IT SKIPPED, ONCE PER PULSE. A `wip` branch whose ref
  // already exists cannot be claimed — `plot-dispatch.sh` refuses it — so the
  // budget is withheld rather than spent on a refusal (the measured defect,
  // 2026-08-25). Silently withholding it is what made the budget look broken:
  // the only recourse was to replay the planner by hand against the pulse JSON.
  // Logged here, off the cap path, so a cap refusal and a claim skip are two
  // distinct sentences and neither repeats the other. One call per pulse.
  if (controls.autoDispatch) {
    const skipped = skippedClaimedBranches(pulse, pruned);
    if (skipped.length > 0) {
      console.log(
        `auto-dispatch: skipping claimed branch(es) a dispatch cannot start ` +
        `(ref already exists): ${skipped.join(', ')}`,
      );
    }
  }

  // Check which dispatchable branches lack a brief on origin/main. A wave with
  // no brief is not started — see `a-worker-starts-with-its-brief.md`.
  //
  // This is the impure side: `findMissingBriefs` spawns `git cat-file -e` per
  // candidate. The cost is ~8-27 ms per branch (measured 2026-08-26), so 11
  // candidates add ~100-300 ms to the pulse — affordable against the 5 s cadence.
  //
  // The check reads `origin/main`, not the filesystem, so the board cannot be
  // wrong about main even when its own checkout lags. The spike measured a
  // checkout 20+ commits behind main, missing 7 briefs — filesystem reads would
  // have refused starts that should have happened.
  const candidates = controls.autoDispatch ? dispatchCandidates(pulse, pruned) : [];
  const missingBriefs = controls.autoDispatch
    ? findMissingBriefs(opts.repoRoot, candidates)
    : new Set<string>();

  // Log which branches auto-dispatch is skipping for missing briefs, once per
  // pulse. Same pattern as the claimed-branch skip above: a refusal nobody sees
  // is the defect this wave removes.
  if (controls.autoDispatch && missingBriefs.size > 0) {
    const missing = [...missingBriefs];
    console.log(
      `auto-dispatch: skipping branch(es) with no brief on origin/main ` +
      `(run /plot-implement first): ${missing.join(', ')}`,
    );
  }

  const plans = planAutoDispatch({
    controls,
    pulse,
    liveCount,
    // The same reading this function already logged about, so the planner's
    // machine question and the sentence above cannot answer differently.
    machine,
    // The registry the cap was measured against, so the planner's free-agent
    // question is asked of the same fleet this function just logged about.
    agents,
    inFlight: pruned,
    missingBriefs,
  });
  if (plans.length === 0) return pruned;
  const newly = runAutoDispatch(opts, pulse, plans, pruned, missingBriefs);
  const next = new Set(pruned);
  for (const b of newly) next.add(b);
  return next;
}

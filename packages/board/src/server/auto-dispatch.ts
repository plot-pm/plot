import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { BuildBoardOptions } from './board.js';
import type { FleetControls } from './fleet-controls.js';
import { LIVE_STATES, type FleetPulse } from '../contract/schema.js';
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
 * Every branch this pulse reports as landed — merged, or deferred by the plan.
 *
 * Built once per call rather than per agent: the pulse is walked in full for a
 * membership test that every entry then asks, and the walk is over waves the
 * scan has already derived.
 */
function landedBranches(pulse: FleetPulse): Set<string> {
  const landed = new Set<string>();
  for (const plan of pulse.plans ?? []) {
    for (const wave of plan.waves ?? []) {
      for (const b of wave.branches ?? []) {
        if (b.state === 'merged' || b.deferred) landed.add(b.branch);
      }
    }
  }
  return landed;
}

/**
 * How many registry entries occupy a concurrency slot right now.
 *
 * Read from the registry the scan just refreshed, so it is this pulse's liveness
 * and not a stale one. It is HALF of the budget denominator; the other half is
 * the in-flight set of branches dispatched but not yet visible here — see
 * {@link planAutoDispatch}.
 *
 * LIVENESS TAKES TWO FACTS, NOT ONE. A live process is necessary and is not
 * sufficient: an agent whose branch has already MERGED is finished work holding
 * a handle, not capacity in use. `plot-worker-state.sh` cannot make this call —
 * it answers about the PROCESS, in its own words "six PROCESS states", and has
 * no view of whether the branch landed. The board holds both facts, so the join
 * belongs here.
 *
 * Measured 2026-08-24: seven registry entries reported a live pid, and FIVE of
 * them sat on branches whose PRs had merged hours earlier (#360, #361, #362,
 * #364, #367) — `claude` processes that outlived their work. Counting them
 * consumed five of twelve slots that nothing was using, and the fleet declined
 * to dispatch work it had room for.
 *
 * The direction is deliberate: this may only ever REMOVE an entry from the
 * count. A branch the pulse does not mention is not evidence of anything and
 * stays counted, so a scan that could not see a plan errs toward the cap rather
 * than through it.
 */
export function liveAgentCount(agents: AgentEntry[], pulse?: FleetPulse): number {
  const landed = pulse ? landedBranches(pulse) : new Set<string>();
  return agents.filter((a) => LIVE_STATES.has(a.state) && !(a.branch && landed.has(a.branch))).length;
}

/**
 * The branches that occupy concurrency slots right now — the names behind
 * {@link liveAgentCount}'s number.
 *
 * Returned when auto-dispatch refuses at the cap so the refusal names what
 * holds the slots, not just how many are held. A count says "you're at the
 * cap"; the branches say "these agents are the cap".
 */
export function liveAgentBranches(agents: AgentEntry[], pulse?: FleetPulse): string[] {
  const landed = pulse ? landedBranches(pulse) : new Set<string>();
  return agents
    .filter((a) => LIVE_STATES.has(a.state) && !(a.branch && landed.has(a.branch)))
    .map((a) => a.branch)
    .filter((b): b is string => Boolean(b));
}

/**
 * A branch the pulse shows as still startable — open or wip, not yet claimed,
 * merged or deferred. The claim ref is the one mechanism that makes a taken
 * branch safe, and the pulse reflects it as `state: 'claimed'`; a startable
 * branch is one no ref has taken and no merge has closed.
 */
function isStartable(state: string): boolean {
  return state === 'open' || state === 'wip';
}

export interface PlanAutoDispatchInput {
  controls: FleetControls;
  pulse: FleetPulse;
  /** Live registry entries this pulse — see {@link liveAgentCount}. */
  liveCount: number;
  /**
   * Branches this board has dispatched whose claim/manifest the pulse cannot yet
   * confirm. `plot-dispatch.sh` is spawned detached, so a branch dispatched last
   * pulse may show neither a manifest nor a claim ref on the next one; counting
   * only the registry would dispatch it a second time and reach 2N. These count
   * against the budget AND are removed from the startable set, so an in-flight
   * branch is neither re-dispatched nor double-charged.
   */
  inFlight: Set<string>;
}

/**
 * Decide which plans to fan out this pulse, and with what per-plan `--max`.
 *
 * PURE — no spawn, no disk, no clock. Every output is a function of the four
 * inputs, which is what lets the cross-pulse cap be asserted over repeated calls
 * in a unit test rather than through a live fleet.
 *
 * The budget is `parallelAgents − (liveCount + inFlight.size)`, clamped at zero.
 * It is spent across approved plans' eligible waves in document order, each plan
 * taking `min(remaining budget, its startable branches not already in flight)`,
 * and a plan that would take zero is not named at all. The SUM of every returned
 * `max` never exceeds the budget — that sum, held below the cap across every
 * pulse, is the property the whole wave exists to guarantee.
 */
export function planAutoDispatch(input: PlanAutoDispatchInput): AutoDispatchPlan[] {
  const { controls, pulse, liveCount, inFlight } = input;
  if (!controls.autoDispatch) return [];

  let budget = controls.parallelAgents - (liveCount + inFlight.size);
  if (budget <= 0) return [];

  const plans: AutoDispatchPlan[] = [];
  for (const plan of pulse.plans) {
    if (budget <= 0) break;
    // Only approved plans. The script gates on this too (it refuses a Draft),
    // but naming a Draft here would spend budget on a spawn the script rejects,
    // so the phase is read from the pulse first.
    if (plan.phase !== 'approved') continue;

    // Every startable branch across this plan's ELIGIBLE waves, minus the ones
    // already in flight. A blocked or complete wave contributes nothing: the
    // scan's verdict is the eligibility arithmetic, not re-derived here.
    let startable = 0;
    for (const wave of plan.waves) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        if (isStartable(b.state) && !inFlight.has(b.branch)) startable += 1;
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
): string[] {
  const out: string[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase !== 'approved') continue;
    if (planSlug(plan.file) !== slug) continue;
    for (const wave of plan.waves) {
      if (wave.verdict !== 'eligible') continue;
      for (const b of wave.branches) {
        if (isStartable(b.state) && !inFlight.has(b.branch)) out.push(b.branch);
      }
    }
  }
  return out;
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
      for (const wave of plan.waves) {
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
    const branches = startableBranches(pulse, plan.slug, inFlight).slice(0, plan.max);
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
  controls: FleetControls,
  agents: AgentEntry[],
  inFlight: Set<string>,
): Set<string> {
  const pruned = pruneInFlight(inFlight, pulse, agents);
  const liveCount = liveAgentCount(agents, pulse);

  // Check if we're at the cap BEFORE calling planAutoDispatch, so we can log
  // meaningfully. The switch being off is a deliberate absence, not a refusal;
  // the cap being reached is what needed visibility.
  if (controls.autoDispatch) {
    const budget = controls.parallelAgents - (liveCount + pruned.size);
    if (budget <= 0) {
      const liveBranches = liveAgentBranches(agents, pulse);
      const inFlightList = [...pruned];
      // Only log when there IS something to dispatch — a cap hit with no
      // eligible work is routine, not a refusal.
      const hasEligible = pulse.plans.some(
        (p) => p.phase === 'approved' && p.waves.some((w) => w.verdict === 'eligible'),
      );
      if (hasEligible) {
        console.log(
          `auto-dispatch: at cap (${controls.parallelAgents}), refusing new dispatch. ` +
          `Slots held by: ${[...liveBranches, ...inFlightList].join(', ') || '(in-flight only)'}`,
        );
      }
      return pruned;
    }
  }

  const plans = planAutoDispatch({
    controls,
    pulse,
    liveCount,
    inFlight: pruned,
  });
  if (plans.length === 0) return pruned;
  const newly = runAutoDispatch(opts, pulse, plans, pruned);
  const next = new Set(pruned);
  for (const b of newly) next.add(b);
  return next;
}

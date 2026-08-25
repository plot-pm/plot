import { describe, it, expect } from 'vitest';
import {
  planAutoDispatch,
  startableBranches,
  liveAgentCount,
  liveAgentBranches,
  planSlug,
  type AutoDispatchPlan,
} from '../../src/server/auto-dispatch.js';
import { FleetPulseSchema, type FleetPulse } from '../../src/contract/schema.js';
import type { AgentEntry } from '../../src/server/registry.js';
import type { FleetControls } from '../../src/server/fleet-controls.js';

// Wave 3 of approval-hands-the-work-to-agents. The planner is the DECISION half
// of auto-dispatch: given the controls, the pulse, and how many workers are
// already live, it names which plans to fan out and with what per-plan --max.
// It spawns nothing — that is `maybeAutoDispatch`, tested through the route/scan
// path — so every assertion here is a pure function of its inputs.
//
// The load-bearing property is the CROSS-PULSE cap: the sum of every plan's
// `max` never exceeds `parallelAgents − live`, so repeated pulses cannot reach
// 2N the way `--max N` per pulse would.

/** One wave, in the FleetPulse branch shape. */
const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: state === 'claimed' ? 'someone' : '',
  })),
});

/** A parsed pulse of the given plans; each plan is [file, phase, waves]. */
const pulse = (
  plans: Array<[string, string, ReturnType<typeof wave>[]]>,
): FleetPulse =>
  FleetPulseSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, waves]) => ({ file, phase, waves })),
    summary: {
      plans: plans.length, waves: 0, branches: 0, claimed: 0,
      eligible: 0, blocked: 0, deferred: 0,
    },
  });

const controls = (autoDispatch: boolean, parallelAgents: number): FleetControls => ({
  autoDispatch,
  parallelAgents,
});

/** A registry entry in a given state — only `state`/`branch` matter here. */
const agent = (branch: string, state: AgentEntry['state']): AgentEntry => ({
  session: `s-${branch}`,
  branch,
  worktree: `/wt/${branch}`,
  command: '',
  startedAt: '2026-08-23T00:00:00Z',
  pid: '123',
  previousPid: '',
  relaunches: 0,
  state,
});

const total = (plans: AutoDispatchPlan[]) => plans.reduce((n, p) => n + p.max, 0);

describe('planSlug — the plan file basename, date-stripped', () => {
  it('strips the date prefix and .md, matching the dispatch route', () => {
    expect(planSlug('2026-08-22-approval-hands-the-work-to-agents.md')).toBe(
      'approval-hands-the-work-to-agents',
    );
  });
});

describe('liveAgentCount — a slot is occupied by running OR waiting', () => {
  it('counts running and waiting, never finished/stalled/unknown', () => {
    const agents = [
      agent('feature/a', 'running'),
      agent('feature/b', 'waiting'),
      agent('feature/c', 'finished'),
      agent('feature/d', 'stalled'),
      agent('feature/e', 'unknown'),
    ];
    // running + waiting = 2. A waiting worker paused on a question still holds
    // its slot; a finished/stalled/unknown one does not.
    expect(liveAgentCount(agents)).toBe(2);
  });

  it('counts a live agent even when its branch has already merged', () => {
    // THE FIX. On 2026-08-25 eleven workers whose branches had merged sat at
    // zero CPU for up to ten hours (bug/a-landed-branch-still-holds-a-slot).
    // None counted against the cap, letting the fleet grow to 13 against a cap
    // of 3. A live agent holds a machine (CPU, memory, worktree) regardless of
    // whether its branch has merged — the slot is occupied until the agent
    // exits, not until its work lands.
    //
    // The earlier "liveness takes two facts" rule got it backwards: it hid
    // landed agents from the cap while they held their machines.
    const agents = [agent('feature/a', 'running'), agent('feature/done', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      wave('W', 'eligible', [['feature/a', 'open'], ['feature/done', 'merged']]),
    ]]]);
    // Both count, even though feature/done has merged — it still holds a slot.
    expect(liveAgentCount(agents, p)).toBe(2);
  });

  it('counts a live agent the pulse does not mention', () => {
    // The pulse no longer affects the count at all — every live agent counts,
    // regardless of what the pulse says about its branch (or says nothing).
    // This test remains to verify the pulse argument is harmless.
    const agents = [agent('feature/unseen', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [wave('W', 'eligible', [['feature/other', 'open']])]]]);
    expect(liveAgentCount(agents, p)).toBe(1);
  });

  it('is unchanged without a pulse', () => {
    // The pulse is optional, so every existing caller keeps its answer.
    const agents = [agent('feature/a', 'running'), agent('feature/b', 'waiting')];
    expect(liveAgentCount(agents)).toBe(2);
  });
});

describe('liveAgentBranches — names exactly what liveAgentCount counted', () => {
  it('lists branches for all live agents including those with merged branches', () => {
    // Plan requirement #10: liveAgentBranches names exactly the agents
    // liveAgentCount counted. The two must not diverge — the refusal message
    // explains the number.
    const agents = [
      agent('feature/a', 'running'),
      agent('feature/done', 'running'),  // branch merged but still live
      agent('feature/c', 'waiting'),
      agent('feature/d', 'finished'),    // not live — not counted
    ];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      wave('W', 'eligible', [['feature/a', 'open'], ['feature/done', 'merged']]),
    ]]]);
    // Count should be 3 (running + running + waiting)
    expect(liveAgentCount(agents, p)).toBe(3);
    // Branches should list all three, including the merged one
    const branches = liveAgentBranches(agents, p);
    expect(branches).toHaveLength(3);
    expect(branches).toContain('feature/a');
    expect(branches).toContain('feature/done');
    expect(branches).toContain('feature/c');
    expect(branches).not.toContain('feature/d');
  });

  it('stays consistent with liveAgentCount regardless of pulse content', () => {
    // The consistency requirement is load-bearing: a refusal that says
    // "3 slots held by [feature/a]" is the bug a-count-answers-to-its-section
    // already fixed elsewhere.
    const agents = [
      agent('feature/a', 'running'),
      agent('feature/b', 'running'),
    ];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      wave('W', 'complete', [['feature/a', 'merged'], ['feature/b', 'merged']]),
    ]]]);
    // Both merged, but both live — both count
    expect(liveAgentCount(agents, p)).toBe(2);
    expect(liveAgentBranches(agents, p)).toEqual(['feature/a', 'feature/b']);
  });
});

describe('planAutoDispatch — the switch gate', () => {
  it('dispatches nothing while the switch is off, however eligible the wave', () => {
    const p = planAutoDispatch({
      controls: controls(false, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('dispatches an eligible wave of an approved plan while the switch is on', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    // max is capped at the plan's ONE startable branch, not the raw budget of 5:
    // there is no sense asking the script to start more than the plan offers.
    expect(p).toEqual([{ slug: 'p', max: 1 }]);
  });
});

describe('planAutoDispatch — only approved plans, only eligible waves', () => {
  it('skips a DRAFT plan whose wave would otherwise be eligible', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-d.md', 'draft', [wave('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips a BLOCKED wave of an approved plan', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-b.md', 'approved', [wave('W', 'blocked', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips a COMPLETE wave — its work is merged, nothing to start', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-c.md', 'approved', [wave('W', 'complete', [['feature/a', 'merged']])]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips an eligible wave whose only branches are already claimed or merged', () => {
    // The claim ref is what makes a claimed branch safe; there is nothing left
    // to ask the script to start, so it is not named at all.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-e.md', 'approved', [
        wave('W', 'eligible', [['feature/a', 'claimed'], ['feature/b', 'merged']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });
});

describe('planAutoDispatch — the cross-pulse cap', () => {
  it('caps the TOTAL dispatched at parallelAgents − live, not per plan', () => {
    // Two approved plans, each with two eligible open branches: four startable
    // branches. Cap 3, none live yet → total budget 3, split across the plans.
    const p = planAutoDispatch({
      controls: controls(true, 3),
      pulse: pulse([
        ['2026-08-22-one.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]],
        ['2026-08-22-two.md', 'approved', [wave('W', 'eligible', [['feature/c', 'open'], ['feature/d', 'open']])]],
      ]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(total(p)).toBe(3);
  });

  it('subtracts LIVE workers from the budget — the property --max alone cannot promise', () => {
    // Cap 3, two already live → only one more may start THIS pulse, even though
    // three branches are eligible. This is the assertion that fails for an
    // implementation passing `--max 3` every pulse (which reaches 2N, 3N…).
    const p = planAutoDispatch({
      controls: controls(true, 3),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open']]),
      ]]]),
      liveCount: 2,
      inFlight: new Set(),
    });
    expect(total(p)).toBe(1);
  });

  it('subtracts IN-FLIGHT dispatches too — the detached-manifest race', () => {
    // A branch dispatched last pulse may show no manifest and no claim ref yet,
    // because plot-dispatch.sh is detached. Counting only the registry would
    // dispatch it again. inFlight holds it until the pulse confirms it.
    const p = planAutoDispatch({
      controls: controls(true, 3),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open']]),
      ]]]),
      liveCount: 1,
      inFlight: new Set(['feature/z', 'feature/y']),
    });
    // 3 − (1 live + 2 in-flight) = 0.
    expect(total(p)).toBe(0);
  });

  it('withholds all dispatch when the budget is zero or negative', () => {
    const p = planAutoDispatch({
      controls: controls(true, 2),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('W', 'eligible', [['feature/a', 'open']]),
      ]]]),
      liveCount: 5, // over cap — lowering the number mid-flight
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('does not double-count an in-flight branch that is also the eligible one', () => {
    // feature/a is eligible AND in-flight (dispatched last pulse, claim not yet
    // visible). It must not be dispatched again, and must not be offered as a
    // startable branch this pulse.
    const p = planAutoDispatch({
      controls: controls(true, 3),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(['feature/a']),
    });
    // Budget = 3 − 1 in-flight = 2, but only feature/b is startable → max 1.
    expect(p).toEqual([{ slug: 'p', max: 1 }]);
  });
});

describe('planAutoDispatch — a wip branch whose ref exists buys nothing', () => {
  // THE MEASURED DEFECT, 2026-08-25. A `wip` branch carries real unlanded
  // commits, which the scan can only derive by walking `origin/<branch>` — so a
  // pulse `wip` ALWAYS has a ref, and `plot-dispatch.sh`'s claim push is
  // refused (non-fast-forward) against a ref that exists. Budget spent naming
  // that plan buys a dispatch the script discards, every pulse, forever.
  it('spends a budget of 1 on the OPEN branch, skipping the earlier wip one', () => {
    // The measured shape: the `wip` branch belongs to the EARLIER plan in file
    // order (July sorts before August), so a fix that merely reordered plans by
    // recency would pass — this one asserts document order is preserved and the
    // wip plan contributes zero regardless.
    const p = planAutoDispatch({
      controls: controls(true, 1),
      pulse: pulse([
        ['2026-07-25-stale.md', 'approved', [wave('W', 'eligible', [['feature/stale', 'wip']])]],
        ['2026-08-25-fresh.md', 'approved', [wave('W', 'eligible', [['feature/fresh', 'open']])]],
      ]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([{ slug: 'fresh', max: 1 }]);
  });

  it('names no plan whose only startable branch is a wip with a ref', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-07-25-stale.md', 'approved', [
        wave('W', 'eligible', [['feature/stale', 'wip']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('still dispatches the open branch of a wave that also holds a stale wip', () => {
    // A mixed wave: the open branch is real work a dispatch can claim; the wip
    // one is refused. The budget lands on the open one and the wip is not
    // double-charged against it.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-25-mixed.md', 'approved', [
        wave('W', 'eligible', [['feature/stale', 'wip'], ['feature/fresh', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(p).toEqual([{ slug: 'mixed', max: 1 }]);
  });
});

describe('startableBranches — a wip ref is not offered to start', () => {
  it('offers the open branch and withholds the wip one', () => {
    const p = pulse([['2026-08-25-mixed.md', 'approved', [
      wave('W', 'eligible', [['feature/stale', 'wip'], ['feature/fresh', 'open']]),
    ]]]);
    expect(startableBranches(p, 'mixed', new Set())).toEqual(['feature/fresh']);
  });
});

describe('planAutoDispatch — re-eligibility on a later pulse', () => {
  it('picks up a wave that becomes eligible once its predecessor merges', () => {
    // Pulse 1: wave two is BLOCKED behind wave one's open branch → only wave one.
    const before = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('One', 'eligible', [['feature/a', 'open']]),
        wave('Two', 'blocked', [['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    // One startable branch (feature/a) → max 1, capped below the budget of 5.
    expect(before).toEqual([{ slug: 'p', max: 1 }]);

    // Pulse 2: wave one merged, wave two now eligible → it dispatches. The
    // feature is worthless if it only fires once.
    const after = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        wave('One', 'complete', [['feature/a', 'merged']]),
        wave('Two', 'eligible', [['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
    });
    expect(after).toEqual([{ slug: 'p', max: 1 }]);
  });
});

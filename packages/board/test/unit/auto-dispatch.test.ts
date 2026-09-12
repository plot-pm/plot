import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  planAutoDispatch,
  startableBranches,
  liveAgentCount,
  liveAgentBranches,
  freeAgentCount,
  freeAgentLabels,
  mergedBranches,
  planSlug,
  briefPath,
  dispatchCandidates,
  machineDefers,
  machineIsClear,
  skippedPlans,
  sharedInFlightBlocks,
  type AutoDispatchPlan,
} from '../../src/server/auto-dispatch.js';
import {
  readInFlight,
  writeInFlight,
  inFlightPath,
  IN_FLIGHT_TTL_MS,
} from '../../src/server/in-flight-store.js';
import { measureMachine, type Machine as MachineEntity } from '@plot-pm/domain';
import { FleetReadingSchema, type FleetReading } from '../../src/contract/schema.js';
import type { AgentEntry } from '../../src/server/registry.js';
import type { FleetSettings } from '../../src/server/fleet-settings.js';
import { rmTree } from '../helpers.mjs';

// Wave 3 of approval-hands-the-work-to-agents. The planner is the DECISION half
// of auto-dispatch: given the controls, the pulse, and how many workers are
// already live, it names which plans to fan out and with what per-plan --max.
// It spawns nothing — that is `maybeAutoDispatch`, tested through the route/scan
// path — so every assertion here is a pure function of its inputs.
//
// The load-bearing property is the CROSS-PULSE cap: the sum of every plan's
// `max` never exceeds `parallelAgents − live`, so repeated pulses cannot reach
// 2N the way `--max N` per pulse would.

/**
 * One wave, in the FleetReading branch shape.
 *
 * Each branch is [name, state, ref_held?]. When `ref_held` is not given, it
 * defaults to false — but a `wip` state implies a ref (the scan derives `wip`
 * by walking one), so the fallback in `refBlocksClaim` still catches it.
 */
const slice = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred', boolean?]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state, ref_held]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: state === 'claimed' ? 'someone' : '',
    ref_held: ref_held ?? false,
  })),
});

/** A parsed pulse of the given plans; each plan is [file, phase, waves]. */
const pulse = (
  plans: Array<[string, string, ReturnType<typeof slice>[]]>,
): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, slices]) => ({ file, phase, slices })),
    summary: {
      plans: plans.length, waves: 0, branches: 0, claimed: 0,
      eligible: 0, blocked: 0, deferred: 0,
    },
  });

const controls = (
  autoDispatch: boolean,
  parallelAgents: number,
  machineOverride = false,
): FleetSettings => ({
  autoDispatch,
  parallelAgents,
  machineOverride,
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
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/done', 'merged']]),
    ]]]);
    // Both count, even though feature/done has merged — it still holds a slot.
    expect(liveAgentCount(agents, p)).toBe(2);
  });

  it('counts a live agent the pulse does not mention', () => {
    // The pulse no longer affects the count at all — every live agent counts,
    // regardless of what the pulse says about its branch (or says nothing).
    // This test remains to verify the pulse argument is harmless.
    const agents = [agent('feature/unseen', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [slice('W', 'eligible', [['feature/other', 'open']])]]]);
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
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/done', 'merged']]),
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
      slice('W', 'complete', [['feature/a', 'merged'], ['feature/b', 'merged']]),
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
      pulse: pulse([['2026-08-22-p.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('dispatches an eligible wave of an approved plan while the switch is on', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
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
      pulse: pulse([['2026-08-22-d.md', 'draft', [slice('W', 'eligible', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips a BLOCKED wave of an approved plan', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-b.md', 'approved', [slice('W', 'blocked', [['feature/a', 'open']])]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips a COMPLETE wave — its work is merged, nothing to start', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-c.md', 'approved', [slice('W', 'complete', [['feature/a', 'merged']])]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([]);
  });

  it('skips an eligible wave whose only branches are already claimed or merged', () => {
    // The claim ref is what makes a claimed branch safe; there is nothing left
    // to ask the script to start, so it is not named at all.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-e.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'claimed'], ['feature/b', 'merged']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
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
        ['2026-08-22-one.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]],
        ['2026-08-22-two.md', 'approved', [slice('W', 'eligible', [['feature/c', 'open'], ['feature/d', 'open']])]],
      ]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
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
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open']]),
      ]]]),
      liveCount: 2,
      inFlight: new Set(),
      missingBriefs: new Set(),
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
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open']]),
      ]]]),
      liveCount: 1,
      inFlight: new Set(['feature/z', 'feature/y']),
      missingBriefs: new Set(),
    });
    // 3 − (1 live + 2 in-flight) = 0.
    expect(total(p)).toBe(0);
  });

  it('withholds all dispatch when the budget is zero or negative', () => {
    const p = planAutoDispatch({
      controls: controls(true, 2),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open']]),
      ]]]),
      liveCount: 5, // over cap — lowering the number mid-flight
      inFlight: new Set(),
      missingBriefs: new Set(),
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
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(['feature/a']),
      missingBriefs: new Set(),
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
        ['2026-07-25-stale.md', 'approved', [slice('W', 'eligible', [['feature/stale', 'wip']])]],
        ['2026-08-25-fresh.md', 'approved', [slice('W', 'eligible', [['feature/fresh', 'open']])]],
      ]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([{ slug: 'fresh', max: 1 }]);
  });

  it('names no plan whose only startable branch is a wip with a ref', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-07-25-stale.md', 'approved', [
        slice('W', 'eligible', [['feature/stale', 'wip']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
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
        slice('W', 'eligible', [['feature/stale', 'wip'], ['feature/fresh', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([{ slug: 'mixed', max: 1 }]);
  });
});

describe('startableBranches — a wip ref is not offered to start', () => {
  it('offers the open branch and withholds the wip one', () => {
    const p = pulse([['2026-08-25-mixed.md', 'approved', [
      slice('W', 'eligible', [['feature/stale', 'wip'], ['feature/fresh', 'open']]),
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
        slice('One', 'eligible', [['feature/a', 'open']]),
        slice('Two', 'blocked', [['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    // One startable branch (feature/a) → max 1, capped below the budget of 5.
    expect(before).toEqual([{ slug: 'p', max: 1 }]);

    // Pulse 2: wave one merged, wave two now eligible → it dispatches. The
    // feature is worthless if it only fires once.
    const after = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('One', 'complete', [['feature/a', 'merged']]),
        slice('Two', 'eligible', [['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(after).toEqual([{ slug: 'p', max: 1 }]);
  });
});

// Wave: a-worker-starts-with-its-brief.md. A branch with no brief is not
// started by auto-dispatch. The worker would spend its first hour re-deriving
// what the brief already says — measured 2026-08-24: eight minutes on one
// wave and unknown on another.

describe('briefPath — the path from branch to brief', () => {
  it('puts the branch suffix under .plot/briefs as .md', () => {
    expect(briefPath('bug/foo-bar')).toBe('.plot/briefs/foo-bar.md');
    expect(briefPath('feature/the-feature')).toBe('.plot/briefs/the-feature.md');
  });

  it('handles a branch with no prefix', () => {
    expect(briefPath('standalone')).toBe('.plot/briefs/standalone.md');
  });

  it('takes the last segment after any nested prefix', () => {
    // wip/spike/foo → foo.md
    expect(briefPath('wip/spike/foo')).toBe('.plot/briefs/foo.md');
  });
});

describe('dispatchCandidates — branches auto-dispatch would consider', () => {
  it('returns every dispatchable branch across approved plans', () => {
    const p = pulse([
      ['2026-08-22-one.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]],
      ['2026-08-22-two.md', 'approved', [slice('W', 'eligible', [['feature/c', 'open']])]],
    ]);
    expect(dispatchCandidates(p, new Set())).toEqual(['feature/a', 'feature/b', 'feature/c']);
  });

  it('excludes branches already in flight', () => {
    const p = pulse([['2026-08-22-one.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    expect(dispatchCandidates(p, new Set(['feature/a']))).toEqual(['feature/b']);
  });

  it('excludes wip branches whose ref blocks a claim', () => {
    const p = pulse([['2026-08-22-one.md', 'approved', [
      slice('W', 'eligible', [['feature/wip', 'wip'], ['feature/open', 'open']]),
    ]]]);
    expect(dispatchCandidates(p, new Set())).toEqual(['feature/open']);
  });

  it('excludes branches of draft plans', () => {
    const p = pulse([['2026-08-22-draft.md', 'draft', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    expect(dispatchCandidates(p, new Set())).toEqual([]);
  });

  it('excludes branches of blocked waves', () => {
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'blocked', [['feature/a', 'open']]),
    ]]]);
    expect(dispatchCandidates(p, new Set())).toEqual([]);
  });
});

describe('planAutoDispatch — missingBriefs excludes branches', () => {
  it('does not dispatch a branch whose brief is missing', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(['feature/a']),
    });
    // Only feature/b is dispatchable; feature/a has no brief.
    expect(p).toEqual([{ slug: 'p', max: 1 }]);
  });

  it('returns nothing when all branches lack briefs', () => {
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(['feature/a', 'feature/b']),
    });
    expect(p).toEqual([]);
  });

  it('does not spend budget on a branch with no brief', () => {
    // Budget 1, two branches, one lacks a brief. The one WITH a brief gets
    // the slot, not the one without.
    const p = planAutoDispatch({
      controls: controls(true, 1),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/nobr', 'open'], ['feature/yesbr', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(['feature/nobr']),
    });
    expect(p).toEqual([{ slug: 'p', max: 1 }]);
    // And the branch chosen is the one with a brief:
    expect(startableBranches(
      pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/nobr', 'open'], ['feature/yesbr', 'open']]),
      ]]]),
      'p',
      new Set(),
      new Set(['feature/nobr']),
    )).toEqual(['feature/yesbr']);
  });
});

describe('startableBranches — missingBriefs filter', () => {
  it('excludes branches with missing briefs from the startable list', () => {
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    expect(startableBranches(p, 'p', new Set(), new Set(['feature/a']))).toEqual(['feature/b']);
  });

  it('still works with an empty missingBriefs set', () => {
    // The default behavior — no briefs are missing.
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    expect(startableBranches(p, 'p', new Set())).toEqual(['feature/a', 'feature/b']);
  });
});

// Wave: a-claimed-branch-is-not-startable.md (Spent wave). A branch whose ref
// already exists — `ref_held: true` in the pulse — cannot be claimed by
// `plot-dispatch.sh`, so auto-dispatch skips it entirely.
//
// THE DANGER CASE (plan item 6): where a worktree survives, `plot-dispatch.sh`
// ADOPTS it rather than refusing. This starts a worker on merged work —
// measured twice on 2026-08-27 — so a claimed branch with a live worktree is
// the population the fix MUST reach. That branch reports `open` (no work
// commits) but `ref_held: true` (a claim ref exists).

describe('planAutoDispatch — ref_held skips the claimed branch', () => {
  it('dispatches the UNCLAIMED branch when one claimed and one open share a budget of 1', () => {
    // Plan Done When item 1. The claimed branch belongs to the EARLIER plan in
    // file order (July sorts before August), so a fix that merely reorders
    // plans by recency would pass. This asserts the unclaimed one is chosen.
    const p = planAutoDispatch({
      controls: controls(true, 1),
      pulse: pulse([
        // Earlier plan has a claimed branch: ref_held=true, state=open (no work
        // commits, but a claim ref exists — the measured shape).
        ['2026-07-25-stale.md', 'approved', [
          slice('W', 'eligible', [['feature/stale', 'open', true]]),
        ]],
        // Later plan has an unclaimed branch: ref_held=false (or absent).
        ['2026-08-25-fresh.md', 'approved', [
          slice('W', 'eligible', [['feature/fresh', 'open']]),
        ]],
      ]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    // The budget lands on the unclaimed branch, not the claimed one.
    expect(p).toEqual([{ slug: 'fresh', max: 1 }]);
  });

  it('a branch with no ref (ref_held=false, state=open) is still startable', () => {
    // Plan Done When item 2. The ordinary case must not regress: a fix that
    // treats every branch as claimed stops the fleet entirely.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-p.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([{ slug: 'p', max: 1 }]);
  });

  it('a claimed branch WITH state=open is not startable (the danger case)', () => {
    // Plan Done When item 6. This is the exact shape that caused revert risk:
    // state=open means `isStartable` returns true, but ref_held=true means a
    // claim ref exists. Where a worktree survives, `plot-dispatch.sh` ADOPTS
    // rather than refusing, starting a worker on merged work.
    //
    // Measured 2026-08-27: six workers on six already-merged waves, two of
    // which opened PRs ~120 commits behind main.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-claimed.md', 'approved', [
        // state=open, but ref_held=true: claimed, no work commits.
        slice('W', 'eligible', [['feature/claimed', 'open', true]]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    // The claimed branch is NOT dispatched.
    expect(p).toEqual([]);
  });

  it('skips the ref_held branch and still starts the unclaimed one in the same wave', () => {
    // A mixed wave: one branch is claimed (ref_held=true), one is not.
    const p = planAutoDispatch({
      controls: controls(true, 5),
      pulse: pulse([['2026-08-22-mixed.md', 'approved', [
        slice('W', 'eligible', [
          ['feature/claimed', 'open', true],   // claimed
          ['feature/fresh', 'open'],           // not claimed
        ]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(p).toEqual([{ slug: 'mixed', max: 1 }]);
  });
});

describe('startableBranches — ref_held filter', () => {
  it('excludes ref_held branches from the startable list', () => {
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/claimed', 'open', true],
        ['feature/fresh', 'open'],
      ]),
    ]]]);
    expect(startableBranches(p, 'p', new Set())).toEqual(['feature/fresh']);
  });
});

describe('dispatchCandidates — ref_held filter', () => {
  it('excludes ref_held branches from candidates', () => {
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/claimed', 'open', true],
        ['feature/fresh', 'open'],
      ]),
    ]]]);
    expect(dispatchCandidates(p, new Set())).toEqual(['feature/fresh']);
  });
});

// --- A dispatch asks for a free agent ---------------------------------------
//
// The Asking slice of the-registry-owns-what-it-started. `isFree` existed,
// was tested, and had zero production callers; these assertions are what make
// it a reader. The load-bearing property is that it joins `liveAgentCount`
// rather than replacing it: the two answer different questions, and collapsing
// them re-inverts a defect measured on 2026-08-25.

describe('mergedBranches — sliceHasMerged, sourced from the pulse', () => {
  it('collects the branches the pulse reports as merged', () => {
    // The pulse already carries this; asking the host again per agent is what
    // the slice's scope guard forbids.
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/done', 'merged']]),
      slice('X', 'complete', [['feature/older', 'merged']]),
    ]]]);
    expect(mergedBranches(p)).toEqual(new Set(['feature/done', 'feature/older']));
  });

  it('omits a branch the pulse never mentions, so silence is not "landed"', () => {
    const p = pulse([['2026-08-22-p.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open']])]]]);
    expect(mergedBranches(p).has('feature/unseen')).toBe(false);
  });
});

describe('freeAgentCount — can any agent take a slice?', () => {
  it('counts a running agent whose branch has landed', () => {
    // Occupied AND free at once: it still holds a machine, and it can still
    // take the next slice.
    const agents = [agent('feature/done', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged']]),
    ]]]);
    expect(freeAgentCount(agents, p)).toBe(1);
  });

  it('counts a running agent between slices, holding no branch', () => {
    // Asserted against a FIXTURE, and deliberately so: no live estate produces
    // this state yet. The 3600s `Worker bound` kills every agent mid-run, and
    // `update_manifest_on_hop` sets the next branch rather than clearing it, so
    // nothing has ever passed through the empty state. `isFree`'s first
    // condition is unreachable in production today —
    // `a-working-agent-is-not-a-hung-one` is what makes it reachable.
    const agents = [agent('', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [slice('W', 'eligible', [['feature/a', 'open']])]]]);
    expect(freeAgentCount(agents, p)).toBe(1);
  });

  it('refuses a running agent still holding an unlanded branch', () => {
    const agents = [agent('feature/a', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    expect(freeAgentCount(agents, p)).toBe(0);
  });

  it('refuses a WAITING agent, which is live but blocked on a person', () => {
    // It holds a slot and can take nothing. `waiting` is not free even when its
    // branch has merged — the block is the person, not the branch.
    const agents = [agent('feature/done', 'waiting')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged']]),
    ]]]);
    expect(freeAgentCount(agents, p)).toBe(0);
  });

  it('names the branches behind the number, and says why a slot is reusable', () => {
    const agents = [agent('feature/done', 'running'), agent('', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged']]),
    ]]]);
    // The count and the names must not diverge — the count is the decision and
    // the names are the explanation.
    expect(freeAgentCount(agents, p)).toBe(2);
    expect(freeAgentLabels(agents, p)).toEqual(['feature/done', '(between slices)']);
  });
});

describe('planAutoDispatch — at the cap, but an agent is free', () => {
  it('DISPATCHES when every slot is taken and all agents are between units', () => {
    // The whole user-visible win. An agent asking for its next slice is
    // `running` with no branch and is available NOW; the fleet used to wait for
    // a slot instead of using the one it already held.
    const agents = [agent('', 'running'), agent('', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 2),
      pulse: p,
      liveCount: 2, // at the cap
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(total(plans)).toBe(2);
  });

  it('DISPATCHES when every slot is taken and the agents hold landed branches', () => {
    const agents = [agent('feature/done', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged'], ['feature/next', 'open']]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 1),
      pulse: p,
      liveCount: 1, // at the cap
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(total(plans)).toBe(1);
  });

  it('STILL REFUSES when every slot is taken and every branch is unlanded', () => {
    // The other half of the pair. Working agents are neither free nor about to
    // be, so the cap is a real refusal and waiting is the right answer.
    const agents = [agent('feature/a', 'running'), agent('feature/b', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open'],
      ]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 2),
      pulse: p,
      liveCount: 2,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(plans).toEqual([]);
  });

  it('STILL REFUSES when the agents holding the slots are merely WAITING', () => {
    const agents = [agent('feature/done', 'waiting'), agent('feature/b', 'waiting')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged'], ['feature/c', 'open']]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 2),
      pulse: p,
      liveCount: 2,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(plans).toEqual([]);
  });

  it('bounds the fall-through by the number of FREE agents, not by adding them', () => {
    // THE CAP IS NEVER RAISED. A free agent is an EXISTING slot, so the budget
    // BECOMES the free count rather than growing by it. One free agent among
    // three at a cap of three dispatches exactly one — `3 - 3 + 1` would also
    // be one here, so the discriminating case is the assertion below it.
    const agents = [
      agent('feature/done', 'running'), // free: landed
      agent('feature/a', 'running'),    // busy
      agent('feature/b', 'running'),    // busy
    ];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/done', 'merged'],
        ['feature/c', 'open'], ['feature/d', 'open'], ['feature/e', 'open'],
      ]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 3),
      pulse: p,
      liveCount: 3,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(total(plans)).toBe(1);
  });

  it('does not let free agents lift the fleet OVER the cap', () => {
    // The discriminating case. Two free agents while the cap is exceeded (a
    // lowered cap, or in-flight overshoot) must dispatch at most the two free
    // slots — never `parallelAgents − liveCount + free`, which is negative-
    // clamped arithmetic that would let the fleet grow.
    const agents = [
      agent('feature/d1', 'running'), agent('feature/d2', 'running'), // both landed
      agent('feature/a', 'running'), agent('feature/b', 'running'),
    ];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/d1', 'merged'], ['feature/d2', 'merged'],
        ['feature/x', 'open'], ['feature/y', 'open'], ['feature/z', 'open'],
      ]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 2), // cap LOWERED below the live count
      pulse: p,
      liveCount: 4,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    // Exactly the two free agents' slots — not 3, and not unbounded.
    expect(total(plans)).toBe(2);
  });

  it('refuses with no agents passed at all, exactly as it did before the field', () => {
    // `agents` is optional and absent means NO FREE AGENT rather than an error,
    // so a caller predating the field keeps the cap-only behaviour.
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(true, 1),
      pulse: p,
      liveCount: 1,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(plans).toEqual([]);
  });

  it('leaves the switch-off answer alone — a free agent is not a reason to start', () => {
    const agents = [agent('', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open']]),
    ]]]);
    const plans = planAutoDispatch({
      controls: controls(false, 2),
      pulse: p,
      liveCount: 2,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(plans).toEqual([]);
  });
});

describe('the two counts stay distinct — the 2026-08-25 regression lock', () => {
  it('an agent whose branch merged STILL COUNTS toward the cap', () => {
    // THE DEFECT THIS SLICE COULD PLAUSIBLY REINTRODUCE.
    // bug/a-landed-branch-still-holds-a-slot, measured 2026-08-25: eleven
    // workers whose branches had merged sat at zero CPU for up to ten hours,
    // none counted against the cap, and the fleet grew to 13 against a cap of 3.
    //
    // The tempting simplification of this slice is to make `liveAgentCount`
    // skip landed agents because `isFree` says they are available. That inverts
    // the defect again. A landed-branch agent is OCCUPIED (it holds CPU, memory
    // and a worktree) and FREE (it can take the next slice) AT ONCE — this test
    // fails if the two questions are ever collapsed into one.
    const agents = [agent('feature/done', 'running'), agent('feature/a', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged'], ['feature/a', 'open']]),
    ]]]);

    // Occupied: both hold a machine, so both count against the cap.
    expect(liveAgentCount(agents, p)).toBe(2);
    expect(liveAgentBranches(agents, p)).toEqual(['feature/done', 'feature/a']);

    // Free: only the landed one can take a slice.
    expect(freeAgentCount(agents, p)).toBe(1);
    expect(freeAgentLabels(agents, p)).toEqual(['feature/done']);

    // And the two numbers are NOT the same number.
    expect(freeAgentCount(agents, p)).not.toBe(liveAgentCount(agents, p));
  });

  it('keeps the cap the ceiling: a landed agent adds no slot of its own', () => {
    // The count that protects the cap is unchanged by this slice, so a fleet
    // whose agents have all landed is still at its cap — it may REUSE those
    // slots, never exceed them.
    const agents = [agent('feature/d1', 'running'), agent('feature/d2', 'running')];
    const p = pulse([['2026-08-22-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/d1', 'merged'], ['feature/d2', 'merged'],
        ['feature/x', 'open'], ['feature/y', 'open'], ['feature/z', 'open'],
      ]),
    ]]]);
    expect(liveAgentCount(agents, p)).toBe(2);
    const plans = planAutoDispatch({
      controls: controls(true, 2),
      pulse: p,
      liveCount: 2,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    // Two free agents, two slots reused — never a third.
    expect(total(plans)).toBe(2);
  });
});

/**
 * THE MACHINE QUESTION — the second thing a dispatch asks.
 *
 * `isFree` answers *can any agent take a slice?*; this answers *has the machine
 * room?*. Both sit beside the budget, and a refusal must name which one it is.
 *
 * The reading arrives as a VALUE, not a port: `planAutoDispatch` is pure, so
 * measuring happens on the scan's clock and the answer travels as data. That is
 * what lets every case here be asserted without forking a process.
 */

/** A reading at a given spawn cost, dated now so it is never `unmeasured`. */
const reading = (spawnCostMs: number | null): MachineEntity =>
  measureMachine({
    spawnCostMs,
    measuredAt: 1_000,
    sampleMs: 24,
    loadAverage: [13, 13, 13],
    cores: 16,
  });

/** A pulse with one approved, eligible plan holding three startable branches. */
const workToDo = () =>
  pulse([['2026-08-30-m.md', 'approved', [
    slice('W', 'eligible', [
      ['feature/x', 'open'], ['feature/y', 'open'], ['feature/z', 'open'],
    ]),
  ]]]);

describe('planAutoDispatch — a starved machine defers', () => {
  it('dispatches nothing while the machine reads starved', () => {
    // 287 ms/fork, measured 2026-08-30. The budget is wide open and the work is
    // there; the machine is the only reason nothing starts.
    const plans = planAutoDispatch({
      controls: controls(true, 5),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(287),
    });
    expect(plans).toEqual([]);
  });

  it('dispatches on a clear reading', () => {
    const plans = planAutoDispatch({
      controls: controls(true, 5),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(4.8),
    });
    expect(total(plans)).toBe(3);
  });

  it('dispatches on a TIGHT reading — only starved defers', () => {
    // THE ASYMMETRY THAT MATTERS. `hasRoomToDispatch` is false at 25 ms, but
    // `tight` is fit to work on. Gating on `!hasRoomToDispatch` would stop the
    // fleet on every tight reading — which is most of a working day.
    const plans = planAutoDispatch({
      controls: controls(true, 5),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(25),
    });
    expect(total(plans)).toBe(3);
  });

  it('dispatches on an unmeasured reading — silence is never a refusal', () => {
    // A reading nobody could take is not evidence of harm. Refusing on it would
    // let a broken probe stop the fleet with no way to tell that from a busy
    // machine.
    const plans = planAutoDispatch({
      controls: controls(true, 5),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(null),
    });
    expect(total(plans)).toBe(3);
  });

  it('dispatches when no reading was taken at all', () => {
    // The same fact by another route: a caller that asks nothing gets exactly
    // the behaviour that predates this slice.
    const plans = planAutoDispatch({
      controls: controls(true, 5),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
    });
    expect(total(plans)).toBe(3);
  });

  it('is OVERRIDABLE — the operator says now anyway', () => {
    // `DESIGN-machine.md` §10: the three forbidden actions each take something
    // from the operator permanently, and "not yet" takes nothing away. Without
    // this the gate would be the veto §7 forbids.
    const plans = planAutoDispatch({
      controls: controls(true, 5, true),
      pulse: workToDo(),
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(287),
    });
    expect(total(plans)).toBe(3);
  });

  it('defers before the free-agent fall-through, not after it', () => {
    // At the cap AND starved: the machine outranks the slot arithmetic, so a
    // free agent does not talk the fleet past a starving machine.
    const agents = [agent('feature/done', 'running')];
    const p = pulse([['2026-08-30-m.md', 'approved', [
      slice('W', 'eligible', [['feature/done', 'merged'], ['feature/x', 'open']]),
    ]]]);
    expect(freeAgentCount(agents, p)).toBe(1);
    const plans = planAutoDispatch({
      controls: controls(true, 1),
      pulse: p,
      liveCount: 1,
      agents,
      inFlight: new Set(),
      missingBriefs: new Set(),
      machine: reading(287),
    });
    expect(plans).toEqual([]);
  });
});

describe('machineDefers — the sentence carries the number', () => {
  it('names the measurement, never the load average', () => {
    // "not yet: spawn cost 287 ms against a clear reading of 4.8 ms" is
    // answerable; "too much load" is not, and load average is never the verdict.
    const message = machineDefers(reading(287), controls(true, 5));
    expect(message).not.toBeNull();
    expect(message).toContain('287.0 ms');
    expect(message?.toLowerCase()).not.toContain('load');
  });

  it('says nothing on clear, tight, unmeasured, or absent', () => {
    const on = controls(true, 5);
    expect(machineDefers(reading(4.8), on)).toBeNull();
    expect(machineDefers(reading(25), on)).toBeNull();
    expect(machineDefers(reading(null), on)).toBeNull();
    expect(machineDefers(undefined, on)).toBeNull();
  });

  it('says nothing while the override is set', () => {
    expect(machineDefers(reading(287), controls(true, 5, true))).toBeNull();
  });
});

describe('machineIsClear — the other machine question, and not the gate', () => {
  it('is true only on clear, and false on tight without deferring it', () => {
    // The pair `liveAgentCount`/`isFree` one entity over: two questions, both
    // true of the same reading, neither redundant.
    expect(machineIsClear(reading(4.8))).toBe(true);
    expect(machineIsClear(reading(25))).toBe(false);
    expect(machineDefers(reading(25), controls(true, 5))).toBeNull();
    expect(machineIsClear(reading(287))).toBe(false);
    expect(machineIsClear(reading(null))).toBe(false);
    expect(machineIsClear(undefined)).toBe(false);
  });
});

// The reporting wave of `a-refused-dispatch-asks-for-a-brief`. `skippedPlans`
// records the PLAN-level decision `planAutoDispatch` makes at
// `if (startable === 0) continue;` — until now made in silence.
//
// The load-bearing property is DISTINGUISHABILITY: a plan skipped for briefs
// must not read the same as one skipped for anything else, or the reason is not
// a reason. The second property is AGREEMENT: every plan `skippedPlans` names
// is one `planAutoDispatch` declines, so the board never explains a plan it
// dispatched.
describe('skippedPlans — the plan-level skip says why', () => {
  const p = (slices: ReturnType<typeof slice>[], phase = 'approved') =>
    pulse([['2026-09-01-p.md', phase, slices]]);

  it('says nothing about a plan that has something startable', () => {
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'open']])]),
      new Set(),
      new Set(),
    )).toEqual([]);
  });

  it('names the plan and `no-brief` when every branch lacks one', () => {
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]),
      new Set(),
      new Set(['feature/a', 'feature/b']),
    )).toEqual([{ slug: 'p', reason: 'no-brief' }]);
  });

  it('names `ref-held` when every branch is already claimed by its own ref', () => {
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'open', true], ['feature/b', 'wip']])]),
      new Set(),
      new Set(),
    )).toEqual([{ slug: 'p', reason: 'ref-held' }]);
  });

  it('names `in-flight` when this board already dispatched them', () => {
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'open']])]),
      new Set(['feature/a']),
      new Set(),
    )).toEqual([{ slug: 'p', reason: 'in-flight' }]);
  });

  it('names `no-eligible-wave` when no wave is eligible at all', () => {
    expect(skippedPlans(
      p([slice('W', 'blocked', [['feature/a', 'open']])]),
      new Set(),
      new Set(),
    )).toEqual([{ slug: 'p', reason: 'no-eligible-wave' }]);
  });

  it('names `no-eligible-wave` when the eligible wave holds only merged work', () => {
    // A wave with branches but none startable answers the same as no wave at
    // all, from a dispatch's point of view — there is nothing to claim and
    // nothing to ask a person for.
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'merged'], ['feature/b', 'deferred']])]),
      new Set(),
      new Set(),
    )).toEqual([{ slug: 'p', reason: 'no-eligible-wave' }]);
  });

  it('says nothing about a plan that is not approved', () => {
    expect(skippedPlans(
      p([slice('W', 'eligible', [['feature/a', 'open']])], 'draft'),
      new Set(),
      new Set(['feature/a']),
    )).toEqual([]);
  });

  it('a brief skip and a ref skip are two different sentences', () => {
    // THE PROPERTY THE WAVE EXISTS FOR. Two plans dropped on the same pulse for
    // two different reasons must not read alike.
    const two = pulse([
      ['2026-09-01-briefless.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open']]),
      ]],
      ['2026-09-01-held.md', 'approved', [
        slice('W', 'eligible', [['feature/b', 'open', true]]),
      ]],
    ]);
    expect(skippedPlans(two, new Set(), new Set(['feature/a']))).toEqual([
      { slug: 'briefless', reason: 'no-brief' },
      { slug: 'held', reason: 'ref-held' },
    ]);
  });

  it('reports the reason accounting for the most branches, ties to the actionable one', () => {
    // One branch of each kind. `no-brief` wins the tie because it is the one a
    // person can act on; `in-flight` asks for nothing at all.
    expect(skippedPlans(
      p([slice('W', 'eligible', [
        ['feature/nobrief', 'open'],
        ['feature/held', 'open', true],
        ['feature/flying', 'open'],
      ])]),
      new Set(['feature/flying']),
      new Set(['feature/nobrief']),
    )).toEqual([{ slug: 'p', reason: 'no-brief' }]);
  });

  it('names exactly the plans planAutoDispatch declines', () => {
    // AGREEMENT. The two read the same filters, so a plan named here must be
    // absent from the planner's output and vice versa.
    const two = pulse([
      ['2026-09-01-goes.md', 'approved', [
        slice('W', 'eligible', [['feature/ok', 'open']]),
      ]],
      ['2026-09-01-stays.md', 'approved', [
        slice('W', 'eligible', [['feature/nobrief', 'open']]),
      ]],
    ]);
    const missing = new Set(['feature/nobrief']);
    const planned = planAutoDispatch({
      controls: controls(true, 5),
      pulse: two,
      liveCount: 0,
      inFlight: new Set(),
      missingBriefs: missing,
    });
    expect(planned.map((x) => x.slug)).toEqual(['goes']);
    expect(skippedPlans(two, new Set(), missing).map((x) => x.slug)).toEqual(['stays']);
  });

  it('is silent about a plan the budget never reached', () => {
    // The budget is not a property of the plan, and the cap refusal is already
    // its own sentence. A plan with startable branches is never named here, no
    // matter how spent the budget is — this function is not given one.
    const two = pulse([
      ['2026-09-01-first.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open']]),
      ]],
      ['2026-09-01-second.md', 'approved', [
        slice('W', 'eligible', [['feature/b', 'open']]),
      ]],
    ]);
    expect(skippedPlans(two, new Set(), new Set())).toEqual([]);
  });
});

// ONE CAP HOLDS ACROSS BOARDS — bug/one-cap-holds-across-boards.
//
// The registry half of the budget was already shared: both boards read the same
// agent registry, so `parallelAgents − live` is the same number whoever asks.
// The in-flight half was not. `plot-dispatch.sh` is detached and pushes no claim
// ref, so a branch one board dispatched is invisible to the other until a
// registry entry appears — and the guard that prevents 2N on ONE board
// (`autoInFlight`) lived in that board's memory and prevented nothing between
// two.
//
// These tests are about TIME, not readings: *was this branch dispatched by
// anyone, recently enough that no ref yet shows it?* So they simulate two
// deciders against one shared store, which is the shape the existing cross-pulse
// tests above already have with `inFlight` threaded between calls — one caller,
// repeated pulses — extended to two callers over one file.

describe('the shared in-flight store — two boards, one record', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-inflight-'));
  });
  afterEach(() => {
    rmTree(repo);
  });

  it('a missing file reads as an empty set, not as a failure', () => {
    // The ordinary first state: no board on this machine has dispatched
    // anything. That is a COMPLETE answer, so it must not trip the refusal that
    // an unreadable file does.
    const read = readInFlight(repo);
    expect(read.branches).toEqual(new Set());
    expect(read.error).toBe('');
  });

  it('a mark one board writes is visible to the other', () => {
    // The whole slice in one assertion: board A dispatches, board B reads the
    // file and sees it, with no ref, no manifest and no registry entry.
    writeInFlight(repo, ['feature/a']);
    expect(readInFlight(repo).branches).toEqual(new Set(['feature/a']));
  });

  it('a write MERGES rather than replaces, so a peer keeps its budget', () => {
    // Neither board owns the file. A replacing write would erase the other
    // board's marks and hand back the slots they hold — the original bug with
    // extra steps.
    writeInFlight(repo, ['feature/a']);
    writeInFlight(repo, ['feature/b']);
    expect(readInFlight(repo).branches).toEqual(new Set(['feature/a', 'feature/b']));
  });

  it('a mark EXPIRES, so a board that died mid-dispatch returns its budget', () => {
    // The cost of persisting, and the assertion that keeps the trade honest.
    const dispatchedAt = 1_000_000;
    writeInFlight(repo, ['feature/a'], dispatchedAt);
    // One millisecond inside the window: still held.
    expect(readInFlight(repo, dispatchedAt + IN_FLIGHT_TTL_MS - 1).branches)
      .toEqual(new Set(['feature/a']));
    // At the window: retired, with nothing having had to notice the board died.
    expect(readInFlight(repo, dispatchedAt + IN_FLIGHT_TTL_MS).branches)
      .toEqual(new Set());
  });

  it('a LIVE board renews its own mark, so renewing beats the TTL', () => {
    // The other half of expiry: a mark lapses exactly when nobody is renewing
    // it. A board still holding the branch keeps saying so every pulse.
    const t0 = 1_000_000;
    writeInFlight(repo, ['feature/a'], t0);
    // A pulse most of the way through the window renews the stamp.
    writeInFlight(repo, ['feature/a'], t0 + IN_FLIGHT_TTL_MS - 1);
    // Past the ORIGINAL expiry, the renewed mark still stands.
    expect(readInFlight(repo, t0 + IN_FLIGHT_TTL_MS + 1).branches)
      .toEqual(new Set(['feature/a']));
  });

  it('an expired peer mark is dropped at write time too, so the file is bounded', () => {
    const t0 = 1_000_000;
    writeInFlight(repo, ['feature/dead'], t0);
    writeInFlight(repo, ['feature/live'], t0 + IN_FLIGHT_TTL_MS);
    const raw = JSON.parse(fs.readFileSync(inFlightPath(repo), 'utf8'));
    expect(Object.keys(raw.marks)).toEqual(['feature/live']);
  });

  it('an unreadable file answers null — NEVER an empty set', () => {
    // THE FAILURE DIRECTION. An empty set here would mean "no board holds
    // anything", which is what a board concludes right before it spends the
    // whole budget a peer has already spent.
    fs.mkdirSync(path.dirname(inFlightPath(repo)), { recursive: true });
    fs.writeFileSync(inFlightPath(repo), '{ not json', 'utf8');
    const read = readInFlight(repo);
    expect(read.branches).toBeNull();
    expect(read.error).not.toBe('');
  });

  it('a well-formed file with a malformed ENTRY keeps the rest', () => {
    // The asymmetry: an unreadable FILE refuses because the shared answer is
    // unknown; one bad entry inside a readable file is dropped, because the rest
    // of the file still says what the other boards are holding.
    fs.mkdirSync(path.dirname(inFlightPath(repo)), { recursive: true });
    fs.writeFileSync(
      inFlightPath(repo),
      JSON.stringify({ marks: { 'feature/a': Date.now(), 'feature/bad': 'soon' } }),
      'utf8',
    );
    expect(readInFlight(repo).branches).toEqual(new Set(['feature/a']));
  });
});

describe('sharedInFlightBlocks — an unreadable shared record starts nothing', () => {
  it('refuses when the record could not be read', () => {
    expect(sharedInFlightBlocks(false)).toBe(true);
  });

  it('permits when the record was read', () => {
    expect(sharedInFlightBlocks(true)).toBe(false);
  });

  it('permits when the question was not asked — absent is not false', () => {
    // The convention `machine` and `agents` already keep. A caller predating the
    // shared record gets its old single-board behaviour, not a refusal it has no
    // way to clear.
    expect(sharedInFlightBlocks(undefined)).toBe(false);
  });

  it('starts NOTHING through the planner when the record is unreadable', () => {
    // The tempting fallback is *count what I can see*, which reproduces the bug
    // exactly. Three branches, an empty cap-3 fleet: without the gate this
    // pulse dispatches all three.
    const p = planAutoDispatch({
      controls: controls(true, 3),
      pulse: pulse([['2026-09-11-p.md', 'approved', [
        slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open']]),
      ]]]),
      liveCount: 0,
      inFlight: new Set(),
      sharedInFlight: false,
      missingBriefs: new Set(),
    });
    expect(p).toEqual([]);
  });
});

describe('two boards together start no more than parallelAgents', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-twoboard-'));
  });
  afterEach(() => {
    rmTree(repo);
  });

  /**
   * One board's pulse, against the shared store — the decision half of
   * `maybeAutoDispatch` with the same read/merge/write order and no spawn.
   *
   * `own` is the board's private set, the field `entry.autoInFlight` holds. It
   * is threaded back by the caller exactly as the scan does, so a "board" here
   * is a closure over its own set plus the one file on disk.
   */
  const boardPulse = (
    own: Set<string>,
    p: FleetReading,
    cap: number,
    liveCount = 0,
  ): { started: string[]; own: Set<string> } => {
    const shared = readInFlight(repo);
    const allInFlight = new Set(own);
    for (const b of shared.branches ?? []) allInFlight.add(b);
    const plans = planAutoDispatch({
      controls: controls(true, cap),
      pulse: p,
      liveCount,
      inFlight: allInFlight,
      sharedInFlight: shared.branches !== null,
      missingBriefs: new Set(),
    });
    // What the dispatch would claim, capped at the invocation's `max` — the
    // same rule `runAutoDispatch` marks by.
    const started: string[] = [];
    for (const plan of plans) {
      started.push(
        ...startableBranches(p, plan.slug, allInFlight, new Set()).slice(0, plan.max),
      );
    }
    const nextOwn = new Set(own);
    for (const b of started) nextOwn.add(b);
    writeInFlight(repo, nextOwn);
    return { started, own: nextOwn };
  };

  it('THE BUG: board B does not re-spend the slots board A just took', () => {
    // Cap 3, three eligible branches, two boards seconds apart. Board A starts
    // all three. Board B's pulse lands before any claim ref, manifest or
    // registry entry exists — the detached window — and it must start nothing.
    //
    // An implementation that shares the LIVE count but not the in-flight set
    // passes every single-board test above and fails right here: with liveCount
    // still 0 for both, board B sees an empty fleet and starts three more.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open'],
      ]),
    ]]]);

    const a = boardPulse(new Set(), p, 3);
    expect(a.started).toEqual(['feature/a', 'feature/b', 'feature/c']);

    // Board B: its OWN set is empty — it dispatched nothing and shares no
    // memory with A. Only the file tells it the budget is spent.
    const b = boardPulse(new Set(), p, 3);
    expect(b.started).toEqual([]);
  });

  it('the two together never exceed the cap when they split it', () => {
    // Board A takes part of the budget; board B may take exactly the remainder
    // and no more. This is the property `--max` alone cannot promise, now across
    // processes rather than across pulses.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'],
        ['feature/c', 'open'], ['feature/d', 'open'],
      ]),
    ]]]);

    // A cap-2 fleet where A has already taken one slot.
    writeInFlight(repo, ['feature/a']);
    const b = boardPulse(new Set(), p, 2);
    expect(b.started).toEqual(['feature/b']);

    // A third pulse from either board adds nothing: the cap is spent.
    expect(boardPulse(new Set(), p, 2).started).toEqual([]);
  });

  it('ONE BOARD ALONE IS UNCHANGED — it starts what it always started', () => {
    // The assertion that catches a fix buying cross-board safety by making a
    // single board more conservative than it was. Same pulse, same cap, no peer:
    // the numbers are the ones the cross-pulse tests above already assert.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open'],
      ]),
    ]]]);

    const one = boardPulse(new Set(), p, 2);
    expect(one.started).toEqual(['feature/a', 'feature/b']);

    // And its NEXT pulse, threading its own set back exactly as the scan does,
    // is the cross-pulse cap: it does not restart what it already started.
    const two = boardPulse(one.own, p, 2);
    expect(two.started).toEqual([]);
  });

  it('a dead board RELEASES its budget once its marks expire', () => {
    // The failure this fix trades into, bounded. Board A marks three branches
    // and dies — nothing renews them. Board B must eventually start work rather
    // than wait on a process that no longer exists.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open'],
      ]),
    ]]]);
    const diedAt = 5_000_000;
    writeInFlight(repo, ['feature/a', 'feature/b', 'feature/c'], diedAt);

    // Inside the window the budget is still held — a slow dispatch is not a
    // dead board.
    const held = readInFlight(repo, diedAt + IN_FLIGHT_TTL_MS - 1);
    expect(held.branches?.size).toBe(3);

    // Past it, the slots come back.
    const freed = readInFlight(repo, diedAt + IN_FLIGHT_TTL_MS + 1);
    expect(freed.branches).toEqual(new Set());
    const planned = planAutoDispatch({
      controls: controls(true, 3),
      pulse: p,
      liveCount: 0,
      inFlight: freed.branches ?? new Set(),
      sharedInFlight: freed.branches !== null,
      missingBriefs: new Set(),
    });
    expect(total(planned)).toBe(3);
  });

  it('a LIVE peer keeps its budget across many pulses', () => {
    // The other side of the previous test: expiry must not release a board that
    // is still running. Board A renews every pulse; board B keeps refusing, for
    // as long as A keeps saying so.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);

    let a = boardPulse(new Set(), p, 2);
    expect(a.started).toEqual(['feature/a', 'feature/b']);
    // Ten more pulses from A, each renewing its marks.
    for (let i = 0; i < 10; i += 1) a = boardPulse(a.own, p, 2);
    expect(boardPulse(new Set(), p, 2).started).toEqual([]);
  });

  it('a live agent and a peer mark are charged TOGETHER against one cap', () => {
    // The two halves of the denominator, from two different sources: the shared
    // registry answers `liveCount`, the shared file answers in-flight. Cap 3,
    // one live worker, one peer mark → exactly one slot left.
    const p = pulse([['2026-09-11-p.md', 'approved', [
      slice('W', 'eligible', [
        ['feature/a', 'open'], ['feature/b', 'open'], ['feature/c', 'open'],
      ]),
    ]]]);
    writeInFlight(repo, ['feature/a']);
    const b = boardPulse(new Set(), p, 3, 1);
    expect(b.started).toEqual(['feature/b']);
  });

  it('liveAgentBranches stays consistent with liveAgentCount', () => {
    // Carried over unchanged: the count is the decision and the names are the
    // explanation, so a divergence makes the refusal describe a different fleet
    // than the one counted. Nothing in this slice touches either, and this is
    // the lock that says so.
    const agents = [
      agent('feature/a', 'running'),
      agent('feature/b', 'waiting'),
      agent('feature/c', 'finished'),
    ];
    const p = pulse([]);
    expect(liveAgentBranches(agents, p).length).toBe(liveAgentCount(agents, p));
  });
});

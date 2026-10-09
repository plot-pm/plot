import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planAutoDispatch, startableBranches, liveAgentCount, liveAgentBranches, freeAgentCount, pruneInFlight, freeAgentLabels, mergedBranches, planSlug, dispatchCandidates, machineDefers, machineIsClear, skippedPlans, sharedInFlightBlocks, type AutoDispatchPlan } from '@plot-pm/domain';
import { briefPath } from '../../src/shared/auto-dispatch.js';
import {
  readInFlight,
  writeInFlight,
  inFlightPath,
  IN_FLIGHT_TTL_MS,
} from '../../src/shared/in-flight-store.js';
import { measureMachine, ceilingFor, HEADROOM_THRESHOLDS, type Machine as MachineEntity } from '@plot-pm/domain';
import { FleetReadingSchema, type FleetReading } from '@plot-pm/domain/entities/fleet';
import type { AgentEntry } from '../../src/shared/registry.js';
import type { FleetSettings } from '../../src/shared/fleet-settings-store.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

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
  identity: 'manifest',
  branch,
  worktree: `/wt/${branch}`,
  command: '',
  startedAt: '2026-08-23T00:00:00Z',
  pid: '123',
  previousPid: '',
  relaunches: 0,
  state,
});

/**
 * A desk no manifest names, the shape `synthesizeEntry` produces: `branch`
 * is `''` and `checkout` carries the desk's own branch — a fact about the
 * desk, not an assignment from the registry. See `registry.ts:synthesizeEntry`.
 */
const undeclaredAgent = (checkout: string, state: AgentEntry['state']): AgentEntry => ({
  session: '',
  identity: 'synthesized',
  branch: '',
  checkout,
  worktree: `/wt/${checkout}`,
  command: '',
  startedAt: '',
  pid: '',
  previousPid: '',
  relaunches: 0,
  state,
});

const total = (plans: AutoDispatchPlan[]) => plans.reduce((n, p) => n + p.max, 0);

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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clockManual, fleetdHeartbeatFile, fleetStateFile, fleetStateVouched } from '@plot-pm/domain/adapters';
import { answered, decodeFleetdHeartbeat, encodeFleetdHeartbeat, failed, fleetdLiveness, lateLoops, FleetReadingSchema, type FleetdHeartbeat } from '@plot-pm/domain';
import { bridgeVouched } from '@plot-pm/domain/rules/fleetd-live';
import { fleetOwnsScan } from '@plot-pm/domain/rules/scan-owner';
import type { FleetdHeartbeatStore } from '@plot-pm/domain/ports/fleetd-heartbeat';

import { run, type RunSeams } from '../../src/server/entry/registryd-main.js';
import type { TickReport } from '../../src/server/entry/registryd.js';
import { startFleetdHeartbeat, supervisedFrom, trackBridgeWrites } from '../../src/shared/fleetd-heartbeat.js';

const settle = async (turns = 5): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
};

const completedTick = (): TickReport => ({
  startedAt: 0,
  costMs: 1,
  agents: 0,
  incomplete: '',
  handOver: null,
  decision: {
    outcome: 'decided',
    workflow: 'supervise',
    writes: [],
    detail: { agents: [], left: [], reaping: [], correcting: [], needingAPerson: [], deferred: [], unclaimed: [] },
  },
});

describe('supervisedFrom', () => {
  it.each([
    ['the fleet label', { XPC_SERVICE_NAME: 'com.plot.fleetd' }, 'launchd'],
    ['a terminal application', { XPC_SERVICE_NAME: 'application.com.googlecode.iterm2.123' }, 'none'],
    ['a terminal session', { XPC_SERVICE_NAME: '0' }, 'none'],
    ['a systemd invocation', { INVOCATION_ID: 'abc123' }, 'systemd'],
    ['an empty environment', {}, 'none'],
    ['empty values', { XPC_SERVICE_NAME: '', INVOCATION_ID: '' }, 'none'],
  ])('reads %s', (_name, env, expected) => {
    expect(supervisedFrom(env, 'com.plot.fleetd')).toBe(expected);
  });
});

describe('startFleetdHeartbeat', () => {
  const source = { pid: 99, startedAt: 5, supervised: 'none' as const, generation: () => 3, bridgeAt: () => null, passes: () => ({}) };

  it('writes once at start and then on every beat', async () => {
    const clock = clockManual(1_000);
    const written: number[] = [];
    const store: FleetdHeartbeatStore = {
      read: async () => answered(null),
      write: async (h) => {
        written.push(h.beatAt);
        return answered(undefined);
      },
    };
    startFleetdHeartbeat(clock, store, source, () => undefined);
    await settle();
    clock.advance(1);
    await settle();
    clock.advance(1);
    await settle();
    expect(written).toEqual([1_000, 6_000, 11_000]);
  });

  it('reports the safety net\'s last read and its count, and null with no count where none runs', async () => {
    const clock = clockManual(1_000);
    const seen: FleetdHeartbeat[] = [];
    const store: FleetdHeartbeatStore = { read: async () => answered(null), write: async (h) => (seen.push(h), answered(undefined)) };
    startFleetdHeartbeat(clock, store, { ...source, safetyNet: () => ({ lastSafetyNetAt: 900, missedChanges: 2 }) }, () => undefined);
    startFleetdHeartbeat(clock, store, source, () => undefined);
    await settle();
    expect(seen[0]).toMatchObject({ lastSafetyNetAt: 900, missedChanges: 2 });
    expect(seen[1]?.lastSafetyNetAt).toBeNull();
    expect(seen[1] !== undefined && 'missedChanges' in seen[1]).toBe(false);
  });

  it('reports the process, the generation and the absent channel protocol', async () => {
    const clock = clockManual(1_000);
    let seen: unknown = null;
    startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async (h) => ((seen = h), answered(undefined)) },
      source,
      () => undefined,
    );
    await settle();
    expect(seen).toMatchObject({ pid: 99, startedAt: 5, generation: 3, supervised: 'none', bridgeAt: null });
    expect(seen).not.toHaveProperty('protocol');
  });

  it('publishes the host transport fleetd chose at start', async () => {
    const clock = clockManual(1_000);
    let seen: unknown = null;
    const hostTransport = { transport: 'in-process', reason: 'the git host is github', tokenSource: 'GH_TOKEN' } as const;
    startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async (h) => ((seen = h), answered(undefined)) },
      { ...source, hostTransport },
      () => undefined,
    );
    await settle();
    expect(seen).toMatchObject({ hostTransport });
    expect(decodeFleetdHeartbeat(encodeFleetdHeartbeat(seen as FleetdHeartbeat))?.hostTransport).toEqual(hostTransport);
  });

  it('stops beating on cancel', async () => {
    const clock = clockManual(0);
    let writes = 0;
    const cancel = startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async () => (writes += 1, answered(undefined)) },
      source,
      () => undefined,
    );
    await settle();
    await cancel();
    clock.advance(3);
    await settle();
    expect(writes).toBe(2);
    expect(clock.scheduled()).toBe(0);
  });

  it('writes a final record dated 0 on stop, which reads stale', async () => {
    const clock = clockManual(50_000);
    const seen: number[] = [];
    const stop = startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async (h) => (seen.push(h.beatAt), answered(undefined)) },
      source,
      () => undefined,
    );
    await settle();
    await stop();
    await stop();
    expect(seen).toEqual([50_000, 0]);
    expect(fleetdLiveness({ ...({} as FleetdHeartbeat), beatAt: 0 }, 50_000)).toBe('stale');
  });

  it('lets a write in flight at stop finish before the final record lands', async () => {
    const clock = clockManual(50_000);
    const seen: number[] = [];
    let release: () => void = () => undefined;
    const stop = startFleetdHeartbeat(
      clock,
      {
        read: async () => answered(null),
        write: async (h) => {
          if (seen.length === 0) await new Promise<void>((r) => (release = r));
          seen.push(h.beatAt);
          return answered(undefined);
        },
      },
      source,
      () => undefined,
    );
    await settle();
    const stopped = stop();
    clock.advance(1);
    await settle();
    expect(seen).toEqual([]);
    release();
    await stopped;
    expect(seen).toEqual([50_000, 0]);
  });

  it('reports each loop that has passed', async () => {
    const clock = clockManual(1_000);
    let seen: unknown = null;
    startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async (h) => ((seen = h), answered(undefined)) },
      { ...source, passes: () => ({ tick: 700, scan: 800 }) },
      () => undefined,
    );
    await settle();
    expect(seen).toMatchObject({ loops: { tick: { lastPassAt: 700 }, scan: { lastPassAt: 800 } } });
  });

  it('warns once per run of failures and again after a success', async () => {
    const clock = clockManual(0);
    const outcomes = [false, false, true, false];
    const warnings: string[] = [];
    startFleetdHeartbeat(
      clock,
      {
        read: async () => answered(null),
        write: async () => (outcomes.shift() ? answered(undefined) : failed<void>()),
      },
      source,
      (line) => warnings.push(line),
    );
    await settle();
    for (let i = 0; i < 3; i += 1) {
      clock.advance(1);
      await settle();
    }
    expect(warnings).toHaveLength(2);
  });

  it('skips a beat while the previous write is in flight', async () => {
    const clock = clockManual(0);
    let writes = 0;
    let release: () => void = () => undefined;
    startFleetdHeartbeat(
      clock,
      {
        read: async () => answered(null),
        write: async () => {
          writes += 1;
          await new Promise<void>((r) => (release = r));
          return answered(undefined);
        },
      },
      source,
      () => undefined,
    );
    await settle();
    clock.advance(2);
    await settle();
    expect(writes).toBe(1);
    release();
    await settle();
  });

  it('writes nothing when the clock cannot answer', async () => {
    let writes = 0;
    const clock = { ...clockManual(0), now: () => failed<number>() };
    startFleetdHeartbeat(
      clock,
      { read: async () => answered(null), write: async () => (writes += 1, answered(undefined)) },
      source,
      () => undefined,
    );
    await settle();
    expect(writes).toBe(0);
  });
});

/** Polls the store until the heartbeat's beatAt differs from `after`, or fails after 2 s. */
const nextBeat = async (store: FleetdHeartbeatStore, after: number | null): Promise<number> => {
  for (let i = 0; i < 200; i += 1) {
    const read = await store.read();
    if (read.ok && read.value !== null && read.value.beatAt !== after) return read.value.beatAt;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the heartbeat did not move');
};

/**
 * Fires beats until the heartbeat's beatAt differs from `after`. The heartbeat
 * drops a beat that fires while its previous write is still in flight, so a
 * single `advance` can be swallowed on a slow runner; a swallowed beat is
 * fired again rather than waited for. The test's own timeout bounds the loop.
 */
const advanceToBeat = async (clock: ReturnType<typeof clockManual>, store: FleetdHeartbeatStore, after: number | null): Promise<number> => {
  for (;;) {
    clock.advance(1);
    for (let i = 0; i < 20; i += 1) {
      const read = await store.read();
      if (read.ok && read.value !== null && read.value.beatAt !== after) return read.value.beatAt;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
};

describe('run — the heartbeat', () => {
  let dir = '';
  beforeEach(() => {
    // A plain directory: no git host, no registry.
    dir = mkdtempSync(join(tmpdir(), 'fleetd-heartbeat-run-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const quiet = (clock: ReturnType<typeof clockManual>, overrides: Partial<RunSeams> = {}): RunSeams => ({
    clock,
    tick: async () => completedTick(),
    scan: async () => undefined,
    readPrs: async () => undefined,
    readDefaultBranch: async () => undefined,
    readIssues: async () => undefined,
    readIssueWrites: async () => undefined,
    openChannel: (async () => ({ stop: async () => undefined })) as never,
    overChannel: () => ({ indexMonitor: null, deskRelay: async () => undefined }),
    ...overrides,
  });

  it('writes fleetd.json at start and moves beatAt on every 5 s beat for 1 minute, with no git host and idle loops', async () => {
    const clock = clockManual(1_700_000_000_000);
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    const beats: number[] = [];
    let stopped = false;
    let sleeps = 0;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        if (sleeps === 0) beats.push(await nextBeat(store, null));
        sleeps += 1;
        clock.advance(1);
        beats.push(await nextBeat(store, beats[beats.length - 1]!));
        if (sleeps === 12) stopped = true;
      },
      () => stopped,
      () => undefined,
      dir,
      quiet(clock, { snapshotGeneration: () => 0 }),
    );
    expect(beats).toHaveLength(13);
    expect(beats[0]).toBe(1_700_000_000_000);
    beats.slice(1).forEach((beatAt, i) => expect(beatAt - beats[i]!).toBe(5_000));
    expect(beats[12]! - beats[0]!).toBe(60_000);
  });

  it('writes the armed watch set into the observer fields', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
    const armed: string[] = [];
    const watch = {
      arm: (armedDir: string) => {
        armed.push(armedDir);
        return { degraded: armedDir === join(realpathSync(dir), '.git'), close: () => undefined };
      },
    };
    const clock = clockManual(1_000);
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let read: Awaited<ReturnType<typeof store.read>> | null = null;
    let sleeps = 0;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
        await nextBeat(store, null);
        read = await store.read();
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock, { watch }),
    );
    const beat = read !== null && (read as { ok: boolean }).ok ? (read as unknown as { value: FleetdHeartbeat }).value : null;
    expect(armed.length).toBeGreaterThan(0);
    expect(beat?.watchesWanted).toBe(armed.length);
    expect(beat?.watchesArmed).toBe(armed.length - 1);
    expect(beat?.lastEventAt).toBeNull();
  });

  it('stamps lastSafetyNetAt once the first full read finishes, with no missed change', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
    const clock = clockManual(1_000);
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let read: Awaited<ReturnType<typeof store.read>> | null = null;
    let sleeps = 0;
    let scanned = false;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
        // THE STAMP LANDS AFTER THE SCAN, so the beat that ran it may carry the
        // old value: beat on until a heartbeat carries one, at most ten times.
        let at = await nextBeat(store, null);
        for (let n = 0; n < 10; n += 1) {
          at = await advanceToBeat(clock, store, at);
          read = await store.read();
          const value = read.ok ? read.value : null;
          if (scanned && value !== null && value.lastSafetyNetAt !== null) break;
        }
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock, { watch: { arm: () => ({ degraded: false, close: () => undefined }) }, scan: async () => void (scanned = true) }),
    );
    const beat = read !== null && (read as { ok: boolean }).ok ? (read as unknown as { value: FleetdHeartbeat }).value : null;
    expect(beat?.lastSafetyNetAt).toEqual(expect.any(Number));
    expect(beat?.lastSafetyNetAt).toBeGreaterThan(1_000);
    expect(beat?.missedChanges).toBe(0);
  });

  it('writes the generation the seam reports', async () => {
    const clock = clockManual(1_000);
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let read: Awaited<ReturnType<typeof store.read>> | null = null;
    let sleeps = 0;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
        await nextBeat(store, null);
        read = await store.read();
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock, { snapshotGeneration: () => 12 }),
    );
    expect(read !== null && (read as { ok: boolean }).ok && (read as { value: { generation: number } }).value.generation).toBe(12);
  });

  it('records the tick pass, and leaves a stale heartbeat after a clean stop', async () => {
    const clock = clockManual(1_700_000_000_000);
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let sleeps = 0;
    let during: Awaited<ReturnType<typeof store.read>> | null = null;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
        clock.advance(1);
        await nextBeat(store, 1_700_000_000_000);
        during = await store.read();
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock),
    );
    const seen = during as unknown as { ok: true; value: FleetdHeartbeat };
    expect(seen.value.loops.tick?.lastPassAt).toBeGreaterThan(0);
    const after = await store.read();
    expect(after.ok && after.value !== null && fleetdLiveness(after.value, Date.now())).toBe('stale');
  });

  it('registers every loop at start, and keeps a scan whose first pass never resolves on time while the beat runs', async () => {
    const clock = clockManual(Date.now());
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let sleeps = 0;
    let first: FleetdHeartbeat | null = null;
    let last: FleetdHeartbeat | null = null;
    let release: () => void = () => undefined;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        if (sleeps === 0) {
          const read = await store.read();
          first = read.ok ? read.value : null;
        }
        sleeps += 1;
        let beatAt = 0;
        for (let i = 0; i < 19; i += 1) {
          beatAt = await advanceToBeat(clock, store, beatAt);
        }
        const read = await store.read();
        last = read.ok ? read.value : null;
        release();
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock, { scan: () => new Promise<void>((r) => (release = r)) }),
    );
    expect(first).toMatchObject({ loops: { scan: { lastPassAt: null }, 'pr-reader': { lastPassAt: null }, 'issue-reader': { lastPassAt: null } } });
    const seen = last as unknown as FleetdHeartbeat;
    expect(lateLoops(seen, seen.beatAt)).toEqual([]);
  });

  it.each([
    ['older than', 20 * 60_000],
    ['younger than', 5 * 60_000],
  ])('keeps ownership while the beat runs under a failing scan, and vouches for no bridge, with a bridge %s 15 minutes', async (_name, bridgeAge) => {
    // The real scan runs in a plain directory with no scripts, so every scan fails.
    const start = Date.now();
    const clock = clockManual(start);
    const old = start - bridgeAge;
    await fleetStateFile({ repoRoot: dir, now: () => old }).write({
      at: old,
      pulse: FleetReadingSchema.parse({
        main: 'main',
        head: 'abc',
        fetch_failed: false,
        summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
        plans: [],
      }),
      ages: new Map(),
      branchUrlBase: '',
      approvedAt: new Map(),
      ideaPlans: new Map(),
      prError: null,
    });
    const store = fleetdHeartbeatFile({ repoRoot: dir });
    let sleeps = 0;
    let last: FleetdHeartbeat | null = null;
    await run(
      [],
      dir,
      () => undefined,
      async () => {
        sleeps += 1;
        let beatAt = 0;
        for (let i = 0; i < 19; i += 1) {
          beatAt = await advanceToBeat(clock, store, beatAt);
        }
        const read = await store.read();
        last = read.ok ? read.value : null;
      },
      () => sleeps > 0,
      () => undefined,
      dir,
      quiet(clock, { scan: undefined }),
    );
    const seen = last as unknown as FleetdHeartbeat;
    expect(seen.loops.scan?.lastPassAt).toBeNull();
    expect(seen.bridgeAt).toBeNull();
    // A bridge under 15 minutes old still takes the scan's own `failed` attempt record.
    const bridge = await fleetStateFile({ repoRoot: dir }).read();
    if (bridgeAge < 15 * 60_000) expect(bridge.ok && bridge.value?.attempt?.outcome).toBe('failed');
    expect(fleetOwnsScan({ heartbeat: seen, now: seen.beatAt })).toBe(true);
    expect(bridgeVouched({ at: old }, seen, seen.beatAt)).toBe(false);
  });

  it('writes no heartbeat under --once', async () => {
    const clock = clockManual(1_000);
    await run(['--once'], dir, () => undefined, async () => undefined, () => true, () => undefined, dir, quiet(clock));
    await settle();
    clock.advance(3);
    await settle();
    expect(existsSync(join(dir, '.plot', 'state', 'fleetd.json'))).toBe(false);
  });
});

describe('the heartbeat vouches for the bridge fleetd wrote', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleetd-heartbeat-bridge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const emptyPulse = (at: number) => ({
    at,
    pulse: FleetReadingSchema.parse({
      main: 'main',
      head: 'abc',
      fetch_failed: false,
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      plans: [],
    }),
    ages: new Map(),
    branchUrlBase: '',
    approvedAt: new Map(),
    ideaPlans: new Map(),
    prError: null,
    attempt: { startedAt: at, endedAt: at, outcome: 'ok' as const, error: null },
  });

  const beatWith = async (beatClockAt: number): Promise<number> => {
    const bridgeAt = Date.now() - 20 * 60_000;
    const bridge = trackBridgeWrites(fleetStateFile({ repoRoot: dir }));
    await bridge.state.write(emptyPulse(bridgeAt));
    startFleetdHeartbeat(
      clockManual(beatClockAt),
      fleetdHeartbeatFile({ repoRoot: dir }),
      { pid: 1, startedAt: beatClockAt - 1_000, supervised: 'none', generation: () => 0, bridgeAt: bridge.bridgeAt, passes: () => ({}) },
      () => undefined,
    );
    await settle(20);
    return bridgeAt;
  };

  it('accepts a 20 minute old bridge while fleetd beats', async () => {
    const bridgeAt = await beatWith(Date.now());
    const read = await fleetStateVouched(dir).read();
    expect(read.ok && read.value?.at).toBe(bridgeAt);
  });

  it('refuses the same bridge once the heartbeat is stale', async () => {
    await beatWith(Date.now() - 120_000);
    const read = await fleetStateVouched(dir).read();
    expect(read.ok && read.value).toBeNull();
  });

  it('reports null until a write lands, and ignores a failed write', async () => {
    const failing = trackBridgeWrites({ read: async () => answered(null), readSync: () => answered(null), write: async () => failed<void>() } as never);
    await failing.state.write(emptyPulse(5));
    expect(failing.bridgeAt()).toBeNull();
  });
});

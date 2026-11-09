import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import cp, { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type http from 'node:http';
import { FLEETD_HEARTBEAT_VERSION, answered, type FleetdHeartbeat, type Scripts } from '@plot-pm/domain';
import type { PlanEntry, RepoSnapshot } from '@plot-pm/domain/entities/snapshot';
import { emptySnapshot } from '@plot-pm/domain/entities/snapshot';
import type { HeldSnapshot } from '@plot-pm/domain/rules/snapshot-sync';
import type { SnapshotLink } from '@plot-pm/domain/rules/snapshot-link';
import { walkValueOf, type WalkHeader } from '@plot-pm/domain/workflows/board-view';
import type { BranchStageReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import type { Estate } from '@plot-pm/domain/workflows/plan-walk-estate';

// While fleetd's heartbeat is live and the channel holds a current snapshot,
// the board's refresh installs the view fleetd sent and starts no process. On
// `mismatch` or a stale heartbeat it reads for itself, as before.
//
// THE SPAWN SPY COUNTS EVERY CHILD PROCESS THIS TEST PROCESS STARTS. It wraps
// each `child_process` function before the board's modules load, so a module
// that binds `promisify(execFile)` at load binds the counted one.

const counted = { calls: [] as string[] };
const wrap = <F extends (...args: never[]) => unknown>(name: string, original: F): F => {
  const wrapped = ((...args: Parameters<F>) => {
    counted.calls.push(`${name} ${String(args[0])}`);
    return original(...args);
  }) as unknown as F;
  const custom = (original as unknown as Record<symbol, unknown>)[promisify.custom];
  if (typeof custom === 'function') {
    Object.defineProperty(wrapped, promisify.custom, {
      value: (...args: unknown[]) => {
        counted.calls.push(`${name} ${String(args[0])}`);
        return (custom as (...a: unknown[]) => unknown)(...args);
      },
    });
  }
  return wrapped;
};
const NAMES = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
const originals = Object.fromEntries(NAMES.map((name) => [name, cp[name]])) as Record<(typeof NAMES)[number], unknown>;

type Fleet = typeof import('../../src/server/fleet.js');
type Hub = typeof import('../../src/server/channel-events.js');
type Adapters = typeof import('@plot-pm/domain/adapters');
let fleet: Fleet;
let hubModule: Hub;
let adapters: Adapters;

beforeAll(async () => {
  for (const name of NAMES) (cp as unknown as Record<string, unknown>)[name] = wrap(name, originals[name] as never);
  syncBuiltinESMExports();
  fleet = await import('../../src/server/fleet.js');
  hubModule = await import('../../src/server/channel-events.js');
  adapters = await import('@plot-pm/domain/adapters');
});

afterAll(() => {
  for (const name of NAMES) (cp as unknown as Record<string, unknown>)[name] = originals[name];
  syncBuiltinESMExports();
});

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  fleet.stopFleetRefresh();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const MAIN = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const fileOf = (title: string): string => `docs/plans/2026-01-01-${title.toLowerCase()}.md`;

const record = (title: string): PlanEntry => ({
  file: fileOf(title),
  format: 'v2',
  phase: 'approved',
  phaseRaw: 'Approved',
  type: 'feature',
  title,
  sprint: '',
  story: '',
  assignee: '',
  branches: ['feature/x'],
  prs: [],
  deferredPrs: [],
  slices: [{ name: 'One', branches: [{ branch: 'feature/x', deferred: false, deferredReason: '', claimed: '', waitsOn: [] }] }],
  review: 'pr',
  impl: 'own branches',
  approvedRaw: '2026-01-02, Jan Wloka',
  spikeApprovedRaw: '',
  deliveredRaw: '',
  releasedRaw: '',
  startedRaw: [],
  rejectedRaw: '',
  unreadBranchItems: [],
});

const header: WalkHeader = {
  main: 'main',
  readRef: 'aaaaaaa',
  localHead: 'aaaaaaa',
  fetchFailed: false,
  fetchError: '',
  planDir: 'docs/plans/',
  mergeDetect: 'unaskable',
  nowSeconds: 1_000_000,
};

const branchStageOf = (title: string): BranchStageReadings => ({
  mainSha: MAIN,
  backend: 'github',
  origin: 'git@github.com:o/r.git',
  hostReach: 'ok',
  merges: [],
  added: new Map([[fileOf(title), 'e'.repeat(40)]]),
  branches: [
    {
      plan: fileOf(title),
      branch: 'feature/x',
      readings: {
        deferredByPlan: false,
        refTip: TIP,
        mainTip: MAIN,
        mergeSubjectFound: false,
        hostReach: 'ok',
        pr: 'OPEN',
        prListComplete: true,
        commitsAhead: 2,
        realCommitsAhead: 2,
        waits: [],
      },
      landed: [],
      changedPaths: ['src/a.ts'],
      localAhead: 0,
    },
  ],
});

const read = <T,>(value: T) => ({ state: 'read' as const, readAt: Date.now(), value });

/** A snapshot whose walk lists one plan titled `title`, with no desk. */
const snapshotTitled = (title: string, generation: number): RepoSnapshot => {
  const estate: Estate = {
    mainSha: MAIN,
    source: 'ref',
    plans: [{ blob: { sha: 'c'.repeat(40), path: fileOf(title), source: 'main' }, record: record(title) }],
    indexes: [],
    dangling: [],
  };
  const base = emptySnapshot();
  return {
    generation,
    readings: {
      ...base.readings,
      desks: read([{ path: '/repo', branch: 'main', detached: false, isMain: true, clean: false, agentSession: null, prunable: false }]),
      deskFiles: read({}),
      workers: read({}),
      plans: read({ ref: 'origin/main', records: [record(title)] }),
      prs: read([{ number: 7, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u7' }]),
      walk: read(walkValueOf(estate, branchStageOf(title), { mainSha: MAIN, desks: [] }, new Map(), header)),
      branchDates: read([{ branch: 'feature/x', committedAt: Math.floor(Date.now() / 1000) - 600 }]),
      ideaPlans: read({}),
      releaseVersions: read({}),
      unmerged: read({ branches: ['feature/x'], claimOnly: [] }),
      questions: read({}),
    },
  };
};

const heartbeat = (beatAt: number): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION,
  pid: process.pid,
  startedAt: beatAt - 600_000,
  beatAt,
  generation: 1,
  bridgeAt: null,
  supervised: 'launchd',
  watchesWanted: 0,
  watchesArmed: 0,
  lastEventAt: null,
  lastSafetyNetAt: null,
  loops: {},
});

/** Every config key answers its fallback, so no `plot-config.sh` runs. */
const quietConfig = (): Scripts =>
  ({
    config: async (_key: string, fallback: string) => answered(fallback),
    configSync: (_key: string, fallback: string) => answered(fallback),
  }) as unknown as Scripts;

const fixture = async (beatAt = Date.now()) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-serve-snapshot-'));
  temps.push(dir);
  (originals.execFileSync as typeof cp.execFileSync)('git', ['init', '--quiet'], { cwd: dir });
  // A served board runs with `PLOT_REPO_ROOT` set (`plot-boardctl.sh`), which
  // answers the git directories without a `git rev-parse`.
  vi.stubEnv('PLOT_REPO_ROOT', dir);
  await adapters.fleetdHeartbeatFile({ repoRoot: dir }).write(heartbeat(beatAt));
  return { dir, opts: { repoRoot: dir, scriptsDir: dir, config: quietConfig() } };
};

const current = (held: HeldSnapshot): { link: SnapshotLink; held: HeldSnapshot } => ({
  link: { state: 'current', epoch: held.epoch, generation: held.snapshot.generation },
  held,
});

describe('the board serves from fleetd snapshot', () => {
  it('spawns 0 processes in 12 beats with a live heartbeat and a current channel', async () => {
    const { opts } = await fixture();
    const held = { epoch: 'e1', snapshot: snapshotTitled('X', 1) };
    const entry = fleet.freshCacheEntry();
    entry.clients = 1;
    const served = { ...opts, channelSnapshot: () => current(held) };
    // The fixture's heartbeat write already resolved the heartbeat path, whose
    // one `git rev-parse --git-common-dir` is cached per root for the process.
    counted.calls.length = 0;
    for (let i = 0; i < 12; i += 1) {
      await fleet.refresh(served, entry);
      await fleet.maybeRefreshPrs(served, entry);
    }
    expect(counted.calls).toEqual([]);
    expect(entry.viewSource).toBe('snapshot');
    expect(entry.pulse?.plans.map((plan) => plan.file)).toEqual(['2026-01-01-x.md']);
    expect(entry.prs?.get('feature/x')?.number).toBe(7);
    expect(entry.supervisor?.supervisor).toBe('up');
    expect(entry.prReader).toBe('fleet');
    expect(entry.scanNote).toBeNull();
  });

  it('runs its own scan with the channel in mismatch', async () => {
    const { opts } = await fixture();
    const entry = fleet.freshCacheEntry();
    entry.clients = 1;
    const link: SnapshotLink = { state: 'mismatch', reason: 'protocol 1', ours: 2, theirs: 1 };
    counted.calls.length = 0;
    await fleet.refresh({ ...opts, channelSnapshot: () => ({ link, held: undefined }) }, entry);
    expect(entry.viewSource).toBe('own');
    expect(counted.calls.length).toBeGreaterThan(0);
  });

  it('runs its own scan on the next beat once the heartbeat turns stale', async () => {
    const { dir, opts } = await fixture();
    const held = { epoch: 'e1', snapshot: snapshotTitled('X', 1) };
    const entry = fleet.freshCacheEntry();
    entry.clients = 1;
    const served = { ...opts, channelSnapshot: () => current(held) };
    await fleet.refresh(served, entry);
    expect(entry.viewSource).toBe('snapshot');
    await adapters.fleetdHeartbeatFile({ repoRoot: dir }).write(heartbeat(Date.now() - 600_000));
    counted.calls.length = 0;
    await fleet.refresh(served, entry);
    expect(entry.viewSource).toBe('own');
    expect(counted.calls.length).toBeGreaterThan(0);
  });

  it('reads for itself with no tab attached, whatever the channel holds', async () => {
    const { opts } = await fixture();
    const held = { epoch: 'e1', snapshot: snapshotTitled('X', 1) };
    const entry = fleet.freshCacheEntry();
    await fleet.refresh({ ...opts, channelSnapshot: () => current(held) }, entry);
    expect(entry.viewSource).toBe('own');
  });

  it('names the fields the snapshot holds no reading for and keeps their last value', async () => {
    const { opts } = await fixture();
    const snapshot = snapshotTitled('X', 4);
    snapshot.readings.releaseVersions = { state: 'unread' };
    const entry = fleet.freshCacheEntry();
    entry.clients = 1;
    entry.versions = new Map([['changeset-release/main', '1.0.0']]);
    await fleet.refresh({ ...opts, channelSnapshot: () => current({ epoch: 'e', snapshot }) }, entry);
    expect(entry.versions).toEqual(new Map([['changeset-release/main', '1.0.0']]));
    expect(entry.scanNote).toContain('holds no reading for versions');
  });
});

describe('no tab, no pulse, with a snapshot held', () => {
  it('starts no pulse with no stream, runs one while a stream is attached, and stops it when the last leaves', async () => {
    const { opts } = await fixture();
    const held = { epoch: 'e1', snapshot: snapshotTitled('X', 1) };
    const served = { ...opts, channelSnapshot: () => current(held) };
    fleet.watchFleet(served, 0);
    expect(fleet.ensureCache(served).pulseClock).toBeNull();
    fleet.watchFleet(served, 1);
    expect(fleet.ensureCache(served).pulseClock).not.toBeNull();
    fleet.watchFleet(served, 0);
    expect(fleet.ensureCache(served).pulseClock).toBeNull();
  });
});

/** A response the hub can hold as an event stream, recording what it was sent. */
const stream = () => {
  const req = new EventEmitter() as unknown as http.IncomingMessage;
  const sent: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: () => res,
    write: (chunk: string) => {
      sent.push(chunk);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
  });
  return { req, res: res as unknown as http.ServerResponse, sent };
};

const until = async (holds: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('a delta on the channel', () => {
  it('re-derives the view and sends one event; the next /api/fleet shows the changed row', async () => {
    const { dir, opts } = await fixture();
    const address = path.join(dir, 'c.sock');
    let held = snapshotTitled('Before', 1);
    const channel = await adapters.startChannel({ address, snapshot: () => held });
    const served: Parameters<Fleet['watchFleet']>[0] = { ...opts };
    const hub = hubModule.startEventHub({
      address,
      windowMs: 0,
      reconnectStartMs: 20,
      reconnectCapMs: 40,
      onSnapshot: () => fleet.fleetSnapshotArrived(served),
    });
    served.channelSnapshot = () => ({ link: hub.snapshotLink(), held: hub.snapshot() });
    try {
      const { req, res, sent } = stream();
      hub.attach(req, res);
      await until(() => hub.snapshotLink().state === 'current');
      fleet.watchFleet(served, 1);
      await until(() => fleet.ensureCache(served).viewSource === 'snapshot');
      const snapshotEvents = (): number => sent.filter((chunk) => chunk.includes('"type":"snapshot"')).length;
      const before = snapshotEvents();
      const next = snapshotTitled('After', 2);
      channel.snapshotChanged(held, next, ['walk', 'plans']);
      held = next;
      await until(() => snapshotEvents() === before + 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(snapshotEvents()).toBe(before + 1);
      const view = await fleet.buildFleet(served);
      expect(view.rows.map((row) => row.planFile)).toEqual(['2026-01-01-after.md']);
      expect(view.viewSource).toBe('snapshot');
    } finally {
      hub.close();
      await channel.stop();
    }
  });
});

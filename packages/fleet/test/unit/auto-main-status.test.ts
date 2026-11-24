import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { answered } from '@plot-pm/domain';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { StateHome } from '@plot-pm/domain/entities/state-home';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import { defaultBranchFile, hostFixture, refsFixture } from '@plot-pm/domain/adapters';
import {
  MAIN_STATUS_RETRY_MS,
  mainStatusPath,
  mainStatusState,
  mainStatusTick,
  readMainStatusMemory,
  readMainStatusPass,
  runAutoMainStatusPass,
  type MainStatusCache,
  type MainStatusFailures,
  type MainStatusMemory,
  type MainStatusPassReading,
  type MainStatusWorld,
} from '../../src/shared/auto-main-status.js';

const RED = '17a7fc4385d0e2b1c9a8f7e6d5c4b3a291807f6e';
const GREEN = 'a'.repeat(40);
const HEAD1 = '1'.repeat(40);
const HEAD2 = '2'.repeat(40);
const AT = '2026-11-23T10:00:00Z';
const NOW = Date.parse(AT) + 60_000;
const WAIT = 3_600_000;
const opts = { repoRoot: '/nowhere', scriptsDir: '/nowhere' };

const row = (number: number, headSha: string, over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number,
  head: `feature/${number}`,
  base: 'main',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: `https://host/pr/${number}`,
  headSha,
  ...over,
});

const red: DefaultBranchReading = {
  v: 1,
  branch: 'main',
  headSha: RED,
  head: 'red',
  headSince: AT,
  settled: { sha: RED, state: 'red' },
  failingRuns: [],
  askedAt: AT,
  at: AT,
};
const green: DefaultBranchReading = { ...red, head: 'green', settled: { sha: RED, state: 'green' } };

const record: RepairRecord = {
  v: REPAIR_RECORD_VERSION,
  branch: 'main',
  state: 'idle',
  lastGreenSha: GREEN,
  firstRedSha: RED,
  redSince: AT,
  candidates: [],
  rerun: 'none',
  preRevertRerun: 'none',
  at: AT,
  repairPr: 9,
};

const reading = (over: Partial<MainStatusPassReading> = {}): MainStatusPassReading => ({
  rows: [row(1, HEAD1), row(2, HEAD2)],
  defaultBranch: red,
  repair: undefined,
  defaultName: 'main',
  checksWaitMs: WAIT,
  ...over,
});

const rig = (fails = false) => {
  const writes: CommitStatusWrite[] = [];
  const notes: string[] = [];
  const world: MainStatusWorld = {
    host: () => hostFixture({ commitStatuses: writes, commitStatusFails: fails }),
    notify: (m) => notes.push(m),
  };
  return { writes, notes, world, memory: new Map() as MainStatusMemory, logged: new Set<string>() };
};

describe('mainStatusTick', () => {
  it('writes once per change and nothing on an unchanged tick', async () => {
    const r = rig();
    await mainStatusTick(reading(), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes.map((w) => [w.sha, w.state, w.context])).toEqual([
      [HEAD1, 'failure', 'plot/main'],
      [HEAD2, 'failure', 'plot/main'],
    ]);
    expect(r.writes[0]?.description).toBe('main is red on 17a7fc438; merge the repair PR first');
    const again = await mainStatusTick(reading(), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes).toHaveLength(2);
    expect(again.map((x) => x.outcome)).toEqual(['unchanged', 'unchanged']);
  });

  it('writes the new head of a PR once while main stays red, and nothing on the old head', async () => {
    const r = rig();
    await mainStatusTick(reading({ rows: [row(1, HEAD1)] }), NOW, opts, r.world, r.memory, r.logged);
    await mainStatusTick(reading({ rows: [row(1, HEAD2)] }), NOW, opts, r.world, r.memory, r.logged);
    await mainStatusTick(reading({ rows: [row(1, HEAD2)] }), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes.map((w) => [w.sha, w.state])).toEqual([
      [HEAD1, 'failure'],
      [HEAD2, 'failure'],
    ]);
  });

  it('clears every PR in one pass when main turns green, then writes nothing', async () => {
    const r = rig();
    await mainStatusTick(reading(), NOW, opts, r.world, r.memory, r.logged);
    await mainStatusTick(reading({ defaultBranch: green }), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes.slice(2).map((w) => [w.sha, w.state])).toEqual([
      [HEAD1, 'success'],
      [HEAD2, 'success'],
    ]);
    await mainStatusTick(reading({ defaultBranch: green }), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes).toHaveLength(4);
  });

  it('leaves a head unmarked after a failed write, and writes it again an hour later', async () => {
    const failing = rig(true);
    const failures: MainStatusFailures = new Map();
    const tick = (at: number, rows = [row(1, HEAD1)]) =>
      mainStatusTick(reading({ rows, checksWaitMs: 10 * WAIT }), at, opts, failing.world, failing.memory, failing.logged, failures);
    expect((await tick(NOW)).map((x) => x.outcome)).toEqual(['failed']);
    expect(failing.memory.size).toBe(0);
    expect(failing.notes).toHaveLength(1);
    expect((await tick(NOW + MAIN_STATUS_RETRY_MS - 1)).map((x) => x.outcome)).toEqual(['held']);
    expect(failing.writes).toHaveLength(1);
    expect((await tick(NOW + MAIN_STATUS_RETRY_MS)).map((x) => x.outcome)).toEqual(['failed']);
    expect(failing.writes).toHaveLength(2);
    expect(failing.notes).toHaveLength(1);
  });

  it('writes a new head on the next pass after a failed write on the old one', async () => {
    const failing = rig(true);
    const failures: MainStatusFailures = new Map();
    await mainStatusTick(reading({ rows: [row(1, HEAD1)] }), NOW, opts, failing.world, failing.memory, failing.logged, failures);
    await mainStatusTick(reading({ rows: [row(1, HEAD2)] }), NOW, opts, failing.world, failing.memory, failing.logged, failures);
    expect(failing.writes.map((w) => w.sha)).toEqual([HEAD1, HEAD2]);
  });

  it('forgets a failure once the write lands or the PR closes', async () => {
    const r = rig();
    const failures: MainStatusFailures = new Map([
      [1, { key: 'old', at: NOW }],
      [7, { key: 'old', at: NOW }],
    ]);
    await mainStatusTick(reading({ rows: [row(1, HEAD1)] }), NOW, opts, r.world, r.memory, r.logged, failures);
    expect(failures.size).toBe(0);
  });

  it('passes the admitted repair PR and fails the rest', async () => {
    const r = rig();
    const repairRow = row(9, HEAD1, { head: `bug/main-repair-${GREEN.slice(0, 12)}` });
    await mainStatusTick(
      reading({ rows: [repairRow, row(2, HEAD2)], repair: { record, episode: 'open', redRuns: 'red' } }),
      NOW,
      opts,
      r.world,
      r.memory,
      r.logged,
    );
    expect(r.writes.map((w) => [w.sha, w.state, w.description])).toEqual([
      [HEAD1, 'success', 'repair PR for 17a7fc438'],
      [HEAD2, 'failure', 'main is red on 17a7fc438; merge the repair PR first'],
    ]);
  });

  it('writes a new status when the repair record names a new PR', async () => {
    const r = rig();
    const rows = [row(9, HEAD1, { head: `bug/main-repair-${GREEN.slice(0, 12)}` })];
    await mainStatusTick(reading({ rows }), NOW, opts, r.world, r.memory, r.logged);
    await mainStatusTick(reading({ rows, repair: { record, episode: 'open', redRuns: 'red' } }), NOW, opts, r.world, r.memory, r.logged);
    expect(r.writes.map((w) => w.state)).toEqual(['failure', 'success']);
  });

  it('writes nothing for a PR into a sprint base', async () => {
    const r = rig();
    const results = await mainStatusTick(reading({ rows: [row(3, HEAD1, { base: 'sprint/2026-w48' })] }), NOW, opts, r.world, r.memory, r.logged);
    expect(results.map((x) => x.outcome)).toEqual(['none']);
    expect(r.writes).toHaveLength(0);
  });

});

const homes: string[] = [];
const home = (): StateHome => {
  const dir = mkdtempSync(join(tmpdir(), 'main-status-'));
  homes.push(dir);
  mkdirSync(join(dir, '.plot', 'state'), { recursive: true });
  return dir as StateHome;
};
afterEach(async () => {
  const { rmSync } = await import('node:fs');
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runAutoMainStatusPass', () => {
  it('runs no pass where nothing was read', async () => {
    const r = rig();
    const state = mainStatusState(opts);
    expect(await runAutoMainStatusPass(opts, state, NOW, r.world, async () => null)).toBeNull();
    expect(r.writes).toHaveLength(0);
  });

  it('keeps the statuses written in a file, so a restart writes only what changed', async () => {
    const h = home();
    const at = { ...opts, stateHome: { home: h } };
    const r = rig();
    await runAutoMainStatusPass(at, mainStatusState(at), NOW, r.world, async () => reading());
    expect(r.writes).toHaveLength(2);
    expect(readMainStatusMemory(mainStatusPath(h)).get(1)).toEqual({
      head: HEAD1,
      state: 'failure',
      description: 'main is red on 17a7fc438; merge the repair PR first',
    });
    const restarted = mainStatusState(at);
    const again = await runAutoMainStatusPass(at, restarted, NOW, r.world, async () => reading());
    expect(again?.map((x) => x.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(r.writes).toHaveLength(2);
    await runAutoMainStatusPass(at, restarted, NOW, r.world, async () => reading({ rows: [row(1, HEAD1)] }));
    expect([...readMainStatusMemory(mainStatusPath(h)).keys()]).toEqual([1]);
  });

  it('leaves the file unwritten on a pass that changed nothing', async () => {
    const h = home();
    const at = { ...opts, stateHome: { home: h } };
    const r = rig();
    const state = mainStatusState(at);
    await runAutoMainStatusPass(at, state, NOW, r.world, async () => reading());
    writeFileSync(mainStatusPath(h), 'sentinel');
    await runAutoMainStatusPass(at, state, NOW, r.world, async () => reading());
    expect(readFileSync(mainStatusPath(h), 'utf8')).toBe('sentinel');
  });

  it('keeps the memory in the process where no state home is read', async () => {
    const at = { ...opts, stateHome: { unread: true as const } };
    const r = rig();
    const state = mainStatusState(at);
    await runAutoMainStatusPass(at, state, NOW, r.world, async () => reading());
    await runAutoMainStatusPass(at, state, NOW, r.world, async () => reading());
    expect(r.writes).toHaveLength(2);
  });
});

describe('readMainStatusMemory', () => {
  it('reads a missing, unparseable or other-version file as empty', () => {
    const h = home();
    const path = mainStatusPath(h);
    expect(readMainStatusMemory(path).size).toBe(0);
    writeFileSync(path, '{');
    expect(readMainStatusMemory(path).size).toBe(0);
    writeFileSync(path, 'null');
    expect(readMainStatusMemory(path).size).toBe(0);
    writeFileSync(path, JSON.stringify({ v: 2, prs: { 1: { head: HEAD1, state: 'success', description: 'x' } } }));
    expect(readMainStatusMemory(path).size).toBe(0);
    writeFileSync(path, JSON.stringify({ v: 1, prs: null }));
    expect(readMainStatusMemory(path).size).toBe(0);
  });

  it('drops a malformed entry and keeps the rest', () => {
    const path = mainStatusPath(home());
    writeFileSync(path, JSON.stringify({
      v: 1,
      prs: {
        1: { head: HEAD1, state: 'success', description: 'main is not red' },
        x: { head: HEAD1, state: 'success', description: 'x' },
        2: null,
        3: { head: 3, state: 'success', description: 'x' },
        4: { head: HEAD1, state: 'pending', description: 'x' },
      },
    }));
    expect([...readMainStatusMemory(path).keys()]).toEqual([1]);
  });
});

describe('readMainStatusPass', () => {
  const counted = (h: StateHome, rows: readonly PrIndexRow[] = [row(1, HEAD1)]) => {
    const calls = { backend: 0, defaultBranch: 0 };
    const host = hostFixture({});
    const refs = refsFixture({ defaultBranch: 'trunk' });
    const at = {
      ...opts,
      stateHome: { home: h },
      hostAdapter: { ...host, backend: async () => { calls.backend += 1; return host.backend(); } },
      refs: { ...refs, defaultBranch: async () => { calls.defaultBranch += 1; return refs.defaultBranch(); } },
    };
    const prIndex = { read: async () => answered({ rows }) } as unknown as PrIndexStore;
    const cache: MainStatusCache = { prIndex };
    return { calls, at, cache };
  };

  it('asks the backend and the default branch once, and nothing on a later tick', async () => {
    const { calls, at, cache } = counted(home());
    const first = await readMainStatusPass(at, NOW, cache);
    expect(first).toMatchObject({ defaultBranch: null, defaultName: 'trunk', repair: undefined, checksWaitMs: WAIT });
    await readMainStatusPass(at, NOW, cache);
    expect(calls).toEqual({ backend: 1, defaultBranch: 1 });
  });

  it('names the default branch from the reading and asks git nothing', async () => {
    const h = home();
    await defaultBranchFile(h).write(green);
    const { calls, at, cache } = counted(h);
    expect(await readMainStatusPass(at, NOW, cache)).toMatchObject({ defaultName: 'main', defaultBranch: green });
    expect(calls.defaultBranch).toBe(0);
  });

  it('answers null where no row is open or the index holds none', async () => {
    const { at } = counted(home(), [row(1, HEAD1, { state: 'MERGED' })]);
    const none = { read: async () => answered(null) } as unknown as PrIndexStore;
    expect(await readMainStatusPass(at, NOW, { prIndex: none })).toBeNull();
    const merged = counted(home(), [row(1, HEAD1, { state: 'MERGED' })]);
    expect(await readMainStatusPass(merged.at, NOW, merged.cache)).toBeNull();
  });
});

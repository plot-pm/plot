import { describe, expect, it } from 'vitest';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import { hostFixture } from '@plot-pm/domain/adapters';
import {
  mainStatusTick,
  runAutoMainStatusPass,
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

  it('leaves a head unmarked after a failed write, so the next pass writes it again', async () => {
    const failing = rig(true);
    const first = await mainStatusTick(reading({ rows: [row(1, HEAD1)] }), NOW, opts, failing.world, failing.memory, failing.logged);
    expect(first.map((x) => x.outcome)).toEqual(['failed']);
    expect(failing.memory.size).toBe(0);
    expect(failing.notes).toHaveLength(1);
    await mainStatusTick(reading({ rows: [row(1, HEAD1)] }), NOW, opts, failing.world, failing.memory, failing.logged);
    expect(failing.writes).toHaveLength(2);
    expect(failing.notes).toHaveLength(1);
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

  it('runs no pass where nothing was read', async () => {
    const r = rig();
    const memory: MainStatusMemory = new Map();
    expect(await runAutoMainStatusPass(opts, memory, r.logged, NOW, r.world, async () => null)).toBeNull();
    expect(r.writes).toHaveLength(0);
  });
});

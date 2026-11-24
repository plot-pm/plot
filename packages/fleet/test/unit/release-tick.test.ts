// The release tick: a green head with no review gets one review through
// startReview; an approvable head gets one notification per changeset list.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import { runLogFixture } from '@plot-pm/domain/adapters/run-log/run-log-fixture';
import { removeTree } from '../rm-tree.mjs';
import type { Finding, MonitorName, ReleaseUnbookedReadings } from '@plot-pm/domain';
import { releaseLine, releaseTick, type ReleaseChannel, type ReleaseTickPorts } from '../../src/shared/release-tick.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = 5_000_000_000;
const BRANCH = 'changeset-release/main';
let root: string;
let starts: number;
let sent: string[];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tick-'));
  starts = 0;
  sent = [];
});
afterEach(() => {
  removeTree(root);
});

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 9,
  head: BRANCH,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  plotReview: 'success',
  plotReviewSha: HEAD,
  plotReviewJudged: 'success',
  plotReviewCheckedSha: HEAD,
  ...over,
});

const notifier: Notifier = {
  notify: async (message) => {
    sent.push(message);
    return { ok: true };
  },
};

const ports = (pr: PrIndexRow, log = runLogFixture()): ReleaseTickPorts & { log: ReturnType<typeof runLogFixture> } => ({
  scope: async () => ({ read: 'scope', sprint: { slug: 'sprint-1' } as never, slugs: ['x'], branches: [] }),
  phases: async () => new Map([['x', 'delivered']]),
  pr: async () => pr,
  runs: async () => ({ read: 'runs', runs: [{ workflow: 'CI', status: 'completed', conclusion: 'success' }] }),
  headChanges: async () => [{ path: 'package.json', status: 'modified', hunks: [{ section: '', removed: ['  "version": "1.0.0",'], added: ['  "version": "1.1.0",'] }] }],
  changesets: async () => [{ file: 'a.md', plan: '2026-10-29-x' }, { file: 'b.md', plan: '' }],
  finish: async () => 'none',
  unbooked: async () => ({ tag: 'none', sprints: [], plans: [], shipped: [] }),
  log,
  notifier,
});

/** A channel holding what was published, keyed as the running channel keys it. */
const channelFixture = (): ReleaseChannel & { held: Map<string, Finding>; seenBy: MonitorName[] } => {
  const held = new Map<string, Finding>();
  const seenBy: MonitorName[] = [];
  return {
    held,
    seenBy,
    findings: () => [...held.values()],
    publish: (f) => {
      if (f.finding === 'clear') held.delete(`${f.monitor}:${f.branch}`);
      else held.set(`${f.monitor}:${f.branch}`, f);
    },
    seen: (m) => {
      seenBy.push(m);
    },
  };
};

const owing: ReleaseUnbookedReadings = {
  tag: { tag: 'v2.36.0', date: '2026-11-23' },
  sprints: [{ slug: 'w47', state: 'Closed', start: '2026-11-11', release: '2.36.0', slugs: ['x'] }],
  plans: [{ slug: 'x', file: 'docs/plans/2026-11-01-x.md', phase: 'delivered', releasedRecord: '' }],
  shipped: [],
};

const start = () => ({
  repoRoot: root,
  script: '/s/plot-review.mjs',
  cwd: root,
  logFile: path.join(root, 'log'),
  detached: {
    node: () => {
      starts += 1;
      return { pid: 9000 + starts, exitCode: () => null };
    },
  } as Detached,
  pidAlive: () => true,
  limit: 4,
});

const config = { requiredWorkflow: 'CI', reviewBoundMs: 3_600_000, startBudget: 3 };

describe('releaseTick — release unbooked', () => {
  it('publishes release unbooked once on the channel, logs it, and retracts it once the release is booked', async () => {
    const channel = channelFixture();
    const said: string[] = [];
    let readings = owing;
    const p = { ...ports(row()), unbooked: async () => readings, channel, say: (l: string) => said.push(l) };

    const first = await releaseTick(p, config, start(), NOW);
    await releaseTick(p, config, start(), NOW + 1000);

    expect(first.unbooked).toEqual({ version: 'v2.36.0', plans: ['x'], sprintOpen: null });
    expect(channel.findings()).toMatchObject([
      { monitor: 'ReleaseMonitor', branch: 'release', finding: 'release unbooked', evidence: 'v2.36.0: 1 plan(s) unbooked (x)' },
    ]);
    expect(said).toEqual(['plot-fleetd: release publish ReleaseMonitor release: v2.36.0: 1 plan(s) unbooked (x)']);
    expect(channel.seenBy).toEqual(['ReleaseMonitor', 'ReleaseMonitor']);

    readings = { ...owing, plans: [{ ...owing.plans[0] as never, phase: 'released', releasedRecord: '2026-11-24, v2.36.0' }] };
    const booked = await releaseTick(p, config, start(), NOW + 2000);
    expect(booked.unbooked).toBe('none');
    expect(channel.findings()).toEqual([]);
    expect(said).toHaveLength(2);
  });

  it('touches the channel not at all where a read failed', async () => {
    const channel = channelFixture();
    const p = { ...ports(row()), unbooked: async () => owing, channel };
    await releaseTick(p, config, start(), NOW);
    const held = channel.findings();

    const failed = await releaseTick({ ...p, unbooked: async () => ({ ...owing, shipped: 'unaskable' as const }) }, config, start(), NOW + 1000);

    expect(failed.unbooked).toBe('unaskable');
    expect(channel.findings()).toEqual(held);
    expect(channel.seenBy).toEqual(['ReleaseMonitor']);
  });
});

describe('releaseTick', () => {
  it('starts one review through startReview and records the action, not readiness', async () => {
    const p = ports(row({ plotReview: 'absent', plotReviewSha: undefined }));
    const first = await releaseTick(p, config, start(), NOW);
    const second = await releaseTick(p, config, start(), NOW + 1000);
    expect(first.started).toEqual({ started: true, pid: 9001 });
    expect(second.step).toEqual({ step: 'none', why: 'review-in-flight' });
    expect(starts).toBe(1);
    expect(p.log.lines).toHaveLength(1);
    expect(p.log.lines[0]).toMatchObject({ step: 'release-review', head: HEAD, outcome: 'moved', branch: BRANCH });
  });

  it('starts no review on a foreign release head and shows the hold as the stage', async () => {
    const foreign = { path: '.github/workflows/ci.yml', status: 'modified', hunks: [{ section: '', removed: ['a'], added: ['b'] }] } as const;
    const p = { ...ports(row({ plotReview: 'absent', plotReviewSha: undefined })), headChanges: async () => [foreign] };
    const result = await releaseTick(p, config, start(), NOW);
    expect(result.stage).toBe('release-head-foreign');
    expect(result.step).toEqual({ step: 'hold', reason: 'release-head-foreign' });
    expect(starts).toBe(0);
    expect(p.log.lines).toHaveLength(0);
  });

  it('a review step with Auto-review off writes a release-review line with outcome skipped: auto-review-off', async () => {
    const p = ports(row({ plotReview: 'absent', plotReviewSha: undefined }));
    const result = await releaseTick(p, config, start(), NOW, false);
    expect(result.skipped).toBe('skipped: auto-review-off');
    expect(result.started).toBeUndefined();
    expect(starts).toBe(0);
    expect(p.log.lines).toHaveLength(1);
    expect(p.log.lines[0]).toMatchObject({ step: 'release-review', head: HEAD, outcome: 'skipped: auto-review-off', branch: BRANCH });
  });

  it('a skipped release review names itself skipped in the fleetd line', async () => {
    const off = await releaseTick(ports(row({ plotReview: 'absent', plotReviewSha: undefined })), config, start(), NOW, false);
    expect(releaseLine(off)).toBe('plot-fleetd: release preparing: review skipped (Auto-review off)');
    const on = await releaseTick(ports(row({ plotReview: 'absent', plotReviewSha: undefined })), config, start(), NOW, true);
    expect(releaseLine(on)).toBe('plot-fleetd: release preparing: review');
  });

  it('with Auto-review on the review start and its moved line are unchanged', async () => {
    const p = ports(row({ plotReview: 'absent', plotReviewSha: undefined }));
    const result = await releaseTick(p, config, start(), NOW, true);
    expect(result.skipped).toBeUndefined();
    expect(result.started).toEqual({ started: true, pid: 9001 });
    expect(p.log.lines.map((l) => l.outcome)).toEqual(['moved']);
  });

  it('notifies once, with both changeset groups, and not again on a bot bump', async () => {
    const log = runLogFixture();
    const first = await releaseTick(ports(row(), log), config, start(), NOW);
    expect(first.notified).toBe('sent');
    expect(sent[0]).toContain('Sprint sprint-1: a.md.');
    expect(sent[0]).toContain('Outside work: b.md.');
    const moved = row({ headSha: OLD, checksSha: OLD, plotReviewSha: OLD, plotReviewCheckedSha: OLD });
    const second = await releaseTick(ports(moved, log), config, start(), NOW + 60_000);
    expect(second.step).toEqual({ step: 'none', why: 'notified' });
    expect(sent).toHaveLength(1);
    expect(log.lines.map((l) => l.step)).toEqual(['release-notified']);
  });

  it('acts on nothing while a scope plan is not Delivered', async () => {
    const p = { ...ports(row()), phases: async () => new Map([['x', 'approved']]) };
    const out = await releaseTick(p, config, start(), NOW);
    expect(out.stage).toBe('waiting-scope');
    expect(sent).toHaveLength(0);
    expect(p.log.lines).toHaveLength(0);
  });
});

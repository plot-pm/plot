import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetStateFile, issueIndexFile } from '@plot-pm/domain/adapters';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '@plot-pm/domain';
import type { BridgedPulse } from '@plot-pm/domain/ports/fleet-state';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';

import {
  buildFleet,
  ensureCache,
  issuesClosedReading,
  refresh,
  stopFleetRefresh,
  type CacheEntry,
} from '../../src/server/fleet.js';
import { discoveryLanes } from '../../src/server/discovery-lanes.js';
import { rmTree } from '../helpers.mjs';

// Issue #1670 H2 and H3: `GET /api/issues/closed` keeps its answer for one
// issue interval, honours a live backoff, keeps a wait of its own after a
// failure, reads the gate from `issues.json` only under a fleet and only for
// its own source, and the Discovery lanes read the rows it kept.

const PULSE: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: {
    plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0,
    waiting: 0, prereq_missing: 0, host: 'unknown' as const,
  },
};

const bridged = (at: number): BridgedPulse => ({
  at,
  pulse: PULSE,
  ages: new Map(),
  branchUrlBase: 'https://example.invalid/tree/',
  approvedAt: new Map(),
  ideaPlans: new Map(),
  prError: null,
});

const temps: string[] = [];
afterEach(() => {
  stopFleetRefresh();
  vi.unstubAllEnvs();
  for (const d of temps.splice(0)) rmTree(d);
});

const DAY_MS = 86_400_000;
const closedLine = (n: number, daysAgo: number): string =>
  JSON.stringify({
    number: n, title: `closed ${n}`, url: `u${n}`, createdAt: '2026-01-01T00:00:00Z',
    status: 'closed', statusCategory: 'Done', closedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  });

/**
 * A repository whose host logs every call. `closed.out`, `closed.err` and
 * `closed.code` script the answer to `issue-list --state closed`.
 */
const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-closed-read-'));
  temps.push(dir);
  const hosts = path.join(dir, 'hosts.log');
  const write = (name: string, body: string): void => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  write('plot-fleet-scan.sh', `printf '%s\\n' ${JSON.stringify(JSON.stringify({ kind: 'reading', reading: PULSE }))}`);
  write('plot-fleetctl.sh', "echo 'summary: install=installed'\nexit 0");
  write(
    'plot-host.sh',
    [
      `echo "$*" >> ${JSON.stringify(hosts)}`,
      'case "$1" in',
      '  backend) echo github ;;',
      '  issue-list)',
      '    case "$*" in',
      '      *"--state closed"*)',
      `        [ -f ${JSON.stringify(path.join(dir, 'closed.err'))} ] && cat ${JSON.stringify(path.join(dir, 'closed.err'))} >&2`,
      `        [ -f ${JSON.stringify(path.join(dir, 'closed.out'))} ] && cat ${JSON.stringify(path.join(dir, 'closed.out'))}`,
      `        [ -f ${JSON.stringify(path.join(dir, 'closed.code'))} ] && exit "$(cat ${JSON.stringify(path.join(dir, 'closed.code'))})"`,
      '        exit 0 ;;',
      '    esac ;;',
      'esac',
      'exit 0',
    ].join('\n'),
  );
  write('plot-config.sh', 'printf \'%s\\n\' "$3"');
  write('plot-plan-meta.sh', 'exit 0');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'a-plan.md'), '# A plan\n');
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  for (const sub of ['pr-index', 'issue-index']) fs.mkdirSync(path.join(dir, sub));
  vi.stubEnv('PLOT_PR_INDEX_HOME', path.join(dir, 'pr-index'));
  vi.stubEnv('PLOT_ISSUE_INDEX_HOME', path.join(dir, 'issue-index'));
  const script = (name: string, text: string): void => fs.writeFileSync(path.join(dir, name), text);
  const closedCalls = (): number =>
    fs.existsSync(hosts)
      ? fs.readFileSync(hosts, 'utf8').split('\n').filter((l) => l.startsWith('issue-list') && l.includes('--state closed')).length
      : 0;
  return { dir, opts: { repoRoot: dir, scriptsDir: dir }, closedCalls, script };
};

/** The board's cache entry, with the pulse's first pass finished so it cannot overwrite what a test sets. */
const settledEntry = async (opts: { repoRoot: string; scriptsDir: string }): Promise<CacheEntry> => {
  const entry = ensureCache(opts);
  await vi.waitFor(() => {
    expect(entry.running).toBe(false);
    expect(entry.prRunning).toBe(false);
  });
  return entry;
};

const indexOf = (over: Partial<IssueIndex> = {}): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source: 'git-host',
  connector: 'github',
  account: 'jwloka',
  requests: 1,
  nextAt: Date.now() + 120_000,
  backoffUntil: null,
  at: new Date().toISOString(),
  answer: 'answered',
  rows: [],
  complete: true,
  ...over,
});

const RATE = 'API rate limit exceeded. Please wait 90 seconds before retrying.';

describe('GET /api/issues/closed keeps its answer for one window', () => {
  it('runs no host command for a second request inside the window', async () => {
    const { opts, closedCalls, script } = fixture();
    script('closed.out', `${closedLine(1, 40)}\n${closedLine(2, 2)}\n`);
    await settledEntry(opts);
    const before = closedCalls();
    const first = await issuesClosedReading(opts);
    expect(first.asked).toBe(true);
    expect(first.rows.map((r) => r.number)).toEqual(['2', '1']);
    expect(closedCalls()).toBe(before + 1);
    const second = await issuesClosedReading(opts);
    expect(second.asked).toBe(false);
    expect(second.rows.map((r) => r.number)).toEqual(['2', '1']);
    expect(second.absence).toBeNull();
    expect(closedCalls()).toBe(before + 1);
  });
});

describe('GET /api/issues/closed honours a backoff', () => {
  it('answers the backoff reason as absence, with no rows and no host command, on the issue gate\'s live backoffUntil', async () => {
    const { opts, closedCalls } = fixture();
    const entry = await settledEntry(opts);
    entry.issueBackoffUntil = Date.now() + 60_000;
    entry.issueSets = { answer: 'failed', at: new Date().toISOString(), failedAt: new Date().toISOString(), reason: RATE };
    const before = closedCalls();
    const reading = await issuesClosedReading(opts);
    expect(reading.asked).toBe(false);
    expect(reading.rows).toEqual([]);
    expect(reading.absence).toContain(RATE);
    expect(reading.absence).not.toBeNull();
    expect(closedCalls()).toBe(before);
  });

  it('serves the kept rows and no absence while the gate backs off', async () => {
    const { opts, script } = fixture();
    script('closed.out', `${closedLine(2, 2)}\n`);
    const entry = await settledEntry(opts);
    await issuesClosedReading(opts);
    entry.issueBackoffUntil = Date.now() + 60_000;
    const reading = await issuesClosedReading(opts);
    expect(reading.asked).toBe(false);
    expect(reading.rows.map((r) => r.number)).toEqual(['2']);
    expect(reading.absence).toBeNull();
  });

  it('keeps a backoff of its own after a rate refusal and returns the reason text', async () => {
    const { opts, closedCalls, script } = fixture();
    await settledEntry(opts);
    script('closed.err', `${RATE}\n`);
    script('closed.code', '1');
    const before = closedCalls();
    const refused = await issuesClosedReading(opts);
    expect(refused.asked).toBe(true);
    expect(refused.rows).toEqual([]);
    expect(refused.absence).toContain('rate limit');
    expect(closedCalls()).toBe(before + 1);
    // The refusal is the board's memory alone: a second request spends nothing and says why.
    const again = await issuesClosedReading(opts);
    expect(again.asked).toBe(false);
    expect(again.absence).toContain('rate limit');
    expect(closedCalls()).toBe(before + 1);
  });

  it('holds a failure that names no wait for one issue interval and returns its reason', async () => {
    const { opts, closedCalls, script } = fixture();
    await settledEntry(opts);
    script('closed.err', 'the tracker broke\n');
    script('closed.code', '1');
    const before = closedCalls();
    const failed = await issuesClosedReading(opts);
    expect(failed.absence).toContain('the tracker broke');
    const again = await issuesClosedReading(opts);
    expect(again.asked).toBe(false);
    expect(again.absence).toContain('the tracker broke');
    expect(closedCalls()).toBe(before + 1);
  });

  it('keeps the earlier rows through a failed re-ask and answers no absence', async () => {
    const { opts, script } = fixture();
    script('closed.out', `${closedLine(2, 2)}\n`);
    const entry = await settledEntry(opts);
    const first = await issuesClosedReading(opts);
    expect(first.rows).toHaveLength(1);
    // Past the window: the cached answer is old enough to ask again.
    entry.issueRequests = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000);
      script('closed.err', 'the tracker broke\n');
      script('closed.code', '1');
      const failed = await issuesClosedReading(opts);
      expect(failed.asked).toBe(true);
      expect(failed.rows.map((r) => r.number)).toEqual(['2']);
      expect(failed.absence).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /api/issues/closed reads the gate under a fleet', () => {
  const underFleet = async (dir: string, opts: { repoRoot: string; scriptsDir: string }): Promise<void> => {
    const entry = await settledEntry(opts);
    await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
    await refresh(opts, entry);
    expect(entry.supervisor).toBeDefined();
  };

  it('reads backoffUntil from issues.json and asks the host nothing', async () => {
    const { dir, opts, closedCalls } = fixture();
    await issueIndexFile({ cwd: dir }).write(
      indexOf({ backoffUntil: Date.now() + 60_000, answer: 'failed', reason: RATE }),
    );
    await underFleet(dir, opts);
    const before = closedCalls();
    const reading = await issuesClosedReading(opts);
    expect(reading.asked).toBe(false);
    expect(reading.rows).toEqual([]);
    expect(reading.absence).toContain(RATE);
    expect(closedCalls()).toBe(before);
  });

  it('reads requests from issues.json: a heavy pass lengthens the window', async () => {
    const { dir, opts, closedCalls, script } = fixture();
    script('closed.out', `${closedLine(2, 2)}\n`);
    await issueIndexFile({ cwd: dir }).write(indexOf({ requests: 4 }));
    await underFleet(dir, opts);
    const before = closedCalls();
    await issuesClosedReading(opts);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 4 requests -> a 480 s window; 300 s later the kept answer still stands.
      vi.setSystemTime(Date.now() + 300_000);
      await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
      const inside = await issuesClosedReading(opts);
      expect(inside.asked).toBe(false);
      vi.setSystemTime(Date.now() + 300_000);
      await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
      const outside = await issuesClosedReading(opts);
      expect(outside.asked).toBe(true);
      expect(closedCalls()).toBe(before + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an issues.json written for another source', async () => {
    const { dir, opts, closedCalls, script } = fixture();
    script('closed.out', `${closedLine(2, 2)}\n`);
    await issueIndexFile({ cwd: dir }).write(indexOf({ source: 'tracker', backoffUntil: Date.now() + 60_000 }));
    await underFleet(dir, opts);
    const before = closedCalls();
    const reading = await issuesClosedReading(opts);
    expect(reading.asked).toBe(true);
    expect(reading.rows).toHaveLength(1);
    expect(closedCalls()).toBe(before + 1);
  });

  it('ignores issues.json when no fleet owns the reads and reads the cache entry instead', async () => {
    const { dir, opts, closedCalls, script } = fixture();
    script('closed.out', `${closedLine(2, 2)}\n`);
    await issueIndexFile({ cwd: dir }).write(indexOf({ backoffUntil: Date.now() + 60_000 }));
    await settledEntry(opts);
    const before = closedCalls();
    const reading = await issuesClosedReading(opts);
    expect(reading.asked).toBe(true);
    expect(closedCalls()).toBe(before + 1);
  });
});

describe('the Discovery lanes read what the route kept', () => {
  const board = { stories: [], archivedStories: [] };

  it('lanes a ticket closed 40 days ago into Done only with the toggle on', async () => {
    const { opts, script } = fixture();
    script('closed.out', `${closedLine(1, 40)}\n${closedLine(2, 2)}\n`);
    const entry = await settledEntry(opts);
    await issuesClosedReading(opts);
    entry.issueSets = {
      answer: 'answered', at: new Date().toISOString(), rows: [], complete: true,
      closed: { since: new Date(0).toISOString(), answer: 'answered', rows: [
        { number: '2', title: 'closed 2', url: 'u2', closedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(), statusCategory: 'Done' },
      ] },
    };
    const recent = await discoveryLanes(opts, board, false);
    expect(recent.tickets?.done.map((r) => r.id)).toEqual(['2']);
    const on = await discoveryLanes(opts, board, true);
    expect(on.tickets?.done.map((r) => r.id).sort()).toEqual(['1', '2']);
  });

  it('draws the kept lanes when the plans cannot be read', async () => {
    const { dir, opts } = fixture();
    const entry = await settledEntry(opts);
    entry.issueSets = {
      answer: 'answered', at: new Date().toISOString(),
      rows: [{ number: '7', title: 'open 7', url: 'u7' }], complete: true,
    };
    const fresh = await discoveryLanes(opts, board, false);
    expect(fresh.plansUnreadable).toBe(false);
    expect(fresh.tickets?.open.map((r) => r.id)).toEqual(['7']);
    rmTree(path.join(dir, 'docs'));
    const kept = await discoveryLanes(opts, board, false);
    expect(kept.plansUnreadable).toBe(true);
    expect(kept.tickets).toEqual(fresh.tickets);
  });
});

describe('/api/fleet carries no closed issue', () => {
  it('leaves the closed rows out of the fleet payload', async () => {
    const { opts } = fixture();
    const entry = await settledEntry(opts);
    entry.issueSets = {
      answer: 'answered', at: new Date().toISOString(),
      rows: [{ number: '7', title: 'open seven', url: 'u7' }], complete: true,
      closed: {
        since: new Date(0).toISOString(), answer: 'answered', complete: true,
        rows: [{ number: '8', title: 'closed eight', url: 'u8', closedAt: new Date().toISOString() }],
      },
    };
    const fleet = JSON.stringify(await buildFleet(opts));
    expect(fleet).not.toContain('closed eight');
    expect(fleet).not.toContain('u8');
  });
});

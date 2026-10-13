import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetStateFile, issueIndexFile } from '@plot-pm/domain/adapters';
import { ISSUE_INDEX_VERSION, type IssueIndex } from '@plot-pm/domain';
import type { BridgedPulse } from '@plot-pm/domain/ports/fleet-state';
import type { FleetReading } from '@plot-pm/domain/entities/fleet';

import { freshCacheEntry, maybeRefreshPrs, refresh, stopFleetRefresh } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

// Under a fleet the board reads its inbox from `issues.json` and makes no
// `issue-list` call: the spike's Acceptance item 7, and review findings M3,
// M4 and M7 of PR #1647.

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

/**
 * A repository whose supervisor reads `up`, whose host logs every call, and
 * whose one plan names issue 2.
 */
const fixture = (tracker = '') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-issue-index-read-'));
  temps.push(dir);
  const hosts = path.join(dir, 'hosts.log');
  const write = (name: string, body: string): void => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(path.join(dir, name), 0o755);
  };
  write('plot-fleet-scan.sh', `printf '%s\\n' ${JSON.stringify(JSON.stringify({ kind: 'reading', reading: PULSE }))}`);
  write('plot-fleetctl.sh', "echo 'summary: install=installed'\nexit 0");
  write('plot-host.sh', `echo "$1" >> ${JSON.stringify(hosts)}\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0`);
  write('plot-config.sh', `if [ "$2" = Tracker ]; then printf '%s\\n' ${JSON.stringify(tracker)}; else printf '%s\\n' "$3"; fi`);
  write('plot-plan-meta.sh', 'for f in "$@"; do echo \'{"issues":["2"]}\'; done');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'a-plan.md'), '# A plan\n');
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  for (const sub of ['pr-index', 'issue-index']) fs.mkdirSync(path.join(dir, sub));
  vi.stubEnv('PLOT_PR_INDEX_HOME', path.join(dir, 'pr-index'));
  vi.stubEnv('PLOT_ISSUE_INDEX_HOME', path.join(dir, 'issue-index'));
  const issueListed = (): number =>
    fs.existsSync(hosts) ? fs.readFileSync(hosts, 'utf8').split('\n').filter((l) => l === 'issue-list').length : 0;
  return { dir, opts: { repoRoot: dir, scriptsDir: dir }, issueListed };
};

/** An answered index of `n` open issues numbered from 1. */
const indexOf = (n: number, over: Partial<IssueIndex> = {}): IssueIndex => ({
  v: ISSUE_INDEX_VERSION,
  source: 'git-host',
  connector: 'github',
  account: 'jwloka',
  requests: 1,
  nextAt: Date.now() + 120_000,
  backoffUntil: null,
  at: new Date().toISOString(),
  answer: 'answered',
  rows: Array.from({ length: n }, (_, i) => ({ number: String(i + 1), title: `issue ${i + 1}`, url: `u${i + 1}` })),
  complete: n < 50,
  ...over,
});

/** Runs one board refresh under a live fleet, then the PR-timer read. */
const readUnderFleet = async (dir: string, opts: { repoRoot: string; scriptsDir: string }) => {
  await fleetStateFile({ repoRoot: dir }).write(bridged(Date.now() - 2_000));
  const entry = freshCacheEntry();
  await refresh(opts, entry);
  await maybeRefreshPrs(opts, entry);
  return entry;
};

describe('the board reads its inbox from the issue index under a fleet (Acceptance 7)', () => {
  it('makes no issue-list call and shows the rows minus the planned issue, at most 50', async () => {
    const { dir, opts, issueListed } = fixture();
    await issueIndexFile({ cwd: dir }).write(indexOf(60));
    const entry = await readUnderFleet(dir, opts);
    expect(issueListed()).toBe(0);
    expect(entry.issueAnswer).toBe('answered');
    expect(entry.issues).toHaveLength(50);
    expect(entry.issues.map((issue) => issue.number)).not.toContain('2');
    expect(entry.issues[0]).toMatchObject({ kind: 'ticket', number: '1', title: 'issue 1', url: 'u1' });
  });

  it('shows the absence sentence for a missing file, never an empty inbox (M7)', async () => {
    const { dir, opts, issueListed } = fixture();
    const entry = await readUnderFleet(dir, opts);
    expect(issueListed()).toBe(0);
    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueAbsence).toBe('Open issues are not listed: the fleet has left no issue index to read.');
  });

  it('shows the kept rows of a failed index under its failure line (M4)', async () => {
    const { dir, opts } = fixture();
    await issueIndexFile({ cwd: dir }).write(indexOf(3, { answer: 'failed', reason: 'API rate limit exceeded' }));
    const entry = await readUnderFleet(dir, opts);
    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issueError).toBe('API rate limit exceeded');
    expect(entry.issues.map((issue) => issue.number)).toEqual(['1', '3']);
  });

  it('shows the reason an unsupported index carries', async () => {
    const { dir, opts } = fixture();
    await issueIndexFile({ cwd: dir }).write(
      indexOf(0, { answer: 'unsupported', reason: 'the git host `bitbucket` lists no issues' }),
    );
    const entry = await readUnderFleet(dir, opts);
    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueAbsence).toBe('Open issues are not listed: the git host `bitbucket` lists no issues');
  });

  it('refuses the rows of an index written for another source (M3)', async () => {
    const { dir, opts } = fixture('jira https://x.invalid');
    await issueIndexFile({ cwd: dir }).write(indexOf(3));
    const entry = await readUnderFleet(dir, opts);
    expect(entry.issues).toEqual([]);
    expect(entry.issueAnswer).toBe('failed');
    expect(entry.issueError).toContain('`git-host`');
  });

  it('shows the source\'s reason for a tracker no connector lists, and reads no index (M3)', async () => {
    const { dir, opts, issueListed } = fixture('linear');
    await issueIndexFile({ cwd: dir }).write(indexOf(3));
    const entry = await readUnderFleet(dir, opts);
    expect(issueListed()).toBe(0);
    expect(entry.issues).toEqual([]);
    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.issueAbsence).toContain('`linear`');
  });
});

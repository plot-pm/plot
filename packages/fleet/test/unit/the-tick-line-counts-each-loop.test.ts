import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFileSync } from 'node:fs';

import { spendForTick, type HostTally } from '../../src/server/entry/registryd-main.js';
import { tick, tickLine } from '../../src/server/entry/registryd.js';
import type { SupervisorWorld } from '../../src/shared/supervisor.js';
import { freshScanState } from '../../src/shared/fleet-scan.js';
import { freshIssueState } from '../../src/shared/issue-refresh.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// #2815: the tick line prints one requests-an-hour figure per loop, and the
// figures account for every host call the budget record holds. The fake host
// appends one `budget.tsv` line per call, and this file bumps each loop's tally
// itself, so it checks the per-hour pricing and the read-and-zero window only.
// The counting sites are tested where they live: the shell's `spend:` line
// under `--stream` in `test/reconcile/fleetlisting.test.mjs`, and `scanOnce`
// folding it in `fleet-scan.test.ts`.

const BEAT_MS = 5_000;
const BEATS_PER_HOUR = 720;
const TICK_BEATS = 12;
const PR_BEATS = 12;
const ISSUE_BEATS = 24;
const HOUR_MS = 3_600_000;

let home = '';
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-tick-line-'));
  process.env.PLOT_BUDGET_HOME = home;
});
afterEach(() => {
  delete process.env.PLOT_BUDGET_HOME;
  rmTree(home);
});

const budgetLines = (): number => fs.readFileSync(path.join(home, 'budget.tsv'), 'utf8').split('\n').filter(Boolean).length;

/** One fake host call: a record line, as `plot-host.sh` appends one. */
const hostCall = (loop: string): void => {
  appendFileSync(path.join(home, 'budget.tsv'), `${Date.now()}\tgithub\t${loop}\n`);
};

/** A world with no agents to supervise: the tick decides nothing and reports its line. */
const quietWorld: SupervisorWorld = {
  workerAlive: async () => false,
  merge: async () => 'merged',
  dirtyPath: async () => '',
  blockedMarker: async () => '',
  changesets: async () => [],
  workspacePackages: async () => [],
  planLine: async () => ({ prs: [], deferred: false, deferredReason: '' }),
  madeProgress: async () => true,
  headroom: async () => 'clear',
  deskFile: () => null,
  transcriptFound: () => true,
};

const scripts = {
  hostSaid: async () => ({ answer: 'answered' as const, stdout: JSON.stringify({ connector: 'github', perHour: 1000, basis: 'actual' }) }),
} as unknown as Parameters<typeof spendForTick>[0];

describe('the tick line counts each loop', () => {
  it('prints per-loop figures equal to the fake host\'s counts, and their sum equals the budget record', async () => {
    const own: HostTally = { calls: 0 };
    const scan = freshScanState();
    const pr = { calls: 0 };
    const issue = freshIssueState();
    const made = { tick: 0, scan: 0, 'pr-reader': 0, 'issue-reader': 0 };
    const call = (loop: keyof typeof made, bump: () => void): void => {
      hostCall(loop);
      made[loop] += 1;
      bump();
    };

    const priced = { tick: 0, scan: 0, 'pr-reader': 0, 'issue-reader': 0 };
    const lines: string[] = [];
    let readAt = 0;
    for (let beat = 1; beat <= BEATS_PER_HOUR; beat += 1) {
      call('scan', () => (scan.calls += 1));
      if (beat % PR_BEATS === 0) call('pr-reader', () => (pr.calls += 1));
      if (beat % ISSUE_BEATS === 0) call('issue-reader', () => (issue.calls += 1));
      if (beat % TICK_BEATS !== 0) continue;

      call('tick', () => (own.calls += 1));
      call('tick', () => (own.calls += 1));
      const windowMs = beat * BEAT_MS - readAt;
      const spend = await spendForTick(scripts, [
        { name: 'tick', calls: own.calls, intervalMs: TICK_BEATS * BEAT_MS },
        { name: 'scan', calls: scan.calls, intervalMs: windowMs },
        { name: 'pr-reader', calls: pr.calls, intervalMs: windowMs },
        { name: 'issue-reader', calls: issue.calls, intervalMs: windowMs },
      ]);
      lines.push(tickLine({ ...(await tick({ registry: async () => [], world: quietWorld, now: () => 0 })), spend }));
      for (const name of Object.keys(priced) as (keyof typeof priced)[]) {
        const window = name === 'tick' ? TICK_BEATS * BEAT_MS : windowMs;
        priced[name] += (spend.perLoop[name] * window) / HOUR_MS;
      }
      // Read once, zeroed after the read.
      own.calls = 0;
      scan.calls = 0;
      pr.calls = 0;
      issue.calls = 0;
      readAt = beat * BEAT_MS;
    }

    // Each loop's figures account for exactly the calls that loop made.
    expect(made).toEqual({ tick: 120, scan: 720, 'pr-reader': 60, 'issue-reader': 30 });
    for (const name of Object.keys(made) as (keyof typeof made)[]) {
      expect(Math.round(priced[name]), name).toBe(made[name]);
    }
    // Double-counting and under-counting both break this sum.
    const total = Object.values(priced).reduce((a, b) => a + b, 0);
    expect(Math.round(total)).toBe(budgetLines());
    // A steady tick prints the scan at its real 720/hr, not a tick-only figure.
    expect(lines[1]).toContain('scan=720/hr');
    expect(lines[1]).toContain('tick=120/hr');
  });
});

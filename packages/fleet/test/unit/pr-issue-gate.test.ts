import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Host } from '@plot-pm/domain/ports/host';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { HostAnswer, Scripts } from '@plot-pm/domain/ports/scripts';

import {
  freshPrState,
  prRefreshMsFor,
  refreshPrs,
  type IssueGateReading,
  type PrState,
} from '../../src/shared/pr-refresh.js';
import { PR_REFRESH_MS } from '../../src/shared/fleet-scan.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The PR pass reads the issue gate (D28): the spike's Acceptance items 3 and 4,
// and review finding H1 of PR #1647.

const ACCOUNT = 'jwloka';

/** What the stub host was asked, in order. */
let asked: string[] = [];

/** A `Scripts` whose `spend-rate` reports 90 an hour on `jwloka` and whose `pr-list` answers one row. */
const scripts = {
  hostSaid: async (args: readonly string[]): Promise<HostAnswer> => {
    asked.push(args.join(' '));
    if (args[0] === 'spend-rate') {
      return {
        answer: 'answered',
        stdout: JSON.stringify({ perHour: 90, resetAt: null, limit: null, basis: 'unknown', account: ACCOUNT }),
      };
    }
    if (args[0] === 'pr-list') {
      return {
        answer: 'answered',
        stdout: `${JSON.stringify({
          number: 1, title: 't', state: 'OPEN', head: 'feature/one', draft: false, checks: 'green',
          mergeable: 'mergeable', review: '', url: 'u', updatedAt: '2026-10-13T00:00:00Z', failing_checks: [],
        })}\n`,
      };
    }
    return { answer: 'answered', stdout: '' };
  },
} as unknown as Scripts;

const host = { backend: async () => ({ ok: true, value: 'github' }) } as unknown as Host;

/** A PR store that holds nothing and accepts every write. */
const store: PrIndexStore = {
  location: async () => ({ ok: true, value: '/nonexistent/github.json' }),
  read: async () => ({ ok: true, value: null }),
  write: async () => ({ ok: true, value: undefined }),
};

let home = '';
beforeEach(() => {
  asked = [];
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-issue-gate-'));
  process.env.PLOT_BUDGET_HOME = home;
});
afterEach(() => {
  delete process.env.PLOT_BUDGET_HOME;
  rmTree(home);
});

const NOW = Date.now();

/** A fresh GitHub gate reading on `jwloka` that spent one request. */
const gate = (over: Partial<IssueGateReading> = {}): IssueGateReading => ({
  connector: 'github',
  account: ACCOUNT,
  requests: 1,
  nextAt: NOW + 120_000,
  backoffUntil: null,
  ...over,
});

const refresh = async (reading: IssueGateReading | null, entry: PrState = freshPrState()): Promise<PrState> => {
  entry.backend = 'github';
  await refreshPrs({ scripts, host, store, issueGate: async () => reading }, entry);
  return entry;
};

/** The interval `scheduleNextPr` stamps for a given rate, from a fresh entry. */
const intervalFor = (perHour: number): number => prRefreshMsFor('github', { perHour }, PR_REFRESH_MS);

describe('the PR pass subtracts the issue gate\'s spend (Acceptance 3)', () => {
  it('the two rates give different intervals, so the assertions below can tell them apart', () => {
    expect(intervalFor(60)).not.toBe(intervalFor(90));
  });

  it('hands 60 to scheduleNextPr for a fresh github reading on its own account, and keeps the banner at 90', async () => {
    const entry = await refresh(gate());
    expect(entry.prIntervalMs).toBe(intervalFor(60));
    expect(entry.prSpendPerHour).toBe(90);
    expect(entry.prAccount).toBe(ACCOUNT);
  });

  it.each([
    ['a jira reading', gate({ connector: 'jira', account: 'jira:0123456789ab' })],
    ['a reading on another account', gate({ account: 'someone-else' })],
    ['a reading whose nextAt lies more than one interval in the past', gate({ nextAt: NOW - 240_001 })],
    ['no reading', null],
  ])('hands 90 for %s', async (_name, reading) => {
    const entry = await refresh(reading);
    expect(entry.prIntervalMs).toBe(intervalFor(90));
    expect(entry.prSpendPerHour).toBe(90);
  });
});

describe('the PR pass holds on the issue gate\'s backoff (Acceptance 4)', () => {
  it('asks the host nothing and holds prNextAt at a github backoff 300 s ahead', async () => {
    const until = Date.now() + 300_000;
    const entry = await refresh(gate({ backoffUntil: until }));
    expect(asked.filter((call) => call.startsWith('pr-list'))).toEqual([]);
    expect(entry.prNextAt).toBe(until);
    expect(entry.prNextIsBackoff).toBe(true);
    expect(entry.prs).toBeNull();
  });

  it('does not move a prNextAt already 600 s ahead', async () => {
    const entry = freshPrState();
    const later = Date.now() + 600_000;
    entry.prNextAt = later;
    await refresh(gate({ backoffUntil: Date.now() + 300_000 }), entry);
    expect(asked.filter((call) => call.startsWith('pr-list'))).toEqual([]);
    expect(entry.prNextAt).toBe(later);
    expect(entry.prNextIsBackoff).toBe(true);
  });

  it('runs the pass for a jira reading with a live backoff', async () => {
    const entry = await refresh(gate({ connector: 'jira', account: 'jira:0123456789ab', backoffUntil: Date.now() + 300_000 }));
    expect(asked.filter((call) => call.startsWith('pr-list'))).toHaveLength(1);
    expect(entry.prs?.get('feature/one')?.number).toBe(1);
    expect(entry.prNextIsBackoff).toBe(false);
  });

  it('runs the pass once the backoff has passed', async () => {
    await refresh(gate({ backoffUntil: Date.now() - 1 }));
    expect(asked.filter((call) => call.startsWith('pr-list'))).toHaveLength(1);
  });
});

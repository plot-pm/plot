import { describe, expect, it } from 'vitest';

import type { WorkflowShaRun } from '../src/entities/build.js';
import {
  DEFAULT_BRANCH_VERSION,
  decodeDefaultBranch,
  encodeDefaultBranch,
  type DefaultBranchReading,
} from '../src/entities/default-branch.js';
import {
  advanceSettled,
  defaultBranchRed,
  defaultBranchStatus,
  failingRunsOf,
  foldRuns,
} from '../src/rules/default-branch.js';

const run = (
  conclusion: string | null,
  over: Partial<WorkflowShaRun> = {},
): WorkflowShaRun => ({
  sha: 'a'.repeat(40),
  workflow: 'CI',
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  url: 'https://example.test/run/1',
  startedAt: '2026-10-10T00:00:00Z',
  ...over,
});

describe('foldRuns — one GitHub conclusion at a time', () => {
  it.each([
    ['success', 'green'],
    ['neutral', 'green'],
    ['skipped', 'green'],
    ['failure', 'red'],
    ['timed_out', 'red'],
    ['startup_failure', 'red'],
    ['cancelled', 'unknown'],
    ['stale', 'unknown'],
  ] as const)('a lone %s run reads %s', (conclusion, state) => {
    expect(foldRuns([run(conclusion)])).toBe(state);
  });

  it.each(['queued', 'in_progress'] as const)('a run with status %s and no conclusion reads pending', (status) => {
    expect(foldRuns([run(null, { status })])).toBe('pending');
  });

  it('reads action_required as pending', () => {
    expect(foldRuns([run('action_required')])).toBe('pending');
  });
});

describe('foldRuns — the whole commit', () => {
  it('reads red when the failure is the second of three workflows', () => {
    expect(foldRuns([run('success', { workflow: 'lint' }), run('failure', { workflow: 'test' }), run('success', { workflow: 'build' })])).toBe('red');
  });

  it('reads red when the failure is the third of three workflows', () => {
    expect(foldRuns([run('success'), run('success'), run('failure')])).toBe('red');
  });

  it('reads red when a failure sits beside a run still going', () => {
    expect(foldRuns([run(null), run('failure')])).toBe('red');
  });

  it('reads red when a failure sits beside action_required', () => {
    expect(foldRuns([run('action_required'), run('failure')])).toBe('red');
  });

  it('reads pending when one run is still going and nothing failed', () => {
    expect(foldRuns([run('success'), run(null)])).toBe('pending');
  });

  it('reads green only when every run passed', () => {
    expect(foldRuns([run('success'), run('skipped'), run('neutral')])).toBe('green');
  });

  it('reads unknown for no runs, which is CI that has not started', () => {
    expect(foldRuns([])).toBe('unknown');
  });

  it('reads unknown for a cancelled run with nothing failed', () => {
    expect(foldRuns([run('success'), run('cancelled')])).toBe('unknown');
  });

  it('reads unknown for a word it does not know', () => {
    expect(foldRuns([run('something_new')])).toBe('unknown');
  });
});

describe('foldRuns — Jenkins words after the adapter maps them', () => {
  it.each([
    ['success', 'green'],
    ['failure', 'red'],
    ['cancelled', 'unknown'],
    ['unknown', 'unknown'],
  ] as const)('%s reads %s', (conclusion, state) => {
    expect(foldRuns([run(conclusion, { workflow: '' })])).toBe(state);
  });
});

describe('failingRunsOf', () => {
  it('names each run that concluded as a failure', () => {
    expect(
      failingRunsOf([run('success'), run('failure', { workflow: 'test', url: 'u' }), run('timed_out', { workflow: 'e2e', url: 'v' })]),
    ).toEqual([
      { workflow: 'test', conclusion: 'failure', url: 'u' },
      { workflow: 'e2e', conclusion: 'timed_out', url: 'v' },
    ]);
  });
});

const reading = (over: Partial<DefaultBranchReading> = {}): DefaultBranchReading => ({
  v: DEFAULT_BRANCH_VERSION,
  branch: 'main',
  headSha: 'b'.repeat(40),
  head: 'green',
  settled: { sha: 'b'.repeat(40), state: 'green' },
  failingRuns: [],
  headSince: '2026-10-10T00:00:00.000Z',
  askedAt: '2026-10-10T00:00:00.000Z',
  at: '2026-10-10T00:00:00.000Z',
  ...over,
});

describe('advanceSettled — the settled part moves only when a commit settles', () => {
  const red = { sha: 'r', state: 'red' } as const;

  it('keeps the red commit while a newer head is still pending', () => {
    const once = advanceSettled(red, 'n', 'pending');
    const twice = advanceSettled(once, 'n', 'pending');
    expect(twice).toEqual(red);
  });

  it('keeps the settled commit when the head reads unknown', () => {
    expect(advanceSettled(red, 'n', 'unknown')).toEqual(red);
  });

  it('moves to the newer commit once it settles green', () => {
    expect(advanceSettled(red, 'n', 'green')).toEqual({ sha: 'n', state: 'green' });
  });

  it('moves to a newer red commit', () => {
    expect(advanceSettled(undefined, 'n', 'red')).toEqual({ sha: 'n', state: 'red' });
  });

  it('stays absent while nothing has settled', () => {
    expect(advanceSettled(undefined, 'n', 'pending')).toBeUndefined();
  });
});

describe('defaultBranchRed — reads the settled part only', () => {
  it('holds when the settled commit is red, however the head reads', () => {
    for (const head of ['pending', 'green', 'unknown', 'red'] as const) {
      expect(defaultBranchRed(reading({ head, settled: { sha: 'r', state: 'red' } }))).toBe(true);
    }
  });

  it('releases when a newer commit settles green', () => {
    const before = reading({ head: 'pending', settled: { sha: 'r', state: 'red' } });
    const settled = advanceSettled(before.settled, 'n', 'green');
    expect(defaultBranchRed({ ...before, headSha: 'n', head: 'green', settled })).toBe(false);
  });

  it('does not hold on a red head that has not settled into the settled part', () => {
    expect(defaultBranchRed(reading({ head: 'red', settled: { sha: 's', state: 'green' } }))).toBe(false);
  });

  it('holds nothing without a settled commit', () => {
    expect(defaultBranchRed(reading({ settled: undefined }))).toBe(false);
  });

  it('holds nothing where there is no reading', () => {
    expect(defaultBranchRed(null)).toBe(false);
  });

  it('holds nothing on an unknown settled state', () => {
    expect(defaultBranchRed(reading({ settled: { sha: 's', state: 'unknown' } }))).toBe(false);
  });
});

describe('defaultBranchStatus — only while defaultBranchRed holds', () => {
  it('returns null on every reading defaultBranchRed releases', () => {
    expect(defaultBranchStatus(null)).toBeNull();
    expect(defaultBranchStatus(reading({ settled: undefined }))).toBeNull();
    expect(defaultBranchStatus(reading({ settled: { sha: 's', state: 'green' } }))).toBeNull();
    expect(defaultBranchStatus(reading({ settled: { sha: 's', state: 'unknown' } }))).toBeNull();
  });

  it('holds on a red settled commit even while the head is pending', () => {
    // ONE FIXTURE, BOTH ARMS DISAGREEING: a reading whose `head` is `pending`
    // and whose `settled` is `red` — the exact case `defaultBranchRed` says
    // must still hold, so a mutation reading `head` instead of `settled`
    // fails this assertion rather than passing it by coincidence.
    const r = reading({ head: 'pending', settled: { sha: 'abc1234567', state: 'red' } });
    const status = defaultBranchStatus(r, r.askedAt);
    expect(status).not.toBeNull();
    expect(status?.key).toBe('default-branch-red');
    expect(status?.tone).toBe('amber');
  });

  it('names the branch and the short settled sha in the text', () => {
    const r = reading({ branch: 'main', settled: { sha: 'abc1234567890', state: 'red' } });
    const status = defaultBranchStatus(r, r.askedAt);
    expect(status?.text).toContain('main');
    expect(status?.text).toContain('abc1234');
    expect(status?.text).not.toContain('abc1234567890');
  });

  it('reports the reading as stale by its age rather than hiding it', () => {
    const r = reading({ settled: { sha: 's', state: 'red' }, askedAt: '2026-10-10T14:02:00.000Z' });
    const status = defaultBranchStatus(r, '2026-10-10T14:05:00.000Z');
    expect(status?.text).toContain('3 min ago');
  });

  it('reads under a minute ago rather than 0 min ago', () => {
    const r = reading({ settled: { sha: 's', state: 'red' }, askedAt: '2026-10-10T14:02:00.000Z' });
    const status = defaultBranchStatus(r, '2026-10-10T14:02:30.000Z');
    expect(status?.text).toContain('under a minute ago');
  });
});

describe('decodeDefaultBranch', () => {
  it('round-trips a reading', () => {
    const r = reading({ settled: { sha: 'r', state: 'red' }, failingRuns: [{ workflow: 'CI', conclusion: 'failure', url: 'u' }] });
    expect(decodeDefaultBranch(encodeDefaultBranch(r))).toEqual(r);
  });

  it('reads a file with another version as no reading', () => {
    const other = JSON.stringify({ ...reading(), v: DEFAULT_BRANCH_VERSION + 1 });
    expect(decodeDefaultBranch(other)).toBeNull();
  });

  it.each(['', '   ', '{not json', '[]', '{"v":1}'])('reads %j as no reading', (text) => {
    expect(decodeDefaultBranch(text)).toBeNull();
  });
});

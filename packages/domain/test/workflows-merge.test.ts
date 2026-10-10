import { describe, it, expect } from 'vitest';
import { merge, type MergeReadings } from '../src/workflows/index.js';
import type { Pr } from '../src/entities/pr.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** An open, ready PR whose green checks name its head — every refusal passes. */
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 42,
  repo: '',
  head: 'feature/x',
  state: 'OPEN',
  mergedAt: null,
  mergeCommit: '',
  draft: false,
  mergeable: 'mergeable',
  review: '',
  checks: 'green',
  failingChecks: [],
  url: '',
  author: '',
  headSha: HEAD,
  checksSha: HEAD,
  ...over,
});

const reading = (state: 'red' | 'green' | 'pending'): DefaultBranchReading => ({
  v: 1,
  branch: 'main',
  headSha: OTHER,
  head: state,
  headSince: '2026-10-10T00:00:00Z',
  settled: { sha: OTHER, state },
  failingRuns: [],
  askedAt: '2026-10-10T00:00:00Z',
  at: '2026-10-10T00:00:00Z',
});

const readings = (over: Partial<MergeReadings> = {}): MergeReadings => ({
  pr: pr(),
  defaultBranch: reading('green'),
  ...over,
});

const refusalOf = (r: MergeReadings, sha = HEAD) => {
  const out = merge(r, { pr: 42, sha });
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('merge — the controller for a PR merge', () => {
  it('decides one merge pinned to the caller’s sha', () => {
    const out = merge(readings(), { pr: 42, sha: HEAD });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.writes).toEqual([{ kind: 'pr-merge', pr: 42, deleteBranch: false, sha: HEAD }]);
    expect(out.detail).toEqual({ pr: 42, sha: HEAD, defaultBranchRead: true });
  });

  it('pins to the caller’s sha, never to a head it did not read', () => {
    // The host head differs: the pin is what makes a late push fail at the host.
    expect(refusalOf(readings({ pr: pr({ headSha: OTHER, checksSha: OTHER }) }))).toBe('head-moved');
  });

  it('refuses unaskable when the host did not answer', () => {
    expect(refusalOf(readings({ pr: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses unaskable when the host names no head', () => {
    expect(refusalOf(readings({ pr: pr({ headSha: undefined }) }))).toBe('unaskable');
    expect(refusalOf(readings({ pr: pr({ headSha: '' }) }))).toBe('unaskable');
  });

  it('refuses pr-not-open for an unknown, merged or closed PR', () => {
    expect(refusalOf(readings({ pr: null }))).toBe('pr-not-open');
    expect(refusalOf(readings({ pr: pr({ state: 'MERGED' }) }))).toBe('pr-not-open');
    expect(refusalOf(readings({ pr: pr({ state: 'CLOSED' }) }))).toBe('pr-not-open');
  });

  it('refuses a draft', () => {
    expect(refusalOf(readings({ pr: pr({ draft: true }) }))).toBe('draft');
  });

  it.each(['pending', 'failing', 'none', 'unknown'] as const)('refuses checks %s', (checks) => {
    expect(refusalOf(readings({ pr: pr({ checks }) }))).toBe('checks-not-green');
  });

  it('refuses green checks that name no commit or another commit', () => {
    expect(refusalOf(readings({ pr: pr({ checksSha: undefined }) }))).toBe('checks-unbound');
    expect(refusalOf(readings({ pr: pr({ checksSha: OTHER }) }))).toBe('checks-unbound');
  });

  it('refuses while the default branch is red', () => {
    expect(refusalOf(readings({ defaultBranch: reading('red') }))).toBe('default-branch-red');
  });

  it('names the branch and its settled sha when the default branch is red', () => {
    const out = merge(readings({ defaultBranch: reading('red') }), { pr: 42, sha: HEAD });
    expect(out.outcome).toBe('refused');
    expect(JSON.stringify(out)).toContain(`main is red on ${OTHER.slice(0, 12)}`);
  });

  it('merges when the default-branch reading has no settled commit', () => {
    const { settled: _settled, ...unsettled } = reading('red');
    const out = merge(readings({ defaultBranch: unsettled }), { pr: 42, sha: HEAD });
    expect(out.outcome).not.toBe('refused');
  });

  it('reports a missing default-branch reading instead of treating it as permission', () => {
    const out = merge(readings({ defaultBranch: null }), { pr: 42, sha: HEAD });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.detail.defaultBranchRead).toBe(false);
  });

  it('names the sha it saw in a refusal', () => {
    const out = merge(readings({ pr: pr({ headSha: OTHER }) }), { pr: 42, sha: HEAD });
    expect(out.outcome === 'refused' && out.detail).toContain(OTHER.slice(0, 12));
  });
});

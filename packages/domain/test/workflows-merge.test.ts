import { describe, it, expect } from 'vitest';
import { merge, type MergeReadings } from '../src/workflows/index.js';
import type { Pr } from '../src/entities/pr.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const WAIT_MS = 3_600_000;
/** Thirty minutes after the fixture reading's `askedAt`, inside `Checks wait`. */
const CLOCK = { now: Date.parse('2026-10-10T00:30:00Z'), checksWaitMs: WAIT_MS, backend: 'bitbucket' };

/** An open, ready PR whose green checks name its head — every refusal passes. */
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 42,
  repo: '',
  head: 'feature/x',
  base: 'main',
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

const refusalOf = (r: MergeReadings, sha = HEAD, backend = CLOCK.backend) => {
  const out = merge(r, { pr: 42, sha, ...CLOCK, backend });
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('merge — the controller for a PR merge', () => {
  it('decides one merge pinned to the head the caller read', () => {
    const out = merge(readings(), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.writes).toEqual([{ kind: 'pr-merge', pr: 42, deleteBranch: false, sha: HEAD }]);
    expect(out.detail).toEqual({ pr: 42, sha: HEAD, defaultBranchRead: true });
  });

  it('refuses a host head that is not the caller’s commit', () => {
    // The host head differs: the pin is what makes a late push fail at the host.
    expect(refusalOf(readings({ pr: pr({ headSha: OTHER, checksSha: OTHER }) }))).toBe('head-moved');
  });

  it('merges a sha typed in a different case than the host’s lowercase head', () => {
    // Same commit, different case: not a moved head, so this must not refuse.
    const out = merge(readings(), { pr: 42, sha: HEAD.toUpperCase(), ...CLOCK });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.writes).toEqual([{ kind: 'pr-merge', pr: 42, deleteBranch: false, sha: HEAD }]);
  });

  it('pins a short caller sha to the host’s full head on Bitbucket, never to the short form', () => {
    // Bitbucket legitimately reports and accepts a head shorter than 40
    // characters, so a 12-character caller sha still matches there, and the
    // write still pins to the host's full-length head, never to the short form.
    const out = merge(readings(), { pr: 42, sha: HEAD.slice(0, 12), ...CLOCK });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.writes).toEqual([{ kind: 'pr-merge', pr: 42, deleteBranch: false, sha: HEAD }]);
  });

  it('refuses a short caller sha on GitHub, whose head is always full-length', () => {
    // GitHub's `headRefOid` is always 40 characters, so a 12-character caller
    // sha is never a legitimate read there — the floor rises to 40 and this
    // refuses head-moved instead of pinning to a cheap, collision-prone prefix.
    expect(refusalOf({ ...readings() }, HEAD.slice(0, 12), 'github')).toBe('head-moved');
  });

  it('merges a full 40-character caller sha on GitHub', () => {
    const out = merge(readings(), { pr: 42, sha: HEAD, ...CLOCK, backend: 'github' });
    expect(out.outcome).not.toBe('refused');
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
    const out = merge(readings({ defaultBranch: reading('red') }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).toBe('refused');
    expect(JSON.stringify(out)).toContain(`main is red on ${OTHER.slice(0, 12)}`);
  });

  it('refuses a red reading older than Checks wait as stale', () => {
    const late = { now: Date.parse('2026-10-10T01:00:01Z'), checksWaitMs: WAIT_MS, backend: 'bitbucket' };
    const out = merge(readings({ defaultBranch: reading('red') }), { pr: 42, sha: HEAD, ...late });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
  });

  it('refuses a green reading older than Checks wait, and names its age', () => {
    const days = { now: Date.parse('2026-10-13T00:00:00Z'), checksWaitMs: WAIT_MS, backend: 'bitbucket' };
    const out = merge(readings({ defaultBranch: reading('green') }), { pr: 42, sha: HEAD, ...days });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
    expect(out.outcome === 'refused' && out.detail).toContain('the reading of main is 259200 s old; Checks wait is 3600 s.');
  });

  it('merges on a green reading exactly at the Checks wait bound', () => {
    const edge = { now: Date.parse('2026-10-10T01:00:00Z'), checksWaitMs: WAIT_MS, backend: 'bitbucket' };
    const out = merge(readings({ defaultBranch: reading('green') }), { pr: 42, sha: HEAD, ...edge });
    expect(out.outcome).not.toBe('refused');
  });

  it('refuses a reading whose askedAt does not parse, and quotes it', () => {
    const out = merge(readings({ defaultBranch: { ...reading('green'), askedAt: 'soon' } }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
    expect(out.outcome === 'refused' && out.detail).toContain("has an askedAt that does not parse ('soon')");
  });

  it('refuses on a red reading exactly at the Checks wait bound', () => {
    const edge = { now: Date.parse('2026-10-10T01:00:00Z'), checksWaitMs: WAIT_MS, backend: 'bitbucket' };
    const out = merge(readings({ defaultBranch: reading('red') }), { pr: 42, sha: HEAD, ...edge });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-red');
  });

  it('refuses unaskable when the default-branch read failed', () => {
    expect(refusalOf(readings({ defaultBranch: 'unaskable' }))).toBe('unaskable');
  });

  it('merges when the default-branch reading has no settled commit', () => {
    const { settled: _settled, ...unsettled } = reading('red');
    const out = merge(readings({ defaultBranch: unsettled }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
  });

  it('reports a missing default-branch reading instead of treating it as permission', () => {
    const out = merge(readings({ defaultBranch: null }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.detail.defaultBranchRead).toBe(false);
  });

  it('names the sha it saw in a refusal', () => {
    const out = merge(readings({ pr: pr({ headSha: OTHER }) }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome === 'refused' && out.detail).toContain(OTHER.slice(0, 12));
  });
});

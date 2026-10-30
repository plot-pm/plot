import { describe, it, expect } from 'vitest';
import { merge, mergeAt, type MergeReadings, type MergePorts } from '../src/workflows/index.js';
import type { Pr } from '../src/entities/pr.js';
import type { DefaultBranchReading } from '../src/entities/default-branch.js';
import type { PrReviewReading } from '../src/ports/host.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const WAIT_MS = 3_600_000;
/** Thirty minutes after the fixture reading's `askedAt`, inside `Checks wait`. */
const CLOCK = { now: Date.parse('2026-10-10T00:30:00Z'), checksWaitMs: WAIT_MS, minHexLen: 7 };

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

/** A `plot/review` reading that passes on the fixture PR's head. */
const review = (over: Partial<PrReviewReading> = {}): PrReviewReading => ({
  sha: HEAD,
  state: 'success',
  bypass: false,
  ...over,
});

const readings = (over: Partial<MergeReadings> = {}): MergeReadings => ({
  pr: pr(),
  defaultBranch: reading('green'),
  defaultBranchTip: OTHER,
  review: review(),
  caller: 'person',
  ...over,
});

const refusalOf = (r: MergeReadings, sha = HEAD, minHexLen = CLOCK.minHexLen) => {
  const out = merge(r, { pr: 42, sha, ...CLOCK, minHexLen });
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

  it('pins a short caller sha to the host’s full head at the 7+ floor, never to the short form', () => {
    // A caller-chosen floor of 7 admits a short caller sha, and the write
    // still pins to the host's full-length head, never to the short form.
    const out = merge(readings(), { pr: 42, sha: HEAD.slice(0, 12), ...CLOCK });
    expect(out.outcome).not.toBe('refused');
    if (out.outcome === 'refused') return;
    expect(out.writes).toEqual([{ kind: 'pr-merge', pr: 42, deleteBranch: false, sha: HEAD }]);
  });

  it('refuses a short caller sha at a raised floor', () => {
    // A caller that raises the floor to 40 (because its host's head is always
    // full-length) refuses a 12-character caller sha as head-moved instead of
    // pinning to a cheap, collision-prone prefix.
    expect(refusalOf({ ...readings() }, HEAD.slice(0, 12), 40)).toBe('head-moved');
  });

  it('merges a full 40-character caller sha at a raised floor', () => {
    const out = merge(readings(), { pr: 42, sha: HEAD, ...CLOCK, minHexLen: 40 });
    expect(out.outcome).not.toBe('refused');
  });

  it('refuses a release PR and names release-approve', () => {
    const r = readings({ pr: pr({ head: 'changeset-release/main' }) });
    const out = merge(r, { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome === 'refused' ? out.reason : out.outcome).toBe('release-pr');
    expect(out.outcome === 'refused' ? out.detail : '').toContain('release-approve');
  });

  it('does not treat a feature branch that merely contains the release segment as a release PR', () => {
    expect(refusalOf(readings({ pr: pr({ head: 'feature/changeset-release-notes' }) }))).toBe('decided');
  });

  it('merges a release PR when release-approve hands it over', () => {
    const r = readings({ pr: pr({ head: 'changeset-release/main' }) });
    const out = merge(r, { pr: 42, sha: HEAD, ...CLOCK, viaReleaseApprove: true });
    expect(out.outcome).toBe('decided');
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
    const late = { now: Date.parse('2026-10-10T01:00:01Z'), checksWaitMs: WAIT_MS, minHexLen: 7 };
    const out = merge(readings({ defaultBranch: reading('red') }), { pr: 42, sha: HEAD, ...late });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
  });

  it('refuses a green reading older than Checks wait, and names its age', () => {
    const days = { now: Date.parse('2026-10-13T00:00:00Z'), checksWaitMs: WAIT_MS, minHexLen: 7 };
    const out = merge(readings({ defaultBranch: reading('green') }), { pr: 42, sha: HEAD, ...days });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
    expect(out.outcome === 'refused' && out.detail).toContain('the reading of main is 259200 s old; Checks wait is 3600 s.');
  });

  it('merges on a green reading exactly at the Checks wait bound', () => {
    const edge = { now: Date.parse('2026-10-10T01:00:00Z'), checksWaitMs: WAIT_MS, minHexLen: 7 };
    const out = merge(readings({ defaultBranch: reading('green') }), { pr: 42, sha: HEAD, ...edge });
    expect(out.outcome).not.toBe('refused');
  });

  it('refuses a reading whose askedAt does not parse, and quotes it', () => {
    const out = merge(readings({ defaultBranch: { ...reading('green'), askedAt: 'soon' } }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-stale');
    expect(out.outcome === 'refused' && out.detail).toContain("has an askedAt that does not parse ('soon')");
  });

  it('refuses on a red reading exactly at the Checks wait bound', () => {
    const edge = { now: Date.parse('2026-10-10T01:00:00Z'), checksWaitMs: WAIT_MS, minHexLen: 7 };
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

  it('refuses an unattended caller before any other reading is asked', () => {
    // 'unaskable' would otherwise win here — the refusal must come first.
    expect(refusalOf(readings({ caller: 'unattended', pr: 'unaskable' }))).toBe('unattended');
  });

  it('accepts a fleetd caller and proceeds past the refusal unattended would hit', () => {
    const out = merge(readings({ caller: 'fleetd' }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
  });

  it('decides for a person, same as an unset caller', () => {
    const out = merge(readings({ caller: 'person' }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
  });

  it('refuses default-branch-unsettled on a pending head past a green settled commit', () => {
    // The head is pending while a DIFFERENT, older commit is the last one that
    // settled green — a naive check reading only `settled.state` would pass.
    const settledOld = { ...reading('green'), headSha: 'c'.repeat(40), head: 'pending' as const };
    expect(refusalOf(readings({ defaultBranch: settledOld, defaultBranchTip: 'c'.repeat(40) }))).toBe('default-branch-unsettled');
  });

  it('refuses default-branch-unsettled when the tip moved past the reading', () => {
    // The reading still names the pre-merge head; a naive check comparing the
    // reading with itself would pass.
    expect(refusalOf(readings({ defaultBranchTip: 'c'.repeat(40) }))).toBe('default-branch-unsettled');
  });

  it('refuses unaskable when the default-branch tip read fails, never a pass and never default-branch-unsettled', () => {
    expect(refusalOf(readings({ defaultBranchTip: 'unaskable' }))).toBe('unaskable');
  });

  it('refuses default-branch-unread when requireReading is set and no reading exists', () => {
    const out = merge(readings({ defaultBranch: null }), { pr: 42, sha: HEAD, ...CLOCK, requireReading: true });
    expect(out.outcome === 'refused' && out.reason).toBe('default-branch-unread');
  });

  it('merges on a missing reading when requireReading is not set', () => {
    const out = merge(readings({ defaultBranch: null }), { pr: 42, sha: HEAD, ...CLOCK });
    expect(out.outcome).not.toBe('refused');
  });

  it.each(['absent', 'failure', 'pending'])('refuses review-not-passed for review state %s', (state) => {
    expect(refusalOf(readings({ review: review({ state }) }))).toBe('review-not-passed');
  });

  it('refuses review-not-passed when plot/review success names a different sha than the pinned head', () => {
    expect(refusalOf(readings({ review: review({ sha: OTHER }) }))).toBe('review-not-passed');
  });

  it('refuses review-not-passed when the review read fails', () => {
    expect(refusalOf(readings({ review: 'unaskable' }))).toBe('review-not-passed');
  });

  it('refuses review-not-passed on a green checks rollup with plot/review absent, never reading the rollup instead', () => {
    // Checks are green (the fixture default); only the review state is absent.
    expect(refusalOf(readings({ review: review({ state: 'absent' }) }))).toBe('review-not-passed');
  });
});

describe('mergeAt — the workflow wired to its ports', () => {
  const HEAD2 = 'a'.repeat(40);
  const NOW = Date.parse('2026-10-11T12:00:00Z');
  const WAIT_MS2 = 3_600_000;

  const settled = (state: 'red' | 'green', askedAt: string): DefaultBranchReading => ({
    v: 1, branch: 'main', headSha: 'c'.repeat(40), head: state,
    settled: { sha: 'c'.repeat(40), state }, failingRuns: [],
    headSince: askedAt, askedAt, at: askedAt,
  });
  const red = (askedAt: string): DefaultBranchReading => settled('red', askedAt);

  type Read = { ok: true; value: DefaultBranchReading | null } | { ok: false; why: 'failed' };

  const prFixture = (over: Partial<Pr> = {}): Pr => ({
    number: 7, repo: '', head: 'feature/x', base: 'main', state: 'OPEN', mergedAt: null, mergeCommit: '',
    draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
    url: '', author: '', headSha: HEAD2, checksSha: HEAD2, ...over,
  });

  /** Ports that answer as given and record every script call. */
  const ports = (lookup: Pr | 'unaskable', answer: 'answered' | 'failed' = 'answered', read: Read = { ok: true, value: null }, backend = 'github') => {
    const calls: string[][] = [];
    const p = {
      host: {
        backend: async () => ({ ok: true, value: backend }),
        prState: async () => (lookup === 'unaskable'
          ? { ok: false, why: 'unaskable' as const }
          : { ok: true, value: lookup }),
        prReview: async () => ({ ok: true, value: { sha: lookup === 'unaskable' ? '' : (lookup?.headSha ?? ''), state: 'success', bypass: false } }),
      },
      scripts: {
        hostSaid: async (args: string[]) => {
          calls.push(args);
          return { answer, said: answer === 'answered' ? '' : 'GraphQL: head moved' };
        },
      },
      defaultBranch: { read: async () => read },
      refs: {
        remoteSha: async () => ({ ok: true, value: read.ok && read.value !== null ? { sha: read.value.headSha } : 'unknown' }),
      },
      checksWaitMs: WAIT_MS2,
      now: () => NOW,
      caller: 'person',
    } as unknown as MergePorts;
    return { p, calls };
  };

  it('passes the head the caller read to the host as --match-head', async () => {
    const { p, calls } = ports(prFixture());
    const out = await mergeAt(p, 7, HEAD2);
    expect(out).toMatchObject({ merged: true, pr: 7, sha: HEAD2, defaultBranchRead: false, unpinned: false });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2]]);
  });

  it('refuses an unattended caller, asking the host nothing', async () => {
    const { p, calls } = ports(prFixture());
    p.caller = 'unattended';
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'unattended' });
    expect(calls).toEqual([]);
  });

  it('accepts a fleetd caller and proceeds past the refusal unattended would hit', async () => {
    const { p } = ports(prFixture());
    p.caller = 'fleetd';
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, pr: 7, sha: HEAD2 });
  });

  it('asks the host for checks, which Bitbucket reads only when asked', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: null }, 'bitbucket');
    const asked: unknown[] = [];
    (p.host as { prState: unknown }).prState = async (_ref: number, opts?: { withChecks?: boolean }) => {
      asked.push(opts);
      return { ok: true, value: prFixture({ checks: opts?.withChecks === true ? 'green' : 'unknown' }) };
    };
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, pr: 7, sha: HEAD2 });
    expect(asked).toEqual([{ withChecks: true }]);
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2]]);
  });

  it('pins on bitbucket too, via a head re-read', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: null }, 'bitbucket');
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, pr: 7, sha: HEAD2, unpinned: false });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2]]);
  });

  it('keeps the pin where the backend does not answer', async () => {
    const { p, calls } = ports(prFixture());
    p.host.backend = async () => ({ ok: false, why: 'failed' });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2]]);
  });

  it('calls no script when the domain refuses', async () => {
    const { p, calls } = ports(prFixture({ headSha: 'b'.repeat(40) }));
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'head-moved' });
    expect(calls).toEqual([]);
  });

  it('merges on a Bitbucket-short 12-character head matching the caller’s full sha', async () => {
    const { p, calls } = ports(prFixture({ headSha: HEAD2.slice(0, 12), checksSha: HEAD2.slice(0, 12) }), 'answered', { ok: true, value: null }, 'bitbucket');
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, pr: 7, sha: HEAD2 });
    // The pin is the host's own form of the head, so the host's re-read compares like with like.
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2.slice(0, 12)]]);
  });

  it('pins a 12-character caller sha to the host’s 40-character head on Bitbucket', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: null }, 'bitbucket');
    expect(await mergeAt(p, 7, HEAD2.slice(0, 12))).toMatchObject({ merged: true, pr: 7 });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD2]]);
  });

  it('refuses a 12-character caller sha on GitHub, whose head is always full-length', async () => {
    const { p, calls } = ports(prFixture());
    expect(await mergeAt(p, 7, HEAD2.slice(0, 12))).toMatchObject({ merged: false, reason: 'head-moved' });
    expect(calls).toEqual([]);
  });

  it('refuses unaskable when the host lookup fails', async () => {
    const { p, calls } = ports('unaskable');
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('reports host-refused with the host’s words and never retries without the pin', async () => {
    const { p, calls } = ports(prFixture(), 'failed');
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({
      merged: false, reason: 'host-refused', detail: 'GraphQL: head moved',
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses unaskable when the default-branch read fails, and merges nothing', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: false, why: 'failed' });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('merges when no default-branch reading exists', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: null });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, defaultBranchRead: false });
    expect(calls).toHaveLength(1);
  });

  it('refuses on a red reading within Checks wait', async () => {
    const fresh = new Date(NOW - WAIT_MS2 + 60_000).toISOString();
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: red(fresh) });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'default-branch-red' });
    expect(calls).toEqual([]);
  });

  it('refuses a red reading older than Checks wait as stale, and merges nothing', async () => {
    const old = new Date(NOW - WAIT_MS2 - 60_000).toISOString();
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: red(old) });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'default-branch-stale' });
    expect(calls).toEqual([]);
  });

  it('refuses a days-old green reading as stale, and merges nothing', async () => {
    const old = new Date(NOW - 3 * 24 * WAIT_MS2).toISOString();
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: settled('green', old) });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'default-branch-stale' });
    expect(calls).toEqual([]);
  });

  it('merges on a green reading within Checks wait', async () => {
    const fresh = new Date(NOW - WAIT_MS2 + 60_000).toISOString();
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: settled('green', fresh) });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: true, defaultBranchRead: true });
    expect(calls).toHaveLength(1);
  });

  it('refuses unaskable when the remote tip read fails on a settled reading', async () => {
    const fresh = new Date(NOW - WAIT_MS2 + 60_000).toISOString();
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: settled('green', fresh) });
    (p.refs as { remoteSha: unknown }).remoteSha = async () => ({ ok: false, why: 'failed' });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('holds a merge with requireReading when no reading exists', async () => {
    const { p, calls } = ports(prFixture(), 'answered', { ok: true, value: null });
    p.requireReading = true;
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'default-branch-unread' });
    expect(calls).toEqual([]);
  });

  it('refuses review-not-passed when the host cannot answer whether the review passed', async () => {
    const { p, calls } = ports(prFixture());
    (p.host as { prReview: unknown }).prReview = async () => ({ ok: false, why: 'failed' });
    expect(await mergeAt(p, 7, HEAD2)).toMatchObject({ merged: false, reason: 'review-not-passed' });
    expect(calls).toEqual([]);
  });
});

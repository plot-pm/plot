import { describe, it, expect } from 'vitest';
import { releaseApprove, releaseApproveAt, type ReleaseApproveReadings } from '../src/workflows/release-approve.js';
import type { MergePorts } from '../src/workflows/merge.js';
import type { Pr } from '../src/entities/pr.js';
import type { PrReviewReading } from '../src/ports/host.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CLOCK = { minHexLen: 7 };

/** An open release PR, reviewed and green on its head — every refusal passes. */
const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 42,
  repo: '',
  head: 'changeset-release/main',
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

const review = (over: Partial<PrReviewReading> = {}): PrReviewReading => ({
  sha: HEAD,
  state: 'success',
  bypass: false,
  ...over,
});

const readings = (over: Partial<ReleaseApproveReadings> = {}): ReleaseApproveReadings => ({
  caller: 'person',
  pr: pr(),
  review: review(),
  ...over,
});

const refusalOf = (r: ReleaseApproveReadings, sha = HEAD, minHexLen = CLOCK.minHexLen) => {
  const out = releaseApprove(r, { pr: 42, sha, minHexLen });
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('releaseApprove — the controller for a release PR approval', () => {
  it('refuses an unattended caller before any other reading is asked', () => {
    expect(refusalOf(readings({ caller: 'unattended', pr: 'unaskable' }))).toBe('unattended');
  });

  it('refuses a PR whose branch is not a release branch', () => {
    expect(refusalOf(readings({ pr: pr({ head: 'feature/x' }) }))).toBe('not-release-pr');
  });

  it('does not match a feature branch that merely contains the release segment', () => {
    // catches an `includes` check standing in for the anchored prefix.
    expect(refusalOf(readings({ pr: pr({ head: 'feature/changeset-release-notes' }) }))).toBe('not-release-pr');
  });

  it('refuses a host head that has moved past the sha the caller approved', () => {
    expect(refusalOf(readings({ pr: pr({ headSha: OTHER }) }))).toBe('head-moved');
  });

  it('refuses an absent review', () => {
    expect(refusalOf(readings({ review: 'unaskable' }))).toBe('review-missing');
  });

  it('refuses a failing review on the current head', () => {
    expect(refusalOf(readings({ review: review({ state: 'failure' }) }))).toBe('review-missing');
  });

  it('refuses a success recorded on an older sha when the head has since moved', () => {
    // catches reading the status without checking its sha.
    expect(refusalOf(readings({ review: review({ sha: OTHER, state: 'success' }) }))).toBe('review-missing');
  });

  it('decides one approval pinned to the head the caller reviewed', () => {
    const out = releaseApprove(readings(), { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome).not.toBe('refused');
  });

  it('reports an open PR as still to merge', () => {
    const out = releaseApprove(readings(), { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome === 'decided' ? out.detail.alreadyMerged : null).toBe(false);
  });

  it('resumes the finish for a merged release PR without reading its review', () => {
    // a release PR merged in the host's UI has no review reading worth asking for.
    const r = readings({ pr: pr({ state: 'MERGED' }), review: 'unaskable' });
    const out = releaseApprove(r, { pr: 42, sha: HEAD, minHexLen: CLOCK.minHexLen });
    expect(out.outcome === 'decided' ? out.detail.alreadyMerged : null).toBe(true);
    expect(out.outcome === 'decided' ? out.writes : null).toEqual([]);
  });

  it('still refuses a merged PR that is not a release PR', () => {
    expect(refusalOf(readings({ pr: pr({ state: 'MERGED', head: 'feature/x' }) }))).toBe('not-release-pr');
  });
});

describe('releaseApproveAt — the workflow wired to its ports', () => {
  const NOW = Date.parse('2026-10-11T12:00:00Z');

  /** Ports that answer as given and record every host read and script call. */
  const ports = (lookup: Pr, reviewed: PrReviewReading = review()) => {
    const reads: string[] = [];
    const calls: string[][] = [];
    const p = {
      host: {
        backend: async () => ({ ok: true, value: 'github' }),
        prState: async () => { reads.push('prState'); return { ok: true, value: lookup }; },
        prReview: async () => { reads.push('prReview'); return { ok: true, value: reviewed }; },
      },
      scripts: { hostSaid: async (args: string[]) => { calls.push(args); return { answer: 'answered', said: '' }; } },
      defaultBranch: { read: async () => ({ ok: true, value: null }) },
      refs: { remoteSha: async () => ({ ok: true, value: 'unknown' }) },
      checksWaitMs: 3_600_000,
      now: () => NOW,
      caller: 'person',
    } as unknown as MergePorts;
    return { p, reads, calls };
  };

  it('merges a reviewed release PR pinned to the head the person read', async () => {
    const { p, calls } = ports(pr());
    expect(await releaseApproveAt(p, 42, HEAD)).toEqual({ approved: true, pr: 42, sha: HEAD, alreadyMerged: false });
    expect(calls).toEqual([['pr-merge', '42', '--match-head', HEAD]]);
  });

  it('refuses an unattended caller before any host read', async () => {
    const { p, reads, calls } = ports(pr());
    p.caller = 'unattended';
    expect(await releaseApproveAt(p, 42, HEAD)).toMatchObject({ approved: false, reason: 'unattended' });
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a head that moved after the person read it, with no host write', async () => {
    const { p, calls } = ports(pr({ headSha: OTHER }), review({ sha: OTHER }));
    expect(await releaseApproveAt(p, 42, HEAD)).toMatchObject({ approved: false, reason: 'head-moved' });
    expect(calls).toEqual([]);
  });

  it('refuses a review recorded on an older sha, with no host write', async () => {
    const { p, calls } = ports(pr({ headSha: OTHER }), review({ sha: HEAD }));
    expect(await releaseApproveAt(p, 42, OTHER)).toMatchObject({ approved: false, reason: 'review-missing' });
    expect(calls).toEqual([]);
  });

  it('refuses a PR that is not a release PR, with no host write', async () => {
    const { p, calls } = ports(pr({ head: 'feature/x' }));
    expect(await releaseApproveAt(p, 42, HEAD)).toMatchObject({ approved: false, reason: 'not-release-pr' });
    expect(calls).toEqual([]);
  });

  it('skips the merge for a release PR the host already holds merged', async () => {
    const { p, calls } = ports(pr({ state: 'MERGED' }));
    expect(await releaseApproveAt(p, 42, HEAD)).toEqual({ approved: true, pr: 42, sha: HEAD, alreadyMerged: true });
    expect(calls).toEqual([]);
  });

  it('carries the merge refusal through when merge holds the PR', async () => {
    const { p, calls } = ports(pr({ checks: 'failing', checksSha: HEAD }));
    expect(await releaseApproveAt(p, 42, HEAD)).toMatchObject({ approved: false, reason: 'checks-not-green' });
    expect(calls).toEqual([]);
  });
});

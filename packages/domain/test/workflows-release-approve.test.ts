import { describe, it, expect } from 'vitest';
import { releaseApprove, type ReleaseApproveReadings } from '../src/workflows/release-approve.js';
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
});

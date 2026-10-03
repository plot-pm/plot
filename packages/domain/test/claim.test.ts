import { describe, expect, it } from 'vitest';

import { answered, failed } from '../src/port-result.js';
import type { CommitReading } from '../src/rules/empty-claim.js';
import {
  claimTip,
  orphanedClaims,
  ORPHANED_CLAIM_AGE_MS,
  type ClaimReading,
} from '../src/rules/claim.js';

/** An empty claim marker: titled `plot: claim `, tree unchanged. */
const CLAIM: CommitReading = { subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' };
/** A commit that changes a file. */
const WORK: CommitReading = { subject: 'implement the thing', tree: 't2', parentTree: 't1' };

describe('claimTip — one answer per reading, never a subject comparison itself', () => {
  it('answers `absent` where no remote-tracking ref exists', () => {
    expect(claimTip('absent', answered([]))).toBe('absent');
  });

  it('answers `unknown` where the ref itself could not be read', () => {
    expect(claimTip('unknown', answered([CLAIM]))).toBe('unknown');
  });

  it('answers `unknown` on a failed commits read, never `claim-only`', () => {
    // READ THE CALL'S RESULT, NOT THE EMPTINESS OF ITS OUTPUT. A failed call
    // and an answered empty list both have nothing to show, and only the
    // first must read as `unknown` — a `claim-only` answer here would name a
    // ref with real work on it as safe to release.
    expect(claimTip('present', failed())).toBe('unknown');
  });

  it('answers `claim-only` for a present ref with no commit ahead of the default branch', () => {
    expect(claimTip('present', answered([]))).toBe('claim-only');
  });

  it('answers `claim-only` where every commit ahead is an empty claim marker', () => {
    expect(claimTip('present', answered([CLAIM]))).toBe('claim-only');
  });

  it('answers `work` where at least one commit ahead is not a claim marker', () => {
    expect(claimTip('present', answered([WORK, CLAIM]))).toBe('work');
  });

  it('answers `work` for a claim-titled commit that changes a file', () => {
    // THE SUBJECT ALONE IS NOT EVIDENCE. A commit titled `plot: claim …` that
    // changes a file is real work, and `claimTip` must call `realCommits`
    // rather than re-testing the prefix.
    const claimTitledWork: CommitReading = {
      subject: 'plot: claim handling refactor',
      tree: 't2',
      parentTree: 't1',
    };
    expect(claimTip('present', answered([claimTitledWork]))).toBe('work');
  });

  it('answers `work` where the parent tree is `null` — a missing reading is not evidence of emptiness', () => {
    const missingParent: CommitReading = {
      subject: 'plot: claim feature/x',
      tree: 't1',
      parentTree: null,
    };
    expect(claimTip('present', answered([missingParent]))).toBe('work');
  });
});

describe('orphanedClaims — claim-only, unassigned and stale, and never releases anything', () => {
  const reading = (over: Partial<ClaimReading> = {}): ClaimReading => ({
    branch: 'feature/x',
    claim: 'claim-only',
    newestClaimAt: 0,
    assignedTo: '',
    ...over,
  });

  it('names a claim-only, unassigned branch older than one tick interval', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(orphanedClaims([reading({ newestClaimAt: 0 })], tickStartedAt)).toEqual(['feature/x']);
  });

  it('does not name a branch a live agent is assigned to', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(
      orphanedClaims([reading({ newestClaimAt: 0, assignedTo: 'agent-a' })], tickStartedAt),
    ).toEqual([]);
  });

  it('does not name a branch carrying real work', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(orphanedClaims([reading({ claim: 'work', newestClaimAt: 0 })], tickStartedAt)).toEqual(
      [],
    );
  });

  it('does not name a branch whose claim answer is `unknown`', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(
      orphanedClaims([reading({ claim: 'unknown', newestClaimAt: 0 })], tickStartedAt),
    ).toEqual([]);
  });

  it('does not name an absent branch — there is no ref to release', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(
      orphanedClaims([reading({ claim: 'absent', newestClaimAt: 0 })], tickStartedAt),
    ).toEqual([]);
  });

  it('does not name a branch younger than one tick interval', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS - 1;
    expect(orphanedClaims([reading({ newestClaimAt: 0 })], tickStartedAt)).toEqual([]);
  });

  it('does not name a branch exactly one tick interval old — the bound is exclusive', () => {
    // THE SAME CONVENTION `handOverCheck` USES: `ageMs > BOUND`, so exactly at
    // the bound still reads as too fresh to call orphaned.
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS;
    expect(orphanedClaims([reading({ newestClaimAt: 0 })], tickStartedAt)).toEqual([]);
  });

  it('names a branch one millisecond past the bound', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    expect(orphanedClaims([reading({ newestClaimAt: 0 })], tickStartedAt)).toEqual(['feature/x']);
  });

  it('never releases — it only names, in the order given', () => {
    const tickStartedAt = ORPHANED_CLAIM_AGE_MS + 1;
    const named = orphanedClaims(
      [reading({ branch: 'feature/a' }), reading({ branch: 'feature/b' })],
      tickStartedAt,
    );
    expect(named).toEqual(['feature/a', 'feature/b']);
  });

  it('names nothing over an empty list', () => {
    expect(orphanedClaims([], 0)).toEqual([]);
  });
});

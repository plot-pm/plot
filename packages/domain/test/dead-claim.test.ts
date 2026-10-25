import { describe, expect, it } from 'vitest';

import { answered } from '../src/port-result.js';
import type { CommitReading } from '../src/rules/empty-claim.js';
import { deadClaim, deadClaims } from '../src/rules/dead-claim.js';
import { ORPHANED_CLAIM_AGE_MS, type ClaimAnswerReadings } from '../src/rules/claim.js';

/** An empty claim marker: titled `plot: claim `, tree unchanged — the #2162/#2154 Started-record shape. */
const STARTED_RECORD: CommitReading = {
  subject: 'plot: claim feature/x',
  tree: 't1',
  parentTree: 't1',
};
/** A commit that changes a file — real work. */
const WORK: CommitReading = { subject: 'implement the thing', tree: 't2', parentTree: 't1' };

/** The claim commit's time; every reading below is taken relative to it. */
const CLAIMED_AT = 1_000_000;
/** A reading taken one millisecond past the bound. */
const PAST_BOUND = CLAIMED_AT + ORPHANED_CLAIM_AGE_MS + 1;

const stale: ClaimAnswerReadings = {
  ref: 'present',
  commits: answered([STARTED_RECORD]),
  holders: [],
};

describe('deadClaim — a stale claim older than the launch window', () => {
  it('does not name a claim pushed this instant — its agent may still be starting', () => {
    expect(deadClaim(stale, CLAIMED_AT, CLAIMED_AT)).toBe(false);
  });

  it('does not name a claim exactly at the bound', () => {
    expect(deadClaim(stale, CLAIMED_AT, CLAIMED_AT + ORPHANED_CLAIM_AGE_MS)).toBe(false);
  });

  it('names a Started-record-only branch with no live agent once it is older than the bound', () => {
    expect(deadClaim(stale, CLAIMED_AT, PAST_BOUND)).toBe(true);
  });

  it('does not name the same ref once a live holder exists', () => {
    expect(deadClaim({ ...stale, holders: ['agent-a'] }, CLAIMED_AT, PAST_BOUND)).toBe(false);
  });

  it('does not name a ref with real work beyond the default branch, even with no live agent', () => {
    // An in-progress branch between sessions, with real commits and nobody
    // holding it right now, is not a dead claim.
    expect(deadClaim({ ...stale, commits: answered([WORK]) }, CLAIMED_AT, PAST_BOUND)).toBe(false);
  });

  it('does not name an absent ref — there is no claim to release', () => {
    expect(deadClaim({ ref: 'absent', commits: answered([]), holders: [] }, 0, PAST_BOUND)).toBe(false);
  });

  it('does not name an unreadable ref — silence is not evidence of emptiness', () => {
    expect(deadClaim({ ref: 'unknown', commits: answered([]), holders: [] }, 0, PAST_BOUND)).toBe(false);
  });
});

describe('deadClaims — the branches among a claimed set that are dead', () => {
  it('names only the dead branches older than the bound, in the order given', () => {
    const named = deadClaims(
      [
        { branch: 'bug/a', readings: stale, newestClaimAt: CLAIMED_AT },
        { branch: 'bug/b', readings: { ...stale, commits: answered([WORK]) }, newestClaimAt: CLAIMED_AT },
        { branch: 'bug/c', readings: { ...stale, holders: ['agent-a'] }, newestClaimAt: CLAIMED_AT },
        { branch: 'bug/d', readings: stale, newestClaimAt: CLAIMED_AT },
        { branch: 'bug/just-launched', readings: stale, newestClaimAt: PAST_BOUND },
      ],
      PAST_BOUND,
    );
    expect(named).toEqual(['bug/a', 'bug/d']);
  });

  it('names nothing over an empty list', () => {
    expect(deadClaims([], PAST_BOUND)).toEqual([]);
  });
});

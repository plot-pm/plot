import { describe, expect, it } from 'vitest';

import { answered } from '../src/port-result.js';
import type { CommitReading } from '../src/rules/empty-claim.js';
import { deadClaim, deadClaims } from '../src/rules/dead-claim.js';
import type { ClaimAnswerReadings } from '../src/rules/claim.js';

/** An empty claim marker: titled `plot: claim `, tree unchanged — the #2162/#2154 Started-record shape. */
const STARTED_RECORD: CommitReading = {
  subject: 'plot: claim feature/x',
  tree: 't1',
  parentTree: 't1',
};
/** A commit that changes a file — real work. */
const WORK: CommitReading = { subject: 'implement the thing', tree: 't2', parentTree: 't1' };

describe('deadClaim — the sweep question claimAnswer has no shape for', () => {
  it('names a branch with only a Started-record commit and no live agent releasable', () => {
    const readings: ClaimAnswerReadings = {
      ref: 'present',
      commits: answered([STARTED_RECORD]),
      holders: [],
    };
    expect(deadClaim(readings)).toBe(true);
  });

  it('does not name the same ref releasable once a live running/waiting holder exists', () => {
    const readings: ClaimAnswerReadings = {
      ref: 'present',
      commits: answered([STARTED_RECORD]),
      holders: ['agent-a'],
    };
    expect(deadClaim(readings)).toBe(false);
  });

  it('does not name a ref with real work beyond the default branch releasable, even with no live agent', () => {
    // THE CASE A NAIVE "NO AGENT" CHECK WOULD WRONGLY RELEASE: an in-progress
    // branch between sessions, with real commits and nobody holding it right
    // now, is not a dead claim.
    const readings: ClaimAnswerReadings = {
      ref: 'present',
      commits: answered([WORK]),
      holders: [],
    };
    expect(deadClaim(readings)).toBe(false);
  });

  it('does not name an absent ref releasable — there is no claim to release', () => {
    const readings: ClaimAnswerReadings = { ref: 'absent', commits: answered([]), holders: [] };
    expect(deadClaim(readings)).toBe(false);
  });

  it('does not name an unreadable ref releasable — silence is not evidence of emptiness', () => {
    const readings: ClaimAnswerReadings = { ref: 'unknown', commits: answered([]), holders: [] };
    expect(deadClaim(readings)).toBe(false);
  });
});

describe('deadClaims — the branches among a claimed set that are dead', () => {
  it('names only the dead branches, in the order given', () => {
    const named = deadClaims([
      { branch: 'bug/a', readings: { ref: 'present', commits: answered([STARTED_RECORD]), holders: [] } },
      { branch: 'bug/b', readings: { ref: 'present', commits: answered([WORK]), holders: [] } },
      {
        branch: 'bug/c',
        readings: { ref: 'present', commits: answered([STARTED_RECORD]), holders: ['agent-a'] },
      },
      { branch: 'bug/d', readings: { ref: 'present', commits: answered([STARTED_RECORD]), holders: [] } },
    ]);
    expect(named).toEqual(['bug/a', 'bug/d']);
  });

  it('names nothing over an empty list', () => {
    expect(deadClaims([])).toEqual([]);
  });
});

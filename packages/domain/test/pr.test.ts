import { describe, it, expect } from 'vitest';
import {
  PrStateSchema,
  MergeabilitySchema,
  ChecksSchema,
  prHasLanded,
  branchHasLanded,
  prIsOpen,
  checksAreEmptyBecauseConflicting,
  type Pr,
} from '../src/index.js';

/**
 * A branch's bid to land, and afterwards the evidence that it did.
 *
 * Its identity is a natural key, and the kind's failure — *the source lying* —
 * is this entity's defining problem: `state: CLOSED` on a merged PR.
 */

const pr: Pr = {
  number: 421, repo: '', head: 'feature/x', state: 'OPEN', mergedAt: null, mergeCommit: '',
  draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [], url: '',
};

const merged: Pr = { ...pr, state: 'CLOSED', mergedAt: '2026-08-27T10:00:00Z', mergeCommit: 'abc123' };

describe('the PR vocabularies are closed sets', () => {
  it('names the three states', () => {
    expect(PrStateSchema.options).toEqual(['OPEN', 'MERGED', 'CLOSED']);
  });

  it('keeps `unknown` mergeability apart from `mergeable`', () => {
    // Bitbucket cannot answer it at all, and every payload written before the
    // field existed reports the same. Consumers must not read it as clean.
    expect(MergeabilitySchema.options).toEqual(['mergeable', 'conflicting', 'unknown']);
  });

  it('keeps `none` checks apart from `unknown`', () => {
    // No run exists is not nobody could ask.
    expect(ChecksSchema.options).toEqual(['green', 'pending', 'failing', 'none', 'unknown']);
  });
});

describe('landing is read from mergedAt, never from state', () => {
  it('reads a merged PR that reports CLOSED as landed', () => {
    // THE MEASURED DEFECT. The host's REST surface reports `CLOSED` for a
    // merged PR while GraphQL reports `MERGED`; a gate on the state word
    // reads landed work as abandoned.
    expect(merged.state).toBe('CLOSED');
    expect(prHasLanded(merged)).toBe(true);
  });

  it('reads an open PR as not landed', () => {
    expect(prHasLanded(pr)).toBe(false);
  });

  it('leaves the merge commit empty for anything unmerged', () => {
    // The honest answer rather than a guess.
    expect(pr.mergeCommit).toBe('');
  });
});

describe('a branch may carry several PRs', () => {
  it('lands when any one of them merged', () => {
    // 372 branches have one, 9 have two, ONE has ten. Reading only the newest
    // reported three branches unlanded whose work was already on main, each
    // masked by a duplicate the fleet opened itself.
    expect(branchHasLanded([{ ...pr, number: 1 }, merged, { ...pr, number: 3 }])).toBe(true);
  });

  it('does not land when none merged', () => {
    expect(branchHasLanded([pr, { ...pr, number: 2, state: 'CLOSED' }])).toBe(false);
  });

  it('does not land on no PRs at all', () => {
    // Silence is never permission.
    expect(branchHasLanded([])).toBe(false);
  });
});

describe('open means still asking to land', () => {
  it('counts an open PR and not a merged one', () => {
    expect(prIsOpen(pr)).toBe(true);
    expect(prIsOpen(merged)).toBe(false);
  });

  it('does not count a PR the host closed without merging', () => {
    expect(prIsOpen({ ...pr, state: 'CLOSED' })).toBe(false);
  });
});

describe('mergeable disambiguates an empty check rollup', () => {
  it('explains `checks: none` on a conflicting PR', () => {
    // The host starts no workflow for a PR that does not merge cleanly, so a
    // conflicting PR reports an empty rollup — indistinguishable from a bot PR
    // whose run waits for a human, unless `mergeable` is asked separately.
    expect(checksAreEmptyBecauseConflicting({ ...pr, checks: 'none', mergeable: 'conflicting' })).toBe(true);
  });

  it('does not explain an empty rollup on a mergeable PR', () => {
    expect(checksAreEmptyBecauseConflicting({ ...pr, checks: 'none', mergeable: 'mergeable' })).toBe(false);
  });

  it('does not explain a rollup that is not empty', () => {
    expect(checksAreEmptyBecauseConflicting({ ...pr, checks: 'failing', mergeable: 'conflicting' })).toBe(false);
  });
});

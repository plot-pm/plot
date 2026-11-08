import { describe, it, expect } from 'vitest';
import { linkAfter, linkAfterEnd, type SnapshotLink } from '../src/rules/snapshot-link.js';
import { emptySnapshot } from '../src/entities/snapshot.js';

describe('linkAfter', () => {
  const held = { epoch: 'e1', snapshot: { ...emptySnapshot(), generation: 4 } };

  it('reads current after adopt and after apply', () => {
    const expected = { state: 'current', epoch: 'e1', generation: 4 };
    expect(linkAfter({ outcome: 'adopt', held })).toEqual(expected);
    expect(linkAfter({ outcome: 'apply', held })).toEqual(expected);
  });

  it('reads resyncing after resync, with the reason', () => {
    expect(linkAfter({ outcome: 'resync', reason: 'a gap' })).toEqual({ state: 'resyncing', reason: 'a gap' });
  });

  it('reads mismatch after mismatch, with both versions', () => {
    expect(linkAfter({ outcome: 'mismatch', reason: 'r', ours: 1, theirs: 2 })).toEqual({
      state: 'mismatch',
      reason: 'r',
      ours: 1,
      theirs: 2,
    });
  });
});

describe('linkAfterEnd', () => {
  const mismatch: SnapshotLink = { state: 'mismatch', reason: 'r', ours: 1, theirs: undefined };
  const resyncing: SnapshotLink = { state: 'resyncing', reason: 'x' };

  it('keeps a mismatch, since a reconnect does not cure a refused purpose', () => {
    expect(linkAfterEnd(mismatch)).toBe(mismatch);
  });

  it('turns current into resyncing', () => {
    expect(linkAfterEnd({ state: 'current', epoch: 'e', generation: 1 })).toMatchObject({ state: 'resyncing' });
  });

  it('keeps resyncing', () => {
    expect(linkAfterEnd(resyncing)).toBe(resyncing);
  });

  it('turns absent into absent', () => {
    expect(linkAfterEnd({ state: 'absent' })).toEqual({ state: 'absent' });
  });
});

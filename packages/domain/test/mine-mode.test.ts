import { describe, it, expect } from 'vitest';
import {
  mineCounts,
  mineHiddenCount,
  mineMode,
  mineStrictControl,
  parsePersonDirectory,
  type MineModeStorage,
  type Reader,
} from '../src/index.js';

const reader: Reader = { hostUser: 'jwloka' };
const storage = (mineOnly?: string, strict?: string): MineModeStorage => ({ mineOnly, strict });

describe('mineMode computes the effective «Mine» mode', () => {
  it('is all where the mineOnly key is absent', () => {
    expect(mineMode(reader, storage())).toBe('all');
  });

  it('is all where the mineOnly key is off', () => {
    expect(mineMode(reader, storage('0'))).toBe('all');
  });

  it('is mine-and-unknown where mineOnly is on and strict is absent', () => {
    expect(mineMode(reader, storage('1'))).toBe('mine-and-unknown');
  });

  it('is mine-and-unknown where mineOnly is on and strict is off', () => {
    expect(mineMode(reader, storage('1', '0'))).toBe('mine-and-unknown');
  });

  it('is mine where both keys are on', () => {
    expect(mineMode(reader, storage('1', '1'))).toBe('mine');
  });

  it('ignores strict while mineOnly is off, never reading mine with Mine off', () => {
    expect(mineMode(reader, storage(undefined, '1'))).toBe('all');
    expect(mineMode(reader, storage('0', '1'))).toBe('all');
  });

  it('reads an unparseable or other-valued key as off, never as an error', () => {
    expect(mineMode(reader, storage('yes'))).toBe('all');
    expect(mineMode(reader, storage('1', 'yes'))).toBe('mine-and-unknown');
  });

  it('is all where comparableLogin is empty, whatever either key holds — a reader with only a git email', () => {
    const emailOnly: Reader = { gitEmail: 'jan.wloka@quatico.com' };
    expect(mineMode(emailOnly, storage('1', '1'))).toBe('all');
  });

  it('is all for an email-shaped hostUser, whatever either key holds', () => {
    const emailLogin: Reader = { hostUser: 'jan.wloka@quatico.com' };
    expect(mineMode(emailLogin, storage('1', '1'))).toBe('all');
  });

  it('is all for a reader with no identity at all', () => {
    expect(mineMode({}, storage('1', '1'))).toBe('all');
  });
});

describe('mineCounts counts rows by ownership, one per branch', () => {
  const known: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') };

  it('counts somebody else\'s rows as theirs and ownerless rows as unknown', () => {
    const counts = mineCounts([
      { kind: 'pr', author: 'jwloka' },
      { kind: 'pr', author: 'eins78' },
      { kind: 'pr', author: undefined },
      { kind: 'other' },
    ], known);
    expect(counts).toEqual({ theirs: 1, unknown: 2 });
  });

  it('counts a branch once where its row and its agent both hide', () => {
    const counts = mineCounts([
      { kind: 'other', branch: 'feature/x' },
      { kind: 'agent', state: 'elsewhere', branch: 'feature/x' },
    ], known);
    expect(counts).toEqual({ theirs: 0, unknown: 1 });
  });

  it('counts a branch as theirs, not unknown, where any of its entries is theirs', () => {
    const counts = mineCounts([
      { kind: 'pr', author: 'eins78', branch: 'feature/y' },
      { kind: 'agent', state: 'elsewhere', branch: 'feature/y' },
    ], known);
    expect(counts).toEqual({ theirs: 1, unknown: 0 });
  });

  it('counts entries with no branch one by one', () => {
    const counts = mineCounts([{ kind: 'other', branch: '' }, { kind: 'other', branch: null }, { kind: 'other' }], known);
    expect(counts).toEqual({ theirs: 0, unknown: 3 });
  });
});

describe('mineHiddenCount', () => {
  it('is theirs in mine-and-unknown and in all', () => {
    expect(mineHiddenCount({ theirs: 2, unknown: 5 }, 'mine-and-unknown')).toBe(2);
    expect(mineHiddenCount({ theirs: 2, unknown: 5 }, 'all')).toBe(2);
  });

  it('is theirs plus unknown in mine', () => {
    expect(mineHiddenCount({ theirs: 2, unknown: 5 }, 'mine')).toBe(7);
  });
});

describe('mineStrictControl shows only in a «Mine» mode with unknown rows', () => {
  it('is null in all mode, whatever the unknown count', () => {
    expect(mineStrictControl('all', 23)).toBeNull();
  });

  it('is null with no unknown row, in either «Mine» mode', () => {
    expect(mineStrictControl('mine-and-unknown', 0)).toBeNull();
    expect(mineStrictControl('mine', 0)).toBeNull();
  });

  it('offers to hide the unknown rows in mine-and-unknown', () => {
    expect(mineStrictControl('mine-and-unknown', 23)).toEqual({ label: 'hide 23 unknown', pressed: false, unknownCount: 23 });
  });

  it('offers to show the unknown rows in mine', () => {
    expect(mineStrictControl('mine', 23)).toEqual({ label: 'show 23 unknown', pressed: true, unknownCount: 23 });
  });
});

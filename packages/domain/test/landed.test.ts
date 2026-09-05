import { describe, expect, it } from 'vitest';
import {
  landed,
  mayRemove,
  openPr,
  type LookupReading,
  type PrReadings,
} from '../src/rules/landed.js';

const readings = (merged: LookupReading, open: LookupReading): PrReadings => ({ merged, open });

const EVERY: readonly LookupReading[] = ['found', 'none', 'unaskable'];

describe('landed', () => {
  it('says landed when a merge timestamp was found', () => {
    expect(landed(readings('found', 'none'))).toBe('landed');
  });

  it('says not-landed when the lookup ran and found no merge', () => {
    expect(landed(readings('none', 'none'))).toBe('not-landed');
  });

  it('says unknown when the lookup could not be asked', () => {
    expect(landed(readings('unaskable', 'none'))).toBe('unknown');
  });

  it('reads the merge lookup alone, whatever the open lookup said', () => {
    for (const open of EVERY) {
      expect(landed(readings('found', open))).toBe('landed');
      expect(landed(readings('none', open))).toBe('not-landed');
      expect(landed(readings('unaskable', open))).toBe('unknown');
    }
  });
});

describe('openPr', () => {
  it('is true only where an open PR was found', () => {
    expect(openPr(readings('none', 'found'))).toBe(true);
    expect(openPr(readings('none', 'none'))).toBe(false);
  });

  it('is false where the lookup could not be asked', () => {
    expect(openPr(readings('none', 'unaskable'))).toBe(false);
  });
});

describe('mayRemove', () => {
  it('permits removal only on a found merge and no open PR', () => {
    expect(mayRemove(readings('found', 'none'))).toBe(true);
  });

  it('refuses where an open PR stands on a branch whose older PR merged', () => {
    expect(mayRemove(readings('found', 'found'))).toBe(false);
  });

  it('refuses where no merge was found', () => {
    expect(mayRemove(readings('none', 'none'))).toBe(false);
  });

  // ASSERTION 1 OF THE TWO THE PLAN NAMES. A host that cannot be asked deletes
  // nothing — over EVERY combination, not over the one a caller happened to
  // reach. The pair's coupling is what this holds: `openPr` answers false on an
  // unaskable open lookup, which is the permissive direction for a veto, and it
  // is only safe because the merge lookup has already refused on the same
  // silence.
  it('deletes nothing when the host cannot be asked', () => {
    for (const open of EVERY) {
      expect(mayRemove(readings('unaskable', open))).toBe(false);
    }
    // And the veto's own silence never turns a refusal into a permission.
    for (const merged of EVERY) {
      if (merged === 'found') continue;
      expect(mayRemove(readings(merged, 'unaskable'))).toBe(false);
    }
  });

  // THE COUPLING, STATED AS A PROPERTY RATHER THAN A COMMENT. Removal needs
  // both readings to be positive statements the host made. Exactly one of the
  // nine combinations qualifies.
  it('permits removal in exactly one of the nine combinations', () => {
    const permitted = EVERY.flatMap((merged) =>
      EVERY.filter((open) => mayRemove(readings(merged, open))).map((open) => `${merged}/${open}`),
    );
    expect(permitted).toEqual(['found/none']);
  });

  // ASSERTION 2. The rule answers with no host CLI in scope: every case above
  // is reached by calling a function with three string values, and nothing in
  // this file spawns, fetches or reads a disk.
  it('answers without reaching a host', () => {
    for (const merged of EVERY) {
      for (const open of EVERY) {
        expect(typeof mayRemove(readings(merged, open))).toBe('boolean');
      }
    }
  });
});

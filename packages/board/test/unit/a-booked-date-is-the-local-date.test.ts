import { describe, expect, it } from 'vitest';

import { localDate } from '../../src/server/entry/ladder.js';

// The shell wrote `Approved:` and `Delivered:` with `date +%Y-%m-%d`, the local
// date. A UTC date differs from it for the hours either side of midnight that
// lie between UTC and the local zone.
describe('localDate', () => {
  it('a minute before local midnight is still the local day', () => {
    expect(localDate(new Date(2026, 9, 9, 23, 59))).toBe('2026-10-09');
  });

  it('a minute after local midnight is already the next local day', () => {
    expect(localDate(new Date(2026, 9, 10, 0, 1))).toBe('2026-10-10');
  });

  it('pads a single-digit month and day', () => {
    expect(localDate(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});

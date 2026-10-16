import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';

/**
 * A row whose kind is `quiet` is placed in Quiet (#1758). Measured 2026-10-15
 * on `quatico/ewz-kus-portal`: 15 rows with `quietKind: "quiet"` sat in
 * Waiting on you. `abandoned` keeps Waiting on you.
 *
 * The host is unasked (`prs` null), which is the reading that answers `quiet`
 * for a branch with real commits and nobody on it.
 */
const pulse = { plans: [], summary: {} } as unknown as FleetReading;
const QUIET_MINUTES = 12 * 60;
const STALE = 3 * 24 * 60;

const rowFor = (branch: string, prs: Map<string, never> | null) => {
  const row = rowsFromPulse(
    pulse, new Map([[branch, STALE]]), 'plot', QUIET_MINUTES, prs as never, '', null, Date.now(),
    null, null, null, null, null, '', null, new Set([branch]),
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

describe('placement of a branch nobody is on', () => {
  it('places a quiet-kind row in quiet', () => {
    const row = rowFor('feature/unasked', null);
    expect(row.quietKind).toBe('quiet');
    expect(row.group).toBe('quiet');
  });

  it('keeps an abandoned row in waiting-on-you', () => {
    const row = rowFor('feature/abandoned', new Map());
    expect(row.quietKind).toBe('abandoned');
    expect(row.group).toBe('waiting-on-you');
  });
});

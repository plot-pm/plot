import { describe, it, expect } from 'vitest';
import { orderStatuses, type BoardStatus } from '../../src/app/components/StatusPanel.js';

// bug/a-degraded-view-says-so-at-the-top, corrected: every board status lives in
// ONE panel, ordered most-severe-first with a just-arrived status flashing at
// the top before it sorts into place. `orderStatuses` is that ordering as a pure
// function — pinned here without a browser, because the flash is seconds long and
// invisible to a test driven at the board's own rates.

const S = (key: string, severity: number): BoardStatus => ({
  key,
  severity,
  text: key,
  tone: severity >= 40 ? 'rose' : 'amber',
});

// The four the board raises, by their real severities.
const STALE = S('stale', 40);
const SCAN = S('scan-failed', 30);
const SHRINK = S('shrink', 20);
const PR = S('pr-error', 10);

const order = (
  statuses: BoardStatus[],
  flashing: string[] = [],
  arrival: [string, number][] = [],
) => orderStatuses(statuses, new Set(flashing), new Map(arrival)).map((s) => s.key);

describe('orderStatuses — most severe first', () => {
  it('puts a dead server ahead of a broken scan ahead of a shrink ahead of a spent host', () => {
    // The reader's first line is always the worst thing.
    expect(order([PR, SHRINK, SCAN, STALE])).toEqual([
      'stale', 'scan-failed', 'shrink', 'pr-error',
    ]);
  });

  it('is stable regardless of the order it is handed', () => {
    // The array is built in a fixed source order, but the ranking must not
    // depend on that — severity decides, not insertion.
    expect(order([STALE, SCAN, SHRINK, PR])).toEqual(order([PR, SCAN, STALE, SHRINK]));
  });

  it('breaks a severity tie by arrival, newest first', () => {
    // Two statuses of the same severity sort by when they arrived — the newer
    // one is the fresher news.
    const a = S('a', 20);
    const b = S('b', 20);
    expect(order([a, b], [], [['a', 1], ['b', 2]])).toEqual(['b', 'a']);
    expect(order([a, b], [], [['a', 2], ['b', 1]])).toEqual(['a', 'b']);
  });
});

describe('orderStatuses — a new arrival flashes at the top', () => {
  it('pins a flashing status above a MORE severe settled one', () => {
    // Arrival is worth interrupting for: a spent host that just appeared shows
    // above a dead server that has been up for a while.
    expect(order([STALE, PR], ['pr-error'], [['stale', 1], ['pr-error', 2]]))
      .toEqual(['pr-error', 'stale']);
  });

  it('sorts a status back into place once it stops flashing', () => {
    // Permanence is not worth interrupting for: the same pair, no longer
    // flashing, ranks by severity again.
    expect(order([STALE, PR], [], [['stale', 1], ['pr-error', 2]]))
      .toEqual(['stale', 'pr-error']);
  });

  it('orders two flashing arrivals newest first, ahead of everything settled', () => {
    expect(order(
      [STALE, SCAN, PR],
      ['scan-failed', 'pr-error'],
      [['stale', 1], ['scan-failed', 2], ['pr-error', 3]],
    )).toEqual(['pr-error', 'scan-failed', 'stale']);
  });
});

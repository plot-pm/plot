import { describe, expect, it } from 'vitest';

import { passSettled, passWindows, scanBusy, scanEndedSince } from './census-settle.js';

const QUIET = 300;
const BOUND = 120_000;
const NOW = 1_000_000;

const bridge = (attempt: unknown, ageMs: number): { text: string; mtimeMs: number } => ({
  text: JSON.stringify({ at: 1, attempt }),
  mtimeMs: NOW - ageMs,
});

describe('scanBusy', () => {
  it('reads an absent bridge as settled', () => {
    expect(scanBusy({ text: null, mtimeMs: null }, NOW, QUIET, BOUND)).toBe(false);
  });

  it('reads a running attempt as busy', () => {
    expect(scanBusy(bridge({ startedAt: 1, endedAt: null, outcome: 'running', error: null }, 5_000), NOW, QUIET, BOUND)).toBe(true);
  });

  it('reads a landed attempt as settled once the quiet window has passed', () => {
    expect(scanBusy(bridge({ startedAt: 1, endedAt: 2, outcome: 'ok', error: null }, QUIET), NOW, QUIET, BOUND)).toBe(false);
  });

  it('reads a landed attempt as busy inside the quiet window, where the automatic writes may not have started a child yet', () => {
    expect(scanBusy(bridge({ startedAt: 1, endedAt: 2, outcome: 'ok', error: null }, QUIET - 1), NOW, QUIET, BOUND)).toBe(true);
  });

  it('reads a failed attempt as settled', () => {
    expect(scanBusy(bridge({ startedAt: 1, endedAt: 2, outcome: 'failed', error: 'x' }, 5_000), NOW, QUIET, BOUND)).toBe(false);
  });

  it('reads a running attempt older than the bound as settled', () => {
    expect(scanBusy(bridge({ startedAt: 1, endedAt: null, outcome: 'running', error: null }, BOUND), NOW, QUIET, BOUND)).toBe(false);
  });

  it('reads a bridge with no attempt, or one that does not parse, as settled', () => {
    expect(scanBusy({ text: JSON.stringify({ at: 1 }), mtimeMs: NOW - 5_000 }, NOW, QUIET, BOUND)).toBe(false);
    expect(scanBusy({ text: '{', mtimeMs: NOW - 5_000 }, NOW, QUIET, BOUND)).toBe(false);
    expect(scanBusy({ text: 'null', mtimeMs: NOW - 5_000 }, NOW, QUIET, BOUND)).toBe(false);
  });
});

describe('passWindows', () => {
  it('names the marks around the last passes, oldest first', () => {
    expect(passWindows(8, 3)).toEqual([
      ['pass-5', 'pass-6'],
      ['pass-6', 'pass-7'],
      ['pass-7', 'pass-8'],
    ]);
  });

  it('names one window for one pass', () => {
    expect(passWindows(4, 1)).toEqual([['pass-3', 'pass-4']]);
  });
});

describe('scanEndedSince', () => {
  const SINCE = 500_000;
  const at = (attempt: unknown): { text: string; mtimeMs: number } => ({ text: JSON.stringify({ at: 1, attempt }), mtimeMs: NOW });

  it('reads a scan that started at the mark and landed as ended', () => {
    expect(scanEndedSince(at({ startedAt: SINCE, endedAt: SINCE + 10, outcome: 'ok', error: null }), SINCE)).toBe(true);
  });

  it('reads a scan that started after the mark and failed as ended', () => {
    expect(scanEndedSince(at({ startedAt: SINCE + 1, endedAt: SINCE + 10, outcome: 'failed', error: 'x' }), SINCE)).toBe(true);
  });

  it('reads a scan that started after the mark and still runs as not ended', () => {
    expect(scanEndedSince(at({ startedAt: SINCE + 1, endedAt: null, outcome: 'running', error: null }), SINCE)).toBe(false);
  });

  it('reads a scan that started before the mark as not ended, though it landed', () => {
    expect(scanEndedSince(at({ startedAt: SINCE - 1, endedAt: SINCE + 10, outcome: 'ok', error: null }), SINCE)).toBe(false);
  });

  it('reads an absent bridge, a bridge with no attempt and one that does not parse as not ended', () => {
    expect(scanEndedSince({ text: null, mtimeMs: null }, SINCE)).toBe(false);
    expect(scanEndedSince({ text: JSON.stringify({ at: 1 }), mtimeMs: NOW }, SINCE)).toBe(false);
    expect(scanEndedSince({ text: '{', mtimeMs: NOW }, SINCE)).toBe(false);
  });
});

describe('passSettled', () => {
  const idle = { inFlight: 0, sinceSettledMs: 400, scanBusy: false, quietMs: QUIET };

  it('settles with nothing in flight, the quiet window passed and no scan busy', () => {
    expect(passSettled(idle)).toBe(true);
  });

  it('does not settle while one tick is in flight, though the quiet window passed and no scan is busy', () => {
    expect(passSettled({ ...idle, inFlight: 1 })).toBe(false);
  });

  it('does not settle inside the quiet window', () => {
    expect(passSettled({ ...idle, sinceSettledMs: QUIET - 1 })).toBe(false);
  });

  it('settles at exactly the quiet window', () => {
    expect(passSettled({ ...idle, sinceSettledMs: QUIET })).toBe(true);
  });

  it('does not settle while the scan is busy', () => {
    expect(passSettled({ ...idle, scanBusy: true })).toBe(false);
  });
});

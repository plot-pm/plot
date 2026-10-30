import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLICE_IDLE_AFTER,
  idleEpisodeKey,
  parseSliceIdleAfter,
  sliceIdle,
  type SliceIdleReading,
  type SliceIdleWorld,
} from '../src/rules/slice-idle.js';

/**
 * `sliceIdle` — the delivery loop's once-per-stall notification rule (wave 2
 * of `the-delivery-loop-keeps-a-run`).
 *
 * Mirrors `question-escalation.test.ts`'s shape: one reading builder, one
 * `describe` per export, the mutation-style comments on the inequality and
 * the recorded-episode lookup.
 */

const FLEETD_STARTED_AT = Date.parse('2026-10-01T00:00:00.000Z');
const BOUND_MS = 2 * 3_600_000; // 2h, the default

const reading = (over: Partial<SliceIdleReading> = {}): SliceIdleReading => ({
  pr: { branch: 'feature/x', createdAt: '2026-10-01T00:00:00.000Z' },
  lines: [],
  blocked: false,
  ...over,
});

const world = (over: Partial<SliceIdleWorld> = {}): SliceIdleWorld => ({
  slices: [reading()],
  fleetdStartedAt: FLEETD_STARTED_AT,
  boundMs: BOUND_MS,
  recordedEpisodes: new Set(),
  ...over,
});

describe('sliceIdle', () => {
  it('is not idle exactly at the bound', () => {
    // MUTATION: strict `>` changed to `>=` must fail here.
    const now = FLEETD_STARTED_AT + BOUND_MS;
    const result = sliceIdle(world({ now: () => now }));
    expect(result[0].idle).toBe(false);
  });

  it('is idle one millisecond past the bound', () => {
    const now = FLEETD_STARTED_AT + BOUND_MS + 1;
    const result = sliceIdle(world({ now: () => now }));
    expect(result[0].idle).toBe(true);
    expect(result[0].isNew).toBe(true);
  });

  it('is not idle just after fleetd starts, even past the PR\'s own age, until the bound passes since the start', () => {
    // A SLICE WHOSE PR OPENED LONG BEFORE FLEETD DID must not read idle the
    // moment the daemon comes up — the clock floors at fleetd's own start.
    const longAgo = FLEETD_STARTED_AT - 10 * BOUND_MS;
    const slice = reading({ pr: { branch: 'feature/old', createdAt: new Date(longAgo).toISOString() } });
    const justAfterStart = FLEETD_STARTED_AT + 1_000;
    const notYetIdle = sliceIdle(world({ slices: [slice], now: () => justAfterStart }));
    expect(notYetIdle[0].idle).toBe(false);

    const pastBoundSinceStart = FLEETD_STARTED_AT + BOUND_MS + 1;
    const nowIdle = sliceIdle(world({ slices: [slice], now: () => pastBoundSinceStart }));
    expect(nowIdle[0].idle).toBe(true);
  });

  it('is idle where every run-log line past the bound is `failed` or `partial` — only `moved` resets the clock', () => {
    // THE SPLIT IS LOAD-BEARING: a slice retrying a broken correction every
    // tick still reads idle, because neither outcome counts as movement.
    const slice = reading({
      lines: [
        { branch: 'feature/x', step: 'correction', outcome: 'failed', at: '2026-10-01T01:00:00.000Z' },
        { branch: 'feature/x', step: 'correction', outcome: 'partial', at: '2026-10-01T01:30:00.000Z' },
      ],
    });
    const now = FLEETD_STARTED_AT + BOUND_MS + 1;
    const result = sliceIdle(world({ slices: [slice], now: () => now }));
    expect(result[0].idle).toBe(true);
  });

  it('resets the clock from the last `moved` line, not from fleetd\'s start or the PR\'s own age', () => {
    const movedAt = FLEETD_STARTED_AT + 3_600_000;
    const slice = reading({
      lines: [{ branch: 'feature/x', step: 'dispatch', outcome: 'moved', at: new Date(movedAt).toISOString() }],
    });
    const stillWithinBoundOfMove = movedAt + BOUND_MS - 1;
    expect(sliceIdle(world({ slices: [slice], now: () => stillWithinBoundOfMove }))[0].idle).toBe(false);

    const pastBoundOfMove = movedAt + BOUND_MS + 1;
    expect(sliceIdle(world({ slices: [slice], now: () => pastBoundOfMove }))[0].idle).toBe(true);
  });

  it('a recorded episode answers `isNew: false` — the once-per-stall rule', () => {
    const now = FLEETD_STARTED_AT + BOUND_MS + 1;
    const clockStart = new Date(FLEETD_STARTED_AT).toISOString();
    const recorded = new Set([idleEpisodeKey('feature/x', clockStart)]);
    const result = sliceIdle(world({ now: () => now, recordedEpisodes: recorded }));
    expect(result[0].idle).toBe(true);
    expect(result[0].isNew).toBe(false);
  });

  it('a new moved-step then a new idle period is a new episode — the clock start changed', () => {
    const firstClockStart = new Date(FLEETD_STARTED_AT).toISOString();
    const recordedForFirstEpisode = new Set([idleEpisodeKey('feature/x', firstClockStart)]);

    const movedAt = FLEETD_STARTED_AT + BOUND_MS + 1_000; // after the first episode was recorded
    const slice = reading({
      lines: [{ branch: 'feature/x', step: 'dispatch', outcome: 'moved', at: new Date(movedAt).toISOString() }],
    });
    const nowPastSecondBound = movedAt + BOUND_MS + 1;
    const result = sliceIdle(world({ slices: [slice], now: () => nowPastSecondBound, recordedEpisodes: recordedForFirstEpisode }));
    expect(result[0].idle).toBe(true);
    expect(result[0].isNew).toBe(true);
    expect(result[0].clockStart).not.toBe(firstClockStart);
  });

  it('a slice with a live `PLOT-BLOCKED` marker is never idle', () => {
    const slice = reading({ blocked: true });
    const now = FLEETD_STARTED_AT + BOUND_MS + 1_000_000;
    const result = sliceIdle(world({ slices: [slice], now: () => now }));
    expect(result[0]).toEqual({ branch: 'feature/x', idle: false, isNew: false, clockStart: result[0].clockStart });
  });

  it('`none` (a null bound) is never idle, however old the slice', () => {
    const now = FLEETD_STARTED_AT + 1_000_000_000;
    const result = sliceIdle(world({ boundMs: null, now: () => now }));
    expect(result[0].idle).toBe(false);
    expect(result[0].isNew).toBe(false);
  });

  it('never throws', () => {
    expect(() => sliceIdle(world({ slices: [] }))).not.toThrow();
  });
});

describe('parseSliceIdleAfter', () => {
  it('parses the default into 2 hours', () => {
    expect(parseSliceIdleAfter(DEFAULT_SLICE_IDLE_AFTER)).toBe(2 * 3_600_000);
  });

  it('parses an empty value into `null` — disabling the rule', () => {
    expect(parseSliceIdleAfter('')).toBeNull();
    expect(parseSliceIdleAfter('   ')).toBeNull();
  });

  it('parses `none`, in any case, into `null` — disabling the rule', () => {
    expect(parseSliceIdleAfter('none')).toBeNull();
    expect(parseSliceIdleAfter(' None ')).toBeNull();
  });

  it('falls back to the default for a malformed value', () => {
    expect(parseSliceIdleAfter('soon')).toBe(2 * 3_600_000);
  });

  it('never throws', () => {
    expect(() => parseSliceIdleAfter('not a duration at all')).not.toThrow();
  });

  it('parses seconds, minutes, hours and days', () => {
    expect(parseSliceIdleAfter('30s')).toBe(30_000);
    expect(parseSliceIdleAfter('15m')).toBe(900_000);
    expect(parseSliceIdleAfter('2d')).toBe(172_800_000);
  });
});

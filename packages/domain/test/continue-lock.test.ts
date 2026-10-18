import { describe, expect, it } from 'vitest';

import {
  CONTINUE_LOCK_SKEW_MS,
  continueLockHeld,
  decodeContinueHolder,
  encodeContinueHolder,
  type ContinueHolder,
  type ContinueHolderReadings,
} from '../src/rules/continue-lock.js';

const NOW = 1_760_000_000_000;
const BOUND = 60_000;

const holder = (over: Partial<ContinueHolder> = {}): ContinueHolder => ({
  pid: 4100,
  startedAt: NOW - 5_000,
  at: NOW - 1_000,
  ...over,
});

const gone = { alive: false, startedAt: null } as const;

const readings = (over: Partial<ContinueHolderReadings> = {}): ContinueHolderReadings => ({
  holder: gone,
  ...over,
});

describe('continueLockHeld', () => {
  it('holds while the holder is alive under its recorded start time', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 - (CONTINUE_LOCK_SKEW_MS - 1) } });
    expect(continueLockHeld(holder(), read, NOW, BOUND)).toBe(true);
  });

  it('frees a lock whose holder pid now names a process started at another time', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 + CONTINUE_LOCK_SKEW_MS } });
    expect(continueLockHeld(holder(), read, NOW, BOUND)).toBe(false);
  });

  it('holds where the table cannot be asked or the start time cannot be read', () => {
    expect(continueLockHeld(holder(), readings({ holder: { alive: null, startedAt: null } }), NOW, BOUND)).toBe(true);
    expect(continueLockHeld(holder(), readings({ holder: { alive: true, startedAt: null } }), NOW, BOUND)).toBe(true);
  });

  it('frees a lock the holder itself no longer holds', () => {
    expect(continueLockHeld(holder(), readings({ holder: gone }), NOW, BOUND)).toBe(false);
  });

  it('frees a lock older than the bound, whatever the table says', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 } });
    expect(continueLockHeld(holder({ at: NOW - BOUND }), read, NOW, BOUND)).toBe(false);
  });
});

describe('the lock record', () => {
  it('reads back what it writes', () => {
    expect(decodeContinueHolder(encodeContinueHolder(holder()))).toEqual(holder());
  });

  it('reads anything else as no record', () => {
    for (const text of ['', 'running 4100', '4100\t1', '4100\t1\t2\t3', '-\t1\t2', '4100\tx\t2', '4100\t1\t\n']) {
      expect(decodeContinueHolder(text)).toBeNull();
    }
  });
});

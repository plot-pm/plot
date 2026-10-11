import { describe, expect, it } from 'vitest';

import {
  IMPLEMENT_LOCK_SKEW_MS,
  decodeImplementHolder,
  encodeImplementHolder,
  implementLockHeld,
  type ImplementHolder,
  type ImplementHolderReadings,
} from '../src/rules/implement-lock.js';

const NOW = 1_760_000_000_000;
const BOUND = 360_000;

const holder = (over: Partial<ImplementHolder> = {}): ImplementHolder => ({
  pid: 4100,
  startedAt: NOW - 5_000,
  pgid: null,
  at: NOW - 1_000,
  agent: null,
  ...over,
});

const gone = { alive: false, startedAt: null } as const;

const readings = (over: Partial<ImplementHolderReadings> = {}): ImplementHolderReadings => ({
  holder: gone,
  agent: null,
  groupAlive: false,
  ...over,
});

describe('implementLockHeld', () => {
  it('holds while the holder is alive under its recorded start time', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 - (IMPLEMENT_LOCK_SKEW_MS - 1) } });
    expect(implementLockHeld(holder(), read, NOW, BOUND)).toBe(true);
  });

  it('frees a lock whose holder pid now names a process started at another time', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 + IMPLEMENT_LOCK_SKEW_MS } });
    expect(implementLockHeld(holder(), read, NOW, BOUND)).toBe(false);
  });

  it('holds where the table cannot be asked or the start time cannot be read', () => {
    expect(implementLockHeld(holder(), readings({ holder: { alive: null, startedAt: null } }), NOW, BOUND)).toBe(true);
    expect(implementLockHeld(holder(), readings({ holder: { alive: true, startedAt: null } }), NOW, BOUND)).toBe(true);
  });

  it('frees a lock older than the bound, whatever the table says', () => {
    const read = readings({ holder: { alive: true, startedAt: NOW - 5_000 } });
    expect(implementLockHeld(holder({ at: NOW - BOUND }), read, NOW, BOUND)).toBe(false);
  });

  it('holds while the agent lives after its holder died', () => {
    const agent = { pid: 4200, startedAt: NOW - 900 };
    expect(
      implementLockHeld(holder({ agent }), readings({ agent: { alive: true, startedAt: NOW - 900 } }), NOW, BOUND),
    ).toBe(true);
    expect(implementLockHeld(holder({ agent }), readings({ agent: gone }), NOW, BOUND)).toBe(false);
    expect(implementLockHeld(holder({ agent }), readings({ agent: null }), NOW, BOUND)).toBe(false);
  });

  it('holds while a dead group-leading holder\'s group has a member', () => {
    const leader = holder({ pgid: 4100 });
    expect(implementLockHeld(leader, readings({ groupAlive: true }), NOW, BOUND)).toBe(true);
    expect(implementLockHeld(leader, readings({ groupAlive: null }), NOW, BOUND)).toBe(true);
    expect(implementLockHeld(leader, readings({ groupAlive: false }), NOW, BOUND)).toBe(false);
  });

  it('ignores the group where the holder pid was reused, and where no group is recorded', () => {
    const reused = readings({ holder: { alive: true, startedAt: NOW }, groupAlive: true });
    expect(implementLockHeld(holder({ pgid: 4100 }), reused, NOW, BOUND)).toBe(false);
    expect(implementLockHeld(holder(), readings({ groupAlive: true }), NOW, BOUND)).toBe(false);
  });
});

describe('the lock record', () => {
  it('reads back what it writes, with and without a group and an agent', () => {
    const bare = holder();
    const full = holder({ pgid: 4100, agent: { pid: 4200, startedAt: NOW - 900 } });
    expect(decodeImplementHolder(encodeImplementHolder(bare))).toEqual(bare);
    expect(decodeImplementHolder(encodeImplementHolder(full))).toEqual(full);
  });

  it('reads anything else as no record', () => {
    for (const text of [
      '',
      'running 4100',
      '4100\t1\t-\t2\t-',
      '4100\t1\t-\t2\t-\t-\textra',
      '-\t1\t-\t2\t-\t-',
      '4100\tx\t-\t2\t-\t-',
      '4100\t1\t\t2\t-\t-',
      '4100\t1\t-\t2\t4200\t-',
      '4100\t1\t-\t2\t-\t900',
    ]) {
      expect(decodeImplementHolder(text)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';

import { launchedUnregisteredCount, type LaunchedEntry } from '../src/rules/queue.js';

const entry = (over: Partial<LaunchedEntry> = {}): LaunchedEntry => ({
  state: 'none',
  pid: '',
  startedAt: '2026-10-24T12:00:00Z',
  ...over,
});

const launchGraceMs = 30_000;
const pidBoundMs = 28_800_000;
const now = Date.parse('2026-10-24T12:00:00Z');
const alwaysAlive = () => true;
const neverAlive = () => false;

describe('launchedUnregisteredCount — two bounds on a launch `scaleUp` still counts (#2486)', () => {
  it('counts a pid-less launch inside the grace — a bound of zero would regress #2409', () => {
    const entries = [entry({ startedAt: '2026-10-24T11:59:50Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, neverAlive, now)).toBe(1);
  });

  it('stops counting a pid-less launch past the grace — leaving `Worker bound` in place would not', () => {
    const entries = [entry({ startedAt: '2026-10-24T11:59:00Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, neverAlive, now)).toBe(0);
  });

  it('stops counting a live stamped pid once its startedAt is past the pid bound', () => {
    const entries = [entry({ pid: '4242', startedAt: '2026-10-24T00:00:00Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, alwaysAlive, now)).toBe(0);
  });

  it('counts a live stamped pid inside the pid bound', () => {
    const entries = [entry({ pid: '4242', startedAt: '2026-10-24T11:00:00Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, alwaysAlive, now)).toBe(1);
  });

  it('never counts a stamped pid that is not alive, at any age', () => {
    const entries = [entry({ pid: '4242', startedAt: '2026-10-24T11:59:59Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, neverAlive, now)).toBe(0);
  });

  it('never counts an entry `stateOf` already counts — the `states[at] !== "none"` guard', () => {
    const entries = [entry({ state: 'running', pid: '4242', startedAt: '2026-10-24T11:59:50Z' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, alwaysAlive, now)).toBe(0);
  });

  it('leaves an unparseable startedAt uncounted — absent is not false', () => {
    const entries = [entry({ startedAt: 'not-a-date' })];
    expect(launchedUnregisteredCount(entries, launchGraceMs, pidBoundMs, neverAlive, now)).toBe(0);
  });
});

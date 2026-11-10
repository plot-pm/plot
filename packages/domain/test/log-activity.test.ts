import { describe, expect, it } from 'vitest';

import { activityVeto, cpuDeltaCentis, logActivity, subtreeCpuCentis } from '../src/rules/log-activity.js';
import type { ProcessRow } from '../src/rules/pid-current.js';
import type { IdleInputs } from '../src/entities/ending.js';

const row = (pid: number, ppid: number, cpuCentis: number): ProcessRow => ({ pid, ppid, startedAt: 0, cpuCentis, comm: 'x' });

describe('logActivity reads working or idle from two log readings', () => {
  it('answers working when the size moved', () => {
    expect(logActivity({ bytes: 10, mtimeMs: 5 }, { bytes: 12, mtimeMs: 5 })).toBe('working');
  });

  it('answers working when only the mtime moved', () => {
    expect(logActivity({ bytes: 10, mtimeMs: 5 }, { bytes: 10, mtimeMs: 6 })).toBe('working');
  });

  it('answers idle when size and mtime are still', () => {
    expect(logActivity({ bytes: 10, mtimeMs: 5 }, { bytes: 10, mtimeMs: 5 })).toBe('idle');
  });

  it("answers '' where there is no log now, or no earlier reading to compare", () => {
    expect(logActivity({ bytes: 10, mtimeMs: 5 }, null)).toBe('');
    expect(logActivity(null, { bytes: 10, mtimeMs: 5 })).toBe('');
    expect(logActivity(null, null)).toBe('');
  });
});

describe('subtreeCpuCentis sums the CPU time of a pid and its descendants', () => {
  const table = [row(1, 0, 1000), row(10, 1, 5), row(11, 10, 7), row(12, 11, 3), row(20, 1, 99)];

  it('sums the root, its children and their children', () => {
    expect(subtreeCpuCentis(table, 10)).toBe(15);
  });

  it('answers null where the table holds no such pid', () => {
    expect(subtreeCpuCentis(table, 42)).toBeNull();
  });
});

describe('cpuDeltaCentis compares the subtree across two tables', () => {
  const before = [row(10, 1, 5), row(11, 10, 7)];

  it('answers the growth of the subtree', () => {
    expect(cpuDeltaCentis(before, [row(10, 1, 5), row(11, 10, 9)], 10)).toBe(2);
  });

  it('answers 0 for a still subtree', () => {
    expect(cpuDeltaCentis(before, before, 10)).toBe(0);
  });

  it('answers null with no earlier table, or where either table lacks the pid', () => {
    expect(cpuDeltaCentis(null, before, 10)).toBeNull();
    expect(cpuDeltaCentis(before, [row(11, 10, 9)], 10)).toBeNull();
    expect(cpuDeltaCentis([row(3, 1, 0)], before, 10)).toBeNull();
  });
});

describe('activityVeto withholds idle while the log or the CPU moves', () => {
  const inputs = (over: Partial<IdleInputs>): IdleInputs => ({
    logBytes: 10,
    logMtimeMs: 5,
    log: 'idle',
    cpuRead: true,
    cpuDeltaCentis: 0,
    ...over,
  });

  it('vetoes a moving log, with no CPU reading', () => {
    expect(activityVeto(inputs({ log: 'working', cpuRead: false, cpuDeltaCentis: null }))).toBe(true);
  });

  it('vetoes a still log with CPU time moving', () => {
    expect(activityVeto(inputs({ cpuDeltaCentis: 4 }))).toBe(true);
  });

  it('vetoes where the CPU delta could not be read', () => {
    expect(activityVeto(inputs({ cpuDeltaCentis: null }))).toBe(true);
    expect(activityVeto(inputs({ log: '', cpuDeltaCentis: null }))).toBe(true);
  });

  it('allows idle for a still log and a still subtree', () => {
    expect(activityVeto(inputs({}))).toBe(false);
    expect(activityVeto(inputs({ log: '', logBytes: null, logMtimeMs: null }))).toBe(false);
  });
});

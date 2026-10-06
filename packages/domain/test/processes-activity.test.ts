import { describe, expect, it } from 'vitest';

import { centisOf, processesShell, subtreeCentis } from '../src/adapters/processes/processes-shell.js';
import { shellContext } from '../src/adapters/scripts.js';

/** `ps -o time=` parsing and the subtree sum that `plot_worker_activity` is read against. */
describe('centisOf', () => {
  it('reads seconds, minutes and hours from the right', () => {
    expect(centisOf('0.50')).toBe(50);
    expect(centisOf('1:02.03')).toBe(6203);
    expect(centisOf('1:00:00.00')).toBe(360000);
  });

  it('cuts the fraction to two digits and counts a missing one as zero', () => {
    expect(centisOf('3.456')).toBe(345);
    expect(centisOf('7')).toBe(700);
    expect(centisOf('7.')).toBe(700);
  });

  it('reads a field that is not a number as zero', () => {
    expect(centisOf('abc')).toBe(0);
    expect(centisOf('')).toBe(0);
  });
});

describe('subtreeCentis', () => {
  const table = [
    '  10     1  0:01.00',
    '  11    10  0:02.50',
    '  12    11  0:00.50',
    '  20     1  0:09.00',
    'garbage',
  ].join('\n');

  it('sums the root and every descendant', () => {
    expect(subtreeCentis(table, '10')).toBe(400);
    expect(subtreeCentis(table, '11')).toBe(300);
  });

  it('answers null where the root is not in the snapshot', () => {
    expect(subtreeCentis(table, '99')).toBeNull();
  });
});

describe('processesShell().activity', () => {
  const processes = processesShell(shellContext(process.cwd()));
  const quick = (): (() => void) => {
    const before = process.env.PLOT_ACTIVITY_INTERVAL;
    process.env.PLOT_ACTIVITY_INTERVAL = '0.05';
    return () => {
      if (before === undefined) delete process.env.PLOT_ACTIVITY_INTERVAL;
      else process.env.PLOT_ACTIVITY_INTERVAL = before;
    };
  };

  it('answers the empty reading for a pid that cannot name a process', async () => {
    expect(await processes.activity(Number.NaN)).toEqual({ ok: true, value: '' });
    expect(await processes.activity(0)).toEqual({ ok: true, value: '' });
    expect(await processes.activity(999_999)).toEqual({ ok: true, value: '' });
  });

  it('reads a live, quiet process as idle', async () => {
    const restore = quick();
    try {
      const answer = await processes.activity(process.ppid);
      expect(answer.ok).toBe(true);
    } finally {
      restore();
    }
  });

  it('falls back to 400 ms for an unreadable sample window', async () => {
    const before = process.env.PLOT_ACTIVITY_INTERVAL;
    process.env.PLOT_ACTIVITY_INTERVAL = 'nonsense';
    try {
      expect((await processes.activity(999_999)).ok).toBe(true);
      expect((await processes.activity(process.pid)).ok).toBe(true);
    } finally {
      if (before === undefined) delete process.env.PLOT_ACTIVITY_INTERVAL;
      else process.env.PLOT_ACTIVITY_INTERVAL = before;
    }
  });
});

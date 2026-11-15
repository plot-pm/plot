import { describe, expect, it } from 'vitest';

import { stateSyncDue, stateSyncStamp } from '../src/rules/state-sync-trigger.js';

const tips = (over: Record<string, string> = {}) => {
  const held: Record<string, string> = {
    'refs/heads/plot/state': 'a1',
    'refs/remotes/origin/plot/state': 'a1',
    'refs/heads/main': 'b1',
    'refs/remotes/origin/main': 'b1',
    'refs/heads/feature/x': 'c1',
    ...over,
  };
  return (ref: string): string | undefined => held[ref];
};

describe('stateSyncStamp', () => {
  it('names no run where no key is declared', () => {
    expect(stateSyncStamp('', 'main', tips())).toBeNull();
  });

  it('changes when the state ref, its tracking ref or the default branch moves', () => {
    const before = stateSyncStamp('plot/state', 'main', tips());
    for (const ref of ['refs/heads/plot/state', 'refs/remotes/origin/plot/state', 'refs/heads/main', 'refs/remotes/origin/main']) {
      expect(stateSyncStamp('plot/state', 'main', tips({ [ref]: 'moved' }))).not.toBe(before);
    }
  });

  it('stays the same when another branch moves', () => {
    expect(stateSyncStamp('plot/state', 'main', tips({ 'refs/heads/feature/x': 'moved' }))).toBe(stateSyncStamp('plot/state', 'main', tips()));
  });

  it('reads a state ref outside refs/heads through its state-tip ref', () => {
    const stamp = stateSyncStamp('refs/plot/state', 'main', tips({ 'refs/plot/state-tip/plot/state': 'd1' }));
    expect(stamp).toContain('refs/plot/state-tip/plot/state=d1');
    expect(stamp).toContain('refs/plot/state=-');
  });

  it('names the key alone where it is no usable ref', () => {
    expect(stateSyncStamp('main', 'main', tips())).toBe('invalid main');
  });
});

describe('stateSyncDue', () => {
  it('is due before the first settled run and after a move, and not on an idle beat', () => {
    const stamp = stateSyncStamp('plot/state', 'main', tips());
    expect(stateSyncDue(null, stamp)).toBe(true);
    expect(stateSyncDue(stamp, stamp)).toBe(false);
    expect(stateSyncDue(stamp, stateSyncStamp('plot/state', 'main', tips({ 'refs/remotes/origin/main': 'b2' })))).toBe(true);
  });

  it('is never due with no key', () => {
    expect(stateSyncDue(null, null)).toBe(false);
  });
});

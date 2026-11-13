import { describe, it, expect } from 'vitest';
import { cutRef, isStateRef, NO_STATE_BRANCH, writeTarget, type StateWriteTarget } from '../src/rules/write-target.js';

const state = (key: string): StateWriteTarget => {
  const target = writeTarget(key, 'main');
  if (target.kind !== 'state') throw new Error(`expected a state target for '${key}'`);
  return target;
};

describe('writeTarget', () => {
  it('reports none for an absent or blank key', () => {
    expect(writeTarget('', 'main')).toEqual({ kind: 'none' });
    expect(writeTarget('   ', 'main')).toEqual({ kind: 'none' });
  });

  it('qualifies a bare branch name under refs/heads/', () => {
    expect(state('plot/state')).toEqual({
      kind: 'state',
      pushRef: 'refs/heads/plot/state',
      trackRef: 'refs/remotes/origin/plot/state',
      defaultRef: 'refs/remotes/origin/main',
      isBranch: true,
    });
  });

  it('keeps a full refs/heads/ name as given', () => {
    expect(state('refs/heads/plot/state').pushRef).toBe('refs/heads/plot/state');
  });

  it('takes a ref outside refs/heads/ as a non-branch ref with its own tracking ref', () => {
    const target = state('refs/plot/state');
    expect(target.pushRef).toBe('refs/plot/state');
    expect(target.isBranch).toBe(false);
    expect(target.trackRef).toBe('refs/plot/state-tip/plot/state');
    expect(target.trackRef).not.toBe(state('plot/state').trackRef);
  });

  it.each(['a..b', 'a b', '-x', 'plot/', 'plot//state', 'x.lock', 'refs/remotes/origin/x', 'refs/tags/v1', 'main', 'refs/heads/main'])(
    'refuses %s',
    (key) => {
      expect(writeTarget(key, 'main').kind).toBe('invalid');
    },
  );
});

describe('cutRef', () => {
  it('cuts from the state tip where the origin holds the ref, else from the default branch', () => {
    const target = state('plot/state');
    expect(cutRef(target, true)).toBe('refs/remotes/origin/plot/state');
    expect(cutRef(target, false)).toBe('refs/remotes/origin/main');
  });
});

describe('isStateRef', () => {
  it('matches the declared ref by short or full name', () => {
    expect(isStateRef('plot/state', 'main', 'plot/state')).toBe(true);
    expect(isStateRef('plot/state', 'main', 'refs/heads/plot/state')).toBe(true);
    expect(isStateRef('refs/plot/state', 'main', 'refs/plot/state')).toBe(true);
  });

  it('matches nothing where no key is declared or the branch differs', () => {
    expect(isStateRef('', 'main', 'plot/state')).toBe(false);
    expect(isStateRef('plot/state', 'main', 'plot/other')).toBe(false);
  });
});

describe('NO_STATE_BRANCH', () => {
  it('is the exit code the sync and land entries answer with no key, which the shell reads as 4', () => {
    expect(NO_STATE_BRANCH).toBe(4);
  });
});

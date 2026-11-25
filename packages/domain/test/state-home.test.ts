import { describe, expect, it } from 'vitest';

import { fleetStateFile } from '../src/adapters/fleet-state/fleet-state-file.js';
import { repairRecordFile } from '../src/adapters/repair-record/repair-record-file.js';
import { stateHomeOf, stateHomeReadOf } from '../src/rules/state-home.js';

describe('stateHomeReadOf', () => {
  it('answers read for a found home', () => {
    expect(stateHomeReadOf(stateHomeOf('/r/.git', null))).toBe('read');
  });

  it('answers unaskable for an unread home', () => {
    expect(stateHomeReadOf(stateHomeOf(null, null))).toBe('unaskable');
  });
});

describe('stateHomeOf', () => {
  it('answers the main checkout for a `.git` common directory', () => {
    expect(stateHomeOf('/r/.git', null)).toEqual({ home: '/r' });
  });

  it('ignores a trailing slash', () => {
    expect(stateHomeOf('/r/.git/', null)).toEqual({ home: '/r' });
  });

  it('answers the filesystem root for a `.git` directory at the root', () => {
    expect(stateHomeOf('/.git', null)).toEqual({ home: '/' });
  });

  it('answers unread for a bare repository', () => {
    expect(stateHomeOf('/r/.bare', null)).toEqual({ unread: true });
  });

  it('answers unread for a submodule common directory', () => {
    expect(stateHomeOf('/r/.git/modules/x', null)).toEqual({ unread: true });
  });

  it('answers unread where no common directory was read', () => {
    expect(stateHomeOf(null, null)).toEqual({ unread: true });
  });

  it('answers the submodule working tree from a relative core.worktree', () => {
    expect(stateHomeOf('/w/.git/modules/app/web', '../../../../app/web')).toEqual({ home: '/w/app/web' });
  });

  it('answers unread for a non-`.git` directory with no core.worktree', () => {
    expect(stateHomeOf('/w/.git/modules/app/web', null)).toEqual({ unread: true });
  });

  it('takes an absolute core.worktree as is', () => {
    expect(stateHomeOf('/w/.git/modules/app/web', '/elsewhere/web')).toEqual({ home: '/elsewhere/web' });
  });

  it('answers unread for a relative path', () => {
    expect(stateHomeOf('.git', null)).toEqual({ unread: true });
  });

  it('refuses a raw path where a state home is asked', () => {
    // @ts-expect-error a repo root is not a state home; only stateHomeOf makes one
    expect(typeof repairRecordFile('/x').read).toBe('function');
  });

  it('refuses a raw repository root where the bridge asks for a state home', () => {
    // Built and not called: the cell is the type error, and a call would join an undefined path.
    // @ts-expect-error a repo root is not a state home; the bridge takes `home`
    const build = () => fleetStateFile({ repoRoot: '/x' });
    expect(typeof build).toBe('function');
  });
});

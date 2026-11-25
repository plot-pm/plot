import { describe, expect, it } from 'vitest';

import { mainCheckoutOf, readsCoreWorktree } from '../src/rules/main-checkout.js';

describe('mainCheckoutOf', () => {
  it('answers the parent of a `.git` common directory', () => {
    expect(mainCheckoutOf('/r/.git', null)).toEqual({ checkout: '/r' });
  });

  it('resolves a relative core.worktree against the common directory, not its parent', () => {
    expect(mainCheckoutOf('/w/.git/modules/app/web', '../../../../app/web')).toEqual({ checkout: '/w/app/web' });
  });

  it('takes an absolute core.worktree as is, normalised', () => {
    expect(mainCheckoutOf('/w/.git/modules/app/web', '/x//y/./z/')).toEqual({ checkout: '/x/y/z' });
  });

  it('answers unread for a non-`.git` directory with no core.worktree', () => {
    expect(mainCheckoutOf('/r/.bare', null)).toEqual({ unread: true });
  });

  it('answers unread where no common directory was read', () => {
    expect(mainCheckoutOf(null, '../web')).toEqual({ unread: true });
  });

  it('answers unread for a relative common directory', () => {
    expect(mainCheckoutOf('.git', null)).toEqual({ unread: true });
  });

  it('answers unread for the filesystem root with no core.worktree', () => {
    expect(mainCheckoutOf('/', null)).toEqual({ unread: true });
  });

  it('does not climb above the filesystem root', () => {
    expect(mainCheckoutOf('/a/b', '../../../..')).toEqual({ checkout: '/' });
  });
});

describe('readsCoreWorktree', () => {
  it('reads the key for a submodule common directory', () => {
    expect(readsCoreWorktree('/w/.git/modules/app/web')).toBe(true);
  });

  it('does not read the key for a `.git` directory', () => {
    expect(readsCoreWorktree('/r/.git/')).toBe(false);
  });
});

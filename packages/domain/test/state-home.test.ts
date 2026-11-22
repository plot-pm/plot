import { describe, expect, it } from 'vitest';

import { repairRecordFile } from '../src/adapters/repair-record/repair-record-file.js';
import { stateHomeOf, stateHomeReadOf } from '../src/rules/state-home.js';

describe('stateHomeReadOf', () => {
  it('answers read for a found home', () => {
    expect(stateHomeReadOf(stateHomeOf('/r/.git'))).toBe('read');
  });

  it('answers unaskable for an unread home', () => {
    expect(stateHomeReadOf(stateHomeOf(null))).toBe('unaskable');
  });
});

describe('stateHomeOf', () => {
  it('answers the main checkout for a `.git` common directory', () => {
    expect(stateHomeOf('/r/.git')).toEqual({ home: '/r' });
  });

  it('ignores a trailing slash', () => {
    expect(stateHomeOf('/r/.git/')).toEqual({ home: '/r' });
  });

  it('answers the filesystem root for a `.git` directory at the root', () => {
    expect(stateHomeOf('/.git')).toEqual({ home: '/' });
  });

  it('answers unread for a bare repository', () => {
    expect(stateHomeOf('/r/.bare')).toEqual({ unread: true });
  });

  it('answers unread for a submodule common directory', () => {
    expect(stateHomeOf('/r/.git/modules/x')).toEqual({ unread: true });
  });

  it('answers unread where no common directory was read', () => {
    expect(stateHomeOf(null)).toEqual({ unread: true });
  });

  it('answers unread for a relative path', () => {
    expect(stateHomeOf('.git')).toEqual({ unread: true });
  });

  it('refuses a raw path where a state home is asked', () => {
    // @ts-expect-error a repo root is not a state home; only stateHomeOf makes one
    expect(typeof repairRecordFile('/x').read).toBe('function');
  });
});

import { describe, it, expect } from 'vitest';
import { proposeStateBranch } from '../src/rules/state-branch.js';

describe('proposeStateBranch', () => {
  it('reads an unasked host as unverified and proposes nothing', () => {
    expect(proposeStateBranch('', 'main', null)).toEqual({ state: 'unverified' });
  });

  it('reads an answered empty list as unrestricted', () => {
    expect(proposeStateBranch('', 'main', [])).toEqual({ state: 'unrestricted' });
  });

  it('proposes plot/state for a GitHub protected branch', () => {
    expect(proposeStateBranch('', 'main', ['protected'])).toEqual({
      state: 'restricted',
      proposed: 'plot/state',
      restrictions: ['protected'],
      offerDelete: true,
    });
  });

  it('proposes plot/state for a Bitbucket push restriction and keeps the deciding words', () => {
    const got = proposeStateBranch('', 'main', ['push', 'unrelated']);
    expect(got).toMatchObject({ state: 'restricted', proposed: 'plot/state', restrictions: ['push'] });
  });

  it('reads words that restrict neither pushes nor merges as unrestricted', () => {
    expect(proposeStateBranch('', 'main', ['unrelated'])).toEqual({ state: 'unrestricted' });
  });

  it('gives an existing key no proposal and ignores the reading', () => {
    expect(proposeStateBranch('plot/state', 'main', ['protected'])).toMatchObject({ state: 'declared', key: 'plot/state' });
    expect(proposeStateBranch('plot/state', 'main', null)).toMatchObject({ state: 'declared' });
  });

  it('offers the delete restriction for a branch key and no warning', () => {
    expect(proposeStateBranch('plot/state', 'main', null)).toEqual({
      state: 'declared',
      key: 'plot/state',
      isBranch: true,
      warning: null,
      offerDelete: true,
    });
  });

  it('warns for a non-branch ref and names the recommendation', () => {
    const got = proposeStateBranch('refs/plot/state', 'main', null);
    expect(got).toMatchObject({
      state: 'declared',
      isBranch: false,
      offerDelete: false,
      warning: { recommended: 'refs/heads/plot/state' },
    });
  });

  it('reports a key that is not a ref as invalid', () => {
    expect(proposeStateBranch('has space', 'main', null).state).toBe('invalid');
  });
});

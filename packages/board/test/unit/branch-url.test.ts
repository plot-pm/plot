import { describe, it, expect } from 'vitest';
import { branchUrlBase } from '../../src/server/fleet.js';

// The board may name an address only where it knows one. Deriving a branch URL
// from a PR URL was rejected for a reason this file pins: it works only for rows
// that HAVE a PR, and `not-started` / `quiet` / fresh claims — the rows where
// "go look at the branch" is most useful — have none.

describe('branchUrlBase', () => {
  it('reads a GitHub HTTPS origin as the host\'s /tree/ form', () => {
    expect(branchUrlBase('https://github.com/plot-pm/plot.git'))
      .toBe('https://github.com/plot-pm/plot/tree/');
  });

  it('reads a GitHub SSH origin the same way', () => {
    // scp-style is what `git clone git@…` leaves behind, and it is the common
    // case on a developer machine — an origin form the board cannot read would
    // silently drop every branch link for exactly those users.
    expect(branchUrlBase('git@github.com:plot-pm/plot.git'))
      .toBe('https://github.com/plot-pm/plot/tree/');
  });

  it('uses Bitbucket\'s /branch/ form, not GitHub\'s', () => {
    // The two hosts disagree about the word, and a URL shape borrowed from the
    // other one is a confident 404.
    expect(branchUrlBase('https://bitbucket.org/team/repo.git'))
      .toBe('https://bitbucket.org/team/repo/branch/');
    expect(branchUrlBase('git@bitbucket.org:team/repo.git'))
      .toBe('https://bitbucket.org/team/repo/branch/');
  });

  it('keeps a GitHub Enterprise host rather than rewriting it to github.com', () => {
    expect(branchUrlBase('https://github.example.com/team/repo.git'))
      .toBe('https://github.example.com/team/repo/tree/');
  });

  it('returns "" for an origin whose host it does not recognise', () => {
    // The load-bearing negative. An unknown host means plain text: a guessed
    // URL shape is the same defect as a guessed PR link, one layer over.
    expect(branchUrlBase('https://git.example.com/team/repo.git')).toBe('');
    expect(branchUrlBase('/srv/git/bare-repo.git')).toBe('');
    expect(branchUrlBase('')).toBe('');
  });

  it('returns "" for a self-hosted Bitbucket, whose path shape it cannot know', () => {
    // Bitbucket Server puts branches under /projects/KEY/repos/name/branches —
    // a different shape entirely, and nothing in the origin says which it is.
    expect(branchUrlBase('https://bitbucket.example.com/scm/proj/repo.git')).toBe('');
  });
});

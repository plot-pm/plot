import { describe, expect, it } from 'vitest';

import { repoOfRemote, sliceForeignReference, sliceForeignRepo } from '../src/rules/slice-foreign-repo.js';

const HERE = 'plot-pm/plot';

describe('sliceForeignRepo — where a slice line places its branch', () => {
  it('reads an <owner>/<repo>: prefix at the start of the description', () => {
    expect(sliceForeignRepo('- `feature/x` — quatico-solutions/agent-skills: ship it', HERE)).toBe('quatico-solutions/agent-skills');
    expect(sliceForeignRepo('- `feature/x`: quatico-solutions/agent-skills: ship it', HERE)).toBe('quatico-solutions/agent-skills');
  });

  it('reads the prefix past the comments before the separator', () => {
    expect(sliceForeignRepo('- `feature/x` <!-- waits: feature/y --> — other/repo: ship it', HERE)).toBe('other/repo');
  });

  it('reads no placement from a repository named later in prose', () => {
    expect(sliceForeignRepo('- `feature/x` — port the reader from other/repo: as is', HERE)).toBeNull();
  });

  it('reads a foreign arrow', () => {
    expect(sliceForeignRepo('- `feature/x` — ship it → other/repo#12', HERE)).toBe('other/repo');
    expect(sliceForeignReference('- `feature/x` — ship it → other/repo#12', HERE)).toEqual({ repo: 'other/repo', number: 12 });
    expect(sliceForeignReference('- `feature/x` — ship it → #12', HERE)).toBeNull();
    expect(sliceForeignReference('- `feature/x` — ship it', HERE)).toBeNull();
  });

  it('reads a heading claim by its arrow only, never by a prefix', () => {
    expect(sliceForeignRepo('### Port the reader (Branch: feature/x) → other/repo#12', HERE)).toBe('other/repo');
    expect(sliceForeignRepo('### other/repo: port the reader (Branch: feature/x)', HERE)).toBeNull();
  });

  it('reads a line naming this repository, by prefix or by arrow, as claimed here', () => {
    expect(sliceForeignRepo('- `feature/x` — plot-pm/plot: ship it', HERE)).toBeNull();
    expect(sliceForeignRepo('- `feature/x` — Plot-PM/Plot: ship it', HERE)).toBeNull();
    expect(sliceForeignRepo('- `feature/x` — other/repo: ship it → plot-pm/plot#4', HERE)).toBeNull();
    expect(sliceForeignRepo('- `feature/x` — other/repo: ship it → #4', HERE)).toBeNull();
    expect(sliceForeignRepo('- `feature/x` — ship it', HERE)).toBeNull();
  });

  it('reads every prefix and arrow foreign where this repository is unread', () => {
    expect(sliceForeignRepo('- `feature/x` — plot-pm/plot: ship it', null)).toBe('plot-pm/plot');
    expect(sliceForeignRepo('- `feature/x` — ship it → plot-pm/plot#4', null)).toBe('plot-pm/plot');
  });
});

describe('repoOfRemote — the repository a remote names', () => {
  it('reads the last two path segments of an ssh and an https remote', () => {
    expect(repoOfRemote('git@github.com:plot-pm/plot.git')).toBe('plot-pm/plot');
    expect(repoOfRemote('https://github.com/plot-pm/plot/')).toBe('plot-pm/plot');
  });

  it('reads no repository from an empty string or a local path', () => {
    expect(repoOfRemote('')).toBeNull();
    expect(repoOfRemote('/tmp/repo')).toBeNull();
    expect(repoOfRemote('https://github.com/plot-pm')).toBeNull();
  });
});

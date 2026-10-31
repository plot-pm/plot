import { describe, expect, it } from 'vitest';

import { TREE_FLAGS, chainedAddsOf } from '../src/rules/chained-add.js';

describe('chainedAddsOf', () => {
  it('reads every tree flag as the whole tree', () => {
    for (const flag of TREE_FLAGS) {
      expect(chainedAddsOf(`git add ${flag} && git commit -m x`)).toEqual([{ spec: null, dir: null }]);
    }
    expect(TREE_FLAGS).toEqual(['-A', '--all', '-a', '.', '-u', '--update']);
  });

  it('collects the pathspecs of every chained git add as typed, skipping other flags', () => {
    expect(chainedAddsOf('git add -f a.md "b c.md"; git add docs/*.md | git commit -m x')).toEqual([
      { spec: 'a.md', dir: null },
      { spec: '""', dir: null },
      { spec: 'docs/*.md', dir: null },
    ]);
  });

  it('reads nothing from a line where git add is another command\'s own argument', () => {
    expect(chainedAddsOf('echo git add x\ngit commit -m y')).toEqual([]);
    expect(chainedAddsOf('git status && git commit -m x')).toEqual([]);
  });

  it('reads a line with no committing call the walk can read by substring, at the working directory', () => {
    expect(chainedAddsOf('bash -c "git add -A && git commit -m x"')).toEqual([{ spec: null, dir: null }]);
    expect(chainedAddsOf("sh -c 'git add docs/a.md; git commit -m x'")).toEqual([{ spec: 'docs/a.md', dir: null }]);
  });
});

import { describe, expect, it } from 'vitest';

import { TREE_FLAGS, chainedAddsOf } from '../src/rules/chained-add.js';

describe('chainedAddsOf', () => {
  it('reads every tree flag as the whole tree', () => {
    for (const flag of TREE_FLAGS) {
      expect(chainedAddsOf(`git add ${flag} && git commit -m x`)).toEqual([null]);
    }
    expect(TREE_FLAGS).toEqual(['-A', '--all', '-a', '.', '-u', '--update']);
  });

  it('collects the pathspecs of every chained git add as typed, skipping other flags', () => {
    expect(chainedAddsOf('git add -f a.md "b c.md"; git add docs/*.md | git commit -m x')).toEqual([
      'a.md',
      '"b',
      'c.md"',
      'docs/*.md',
    ]);
  });

  it('splits on newlines and reads nothing from a segment without git add', () => {
    expect(chainedAddsOf('echo git add x\ngit commit -m y')).toEqual(['x']);
    expect(chainedAddsOf('git status && git commit -m x')).toEqual([]);
  });
});

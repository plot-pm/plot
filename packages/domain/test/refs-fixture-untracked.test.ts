import { describe, expect, it } from 'vitest';

import { refsFixture } from '../src/adapters/refs/refs-fixture.js';

describe('refsFixture: untrackedPaths and showPrefix', () => {
  const refs = refsFixture({ untrackedPaths: ['a.txt', 'sub/b.txt', 'subway/c.txt'], showPrefix: 'sub/' });

  it('answers every path for a null pathspec', async () => {
    const answer = await refs.untrackedPaths(null);
    expect(answer.ok && answer.value).toEqual(['a.txt', 'sub/b.txt', 'subway/c.txt']);
  });

  it('matches a pathspec as the exact path or a directory prefix, not a name prefix', async () => {
    const exact = await refs.untrackedPaths('a.txt');
    const dir = await refs.untrackedPaths('sub/');
    expect(exact.ok && exact.value).toEqual(['a.txt']);
    expect(dir.ok && dir.value).toEqual(['sub/b.txt']);
  });

  it('answers the configured show-prefix, and the root by default', async () => {
    const set = await refs.showPrefix();
    const unset = await refsFixture({}).showPrefix();
    expect(set.ok && set.value).toBe('sub/');
    expect(unset.ok && unset.value).toBe('');
  });

  it('answers no untracked paths by default', async () => {
    const answer = await refsFixture({}).untrackedPaths(null);
    expect(answer.ok && answer.value).toEqual([]);
  });
});

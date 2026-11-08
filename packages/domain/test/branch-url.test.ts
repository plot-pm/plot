import { describe, expect, it } from 'vitest';

import { branchUrlBase } from '../src/rules/branch-url.js';

describe('branchUrlBase', () => {
  it.each([
    ['git@github.com:o/r.git', 'https://github.com/o/r/tree/'],
    ['https://github.example.com/o/r', 'https://github.example.com/o/r/tree/'],
    ['git@bitbucket.org:w/r.git', 'https://bitbucket.org/w/r/branch/'],
    ['ssh://git@ssh.bitbucket.org/w/r.git', 'https://bitbucket.org/w/r/branch/'],
    ['ssh://git@altssh.bitbucket.org:443/w/r.git', 'https://bitbucket.org/w/r/branch/'],
  ])('answers the prefix of %s', (origin, expected) => {
    expect(branchUrlBase(origin)).toBe(expected);
  });

  it.each([
    ['an empty origin', '   '],
    ['an unparseable origin', 'not a url'],
    ['a path with no repository', 'https://github.com/'],
    ['a path that climbs', 'https://github.com/o/../r'],
    ['another host', 'git@gitlab.com:o/r.git'],
  ])('answers an empty prefix for %s', (_name, origin) => {
    expect(branchUrlBase(origin)).toBe('');
  });
});

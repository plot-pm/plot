import { describe, expect, it } from 'vitest';

import { HOST_BRANCH_URL_SCHEMES } from '../src/adapters/host/host-branch-urls.js';
import { branchUrlBase as baseOf } from '../src/rules/branch-url.js';

const branchUrlBase = (origin: string): string => baseOf(origin, HOST_BRANCH_URL_SCHEMES);

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

describe('branchUrlBase over an explicit scheme table', () => {
  it('answers the first scheme that matches the host', () => {
    const schemes = [
      { matches: (host: string) => host === 'a.test', base: (host: string, path: string) => `A:${host}/${path}/` },
      { matches: () => true, base: (_host: string, path: string) => `B:${path}/` },
    ];
    expect(baseOf('git@a.test:o/r.git', schemes)).toBe('A:a.test/o/r/');
    expect(baseOf('git@other.test:o/r.git', schemes)).toBe('B:o/r/');
  });

  it('answers an empty prefix from an empty table', () => {
    expect(baseOf('git@github.com:o/r.git', [])).toBe('');
  });
});

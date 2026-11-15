import { describe, expect, it } from 'vitest';

import { GIT_MINIMUM, gitVersionOf, gitVersionRefusal } from '../src/rules/git-version.js';

describe('gitVersionOf', () => {
  it('reads X.Y.Z and ignores what git appends', () => {
    expect(gitVersionOf('git version 2.39.5 (Apple Git-154)\n')).toBe('2.39.5');
    expect(gitVersionOf('git version 2.56.0')).toBe('2.56.0');
  });

  it('reads a two-part version as X.Y.0', () => {
    expect(gitVersionOf('git version 2.42')).toBe('2.42.0');
  });

  it('answers null for output that names no version', () => {
    expect(gitVersionOf('')).toBeNull();
    expect(gitVersionOf('command not found')).toBeNull();
  });
});

describe('gitVersionRefusal', () => {
  it(`passes git ${GIT_MINIMUM} and later`, () => {
    expect(gitVersionRefusal('git version 2.42.0')).toBeNull();
    expect(gitVersionRefusal('git version 3.0.1')).toBeNull();
  });

  it('refuses an older git, naming 2.42 and the version found', () => {
    expect(gitVersionRefusal('git version 2.41.0')).toBe(
      'plot needs git 2.42 or later for its object reader; found git 2.41.0',
    );
    expect(gitVersionRefusal('git version 2.34.1\n')).toBe(
      'plot needs git 2.42 or later for its object reader; found git 2.34.1',
    );
  });

  it('refuses output that names no version, quoting it', () => {
    expect(gitVersionRefusal('')).toBe('plot needs git 2.42 or later for its object reader; found no git version');
    expect(gitVersionRefusal('weird\n')).toBe('plot needs git 2.42 or later for its object reader; found "weird"');
  });
});

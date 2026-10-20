import { describe, expect, it } from 'vitest';
import { bitbucketMergeable, gitSupportsMergeTree } from '../src/rules/bitbucket-mergeable.js';

describe('gitSupportsMergeTree', () => {
  it.each([
    ['git version 2.38.0', true],
    ['git version 2.38.1', true],
    ['git version 2.39.0', true],
    ['git version 3.0.0', true],
    ['git version 2.37.9', false],
    ['git version 2.30.0', false],
    ['git version 1.9.0', false],
    ['', false],
    ['not a version string', false],
  ])('%j -> %s', (version, expected) => {
    expect(gitSupportsMergeTree(version)).toBe(expected);
  });
});

describe('bitbucketMergeable', () => {
  const base = { headSha: 'abc123', baseRef: 'origin/main', gitVersion: 'git version 2.43.0' };

  it('reports mergeable on exit 0', () => {
    expect(bitbucketMergeable({ ...base, mergeTree: { code: 0 } })).toEqual({ mergeable: 'mergeable' });
  });

  it('reports conflicting on exit 1, never guessing further', () => {
    expect(bitbucketMergeable({ ...base, mergeTree: { code: 1, stderr: 'CONFLICT' } })).toEqual({
      mergeable: 'conflicting',
    });
  });

  it('reports unknown with a reason for an empty head sha', () => {
    expect(bitbucketMergeable({ ...base, headSha: '', mergeTree: { code: 0 } })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'no head commit for this pull request',
    });
  });

  it('reports unknown with a reason for an empty base ref', () => {
    expect(bitbucketMergeable({ ...base, baseRef: '', mergeTree: { code: 0 } })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'base branch not found in the local clone',
    });
  });

  it('reports unknown with a reason for git older than 2.38, even when mergeTree looks clean', () => {
    expect(bitbucketMergeable({ ...base, gitVersion: 'git version 2.30.0', mergeTree: { code: 0 } })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'git older than 2.38 cannot answer merge-tree --write-tree',
    });
  });

  it('reports unknown with a reason when merge-tree was not run', () => {
    expect(bitbucketMergeable({ ...base })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'merge-tree was not run',
    });
  });

  it('reports unknown with the trimmed stderr for an abnormal exit code', () => {
    expect(bitbucketMergeable({ ...base, mergeTree: { code: 128, stderr: '  fatal: bad object  \n' } })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'fatal: bad object',
    });
  });

  it('reports unknown with a generic reason for an abnormal exit code with no stderr', () => {
    expect(bitbucketMergeable({ ...base, mergeTree: { code: null } })).toEqual({
      mergeable: 'unknown',
      mergeableReason: 'merge-tree exited abnormally',
    });
  });

  it('never reports conflicting for anything other than exit 1 — a would_conflict-style collapse would fail this', () => {
    for (const code of [2, 127, 128, null]) {
      expect(bitbucketMergeable({ ...base, mergeTree: { code } }).mergeable).not.toBe('conflicting');
    }
  });
});

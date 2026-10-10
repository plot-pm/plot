import { describe, expect, it } from 'vitest';

import { releasePr, releaseTag } from '../src/rules/release-tag.js';

describe('releasePr', () => {
  it('reads the highest PR when no slice is deferred', () => {
    expect(releasePr([1423, 1425], [])).toBe('1425');
  });

  it('skips a deferred last slice and reads the earlier PR', () => {
    expect(releasePr([1423, 1425], [1425])).toBe('1423');
  });

  it('answers none when the only PR-bearing slice is deferred', () => {
    expect(releasePr([1425], [1425])).toBe('');
  });

  it('answers none when the plan names no PR', () => {
    expect(releasePr([], [])).toBe('');
  });
});

const BASE = {
  lastPr: '1200',
  mergeCommit: 'abc123',
  containingTags: ['v2.9.0', 'v2.10.0'],
  wantedVersion: '2.9.0',
};

describe('releaseTag', () => {
  it('resolves the first containing tag when it matches the wanted version', () => {
    expect(releaseTag(BASE)).toEqual({ outcome: 'resolved', tag: 'v2.9.0' });
  });

  it('accepts a version named without its v prefix', () => {
    expect(releaseTag({ ...BASE, wantedVersion: '2.9.0' })).toEqual({
      outcome: 'resolved',
      tag: 'v2.9.0',
    });
  });

  it('accepts a version named with its v prefix', () => {
    expect(releaseTag({ ...BASE, wantedVersion: 'v2.9.0' })).toEqual({
      outcome: 'resolved',
      tag: 'v2.9.0',
    });
  });

  it('refuses no-merge-commit when the plan names no PR', () => {
    const result = releaseTag({ ...BASE, lastPr: '', mergeCommit: '' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-merge-commit' });
  });

  it('refuses no-merge-commit when the PR carries no mergeCommit', () => {
    const result = releaseTag({ ...BASE, mergeCommit: '' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-merge-commit' });
    expect((result as { detail: string }).detail).toContain('#1200');
  });

  it('refuses no-tag when nothing contains the merge commit', () => {
    const result = releaseTag({ ...BASE, containingTags: [] });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-tag' });
  });

  it('refuses tag-does-not-contain when the named tag is not among the containing tags', () => {
    const result = releaseTag({ ...BASE, wantedVersion: '3.0.0' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'tag-does-not-contain' });
  });

  it('refuses tag-mismatch when a different tag is the first by version', () => {
    // v2.9.0 contains it too, but v2.10.0 is named — the first by version is
    // v2.9.0, so naming v2.10.0 must refuse even though it DOES contain the
    // commit.
    const result = releaseTag({ ...BASE, wantedVersion: '2.10.0' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'tag-mismatch' });
  });

  // THE CASE A PLAIN `--contains | head -1` WITHOUT A VERSION SORT WOULD PASS
  // SILENTLY: git's own listing order is not version order, so the reading
  // must already be sorted before this rule sees it — proven here by handing
  // it an intentionally mis-ordered list and confirming the FIRST ELEMENT,
  // not the lowest version, decides.
  it('trusts the reading is already sorted — the first element decides, not the lowest version', () => {
    const result = releaseTag({ ...BASE, containingTags: ['v2.10.0', 'v2.9.0'], wantedVersion: '2.9.0' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'tag-mismatch' });
  });
});

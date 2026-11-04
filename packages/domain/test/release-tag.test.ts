import { describe, expect, it } from 'vitest';

import { releasePr, releaseTag, type ReleasePrRow, type ReleaseTagPrRow } from '../src/rules/release-tag.js';

const row = (repo: string, number: number, deferred = false): ReleasePrRow => ({
  reference: { repo, number },
  deferred,
});

const unannotated = (deferred = false): ReleasePrRow => ({ reference: null, deferred });

describe('releasePr', () => {
  it('answers local with the local PR when a higher-numbered foreign PR is also named', () => {
    expect(releasePr([row('', 33), row('other/repo', 280)])).toEqual({
      outcome: 'local',
      numbers: [33],
    });
  });

  it('answers local when a foreign reference shares the same number', () => {
    expect(releasePr([row('', 33), row('other/repo', 33)])).toEqual({
      outcome: 'local',
      numbers: [33],
    });
  });

  it('drops a deferred foreign reference before counting, even sharing the local number', () => {
    expect(releasePr([row('', 33), row('other/repo', 33, true)])).toEqual({
      outcome: 'local',
      numbers: [33],
    });
  });

  it('answers all-foreign with the repositories when every non-deferred reference is foreign', () => {
    expect(releasePr([row('owner/one', 10), row('owner/two', 20)])).toEqual({
      outcome: 'all-foreign',
      repos: ['owner/one', 'owner/two'],
    });
  });

  it('answers none when an unannotated non-deferred branch sits beside a foreign PR', () => {
    expect(releasePr([row('other/repo', 280), unannotated()])).toEqual({ outcome: 'none' });
  });

  it('answers none when the plan names no PR', () => {
    expect(releasePr([])).toEqual({ outcome: 'none' });
  });

  it('answers none when every reference is deferred', () => {
    expect(releasePr([row('', 33, true)])).toEqual({ outcome: 'none' });
  });

  it('drops a deferred unannotated branch rather than forcing none', () => {
    expect(releasePr([row('owner/one', 10), unannotated(true)])).toEqual({
      outcome: 'all-foreign',
      repos: ['owner/one'],
    });
  });
});

const prRow = (overrides: Partial<ReleaseTagPrRow> = {}): ReleaseTagPrRow => ({
  number: 1200,
  mergeCommit: 'abc123',
  mergedAt: '2026-09-01T00:00:00Z',
  containingTags: ['v2.9.0', 'v2.10.0'],
  ...overrides,
});

const BASE = {
  prs: [prRow()],
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
    const result = releaseTag({ ...BASE, prs: [] });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-merge-commit' });
  });

  it('refuses no-merge-commit when the PR carries no mergeCommit', () => {
    const result = releaseTag({ ...BASE, prs: [prRow({ mergeCommit: '' })] });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'no-merge-commit' });
    expect((result as { detail: string }).detail).toContain('#1200');
  });

  it('refuses no-tag when nothing contains the merge commit', () => {
    const result = releaseTag({ ...BASE, prs: [prRow({ containingTags: [] })] });
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
    const result = releaseTag({ ...BASE, prs: [prRow({ containingTags: ['v2.10.0', 'v2.9.0'] })] });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'tag-mismatch' });
  });

  // THE CASE PICKING THE TAG BY PR NUMBER, RATHER THAN mergedAt, WOULD PASS
  // SILENTLY: #60 is the higher number but merged FIRST; #50 merged LAST, so
  // the tag must be resolved from #50 — picking by number would have resolved
  // from #60 instead, reproducing the same-repo version of the defect wave 1
  // fixed cross-repo. #50's own tag (v2.10.0) does not contain #60's commit,
  // so the release must refuse tag-misses-pr naming #60 — the PR missing from
  // the tag that WAS correctly resolved from the latest merge.
  it('refuses tag-misses-pr naming the other local PR missing from the tag resolved by mergedAt', () => {
    const pr60 = prRow({ number: 60, mergeCommit: 'sha60', mergedAt: '2026-09-01T00:00:00Z', containingTags: ['v2.9.0'] });
    const pr50 = prRow({ number: 50, mergeCommit: 'sha50', mergedAt: '2026-09-02T00:00:00Z', containingTags: ['v2.10.0'] });
    const result = releaseTag({ prs: [pr60, pr50], wantedVersion: '2.10.0' });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'tag-misses-pr' });
    expect((result as { detail: string }).detail).toContain('#60');
  });

  it('resolves normally when both PRs merged and the tag contains both, picking the later mergedAt', () => {
    const pr60 = prRow({ number: 60, mergeCommit: 'sha60', mergedAt: '2026-09-01T00:00:00Z', containingTags: ['v2.10.0'] });
    const pr50 = prRow({ number: 50, mergeCommit: 'sha50', mergedAt: '2026-09-02T00:00:00Z', containingTags: ['v2.10.0'] });
    const result = releaseTag({ prs: [pr60, pr50], wantedVersion: '2.10.0' });
    expect(result).toEqual({ outcome: 'resolved', tag: 'v2.10.0' });
  });
});

import { describe, expect, it } from 'vitest';

import { BITBUCKET_LIST_FIELDS } from '../src/adapters/host/bitbucket-pr-listing.js';
import { envelopeNextFor } from '../src/adapters/host/listing-paging.js';
import { bitbucketPrState, type BitbucketPr } from '../src/rules/bitbucket-pr-reading.js';
import { bitbucketPlainRow, bitbucketRichRow } from '../src/rules/bitbucket-pr-row.js';

/**
 * Bitbucket's `fields` filter keeps only the named paths, so a field the
 * projection reads and the filter omits arrives missing and reads as empty.
 * Each test prunes a full answer to {@link BITBUCKET_LIST_FIELDS} the way the
 * host does and asserts that the projection reads the same row from both.
 */

type Json = Readonly<Record<string, unknown>>;

/** Keeps the keys of `value` that a dotted path in `paths` names, as Bitbucket's `fields` filter does. */
const prune = (value: Json, paths: readonly string[]): Json => {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (paths.includes(key)) {
      kept[key] = value[key];
      continue;
    }
    const inner = paths.filter((path) => path.startsWith(`${key}.`)).map((path) => path.slice(key.length + 1));
    if (inner.length === 0) continue;
    const child = value[key];
    if (Array.isArray(child)) kept[key] = child.map((item: Json) => prune(item, inner));
    else if (typeof child === 'object' && child !== null) kept[key] = prune(child as Json, inner);
  }
  return kept;
};

const FIELDS = BITBUCKET_LIST_FIELDS.split(',');

/** A pull request carrying every field a projection reads, each with a distinct value, and fields none reads. */
const pullRequest = (state: string): Json => ({
  id: 17,
  title: 'A listing asks once',
  state,
  draft: true,
  updated_on: '2026-11-20T10:00:00+00:00',
  created_on: '2026-11-01T10:00:00+00:00',
  description: 'not read by any projection',
  links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/17' }, self: { href: 'https://api.bitbucket.org/self' } },
  author: { nickname: 'jwloka', display_name: 'not read' },
  source: { branch: { name: 'bug/one-request' }, commit: { hash: '66836536f8c9' } },
  destination: { branch: { name: 'main' }, commit: { hash: 'not read' } },
  merge_commit: { hash: 'abc1234def56' },
  comment_count: 3,
});

const envelope = (values: readonly Json[]): Json => ({
  pagelen: 50,
  size: 51,
  page: 1,
  next: 'https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests?page=2',
  values,
});

describe('the Bitbucket fields filter holds every projected field', () => {
  it.each(['OPEN', 'MERGED', 'DECLINED'])('reads the same plain and rich %s row from a pruned answer', (state) => {
    const full = pullRequest(state);
    const pruned = (prune(envelope([full]), FIELDS).values as Json[])[0]!;
    expect(bitbucketPlainRow(pruned)).toEqual(bitbucketPlainRow(full));
    expect(bitbucketRichRow(pruned)).toEqual(bitbucketRichRow(full));
  });

  it.each(['OPEN', 'MERGED', 'DECLINED'])('reads the same pr-state %s row from a pruned answer', (state) => {
    const full = pullRequest(state) as unknown as BitbucketPr;
    const pruned = (prune(envelope([full as unknown as Json]), FIELDS).values as Json[])[0] as unknown as BitbucketPr;
    expect(bitbucketPrState(pruned, null, null)).toEqual(bitbucketPrState(full, null, null));
  });

  it('keeps the envelope keys the walk reads', () => {
    const pruned = prune(envelope([pullRequest('OPEN')]), FIELDS);
    expect(Object.keys(pruned).sort()).toEqual(['next', 'page', 'pagelen', 'size', 'values']);
    expect(envelopeNextFor(pruned)).toBe('present');
  });

  it('fails where the filter omits a field a projection reads', () => {
    const full = pullRequest('MERGED');
    const short = FIELDS.filter((path) => path !== 'values.source.commit.hash');
    const pruned = (prune(envelope([full]), short).values as Json[])[0]!;
    expect(bitbucketPlainRow(pruned)).not.toEqual(bitbucketPlainRow(full));
  });
});

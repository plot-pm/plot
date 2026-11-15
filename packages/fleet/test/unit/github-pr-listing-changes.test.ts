import { describe, expect, it } from 'vitest';

import { githubPrListing } from '@plot-pm/domain/adapters/host/github-pr-listing';
import { PrIndexRowSchema, type PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import { emptySnapshot } from '@plot-pm/domain/entities/snapshot';
import { recordReading } from '@plot-pm/domain/rules/snapshot-record';

import { readListingFixtures, replayClient, startGithubReplay, type RecordedExchange } from '../../../domain/test/fixtures/github-replay.js';
import { storeRow, type PrRecord } from '../../src/shared/pr-refresh.js';
import { readOf } from '../../src/shared/snapshot-fill.js';

/**
 * A change in any field a rule reads from the in-process listing is a change
 * of the `prs` reading: each row changes one field of one recorded GitHub
 * answer, reads it through `githubPrListing` and `storeRow`, and records it
 * over the reading of the unchanged answer.
 */

type Node = Record<string, unknown>;
type Context = Record<string, unknown>;

const NOW = Date.UTC(2026, 10, 10);
const fixtures = new Map(readListingFixtures().map((f) => [f.name, f]));

/** The contexts of one node's rollup. */
const contexts = (node: Node): Context[] =>
  (((node.statusCheckRollup as { nodes: { commit: { statusCheckRollup: { contexts: { nodes: Context[] } } } }[] }).nodes[0]).commit.statusCheckRollup.contexts.nodes);

/** The exchanges with one pull request's node changed. */
const changed = (exchanges: readonly RecordedExchange[], number: number, change: (node: Node) => void): RecordedExchange[] => {
  const copy = structuredClone(exchanges) as RecordedExchange[];
  for (const one of copy) {
    const data = (one.response as { data?: Record<string, { nodes?: Node[]; pullRequests?: { nodes: Node[] } }> }).data ?? {};
    const nodes = data.repository?.pullRequests?.nodes ?? data.search?.nodes ?? [];
    for (const node of nodes) if (node.number === number) change(node);
  }
  return copy;
};

/** The `prs` reading the in-process listing yields for one fixture's exchanges. */
const reading = async (name: string, exchanges: readonly RecordedExchange[]): Promise<PrIndexRow[]> => {
  const fixture = fixtures.get(name);
  if (fixture === undefined) throw new Error(`no fixture ${name}`);
  const replay = await startGithubReplay(exchanges);
  const { api, cleanup } = replayClient(replay.url);
  try {
    const listing = await githubPrListing(api).prListing(fixture.query);
    expect(listing.answer).toBe('answered');
    return listing.rows.map((row) => storeRow({ ...row } as unknown as PrRecord, undefined, NOW));
  } finally {
    await replay.close();
    cleanup();
  }
};

/** One field, the fixture and PR whose answer feeds it, and the change. */
interface FieldChange {
  readonly field: keyof PrIndexRow;
  readonly fixture: string;
  readonly number: number;
  readonly change: (node: Node) => void;
}

const CHANGES: readonly FieldChange[] = [
  { field: 'number', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.number = 9392) },
  { field: 'head', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.headRefName = 'feature/renamed') },
  { field: 'state', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.state = 'CLOSED') },
  { field: 'draft', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.isDraft = n.isDraft !== true) },
  { field: 'checks', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (contexts(n)[0].conclusion = 'FAILURE') },
  { field: 'review', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.reviewDecision = 'APPROVED') },
  { field: 'url', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.url = 'https://github.com/plot-fixture/listing/pull/1') },
  { field: 'mergeable', fixture: 'open-rich-two-pages', number: 396, change: (n) => void (n.mergeable = 'CONFLICTING') },
  { field: 'failing_checks', fixture: 'open-rich-two-pages', number: 397, change: (n) => void (contexts(n)[0].name = 'unit') },
  { field: 'author', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.author = { login: 'someone', id: 'U_9', name: 'Someone' }) },
  { field: 'updatedAt', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.updatedAt = '2026-11-09T00:00:00Z') },
  { field: 'headSha', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.headRefOid = 'f'.repeat(40)) },
  { field: 'checksSha', fixture: 'open-rich-two-pages', number: 392, change: (n) => void (n.headRefOid = 'e'.repeat(40)) },
  { field: 'mergedAt', fixture: 'all-rich-open', number: 698, change: (n) => void (n.mergedAt = '2026-11-09T00:00:00Z') },
  { field: 'plotReview', fixture: 'open-rich-two-pages', number: 396, change: (n) => void (contexts(n)[0].state = 'SUCCESS') },
  { field: 'plotReviewSha', fixture: 'open-rich-two-pages', number: 396, change: (n) => void (n.headRefOid = 'd'.repeat(40)) },
  { field: 'plotReviewAt', fixture: 'open-rich-two-pages', number: 396, change: (n) => void (contexts(n)[0].createdAt = '2026-11-09T00:00:00Z') },
  { field: 'ciChecks', fixture: 'open-rich-two-pages', number: 387, change: (n) => void (contexts(n)[1].state = 'SUCCESS') },
];

/** The fields no GitHub answer feeds, and who writes them instead. */
const NOT_FROM_THE_LISTING: Readonly<Record<string, string>> = {
  headSince: "this machine's clock when storeRow first sees the head",
  checksLookup: "the Jenkins arm's lookup, which the GitHub rollup arm never sets",
  plotReviewJudged: 'judgeReviews, against the Review app',
  plotReviewCheckedSha: 'judgeReviews, against the Review app',
  plotReviewCheckedAt: 'judgeReviews, against the Review app',
};

describe('a change in a field the in-process listing answers is a change of the prs reading', () => {
  it('names every PrIndexRowSchema field once: changed below, or written by something other than the listing', () => {
    const named = [...CHANGES.map((c) => c.field), ...Object.keys(NOT_FROM_THE_LISTING)].sort();
    expect(named).toEqual(Object.keys(PrIndexRowSchema.shape).sort());
  });

  for (const { field, fixture, number, change } of CHANGES) {
    it(`${field}: a changed answer yields a different prs reading and changed: ['prs']`, async () => {
      const recorded = fixtures.get(fixture)?.exchanges ?? [];
      const before = await reading(fixture, recorded);
      const after = await reading(fixture, changed(recorded, number, change));
      const index = before.findIndex((row) => row.number === number);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(after[index][field]).not.toEqual(before[index][field]);
      const held = recordReading(emptySnapshot(), 'prs', readOf(before, NOW)).snapshot;
      expect(recordReading(held, 'prs', readOf(after, NOW)).changed).toEqual(['prs']);
      expect(recordReading(held, 'prs', readOf(before, NOW)).changed).toEqual([]);
    });
  }
});

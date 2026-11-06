import { describe, expect, it } from 'vitest';

import type { PrIndexRow } from '@plot-pm/domain';
import type { Host, PrReviewReading } from '@plot-pm/domain/ports/host';

import { judgeReviews, storeRow, type PrRecord } from '../../src/shared/pr-refresh.js';

const HEAD = 'a'.repeat(40);
const APP = 'plot-review[bot]';

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u',
  headSha: HEAD, plotReview: 'success', plotReviewSha: HEAD, plotReviewAt: '2026-11-03T10:00:00Z', ...over,
});

const reading = (writer: string, state = 'success', sha = HEAD): PrReviewReading => ({
  sha, state, description: '', time: 't', bypass: false, statuses: [{ state, description: '', time: 't', writer }],
});

/** A host answering `writer` for `reviewWriter` and `read` for every `prReview`, counting both. */
const hostOf = (writer: { ok: true; value: string } | { ok: false; why: 'failed' }, read: PrReviewReading | null) => {
  const asked = { writer: 0, review: 0 };
  const host = {
    reviewWriter: async () => { asked.writer += 1; return writer; },
    prReview: async () => { asked.review += 1; return read === null ? { ok: false as const, why: 'failed' as const } : { ok: true as const, value: read }; },
  } as unknown as Host;
  return { host, asked };
};

describe('judgeReviews', () => {
  it('judges a success the Review app wrote as success, for the head and the status time', async () => {
    const rows = [row()];
    await judgeReviews(hostOf({ ok: true, value: APP }, reading(APP)).host, rows);
    expect(rows[0]).toMatchObject({ plotReviewJudged: 'success', plotReviewCheckedSha: HEAD, plotReviewCheckedAt: '2026-11-03T10:00:00Z' });
  });

  it('judges a success only a foreign writer wrote as absent', async () => {
    const rows = [row()];
    await judgeReviews(hostOf({ ok: true, value: APP }, reading('jwloka')).host, rows);
    expect(rows[0]?.plotReviewJudged).toBe('absent');
  });

  it('takes the rollup state as the judgment, with no pr-review call, where no writer is declared', async () => {
    const rows = [row({ plotReview: 'failure' })];
    const { host, asked } = hostOf({ ok: true, value: '' }, null);
    await judgeReviews(host, rows);
    expect(rows[0]?.plotReviewJudged).toBe('failure');
    expect(asked.review).toBe(0);
  });

  it('asks the writer once for the pass, however many rows are due', async () => {
    const rows = [row(), row({ number: 8, head: 'feature/b' })];
    const { host, asked } = hostOf({ ok: true, value: APP }, reading(APP));
    await judgeReviews(host, rows);
    expect(asked).toEqual({ writer: 1, review: 2 });
  });

  it('asks nothing where no row is due', async () => {
    const { host, asked } = hostOf({ ok: true, value: APP }, reading(APP));
    await judgeReviews(host, [row({ plotReview: 'pending' }), row({ state: 'MERGED' }), row({ draft: true })]);
    expect(asked).toEqual({ writer: 0, review: 0 });
  });

  it('leaves a row unjudged where the writer cannot be resolved, the read failed or the head moved', async () => {
    for (const { host } of [
      hostOf({ ok: false, why: 'failed' }, reading(APP)),
      hostOf({ ok: true, value: APP }, null),
      hostOf({ ok: true, value: APP }, reading(APP, 'success', 'b'.repeat(40))),
    ]) {
      const rows = [row()];
      await judgeReviews(host, rows);
      expect(rows[0]?.plotReviewJudged).toBeUndefined();
    }
  });
});

describe('the judgment across refreshes', () => {
  const judged = row({ plotReviewJudged: 'success', plotReviewCheckedSha: HEAD, plotReviewCheckedAt: '2026-11-03T10:00:00Z' });
  const record = (over: Partial<PrRecord> = {}): PrRecord => ({
    number: 7, head: 'feature/a', state: 'OPEN', draft: false, checks: 'green', review: '', url: 'u',
    headSha: HEAD, plotReview: 'success', plotReviewSha: HEAD, plotReviewAt: '2026-11-03T10:00:00Z', ...over,
  } as PrRecord);

  it('keeps the judgment while the head and the status time are unchanged', () => {
    expect(storeRow(record(), judged)).toMatchObject({ plotReviewJudged: 'success', plotReviewCheckedSha: HEAD });
  });

  it('drops it where a newer status moved plotReviewAt', () => {
    expect(storeRow(record({ plotReviewAt: '2026-11-03T10:05:00Z' }), judged).plotReviewJudged).toBeUndefined();
  });

  it('drops it where the head moved', () => {
    const moved = 'b'.repeat(40);
    expect(storeRow(record({ headSha: moved, plotReviewSha: moved }), judged).plotReviewJudged).toBeUndefined();
  });

  it('carries nothing where the row had no judgment', () => {
    expect(storeRow(record(), row()).plotReviewJudged).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { reviewBypasses, type MergedReview } from '../src/rules/review-bypass.js';

const SINCE = '2026-10-15T00:00:00Z';
const pr = (number: number, over: Partial<MergedReview> = {}): MergedReview => ({
  number,
  mergedAt: '2026-10-16T00:00:00Z',
  review: 'absent',
  bypassed: false,
  ...over,
});

describe('reviewBypasses', () => {
  it('reports nothing and says off with no cutoff', () => {
    expect(reviewBypasses([pr(1)], null)).toEqual({ kind: 'off' });
  });

  it('says off for a cutoff that is not a date', () => {
    expect(reviewBypasses([pr(1)], 'soon')).toEqual({ kind: 'off' });
  });

  it('reports green CI with no plot/review status — the #1687 shape', () => {
    expect(reviewBypasses([pr(1687)], SINCE)).toEqual({ kind: 'on', bypasses: [1687], unread: [] });
  });

  it('reports a failed and a pending review', () => {
    const report = reviewBypasses([pr(3, { review: 'pending' }), pr(2, { review: 'failure' })], SINCE);
    expect(report).toEqual({ kind: 'on', bypasses: [2, 3], unread: [] });
  });

  it('passes a success and a bypass comment', () => {
    const report = reviewBypasses([pr(1, { review: 'success' }), pr(2, { bypassed: true })], SINCE);
    expect(report).toEqual({ kind: 'on', bypasses: [], unread: [] });
  });

  it('skips a merge at or before the cutoff', () => {
    const report = reviewBypasses(
      [pr(1, { mergedAt: '2026-10-14T00:00:00Z' }), pr(2, { mergedAt: SINCE })],
      SINCE,
    );
    expect(report).toEqual({ kind: 'on', bypasses: [], unread: [] });
  });

  it('lists a failed read as unread and never as a bypass or a pass', () => {
    const report = reviewBypasses([pr(5, { review: 'unread' }), pr(4, { review: 'unread', bypassed: true })], SINCE);
    expect(report).toEqual({ kind: 'on', bypasses: [], unread: [4, 5] });
  });

  it('skips an unread PR merged before the cutoff', () => {
    const report = reviewBypasses([pr(6, { review: 'unread', mergedAt: '2026-01-01T00:00:00Z' })], SINCE);
    expect(report).toEqual({ kind: 'on', bypasses: [], unread: [] });
  });
});

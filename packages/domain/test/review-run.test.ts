import { describe, expect, it } from 'vitest';

import { REVIEW_START_GRACE_MS, reviewRunLive, type ReviewRunEntry } from '../src/rules/review-run.js';

const NOW = 100_000_000;
const BOUND = 3_600_000;
const startedAgo = (ms: number): ReviewRunEntry => ({ pr: 3658, head: '9d7846ec8', pid: 4242, startedAt: NOW - ms, mode: 'review' });

describe('reviewRunLive', () => {
  it('reads a run whose pid answers as live at the bound plus the start grace, less one millisecond', () => {
    expect(reviewRunLive(startedAgo(BOUND + REVIEW_START_GRACE_MS - 1), true, NOW, BOUND)).toBe(true);
  });

  it('reads a run whose pid answers as dead once the bound plus the start grace has passed', () => {
    expect(reviewRunLive(startedAgo(BOUND + REVIEW_START_GRACE_MS), true, NOW, BOUND)).toBe(false);
    expect(reviewRunLive(startedAgo(9 * 3_600_000), true, NOW, BOUND)).toBe(false);
  });

  it('reads a run whose pid answers as live past the start grace and inside the bound', () => {
    expect(reviewRunLive(startedAgo(BOUND), true, NOW, BOUND)).toBe(true);
  });

  it('reads a run whose pid is dead as live only inside the start grace', () => {
    expect(reviewRunLive(startedAgo(REVIEW_START_GRACE_MS - 1), false, NOW, BOUND)).toBe(true);
    expect(reviewRunLive(startedAgo(REVIEW_START_GRACE_MS), false, NOW, BOUND)).toBe(false);
  });
});

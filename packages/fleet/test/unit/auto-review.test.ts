// The review tick: a green head with no review gets one detached review, once
// per head, and the start count survives a restart.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import { readReviewStarts } from '@plot-pm/domain/adapters/review-start/review-start-node';
import { removeTree } from '../rm-tree.mjs';
import { AUTO_REVIEW_KEY, autoReview, reviewTick, type ReviewTickReadings } from '../../src/shared/auto-review.js';

const HEAD = 'a'.repeat(40);
const NOW = 5_000_000_000;
let root: string;
let starts: number;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-review-'));
  starts = 0;
});
afterEach(() => {
  removeTree(root);
});

const row: PrIndexRow = {
  number: 7,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green',
  plotReview: 'absent',
};

const readings = (now: number): ReviewTickReadings => ({
  newestMerged: null,
  scope: { read: 'scope', sprint: {} as never, slugs: ['x'], branches: ['feature/x'] },
  verdict: { read: 'absent' },
  defaultBranch: null,
  desk: { dead: false, why: 'live' },
  config: { autoReview: true, reviewBoundMs: 3_600_000, startBudget: 3, checksWaitMs: 3_600_000 },
  now,
});

const start = () => ({
  repoRoot: root,
  script: '/s/plot-review.mjs',
  cwd: root,
  logFile: path.join(root, 'log'),
  detached: {
    node: () => {
      starts += 1;
      return { pid: 9000 + starts, exitCode: () => null };
    },
  } as Detached,
  pidAlive: () => true,
  limit: 4,
});

describe('reviewTick', () => {
  it('starts exactly one review over two ticks on one in-flight entry', () => {
    const first = reviewTick([row], readings(NOW), start());
    const second = reviewTick([row], readings(NOW + 1000), start());
    expect(first[0]!.started).toEqual({ started: true, pid: 9001 });
    expect(second[0]!.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
    expect(starts).toBe(1);
  });

  it('keeps the start count across a restart and waits out the backoff', () => {
    reviewTick([row], readings(NOW), start());
    const dead = { ...start(), pidAlive: () => false };
    // A new process reads the same files: the count is 1, the backoff is 15 minutes.
    expect(readReviewStarts(root)).toEqual([{ pr: 7, head: HEAD, count: 1, lastAt: NOW }]);
    const soon = reviewTick([row], readings(NOW + 5 * 60_000), dead);
    expect(soon[0]!.step).toEqual({ step: 'none', why: 'backoff' });
    const later = reviewTick([row], readings(NOW + 16 * 60_000), dead);
    expect(later[0]!.started).toMatchObject({ started: true });
    expect(readReviewStarts(root)![0]!.count).toBe(2);
    expect(starts).toBe(2);
  });

  it('starts nothing for a row out of scope', () => {
    const out = reviewTick([{ ...row, head: 'feature/y' }], readings(NOW), start());
    expect(out[0]!.step).toMatchObject({ step: 'none', why: 'out-of-scope' });
    expect(starts).toBe(0);
  });
});

describe('autoReview', () => {
  it('names its config key and follows the flag', () => {
    expect(AUTO_REVIEW_KEY).toBe('Auto-review');
    expect(autoReview({ autoReview: true })).toBe(true);
    expect(autoReview({ autoReview: false })).toBe(false);
  });
});

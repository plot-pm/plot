// The review tick: a green head with no review gets one detached review, once
// per head, and the start count survives a restart.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import { readReviewStarts } from '@plot-pm/domain/adapters/review-start/review-start-node';
import { runLogFixture } from '@plot-pm/domain/adapters';
import { removeTree } from '../rm-tree.mjs';
import {
  AUTO_REVIEW_KEY,
  autoReview,
  reviewTick,
  runAutoReviewPass,
  type ReviewPassReading,
  type ReviewPassWorld,
  type ReviewTickReadings,
} from '../../src/shared/auto-review.js';

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

describe('runAutoReviewPass', () => {
  const opts = () => ({ repoRoot: root, scriptsDir: root, runLog: runLogFixture() });
  const world = (over: Partial<ReviewPassWorld> = {}): ReviewPassWorld => ({
    autoReview: () => true,
    detached: start().detached,
    pidAlive: () => true,
    readLock: () => null,
    ...over,
  });
  const reading = (rows: readonly PrIndexRow[]): ReviewPassReading => ({ rows, readings: readings(NOW) });

  it('starts one review on an in-scope green head with no plot/review, and logs the start', async () => {
    const o = opts();
    const out = await runAutoReviewPass(o, new Set(), NOW, world(), async () => reading([row]));
    expect(out?.[0]?.started).toEqual({ started: true, pid: 9001 });
    expect(starts).toBe(1);
    expect(o.runLog.lines).toEqual([
      { plan: '', branch: 'feature/x', pr: '7', head: HEAD, step: 'review-start', outcome: 'moved', at: new Date(NOW).toISOString() },
    ]);
  });

  it('starts none on a head that already has a plot/review status', async () => {
    const o = opts();
    const reviewed = { ...row, plotReview: 'success' as const, plotReviewSha: HEAD };
    const out = await runAutoReviewPass(o, new Set(), NOW, world(), async () => reading([reviewed]));
    // The merge arm answers on a reviewed head; with no default-branch reading it holds.
    expect(out?.[0]?.step).toEqual({ step: 'hold', reason: 'default-branch-unread' });
    expect(out?.[0]?.started).toBeUndefined();
    expect(starts).toBe(0);
    expect(o.runLog.lines).toEqual([]);
  });

  it('reads nothing and starts none with Auto-review off', async () => {
    let read = 0;
    const out = await runAutoReviewPass(opts(), new Set(), NOW, world({ autoReview: () => false }), async () => {
      read += 1;
      return reading([row]);
    });
    expect(out).toBeNull();
    expect(read).toBe(0);
    expect(starts).toBe(0);
  });

  it('starts none while a live run holds the review lock of the head', async () => {
    const o = opts();
    const out = await runAutoReviewPass(
      o,
      new Set(),
      NOW,
      world({ readLock: (_o, pr, head) => (pr === 7 && head === HEAD ? '4242\trun-1\n' : null) }),
      async () => reading([row]),
    );
    expect(out?.[0]?.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
    expect(starts).toBe(0);
  });

  it('starts a review where the lock names a dead pid', async () => {
    const out = await runAutoReviewPass(
      opts(),
      new Set(),
      NOW,
      world({ readLock: () => '4242\trun-1\n', pidAlive: (pid) => pid !== 4242 }),
      async () => reading([row]),
    );
    expect(out?.[0]?.started).toMatchObject({ started: true });
    expect(starts).toBe(1);
  });

  it('logs a repeating start refusal once per PR, head and reason', async () => {
    const o = opts();
    const logged = new Set<string>();
    const second: PrIndexRow = { ...row, number: 8, head: 'feature/z', url: 'u8' };
    const scoped = (): ReviewPassReading => ({
      rows: [row, second],
      readings: { ...readings(NOW), scope: { read: 'scope', sprint: {} as never, slugs: ['x'], branches: ['feature/x', 'feature/z'] } },
    });
    await runAutoReviewPass(o, logged, NOW, world(), async () => scoped());
    await runAutoReviewPass(o, logged, NOW + 1000, world(), async () => scoped());
    expect(starts).toBe(1);
    expect(o.runLog.lines.map((l) => [l.pr, l.outcome])).toEqual([
      ['7', 'moved'],
      ['8', 'failed: at-capacity'],
    ]);
  });

  it('acts on nothing where the reading gives nothing', async () => {
    expect(await runAutoReviewPass(opts(), new Set(), NOW, world(), async () => null)).toBeNull();
    expect(starts).toBe(0);
  });
});

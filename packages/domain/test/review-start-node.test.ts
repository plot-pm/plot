import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  endReviewRun,
  liveReviewRuns,
  readReviewStarts,
  reviewInFlightPath,
  startReview,
  type StartReviewOptions,
} from '../src/adapters/review-start/review-start-node.js';
import type { Detached } from '../src/ports/detached.js';
import { REVIEW_START_GRACE_MS } from '../src/rules/review-run.js';

const BOUND = 3_600_000;

let root: string;
let calls: { script: string; args: readonly string[] }[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'review-start-'));
  calls = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const detached = (): Detached => ({
  node: (script, args) => {
    calls.push({ script, args });
    return { pid: 4000 + calls.length, exitCode: () => null };
  },
});

const opts = (over: Partial<StartReviewOptions> = {}): StartReviewOptions => ({
  repoRoot: root,
  script: '/s/plot-review.mjs',
  cwd: root,
  logFile: join(root, 'log'),
  detached: detached(),
  pidAlive: () => true,
  limit: 2,
  boundMs: BOUND,
  mode: 'review',
  now: 1_000_000,
  ...over,
});

describe('startReview', () => {
  it('starts plot-review.mjs through the Detached port and records the entry and the count', () => {
    expect(startReview(7, 'h1', opts())).toEqual({ started: true, pid: 4001 });
    expect(calls).toEqual([{ script: '/s/plot-review.mjs', args: ['7'] }]);
    const flight = JSON.parse(readFileSync(reviewInFlightPath(root), 'utf8'));
    expect(flight).toEqual([{ pr: 7, head: 'h1', pid: 4001, startedAt: 1_000_000, mode: 'review' }]);
    expect(readReviewStarts(root)).toEqual([{ pr: 7, head: 'h1', count: 1, lastAt: 1_000_000 }]);
  });

  it('passes --status-only for a status-only run', () => {
    startReview(7, 'h1', opts({ mode: 'status-only' }));
    expect(calls[0]!.args).toEqual(['7', '--status-only']);
  });

  it('refuses a second start for the same PR and head', () => {
    startReview(7, 'h1', opts());
    expect(startReview(7, 'h1', opts({ now: 1_000_100 }))).toEqual({ started: false, why: 'review-in-flight' });
    expect(calls).toHaveLength(1);
  });

  it('refuses at the concurrency bound', () => {
    startReview(1, 'h', opts());
    startReview(2, 'h', opts());
    expect(startReview(3, 'h', opts())).toEqual({ started: false, why: 'at-capacity' });
  });

  it('drops a dead entry and keeps one start record per PR', () => {
    startReview(7, 'h1', opts());
    const later = opts({ pidAlive: () => false, now: 1_000_000 + 60_000 });
    expect(startReview(7, 'h2', later)).toMatchObject({ started: true });
    expect(readReviewStarts(root)).toEqual([{ pr: 7, head: 'h2', count: 1, lastAt: 1_060_000 }]);
  });

  it('reports start-failed where a state file cannot be read', () => {
    mkdirSync(join(root, '.plot', 'state'), { recursive: true });
    writeFileSync(reviewInFlightPath(root), '{ nope');
    expect(startReview(7, 'h1', opts())).toEqual({ started: false, why: 'start-failed' });
    expect(calls).toHaveLength(0);
  });
});

describe('liveReviewRuns', () => {
  const entry = (startedAt: number) => ({ pr: 7, head: 'h1', pid: 4001, startedAt, mode: 'review' });
  const write = (startedAt: number): void => {
    mkdirSync(join(root, '.plot', 'state'), { recursive: true });
    writeFileSync(reviewInFlightPath(root), JSON.stringify([entry(startedAt)]));
  };

  it('keeps a run whose pid answers up to the bound plus the start grace', () => {
    const now = 10_000_000;
    write(now - BOUND - REVIEW_START_GRACE_MS + 1);
    expect(liveReviewRuns(root, () => true, now, BOUND)).toHaveLength(1);
  });

  it('drops a run whose pid answers once it started the bound plus the start grace ago', () => {
    const now = 10_000_000;
    write(now - BOUND - REVIEW_START_GRACE_MS);
    expect(liveReviewRuns(root, () => true, now, BOUND)).toEqual([]);
  });

  it('lets a start through where the only entry for the head is past the bound', () => {
    write(1_000_000 - BOUND - REVIEW_START_GRACE_MS - 1000);
    expect(startReview(7, 'h1', opts())).toEqual({ started: true, pid: 4001 });
  });
});

describe('endReviewRun', () => {
  it('ends a process whose command line names plot-review.mjs', async () => {
    const script = join(root, 'plot-review.mjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore' });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, sig) => resolve(sig)));
    await new Promise((resolve) => child.on('spawn', resolve));
    expect(endReviewRun(child.pid!, 100)).toBe(true);
    expect(await exited).toBe('SIGTERM');
  });

  it('signals nothing for a pid whose command line names another script', () => {
    expect(endReviewRun(process.pid)).toBe(false);
  });

  it('signals nothing for pid 1 or 0', () => {
    expect(endReviewRun(1)).toBe(false);
    expect(endReviewRun(0)).toBe(false);
  });
});

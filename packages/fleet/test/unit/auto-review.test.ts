// The review tick: a green head with no review gets one detached review, once
// per head, and the start count survives a restart.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import { readReviewStarts, reviewInFlightPath, reviewStartsPath } from '@plot-pm/domain/adapters/review-start/review-start-node';
import { REVIEW_START_GRACE_MS } from '@plot-pm/domain/rules/review-run';
import { runLogFixture } from '@plot-pm/domain/adapters';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '@plot-pm/domain/entities/repair-record';
import { removeTree } from '../rm-tree.mjs';
import {
  AUTO_REVIEW_KEY,
  autoReview,
  readRepairReview,
  readReviewPass,
  reviewTick,
  runAutoReviewPass,
  type ReviewOwnerPorts,
  type ReviewOwnerReading,
  type ReviewPassReading,
  type ReviewPassReadings,
  type ReviewPassWorld,
  type ReviewTickReadings,
} from '../../src/shared/auto-review.js';
import { prIndexFile } from '@plot-pm/domain/adapters';
import { PR_INDEX_VERSION } from '@plot-pm/domain/entities/pr-index';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Host } from '@plot-pm/domain/ports/host';

const HEAD = 'a'.repeat(40);
const BOUND = 3_600_000;
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
  base: 'main',
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

const NO_FIXER: ReviewOwnerReading['fixer'] = { read: 'record', inFlight: false, highExhausted: false, ciExhausted: false, conflictExhausted: false, conflictTried: false, pushedHead: false };
const deskOwned = (rows: readonly PrIndexRow[]): ReadonlyMap<number, ReviewOwnerReading> =>
  new Map(rows.map((r) => [r.number, { owner: 'desk', fixer: NO_FIXER }]));

const passReadings = (now: number): ReviewPassReadings => ({
  newestMerged: null,
  defaultBranchName: 'main',
  verdict: { read: 'absent' },
  defaultBranch: null,
  desk: { dead: false, why: 'live' },
  config: { autoReview: true, reviewBoundMs: 3_600_000, startBudget: 3, checksWaitMs: 3_600_000 },
  now,
});

const readings = (now: number, owners: ReadonlyMap<number, ReviewOwnerReading> = deskOwned([row])): ReviewTickReadings => ({
  ...passReadings(now),
  owners,
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
  boundMs: 3_600_000,
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
    const out = reviewTick([{ ...row, base: 'release/1' }], readings(NOW), start());
    expect(out[0]!.step).toMatchObject({ step: 'none', why: 'base-out-of-scope' });
    expect(starts).toBe(0);
  });

  it('starts nothing for a row with no owner reading', () => {
    const out = reviewTick([row], readings(NOW, new Map()), start());
    expect(out[0]!.step).toEqual({ step: 'none', why: 'owner-unread' });
    expect(starts).toBe(0);
  });
});

describe('the fix PR of a red default branch', () => {
  const GREEN = 'c'.repeat(40);
  const RED = 'r'.repeat(40);
  const FIX = `bug/main-repair-${GREEN.slice(0, 12)}`;
  const fixRow: PrIndexRow = { ...row, number: 9, head: FIX };
  const redMain: DefaultBranchReading = {
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: RED,
    head: 'red',
    settled: { sha: RED, state: 'red' },
    failingRuns: [],
    headSince: new Date(NOW).toISOString(),
    askedAt: new Date(NOW).toISOString(),
    at: new Date(NOW).toISOString(),
  };
  const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
    v: REPAIR_RECORD_VERSION,
    branch: 'main',
    state: 'repairing',
    lastGreenSha: GREEN,
    firstRedSha: RED,
    redSince: new Date(NOW).toISOString(),
    candidates: [],
    rerun: 'asked',
    preRevertRerun: 'none',
    attempt: { branch: FIX },
    at: new Date(NOW).toISOString(),
    ...over,
  });
  const ports = (file: RepairRecord | null) => ({
    repair: {
      read: async () => ({ ok: true as const, value: file }),
      write: async () => ({ ok: true as const, value: undefined }),
    },
    refs: { firstParentLine: async () => ({ ok: true as const, value: [RED] }) },
  });
  const tick = async (rows: readonly PrIndexRow[], file: RepairRecord | null, now = NOW, pidAlive = true) => {
    const repairMerge = await readRepairReview(rows, redMain, ports(file));
    return reviewTick(
      rows,
      { ...readings(now), defaultBranch: redMain, ...(repairMerge === undefined ? {} : { repairMerge }) },
      { ...start(), pidAlive: () => pidAlive },
    );
  };

  it('reviews the fix PR the record names once its CI is green', async () => {
    const out = await tick([fixRow], record({ repairPr: 9 }));
    expect(out[0]!.started).toMatchObject({ started: true });
    expect(starts).toBe(1);
  });

  it('starts nothing on a second pass after the review of the same head finished', async () => {
    await tick([fixRow], record({ repairPr: 9 }));
    const reviewed = { ...fixRow, plotReview: 'success' as const, plotReviewSha: HEAD, plotReviewJudged: 'success' as const, plotReviewCheckedSha: HEAD };
    const out = await tick([reviewed], record({ repairPr: 9 }), NOW + 60 * 60_000, false);
    expect(out[0]!.started).toBeUndefined();
    expect(starts).toBe(1);
  });

  it('starts no review before the fix PR is green', async () => {
    const pending = { ...fixRow, ciChecks: 'pending' as const };
    const out = await tick([pending], record({ repairPr: 9 }));
    expect(out[0]!.step).toEqual({ step: 'none', why: 'ci-not-green' });
    expect(starts).toBe(0);
  });

  it('starts nothing on a machine whose record names no fix PR', async () => {
    const out = await tick([fixRow], record({ attempt: { branch: FIX, outcome: 'lost' } }));
    expect(out[0]!.step).toMatchObject({ step: 'none', why: 'repair-owned' });
    expect(starts).toBe(0);
  });

  it('reads no record on a default branch that is not settled red', async () => {
    const green: DefaultBranchReading = { ...redMain, head: 'green', settled: { sha: RED, state: 'green' } };
    expect(await readRepairReview([fixRow], green, ports(record({ repairPr: 9 })))).toBeUndefined();
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
  let subjectCalls: string[];
  let ended: number[];
  beforeEach(() => {
    subjectCalls = [];
    ended = [];
  });
  const owned = (over: Partial<ReviewOwnerPorts> = {}): ReviewOwnerPorts => ({
    trees: { forBranch: async () => ({ ok: true as const, value: null }) },
    agents: { declared: async () => ({ ok: true as const, value: [] }) },
    refs: {
      commitSubjects: async (range: string) => {
        subjectCalls.push(range);
        return { ok: true as const, value: [] };
      },
    },
    attempts: { read: async () => ({ ok: true as const, value: 'none' as const }) },
    ...over,
  });
  const world = (over: Partial<ReviewPassWorld> = {}): ReviewPassWorld => ({
    autoReview: () => true,
    detached: start().detached,
    pidAlive: () => true,
    readLock: () => null,
    lockTime: () => NOW - 1000,
    endRun: (pid) => {
      ended.push(pid);
      return true;
    },
    owners: () => owned(),
    ...over,
  });
  const OLD_HEAD = new Date(NOW - 2 * 3_600_000).toISOString();
  const reading = (rows: readonly PrIndexRow[]): ReviewPassReading => ({
    rows: rows.map((r) => ({ headSince: OLD_HEAD, ...r })),
    readings: passReadings(NOW),
    claimStaleMs: 24 * 3_600_000,
  });

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
    const reviewed = { ...row, plotReview: 'success' as const, plotReviewSha: HEAD, plotReviewJudged: 'success' as const, plotReviewCheckedSha: HEAD };
    const out = await runAutoReviewPass(o, new Set(), NOW, world(), async () => reading([reviewed]));
    // The review walk has no merge arm: a reviewed head answers reviewed.
    expect(out?.[0]?.step).toEqual({ step: 'none', why: 'reviewed' });
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

  it('starts a review and ends the holder where a lock whose time cannot be read was first seen past the bound', async () => {
    const seen = new Map();
    const locked = world({ readLock: () => '4242\trun-1\n', lockTime: () => null });
    const first = await runAutoReviewPass(opts(), new Set(), NOW, locked, async () => reading([row]), seen);
    expect(first?.[0]?.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
    const later = NOW + BOUND + REVIEW_START_GRACE_MS;
    const out = await runAutoReviewPass(opts(), new Set(), later, locked, async () => ({ ...reading([row]), readings: passReadings(later) }), seen);
    expect(out?.[0]?.started).toMatchObject({ started: true });
    expect(ended).toEqual([4242]);
    expect(fs.readFileSync(path.join(root, '.plot', 'state', 'slice-review.log'), 'utf8')).toBe(
      'plot-review: run 4242 on PR #7 passed the 3600s bound; ended\n',
    );
  });

  it('holds a lock whose time cannot be read inside the bound of the pass that first saw it', async () => {
    const seen = new Map();
    const locked = world({ readLock: () => '4242\trun-1\n', lockTime: () => null });
    await runAutoReviewPass(opts(), new Set(), NOW, locked, async () => reading([row]), seen);
    const later = NOW + BOUND + REVIEW_START_GRACE_MS - 1;
    const out = await runAutoReviewPass(opts(), new Set(), later, locked, async () => ({ ...reading([row]), readings: passReadings(later) }), seen);
    expect(out?.[0]?.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
    expect(ended).toEqual([]);
    expect(starts).toBe(0);
  });

  it('yields no review-in-flight hold for a lock written 3631 s ago', async () => {
    const out = await runAutoReviewPass(
      opts(),
      new Set(),
      NOW,
      world({ readLock: () => '4242\trun-1\n', lockTime: () => NOW - BOUND - REVIEW_START_GRACE_MS - 1000 }),
      async () => reading([row]),
    );
    expect(out?.[0]?.started).toMatchObject({ started: true });
    expect(ended).toEqual([4242]);
  });

  describe('the #3658 fixture: pending on the head for 9 h with a live pid', () => {
    const NINE_HOURS = 9 * 3_600_000;
    const pending: PrIndexRow = {
      ...row,
      number: 3658,
      plotReview: 'pending',
      plotReviewSha: HEAD,
      plotReviewAt: new Date(NOW - NINE_HOURS).toISOString(),
      plotReviewJudged: 'pending',
      plotReviewCheckedSha: HEAD,
    };
    const seed = (count: number): void => {
      fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
      const at = NOW - NINE_HOURS;
      fs.writeFileSync(reviewInFlightPath(root), JSON.stringify([{ pr: 3658, head: HEAD, pid: 4242, startedAt: at, mode: 'review' }]));
      fs.writeFileSync(reviewStartsPath(root), JSON.stringify([{ pr: 3658, head: HEAD, count, lastAt: at }]));
    };
    const hung = () => world({
      readLock: (_o, pr, head) => (pr === 3658 && head === HEAD ? '4242\trun-1\n' : null),
      lockTime: () => NOW - NINE_HOURS,
    });
    const pass = (now: number) =>
      runAutoReviewPass(opts(), new Set(), now, hung(), async () => ({ ...reading([pending]), readings: passReadings(now) }));

    it('ends the hung run once and starts exactly one review over two passes', async () => {
      seed(1);
      const first = await pass(NOW);
      expect(first?.[0]?.started).toEqual({ started: true, pid: 9001 });
      const second = await pass(NOW + 60_000);
      expect(second?.[0]?.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
      expect(starts).toBe(1);
      expect(ended).toEqual([4242]);
      expect(readReviewStarts(root)).toEqual([{ pr: 3658, head: HEAD, count: 2, lastAt: NOW }]);
    });

    it('answers budget-spent for a fourth start on the same head and ends nothing', async () => {
      seed(3);
      const out = await pass(NOW);
      expect(out?.[0]?.step).toEqual({ step: 'none', why: 'budget-spent' });
      expect(starts).toBe(0);
      expect(ended).toEqual([]);
    });
  });

  it('ends no run inside the bound', async () => {
    fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
    fs.writeFileSync(reviewInFlightPath(root), JSON.stringify([{ pr: 7, head: HEAD, pid: 4242, startedAt: NOW - BOUND, mode: 'review' }]));
    const out = await runAutoReviewPass(opts(), new Set(), NOW, world(), async () => reading([row]));
    expect(out?.[0]?.step).toEqual({ step: 'hold', reason: 'review-in-flight' });
    expect(ended).toEqual([]);
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
    await runAutoReviewPass(o, logged, NOW, world(), async () => reading([row, second]));
    await runAutoReviewPass(o, logged, NOW + 1000, world(), async () => reading([row, second]));
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

  it('starts a review for a deskless PR outside the sprint', async () => {
    const outside: PrIndexRow = { ...row, head: 'feature/outside-the-sprint' };
    const out = await runAutoReviewPass(opts(), new Set(), NOW, world(), async () => reading([outside]));
    expect(out?.[0]?.started).toEqual({ started: true, pid: 9001 });
    expect(subjectCalls).toEqual(['origin/main..origin/feature/outside-the-sprint']);
  });

  it('starts no review where the owner reading fails', async () => {
    const failing = world({
      owners: () => owned({ agents: { declared: async () => ({ ok: false as const, error: 'failed' as const, detail: 'x' }) } as never }),
    });
    const out = await runAutoReviewPass(opts(), new Set(), NOW, failing, async () => reading([row]));
    expect(out?.[0]?.step).toEqual({ step: 'none', why: 'owner-unread' });
    expect(starts).toBe(0);
  });

  it('holds a person head for the quiet hour and reviews a fixer-pushed head at once', async () => {
    const fresh: PrIndexRow = { ...row, headSince: new Date(NOW - 5 * 60_000).toISOString() };
    const held = await runAutoReviewPass(opts(), new Set(), NOW, world(), async () => reading([fresh]));
    expect(held?.[0]?.step).toEqual({ step: 'none', why: 'person-pushed-recently', leftMs: 55 * 60_000 });
    const record = {
      v: 1,
      pr: 7,
      attempts: [{ finding: { kind: 'ci', runId: 'o' }, headSha: 'o'.repeat(40), startedAt: NOW - 20 * 60_000, pushedSha: HEAD }],
    };
    const pushed = world({ owners: () => owned({ attempts: { read: async () => ({ ok: true as const, value: record as never }) } }) });
    const out = await runAutoReviewPass(opts(), new Set(), NOW, pushed, async () => reading([fresh]));
    expect(out?.[0]?.started).toMatchObject({ started: true });
  });

  it('keeps the start budget over the wider set', async () => {
    const outside: PrIndexRow = { ...row, head: 'feature/outside-the-sprint' };
    const dead = world({ pidAlive: () => false });
    for (let minute = 0; minute < 6 * 60; minute += 30) {
      await runAutoReviewPass(opts(), new Set(), NOW + minute * 60_000, dead, async () => ({
        ...reading([outside]),
        readings: passReadings(NOW + minute * 60_000),
      }));
    }
    expect(starts).toBe(3);
    expect(readReviewStarts(root)![0]!.count).toBe(3);
  });

  it('costs no Refs call for a PR out of scope', async () => {
    const rows: PrIndexRow[] = [
      { ...row, number: 1, head: 'changeset-release/main' },
      { ...row, number: 2, head: 'idea/x' },
      { ...row, number: 3, base: 'release/1' },
      { ...row, number: 4, base: undefined },
      { ...row, number: 5, draft: true },
    ];
    const out = await runAutoReviewPass(opts(), new Set(), NOW, world(), async () => reading(rows));
    expect(out?.map((r) => r.step)).toEqual([
      { step: 'none', why: 'release-pr' },
      { step: 'none', why: 'plan-pr' },
      { step: 'none', why: 'base-out-of-scope' },
      { step: 'none', why: 'base-unread' },
      { step: 'none', why: 'draft' },
    ]);
    expect(subjectCalls).toEqual([]);
  });
});

describe('readReviewPass', () => {
  const ENV = 'PLOT_PR_INDEX_HOME';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    process.env[ENV] = path.join(root, 'index');
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  /** A port whose every method throws, except the ones named. */
  const only = <T extends object>(allowed: Partial<T>): T =>
    new Proxy(allowed, {
      get: (target, key) => {
        if (key in target) return (target as Record<string | symbol, unknown>)[key];
        if (key === 'then') return undefined;
        return () => {
          throw new Error(`unexpected read: ${String(key)}`);
        };
      },
    }) as T;

  const passOpts = (name: { ok: true; value: string } | { ok: false; error: 'failed'; detail: string }) => ({
    repoRoot: root,
    scriptsDir: root,
    runLog: runLogFixture(),
    stateHome: { home: root as never },
    hostAdapter: only<Host>({ backend: async () => ({ ok: true as const, value: 'github' }) }),
    refs: only<Refs>({ defaultBranch: async () => name as never }),
    scripts: only<Scripts>({ config: async (_key: string, fallback: string) => ({ ok: true as const, value: fallback }) } as never),
  });

  const writeIndex = async (): Promise<void> => {
    const now = new Date(NOW).toISOString();
    const written = await prIndexFile({ cwd: root }).write('github', {
      v: PR_INDEX_VERSION,
      connector: 'github',
      watermark: null,
      complete: true,
      at: now,
      rows: [{ ...row, updatedAt: now }],
    } as never);
    expect(written.ok).toBe(true);
  };

  it('reads no sprint scope, the default branch name and Claim stale after', async () => {
    await writeIndex();
    const out = await readReviewPass(passOpts({ ok: true, value: 'trunk' }) as never, NOW);
    expect(out?.rows.map((r) => r.number)).toEqual([7]);
    expect(out?.readings.defaultBranchName).toBe('trunk');
    expect(out?.claimStaleMs).toBe(24 * 3_600_000);
    expect(out?.readings).not.toHaveProperty('scope');
  });

  it('leaves the default branch name absent where its read fails, never main', async () => {
    await writeIndex();
    const out = await readReviewPass(passOpts({ ok: false, error: 'failed', detail: 'x' }) as never, NOW);
    expect(out?.readings).not.toHaveProperty('defaultBranchName');
  });
});

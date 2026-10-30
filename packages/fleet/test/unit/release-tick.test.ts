// The release tick: a green head with no review gets one review through
// startReview; an approvable head gets one notification per changeset list.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { Detached } from '@plot-pm/domain/ports/detached';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import { runLogFixture } from '@plot-pm/domain/adapters/run-log/run-log-fixture';
import { removeTree } from '../rm-tree.mjs';
import { releaseTick, type ReleaseTickPorts } from '../../src/shared/release-tick.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = 5_000_000_000;
const BRANCH = 'changeset-release/main';
let root: string;
let starts: number;
let sent: string[];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tick-'));
  starts = 0;
  sent = [];
});
afterEach(() => {
  removeTree(root);
});

const row = (over: Partial<PrIndexRow> = {}): PrIndexRow => ({
  number: 9,
  head: BRANCH,
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'none',
  plotReview: 'success',
  plotReviewSha: HEAD,
  ...over,
});

const notifier: Notifier = {
  notify: async (message) => {
    sent.push(message);
    return { ok: true };
  },
};

const ports = (pr: PrIndexRow, log = runLogFixture()): ReleaseTickPorts & { log: ReturnType<typeof runLogFixture> } => ({
  scope: async () => ({ read: 'scope', sprint: { slug: 'sprint-1' } as never, slugs: ['x'], branches: [] }),
  phases: async () => new Map([['x', 'delivered']]),
  pr: async () => pr,
  runs: async () => ({ read: 'runs', runs: [{ workflow: 'CI', status: 'completed', conclusion: 'success' }] }),
  changesets: async () => [{ file: 'a.md', plan: '2026-10-29-x' }, { file: 'b.md', plan: '' }],
  finish: async () => 'none',
  log,
  notifier,
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

const config = { requiredWorkflow: 'CI', reviewBoundMs: 3_600_000, startBudget: 3 };

describe('releaseTick', () => {
  it('starts one review through startReview and records the action, not readiness', async () => {
    const p = ports(row({ plotReview: 'absent', plotReviewSha: undefined }));
    const first = await releaseTick(p, config, start(), NOW);
    const second = await releaseTick(p, config, start(), NOW + 1000);
    expect(first.started).toEqual({ started: true, pid: 9001 });
    expect(second.step).toEqual({ step: 'none', why: 'review-in-flight' });
    expect(starts).toBe(1);
    expect(p.log.lines).toHaveLength(1);
    expect(p.log.lines[0]).toMatchObject({ step: 'release-review', head: HEAD, outcome: 'moved', branch: BRANCH });
  });

  it('notifies once, with both changeset groups, and not again on a bot bump', async () => {
    const log = runLogFixture();
    const first = await releaseTick(ports(row(), log), config, start(), NOW);
    expect(first.notified).toBe('sent');
    expect(sent[0]).toContain('Sprint sprint-1: a.md.');
    expect(sent[0]).toContain('Outside work: b.md.');
    const moved = row({ headSha: OLD, plotReviewSha: OLD });
    const second = await releaseTick(ports(moved, log), config, start(), NOW + 60_000);
    expect(second.step).toEqual({ step: 'none', why: 'notified' });
    expect(sent).toHaveLength(1);
    expect(log.lines.map((l) => l.step)).toEqual(['release-notified']);
  });

  it('acts on nothing while a scope plan is not Delivered', async () => {
    const p = { ...ports(row()), phases: async () => new Map([['x', 'approved']]) };
    const out = await releaseTick(p, config, start(), NOW);
    expect(out.stage).toBe('waiting-scope');
    expect(sent).toHaveLength(0);
    expect(p.log.lines).toHaveLength(0);
  });
});

// The fixer tick: fleetd's own HIGH/CI-red arm starts. `highArm`/`ciRedArm`
// pick the step; this tick supplies their readings from the worker table,
// the ending file and the attempts record, then carries out a `fixer` step —
// writing the attempt first, taking the desk's continue lock, re-asking the
// host before it starts, and launching the role without blocking the tick.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FixerAttemptsRecord } from '@plot-pm/domain/entities/fixer-attempts';
import { removeTree as rmTree } from '../rm-tree.mjs';
import {
  fixerTick,
  deskDeadFromWorkerState,
  fixerRunDir,
  type FixerTickWorld,
  type FixerTickReadings,
} from '../../src/shared/auto-fixer.js';

const made: string[] = [];
afterEach(() => {
  while (made.length) rmTree(made.pop()!);
});

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const NOW = 5_000_000_000;

const FIXER_MD = '---\ndescription: Fixes one review finding.\nmaxTurns: 7\n---\n\nFix the finding.\n';

const baseRow: PrIndexRow = {
  number: 7,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'u',
  headSha: HEAD,
};

const highRow: PrIndexRow = { ...baseRow, plotReview: 'failure', plotReviewSha: HEAD };
const ciRedRow: PrIndexRow = { ...baseRow, ciChecks: 'failing', checksSha: HEAD };

const baseReadings: FixerTickReadings = {
  newestMerged: null,
  scope: { read: 'scope', sprint: {} as never, slugs: ['x'], branches: ['feature/x'] },
  reviewRun: null,
  reviewStarts: null,
  verdict: { read: 'absent' },
  defaultBranch: null,
  config: { autoReview: false, reviewBoundMs: 3_600_000, startBudget: 3, checksWaitMs: 3_600_000 },
  now: NOW,
};

interface WorldOptions {
  /** `forBranch`'s answer; a worktree present on this machine, or none. */
  deskPath?: string | null;
  workerState?: 'running' | 'waiting' | 'finished' | 'failed' | 'ended' | 'none' | 'elsewhere' | 'fail';
  endingText?: string | null;
  freshRows?: number;
  attempts?: FixerAttemptsRecord | 'none' | 'unreadable';
  appendOk?: boolean;
  appendCalls?: { pr: number; headSha: string }[];
  prState?: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; headSha?: string } | null | 'fail';
  addBranchOk?: boolean;
  roleText?: string | null;
  agentRunStarts?: { pid: number }[];
  /** How the started agent run settles: launches a pid, or fails to spawn at all. */
  agentRunOutcome?: 'starts' | 'never-spawns' | 'exits-unstarted' | 'rejects';
}

const world = (opts: WorldOptions = {}): FixerTickWorld => ({
  trees: () => ({
    forBranch: async () =>
      opts.deskPath === undefined || opts.deskPath === null
        ? { ok: true, value: null }
        : { ok: true, value: { path: opts.deskPath, branch: 'feature/x', detached: false } },
    addBranch: async (dir) => {
      if (opts.addBranchOk === false) return { ok: false, why: 'failed' };
      fs.mkdirSync(dir, { recursive: true });
      return { ok: true, value: undefined };
    },
  }),
  host: () => ({
    prState: async () => {
      if (opts.prState === 'fail') return { ok: false, why: 'unaskable' };
      if (opts.prState === undefined) return { ok: true, value: { number: 7, state: 'OPEN', headSha: HEAD } as never };
      return { ok: true, value: opts.prState as never };
    },
  }),
  worker: () => ({
    workerState: async () =>
      opts.workerState === undefined
        ? { ok: true, value: { state: 'none' } as never }
        : opts.workerState === 'fail'
          ? { ok: false, why: 'failed' }
          : { ok: true, value: { state: opts.workerState } as never },
  }),
  attempts: () => ({
    read: async () => {
      if (opts.attempts === undefined || opts.attempts === 'none') return { ok: true, value: 'none' };
      if (opts.attempts === 'unreadable') return { ok: false, why: 'failed' };
      return { ok: true, value: opts.attempts };
    },
    append: async (pr, attempt) => {
      opts.appendCalls?.push({ pr, headSha: attempt.headSha });
      return opts.appendOk === false ? { ok: false, why: 'failed' } : { ok: true, value: undefined };
    },
  }),
  freshAgents: () => ({
    rowsFor: async () => ({ ok: true, value: Array.from({ length: opts.freshRows ?? 0 }, () => ({}) as never) }),
  }),
  readEndingFile: () => (opts.endingText === undefined ? null : opts.endingText),
  readRoleFile: () => (opts.roleText === undefined ? FIXER_MD : opts.roleText),
  agentRun: () => ({
    run: (request) => {
      const outcome = opts.agentRunOutcome ?? 'starts';
      if (outcome === 'rejects') return Promise.reject(new Error('spawn failed'));
      if (outcome === 'never-spawns') return Promise.resolve({ ok: false, why: 'failed' } as never);
      if (outcome === 'exits-unstarted') return Promise.resolve({ ok: true, value: undefined } as never);
      const pid = 9000 + (opts.agentRunStarts?.length ?? 0) + 1;
      opts.agentRunStarts?.push({ pid });
      request.onStarted?.(pid);
      return Promise.resolve({ ok: true, value: undefined } as never);
    },
  }),
});

const fixture = () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autofix-'));
  made.push(repoRoot);
  return { repoRoot, scriptsDir: repoRoot };
};

describe('fixerTick', () => {
  it('starts the fixer for a HIGH finding on the current head', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const appendCalls: { pr: number; headSha: string }[] = [];
    const w = world({ agentRunStarts: starts, appendCalls });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'fixer', head: HEAD, evidence: 'high' });
    expect(result!.started).toEqual({ started: true, pid: 9001 });
    expect(starts).toHaveLength(1);
    expect(appendCalls).toEqual([{ pr: 7, headSha: HEAD }]);
  });

  it('does not start on a HIGH finding whose head has gone stale', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const row = { ...highRow, plotReviewSha: OTHER_HEAD };
    const starts: { pid: number }[] = [];
    const w = world({ agentRunStarts: starts });
    const [result] = await fixerTick([row], baseReadings, { repoRoot, scriptsDir }, w);
    // slicePrNext falls through to reviewArm's own `none` when every arm
    // answers none (autoReview is off here) — so only the tick-level
    // behavior is asserted, not the discarded arm-specific reason.
    expect(result!.step.step).not.toBe('fixer');
    expect(starts).toHaveLength(0);
    expect(result!.started).toBeUndefined();
  });

  it('refuses the start, with no spawn, when the attempt append fails', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ appendOk: false, agentRunStarts: starts });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'append-failed' });
    expect(starts).toHaveLength(0);
  });

  it('refuses the start when the host reports the head moved since the row was read', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ prState: { number: 7, state: 'OPEN', headSha: OTHER_HEAD }, agentRunStarts: starts });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'head-moved' });
    expect(starts).toHaveLength(0);
  });

  it('refuses the start when the PR closed since the row was read', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ prState: { number: 7, state: 'CLOSED', headSha: HEAD } });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'pr-not-open' });
  });

  it('starts on CI red once the desk is dead', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'failed', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    expect(result!.started).toEqual({ started: true, pid: 9001 });
  });

  // `ciRedArm`'s own `none('desk-alive')` is never the step `slicePrNext`
  // returns for these two cases: no arm answers non-none, so (by design —
  // "the review arm's `none` is returned, because it names the reason")
  // `reviewArm`'s own `none` surfaces instead. `highArm`/`ciRedArm` are still
  // exercised directly in the domain's own `slice-pr-next.test.ts`; what this
  // tick-level test proves is that no start happens.
  it('starts nothing on CI red while the desk is alive, mid-turn', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'running', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step.step).not.toBe('fixer');
    expect(starts).toHaveLength(0);
  });

  it('starts nothing on CI red for a desk waiting on something other than corrections-spent', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'waiting', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step.step).not.toBe('fixer');
    expect(starts).toHaveLength(0);
  });

  it('starts on CI red for a desk waiting with corrections spent and no fresh session left', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const ending = JSON.stringify({ reason: 'corrections-spent', actor: 'agent' });
    const w = world({
      deskPath: path.join(repoRoot, 'desk'),
      workerState: 'waiting',
      endingText: ending,
      freshRows: 1,
      agentRunStarts: starts,
    });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    expect(starts).toHaveLength(1);
  });

  it('holds on CI red once the attempts budget is exhausted', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const record: FixerAttemptsRecord = {
      v: 1,
      pr: 7,
      attempts: [
        { headSha: HEAD, finding: { kind: 'ci', runId: HEAD } },
        { headSha: HEAD, finding: { kind: 'ci', runId: HEAD } },
      ],
    };
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'failed', attempts: record });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'hold', reason: 'ci-red-attempts-spent' });
    expect(result!.started).toBeUndefined();
  });

  it('holds with an unread fixer record while the attempts store is unreadable', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'failed', attempts: 'unreadable' });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'hold', reason: 'unread' });
  });

  it('starts normally on a PR with no prior fixer attempt', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: { pid: number }[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'failed', attempts: 'none', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    expect(starts).toHaveLength(1);
  });

  it('returns once the process launches, without waiting on the run to finish', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world();
    const startedAt = Date.now();
    const results = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(results[0]!.started).toEqual({ started: true, pid: 9001 });
  });

  it('refuses the start with the connector reason when the run could not be started', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ agentRunOutcome: 'never-spawns' });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'failed' });
  });

  it('refuses the start by name when the process reports ok but never calls onStarted', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ agentRunOutcome: 'exits-unstarted' });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'command-exited-unstarted' });
  });

  it('refuses the start with the rejection message when the run call itself throws', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ agentRunOutcome: 'rejects' });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'spawn failed' });
  });

  it('refuses the start when the worktree cannot be created', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ addBranchOk: false });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'worktree-failed' });
  });

  it('refuses the start when the role file cannot be read', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ roleText: null });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'role-files-failed' });
  });
});

describe('deskDeadFromWorkerState', () => {
  it('reads elsewhere, waiting and running as not dead, and the rest as dead', () => {
    expect(deskDeadFromWorkerState('elsewhere')).toEqual({ dead: false, why: 'elsewhere' });
    expect(deskDeadFromWorkerState('waiting')).toEqual({ dead: false, why: 'waiting' });
    expect(deskDeadFromWorkerState('running')).toEqual({ dead: false, why: 'live' });
    expect(deskDeadFromWorkerState('finished')).toEqual({ dead: true });
    expect(deskDeadFromWorkerState('failed')).toEqual({ dead: true });
    expect(deskDeadFromWorkerState('ended')).toEqual({ dead: true });
    expect(deskDeadFromWorkerState('none')).toEqual({ dead: true });
  });
});

describe('fixerRunDir', () => {
  it('names a worktree inside the repo, under .plot/fixer/<pr>', () => {
    expect(fixerRunDir('/repo', 7)).toBe(path.join('/repo', '.plot', 'fixer', '7'));
  });
});

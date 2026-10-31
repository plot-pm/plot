// The fixer tick: fleetd's own HIGH/CI-red arm starts. `highArm`/`ciRedArm`
// pick the step; this tick supplies their readings from the worker table,
// the ending file and the attempts record, then carries out a `fixer` step:
// it re-asks the host, creates a detached worktree at the head, records the
// attempt with its in-flight mark, launches the role with a prompt, and logs
// each step. A later tick clears the mark and removes the worktree once the
// fixer's process has ended.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FixerAttempt, FixerAttemptsRecord, FixerInFlight } from '@plot-pm/domain/entities/fixer-attempts';
import type { PidCheck } from '@plot-pm/domain/rules/role-run-alive';
import { runLogFixture } from '@plot-pm/domain/adapters';
import { execFileSync } from 'node:child_process';
import { treesGit } from '@plot-pm/domain/adapters';
import { removeTree as rmTree } from '../rm-tree.mjs';
import { takeContinueLock, releaseContinueLock } from '../../src/shared/continue-lock.js';
import {
  fixerTick,
  deskDeadFromWorkerState,
  fixerRunDir,
  fixerLockDir,
  runAutoFixerPass,
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
const FINDINGS = '**HIGH 1: nothing calls fixerTick.**\n';

const baseRow: PrIndexRow = {
  number: 7,
  head: 'feature/x',
  state: 'OPEN',
  draft: false,
  checks: 'green',
  review: '',
  url: 'https://host/pr/7',
  headSha: HEAD,
};

const highRow: PrIndexRow = { ...baseRow, plotReview: 'failure', plotReviewSha: HEAD };
const ciRedRow: PrIndexRow = { ...baseRow, ciChecks: 'failing', checksSha: HEAD, failing_checks: ['unit', 'lint'] };

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
  /** The attempts record the store starts with; the store keeps what the tick writes. */
  attempts?: FixerAttemptsRecord | 'none' | 'unreadable';
  appendOk?: boolean;
  appendCalls?: { pr: number; headSha: string }[];
  markOk?: boolean;
  markCalls?: { pr: number; index: number; mark: FixerInFlight | null }[];
  prState?: { number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; headSha?: string } | null | 'fail';
  addOk?: boolean;
  roleText?: string | null;
  /** The verdict file's text; `null` for a file that cannot be read. */
  verdictText?: string | null;
  verdictFiles?: string[];
  pidCheck?: (pid: string) => PidCheck;
  agentRunStarts?: { pid: number; prompt: string; worktree: string }[];
  /** How the started agent run settles: launches a pid, or fails to spawn at all. */
  agentRunOutcome?: 'starts' | 'never-spawns' | 'exits-unstarted' | 'rejects';
  /** Every path `add` was asked to create, with its start. */
  addCalls?: string[];
  /** Every path `removeOnly` was asked to remove. */
  removeCalls?: string[];
  /** Every call that changed something, in order. */
  order?: string[];
}

const STARTER_PID = 4100;

type Started = NonNullable<WorldOptions['agentRunStarts']>[number];

const world = (opts: WorldOptions = {}): FixerTickWorld => {
  let record: FixerAttemptsRecord | 'none' | 'unreadable' = opts.attempts ?? 'none';
  return {
    trees: () => ({
      forBranch: async () =>
        opts.deskPath === undefined || opts.deskPath === null
          ? { ok: true, value: null }
          : { ok: true, value: { path: opts.deskPath, branch: 'feature/x', detached: false } },
      // Behaves like `git worktree add --detach`: refuses a target that exists
      // and is not empty, and leaves a `.git` file in the tree it creates.
      add: async (dir, start) => {
        opts.addCalls?.push(`${dir}@${start}`);
        opts.order?.push('add');
        if (opts.addOk === false) return { ok: false, why: 'failed' };
        if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) return { ok: false, why: 'failed' };
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere\n');
        return { ok: true, value: undefined };
      },
      fetch: async () => ({ ok: true, value: undefined }),
      prune: async () => ({ ok: true, value: undefined }),
      removeOnly: async (dir) => {
        opts.removeCalls?.push(dir);
        opts.order?.push('remove');
        rmTree(dir);
        return { ok: true, value: undefined };
      },
    }),
    host: () => ({
      prState: async () => {
        opts.order?.push('host');
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
      read: async () => (record === 'unreadable' ? { ok: false, why: 'failed' } : { ok: true, value: record }),
      append: async (pr, attempt) => {
        opts.appendCalls?.push({ pr, headSha: attempt.headSha });
        opts.order?.push('append');
        if (opts.appendOk === false || record === 'unreadable') return { ok: false, why: 'failed' };
        const attempts: FixerAttempt[] = record === 'none' ? [] : record.attempts;
        record = { v: 1, pr, attempts: [...attempts, attempt] };
        return { ok: true, value: undefined };
      },
      markInFlight: async (pr, index, mark) => {
        opts.markCalls?.push({ pr, index, mark });
        opts.order?.push(mark === null ? 'clear' : 'mark');
        if (opts.markOk === false || record === 'none' || record === 'unreadable') return { ok: false, why: 'failed' };
        const target = record.attempts[index];
        if (target === undefined) return { ok: false, why: 'failed' };
        const kept: FixerAttempt = { headSha: target.headSha, finding: target.finding };
        const changed: FixerAttempt = mark === null ? kept : { ...kept, inFlight: mark };
        record = { ...record, attempts: record.attempts.map((a, at) => (at === index ? changed : a)) };
        return { ok: true, value: undefined };
      },
    }),
    freshAgents: () => ({
      rowsFor: async () => ({ ok: true, value: Array.from({ length: opts.freshRows ?? 0 }, () => ({}) as never) }),
    }),
    readEndingFile: () => (opts.endingText === undefined ? null : opts.endingText),
    readRoleFile: () => (opts.roleText === undefined ? FIXER_MD : opts.roleText),
    readVerdictFile: (file) => {
      opts.verdictFiles?.push(file);
      return opts.verdictText === undefined ? FINDINGS : opts.verdictText;
    },
    pidCheck: opts.pidCheck ?? (() => 'alive'),
    starterPid: STARTER_PID,
    agentRun: () => ({
      run: (request) => {
        const outcome = opts.agentRunOutcome ?? 'starts';
        opts.order?.push('launch');
        if (outcome === 'rejects') return Promise.reject(new Error('spawn failed'));
        if (outcome === 'never-spawns') return Promise.resolve({ ok: false, why: 'failed' } as never);
        if (outcome === 'exits-unstarted') return Promise.resolve({ ok: true, value: undefined } as never);
        const pid = 9000 + (opts.agentRunStarts?.length ?? 0) + 1;
        opts.agentRunStarts?.push({ pid, prompt: request.prompt, worktree: request.worktree });
        request.onStarted?.(pid);
        // THE RUN NEVER ENDS here: a tick that awaited it would never return.
        return new Promise<never>(() => undefined);
      },
    }),
  };
};

const fixture = () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autofix-'));
  made.push(repoRoot);
  return { repoRoot, scriptsDir: repoRoot, runLog: runLogFixture() };
};

describe('fixerTick', () => {
  it('starts the fixer for a HIGH finding on the current head', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: Started[] = [];
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
    const starts: Started[] = [];
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
    const starts: Started[] = [];
    const w = world({ appendOk: false, agentRunStarts: starts });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'append-failed' });
    expect(starts).toHaveLength(0);
  });

  it('refuses the start when the host reports the head moved since the row was read', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: Started[] = [];
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
    const starts: Started[] = [];
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
    const starts: Started[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'running', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step.step).not.toBe('fixer');
    expect(starts).toHaveLength(0);
  });

  it('starts nothing on CI red for a desk waiting on something other than corrections-spent', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: Started[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'waiting', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step.step).not.toBe('fixer');
    expect(starts).toHaveLength(0);
  });

  it('starts on CI red for a desk waiting with corrections spent and no fresh session left', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const starts: Started[] = [];
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
    const starts: Started[] = [];
    const w = world({ deskPath: path.join(repoRoot, 'desk'), workerState: 'failed', attempts: 'none', agentRunStarts: starts });
    const [result] = await fixerTick([ciRedRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.step).toEqual({ step: 'fixer', head: HEAD, evidence: 'ci-red' });
    expect(starts).toHaveLength(1);
  });

  it('returns once the process launches, while the run is still going', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const results = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world());
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
    const w = world({ addOk: false });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'worktree-failed' });
  });

  it('refuses the start when the role file cannot be read', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const w = world({ roleText: null });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: false, why: 'role-files-failed' });
  });

  it('creates the worktree at a run directory that does not exist yet, and leaves no lock behind', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const addCalls: string[] = [];
    const w = world({ addCalls });
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, w);
    expect(result!.started).toEqual({ started: true, pid: 9001 });
    expect(addCalls).toEqual([`${fixerRunDir(repoRoot, 7)}@${HEAD}`]);
    expect(fs.readdirSync(fixerRunDir(repoRoot, 7))).toEqual(['.git']);
    expect(fs.readdirSync(fixerLockDir(repoRoot, 7))).toEqual([]);
  });

  it('refuses the start as lock-held while another start holds the PR lock', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const lockDir = fixerLockDir(repoRoot, 7);
    fs.mkdirSync(lockDir, { recursive: true });
    const held = takeContinueLock(lockDir);
    expect(held).not.toBeNull();
    try {
      const addCalls: string[] = [];
      const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world({ addCalls }));
      expect(result!.started).toEqual({ started: false, why: 'lock-held' });
      expect(addCalls).toEqual([]);
    } finally {
      releaseContinueLock(lockDir, held!);
    }
  });

  it('starts over a run directory an earlier failed start left empty or holding only its lock files', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const runDir = fixerRunDir(repoRoot, 7);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, '.plot-worker.continue.lock'), 'stale');
    fs.writeFileSync(path.join(runDir, '.plot-worker.continue.lock.guard'), '');
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world());
    expect(result!.started).toEqual({ started: true, pid: 9001 });
    expect(fs.readdirSync(runDir)).toEqual(['.git']);
  });

  it('refuses the start as worktree-leftover where the run directory holds anything else, and removes nothing', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const runDir = fixerRunDir(repoRoot, 7);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, '.git'), 'gitdir: elsewhere\n');
    const addCalls: string[] = [];
    const removeCalls: string[] = [];
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world({ addCalls, removeCalls }));
    expect(result!.started).toEqual({ started: false, why: 'worktree-leftover' });
    expect(addCalls).toEqual([]);
    expect(removeCalls).toEqual([]);
    expect(fs.readdirSync(runDir)).toEqual(['.git']);
  });

  it('removes the worktree it created when the start fails after creating it, so the next start succeeds', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const removeCalls: string[] = [];
    const [failed] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world({ appendOk: false, removeCalls }));
    expect(failed!.started).toEqual({ started: false, why: 'append-failed' });
    expect(removeCalls).toEqual([fixerRunDir(repoRoot, 7)]);
    expect(fs.existsSync(fixerRunDir(repoRoot, 7))).toBe(false);

    const [retried] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world());
    expect(retried!.started).toEqual({ started: true, pid: 9001 });
  });

  it('removes nothing when the start fails before it created the worktree', async () => {
    const { repoRoot, scriptsDir } = fixture();
    const removeCalls: string[] = [];
    const [result] = await fixerTick([highRow], baseReadings, { repoRoot, scriptsDir }, world({ prState: 'fail', removeCalls }));
    expect(result!.started).toEqual({ started: false, why: 'unaskable' });
    expect(removeCalls).toEqual([]);
  });
});

describe('fixerTick logs each step to the run log', () => {
  it('logs a started fixer as fixer-start, moved', async () => {
    const opts = fixture();
    await fixerTick([highRow], baseReadings, opts, world());
    expect(opts.runLog.lines).toEqual([
      { plan: '', branch: 'feature/x', pr: '7', head: HEAD, step: 'fixer-start', outcome: 'moved', at: new Date(NOW).toISOString() },
    ]);
  });

  it('logs a refused start once per PR, head and reason, across ticks', async () => {
    const opts = fixture();
    const logged = new Set<string>();
    const w = world({ prState: { number: 7, state: 'CLOSED', headSha: HEAD } });
    await fixerTick([highRow], baseReadings, opts, w, logged);
    await fixerTick([highRow], baseReadings, opts, w, logged);
    expect(opts.runLog.lines.map((l) => [l.step, l.outcome])).toEqual([['fixer-start', 'failed: pr-not-open']]);
  });

  it('logs nothing for a row whose step is not a fixer start', async () => {
    const opts = fixture();
    await fixerTick([baseRow], baseReadings, opts, world());
    expect(opts.runLog.lines).toEqual([]);
  });
});

describe('runAutoFixerPass', () => {
  it('runs the fixer tick over the rows its reading returns', async () => {
    const opts = fixture();
    const starts: Started[] = [];
    const results = await runAutoFixerPass(opts, new Set(), NOW, world({ agentRunStarts: starts }), async () => ({
      rows: [highRow],
      readings: baseReadings,
    }));
    expect(results?.map((r) => r.started)).toEqual([{ started: true, pid: 9001 }]);
    expect(starts).toHaveLength(1);
  });

  it('starts nothing where the reading has nothing to act on', async () => {
    const opts = fixture();
    const starts: Started[] = [];
    expect(await runAutoFixerPass(opts, new Set(), NOW, world({ agentRunStarts: starts }), async () => null)).toBeNull();
    expect(starts).toHaveLength(0);
  });
});

describe('fixerTick keeps one fixer per PR', () => {
  it('records the attempt with an in-flight mark before the launch, then marks the fixer pid', async () => {
    const opts = fixture();
    const order: string[] = [];
    const markCalls: { pr: number; index: number; mark: FixerInFlight | null }[] = [];
    await fixerTick([highRow], baseReadings, opts, world({ order, markCalls }));
    expect(order).toEqual(['host', 'add', 'append', 'launch', 'mark']);
    expect(markCalls).toEqual([{ pr: 7, index: 0, mark: { pid: 9001, startedAt: new Date(NOW).toISOString() } }]);
  });

  it('holds a second tick while the fixer runs, and spends no second attempt', async () => {
    const opts = fixture();
    const starts: Started[] = [];
    const appendCalls: { pr: number; headSha: string }[] = [];
    const w = world({ agentRunStarts: starts, appendCalls });
    await fixerTick([highRow], baseReadings, opts, w);
    const [second] = await fixerTick([highRow], baseReadings, opts, w);
    expect(second!.step).toEqual({ step: 'hold', reason: 'fixer-in-flight' });
    expect(second!.started).toBeUndefined();
    expect(appendCalls).toHaveLength(1);
    expect(starts).toHaveLength(1);
  });

  it('holds while the starter pid stands in for a fixer whose pid was not recorded', async () => {
    const opts = fixture();
    const appendCalls: { pr: number; headSha: string }[] = [];
    const w = world({ markOk: false, appendCalls });
    await fixerTick([highRow], baseReadings, opts, w);
    const [second] = await fixerTick([highRow], baseReadings, opts, w);
    expect(second!.step).toEqual({ step: 'hold', reason: 'fixer-in-flight' });
    expect(appendCalls).toHaveLength(1);
  });

  it('once the fixer has ended, removes its worktree, clears the mark, logs fixer-end, and can start attempt 2', async () => {
    const opts = fixture();
    let check: PidCheck = 'alive';
    const removeCalls: string[] = [];
    const appendCalls: { pr: number; headSha: string }[] = [];
    const starts: Started[] = [];
    const w = world({ pidCheck: () => check, removeCalls, appendCalls, agentRunStarts: starts });
    await fixerTick([highRow], baseReadings, opts, w);
    expect(fs.existsSync(fixerRunDir(opts.repoRoot, 7))).toBe(true);

    check = 'dead';
    const [second] = await fixerTick([highRow], baseReadings, opts, w);
    expect(removeCalls).toEqual([fixerRunDir(opts.repoRoot, 7)]);
    expect(second!.started).toEqual({ started: true, pid: 9002 });
    expect(appendCalls).toHaveLength(2);
    expect(opts.runLog.lines.map((l) => [l.step, l.outcome])).toEqual([
      ['fixer-start', 'moved'],
      ['fixer-end', 'moved'],
      ['fixer-start', 'moved'],
    ]);

    const [third] = await fixerTick([highRow], baseReadings, opts, w);
    expect(third!.step.step).not.toBe('fixer');
    expect(appendCalls).toHaveLength(2);
    expect(starts).toHaveLength(2);
  });

  it('keeps the fixer in flight while the process table cannot answer for its pid', async () => {
    const opts = fixture();
    const removeCalls: string[] = [];
    const w = world({ pidCheck: () => 'unanswerable', removeCalls });
    await fixerTick([highRow], baseReadings, opts, w);
    const [second] = await fixerTick([highRow], baseReadings, opts, w);
    expect(second!.step).toEqual({ step: 'hold', reason: 'fixer-in-flight' });
    expect(removeCalls).toEqual([]);
  });

  it('spends no attempt on a refusal before the launch', async () => {
    for (const refusal of [
      { prState: { number: 7, state: 'CLOSED' as const, headSha: HEAD }, why: 'pr-not-open' },
      { prState: { number: 7, state: 'OPEN' as const, headSha: OTHER_HEAD }, why: 'head-moved' },
      { prState: 'fail' as const, why: 'unaskable' },
      { addOk: false, why: 'worktree-failed' },
      { roleText: null, why: 'role-files-failed' },
      { verdictText: null, why: 'findings-unread' },
      { verdictText: '  \n', why: 'findings-empty' },
    ]) {
      const opts = fixture();
      const appendCalls: { pr: number; headSha: string }[] = [];
      const { why, ...options } = refusal;
      const [result] = await fixerTick([highRow], baseReadings, opts, world({ ...options, appendCalls }));
      expect(result!.started).toEqual({ started: false, why });
      expect(appendCalls).toEqual([]);
    }
  });

  it('spends the attempt and clears its mark when the launch never starts a process', async () => {
    const opts = fixture();
    const appendCalls: { pr: number; headSha: string }[] = [];
    const markCalls: { pr: number; index: number; mark: FixerInFlight | null }[] = [];
    const removeCalls: string[] = [];
    const w = world({ agentRunOutcome: 'never-spawns', appendCalls, markCalls, removeCalls });
    const [result] = await fixerTick([highRow], baseReadings, opts, w);
    expect(result!.started).toEqual({ started: false, why: 'failed' });
    expect(appendCalls).toHaveLength(1);
    expect(markCalls).toEqual([{ pr: 7, index: 0, mark: null }]);
    expect(removeCalls).toEqual([fixerRunDir(opts.repoRoot, 7)]);
    const [next] = await fixerTick([highRow], baseReadings, opts, w);
    expect(next!.started).toEqual({ started: false, why: 'failed' });
    expect(appendCalls).toHaveLength(2);
  });

  it('marks the attempt it appended, after earlier attempts in the record', async () => {
    const opts = fixture();
    const markCalls: { pr: number; index: number; mark: FixerInFlight | null }[] = [];
    const record: FixerAttemptsRecord = { v: 1, pr: 7, attempts: [{ headSha: OTHER_HEAD, finding: { kind: 'high', hash: 'h' } }] };
    await fixerTick([highRow], baseReadings, opts, world({ attempts: record, markCalls }));
    expect(markCalls.map((c) => c.index)).toEqual([1]);
  });
});

describe('fixerTick gives the fixer its evidence', () => {
  it('starts a HIGH fixer with the PR, its head and the review findings of that head', async () => {
    const opts = fixture();
    const starts: Started[] = [];
    const verdictFiles: string[] = [];
    await fixerTick([highRow], baseReadings, opts, world({ agentRunStarts: starts, verdictFiles }));
    expect(verdictFiles).toEqual([path.join(opts.repoRoot, '.git', 'plot', 'state', 'reviews', `7-${HEAD}.md`)]);
    const prompt = starts[0]!.prompt;
    expect(prompt).toContain('pull request #7 (https://host/pr/7)');
    expect(prompt).toContain(`head ${HEAD}`);
    expect(prompt).toContain('`git push origin HEAD:feature/x`');
    expect(prompt).toContain(FINDINGS.trim());
  });

  it('starts a CI-red fixer with the failing checks, and reads no verdict file', async () => {
    const opts = fixture();
    const starts: Started[] = [];
    const verdictFiles: string[] = [];
    const w = world({ deskPath: path.join(opts.repoRoot, 'desk'), workerState: 'failed', agentRunStarts: starts, verdictFiles });
    await fixerTick([ciRedRow], baseReadings, opts, w);
    expect(starts[0]!.prompt).toContain('The failing checks: unit, lint.');
    expect(verdictFiles).toEqual([]);
  });

  it('refuses a HIGH start whose findings cannot be read before it asks the host', async () => {
    const opts = fixture();
    const order: string[] = [];
    const [result] = await fixerTick([highRow], baseReadings, opts, world({ verdictText: null, order }));
    expect(result!.started).toEqual({ started: false, why: 'findings-unread' });
    expect(order).toEqual([]);
  });
});

describe('fixerTick against a real git repository', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    }).trim();

  const repo = () => {
    const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-autofix-git-')));
    made.push(repoRoot);
    git(repoRoot, 'init', '-q', '-b', 'main');
    git(repoRoot, 'commit', '-q', '--allow-empty', '-m', 'init');
    const head = git(repoRoot, 'rev-parse', 'HEAD');
    return { repoRoot, head };
  };

  const realWorld = (repoRoot: string, head: string, options: WorldOptions = {}): FixerTickWorld => {
    const fake = world({ prState: { number: 7, state: 'OPEN', headSha: head }, ...options });
    const real = treesGit({ repoRoot, scriptDir: repoRoot });
    return { ...fake, trees: (o) => ({ ...real, forBranch: fake.trees(o).forBranch }) };
  };

  it('creates the fixer worktree detached at the head, and removes it after a failed start so a retry succeeds', async () => {
    const { repoRoot, head } = repo();
    const row: PrIndexRow = { ...highRow, headSha: head, plotReviewSha: head };
    const runDir = fixerRunDir(repoRoot, 7);
    const opts = { repoRoot, scriptsDir: repoRoot, runLog: runLogFixture() };

    const [failed] = await fixerTick([row], baseReadings, opts, realWorld(repoRoot, head, { appendOk: false }));
    expect(failed!.step).toEqual({ step: 'fixer', head, evidence: 'high' });
    expect(failed!.started).toEqual({ started: false, why: 'append-failed' });
    expect(fs.existsSync(runDir)).toBe(false);

    const [started] = await fixerTick([row], baseReadings, opts, realWorld(repoRoot, head));
    expect(started!.started).toEqual({ started: true, pid: 9001 });
    expect(git(runDir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    expect(git(runDir, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('starts a CI-red fixer while the dead desk worktree still holds the branch', async () => {
    const { repoRoot, head } = repo();
    const desk = path.join(repoRoot, '.worktrees', 'desk-x');
    git(repoRoot, 'worktree', 'add', '-q', '-b', 'feature/x', desk, head);
    // THE GIT REFUSAL THE START MUST NOT DEPEND ON: a second worktree cannot take the branch.
    expect(() => git(repoRoot, 'worktree', 'add', '-q', '-B', 'feature/x', path.join(repoRoot, 'other'), head)).toThrow();

    const row: PrIndexRow = { ...ciRedRow, headSha: head, checksSha: head };
    const opts = { repoRoot, scriptsDir: repoRoot, runLog: runLogFixture() };
    const starts: Started[] = [];
    const w = realWorld(repoRoot, head, { deskPath: desk, workerState: 'failed', agentRunStarts: starts });
    const [result] = await fixerTick([row], baseReadings, opts, w);
    expect(result!.step).toEqual({ step: 'fixer', head, evidence: 'ci-red' });
    expect(result!.started).toEqual({ started: true, pid: 9001 });
    const runDir = fixerRunDir(repoRoot, 7);
    expect(starts[0]!.worktree).toBe(runDir);
    expect(git(runDir, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(desk, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/x');
  });

  it('removes the ended fixer worktree through git, so the next start can create it again', async () => {
    const { repoRoot, head } = repo();
    const row: PrIndexRow = { ...highRow, headSha: head, plotReviewSha: head };
    const opts = { repoRoot, scriptsDir: repoRoot, runLog: runLogFixture() };
    let check: PidCheck = 'alive';
    const starts: Started[] = [];
    const w = realWorld(repoRoot, head, { pidCheck: () => check, agentRunStarts: starts });
    await fixerTick([row], baseReadings, opts, w);
    check = 'dead';
    const [second] = await fixerTick([row], baseReadings, opts, w);
    expect(second!.started).toEqual({ started: true, pid: 9002 });
    expect(git(repoRoot, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length).toBe(2);
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

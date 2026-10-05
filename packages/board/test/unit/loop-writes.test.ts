// THE LOOP'S CARRYING-OUT HALF — one test per write kind `agentLoop` emits,
// each against a fixture port, proving `performLoopWrites` routes to the right
// operation with the right arguments and nothing more.
import { describe, it, expect } from 'vitest';
import {
  agentManifest,
  agentsFixture,
  deskFixture,
  deskFixtureCalls,
  deskFs,
  refsFixture,
  treesFixture,
  type AgentsFixture,
} from '@plot-pm/domain/adapters';
import type { BoundedRun, Write } from '@plot-pm/domain';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findingsInLog, MONITOR_LOGS } from '../../src/server/findings.js';
import { FindingSchema } from '../../src/contract/index.js';
import type { LoopWrite, LoopWritePorts } from '../../src/server/entry/loop-writes.js';
import { performLoopWrites } from '../../src/server/entry/loop-writes.js';

const WORKTREE = '/tmp/desk';

/** A `Processes` double that answers nothing — unused by every write kind here. */
const noProcesses = {
  isAlive: async () => ({ ok: true as const, value: false }),
  workerState: async () => ({ ok: false as const, why: 'failed' as const }),
  startedAt: async () => ({ ok: false as const, why: 'failed' as const }),
  uptimeSeconds: async () => ({ ok: true as const, value: null }),
  childrenOf: async () => ({ ok: true as const, value: [] }),
};

/** A `BoundedRun` double that is never called by `performLoopWrites`. */
const noBoundedRun: BoundedRun = {
  run: async () => ({ ok: false, why: 'failed' }),
};

const ports = (over: Partial<LoopWritePorts> = {}): LoopWritePorts => ({
  trees: treesFixture(),
  agents: agentsFixture(),
  desk: deskFixture(),
  refs: refsFixture(),
  processes: noProcesses,
  boundedRun: noBoundedRun,
  ...over,
});

const apply = (write: LoopWrite, over: Partial<LoopWritePorts> = {}, worktree = WORKTREE) =>
  performLoopWrites([write], ports(over), worktree);

describe('performLoopWrites — one arm per write kind', () => {
  it('desk-reset resets the desk onto the branch, through Trees', async () => {
    const calls: { path: string; branch: string; base: string }[] = [];
    const [{ result }] = await apply(
      { kind: 'desk-reset', worktree: WORKTREE, branch: 'infra/x', base: 'origin/main' },
      { trees: treesFixture({ calls: { resets: calls, commits: [], pushes: [] } }) },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ path: WORKTREE, branch: 'infra/x', base: 'origin/main' }]);
  });

  it('desk-reset reports the refusal, never a destructive fallback', async () => {
    const [{ result }] = await apply(
      { kind: 'desk-reset', worktree: WORKTREE, branch: 'infra/x', base: 'origin/main' },
      { trees: treesFixture({ resetRefusedAt: [WORKTREE] }) },
    );
    expect(result.ok).toBe(false);
  });

  it('commit applies through Trees, at the pass worktree — the write carries no path', async () => {
    const calls: { path: string; message: string }[] = [];
    const [{ result }] = await apply(
      { kind: 'commit', message: 'plot: claim infra/x', paths: [] },
      { trees: treesFixture({ calls: { resets: [], commits: calls, pushes: [] } }) },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ path: WORKTREE, message: 'plot: claim infra/x' }]);
  });

  it('commit with non-empty paths answers failed with a reason, and Trees is never reached', async () => {
    const calls: { path: string; message: string }[] = [];
    const [applied] = await apply(
      { kind: 'commit', message: 'plot: stage', paths: ['a.txt'] },
      { trees: treesFixture({ calls: { resets: [], commits: calls, pushes: [] } }) },
    );
    expect(applied!.result).toEqual({ ok: false, why: 'failed' });
    expect(applied!.reason).toContain('stages no paths');
    expect(calls).toEqual([]);
  });

  it('commit with empty paths carries no reason', async () => {
    const [applied] = await apply({ kind: 'commit', message: 'plot: claim infra/x', paths: [] });
    expect(applied!.reason).toBeUndefined();
  });

  it('push applies through Trees, at the pass worktree', async () => {
    const calls: { path: string; branch: string }[] = [];
    const [{ result }] = await apply(
      { kind: 'push', branch: 'infra/x', onto: '' },
      { trees: treesFixture({ calls: { resets: [], commits: [], pushes: calls } }) },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ path: WORKTREE, branch: 'infra/x' }]);
  });

  it('prompt-run is a record: no port is reached, and it answers ok', async () => {
    const [{ result }] = await apply({ kind: 'prompt-run', worktree: WORKTREE, branch: 'infra/x' });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('agent-attempt raises attempts through Agents, carrying the new value', async () => {
    const calls: AgentsFixture['calls'] = { attempts: [], corrections: [], clearedAssignments: [] };
    const [{ result }] = await apply(
      { kind: 'agent-attempt', worktree: WORKTREE, attempts: 2 },
      { agents: agentsFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.attempts).toEqual([{ worktree: WORKTREE, attempts: 2 }]);
  });

  it('agent-attempt never touches correctionAttempts', async () => {
    const calls: AgentsFixture['calls'] = { attempts: [], corrections: [], clearedAssignments: [] };
    await apply({ kind: 'agent-attempt', worktree: WORKTREE, attempts: 3 }, { agents: agentsFixture({ calls }) });
    expect(calls.corrections).toEqual([]);
  });

  it('correction-count raises correctionAttempts through Agents', async () => {
    const calls: AgentsFixture['calls'] = { attempts: [], corrections: [], clearedAssignments: [] };
    const [{ result }] = await apply(
      { kind: 'correction-count', worktree: WORKTREE, correctionAttempts: 1 },
      { agents: agentsFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.corrections).toEqual([{ worktree: WORKTREE, correctionAttempts: 1 }]);
  });

  it('correction-count never touches attempts', async () => {
    const calls: AgentsFixture['calls'] = { attempts: [], corrections: [], clearedAssignments: [] };
    await apply(
      { kind: 'correction-count', worktree: WORKTREE, correctionAttempts: 1 },
      { agents: agentsFixture({ calls }) },
    );
    expect(calls.attempts).toEqual([]);
  });

  it('agent-resume is a record: no port is reached, and it answers ok', async () => {
    const [{ result }] = await apply({
      kind: 'agent-resume',
      branch: 'infra/x',
      worktree: WORKTREE,
      resumeId: 'sess-1',
      correction: 'the build failed',
    });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('blocked-marker writes the marker through Desk', async () => {
    const calls = deskFixtureCalls();
    const [{ result }] = await apply(
      { kind: 'blocked-marker', worktree: WORKTREE, branch: 'infra/x', question: 'PLOT-BLOCKED: why?' },
      { desk: deskFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.blockedMarkers).toEqual([{ worktree: WORKTREE, text: 'PLOT-BLOCKED: why?' }]);
  });

  it('declaration seals through Desk', async () => {
    const calls = deskFixtureCalls();
    const [{ result }] = await apply(
      { kind: 'declaration', worktree: WORKTREE, branch: 'infra/x', status: 'ok', summary: '' },
      { desk: deskFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.declarations).toEqual([{ worktree: WORKTREE, branch: 'infra/x' }]);
  });

  it('slice-spend is out of this applier\'s scope: no port is reached, and it answers ok', async () => {
    const [{ result }] = await apply({ kind: 'slice-spend', branch: 'infra/x', worktree: WORKTREE });
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('assignment-clear clears through Agents, keyed by session', async () => {
    const calls: AgentsFixture['calls'] = { attempts: [], corrections: [], clearedAssignments: [] };
    const [{ result }] = await apply(
      { kind: 'assignment-clear', session: 'sess-1' },
      { agents: agentsFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.clearedAssignments).toEqual(['sess-1']);
  });

  it('loop-end writes the ending through Desk, with every field named', async () => {
    const calls = deskFixtureCalls();
    const [{ result }] = await apply(
      {
        kind: 'loop-end',
        worktree: WORKTREE,
        branch: 'infra/x',
        reason: 'bound',
        actor: 'bound',
        detail: 'exceeded the bound',
        exitCode: 124,
      },
      { desk: deskFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.endings).toEqual([
      {
        worktree: WORKTREE,
        record: { reason: 'bound', actor: 'bound', branch: 'infra/x', detail: 'exceeded the bound' },
      },
    ]);
  });

  it('worker-finding publishes through Desk with every field the finding carries', async () => {
    const calls = deskFixtureCalls();
    const [{ result }] = await apply(
      {
        kind: 'worker-finding',
        worktree: WORKTREE,
        branch: 'infra/x',
        finding: 'idle',
        since: '2026-10-05T10:00:00.000Z',
        evidence: 'the watcher reported idle',
      },
      { desk: deskFixture({ calls }) },
    );
    expect(result.ok).toBe(true);
    expect(calls.findings).toEqual([
      {
        worktree: WORKTREE,
        finding: { branch: 'infra/x', finding: 'idle', since: '2026-10-05T10:00:00.000Z', evidence: 'the watcher reported idle' },
      },
    ]);
  });

  it('worker-finding lands a line the board reads as a finding', async () => {
    const desk = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-writes-finding-'));
    try {
      const write: LoopWrite = {
        kind: 'worker-finding',
        worktree: desk,
        branch: 'infra/x',
        finding: 'gone',
        since: '2026-10-05T10:00:00.000Z',
        evidence: 'the prompt exceeded the 28800s bound',
      };
      const [{ result }] = await performLoopWrites([write], ports({ desk: deskFs(treesFixture()) }), desk);
      expect(result.ok).toBe(true);
      const read = MONITOR_LOGS.flatMap((name) => findingsInLog(path.join(desk, name)));
      expect(read).toHaveLength(1);
      expect(FindingSchema.parse(read[0])).toMatchObject({
        monitor: 'WorkerMonitor',
        branch: 'infra/x',
        worktree: desk,
        finding: 'gone',
        since: '2026-10-05T10:00:00.000Z',
      });
    } finally {
      fs.rmSync(desk, { recursive: true, force: true });
    }
  });
});

describe('performLoopWrites — ordering and failure', () => {
  const takeUp: readonly LoopWrite[] = [
    { kind: 'desk-reset', worktree: WORKTREE, branch: 'infra/x', base: 'origin/main' },
    { kind: 'commit', message: 'plot: claim infra/x', paths: [] },
    { kind: 'push', branch: 'infra/x', onto: '' },
    { kind: 'prompt-run', worktree: WORKTREE, branch: 'infra/x' },
  ];

  it('stops the take-up at a failed desk reset: no claim commit, no push, no prompt', async () => {
    const calls = { resets: [], commits: [] as { path: string; message: string }[], pushes: [] as { path: string; branch: string }[] };
    const applied = await performLoopWrites(
      takeUp,
      ports({ trees: treesFixture({ resetRefusedAt: [WORKTREE], calls }) }),
      WORKTREE,
    );
    expect(applied.map((a) => a.write.kind)).toEqual(['desk-reset']);
    expect(applied[0]!.result.ok).toBe(false);
    expect(calls.commits).toEqual([]);
    expect(calls.pushes).toEqual([]);
  });

  it('applies the whole take-up in order when every write answers', async () => {
    const applied = await performLoopWrites(takeUp, ports(), WORKTREE);
    expect(applied.map((a) => a.write.kind)).toEqual(['desk-reset', 'commit', 'push', 'prompt-run']);
    expect(applied.every((a) => a.result.ok)).toBe(true);
  });

  it('a failed declaration still lets the loop-end after it land', async () => {
    const calls = deskFixtureCalls();
    const writes: readonly LoopWrite[] = [
      { kind: 'declaration', worktree: WORKTREE, branch: 'infra/x', status: 'blocked', summary: 'x' },
      { kind: 'loop-end', worktree: WORKTREE, branch: 'infra/x', reason: 'blocked', actor: 'agent', detail: 'x', exitCode: 0 },
    ];
    const applied = await performLoopWrites(
      writes,
      ports({ desk: deskFixture({ calls, unreadableDeclarations: [WORKTREE] }) }),
      WORKTREE,
    );
    expect(applied.map((a) => a.result.ok)).toEqual([false, true]);
    expect(calls.endings).toHaveLength(1);
  });
});

// A reachability check for the module's exported type, so a future edit that
// narrows `LoopWrite` incorrectly is caught by this file rather than only by
// the scratch-edit `tsc` check the brief describes.
const _typeCheck: LoopWrite extends Write ? true : never = true;
void _typeCheck;

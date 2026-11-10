// fleetd writes the AgentMonitor's findings, and the worker wrapper runs the
// final pass when no fleetd heartbeat is live. `fixtures/agent-monitor-once.json`
// holds what `plot-agent-monitor.sh --once` wrote over the same four desks,
// recorded on this branch before the script was removed.
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agentsFs, refsGit, treesGit } from '@plot-pm/domain/adapters';
import { fleetdHeartbeatFile } from '@plot-pm/domain/adapters/fleetd-heartbeat/fleetd-heartbeat-file';
import { FLEETD_HEARTBEAT_VERSION } from '@plot-pm/domain/entities/fleetd-heartbeat';
import type { WorkerState } from '@plot-pm/domain/entities/fleet';
import { answered } from '@plot-pm/domain';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Processes } from '@plot-pm/domain/ports/processes';
import { realCommits } from '@plot-pm/domain/rules/empty-claim';
import type { BranchStageReadings } from '@plot-pm/domain/workflows/plan-walk-branches';
import { readDeskReadings, type DeskStageReadings } from '@plot-pm/domain/workflows/plan-walk-desks';

import { agentFindingsOver, wrapperFinalPass, wrapperFinalPassDeps } from '../../src/shared/agent-findings.js';
import { removeTree } from '../rm-tree.mjs';
import { buildAgentDesks, DESK_NAMES, HOST_PRS, masked, type AgentDesks, type DeskName } from './agent-desks.js';

const SCRIPTS = resolve(__dirname, '../../../../skills/plot/scripts');
const ONCE = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/agent-monitor-once.json'), 'utf8')) as Record<DeskName, string[]>;
const FINDINGS = '.plot-worker.monitor.agent.jsonl';

/** A host whose `prState` answers from {@link HOST_PRS}, recording each branch asked. */
const stubHost = (asked: string[]): Host =>
  ({
    prState: async (branch: string) => {
      asked.push(branch);
      const state = HOST_PRS[branch] ?? null;
      return answered(state === null ? null : { state, head: branch });
    },
  }) as unknown as Host;

/** The lines a desk's AgentMonitor file holds. */
const linesOf = (worktree: string): string[] => {
  const file = join(worktree, FINDINGS);
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
};

describe('the AgentMonitor findings fleetd writes', () => {
  let root = '';
  let built: AgentDesks;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'plot-agent-findings-'));
    built = buildAgentDesks(root);
  });

  afterAll(() => {
    if (root !== '') removeTree(root);
  });

  /** The walk's stages over the given desks: real desk reads, one worker state per desk, the listing's PR words. */
  const stages = async (
    set: AgentDesks,
    names: readonly DeskName[],
    state: WorkerState,
    pr: (branch: string) => string = (branch) => (HOST_PRS[branch] === null ? 'none' : 'OPEN'),
  ): Promise<[BranchStageReadings, DeskStageReadings]> => {
    const context = { repoRoot: set.repo, scriptDir: SCRIPTS };
    const refs = refsGit(context);
    const entries = await Promise.all(
      names.map(async (name) => {
        const { branch } = set.desks[name];
        const remote = await refs.commitSubjects(`origin/main..origin/${branch}`);
        const ahead = remote.ok ? realCommits(remote.value) : 0;
        const changed = ahead > 0 ? await refs.changedFiles(`origin/${branch}`, 'main') : answered<readonly string[]>([]);
        return {
          plan: 'docs/plans/p.md',
          branch,
          readings: { pr: pr(branch), realCommitsAhead: ahead, commitsAhead: ahead },
          landed: [],
          changedPaths: changed.ok ? changed.value : [],
        };
      }),
    );
    const branches = { mainSha: '', branches: entries } as unknown as BranchStageReadings;
    const processes = {
      workerState: async () => answered({ state, pid: '41', exitCode: state === 'running' ? '' : '0', activity: '' }),
    } as unknown as Processes;
    const desks = await readDeskReadings(treesGit(context), agentsFs(context), processes, branches);
    if (!desks.ok) throw new Error('the desk stage did not answer');
    return [branches, desks.value];
  };

  it('writes the same lines as plot-agent-monitor.sh --once over four desks, timestamps masked', async () => {
    const asked: string[] = [];
    const findings = agentFindingsOver({ repoRoot: built.repo, scriptDir: SCRIPTS }, () => undefined, Date.now, { desk: deskOf(), host: stubHost(asked) });
    await findings(...(await stages(built, DESK_NAMES, 'finished')));
    for (const name of DESK_NAMES) {
      const { worktree } = built.desks[name];
      expect(linesOf(worktree).map((line) => masked(line, worktree)), name).toEqual(ONCE[name]);
    }
    expect([...asked].sort()).toEqual(['feature/gate', 'feature/review']);
  });

  it('writes owes a review within one pass of the agent end, from one host pr-state, and none per pass without a licensed none', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'plot-agent-findings-solo-'));
    try {
      const solo = buildAgentDesks(fresh);
      const desk = solo.desks.review;
      const asked: string[] = [];
      const findings = agentFindingsOver({ repoRoot: solo.repo, scriptDir: SCRIPTS }, () => undefined, Date.now, { desk: deskOf(), host: stubHost(asked) });
      const unread = () => 'unreadable';
      await findings(...(await stages(solo, ['review'], 'running', unread)));
      expect(linesOf(desk.worktree)).toEqual([]);
      expect(asked).toEqual([]);
      await findings(...(await stages(solo, ['review'], 'finished', unread)));
      expect(linesOf(desk.worktree).map((l) => JSON.parse(l).finding)).toEqual(['owes a review']);
      expect(asked).toEqual([desk.branch]);
      await findings(...(await stages(solo, ['review'], 'finished', unread)));
      expect(linesOf(desk.worktree)).toHaveLength(1);
      expect(asked).toEqual([desk.branch]);
    } finally {
      removeTree(fresh);
    }
  });
});

/** The production desk adapter, over the desk's own git. */
const deskOf = () => wrapperFinalPassDeps({ repoRoot: tmpdir(), scriptDir: SCRIPTS }).ports.desk;

describe('the worker wrapper final pass', () => {
  const withDesk = async (run: (built: AgentDesks) => Promise<void>): Promise<void> => {
    const root = mkdtempSync(join(tmpdir(), 'plot-wrapper-final-'));
    try {
      await run(buildAgentDesks(root));
    } finally {
      removeTree(root);
    }
  };

  const depsFor = (worktree: string, asked: string[]) => {
    const deps = wrapperFinalPassDeps({ repoRoot: worktree, scriptDir: SCRIPTS });
    return { ...deps, ports: { ...deps.ports, host: stubHost(asked) } };
  };

  const beat = async (repo: string, beatAt: number): Promise<void> => {
    const written = await fleetdHeartbeatFile({ repoRoot: repo }).write({
      version: FLEETD_HEARTBEAT_VERSION,
      pid: process.pid,
      startedAt: beatAt,
      beatAt,
      generation: 0,
      bridgeAt: null,
      supervised: 'none',
      watchesWanted: 0,
      watchesArmed: 0,
      lastEventAt: null,
      lastSafetyNetAt: null,
      loops: {},
    });
    if (!written.ok) throw new Error('the heartbeat was not written');
  };

  it('writes owes a review once with no fleetd heartbeat', () =>
    withDesk(async ({ desks }) => {
      const { branch, worktree } = desks.review;
      const asked: string[] = [];
      expect((await wrapperFinalPass(depsFor(worktree, asked), { branch, worktree }))?.finding).toBe('owes a review');
      expect(await wrapperFinalPass(depsFor(worktree, asked), { branch, worktree })).toBeNull();
      expect(linesOf(worktree).map((l) => JSON.parse(l).finding)).toEqual(['owes a review']);
      expect(asked).toEqual([branch, branch]);
    }));

  it('writes owes a review with a stale heartbeat', () =>
    withDesk(async ({ repo, desks }) => {
      const { branch, worktree } = desks.review;
      await beat(repo, Date.now() - 3_600_000);
      expect((await wrapperFinalPass(depsFor(worktree, []), { branch, worktree }))?.finding).toBe('owes a review');
    }));

  it('writes nothing with a live heartbeat, and fleetd then writes it once', () =>
    withDesk(async ({ repo, desks }) => {
      const { branch, worktree } = desks.review;
      await beat(repo, Date.now());
      const asked: string[] = [];
      expect(await wrapperFinalPass(depsFor(worktree, asked), { branch, worktree })).toBeNull();
      expect(asked).toEqual([]);
      expect(linesOf(worktree)).toEqual([]);

      const findings = agentFindingsOver({ repoRoot: repo, scriptDir: SCRIPTS }, () => undefined, Date.now, { desk: deskOf(), host: stubHost(asked) });
      const branches = { mainSha: '', branches: [{ plan: 'p', branch, readings: { pr: 'unreadable', realCommitsAhead: 1 }, landed: [], changedPaths: ['done.txt'] }] } as unknown as BranchStageReadings;
      const reading = { branch, worktree, desk: { question: '', markers: [], pid: '', exit: '0' }, locked: false, unpushed: [], quietSeconds: 1, dirty: [] };
      await findings(branches, { mainSha: '', desks: [{ ...reading, process: { state: 'running', pid: '41', exitCode: '', activity: '' } }] });
      await findings(branches, { mainSha: '', desks: [{ ...reading, process: { state: 'finished', pid: '41', exitCode: '0', activity: '' } }] });
      await findings(branches, { mainSha: '', desks: [{ ...reading, process: { state: 'finished', pid: '41', exitCode: '0', activity: '' } }] });
      expect(linesOf(worktree).map((l) => JSON.parse(l).finding)).toEqual(['owes a review']);
      expect(asked).toEqual([branch]);
    }));

  it('runs no pass with no branch or no desk', async () => {
    const asked: string[] = [];
    expect(await wrapperFinalPass(depsFor(tmpdir(), asked), { branch: '', worktree: tmpdir() })).toBeNull();
    expect(await wrapperFinalPass(depsFor(tmpdir(), asked), { branch: 'feature/x', worktree: '' })).toBeNull();
    expect(asked).toEqual([]);
  });

  it('warns and goes on where a pass throws', async () => {
    const lines: string[] = [];
    const findings = agentFindingsOver({ repoRoot: tmpdir(), scriptDir: SCRIPTS }, (l) => lines.push(l), Date.now, {
      desk: deskOf(),
      host: { prState: async () => { throw new Error('boom'); } } as unknown as Host,
    });
    const branches = { mainSha: '', branches: [{ plan: 'p', branch: 'feature/x', readings: { pr: 'none', realCommitsAhead: 1 }, landed: [], changedPaths: [] }] } as unknown as BranchStageReadings;
    const desk = { branch: 'feature/x', worktree: '/nowhere', desk: { question: '', markers: [], pid: '', exit: null }, locked: false, unpushed: [], quietSeconds: 1, dirty: [], process: { state: 'ended' as const, pid: '', exitCode: '', activity: '' as const } };
    await findings(branches, { mainSha: '', desks: [desk] });
    expect(lines).toEqual(['plot-fleetd: the AgentMonitor findings were not written: boom\n']);
  });
});

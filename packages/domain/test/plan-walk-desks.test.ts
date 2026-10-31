import { describe, expect, it } from 'vitest';

import { agentDesk, agentsFixture } from '../src/adapters/agents/agents-fixture.js';
import { treesFixture, type TreesFixture } from '../src/adapters/trees/trees-fixture.js';
import { answered, failed, isAnswered } from '../src/port-result.js';
import type { Agents } from '../src/ports/agents.js';
import type { ProcessReading, Processes } from '../src/ports/processes.js';
import type { Trees } from '../src/ports/trees.js';
import type { PrReading } from '../src/rules/branch-state.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import { readDeskReadings } from '../src/workflows/plan-walk-desks.js';

const reading = (over: Partial<ProcessReading> = {}): ProcessReading => ({
  state: 'running',
  pid: '41',
  exitCode: '',
  activity: 'working',
  ...over,
});

/** A process table answering per worktree; an absent path fails. Records the `hasPr` it was asked. */
const processesOf = (table: Record<string, ProcessReading>, asked: Array<[string, boolean]> = []): Processes =>
  ({
    workerState: async (worktree: string, hasPr: boolean) => {
      asked.push([worktree, hasPr]);
      const found = table[worktree];
      return found === undefined ? failed<ProcessReading>() : answered(found);
    },
  }) as unknown as Processes;

const stageOf = (...branches: Array<[string, PrReading?]>): BranchStageReadings =>
  ({
    mainSha: 'm1',
    backend: 'github',
    origin: '',
    merges: [],
    added: new Map(),
    branches: branches.map(([branch, pr]) => ({
      plan: 'docs/plans/p.md',
      branch,
      readings: { pr: pr ?? 'none' },
      landed: [],
      changedPaths: [],
    })),
  }) as unknown as BranchStageReadings;

const world = (over: Partial<TreesFixture> = {}): Trees =>
  treesFixture({
    worktrees: [
      { path: '/repo', branch: 'main' },
      { path: '/w/a', branch: 'feature/a' },
      { path: '/w/b', branch: 'feature/b' },
    ],
    unpushed: { '/w/a': [], '/w/b': ['abc1234'] },
    quiet: { '/w/a': 12, '/w/b': 4000 },
    ...over,
  });

const desks = (): Agents =>
  agentsFixture({
    desks: {
      '/w/a': agentDesk({ pid: '41' }),
      '/w/b': agentDesk({ markers: ['PLOT-BLOCKED.md'], question: 'which schema?', pid: '', exit: '0' }),
    },
  });

const table = {
  '/w/a': reading(),
  '/w/b': reading({ state: 'ended', pid: '', exitCode: '0', activity: '' }),
};

const read = async (trees: Trees, agents: Agents, processes: Processes, stage: BranchStageReadings) => {
  const answer = await readDeskReadings(trees, agents, processes, stage);
  if (!isAnswered(answer)) throw new Error('readDeskReadings should answer');
  return answer.value;
};

describe('readDeskReadings — what each desk reads', () => {
  it('reads a live desk: worktree, running worker, no marker, nothing unpushed, quiet seconds raw', async () => {
    const out = await read(world(), desks(), processesOf(table), stageOf(['feature/a']));
    expect(out.mainSha).toBe('m1');
    expect(out.desks).toEqual([
      {
        branch: 'feature/a',
        worktree: '/w/a',
        desk: { question: '', markers: [], pid: '41', exit: null },
        process: table['/w/a'],
        locked: false,
        unpushed: [],
        quietSeconds: 12,
      },
    ]);
  });

  it('reads a dead worker with its exit record, unpushed commits and a PLOT-BLOCKED marker', async () => {
    const [only] = (await read(world(), desks(), processesOf(table), stageOf(['feature/b']))).desks;
    expect(only!.process.state).toBe('ended');
    expect(only!.desk).toEqual({ question: 'which schema?', markers: ['PLOT-BLOCKED.md'], pid: '', exit: '0' });
    expect(only!.unpushed).toEqual(['abc1234']);
    expect(only!.quietSeconds).toBe(4000);
  });

  it.each([['PLOT-BLOCKED.md'], ['PLOT-BLOCKED-2.md'], ['PLOT-BLOCKED.md', 'PLOT-BLOCKED-answer.md']])(
    'carries the marker variant %s',
    async (...markers) => {
      const agents = agentsFixture({ desks: { '/w/a': agentDesk({ markers, question: 'q' }) } });
      const [only] = (await read(world(), agents, processesOf(table), stageOf(['feature/a']))).desks;
      expect(only!.desk.markers).toEqual(markers);
    },
  );

  it('reads a held lock', async () => {
    const out = await read(world({ locked: ['/w/a'] }), desks(), processesOf(table), stageOf(['feature/a'], ['feature/b']));
    expect(out.desks.map((d) => [d.branch, d.locked])).toEqual([
      ['feature/a', true],
      ['feature/b', false],
    ]);
  });

  it('skips a branch with no worktree, the main checkout, a detached tree and a vanished one', async () => {
    const trees = world({
      worktrees: [
        { path: '/repo', branch: 'main' },
        { path: '/w/a', branch: 'feature/a', prunable: true },
        { path: '/w/b', branch: '', detached: true },
      ],
    });
    const out = await read(trees, desks(), processesOf(table), stageOf(['main'], ['feature/a'], ['feature/b'], ['feature/none']));
    expect(out.desks).toEqual([]);
  });

  it('reads a branch named by two plans once', async () => {
    const out = await read(world(), desks(), processesOf(table), stageOf(['feature/a'], ['feature/a']));
    expect(out.desks).toHaveLength(1);
  });

  it('tells the process table whether the branch has a PR', async () => {
    const asked: Array<[string, boolean]> = [];
    await read(world(), desks(), processesOf(table, asked), stageOf(['feature/a', 'OPEN'], ['feature/b', 'none']));
    expect(asked).toEqual([
      ['/w/a', true],
      ['/w/b', false],
    ]);
  });

  it('spells an uncountable unpushed list unknown rather than failing the beat', async () => {
    const out = await read(world({ unpushed: {} }), desks(), processesOf(table), stageOf(['feature/a']));
    expect(out.desks[0]!.unpushed).toBe('unknown');
  });
});

describe('readDeskReadings — an unreadable snapshot fails the beat', () => {
  const stage = stageOf(['feature/a'], ['feature/b']);

  it('fails when the worktree listing cannot be read', async () => {
    const trees = { ...world(), list: async () => failed<never>() } as unknown as Trees;
    expect(await readDeskReadings(trees, desks(), processesOf(table), stage)).toEqual(failed());
  });

  it('fails when one desk cannot be read, however many others can', async () => {
    const agents = agentsFixture({ desks: { '/w/a': agentDesk() } });
    expect(await readDeskReadings(world(), agents, processesOf(table), stage)).toEqual(failed());
  });

  it('fails when one worker state cannot be read', async () => {
    expect(await readDeskReadings(world(), desks(), processesOf({ '/w/a': reading() }), stage)).toEqual(failed());
  });

  it('fails when a lock reading fails', async () => {
    const trees = { ...world(), locked: async () => failed<boolean>() } as unknown as Trees;
    expect(await readDeskReadings(trees, desks(), processesOf(table), stage)).toEqual(failed());
  });

  it('fails when quiet time cannot be read', async () => {
    const trees = { ...world(), quietSeconds: async () => failed<number | null>() } as unknown as Trees;
    expect(await readDeskReadings(trees, desks(), processesOf(table), stage)).toEqual(failed());
  });
});

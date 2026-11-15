import { describe, expect, it } from 'vitest';

import { agentDesk } from '../src/adapters/agents/agents-fixture.js';
import { deskFixture, deskFixtureCalls, type DeskFixtureCalls } from '../src/adapters/desk/desk-fixture.js';
import type { WorkerState } from '../src/entities/fleet.js';
import type { Finding } from '../src/entities/finding.js';
import { answered, failed, unaskable, type PortResult } from '../src/port-result.js';
import type { Agents } from '../src/ports/agents.js';
import type { Host } from '../src/ports/host.js';
import type { Refs } from '../src/ports/refs.js';
import type { Trees } from '../src/ports/trees.js';
import { finalAgentFinding, writeAgentFindings } from '../src/workflows/agent-findings.js';
import type { BranchStageReadings } from '../src/workflows/plan-walk-branches.js';
import type { DeskReading, DeskStageReadings } from '../src/workflows/plan-walk-desks.js';

const AT = '2026-11-10T01:00:00Z';

/** A host whose `prState` answers from a table by branch, and counts its calls. */
const hostOf = (answers: Record<string, PortResult<unknown>>, asked: string[] = []): Host =>
  ({
    prState: async (ref: string) => {
      asked.push(ref);
      return answers[ref] ?? answered(null);
    },
  }) as unknown as Host;

const branchesOf = (...entries: Array<{ branch: string; pr?: string; ahead?: number; paths?: string[] }>): BranchStageReadings =>
  ({
    branches: entries.map(({ branch, pr, ahead, paths }) => ({
      plan: 'docs/plans/p.md',
      branch,
      readings: { pr: pr ?? 'OPEN', realCommitsAhead: ahead ?? 2 },
      landed: [],
      changedPaths: paths ?? ['src/a.ts', '.changeset/x.md'],
    })),
  }) as unknown as BranchStageReadings;

const deskOf = (branch: string, over: Partial<DeskReading> = {}, state: WorkerState = 'running'): DeskReading => ({
  branch,
  worktree: `/w/${branch.replace('/', '-')}`,
  desk: agentDesk(),
  process: { state, pid: '41', exitCode: '', activity: 'working' },
  locked: false,
  unpushed: [],
  quietSeconds: 1,
  dirty: [],
  ...over,
});

const stage = (...desks: DeskReading[]): DeskStageReadings => ({ mainSha: 'm', desks });

const fresh = (findings: Record<string, readonly Finding[]> = {}, unreadable: string[] = []) => {
  const calls: DeskFixtureCalls = deskFixtureCalls();
  return { calls, desk: deskFixture({ calls, findings, unreadableFindings: unreadable }) };
};

describe('writeAgentFindings', () => {
  it('writes a per-pass finding from the pass readings and asks the host nothing', async () => {
    const { calls, desk } = fresh();
    const asked: string[] = [];
    const written = await writeAgentFindings(
      { desk, host: hostOf({}, asked) },
      new Map(),
      branchesOf({ branch: 'feature/a', pr: 'none' }, { branch: 'feature/b', paths: ['src/b.ts'] }, { branch: 'feature/c' }),
      stage(deskOf('feature/a'), deskOf('feature/b'), deskOf('feature/c', { desk: agentDesk({ markers: ['PLOT-BLOCKED.md'] }) })),
      AT,
    );
    expect(written.map((f) => [f.branch, f.finding])).toEqual([
      ['feature/a', 'owes a review'],
      ['feature/b', 'owes a gate'],
      ['feature/c', 'owes an answer'],
    ]);
    expect(calls.agentFindings.map((c) => c.worktree)).toEqual(['/w/feature-a', '/w/feature-b', '/w/feature-c']);
    expect(asked).toEqual([]);
  });

  it('writes no owes a review on a per-pass read with no licensed none', async () => {
    const { calls, desk } = fresh();
    await writeAgentFindings({ desk, host: hostOf({}) }, new Map(), branchesOf({ branch: 'feature/a', pr: 'unreadable' }), stage(deskOf('feature/a')), AT);
    expect(calls.agentFindings).toEqual([]);
  });

  it('runs the final pass with one host pr-state when a running worker ends, and once only', async () => {
    const { calls, desk } = fresh();
    const asked: string[] = [];
    const ports = { desk, host: hostOf({}, asked) };
    const states = new Map<string, WorkerState>();
    const branches = branchesOf({ branch: 'feature/a', pr: 'unreadable' });
    await writeAgentFindings(ports, states, branches, stage(deskOf('feature/a')), AT);
    expect(asked).toEqual([]);
    const written = await writeAgentFindings(ports, states, branches, stage(deskOf('feature/a', {}, 'finished')), AT);
    expect(written.map((f) => f.finding)).toEqual(['owes a review']);
    expect(asked).toEqual(['feature/a']);
    await writeAgentFindings(ports, states, branches, stage(deskOf('feature/a', {}, 'finished')), AT);
    expect(asked).toEqual(['feature/a']);
    expect(calls.agentFindings).toHaveLength(1);
  });

  it('asks the host nothing on a final pass the PR answer cannot change', async () => {
    const asked: string[] = [];
    const { calls, desk } = fresh();
    await writeAgentFindings({ desk, host: hostOf({}, asked) }, new Map(), branchesOf({ branch: 'feature/a' }), stage(deskOf('feature/a', { dirty: ['x'] }, 'finished')), AT);
    expect(asked).toEqual([]);
    expect(calls.agentFindings.map((c) => c.finding.finding)).toEqual(['holds unlanded work']);
  });

  it('runs the final pass for a desk first read ended, as at fleetd start', async () => {
    const asked: string[] = [];
    await writeAgentFindings({ desk: fresh().desk, host: hostOf({}, asked) }, new Map(), branchesOf({ branch: 'feature/a' }), stage(deskOf('feature/a', {}, 'ended')), AT);
    expect(asked).toEqual(['feature/a']);
  });

  it('writes no owes a review on a refused final pr-state, and the desk log names the refusal', async () => {
    const { calls, desk } = fresh();
    const host = hostOf({ 'feature/a': failed(), 'feature/b': unaskable('gh is not signed in'), 'feature/c': unaskable() });
    await writeAgentFindings(
      { desk, host },
      new Map(),
      branchesOf({ branch: 'feature/a', pr: 'none' }, { branch: 'feature/b', pr: 'none' }, { branch: 'feature/c', pr: 'none' }),
      stage(deskOf('feature/a', {}, 'finished'), deskOf('feature/b', {}, 'finished'), deskOf('feature/c', {}, 'finished')),
      AT,
    );
    expect(calls.agentFindings).toEqual([]);
    expect(calls.logLines).toEqual([
      { worktree: '/w/feature-a', line: 'plot-fleetd: final pass for feature/a: pr-state did not answer (failed); no owes a review is written' },
      { worktree: '/w/feature-b', line: 'plot-fleetd: final pass for feature/b: pr-state did not answer (unaskable: gh is not signed in); no owes a review is written' },
      { worktree: '/w/feature-c', line: 'plot-fleetd: final pass for feature/c: pr-state did not answer (unaskable); no owes a review is written' },
    ]);
  });

  it('writes nothing while the held finding holds, and clear once it stops', async () => {
    const held: Finding = {
      monitor: 'AgentMonitor', branch: 'feature/a', worktree: '/w/feature-a', finding: 'owes a review',
      since: AT, evidence: 'e', measuredAt: AT,
    };
    const other: Finding = { ...held, monitor: 'WorkerMonitor', finding: 'gone' };
    const holding = fresh({ '/w/feature-a': [other, held] });
    await writeAgentFindings({ desk: holding.desk, host: hostOf({}) }, new Map(), branchesOf({ branch: 'feature/a', pr: 'none' }), stage(deskOf('feature/a')), AT);
    expect(holding.calls.agentFindings).toEqual([]);
    const paid = fresh({ '/w/feature-a': [held] });
    await writeAgentFindings({ desk: paid.desk, host: hostOf({}) }, new Map(), branchesOf({ branch: 'feature/a' }), stage(deskOf('feature/a')), AT);
    expect(paid.calls.agentFindings.map((c) => c.finding.finding)).toEqual(['clear']);
  });

  it('skips a desk whose findings cannot be read, or whose branch the stage did not read', async () => {
    const { calls, desk } = fresh({}, ['/w/feature-a']);
    await writeAgentFindings(
      { desk, host: hostOf({}) },
      new Map(),
      branchesOf({ branch: 'feature/a', pr: 'none' }),
      stage(deskOf('feature/a'), deskOf('feature/z')),
      AT,
    );
    expect(calls.agentFindings).toEqual([]);
  });

  it('drops the state of a desk the pass no longer reads', async () => {
    const states = new Map<string, WorkerState>([['/w/gone', 'running']]);
    await writeAgentFindings({ desk: fresh().desk, host: hostOf({}) }, states, branchesOf({ branch: 'feature/a' }), stage(deskOf('feature/a')), AT);
    expect([...states]).toEqual([['/w/feature-a', 'running']]);
  });

  it('skips a line the desk refuses to take', async () => {
    const desk = { ...fresh().desk, publishAgentFinding: async () => failed<void>() };
    const written = await writeAgentFindings({ desk, host: hostOf({}) }, new Map(), branchesOf({ branch: 'feature/a', pr: 'none' }), stage(deskOf('feature/a')), AT);
    expect(written).toEqual([]);
  });
});

describe('finalAgentFinding', () => {
  const WT = '/w/desk';
  const ports = (over: {
    desk?: PortResult<ReturnType<typeof agentDesk>>;
    dirty?: PortResult<readonly string[]>;
    main?: PortResult<string>;
    subjects?: PortResult<ReadonlyArray<{ subject: string; tree: string; parents: number; at: number }>>;
    changed?: PortResult<readonly string[]>;
    pr?: PortResult<unknown>;
    asked?: string[];
  } = {}) => {
    const { calls, desk } = fresh();
    return {
      calls,
      ports: {
        desk,
        host: hostOf({ 'feature/x': over.pr ?? answered(null) }, over.asked),
        agents: { desk: async () => over.desk ?? answered(agentDesk()) } as unknown as Agents,
        trees: {
          dirtyPaths: async () => over.dirty ?? answered([]),
          unpushedCommits: async () => answered([]),
        } as unknown as Trees,
        refs: {
          defaultBranch: async () => over.main ?? answered('main'),
          commitSubjects: async () => over.subjects ?? answered([{ subject: 'work', tree: 't1', parents: 1, at: 1 }]),
          changedFiles: async () => over.changed ?? answered(['done.txt']),
        } as unknown as Refs,
      },
    };
  };

  it('writes owes a review once for a clean desk with commits and no PR', async () => {
    const asked: string[] = [];
    const { calls, ports: p } = ports({ asked });
    const line = await finalAgentFinding(p, { branch: 'feature/x', worktree: WT, at: AT, who: 'plot-worker-wrapper' });
    expect(line).toMatchObject({ monitor: 'AgentMonitor', branch: 'feature/x', worktree: WT, finding: 'owes a review', since: AT });
    expect(calls.agentFindings).toHaveLength(1);
    expect(asked).toEqual(['feature/x']);
  });

  it('writes owes a gate for a PR whose branch adds no changeset, and nothing once it does', async () => {
    expect((await finalAgentFinding(ports({ pr: answered({ state: 'OPEN' }) }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' }))?.finding).toBe('owes a gate');
    expect(
      await finalAgentFinding(ports({ pr: answered({ state: 'OPEN' }), changed: answered(['.changeset/a.md']) }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' }),
    ).toBeNull();
  });

  it('writes nothing where the default branch, the commits or the changed paths cannot be read', async () => {
    expect(await finalAgentFinding(ports({ main: failed() }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' })).toBeNull();
    expect(await finalAgentFinding(ports({ subjects: failed() }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' })).toBeNull();
    expect(
      await finalAgentFinding(ports({ pr: answered({ state: 'OPEN' }), changed: failed() }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' }),
    ).toBeNull();
    expect(await finalAgentFinding(ports({ dirty: failed() }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' })).toBeNull();
  });

  it('asks the host nothing for a dirty desk, and writes holds unlanded work', async () => {
    const asked: string[] = [];
    const { ports: p } = ports({ dirty: answered(['owed.txt']), asked });
    expect((await finalAgentFinding(p, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' }))?.finding).toBe('holds unlanded work');
    expect(asked).toEqual([]);
  });

  it('asks the host nothing where the desk cannot be read', async () => {
    const asked: string[] = [];
    expect(await finalAgentFinding(ports({ desk: failed(), asked }).ports, { branch: 'feature/x', worktree: WT, at: AT, who: 'w' })).toBeNull();
    expect(asked).toEqual([]);
  });

  it('names its writer in the desk log on a refused lookup', async () => {
    const { calls, ports: p } = ports({ pr: failed() });
    expect(await finalAgentFinding(p, { branch: 'feature/x', worktree: WT, at: AT, who: 'plot-worker-wrapper' })).toBeNull();
    expect(calls.logLines.map((l) => l.line)).toEqual([
      'plot-worker-wrapper: final pass for feature/x: pr-state did not answer (failed); no owes a review is written',
    ]);
  });
});

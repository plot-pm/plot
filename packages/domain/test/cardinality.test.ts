import { describe, it, expect } from 'vitest';
import {
  branchHasLanded, sprintMembers, plansSpanned, isFree, reapRefusals, sameVersion,
  branchesWanted, slicesDeferred,
  type Pr, type Agent, type Worktree, type Sprint, type SprintItem, type Story, type Issue,
  type Plan, type Slice,
} from '../src/index.js';

/**
 * THE CARDINALITY DIAGRAM, EXPRESSED IN THE TYPES.
 *
 * `DESIGN-review.md` §3 consolidates 84 relation rows from twelve specs into
 * one diagram. Before it, a reader wanting *how many slices does a plan have*
 * read twelve files, and 19 of the 84 rows stated no cardinality at all.
 *
 * Each test below states one line of that diagram and demonstrates that the
 * types carry its arity: a `1─1` relation is a single reference, a `1─*` is a
 * collection, and a `≤1` is nullable. An arity a type cannot express is one the
 * code will eventually contradict.
 */

/** A plan carrying no slices, so each test states only the relation it is about. */
const PLAN: Plan = {
  id: 'a', file: 'docs/plans/2026-09-04-a.md', title: 'A', state: 'approved',
  review: 'pr', story: '', sprint: '', slices: [],
};

const pr = (number: number, mergedAt: string | null): Pr => ({
  number, repo: '', head: 'feature/x', state: mergedAt === null ? 'OPEN' : 'CLOSED',
  mergedAt, mergeCommit: mergedAt === null ? '' : 'abc', draft: false,
  mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [], url: '',
});

describe('Story 1 ── * Plan — a story spans plans; a plan has ≤1 story', () => {
  it('carries the story on the plan side as a single value', () => {
    // The `≤1` half is what makes it one field rather than a collection: a plan
    // belongs to one story or to none, never to two.
    //
    // STATED ON THE `Plan` TYPE NOW. This arity was demonstrated with a local
    // variable until the entity existed, because there was no plan-shaped thing
    // to hold the field — which is exactly the gap `entities/plan.ts` closes.
    const story: Story = {
      slug: 's', title: 'S', status: 'active', path: 'p',
      created: '2026-08-28', updated: '2026-08-28', author: 'jwloka', archived: null,
    };
    const member: Plan = { ...PLAN, story: story.slug };
    const orphan: Plan = { ...PLAN, story: '' };
    expect(member.story).toBe('s');
    expect(orphan.story).toBe('');
  });
});

describe('Sprint 1 ── * Plan — a sprint has many; a plan has ≤1', () => {
  it('holds many plans, each counted once', () => {
    const item = (plan: string): SprintItem => ({ tier: 'must', checked: false, plan, text: '', annotation: '' });
    const sprint: Sprint = {
      slug: '2026-W35-x', title: 'X', state: 'Active', start: '2026-08-25',
      plannedEnd: '2026-08-31', actualEnd: null, release: 'v2.9.0', goal: '',
      items: [item('a'), item('b'), item('a')],
    };
    expect(sprintMembers(sprint)).toEqual(['a', 'b']);
  });
});

describe('Sprint * ── 1 Release — TWO sprints may target one release', () => {
  it('lets two sprints name one version', () => {
    // Which is why the release gate reports every active sprint: two teams may
    // share one train.
    expect(sameVersion('v2.9.0', '2.9.0')).toBe(true);
  });
});

describe('Branch 1 ── * PR — 372 have one, 9 have two, ONE has ten', () => {
  it('asks whether ANY of a branch’s PRs merged', () => {
    // The cardinality IS the rule: *has this branch landed* means *did any of
    // them merge*, which is why `mergedAt` outranks `state`.
    expect(branchHasLanded([pr(1, null), pr(2, '2026-08-27T10:00:00Z')])).toBe(true);
    expect(branchHasLanded([pr(1, null), pr(2, null)])).toBe(false);
  });
});

describe('Agent 1 ── 1 Worktree — the agent OWNS its desk', () => {
  it('points from the agent to one desk, and from the tree to one owner', () => {
    // Stated in two directions in the specs and settled here: the ownership
    // runs agent → worktree, so a tree with no agent is an orphan rather than
    // a vacant desk.
    const tree: Worktree = {
      path: '/tmp/wt', branch: 'feature/x', isMain: false, clean: true,
      agentSession: 'sess-1', prunable: false,
    };
    const agent: Agent = {
      session: 'sess-1', identity: 'manifest', branch: 'feature/x', worktree: tree.path,
      command: '', startedAt: '', pid: '1', previousPid: '', relaunches: 0,
      state: 'running', activity: 'working', exitCode: null, dirtyPaths: [],
      machineAtDeath: 'unmeasured',
    };
    expect(agent.worktree).toBe(tree.path);
    expect(tree.agentSession).toBe(agent.session);
  });
});

describe('Agent 1 ── * Slice — over time, one at a time', () => {
  it('holds at most one branch at a moment, and none between slices', () => {
    // Not concurrent: an agent takes one unit, completes it, and asks for the
    // next. `''` between slices is a real value.
    const between: Agent = {
      session: 's', identity: 'manifest', branch: '', worktree: '/tmp/wt', command: '',
      startedAt: '', pid: '1', previousPid: '', relaunches: 0, state: 'running',
      activity: '', exitCode: null, dirtyPaths: [], machineAtDeath: 'unmeasured',
    };
    expect(between.branch).toBe('');
    expect(isFree(between, false)).toBe(true);
  });
});

describe('Worktree 1 ── 1 Branch — while checked out', () => {
  it('holds one branch, or none when detached', () => {
    const detached: Worktree = {
      path: '/tmp/wt', branch: '', isMain: false, clean: true, agentSession: null, prunable: false,
    };
    expect(detached.branch).toBe('');
  });
});

describe('Machine 1 ── * everything — one machine, many tenants', () => {
  it('is reachable from an agent without being identified', () => {
    // There is exactly one Machine and it has no identity, so an entity refers
    // to its READING rather than to a machine by key.
    const agent: Agent = {
      session: 's', identity: 'manifest', branch: '', worktree: '', command: '',
      startedAt: '', pid: '1', previousPid: '', relaunches: 0, state: 'failed',
      activity: '', exitCode: 124, dirtyPaths: [], machineAtDeath: 'starved',
    };
    // `exit 124` is timeout's signal; with no Machine the only reading is *the
    // worker stopped*, and 7 deaths were blamed on a Plot defect four times.
    expect(agent.machineAtDeath).toBe('starved');
  });
});

describe('Issue * ── * Plan — a plan answers several; a signal fans into n plans', () => {
  it('carries issue references as a collection on each side', () => {
    const issues: Issue[] = [
      { id: '226', title: 'a', url: '', createdAt: null, body: null },
      { id: 'PROJ-1', title: 'b', url: '', createdAt: null, body: null },
    ];
    const answeredByOnePlan = issues.map((i) => i.id);
    expect(answeredByOnePlan).toEqual(['226', 'PROJ-1']);
  });
});

describe('Slice 1 ── 1 Branch, and a Wave spans plans', () => {
  it('gives a slice one branch and lets a Wave cross plans', () => {
    // The distinction the rename drew: a slice belongs to exactly one plan, and
    // the fleet's Wave belongs to none.
    expect(plansSpanned([
      { plan: 'a', name: 'One', branch: 'feature/x' },
      { plan: 'b', name: 'Two', branch: 'feature/y' },
    ])).toEqual(['a', 'b']);
  });

  it('keeps the 1─1 from collapsing, because a plan writes one side and git the other', () => {
    // THE ARGUMENT, NOT THE ARITY. `Slice` and `Branch` are 1:1, so the arity
    // alone would justify one type. What keeps them apart is ownership: the
    // plan wrote `intent` and `intentReason`, and no ref can answer either.
    //
    // The deferred slice below names a branch that was never created. Its
    // meaning survives that — which is the case proving neither derives from
    // the other, measured over the estate as 21 annotated branch lines.
    const given_up: Slice = {
      plan: 'a', name: 'One', branch: 'feature/never-created', order: 0,
      intent: 'deferred', intentReason: 'folded into the slice that superseded it',
    };
    expect(slicesDeferred({ ...PLAN, slices: [given_up] })).toEqual([given_up]);
    expect(branchesWanted({ ...PLAN, slices: [given_up] })).toEqual([]);
  });
});

describe('a reap asks about the agent, never about the tree', () => {
  it('refuses on what the agent left, which is the ownership direction', () => {
    const tree: Worktree = {
      path: '/tmp/wt', branch: 'feature/x', isMain: false, clean: false,
      agentSession: 'sess-1', prunable: true,
    };
    // `prunable` is git's word — the directory is gone — and says nothing about
    // whether the work landed, which is Plot's question.
    const refusals = reapRefusals(tree, {
      workerAlive: false, blockedMarker: false, hasMergedPr: true, defaultBranch: 'main',
    });
    expect(refusals).toEqual(['uncommitted-changes']);
  });
});

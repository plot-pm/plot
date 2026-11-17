// How far each slice is, as one of five states, counted per plan, release and sprint.
import { describe, it, expect } from 'vitest';
import {
  allSlicesMerged,
  countSliceStates,
  countSliceStatesOver,
  planSliceMerges,
  placeDelivery,
  sliceProgress,
  sliceStateOf,
  type AgentPlacementReading,
  type BranchState,
  type SliceVerdict,
  type CountedSlice,
  type DeliveryInput,
  type DeliveryReadings,
  type FleetReading,
  type WorkItemReading,
} from '../src/index.js';

const input: DeliveryInput = { mine: 'off', autoReview: true, correctionBudget: 2 };
const item = (over: Partial<WorkItemReading> & { id: string }): WorkItemReading => ({ kind: 'slice', ownership: 'mine', ...over });
const agent = (over: Partial<AgentPlacementReading> & { id: string }): AgentPlacementReading => ({
  role: 'loop', process: 'running', actsOn: null, blockedOn: null, ...over,
});
const open = (id: string): CountedSlice => ({ id, merge: 'open' });
const merged = (id: string): CountedSlice => ({ id, merge: 'merged' });
const readings = (items: WorkItemReading[], agents: AgentPlacementReading[] = []): DeliveryReadings => ({ items, agents });
const passedPr = { ci: 'passed', review: 'passed' } as const;

describe('the order of the five states', () => {
  it('reads a slice with an open PR and a PLOT-BLOCKED marker as blocked, not at a gate', () => {
    const it1 = item({ id: 'a', stage: 'pr', pr: passedPr, blockedMarker: true });
    expect(sliceStateOf(open('a'), it1, 0, 0, input)).toBe('blocked');
  });

  it('reads a slice with an open PR and a held default branch as at a gate', () => {
    const it1 = item({ id: 'a', stage: 'pr', pr: passedPr, heldBy: 'machine' });
    expect(sliceStateOf(open('a'), it1, 0, 0, input)).toBe('at-a-gate');
  });

  it('reads a merged slice as delivered whatever else its item says', () => {
    const it1 = item({ id: 'a', stage: 'pr', pr: passedPr, blockedMarker: true });
    expect(sliceStateOf(merged('a'), it1, 0, 0, input)).toBe('delivered');
  });

  it('reads a claim with no live agent as being built', () => {
    expect(sliceStateOf(open('a'), item({ id: 'a', stage: 'building' }), 0, 0, input)).toBe('being-built');
  });

  it('reads a slice with no branch, no claim and no agent as not started', () => {
    expect(sliceStateOf(open('a'), item({ id: 'a', stage: 'queued' }), 0, 0, input)).toBe('not-started');
  });

  it('reads an absent item, an absent stage and unread PR checks as unread, never not started', () => {
    expect(sliceStateOf(open('a'), undefined, 0, 0, input)).toBe('unread');
    expect(sliceStateOf(open('a'), item({ id: 'a' }), 0, 0, input)).toBe('unread');
    expect(sliceStateOf(open('a'), item({ id: 'a', stage: 'pr', pr: { ci: 'unread', review: 'unread' } }), 0, 0, input)).toBe('unread');
  });
});

describe('counts per plan', () => {
  const items = [
    item({ id: 'a', stage: 'pr', pr: passedPr, blockedMarker: true }),
    item({ id: 'b', stage: 'pr', pr: passedPr }),
    item({ id: 'c', stage: 'building' }),
    item({ id: 'd', stage: 'queued' }),
    item({ id: 'e' }),
  ];
  const slices = [merged('m'), open('a'), open('b'), open('c'), open('d'), open('e')];

  it('adds the five states up to the total and holds the unread slice apart', () => {
    const c = countSliceStates(slices, readings(items), input);
    expect(c).toEqual({ delivered: 1, blocked: 1, 'at-a-gate': 1, 'being-built': 1, 'not-started': 1, unread: 1, total: 5 });
  });

  it('gives two readers of one payload the same counts', () => {
    const as = (ownership: 'mine' | 'theirs') => countSliceStates(slices, readings(items.map((i) => ({ ...i, ownership }))), input);
    expect(as('theirs')).toEqual(as('mine'));
    expect(as('theirs').blocked).toBe(1);
    // placeDelivery lists a `theirs` blocked slice under Work items, so counting its You items would differ.
    const placed = placeDelivery(readings(items.map((i) => ({ ...i, ownership: 'theirs' as const }))), input);
    expect(placed.items.filter((p) => p.section === 'you')).toHaveLength(0);
  });

  it('counts a running agent on a slice that has no stage as being built', () => {
    const c = countSliceStates([open('x')], readings([item({ id: 'x', stage: 'queued' })], [agent({ id: 'g', actsOn: 'x' })]), input);
    expect(c['being-built']).toBe(1);
  });

  it('reads a stopped agent on a claimed slice as blocked', () => {
    const c = countSliceStates([open('x')], readings([item({ id: 'x', stage: 'building' })], [agent({ id: 'g', actsOn: 'x', process: 'stopped' })]), input);
    expect(c.blocked).toBe(1);
  });
});

const branch = (b: string, state: BranchState) => ({
  branch: b, state, deferred: state === 'deferred', deferred_reason: '', claimed: '', local_dirty: false, local_worktree: '',
});
const slice = (name: string, verdict: SliceVerdict, branches: Array<[string, BranchState]>) => ({
  name, verdict, branches: branches.map(([b, s]) => branch(b, s)),
});
const PLAN = 'docs/plans/2026-11-16-p.md';
const pulse = (slices: ReturnType<typeof slice>[]): FleetReading => ({
  main: 'main',
  head: 'abc',
  plans: [{ file: '2026-11-16-p.md', slices, unreadBranchItems: [] }],
  summary: { plans: 1, waves: slices.length, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
} as unknown as FleetReading);

describe('the merge answer', () => {
  const p = pulse([
    slice('Shelved', 'blocked', [['feature/s', 'deferred']]),
    slice('Done', 'complete', [['feature/d', 'merged']]),
    slice('Subject', 'complete', [['feature/m', 'merged']]),
    slice('Open', 'eligible', [['feature/o', 'open']]),
  ]);

  it('counts a deferred-only slice in no state and not in the total', () => {
    const merges = planSliceMerges({ file: PLAN }, p, true)!;
    expect(merges.map((m) => m.name)).toEqual(['Done', 'Subject', 'Open']);
    const counted = merges.map((m) => ({ id: m.name, merge: m.merge }));
    const c = countSliceStates(counted, readings([item({ id: 'Open', stage: 'queued' })]), input);
    expect(c.total).toBe(3);
    expect(c.delivered + c.blocked + c['at-a-gate'] + c['being-built'] + c['not-started']).toBe(c.total);
  });

  it('delivers as many slices as sliceProgress counts merged', () => {
    const merges = planSliceMerges({ file: PLAN }, p, true)!;
    expect(`${merges.filter((m) => m.merge === 'merged').length} of ${merges.length} slices merged`).toBe(sliceProgress({ file: PLAN }, p, true));
    expect(allSlicesMerged({ file: PLAN }, p, true)).toBe('not-merged');
  });

  it('answers undefined on a partial pulse, as sliceProgress does', () => {
    expect(planSliceMerges({ file: PLAN }, p, false)).toBeUndefined();
    expect(planSliceMerges({ file: PLAN }, null, true)).toBeUndefined();
    expect(sliceProgress({ file: PLAN }, p, false)).toBeUndefined();
  });
});

describe('counts per release and per sprint', () => {
  // A sprint names plans on its Must/Should/Could lines; a release is the plans of every sprint whose `Release:` names it.
  const plans = new Map<string, readonly CountedSlice[] | undefined>([
    ['one', [merged('one:1'), open('one:2')]],
    ['two', [open('two:1')]],
    ['three', undefined],
  ]);
  const rs = readings([item({ id: 'one:2', stage: 'building' }), item({ id: 'two:1', stage: 'queued' })]);
  const sprintA = ['one', 'two'];
  const sprintB = ['two'];
  const release = [...sprintA, ...sprintB];

  it('sums the per-plan counts', () => {
    const one = countSliceStatesOver(plans, ['one'], rs, input)!;
    const two = countSliceStatesOver(plans, ['two'], rs, input)!;
    const sprint = countSliceStatesOver(plans, sprintA, rs, input)!;
    expect(sprint.total).toBe(one.total + two.total);
    expect(sprint.delivered).toBe(1);
    expect(sprint['being-built']).toBe(1);
    expect(sprint['not-started']).toBe(1);
  });

  it('counts a plan in two sprints once in the release', () => {
    expect(countSliceStatesOver(plans, release, rs, input)).toEqual(countSliceStatesOver(plans, sprintA, rs, input));
  });

  it('answers undefined where a named plan has no merge answer', () => {
    expect(countSliceStatesOver(plans, ['one', 'three'], rs, input)).toBeUndefined();
    expect(countSliceStatesOver(plans, ['missing'], rs, input)).toBeUndefined();
  });
});

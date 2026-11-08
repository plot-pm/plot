// Where every work item and every agent shows on the Delivery tab.
//
// EVERY CASE IS A PLAIN CALL over readings as values. The one test that earns
// its keep is the mixed estate: a per-case test passes while two cases
// double-place.
import { describe, it, expect } from 'vitest';
import {
  DELIVERY_LAYOUT,
  placeDelivery,
  type AgentPlacementReading,
  type DeliveryInput,
  type WorkItemReading,
} from '../src/rules/delivery-placement.js';

const input = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({
  mine: 'off',
  autoReview: true,
  correctionBudget: 2,
  ...over,
});

const item = (over: Partial<WorkItemReading> & { id: string }): WorkItemReading => ({
  kind: 'slice',
  ownership: 'mine',
  ...over,
});

const agent = (over: Partial<AgentPlacementReading> & { id: string }): AgentPlacementReading => ({
  role: 'loop',
  process: 'running',
  actsOn: null,
  blockedOn: null,
  ...over,
});

const failedCi = { ci: 'failed', review: 'unread' } as const;

/** A slice at the CI gate with a live fixer, the design's worked example. */
const ciSlice = (corrections: number) => item({ id: 'slice-a', stage: 'pr', pr: failedCi, corrections });
const fixer = agent({ id: 'fixer-f3a1', role: 'fixer', actsOn: 'slice-a' });

describe('the fixer case', () => {
  it('holds the slice at the CI gate under Work items while the fixer works under Fleet', () => {
    const p = placeDelivery({ items: [ciSlice(1)], agents: [fixer] }, input());

    expect(p.items).toEqual([
      { id: 'slice-a', kind: 'slice', section: 'work-items', group: 'at-a-gate', reason: null, agents: ['fixer-f3a1'] },
    ]);
    expect(p.agents[0]).toMatchObject({ section: 'fleet', group: 'working', actsOn: 'slice-a', linked: true });
    expect(p.items.filter((i) => i.section === 'you')).toEqual([]);
  });

  it('flips the same slice to You › Unblock once the correction budget is spent', () => {
    const p = placeDelivery({ items: [ciSlice(2)], agents: [] }, input());

    expect(p.items[0]).toMatchObject({ section: 'you', group: 'unblock', reason: 'fleet-stuck' });
  });

  it('moves a HIGH finding to Unblock only when the budget is spent', () => {
    const high = (corrections: number) =>
      item({ id: 's', stage: 'pr', pr: { ci: 'passed', review: 'high' }, corrections });

    expect(placeDelivery({ items: [high(1)], agents: [] }, input()).items[0]).toMatchObject({ group: 'at-a-gate' });
    expect(placeDelivery({ items: [high(2)], agents: [] }, input()).items[0]).toMatchObject({ group: 'unblock' });
  });

  it('sends a gate the fleet cannot pass alone to Unblock', () => {
    const stuck = item({ id: 's', stage: 'pr', pr: failedCi, corrections: 0, gateUnpassable: true });

    expect(placeDelivery({ items: [stuck], agents: [] }, input()).items[0]).toMatchObject({ reason: 'fleet-stuck' });
  });
});

describe('auto-review', () => {
  const pr = item({ id: 'pr-1', kind: 'pr', stage: 'pr', pr: { ci: 'passed', review: 'pending' } });

  it('makes the PR a gate when on', () => {
    expect(placeDelivery({ items: [pr], agents: [] }, input({ autoReview: true })).items[0]).toMatchObject({
      section: 'work-items',
      group: 'at-a-gate',
    });
  });

  it('asks a person to review the same PR when off', () => {
    expect(placeDelivery({ items: [pr], agents: [] }, input({ autoReview: false })).items[0]).toMatchObject({
      section: 'you',
      group: 'review-a-result',
      reason: 'review-pr',
    });
  });

  it('asks a person to review a PR nobody has reviewed when off', () => {
    const unreviewed = item({ id: 'p', stage: 'pr', pr: { ci: 'passed', review: 'none' } });

    expect(placeDelivery({ items: [unreviewed], agents: [] }, input({ autoReview: false })).items[0]).toMatchObject({
      group: 'review-a-result',
    });
  });

  it('keeps a PR whose CI still runs at the gate even when off', () => {
    const running = item({ id: 'p', stage: 'pr', pr: { ci: 'running', review: 'none' } });

    expect(placeDelivery({ items: [running], agents: [] }, input({ autoReview: false })).items[0]).toMatchObject({
      group: 'at-a-gate',
    });
  });
});

describe('the six You cases', () => {
  const only = (i: WorkItemReading, agents: AgentPlacementReading[] = []) =>
    placeDelivery({ items: [i], agents }, input()).items[0];

  it('a draft or design plan is input to the fleet', () => {
    expect(only(item({ id: 'p', kind: 'plan', phase: 'draft' }))).toMatchObject({ group: 'input-to-the-fleet', reason: 'draft-plan' });
    expect(only(item({ id: 'p', kind: 'plan', phase: 'design' }))).toMatchObject({ group: 'input-to-the-fleet' });
  });

  it('plan, spike and release approvals', () => {
    expect(only(item({ id: 'p', kind: 'plan', phase: 'draft', approvalOwed: 'plan' }))).toMatchObject({ reason: 'draft-plan' });
    expect(only(item({ id: 'p', kind: 'plan', phase: 'approved', approvalOwed: 'plan' }))).toMatchObject({ group: 'input-to-the-fleet', reason: 'plan-approval' });
    expect(only(item({ id: 'p', kind: 'plan', phase: 'design', approvalOwed: 'spike' }))).toMatchObject({ reason: 'draft-plan' });
    expect(only(item({ id: 'b', kind: 'branch', stage: 'building', approvalOwed: 'spike' }))).toMatchObject({ reason: 'spike-approval' });
    expect(only(item({ id: 'r', kind: 'release', stage: 'pr', approvalOwed: 'release' }))).toMatchObject({ group: 'review-a-result', reason: 'release-approval' });
  });

  it('a delivered plan to test is a result to review and stays out of Work items otherwise', () => {
    const plan = item({ id: 'p', kind: 'plan', phase: 'delivered', delivered: true, testOwed: true });

    expect(only(plan)).toMatchObject({ group: 'review-a-result', reason: 'test-delivered-plan' });
  });

  it('a PLOT-BLOCKED marker', () => {
    expect(only(item({ id: 's', stage: 'building', blockedMarker: true }))).toMatchObject({ group: 'unblock', reason: 'blocked-marker' });
  });

  it('a merge conflict that no agent is assigned to', () => {
    const conflicted = item({ id: 's', stage: 'pr', pr: { ci: 'passed', review: 'passed' }, mergeConflict: true });

    expect(only(conflicted)).toMatchObject({ group: 'unblock', reason: 'merge-conflict' });
    expect(only(conflicted, [agent({ id: 'a', actsOn: 's' })])).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
  });

  it('a slice whose agent died, which Quiet used to hold', () => {
    const building = item({ id: 's', stage: 'building' });

    expect(only(building, [agent({ id: 'a', actsOn: 's', process: 'stopped' })])).toMatchObject({ group: 'unblock', reason: 'agent-died' });
    expect(only(building, [agent({ id: 'a', actsOn: 's' })])).toMatchObject({ section: 'work-items', group: 'being-built' });
  });
});

describe('Work items', () => {
  const only = (i: WorkItemReading) => placeDelivery({ items: [i], agents: [] }, input()).items[0];

  it('queued, building without an agent and a held slice', () => {
    expect(only(item({ id: 's', stage: 'queued', waitsOn: 'earlier' }))).toMatchObject({ group: 'queued' });
    expect(only(item({ id: 's', stage: 'building' }))).toMatchObject({ group: 'queued' });
    expect(only(item({ id: 's', stage: 'building', heldBy: 'rate-limit' }))).toMatchObject({ group: 'at-a-gate' });
  });

  it('a PR or branch no plan names sits in the group of its state, kind kept', () => {
    expect(only(item({ id: 'p', kind: 'pr', stage: 'pr', pr: { ci: 'running', review: 'none' } }))).toMatchObject({ kind: 'pr', group: 'at-a-gate' });
    expect(only(item({ id: 'b', kind: 'branch', stage: 'queued' }))).toMatchObject({ kind: 'branch', group: 'queued' });
  });

  it('a delivered item leaves', () => {
    const p = placeDelivery({ items: [item({ id: 's', delivered: true })], agents: [] }, input());

    expect(p.items).toEqual([]);
    expect(p.unplaced).toEqual([{ id: 's', subject: 'item', reason: 'delivered' }]);
  });
});

describe('Mine', () => {
  const draft = (ownership: 'mine' | 'theirs' | 'unknown') => item({ id: 'p', kind: 'plan', phase: 'draft', ownership });
  const sectionOf = (ownership: 'mine' | 'theirs' | 'unknown', mine: 'off' | 'mine' | 'strict') =>
    placeDelivery({ items: [draft(ownership)], agents: [] }, input({ mine })).items[0]?.section;

  it('places a theirs item under Work items in both filtered modes', () => {
    expect(sectionOf('theirs', 'off')).toBe('you');
    expect(sectionOf('theirs', 'mine')).toBe('work-items');
    expect(sectionOf('theirs', 'strict')).toBe('work-items');
  });

  it('keeps unknown under You in the lenient mode only', () => {
    expect(sectionOf('unknown', 'mine')).toBe('you');
    expect(sectionOf('unknown', 'strict')).toBe('work-items');
  });

  it('queues a theirs item that owes an approval under Work items', () => {
    const owed = item({ id: 'p', kind: 'plan', phase: 'approved', approvalOwed: 'plan', ownership: 'theirs' });

    expect(placeDelivery({ items: [owed], agents: [] }, input({ mine: 'mine' })).items[0]).toMatchObject({
      section: 'work-items',
      group: 'queued',
    });
  });

  it('keeps a delivered theirs plan to test out of Work items', () => {
    const plan = item({ id: 'p', kind: 'plan', phase: 'delivered', delivered: true, testOwed: true, ownership: 'theirs' });

    expect(placeDelivery({ items: [plan], agents: [] }, input({ mine: 'mine' })).items).toEqual([]);
  });
});

describe('Fleet', () => {
  const group = (a: AgentPlacementReading) => placeDelivery({ items: [], agents: [a] }, input()).agents[0]?.group;

  it('working, free, and blocked', () => {
    expect(group(agent({ id: 'a', actsOn: 's' }))).toBe('working');
    expect(group(agent({ id: 'a' }))).toBe('free');
    expect(group(agent({ id: 'a', process: 'stopped' }))).toBe('free');
    expect(group(agent({ id: 'a', process: 'stopped', actsOn: 's' }))).toBe('blocked');
  });

  it.each(['ci', 'review', 'machine', 'rate-limit', 'person'] as const)('blocked on %s is Blocked, not only on a person', (gate) => {
    const p = placeDelivery({ items: [], agents: [agent({ id: 'a', actsOn: 's', blockedOn: gate })] }, input());

    expect(p.agents[0]).toMatchObject({ group: 'blocked', blockedOn: gate });
  });

  it('marks a link to an item the readings do not hold', () => {
    expect(placeDelivery({ items: [], agents: [agent({ id: 'a', actsOn: 'gone' })] }, input()).agents[0]).toMatchObject({ linked: false });
  });
});

describe('absent is not false', () => {
  it('places an item with no stage nowhere and says so', () => {
    const p = placeDelivery({ items: [item({ id: 's' })], agents: [] }, input());

    expect(p.items).toEqual([]);
    expect(p.unplaced).toEqual([{ id: 's', subject: 'item', reason: 'unread' }]);
  });

  it('places a PR whose CI was never read nowhere', () => {
    const p = placeDelivery({ items: [item({ id: 's', stage: 'pr', pr: { ci: 'unread', review: 'unread' } })], agents: [] }, input());

    expect(p.unplaced).toEqual([{ id: 's', subject: 'item', reason: 'unread' }]);
  });

  it('places an agent with no process reading nowhere', () => {
    const p = placeDelivery({ items: [], agents: [agent({ id: 'a', process: undefined })] }, input());

    expect(p.agents).toEqual([]);
    expect(p.unplaced).toEqual([{ id: 'a', subject: 'agent', reason: 'unread' }]);
  });
});

describe('a mixed estate', () => {
  const items: WorkItemReading[] = [
    ciSlice(1),
    item({ id: 'draft', kind: 'plan', phase: 'draft' }),
    item({ id: 'dead', stage: 'building' }),
    item({ id: 'orphan-pr', kind: 'pr', stage: 'pr', pr: { ci: 'passed', review: 'pending' } }),
    item({ id: 'queued', stage: 'queued' }),
    item({ id: 'built', stage: 'building' }),
    item({ id: 'done', delivered: true }),
    item({ id: 'unread' }),
  ];
  const agents: AgentPlacementReading[] = [
    fixer,
    agent({ id: 'loop-dead', actsOn: 'dead', process: 'stopped' }),
    agent({ id: 'loop-built', actsOn: 'built' }),
    agent({ id: 'idle-desk' }),
    agent({ id: 'reviewer', role: 'reviewer', actsOn: 'orphan-pr', blockedOn: 'review' }),
  ];

  it('shows every subject exactly once across all sections', () => {
    const p = placeDelivery({ items, agents }, input());
    const shown = [...p.items.map((i) => i.id), ...p.agents.map((a) => a.id), ...p.unplaced.map((u) => u.id)];

    expect(shown.sort()).toEqual([...items.map((i) => i.id), ...agents.map((a) => a.id)].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('links both ways on every acting pair', () => {
    const p = placeDelivery({ items, agents }, input());

    for (const a of p.agents.filter((x) => x.linked)) {
      const target = p.items.find((i) => i.id === a.actsOn);
      expect(target?.agents, `${a.id} → ${a.actsOn}`).toContain(a.id);
    }
    for (const i of p.items) {
      for (const name of i.agents) expect(p.agents.find((a) => a.id === name)?.actsOn).toBe(i.id);
    }
  });
});

describe('the layout constant', () => {
  it('orders the five sections and the groups of the three that hold rows', () => {
    expect(DELIVERY_LAYOUT.map((s) => s.section)).toEqual(['release-delivery', 'you', 'work-items', 'fleet', 'machine']);
    expect(DELIVERY_LAYOUT.map((s) => [...s.groups])).toEqual([
      [],
      ['input-to-the-fleet', 'review-a-result', 'unblock'],
      ['at-a-gate', 'being-built', 'queued'],
      ['working', 'blocked', 'free'],
      [],
    ]);
  });

  it('is the vocabulary every placement uses', () => {
    const groups = new Map(DELIVERY_LAYOUT.map((s) => [s.section, s.groups as readonly string[]]));
    const p = placeDelivery(
      { items: [ciSlice(0), item({ id: 'd', kind: 'plan', phase: 'draft' })], agents: [fixer] },
      input(),
    );

    for (const placed of [...p.items, ...p.agents]) expect(groups.get(placed.section)).toContain(placed.group);
  });
});

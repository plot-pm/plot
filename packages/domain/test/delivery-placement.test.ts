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

const ticket = (over: Partial<WorkItemReading> & { id: string }): WorkItemReading =>
  item({ kind: 'ticket', ...over });

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
    ticket({ id: 'ticket:own' }),
    ticket({ id: 'ticket:planned', planned: true }),
    ticket({ id: 'ticket:other', ownership: 'theirs' }),
    ticket({ id: 'ticket:closed', delivered: true }),
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

describe('tickets', () => {
  const place = (items: WorkItemReading[], over: Partial<DeliveryInput> = {}) =>
    placeDelivery({ items, agents: [] }, input(over));

  it('places a ticket assigned to the reader under You › Input to the fleet', () => {
    const p = place([ticket({ id: 'ticket:1' })]);

    expect(p.items).toEqual([
      { id: 'ticket:1', kind: 'ticket', section: 'you', group: 'input-to-the-fleet', reason: 'ticket-assigned', agents: [] },
    ]);
  });

  it('leaves a planned ticket out of Input to the fleet, beside an unplanned one', () => {
    const p = place([ticket({ id: 'ticket:planned', planned: true }), ticket({ id: 'ticket:free' })]);

    expect(p.items.map((i) => i.id)).toEqual(['ticket:free']);
    expect(p.unplaced).toEqual([{ id: 'ticket:planned', subject: 'item', reason: 'planned' }]);
  });

  it('never places a ticket of someone else under You', () => {
    const p = place([ticket({ id: 'ticket:theirs', ownership: 'theirs' })]);

    expect(p.items).toEqual([
      { id: 'ticket:theirs', kind: 'ticket', section: 'work-items', group: 'queued', reason: null, agents: [] },
    ]);
  });

  it('hides a ticket of someone else under the Mine mode, and an unknown one under strict only', () => {
    const items = [
      ticket({ id: 'ticket:theirs', ownership: 'theirs' }),
      ticket({ id: 'ticket:unknown', ownership: 'unknown' }),
    ];

    expect(place(items, { mine: 'mine' }).items.map((i) => i.id)).toEqual(['ticket:unknown']);
    expect(place(items, { mine: 'strict' }).items).toEqual([]);
    expect(place(items, { mine: 'strict' }).unplaced.map((u) => u.reason)).toEqual(['filtered', 'filtered']);
  });

  it('does not place a closed ticket', () => {
    const p = place([ticket({ id: 'ticket:closed', delivered: true })]);

    expect(p.items).toEqual([]);
    expect(p.unplaced).toEqual([{ id: 'ticket:closed', subject: 'item', reason: 'delivered' }]);
  });

  describe('the Sprint filter', () => {
    const items = [
      ticket({ id: 'ticket:new', releases: ['2.32.0'] }),
      ticket({ id: 'ticket:old', releases: ['2.31.0'] }),
    ];

    it('narrows to the target release when on, and shows both when off', () => {
      expect(place(items, { releases: ['2.32.0'] }).items.map((i) => i.id)).toEqual(['ticket:new']);
      expect(place(items).items.map((i) => i.id)).toEqual(['ticket:new', 'ticket:old']);
    });

    it('takes a ticket planned for any release of two sprints', () => {
      expect(place(items, { releases: ['2.32.0', '2.31.0'] }).items).toHaveLength(2);
    });

    it('compares the release as a name: 2.32 is not 2.32.0', () => {
      const p = place([ticket({ id: 'ticket:short', releases: ['2.32'] })], { releases: ['2.32.0'] });

      expect(p.items).toEqual([]);
      expect(p.unplaced).toEqual([{ id: 'ticket:short', subject: 'item', reason: 'filtered' }]);
    });

    it('names a ticket whose releases were never read, and keeps it with the filter off', () => {
      const unread = ticket({ id: 'ticket:unread' });

      expect(place([unread], { releases: ['2.32.0'] }).unplaced).toEqual([
        { id: 'ticket:unread', subject: 'item', reason: 'unread' },
      ]);
      expect(place([unread]).items.map((i) => i.id)).toEqual(['ticket:unread']);
    });

    it('treats an empty releases array as read and planned for nothing', () => {
      const p = place([ticket({ id: 'ticket:none', releases: [] })], { releases: ['2.32.0'] });

      expect(p.unplaced).toEqual([{ id: 'ticket:none', subject: 'item', reason: 'filtered' }]);
    });
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

describe('loose ends', () => {
  const branch = (loose: WorkItemReading['loose'], over: Partial<WorkItemReading> = {}) =>
    item({ id: 'branch:feature/x', kind: 'branch', stage: 'queued', loose, ...over });
  const openPr = (loose: WorkItemReading['loose'], over: Partial<WorkItemReading> = {}) =>
    item({ id: 'branch:fix/y', kind: 'pr', stage: 'pr', pr: { ci: 'passed', review: 'passed' }, loose, ...over });
  const placed = (i: WorkItemReading, over: Partial<DeliveryInput> = {}, agents: AgentPlacementReading[] = []) =>
    placeDelivery({ items: [i], agents }, input(over));
  const nobody = { named: false, held: false };

  it('places a branch no plan names, no desk holds and no PR covers under You › Unblock', () => {
    expect(placed(branch(nobody)).items).toEqual([
      { id: 'branch:feature/x', kind: 'branch', section: 'you', group: 'unblock', reason: 'loose', agents: [] },
    ]);
  });

  it('does not call the same branch loose while a desk holds it', () => {
    const p = placed(branch({ ...nobody, held: true }));
    expect(p.items[0]).toMatchObject({ section: 'work-items' });
  });

  it('does not call it loose while a registry manifest holds it, though no desk was read', () => {
    const p = placed(branch({ named: false, held: true }));
    expect(p.items.map((i) => i.reason)).not.toContain('loose');
  });

  it('places an open PR nobody works on as a loose PR', () => {
    const p = placed(openPr({ ...nobody, fixing: false }));
    expect(p.items[0]).toMatchObject({ kind: 'pr', section: 'you', group: 'unblock', reason: 'loose' });
  });

  it('does not call an open PR loose while a fixer runs on it', () => {
    const p = placed(openPr({ ...nobody, fixing: true }));
    expect(p.items[0]).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
  });

  it('does not call an item loose when a plan names it, whatever its state', () => {
    for (const stage of ['queued', 'building', 'pr'] as const) {
      const named = branch({ named: true, held: false, fixing: false }, { stage, pr: { ci: 'passed', review: 'passed' } });
      expect(placed(named).items.map((i) => i.reason)).not.toContain('loose');
    }
  });

  it('lists an item whose loose reading lacks a fact as unread, never loose', () => {
    for (const loose of [{}, { named: false }, { held: false }, { named: false, held: false }]) {
      const p = placed(openPr(loose));
      expect(p.items).toEqual([]);
      expect(p.unplaced).toEqual([{ id: 'branch:fix/y', subject: 'item', reason: 'unread' }]);
    }
    expect(placed(branch({ named: false })).unplaced).toHaveLength(1);
  });

  it('asks nothing of an item with no loose reading', () => {
    expect(placed(openPr(undefined)).items[0]).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
  });

  it('leaves a merged item to the delivered rule', () => {
    const p = placed(openPr({ ...nobody, fixing: false }, { delivered: true }));
    expect(p.unplaced).toEqual([{ id: 'branch:fix/y', subject: 'item', reason: 'delivered' }]);
  });

  it('keeps a PR that waits for review under Review a result, ahead of loose', () => {
    const p = placed(openPr({ ...nobody, fixing: false }, { pr: { ci: 'passed', review: 'pending' } }), { autoReview: false });
    expect(p.items[0]).toMatchObject({ group: 'review-a-result', reason: 'review-pr' });
  });

  it('applies the Mine filter to a loose item as it does to any Unblock item', () => {
    const stuck = (ownership: 'mine' | 'theirs' | 'unknown') =>
      item({ id: 's', stage: 'pr', pr: failedCi, corrections: 2, ownership });
    for (const ownership of ['mine', 'theirs', 'unknown'] as const) {
      for (const mine of ['off', 'mine', 'strict'] as const) {
        const a = placed(branch(nobody, { ownership }), { mine }).items[0]!;
        const b = placed(stuck(ownership), { mine }).items[0]!;
        expect(a.section).toBe(b.section);
      }
    }
    expect(placed(branch(nobody, { ownership: 'theirs' }), { mine: 'mine' }).items[0]!.section).toBe('work-items');
    expect(placed(branch(nobody, { ownership: 'mine' }), { mine: 'strict' }).items[0]!.section).toBe('you');
  });
});

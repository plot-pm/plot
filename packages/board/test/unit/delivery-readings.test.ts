import { describe, it, expect } from 'vitest';
import { placeDelivery } from '@plot-pm/domain';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import {
  deliveryMapping,
  sliceItemId,
  type DeliveryMapInput,
  type RegistryAgent,
} from '../../src/app/lib/agent-rows/delivery-readings.js';

const reader = { hostUser: 'me' };

const row = (over: Record<string, unknown>): AgentRow => ({
  branch: '', plan: '', wave: '', kind: 'branch', phase: 'Development', state: 'wip',
  group: 'working', pr: null, question: null, blockedBy: null,
  assignee: '', author: '', approver: '', ...over,
}) as unknown as AgentRow;

const pr = (over: Record<string, unknown>) => ({ state: 'pending', open: true, ...over });

const slice = (name: string, over: Record<string, unknown> = {}): Slice => ({
  plan: 'p', name, branches: [], verdict: 'eligible', section: 'building', complete: false,
  planSliceCount: 1, ...over,
}) as unknown as Slice;

const agent = (over: Record<string, unknown>): RegistryAgent => ({
  session: 's', branch: '', state: 'running', pid: 1, ...over,
}) as unknown as RegistryAgent;

const input = (over: Partial<DeliveryMapInput>): DeliveryMapInput => ({
  rows: [], slices: [], agents: [], drafts: [], reader, mode: 'all',
  config: { autoReview: true, correctionBudget: 2 }, ...over,
});

const place = (m: ReturnType<typeof deliveryMapping>) => placeDelivery(m.readings, m.input);

describe('deliveryMapping', () => {
  const mixed = input({
    rows: [
      row({ branch: 'feature/a', plan: 'p', wave: 'A', state: 'wip', pr: pr({ ciChecks: 'failing' }) }),
      row({ branch: 'feature/b', plan: 'p', wave: 'B', state: 'wip' }),
      row({ branch: 'feature/orphan', pr: pr({ ciChecks: 'green', plotReview: 'success' }) }),
      row({ branch: 'feature/nociread', plan: 'p', wave: 'C', pr: pr({ state: 'unknown' }) }),
      row({ branch: 'feature/lost', plan: 'p', wave: 'D', group: null }),
    ],
    slices: ['A', 'B', 'C', 'D'].map((n) => slice(n)),
    agents: [
      agent({ session: 'fix', branch: 'feature/a', role: 'fixer' }),
      agent({ session: 'dead', branch: 'feature/b', state: 'failed' }),
    ],
  });

  it('places every row and agent exactly once, in a section or in unplaced', () => {
    const m = deliveryMapping(mixed);
    const p = place(m);
    const ids = [...p.items.map((i) => i.id), ...p.agents.map((a) => a.id), ...p.unplaced.map((u) => u.id)];
    const expected = [...m.readings.items.map((i) => i.id), ...m.readings.agents.map((a) => a.id)];
    expect(ids.sort()).toEqual(expected.sort());
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of mixed.rows) expect(Object.values(m.rowsByItem).flat()).toContain(r);
  });

  it('lists a row with no CI reading as unplaced for unread', () => {
    const p = place(deliveryMapping(mixed));
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'C'), subject: 'item', reason: 'unread' });
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'D'), subject: 'item', reason: 'unread' });
  });

  it('puts a slice with a fixer at a gate, the fixer in Fleet working, and the slice out of You', () => {
    const p = place(deliveryMapping(mixed));
    const a = p.items.find((i) => i.id === sliceItemId('p', 'A'));
    expect(a).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
    expect(p.agents.find((x) => x.id === 'agent:fix')).toMatchObject({ section: 'fleet', group: 'working' });
    expect(p.items.filter((i) => i.section === 'you').map((i) => i.id)).not.toContain(sliceItemId('p', 'A'));
  });

  it('puts a dead agent on a slice under You to unblock and the agent under Fleet blocked', () => {
    const p = place(deliveryMapping(mixed));
    expect(p.items.find((i) => i.id === sliceItemId('p', 'B'))).toMatchObject({ section: 'you', group: 'unblock' });
    expect(p.agents.find((x) => x.id === 'agent:dead')).toMatchObject({ group: 'blocked' });
  });

  it('flips a green PR between At a gate and You with the Auto-review key', () => {
    const rows = [row({ branch: 'feature/o', pr: pr({ ciChecks: 'green', plotReview: 'pending' }) })];
    const on = place(deliveryMapping(input({ rows, config: { autoReview: true, correctionBudget: 2 } })));
    const off = place(deliveryMapping(input({ rows, config: { autoReview: false, correctionBudget: 2 } })));
    expect(on.items[0]).toMatchObject({ section: 'work-items', group: 'at-a-gate' });
    expect(off.items[0]).toMatchObject({ section: 'you', group: 'review-a-result' });
  });

  it('passes the Mine mode and both config keys through unchanged', () => {
    const m = deliveryMapping(input({ mode: 'mine', config: { autoReview: false, correctionBudget: 5 } }));
    expect(m.input).toEqual({ mine: 'strict', autoReview: false, correctionBudget: 5 });
  });

  it('leaves a row it cannot read absent instead of defaulting it', () => {
    const m = deliveryMapping(mixed);
    const c = m.readings.items.find((i) => i.id === sliceItemId('p', 'C'))!;
    expect(c.pr?.ci).toBe('unread');
    expect(c.gateUnpassable).toBeUndefined();
    expect(c.mergeConflict).toBeUndefined();
    const lost = m.readings.items.find((i) => i.id === sliceItemId('p', 'D'))!;
    expect(lost.stage).toBeUndefined();
  });
});

describe('absent config keys', () => {
  it('carries no autoReview or correctionBudget the payload did not state', () => {
    const m = deliveryMapping(input({ config: {} }));
    expect('autoReview' in m.input && m.input.autoReview !== undefined).toBe(false);
    expect('correctionBudget' in m.input && m.input.correctionBudget !== undefined).toBe(false);
  });
});

describe('deliveryMapping phase words', () => {
  const placed = (phase: string) => {
    const m = deliveryMapping(input({
      rows: [row({ branch: 'feature/x', plan: 'p', wave: 'X', phase, state: 'wip', pr: pr({ ciChecks: 'green', plotReview: 'success' }) })],
      slices: [slice('X')],
    }));
    return place(m);
  };

  it('reads Discovery as a plan waiting for input to the fleet', () => {
    expect(placed('Discovery').items[0]).toMatchObject({ section: 'you', group: 'input-to-the-fleet', reason: 'draft-plan' });
  });

  it('reads Design as a plan waiting for input to the fleet', () => {
    expect(placed('Design').items[0]).toMatchObject({ section: 'you', group: 'input-to-the-fleet', reason: 'draft-plan' });
  });

  it('reads Development as a work item', () => {
    expect(placed('Development').items[0]).toMatchObject({ section: 'work-items' });
  });

  it('reads Testing as delivered', () => {
    const p = placed('Testing');
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'X'), subject: 'item', reason: 'delivered' });
  });

  it('reads Released as delivered', () => {
    const p = placed('Released');
    expect(p.items).toEqual([]);
    expect(p.unplaced).toContainEqual({ id: sliceItemId('p', 'X'), subject: 'item', reason: 'delivered' });
  });

  it('leaves an unknown phase word absent', () => {
    expect(placed('approved').items[0]).toMatchObject({ section: 'work-items' });
  });
});

describe('deliveryMapping PR checks', () => {
  const ciOf = (state: string) => deliveryMapping(input({
    rows: [row({ branch: 'feature/x', plan: 'p', wave: 'X', pr: pr({ state }) })],
    slices: [slice('X')],
  })).readings.items[0]!.pr?.ci;

  it('reads no checks as a reading, not as unread', () => {
    expect(ciOf('none')).toBe('passed');
  });

  it('reads a host that cannot report as unread', () => {
    expect(ciOf('unknown')).toBe('unread');
  });
});

describe('release lines', () => {
  const tickets = {
    open: [{ releases: ['2.32.0'] }, { releases: [] }, {}],
    closed: [{ releases: ['2.32.0'] }],
    closedComplete: true,
    closedSince: '2026-10-27T00:00:00Z',
  };
  const lines = (over: Partial<DeliveryMapInput>) => placeMapping(deliveryMapping(input(over))).releaseLines;

  it('gives one line per distinct target release, with the ticket counts', () => {
    const out = lines({
      releaseTickets: tickets,
      sprints: [
        { release: '2.32.0', started: '2026-11-03' },
        { release: '2.33.0', started: '2026-11-10' },
        { release: '2.32.0', started: '2026-11-04' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('0 of 0 slices delivered · 0 held at gates · 0 blocked · 2.32.0 tickets: closed 1 · planned 1 · untriaged 1');
    expect(out[1]).toContain('2.33.0 tickets: closed 0 · planned 0 · untriaged 1');
  });

  it('keeps the slice counts alone where no sprint names a release', () => {
    expect(lines({ releaseTickets: tickets, sprints: [{ release: '', started: '' }] }))
      .toEqual(['0 of 0 slices delivered · 0 held at gates · 0 blocked']);
  });

  it('keeps the slice counts alone where the index is missing', () => {
    expect(lines({ releaseTickets: null, sprints: [{ release: '2.32.0', started: '' }] }))
      .toEqual(['0 of 0 slices delivered · 0 held at gates · 0 blocked']);
  });
});

import { describe, it, expect } from 'vitest';
import type { HeaderMeter, HeaderNumber } from '../src/rules/delivery-header.js';
import { SLICE_STATES } from '../src/rules/slice-states.js';
import {
  fleetSummary,
  MACHINE_CHIP_SHARE,
  machineSummary,
  notPlacedSummary,
  releaseSummary,
  ticketsSummary,
  workSummary,
  youSummary,
  type SummaryChip,
  type SummaryPart,
} from '../src/rules/section-summary.js';

const num = (key: string, count: number, words: string, tone: HeaderNumber['tone']): HeaderNumber => ({ key, count, words, tone });
const chips = (parts: SummaryPart[]): SummaryChip[] => parts.filter((p): p is SummaryChip => p.kind === 'chip');
const chipOf = (parts: SummaryPart[], key: string): SummaryChip | undefined => chips(parts).find((c) => c.key === key);
const meter = (key: string, share: number | null, tone: HeaderMeter['tone'], text = ''): HeaderMeter => ({ key, label: key, share, text, tone });

const youNumbers = (blocks: number, input: number, unblock: number) => [
  num('blocks-delivery', blocks, 'blocks delivery', 'red'),
  num('input-to-the-fleet', input, 'input', 'amber'),
  num('unblock', unblock, 'unblock', 'grey'),
];

describe('releaseSummary', () => {
  const bar = SLICE_STATES.map((state, i) => ({ state, count: i }));
  const counts = [{ key: 'plans' as const, count: 6, words: 'plans', target: null }];

  it('draws the five states in order, and sums them', () => {
    const [first] = releaseSummary({ bar, blockedPlans: 0, counts });
    expect(first).toEqual({ kind: 'bar', segments: bar, total: 0 + 1 + 2 + 3 + 4 });
  });

  it('shows the blocked chip grey at 0 and red above 0', () => {
    expect(chipOf(releaseSummary({ bar, blockedPlans: 0, counts }), 'blocked')).toMatchObject({ text: '■ 0 blocked', tone: 'zero' });
    expect(chipOf(releaseSummary({ bar, blockedPlans: 2, counts }), 'blocked')).toMatchObject({ text: '■ 2 blocked', tone: 'red', count: 2 });
  });

  it('names the plan count, and an unread count only above 0', () => {
    const parts = releaseSummary({ bar, blockedPlans: 0, counts: [...counts, { key: 'unread', count: 1, words: 'not read', target: null }] });
    expect(parts).toContainEqual({ kind: 'text', key: 'plans', text: '6 plans' });
    expect(chipOf(parts, 'unread')).toMatchObject({ text: '! 1 not read', tone: 'amber' });
    expect(chipOf(releaseSummary({ bar, blockedPlans: 0, counts }), 'unread')).toBeUndefined();
  });

  it('says 1 plan in the singular, and 0 plans where the line names no count', () => {
    expect(releaseSummary({ bar, blockedPlans: 0, counts: [{ key: 'plans', count: 1, words: 'plan', target: null }] })).toContainEqual({ kind: 'text', key: 'plans', text: '1 plan' });
    expect(releaseSummary({ bar, blockedPlans: 0, counts: [] })).toContainEqual({ kind: 'text', key: 'plans', text: '0 plans' });
  });
});

describe('youSummary and workSummary', () => {
  it('shows a zero count grey and a counted one in its tone', () => {
    expect(chips(youSummary({ numbers: youNumbers(1, 0, 3), unread: null })).map((c) => [c.text, c.tone])).toEqual([
      ['● 1 blocks delivery', 'red'],
      ['◆ 0 input', 'zero'],
      ['⑂ 3 unblock', 'grey'],
    ]);
  });

  it('reads a 0 as unknown while an item is unread, and says how many', () => {
    const parts = youSummary({ numbers: youNumbers(1, 0, 0), unread: { count: 2, text: '! 2 not read' } });
    expect(chipOf(parts, 'input-to-the-fleet')).toMatchObject({ text: '◆ ? input', count: null, tone: 'unread' });
    expect(chipOf(parts, 'blocks-delivery')).toMatchObject({ count: 1, tone: 'red' });
    expect(chipOf(parts, 'unread')).toMatchObject({ count: 2, tone: 'amber' });
  });

  it('colours Work items by group and shortens the oldest wait', () => {
    const parts = workSummary({
      numbers: [num('at-a-gate', 2, 'at a gate', 'amber'), num('being-built', 0, 'being built', 'plain'), num('queued', 4, 'queued', 'plain')],
      unread: null,
      oldest: 'oldest waits 2d',
    });
    expect(chips(parts).map((c) => [c.key, c.tone])).toEqual([['at-a-gate', 'amber'], ['being-built', 'zero'], ['queued', 'blue']]);
    expect(parts.at(-1)).toEqual({ kind: 'text', key: 'oldest', text: 'oldest 2d' });
  });

  it('gives a key it does not know no icon, and Work items no oldest text where no item has an age', () => {
    expect(chipOf(youSummary({ numbers: [num('other', 2, 'other', 'amber')], unread: null }), 'other')).toMatchObject({ text: ' 2 other', tone: 'amber' });
    const parts = workSummary({ numbers: [num('other', 2, 'other', 'amber')], unread: null, oldest: null });
    expect(parts).toEqual([{ kind: 'chip', key: 'other', text: ' 2 other', count: 2, tone: 'blue' }]);
  });
});

describe('fleetSummary', () => {
  const marks = [
    { key: 'dispatch' as const, on: true, text: '✓ dispatch' },
    { key: 'review' as const, on: true, text: '✓ review' },
    { key: 'verify' as const, on: false, text: '– verify' },
    { key: 'design' as const, on: false, text: '– design' },
  ];

  it('draws one circle per agent and counts the switches that are on', () => {
    const parts = fleetSummary({ circles: ['working', 'blocked', 'free'], line: '1 working · 1 blocked · 1 free', status: null, kind: 'counts', unread: null, marks });
    expect(parts[0]).toEqual({ kind: 'circles', circles: ['working', 'blocked', 'free'] });
    expect(chipOf(parts, 'auto')).toMatchObject({ text: 'auto 2 of 4', tone: 'blue' });
    expect(chipOf(parts, 'status')).toBeUndefined();
  });

  it('shows a stopped fleet red and an unread one as unknown', () => {
    const off = marks.map((m) => ({ ...m, on: false }));
    const stopped = fleetSummary({ circles: [], line: null, status: 'fleet stopped', kind: 'stopped', unread: null, marks: off });
    expect(chipOf(stopped, 'status')).toMatchObject({ text: '■ fleet stopped', tone: 'red' });
    expect(chipOf(stopped, 'auto')).toMatchObject({ text: 'auto 0 of 4', tone: 'zero' });
    const unknown = fleetSummary({ circles: [], line: null, status: 'fleet not read yet', kind: 'unread', unread: null, marks });
    expect(chipOf(unknown, 'status')).toMatchObject({ text: '? fleet not read yet', tone: 'unread' });
  });
});

describe('machineSummary', () => {
  it('shows a host limit only above the threshold', () => {
    const at = machineSummary({ meters: [meter('load', 0.2, 'green'), meter('GraphQL', MACHINE_CHIP_SHARE, 'amber')] });
    expect(chips(at).map((c) => c.key)).toEqual(['load']);
    const above = machineSummary({ meters: [meter('load', 0.2, 'green'), meter('GraphQL', 0.57, 'amber'), meter('REST', 0.95, 'red')] });
    expect(chips(above).map((c) => [c.text, c.tone])).toEqual([
      ['✓ load ok', 'green'],
      ['◔ GraphQL 57% used', 'amber'],
      ['◔ REST 95% used', 'red'],
    ]);
  });

  it('reads an unmeasured load as unknown and names a rate-limited host with no share', () => {
    const parts = machineSummary({ meters: [meter('load', null, 'grey'), meter('host', null, 'red', 'rate limited until 10:04')] });
    expect(chips(parts).map((c) => [c.text, c.tone])).toEqual([
      ['? load not measured', 'unread'],
      ['● rate limited until 10:04', 'red'],
    ]);
  });

  it('takes a threshold', () => {
    expect(chips(machineSummary({ meters: [meter('load', 0.1, 'green'), meter('GraphQL', 0.3, 'green')] }, 0.25)).map((c) => c.key)).toEqual(['load', 'GraphQL']);
  });
});

describe('ticketsSummary and notPlacedSummary', () => {
  it('shows each ticket count, grey at 0, and an unread unassigned count as unknown', () => {
    const parts = ticketsSummary({ state: 'rows', assigned: 2, others: 0, unassigned: null, hidden: 1 });
    expect(chips(parts).map((c) => [c.text, c.tone])).toEqual([
      ['◉ 2 assigned to me', 'blue'],
      ['0 others', 'zero'],
      ['? unassigned', 'unread'],
      ['1 hidden by filter', 'grey'],
    ]);
  });

  it('counts the unassigned tickets where the read carries them', () => {
    expect(chipOf(ticketsSummary({ state: 'rows', assigned: 0, others: 0, unassigned: 3, hidden: 0 }), 'unassigned')).toMatchObject({ text: '3 unassigned', count: 3, tone: 'grey' });
  });

  it('gives no count while the tracker gave no rows', () => {
    expect(ticketsSummary({ state: 'failed', assigned: 0, others: 0, unassigned: 0, hidden: 0 })).toEqual([
      { kind: 'chip', key: 'tickets', text: '? tickets unread', count: null, tone: 'unread' },
    ]);
  });

  it('counts the not-placed entries, grey at 0', () => {
    expect(notPlacedSummary(3)).toEqual([{ kind: 'chip', key: 'not-placed', text: '3 not placed', count: 3, tone: 'amber' }]);
    expect(chipOf(notPlacedSummary(0), 'not-placed')?.tone).toBe('zero');
  });
});

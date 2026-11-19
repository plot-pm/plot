import { describe, expect, it } from 'vitest';
import { reasonVerb, todoList, youCaseOf, TICKETS_ANCHOR, type ItemPlacement, type TodoItem, type YouReason } from '../src/index.js';

const you = (id: string, reason: YouReason): TodoItem => {
  const c = youCaseOf(reason);
  const placement: ItemPlacement = { id, kind: 'plan', section: 'you', group: c.group, marker: c.marker, reason, agents: [] };
  return { placement, label: id, anchor: `delivery-item-${id}` };
};
const work = (id: string): TodoItem => ({
  placement: { id, kind: 'plan', section: 'work-items', group: 'queued', reason: null, agents: [] },
  label: id, anchor: `delivery-item-${id}`,
});
const items = [you('b', 'loose'), you('a', 'plan-approval'), you('c', 'draft-plan'), you('d', 'plan-approval'), work('w')];
const ask = (over = {}) => todoList({ items, ticketAnswer: 'answered', tickets: [], ...over });

describe('todoList', () => {
  it('carries the placement marker of each reason, one line per You item', () => {
    const t = ask();
    expect(t.lines.map((l) => [l.id, l.marker])).toEqual([
      ['a', 'blocks-delivery'], ['d', 'blocks-delivery'], ['c', 'input'], ['b', 'clean-up'],
    ]);
    expect(t.lines.map((l) => l.markerWords)).toEqual(['blocks delivery', 'blocks delivery', 'input', 'clean up']);
    for (const l of t.lines) expect(l.marker).toBe(youCaseOf(items.find((i) => i.placement.id === l.id)!.placement.reason as YouReason).marker);
  });

  it('counts the markers apart and the counts add up to the lines', () => {
    const t = ask();
    expect(t.header).toBe('You block 2 deliveries · the fleet waits for 1 input · 1 to clean up');
    expect(t.counts['blocks-delivery'] + t.counts.input + t.counts['clean-up']).toBe(t.lines.length);
  });

  it('prints only non-zero parts and says "You block nothing" for none', () => {
    expect(ask({ items: [you('x', 'loose')] }).header).toBe('1 to clean up');
    expect(ask({ items: [you('x', 'plan-approval')] }).header).toBe('You block 1 delivery');
    expect(ask({ items: [work('w')] }).header).toBe('You block nothing');
    expect(ask({ items: [] }).lines).toEqual([]);
  });

  it('words each line verb first with the row DO verb', () => {
    const t = ask({ items: [you('p', 'spike-approval')] });
    expect(t.lines[0]!.text).toBe('Approve spike p');
    expect(t.lines[0]!.text.toLowerCase().startsWith(reasonVerb('spike-approval'))).toBe(true);
  });

  it('gives one order for any input order: marker, reason, id', () => {
    const mixed = [you('z', 'plan-approval'), you('m', 'release-approval'), you('a', 'plan-approval'), you('q', 'loose'), you('r', 'draft-plan')];
    const order = (xs: TodoItem[]) => ask({ items: xs }).lines.map((l) => l.id);
    expect(order(mixed)).toEqual(['m', 'a', 'z', 'r', 'q']);
    expect(order([...mixed].reverse())).toEqual(order(mixed));
    expect(order([mixed[3]!, mixed[0]!, mixed[4]!, mixed[2]!, mixed[1]!])).toEqual(order(mixed));
  });

  it('counts tickets as the Tickets section does and reads an absent answer as not read', () => {
    const tickets = [{ ownership: 'mine' }, { ownership: 'unknown' }, { ownership: 'theirs' }, { ownership: 'mine' }];
    const t = ask({ tickets });
    expect(t.tickets).toBe(2);
    expect(t.triageText).toBe('2 tickets assigned to you with no plan');
    expect(t.triageAnchor).toBe(TICKETS_ANCHOR);
    const n = ask({ tickets, ticketAnswer: null });
    expect(n.tickets).toBeNull();
    expect(n.triageText).toContain('not read');
    expect(n.triageText).not.toMatch(/\b0\b/);
    expect(ask({ tickets, ticketAnswer: 'failed' }).tickets).toBeNull();
  });
});

describe('todoList verb and label', () => {
  it('rejoins to text for every line, releases included', () => {
    const t = ask({ releases: [{ id: 'release:2.0', label: '2.0', anchor: 'release-card' }] });
    expect(t.lines.some((l) => l.id === 'release:2.0')).toBe(true);
    for (const l of t.lines) {
      expect(l.verb).not.toBe('');
      expect(l.label).not.toBe('');
      expect(`${l.verb} ${l.label}`).toBe(l.text);
    }
    expect(t.lines.find((l) => l.id === 'a')).toMatchObject({ verb: 'Approve', label: 'a' });
  });
});

// The Delivery tab's sprint card: end line, bar, tier progress and which sprints it shows.
import { describe, it, expect } from 'vitest';
import {
  parsePersonDirectory,
  sprintCards,
  sprintEndLine,
  type CountedSlice,
  type DeliveryInput,
  type DeliveryReadings,
  type Reader,
  type SprintCardSprint,
  type WorkItemReading,
} from '../src/index.js';

const input: DeliveryInput = { mine: 'off', autoReview: true, correctionBudget: 2 };
const reader: Reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht') };
const sliceItem = (id: string, extra: Partial<WorkItemReading> = {}): WorkItemReading => ({ id, kind: 'slice', ownership: 'mine', stage: 'queued', ...extra });
const merged = (id: string): CountedSlice => ({ id, merge: 'merged' });
const open = (id: string): CountedSlice => ({ id, merge: 'open' });
const sprint = (over: Partial<SprintCardSprint> = {}): SprintCardSprint => ({
  slug: 's1', title: 'Sprint one', release: '2.32.0', end: '2026-11-20', ownerHandle: 'jwloka', members: [], ...over,
});
const member = (slug: string, tier: 'must' | 'should' | 'could' | 'deferred', checked = false) => ({ slug, tier, checked, known: true });
const none: DeliveryReadings = { items: [], agents: [] };

describe('sprintEndLine', () => {
  it('writes 2026-11-20 in full', () => expect(sprintEndLine('2026-11-20')).toBe('ends Friday, 20 November'));
  it('prints nothing for an empty or unparseable date', () => {
    for (const end of ['', 'soon', '2026-13-01', '2026-02-30', '20 Nov']) expect(sprintEndLine(end)).toBe('');
  });
  it('does not depend on the locale', () => {
    const before = process.env.LANG;
    process.env.LANG = 'de_DE.UTF-8';
    try {
      expect(sprintEndLine('2026-11-20')).toBe('ends Friday, 20 November');
    } finally {
      if (before === undefined) delete process.env.LANG; else process.env.LANG = before;
    }
  });
});

describe('sprintCards', () => {
  const plans = new Map<string, CountedSlice[]>([
    ['a', [merged('slice:a')]],
    ['b', [open('slice:b')]],
  ]);
  const readings: DeliveryReadings = { items: [sliceItem('slice:b')], agents: [] };

  it('draws five segments that add up to total, with unread outside the sum', () => {
    const view = sprintCards([sprint({ members: [member('a', 'must'), member('b', 'must')] })], reader, plans, readings, input);
    const card = view.cards[0]!;
    expect(card.bar!.map((s) => s.state)).toEqual(['delivered', 'blocked', 'at-a-gate', 'being-built', 'not-started']);
    expect(card.bar!.reduce((n, s) => n + s.count, 0)).toBe(card.total);
    expect(card.total).toBe(2);
    const unread = new Map<string, CountedSlice[]>([['a', [open('slice:gone')]]]);
    const partial = sprintCards([sprint({ members: [member('a', 'must')] })], reader, unread, none, input).cards[0]!;
    expect(partial.total).toBe(0);
    expect(partial.bar!.reduce((n, s) => n + s.count, 0)).toBe(0);
  });

  it('counts a plan named by two members once', () => {
    const card = sprintCards([sprint({ members: [member('a', 'must'), member('a', 'should')] })], reader, plans, none, input).cards[0]!;
    expect(card.total).toBe(1);
  });

  it('shows no bar and a missing flag where a plan has no merge answer', () => {
    const card = sprintCards([sprint({ members: [member('a', 'must'), member('zzz', 'must')] })], reader, plans, none, input).cards[0]!;
    expect(card.bar).toBeNull();
    expect(card.readingMissing).toBe(true);
    expect(card.tiers).toEqual([]);
    expect(card.tierLine).toBe('');
  });

  it('gives one card per owned sprint and none to a reader who owns none', () => {
    const two = sprintCards([sprint(), sprint({ slug: 's2' }), sprint({ slug: 's3', ownerHandle: 'eins78' })], reader, plans, none, input);
    expect(two.cards.map((c) => c.slug)).toEqual(['s1', 's2']);
    const nobody = sprintCards([sprint({ ownerHandle: 'eins78' })], reader, plans, none, input);
    expect(nobody.cards).toEqual([]);
    expect(nobody.unknownOwners).toEqual([]);
  });

  it('does not show a sprint whose Owner People does not declare, and names it beside an owned one', () => {
    const view = sprintCards([sprint(), sprint({ slug: 's9', ownerHandle: 'ghost' })], reader, plans, none, input);
    expect(view.cards.map((c) => c.slug)).toEqual(['s1']);
    expect(view.unknownOwners).toEqual([{ slug: 's9', handle: 'ghost' }]);
  });

  it('counts per tier, excludes deferred and prints no segment for an empty tier', () => {
    const card = sprintCards([sprint({
      members: [member('a', 'must'), member('b', 'must', true), member('a', 'should'), member('b', 'deferred')],
    })], reader, plans, none, input).cards[0]!;
    // b is ticked but its plan is not delivered: disputed, not done.
    expect(card.tiers.map((t) => t.text)).toEqual(['Must 1/2', 'Should 1/1']);
    expect(card.tierLine).toBe('Must 1/2 · Should 1/1');
  });

  it('scores a bare ticked item as done from its checkbox', () => {
    const card = sprintCards([sprint({ members: [member('', 'could', true), member('', 'could')] })], reader, plans, none, input).cards[0]!;
    expect(card.tierLine).toBe('Could 1/2');
  });

  it('does not count a plan with an empty slice list as delivered', () => {
    const empty = new Map<string, CountedSlice[]>([['e', []]]);
    const card = sprintCards([sprint({ members: [member('e', 'must')] })], reader, empty, none, input).cards[0]!;
    expect(card.tierLine).toBe('Must 0/1');
  });

  it('carries the end line and release, and prints none where absent', () => {
    const card = sprintCards([sprint({ end: '', release: '' })], reader, plans, none, input).cards[0]!;
    expect(card.endLine).toBe('');
    expect(card.release).toBe('');
  });
});

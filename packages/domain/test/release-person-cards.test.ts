// The Release delivery person cards: one per sprint owner, a bar per sprint.
import { describe, it, expect } from 'vitest';
import {
  headerCounts,
  parsePersonDirectory,
  planRowFacts,
  releasePersonCards,
  SLICE_STATES,
  sprintCards,
  type CountedSlice,
  type DeliveryInput,
  type DeliveryReadings,
  type PersonCardSprint,
  type Reader,
} from '../src/index.js';
import { countedSlicesByPlan } from '../src/rules/counted-slices.js';

const input: DeliveryInput = { mine: 'off', autoReview: true, correctionBudget: 2 };
const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const none: DeliveryReadings = { items: [], agents: [] };
const merged = (id: string): CountedSlice => ({ id, merge: 'merged' });
const sprint = (over: Partial<PersonCardSprint> = {}): PersonCardSprint => ({
  slug: 's1', title: 'Sprint one', release: '2.32.0', ownerHandle: 'jwloka', members: [], ...over,
});
const member = (slug: string) => ({ slug, tier: 'must' as const, checked: false, known: true });
const plans = new Map<string, CountedSlice[] | undefined>([
  ['a', [merged('slice:a\0one')]],
  ['b', [merged('slice:b\0one')]],
  ['c', [merged('slice:c\0one')]],
]);
const cards = (sprints: PersonCardSprint[], release = '2.32.0', by = plans) =>
  releasePersonCards(sprints, release, directory, by, none, input);

describe('releasePersonCards', () => {
  it('groups two spellings of one person and puts the ownerless sprint on its own card', () => {
    const result = cards([
      sprint({ slug: 's1', ownerHandle: 'jwloka', members: [member('a')] }),
      sprint({ slug: 's2', ownerHandle: 'Jan Wloka', members: [member('b')] }),
      sprint({ slug: 's3', ownerHandle: '', members: [member('c')] }),
    ]);
    expect(result.map((c) => [c.label, c.sprints.map((s) => s.slug)])).toEqual([
      ['jwloka', ['s1', 's2']],
      ['no owner', ['s3']],
    ]);
  });

  it('keeps an ownerless sprint in the release header counts', () => {
    const rows = ['a', 'c'].map((p) => planRowFacts(p, '', [{ name: 'one', state: 'delivered', linked: false, startable: false, waitsFor: '', begun: false }]));
    expect(headerCounts(rows).total).toBe(2);
    const result = cards([sprint({ ownerHandle: '', members: [member('c')] })]);
    expect(result[0]!.label).toBe('no owner');
    expect(result[0]!.sprints[0]!.total).toBe(1);
  });

  it('shows an undeclared Owner under its handle, apart from no owner', () => {
    const result = cards([
      sprint({ slug: 's1', ownerHandle: 'stranger', members: [member('a')] }),
      sprint({ slug: 's2', ownerHandle: '', members: [member('b')] }),
    ]);
    expect(result.map((c) => [c.key, c.label])).toEqual([['raw:stranger', 'stranger'], ['', 'no owner']]);
  });

  it('answers a null bar and the missing text for an unread plan, and the other bars still draw', () => {
    const result = cards([
      sprint({ slug: 's1', members: [member('a'), member('unread')] }),
      sprint({ slug: 's2', members: [member('b')] }),
    ]);
    const [s1, s2] = result[0]!.sprints;
    expect(s1!.bar).toBeNull();
    expect(s1!.readingMissing).toBe(true);
    expect(s1!.missingText).toBe('The merge reading for this sprint is missing.');
    expect(s2!.bar).not.toBeNull();
    expect(s2!.missingText).toBe('');
  });

  it('counts a plan named by two sprints in each bar', () => {
    const result = cards([
      sprint({ slug: 's1', members: [member('a')] }),
      sprint({ slug: 's2', ownerHandle: 'eins78', members: [member('a')] }),
    ]);
    expect(result.flatMap((c) => c.sprints.map((s) => s.total))).toEqual([1, 1]);
  });

  it('draws five segments in state order', () => {
    const result = cards([sprint({ members: [member('a')] })]);
    expect(result[0]!.sprints[0]!.bar!.map((s) => s.state)).toEqual([...SLICE_STATES]);
  });

  it('has no cards for a release no sprint names, and none for another release', () => {
    expect(cards([sprint({ members: [member('a')] })], '')).toEqual([]);
    expect(cards([sprint({ release: '2.33.0' })])).toEqual([]);
  });

  it('agrees with the sprint card on the bar', () => {
    const s = sprint({ members: [member('a'), member('b')] });
    const reader: Reader = { hostUser: 'jwloka', directory };
    const card = sprintCards([{ ...s, end: '' }], reader, plans, none, input).cards[0]!;
    expect(cards([s])[0]!.sprints[0]!.bar).toEqual(card.bar);
  });

  it('agrees with the sprint card on the bar of a sprint whose member is a delivered docs plan', () => {
    const seeded = countedSlicesByPlan({
      seen: ['a'],
      slices: [{ plan: 'a', id: 'slice:a\0one', merge: 'merged' }],
      plans: [{ plan: 'docs-plan', phase: 'delivered', type: 'docs', sliceIds: ['slice:docs-plan\0Docs'], planId: 'slice:docs-plan\0' }],
    });
    const s = sprint({ members: [member('a'), member('docs-plan')] });
    const reader: Reader = { hostUser: 'jwloka', directory };
    const card = sprintCards([{ ...s, end: '' }], reader, seeded, none, input).cards[0]!;
    const person = cards([s], '2.32.0', seeded)[0]!.sprints[0]!;
    expect(person.readingMissing).toBe(false);
    expect(person.bar).not.toBeNull();
    expect(person.bar).toEqual(card.bar);
  });
});

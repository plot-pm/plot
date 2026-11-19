// The Delivery tab header's release cards: binding by version, the bar, the people count, and the Approve button.
import { describe, it, expect } from 'vitest';
import {
  countSliceStatesOver,
  parsePersonDirectory,
  placeDelivery,
  releaseCardApprovable,
  releaseCards,
  releaseTodoEntries,
  todoList,
  NO_RELEASE_TARGETED,
  type CountedSlice,
  type DeliveryInput,
  type DeliveryReadings,
  type ReleaseCardSprint,
  type ReleaseRowReading,
  type WorkItemReading,
} from '../src/index.js';
import type { ReleasePrReading } from '../src/rules/release-approvable.js';

const input: DeliveryInput = { mine: 'off', autoReview: true, correctionBudget: 2 };
const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const none: DeliveryReadings = { items: [], agents: [] };
const noPlans = new Map<string, CountedSlice[]>();
const member = (slug: string, tier: 'must' | 'should' | 'could' | 'deferred' = 'must') => ({ slug, tier, checked: false, known: true });
const sprint = (over: Partial<ReleaseCardSprint> = {}): ReleaseCardSprint => ({
  slug: 's1', release: '2.35.0', ownerHandle: 'jwloka', members: [], ...over,
});
const releaseRow = (over: Partial<ReleaseRowReading> = {}): ReleaseRowReading => ({ id: 'row:release', version: '2.35.0', pr: 300, ...over });
const HEAD = 'a'.repeat(40);
const ready: ReleasePrReading = {
  open: true, headSha: HEAD, checksSha: HEAD, ciChecks: 'green',
  plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD,
};
const cards = (sprints: ReleaseCardSprint[], rows: ReleaseRowReading[], plans: ReadonlyMap<string, readonly CountedSlice[] | undefined> = noPlans, readings = none) =>
  releaseCards(sprints, rows, directory, plans, readings, input);

describe('releaseCards binding', () => {
  it('binds a targeted card to the release row of the same version', () => {
    const [card, ...rest] = cards([sprint()], [releaseRow()]);
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ kind: 'targeted', title: 'Release 2.35.0', rowId: 'row:release', unboundReason: '', stateText: 'release PR #300 open' });
  });

  it('gives a release row and no Active sprint one card with an enabled Approve button', () => {
    const all = cards([], [releaseRow()]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'untargeted', title: 'Release 2.35.0 · no sprint targets it', rowId: 'row:release' });
    expect(releaseCardApprovable(all[0]!, ready, { registered: true })).toEqual({ state: 'enabled', reason: '' });
  });

  it('gives two Release values two cards: one bound, one disabled with its reason', () => {
    const all = cards([sprint({ slug: 'a', release: '2.35.0' }), sprint({ slug: 'b', release: '2.36.0' })], [releaseRow()]);
    expect(all.map((c) => [c.title, c.rowId])).toEqual([['Release 2.35.0', 'row:release'], ['Release 2.36.0', null]]);
    expect(all[1]!.unboundReason).toBe('no release PR carries 2.36.0');
    expect(releaseCardApprovable(all[1]!, ready, { registered: true })).toEqual({ state: 'disabled', reason: 'no release PR carries 2.36.0' });
    expect(all[1]!.stateText).toBe('planned · no release PR yet');
  });

  it('binds the row of the second value where the first value has none', () => {
    const all = cards([sprint({ slug: 'a', release: '2.34.0' }), sprint({ slug: 'b', release: '2.35.0' })], [releaseRow()]);
    expect(all.map((c) => c.rowId)).toEqual([null, 'row:release']);
  });

  it('binds a v-prefixed Release: value to a bare version', () => {
    const all = cards([sprint({ release: 'v2.35.0' })], [releaseRow({ version: '2.35.0' })]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ version: '2.35.0', rowId: 'row:release' });
  });

  it('groups sprints naming one release in two spellings into one card', () => {
    expect(cards([sprint({ slug: 'a', release: '2.35.0' }), sprint({ slug: 'b', release: ' v2.35.0 ' })], [])).toHaveLength(1);
  });

  it('shows the unbound row card and no "No release targeted" where no sprint names a release', () => {
    const all = cards([sprint({ release: '' })], [releaseRow()]);
    expect(all.map((c) => c.kind)).toEqual(['untargeted']);
    expect(all.some((c) => c.title === NO_RELEASE_TARGETED)).toBe(false);
  });

  it('reads "No release targeted" where no sprint names a release and no release row exists', () => {
    const all = cards([sprint({ release: '' })], []);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'none', title: NO_RELEASE_TARGETED, rowId: null, bar: null });
    expect(releaseCardApprovable(all[0]!, null, null).state).toBe('disabled');
    expect(cards([], [])[0]!.title).toBe(NO_RELEASE_TARGETED);
  });

  it('binds no row whose version was not read, and gives it a card of its own', () => {
    const all = cards([sprint()], [releaseRow({ version: '' })]);
    expect(all.map((c) => [c.kind, c.rowId])).toEqual([['targeted', null], ['untargeted', 'row:release']]);
    expect(all[1]!.title).toBe('Release (version not read) · no sprint targets it');
  });

  it('binds one row to at most one card, and keys every card apart', () => {
    const all = cards([sprint()], [releaseRow({ id: 'r1' }), releaseRow({ id: 'r2' })]);
    expect(all.map((c) => c.rowId)).toEqual(['r1', 'r2']);
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.anchor)).size).toBe(all.length);
  });

  it('defers to releaseApprovable for a bound card, so an unread passkey disables it', () => {
    const [card] = cards([sprint()], [releaseRow()]);
    expect(releaseCardApprovable(card!, ready, null).state).toBe('disabled');
    expect(releaseCardApprovable(card!, null, { registered: true }).state).toBe('disabled');
  });
});

describe('releaseCards bar', () => {
  const plans = new Map<string, CountedSlice[]>([
    ['a', [{ id: 'slice:a', merge: 'merged' }]],
    ['b', [{ id: 'slice:b1', merge: 'open' }, { id: 'slice:b2', merge: 'open' }]],
  ]);
  const item = (id: string, extra: Partial<WorkItemReading> = {}): WorkItemReading => ({ id, kind: 'slice', ownership: 'mine', stage: 'queued', ...extra });
  const readings: DeliveryReadings = { items: [item('slice:b1'), item('slice:b2', { blockedMarker: true, ownership: 'theirs' })], agents: [] };

  it('draws five segments that sum to the total and equal countSliceStatesOver of the union of plans', () => {
    const sprints = [sprint({ slug: 'x', members: [member('a'), member('b')] }), sprint({ slug: 'y', members: [member('b')] })];
    const [card] = cards(sprints, [], plans, readings);
    const want = countSliceStatesOver(plans, ['a', 'b'], readings, input)!;
    expect(card!.bar!.map((s) => s.state)).toEqual(['delivered', 'blocked', 'at-a-gate', 'being-built', 'not-started']);
    expect(card!.bar!.reduce((n, s) => n + s.count, 0)).toBe(card!.total);
    expect(card!.total).toBe(want.total);
    for (const s of card!.bar!) expect(s.count).toBe(want[s.state]);
    expect(card!.bar!.find((s) => s.state === 'blocked')!.count).toBe(1);
  });

  it('leaves a deferred member and an unknown member out of the bar', () => {
    const sprints = [sprint({ members: [member('a'), member('b', 'deferred'), { ...member('gone'), known: false }] })];
    expect(cards(sprints, [], plans, readings)[0]!.total).toBe(1);
  });

  it('says the reading is missing where a named plan has no merge answer, never a bar of zeros', () => {
    const [card] = cards([sprint({ members: [member('a'), member('unread')] })], [], plans, readings);
    expect(card).toMatchObject({ bar: null, readingMissing: true, missingText: 'The merge reading for this release is missing.' });
  });

  it('gives two readers the same counts from one payload: the rule reads no reader', () => {
    const sprints = [sprint({ members: [member('a'), member('b')] })];
    const mine = releaseCards(sprints, [], parsePersonDirectory('jwloka = Jan Wloka'), plans, readings, input);
    const theirs = releaseCards(sprints, [], parsePersonDirectory('eins78 = Max Albrecht'), plans, readings, { ...input, mine: 'strict' });
    expect(theirs[0]!.bar).toEqual(mine[0]!.bar);
  });
});

describe('releaseCards people', () => {
  it('counts one person for two sprints whose Owners resolve to one person, and no empty Owner', () => {
    const sprints = [
      sprint({ slug: 'a', ownerHandle: 'jwloka' }),
      sprint({ slug: 'b', ownerHandle: 'Jan Wloka' }),
      sprint({ slug: 'c', ownerHandle: '' }),
    ];
    const [card] = releaseCards(sprints, [], directory, noPlans, none, input);
    expect(card).toMatchObject({ people: 1, peopleText: '1 person' });
  });

  it('counts two different Owners as two people', () => {
    const [card] = cards([sprint({ slug: 'a', ownerHandle: 'jwloka' }), sprint({ slug: 'b', ownerHandle: 'eins78' })], []);
    expect(card).toMatchObject({ people: 2, peopleText: '2 people' });
  });
});

describe('the release to-do line', () => {
  it('places no release item under You or Work items and keeps exactly one "Approve release" line in the header sum', () => {
    const readings: DeliveryReadings = {
      items: [
        { id: 'row:release', kind: 'release', ownership: 'unknown', stage: 'pr', pr: { ci: 'passed', review: 'passed' }, approvalOwed: 'release' },
        { id: 'p', kind: 'plan', ownership: 'mine', phase: 'approved', approvalOwed: 'plan' },
      ],
      agents: [],
    };
    const placement = placeDelivery(readings, input);
    expect(placement.items.map((i) => i.id)).toEqual(['p']);
    const all = cards([sprint()], [releaseRow()]);
    const todo = todoList({
      items: placement.items.map((p) => ({ placement: p, label: p.id, anchor: `delivery-item-${p.id}` })),
      releases: releaseTodoEntries(all),
      ticketAnswer: 'answered',
      tickets: [],
    });
    const release = todo.lines.filter((l) => l.text.startsWith('Approve release'));
    expect(release).toEqual([{ id: 'release:2.35.0', text: 'Approve release 2.35.0',
      verb: 'Approve release',
      label: '2.35.0', marker: 'blocks-delivery', markerWords: 'blocks delivery', anchor: all[0]!.anchor }]);
    expect(todo.lines[0]).toBe(release[0]);
    expect(todo.counts['blocks-delivery'] + todo.counts.input + todo.counts['clean-up']).toBe(todo.lines.length);
    expect(todo.header).toBe('You block 2 deliveries');
  });

  it('labels the line of a row whose version was not read, and names a row with no PR as not read', () => {
    const all = cards([], [releaseRow({ version: '', pr: null })]);
    expect(all[0]!.stateText).toBe('release PR not read');
    expect(releaseTodoEntries(all)).toEqual([{ id: 'release-row:row:release', label: '(version not read)', anchor: 'release-card-row-row-release' }]);
  });

  it('owes no line for a card no row binds', () => {
    expect(releaseTodoEntries(cards([sprint({ release: '2.36.0' })], []))).toEqual([]);
    expect(releaseTodoEntries(cards([], []))).toEqual([]);
  });
});

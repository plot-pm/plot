// The board's release card adapter: release rows from every payload row, bound to cards, whatever the reader.
import { describe, it, expect } from 'vitest';
import { parsePersonDirectory, placeDelivery } from '@plot-pm/domain';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping, releaseCardsOf, type DeliveryMapInput } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { releaseTodoEntriesOf, todoListOf } from '../../src/app/lib/agent-rows/todo-list.js';
import { youHeaderOf } from '../../src/app/lib/agent-rows/you-header.js';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka');
const reader = { hostUser: 'jwloka', directory };
const releaseRow = (version: string, number: number): AgentRow => ({
  branch: 'changeset-release/main', plan: '', wave: '', kind: 'release', version, phase: '', state: 'open', group: 'review',
  pr: { number, state: 'pending', open: true, headSha: 'a'.repeat(40), ciChecks: 'green', plotReview: 'absent' },
  question: null, blockedBy: null, assignee: '', author: '', approver: '', desk: false, fixerInFlight: false,
}) as unknown as AgentRow;
const row = (plan: string, branch: string): AgentRow => ({
  branch, plan, wave: 'One', kind: 'branch', phase: 'Testing', state: 'merged', group: 'done', pr: null,
  question: null, blockedBy: null, assignee: '', author: '', approver: '',
}) as unknown as AgentRow;
const slice = (plan: string): Slice => ({
  plan, name: 'One', branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1,
}) as unknown as Slice;
const input = (over: Partial<DeliveryMapInput>): DeliveryMapInput => ({
  rows: [], slices: [], agents: [], drafts: [], reader, mode: 'all', config: { autoReview: true, correctionBudget: 2 }, ...over,
});
const sprint = (release: string, members: string[] = []) => ({
  slug: `s-${release}`, release, ownerHandle: 'jwloka', members: members.map((slug) => ({ slug, tier: 'must' as const, checked: false, known: true })),
});

describe('releaseCardsOf', () => {
  it('binds the release row to the card of its version and hands back that row', () => {
    const release = releaseRow('2.35.0', 300);
    const { cards, rows } = releaseCardsOf([sprint('v2.35.0'), sprint('2.36.0')], directory, input({ rows: [release] }));
    expect(cards.map((c) => [c.title, c.stateText])).toEqual([
      ['Release 2.35.0', 'release PR #300 open'],
      ['Release 2.36.0', 'planned · no release PR yet'],
    ]);
    expect(rows[cards[0]!.rowId!]).toBe(release);
    expect(cards[1]!.rowId).toBeNull();
  });

  it('gives a release row with no Active sprint a card of its own', () => {
    const { cards } = releaseCardsOf([], directory, input({ rows: [releaseRow('2.35.0', 300)] }));
    expect(cards.map((c) => [c.kind, c.title])).toEqual([['untargeted', 'Release 2.35.0 · no sprint targets it']]);
  });

  it('counts the Release delivery section\'s plans and slices once no Active sprint names the release', () => {
    const over = { rows: [releaseRow('2.35.0', 300), row('a', 'feature/a'), row('b', 'feature/b')], slices: [slice('a'), slice('b')] };
    const mapping = deliveryMapping(input(over));
    const view = placeMapping(mapping, over.slices, []);
    const { cards } = releaseCardsOf([], directory, input(over), view.releaseCarried);
    const [block] = view.releaseBlocks;
    const counts = Object.fromEntries(block!.counts.map((p) => [p.key, p.count]));
    expect(cards.map((c) => [c.kind, c.title])).toEqual([['untargeted', 'Release 2.35.0']]);
    expect(cards[0]!.total).toBe(2);
    expect(cards[0]!.bar!.find((s) => s.state === 'delivered')!.count).toBe(counts.delivered);
    expect(counts.plans).toBe(2);
  });

  it('draws the same bar for two readers and every Mine mode', () => {
    const over = { rows: [row('a', 'feature/a'), row('b', 'feature/b')], slices: [slice('a'), slice('b')] };
    const mine = releaseCardsOf([sprint('2.35.0', ['a', 'b'])], directory, input({ ...over, mode: 'mine' }));
    const theirs = releaseCardsOf([sprint('2.35.0', ['a', 'b'])], directory, input({ ...over, mode: 'strict', reader: { hostUser: 'eins78' } }));
    expect(mine.cards[0]!.bar).toEqual(theirs.cards[0]!.bar);
    expect(mine.cards[0]!.total).toBe(2);
  });

  it('keeps the release row out of every section and owes one "Approve release" line', () => {
    const rows = [releaseRow('2.35.0', 300)];
    const mapping = deliveryMapping(input({ rows }));
    const placement = placeDelivery(mapping.readings, mapping.input);
    const view = placeMapping(mapping, [], []);
    expect(view.sections.flatMap((s) => s.groups.flatMap((g) => g.items))).toEqual([]);
    const { cards, rows: bound } = releaseCardsOf([sprint('2.35.0')], directory, input({ rows }));
    const todo = todoListOf(view, placement, null, releaseTodoEntriesOf(cards, bound, { registered: true }));
    expect(todo.lines.map((l) => [l.text, l.marker, l.anchor])).toEqual([['Approve release 2.35.0 · CI has not reported on aaaaaaaaa', 'waits', 'release-card-2.35.0']]);
  });

  it('marks the release line blocks delivery, in the to-do list and the You header, only where the approval can run', () => {
    const head = 'a'.repeat(40);
    const ready = releaseRow('2.35.0', 300);
    ready.pr = { ...ready.pr!, checksSha: head, plotReview: 'success', plotReviewSha: head, plotReviewJudged: 'success', plotReviewCheckedSha: head } as AgentRow['pr'];
    const rows = [ready];
    const mapping = deliveryMapping(input({ rows }));
    const placement = placeDelivery(mapping.readings, mapping.input);
    const view = placeMapping(mapping, [], []);
    const { cards, rows: bound } = releaseCardsOf([sprint('2.35.0')], directory, input({ rows }));
    const head2 = (passkey: { registered: boolean } | null) => ({
      todo: todoListOf(view, placement, null, releaseTodoEntriesOf(cards, bound, passkey)),
      you: youHeaderOf({ view, placement, reader, ticketAnswer: null, phaseMap: undefined, stories: [], cards: [], releases: cards, releaseRows: bound, passkey }),
    });
    const enabled = head2({ registered: true });
    expect(enabled.todo.lines.map((l) => [l.text, l.marker])).toEqual([['Approve release 2.35.0', 'blocks-delivery']]);
    expect(enabled.you.counts.find((c) => c.key === 'blocks-delivery')?.count).toBe(1);
    const unregistered = head2({ registered: false });
    expect(unregistered.todo.lines.map((l) => [l.text, l.marker])).toEqual([['Approve release 2.35.0 · Register a passkey in Settings first', 'waits']]);
    expect(unregistered.todo.header).toBe('You block nothing');
    expect(unregistered.you.counts.find((c) => c.key === 'blocks-delivery')?.count).toBe(0);
    expect(head2(null).todo.lines[0]!.marker).toBe('waits');
  });
});

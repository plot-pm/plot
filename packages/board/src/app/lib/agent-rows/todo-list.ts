import { releaseTodoEntries, todoList, type DeliveryPlacement, type IssueAnswer, type TodoItem, type ReleaseCardView, type ReleaseTodoEntry, type TodoList } from '@plot-pm/domain';
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import type { ReleasePrReading } from '@plot-pm/domain/rules/release-approvable';
import type { AgentRow } from '../../../contract/schema.js';
import { releaseReadingOf } from '../release-approve.js';
import type { DeliveryView } from './delivery-view.js';

/**
 * The release approvals the cards owe, over each bound row's PR reading and the passkey answer.
 *
 * @param cards - the release cards.
 * @param rows - the bound rows by `rowId` (`releaseCardsOf`'s `rows`).
 * @param held - the passkey registration answer, `null` while unread.
 * @returns `releaseTodoEntries` of the cards.
 */
export const releaseTodoEntriesOf = (
  cards: readonly ReleaseCardView[],
  rows: Readonly<Record<string, AgentRow>>,
  held: PasskeyRegistration | null,
): ReleaseTodoEntry[] => {
  const prs: Record<string, ReleasePrReading> = {};
  for (const [id, row] of Object.entries(rows)) {
    const reading = releaseReadingOf(row.pr);
    if (reading !== null) prs[id] = reading;
  }
  return releaseTodoEntries(cards, prs, held);
};

/** The to-do list the Delivery tab renders: the domain's list over the same items the You section renders, and one line per release card a release row binds. */
export const todoListOf = (
  view: DeliveryView,
  placement: DeliveryPlacement,
  ticketAnswer: IssueAnswer | null,
  releases: readonly ReleaseTodoEntry[] = [],
): TodoList => {
  const items: TodoItem[] = view.sections.flatMap((s) =>
    s.groups.flatMap((g) => g.items.flatMap((i) => (i.placement === null ? [] : [{ placement: i.placement, label: i.label, anchor: i.anchor }]))));
  return todoList({ items, ticketAnswer, tickets: placement.tickets, releases });
};

import type { TicketLaneRow } from './ticket-lanes.js';

/** The fields `CreatePlanButton`/`CreateStoryButton` read, mapped from a `TicketLaneRow` rather than force-cast from one. */
export interface TicketCardIssueRow {
  readonly kind: 'ticket';
  readonly number: string;
  readonly title: string;
  readonly url: string;
  readonly ageMinutes: null;
  readonly status: string;
  readonly statusCategory: string;
  readonly assignees: string[];
  readonly type: string | null;
  readonly owner: string | null;
}

/**
 * Maps a ticket row to the shape `CreatePlanButton` and `CreateStoryButton`
 * read. `assignees` and `ageMinutes` are synthesized defaults — neither
 * button reads them meaningfully.
 *
 * @param row - the ticket, as `ticketLanes` grouped it.
 * @returns the row mapped for the two buttons.
 */
export const ticketCardIssueRow = (row: TicketLaneRow): TicketCardIssueRow => ({
  kind: 'ticket',
  number: row.id,
  title: row.title,
  url: row.url,
  ageMinutes: null,
  status: row.status,
  statusCategory: row.statusCategory,
  assignees: [],
  type: row.type,
  owner: row.owner,
});

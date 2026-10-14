import type { TicketLane } from './ticket-lane.js';
import type { TicketLaneRow } from './ticket-lanes.js';

/** Minutes in each unit the age text steps through. */
const MINUTE_MS = 60 * 1000;

/**
 * The ticket's state icon — `open` or `closed`, read from the same fields the
 * Done lane uses, never re-asking `ticketLane` for a question it already
 * answered.
 *
 * @param closedAt - the row's `closedAt`, as `ticketLanes.ts`'s `rowOf` carries it through.
 * @returns `closed` where the tracker recorded a close date, `open` otherwise.
 */
export const ticketCardIcon = (closedAt: string | null): 'open' | 'closed' => (closedAt === null ? 'open' : 'closed');

/**
 * The shorthand a ticket's title is prefixed with — a numeric id reads as
 * `#id`, stripped to `id` for the prefix itself since the card writes the
 * `#`/number convention in its own markup; a Jira-shaped id (carries a
 * non-digit) is used verbatim as its key.
 *
 * @param id - the row's `id`, as the tracker spells it.
 * @returns the shorthand to prefix the title with, e.g. `1688` or `PROJ-12`.
 */
export const ticketCardShorthand = (id: string): string => id;

/**
 * The repository or tracker reference a ticket's `url` names, or `''` where
 * the url cannot be read — never a guessed reference.
 *
 * A GitHub or Bitbucket issue url gives `owner/repo#number`; a Jira browse
 * url gives the issue key alone, since Jira carries no repository. Anything
 * else, including an empty url, answers `''` and the card shows the
 * shorthand alone.
 *
 * @param url - the row's `url`, as the tracker reported it.
 * @returns the reference text, or `''` where none is readable.
 */
export const ticketCardReference = (url: string): string => {
  const issuePath = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url);
  if (issuePath) return `${issuePath[1]}/${issuePath[2]}#${issuePath[3]}`;
  const jiraPath = /\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(url);
  if (jiraPath) return jiraPath[1];
  return '';
};

/**
 * The compact age text a ticket's `createdAt` reads as — `10m`, `2h`, `3d`,
 * `1mo` — matching the board's own `tupleAgeText` step points, reimplemented
 * here since the domain package cannot import from the board.
 *
 * @param createdAt - the row's `createdAt`, or `null` where the tracker gave no date.
 * @param now - the current time in epoch milliseconds.
 * @returns the age text, or `null` where `createdAt` cannot be read.
 */
export const ticketCardAge = (createdAt: string | null, now: number): string | null => {
  if (createdAt === null) return null;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;
  const minutes = Math.max(0, Math.floor((now - created) / MINUTE_MS));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
};

/**
 * The muted second line's text — the reference and the age, joined where
 * both are readable, falling back to whichever one is.
 *
 * @param reference - {@link ticketCardReference}'s answer.
 * @param age - {@link ticketCardAge}'s answer.
 * @returns the second line's text, or `''` where neither is readable.
 */
export const ticketCardSubtitle = (reference: string, age: string | null): string => {
  const agePart = age === null ? '' : `opened ${age} ago`;
  if (reference === '' && agePart === '') return '';
  if (reference === '') return agePart;
  if (agePart === '') return reference;
  return `${reference} · ${agePart}`;
};

/** Whether a ticket card shows its *Create plan* / *Create story* actions — a function of its lane, not its status fields. */
export const ticketCardShowsActions = (lane: TicketLane): boolean => lane === 'open' || lane === 'in-progress';

/** Everything `TicketRowView` needs to render one ticket card. */
export interface TicketCardView {
  /** The state icon — `open` or `closed`. */
  readonly icon: 'open' | 'closed';
  /** The shorthand-prefixed title, e.g. `1688: The Jira project scope: …`. */
  readonly heading: string;
  /** The muted second line — the reference and age, or `''` where neither is readable. */
  readonly subtitle: string;
  /** The ticket's own url, unchanged, for the first line's link. */
  readonly url: string;
  /** Whether *Create plan* / *Create story* show for this row. */
  readonly showsActions: boolean;
}

/**
 * Everything a ticket card needs to render, from the row the board already
 * carries and the lane the caller already knows.
 *
 * @param row - the ticket, as `ticketLanes` grouped it.
 * @param lane - the lane the caller is rendering this row in.
 * @param now - the current time in epoch milliseconds.
 * @returns the card's rendering data.
 */
export const ticketCardView = (
  row: TicketLaneRow,
  lane: TicketLane,
  now: number,
): TicketCardView => {
  const reference = ticketCardReference(row.url);
  const age = ticketCardAge(row.createdAt, now);
  return {
    icon: ticketCardIcon(row.closedAt),
    heading: `${ticketCardShorthand(row.id)}: ${row.title}`,
    subtitle: ticketCardSubtitle(reference, age),
    url: row.url,
    showsActions: ticketCardShowsActions(lane),
  };
};

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
});

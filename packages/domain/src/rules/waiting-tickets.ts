import type { IssueIndexRow } from '../entities/issue-index.js';
import { declaresSpelling, resolvePerson, type PersonDirectory } from '../entities/person.js';
import { ownership, type OwnedRow, type Reader, type TicketSource } from './ownership.js';

/** One open ticket, shaped for the client — the fields `IssueRow` carries. */
export interface WaitingTicket {
  readonly kind: 'ticket';
  readonly number: string;
  readonly title: string;
  readonly url: string;
  readonly ageMinutes: number | null;
  readonly status: string;
  readonly statusCategory: string;
  /** The tracker's own logins or accounts assigned — [] where the tracker states none. */
  readonly assignees: readonly string[];
}

/** What *Waiting on you* shows, and why. */
export interface WaitingTickets {
  /** The rows to render, newest first, cut to `ISSUE_LIMIT` by the caller. */
  readonly tickets: readonly WaitingTicket[];
  /** How many of the unplanned rows are in the union this answers. */
  readonly shown: number;
  /** How many unplanned rows this answers does not include. */
  readonly hidden: number;
  /** Whether the rows given were every open row, or the read's own cap stopped first. */
  readonly complete: boolean;
  /** The sentence naming why the reader is unmatched, or why none is assigned; `null` for a matched reader. */
  readonly notice: string | null;
}

const ageMinutesOf = (createdAt: string | undefined, now: number): number | null => {
  if (createdAt === undefined) return null;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((now - at) / 60_000));
};

const toWaitingTicket = (row: IssueIndexRow, now: number): WaitingTicket => ({
  kind: 'ticket',
  number: row.number,
  title: row.title,
  url: row.url,
  ageMinutes: ageMinutesOf(row.createdAt, now),
  status: row.status ?? '',
  statusCategory: row.statusCategory ?? '',
  assignees: row.assignees ?? [],
});

const byNewestFirst = (a: IssueIndexRow, b: IssueIndexRow): number => {
  const at = (row: IssueIndexRow): number => {
    const parsed = row.createdAt === undefined ? NaN : Date.parse(row.createdAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return at(b) - at(a);
};

const ownedTicket = (row: IssueIndexRow, source: TicketSource | null): OwnedRow => ({
  kind: 'ticket',
  assignees: row.assignees,
  source,
});

/**
 * Whether any of `reader`'s declared handle's `prefix`-spellings name an
 * assignee of `row`. Only called once `declaresAnyAccountSpelling` has
 * confirmed `reader.directory` declares at least one `prefix`-spelling, so
 * the directory here is never empty.
 */
const accountMatches = (row: IssueIndexRow, prefix: string, directory: PersonDirectory, reader: Reader): boolean => {
  const login = reader.hostUser?.trim() ?? '';
  if (login === '') return false;
  const self = resolvePerson(login, directory);
  for (const assignee of row.assignees ?? []) {
    const spelling = `${prefix}${assignee.trim()}`;
    if (!declaresSpelling(spelling, directory)) continue;
    if (resolvePerson(spelling, directory).handle === self.handle) return true;
  }
  return false;
};

/** Whether `reader` declares any `prefix`-spelling at all. */
const declaresAnyAccountSpelling = (directory: PersonDirectory, prefix: string): boolean =>
  Object.keys(directory).some((key) => key.startsWith(prefix));

const unionDedup = (inbox: readonly IssueIndexRow[], mine: readonly IssueIndexRow[]): IssueIndexRow[] => {
  const seen = new Set<string>();
  const union: IssueIndexRow[] = [];
  for (const row of [...inbox, ...mine]) {
    if (seen.has(row.number)) continue;
    seen.add(row.number);
    union.push(row);
  }
  return union.sort(byNewestFirst);
};

const ISSUE_LIMIT = 50;

/**
 * Decides which unplanned open tickets *Waiting on you* shows, how many it
 * hides, and the notice explaining an unmatched reader.
 *
 * A matched reader — a resolvable host login, or a declared `prefix`-spelling
 * that names at least one candidate row's assignee — sees the union of
 * `inbox` and the rows `ownership` over `{ kind: 'ticket', assignees, source
 * }` answers `mine` for, newest first, without duplicates. `mine` is required
 * rather than `isMine`'s looser "not theirs": an unassigned row is `unknown`,
 * and the default view hides it rather than showing it as if it matched. An
 * unmatched reader — no host login, a `null` source, or a declared
 * `tracker-account` reader whose spellings name no candidate's assignee —
 * sees `inbox`, or every row where `inbox` is absent, with a notice naming why.
 *
 * `rows` and `inbox` are read exactly as given; the caller holds the
 * `ISSUE_LIMIT` cap and the unplanned filter upstream of this rule.
 *
 * @param rows - every unplanned open row the read holds.
 * @param inbox - the unplanned rows of the reader's own tracker-account read, where one exists.
 * @param reader - who is reading.
 * @param source - how this read's tickets name their assignees, or `null`.
 * @param complete - whether `rows` is every open row, or the read's cap stopped first.
 * @returns the rows to show, the shown/hidden counts, and the notice.
 */
export const waitingTickets = (
  rows: readonly IssueIndexRow[],
  inbox: readonly IssueIndexRow[] | undefined,
  reader: Reader,
  source: TicketSource | null,
  complete: boolean,
): WaitingTickets => {
  const now = Date.now();
  const total = rows.length;

  const render = (selected: readonly IssueIndexRow[], notice: string | null): WaitingTickets => ({
    tickets: selected.slice(0, ISSUE_LIMIT).map((row) => toWaitingTicket(row, now)),
    shown: selected.length,
    hidden: total - selected.length,
    complete,
    notice,
  });

  if (source === null) {
    const everyRow = [...rows].sort(byNewestFirst);
    return render(everyRow, `The board knows no ticket owner for this source — showing ${Math.min(total, ISSUE_LIMIT)} of ${total} open tickets.`);
  }

  if (source.match === 'host-login') {
    const login = reader.hostUser?.trim() ?? '';
    if (login === '' || login.includes('@')) {
      const everyRow = [...rows].sort(byNewestFirst);
      return render(everyRow, `The board knows no host login for you — showing ${Math.min(total, ISSUE_LIMIT)} of ${total} open tickets.`);
    }
    const mine = rows.filter((row) => ownership(ownedTicket(row, source), reader) === 'mine');
    const union = unionDedup(inbox ?? [], mine);
    return render(union, null);
  }

  // tracker-account: matched only through a declared `prefix`-spelling.
  const directory = reader.directory ?? {};
  const prefix = source.prefix;
  if (!declaresAnyAccountSpelling(directory, prefix)) {
    const fallback = inbox !== undefined ? [...inbox].sort(byNewestFirst) : [...rows].sort(byNewestFirst);
    return render(fallback, null);
  }

  const candidates = inbox !== undefined ? inbox : rows;
  const matched = candidates.some((row) => accountMatches(row, prefix, directory, reader));
  if (!matched && candidates.length > 0) {
    const raw = candidates
      .flatMap((row) => row.assignees ?? [])
      .map((value) => value.trim())
      .find((value) => value !== '');
    const login = reader.hostUser?.trim() ?? '';
    const self = resolvePerson(login, directory);
    const declaredSpelling = Object.entries(directory).find(
      ([key, handle]) => key.startsWith(prefix) && handle === self.handle,
    )?.[0];
    const fallback = [...candidates].sort(byNewestFirst);
    const notice =
      raw === undefined
        ? null
        : declaredSpelling !== undefined
          ? `The tracker names your tickets' assignee \`${raw}\`; \`People\` declares \`${declaredSpelling}\` for ${self.handle} — add \`${prefix}${raw}\` to match.`
          : `The tracker names your tickets' assignee \`${raw}\`, and \`People\` declares no \`${prefix}\` spelling for ${self.handle} — add \`${prefix}${raw}\` to match.`;
    return render(fallback, notice);
  }

  const mine = rows.filter((row) => ownership(ownedTicket(row, source), reader) === 'mine');
  const union = unionDedup(inbox ?? [], mine);
  return render(union, null);
};

/**
 * The sentence naming how many unplanned tickets are not assigned to the
 * reader.
 *
 * @param hidden - how many unplanned rows are not shown.
 * @param complete - whether `hidden` counts every open row, or the read's cap stopped first.
 * @returns the sentence, with *at least* where `complete` is false.
 */
export const hiddenSentence = (hidden: number, complete: boolean): string =>
  complete
    ? `${hidden} open tickets are not assigned to you`
    : `at least ${hidden} open tickets are not assigned to you`;

/**
 * The sentence naming how many of the open tickets are rendered.
 *
 * @param n - how many rows are rendered.
 * @param total - `shown` + `hidden`, the full unplanned count.
 * @param complete - whether `total` counts every open row, or the read's cap stopped first.
 * @returns the sentence, with *at least* where `complete` is false.
 */
export const shownSentence = (n: number, total: number, complete: boolean): string =>
  complete ? `Showing ${n} of ${total} open tickets.` : `Showing ${n} of at least ${total} open tickets.`;

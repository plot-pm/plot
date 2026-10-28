import type { InboxAnswer, IssueIndexRow } from '../entities/issue-index.js';
import { declaresSpelling, resolvePerson, type PersonDirectory } from '../entities/person.js';
import { accountNamesReader, ownership, type OwnedRow, type Reader, type TicketSource } from './ownership.js';
import { ownerOf, typeOf } from './ticket-lanes.js';
import { allFinished, ticketPhase, type TicketPlan } from './ticket-phase.js';

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
  /** The tracker's own word for the kind of work, lowercased; `null` where it stated none. */
  readonly type: string | null;
  /** An assignee, resolved through `People` the same way the Discovery card resolves it; `null` where nobody is assigned. */
  readonly owner: string | null;
}

/** What *Waiting on you* shows, and why. */
export interface WaitingTickets {
  /** The rows to render — unplanned first, then planned, each newest first — cut to `ISSUE_LIMIT` by the caller. */
  readonly tickets: readonly WaitingTicket[];
  /** How many of the open rows, planned or not, are in the union this answers. */
  readonly shown: number;
  /** How many open rows this answers does not include. */
  readonly hidden: number;
  /** Of `hidden`, how many carry no assignee at all. */
  readonly unassigned: number;
  /** Of `hidden`, how many carry an assignee — just not one this answers selected. */
  readonly assignedToOthers: number;
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

const toWaitingTicket = (
  row: IssueIndexRow,
  now: number,
  source: TicketSource | null,
  reader: Reader,
  phase: string | null,
): WaitingTicket => ({
  kind: 'ticket',
  number: row.number,
  title: row.title,
  url: row.url,
  ageMinutes: ageMinutesOf(row.createdAt, now),
  status: phase ?? row.status ?? '',
  statusCategory: row.statusCategory ?? '',
  assignees: row.assignees ?? [],
  type: typeOf(row.type),
  owner: ownerOf(row.assignees, { source, directory: reader.directory }, reader),
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
 * rather than the looser "not theirs" test: an unassigned row is `unknown`,
 * and the default view hides it rather than showing it as if it matched. An
 * unmatched reader — no host login, a `null` source, or a declared
 * `tracker-account` reader whose spellings name no candidate's assignee —
 * sees `inbox`, with a notice naming why. Where `inbox` is absent on a
 * `tracker-account` source, `inboxAnswer` decides what stands in for it. An
 * `unaskable` read means the open read is already person-scoped, so `rows`
 * are the reader's own tickets and serve as the candidates; an absent
 * `inboxAnswer` (unknown) does the same. A `failed` or `not-read` inbox
 * answers 0 tickets and a notice saying the inbox could not be read or was
 * not read: there `rows` say whose tickets exist project-wide, and the rule
 * never guesses the reader's spelling from them. A `host-login` source is
 * unaffected — its matched reader is found through `ownership`, never through
 * `inbox` as a stand-in for `rows`.
 *
 * `rows` and `inbox` are read exactly as given, planned rows included; the
 * caller holds the `ISSUE_LIMIT` cap. A row that a plan in `plans` names shows
 * {@link ticketPhase}'s label as its `status` — except on a `tracker-account` source, whose
 * rows keep the tracker's own state — and the rendered rows list the
 * unplanned ones first, then the planned ones, each newest first. A row is
 * unplanned when `plans` names no plan for it. A row for which
 * {@link allFinished} answers `true` is left out of `tickets`, `shown` and
 * `hidden`; `hidden` counts only the open rows not selected for the reader.
 *
 * @param rows - every open row the read holds.
 * @param inbox - the rows of the reader's own tracker-account read; `undefined` where the read did not happen, never collapsed with `rows` or `[]`.
 * @param reader - who is reading.
 * @param source - how this read's tickets name their assignees, or `null`.
 * @param complete - whether `rows` is every open row, or the read's cap stopped first.
 * @param plans - the plans naming each ticket, keyed by the row's `number`; absent for an unplanned ticket.
 * @param inboxAnswer - how the inbox read ended; absent where the caller does not know.
 * @returns the rows to show, the shown/hidden counts, and the notice.
 */
export const waitingTickets = (
  rows: readonly IssueIndexRow[],
  inbox: readonly IssueIndexRow[] | undefined,
  reader: Reader,
  source: TicketSource | null,
  complete: boolean,
  plans: ReadonlyMap<string, readonly TicketPlan[]> = new Map(),
  inboxAnswer?: InboxAnswer,
): WaitingTickets => {
  const now = Date.now();
  const total = rows.length;
  // A tracker-account source states its own workflow state, which stays; only its place in the list follows the plan.
  const keepsTrackerState = source?.match === 'tracker-account';

  const render = (selected: readonly IssueIndexRow[], notice: string | null): WaitingTickets => {
    const finished = (row: IssueIndexRow): boolean => allFinished(plans.get(row.number) ?? []);
    const phased = selected
      .map((row) => ({ row, rowPlans: plans.get(row.number) ?? [] }))
      .filter(({ rowPlans }) => !allFinished(rowPlans))
      .map(({ row, rowPlans }) => ({ row, unplanned: rowPlans.length === 0, phase: ticketPhase(rowPlans) }));
    const picked = new Set(selected.map((row) => row.number));
    const hiddenRows = rows.filter((row) => !picked.has(row.number) && !finished(row));
    return {
      tickets: [
        ...phased.filter(({ unplanned }) => unplanned),
        ...phased.filter(({ unplanned }) => !unplanned),
      ]
        .slice(0, ISSUE_LIMIT)
        .map(({ row, phase }) => toWaitingTicket(row, now, source, reader, keepsTrackerState ? null : phase?.label ?? null)),
      shown: phased.length,
      hidden: hiddenRows.length,
      unassigned: hiddenRows.filter((row) => (row.assignees ?? []).length === 0).length,
      assignedToOthers: hiddenRows.filter((row) => (row.assignees ?? []).length > 0).length,
      complete,
      notice,
    };
  };

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
  if (inbox === undefined && inboxAnswer === 'failed') {
    return render([], 'The inbox could not be read — showing none of your tickets rather than the project\'s.');
  }
  if (inbox === undefined && (inboxAnswer === 'not-read' || inboxAnswer === 'answered')) {
    return render([], 'The inbox was not read — showing none of your tickets rather than the project\'s.');
  }
  // An unaskable inbox read leaves the person-scoped open rows as the reader's own.
  const candidates = inbox ?? rows;
  const directory = reader.directory ?? {};
  const prefix = source.prefix;
  if (!declaresAnyAccountSpelling(directory, prefix)) {
    return render(unionDedup(candidates, []), null);
  }

  const matched = candidates.some((row) => accountNamesReader(row.assignees ?? [], prefix, reader));
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
    const fallback = unionDedup(candidates, []);
    const suggestedTakenByAnother =
      raw !== undefined &&
      declaresSpelling(`${prefix}${raw}`, directory) &&
      resolvePerson(`${prefix}${raw}`, directory).handle !== self.handle;
    const notice =
      raw === undefined || suggestedTakenByAnother
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
 * The sentence naming how many open tickets are not assigned to the reader,
 * and how many of those carry no assignee at all.
 *
 * @param hidden - how many open rows are not shown.
 * @param complete - whether `hidden` counts every open row, or the read's cap stopped first.
 * @param unassigned - of `hidden`, how many carry no assignee at all.
 * @param assignedToOthers - of `hidden`, how many carry an assignee that is not the reader.
 * @returns the sentence, with *at least* where `complete` is false, naming both counts.
 */
export const hiddenSentence = (hidden: number, complete: boolean, unassigned: number, assignedToOthers: number): string => {
  const lead = complete ? `${hidden} open tickets are not assigned to you` : `at least ${hidden} open tickets are not assigned to you`;
  const unassignedPart = `${unassigned} unassigned`;
  const assignedPart = `${assignedToOthers} assigned to someone else`;
  if (unassigned > 0 && assignedToOthers > 0) return `${lead} — ${unassignedPart}, ${assignedPart}`;
  if (unassigned > 0) return `${lead} — ${unassignedPart}`;
  if (assignedToOthers > 0) return `${lead} — ${assignedPart}`;
  return lead;
};

/**
 * The sentence naming how many of the open tickets are rendered.
 *
 * @param n - how many rows are rendered.
 * @param total - `shown` + `hidden`, the full open count.
 * @param complete - whether `total` counts every open row, or the read's cap stopped first.
 * @returns the sentence, with *at least* where `complete` is false.
 */
export const shownSentence = (n: number, total: number, complete: boolean): string =>
  complete ? `Showing ${n} of ${total} open tickets.` : `Showing ${n} of at least ${total} open tickets.`;

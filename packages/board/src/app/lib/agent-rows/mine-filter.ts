import { isMine, isMineStrict, ownedTicket, ownership, readerIsKnown, type MineMode, type OwnedRow, type Reader } from '@plot-pm/domain';
import { type AgentEntry, type AgentRow, type Board, type Card, type DraftPlan, type IssueRow, type TicketSourceShape } from '../../../contract/schema.js';

/**
 * Where the "only my work" preference lives.
 *
 * `localStorage`, in the same namespace as the collapse set, and for the reason
 * `collapse.ts` states at length: **a URL is shareable, and this is not worth
 * sharing.** A link carrying `?mine=1` would hide rows belonging to whoever
 * opened it — the reader's own work vanishing as a side effect of "have a look
 * at this", which is worse than a link that remembers nothing.
 *
 * Persistence itself is not optional. This board is left running and reloaded
 * several times an hour, and a filter that forgets teaches the reader not to
 * use it.
 */
const MINE_KEY = 'plot-board:agents:mine-only';

/**
 * Where the stricter "hide unknown too" preference lives.
 *
 * The sibling of {@link MINE_KEY}: same `localStorage` namespace, same
 * silent-failure discipline, same `'1'`-is-on convention. Absent reads as off,
 * so a reader who never touches the stricter control sees exactly the view
 * {@link MINE_KEY} alone has always produced.
 */
const MINE_STRICT_KEY = 'plot-board:agents:mine-strict';

/**
 * Whether the filter starts on.
 *
 * **OFF, and the asymmetry with `COLLAPSED_BY_DEFAULT` is the design rather
 * than an inconsistency beside it.** Collapse defaults to *collapsed* because a
 * first visit should not ship the crowded view, and folding hides a count the
 * header still prints. This hides ROWS, and a board that withholds somebody
 * else's work from a reader who never asked is a board that lies by omission —
 * the reader cannot tell a quiet estate from a filtered one.
 *
 * So a first visit shows everything, and hiding is only ever something the
 * reader did.
 *
 * Exported for test: a mechanism copied wholesale from `collapse.ts` would
 * arrive with that module's default, and every assertion about the control
 * working would still pass.
 */
export const MINE_ONLY_BY_DEFAULT = false;

/**
 * Read the stored preference, falling back to {@link MINE_ONLY_BY_DEFAULT}.
 *
 * Every failure path yields the default rather than throwing, the discipline
 * `readCollapsed` establishes: `localStorage` throws outright on access in a
 * blocked-cookie context, and a board that renders nothing because it could not
 * remember a checkbox is the worse answer. Here the stakes are higher than they
 * are for a fold — the default is *show everything*, so a storage failure costs
 * the reader nothing at all.
 *
 * Only the string `'1'` reads as on. A stored value from a renamed key, a
 * half-written value, or anything else is stale state, and treating it as on
 * would hide rows nobody asked to hide.
 *
 * Exported for test.
 */
export const readMineOnly = (storage?: Pick<Storage, 'getItem'>): boolean => {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(MINE_KEY) ?? null;
    if (raw === null) return MINE_ONLY_BY_DEFAULT;
    return raw === '1';
  } catch {
    return MINE_ONLY_BY_DEFAULT;
  }
};

/** Persist the preference. Silent on failure — see {@link readMineOnly}. */
export const writeMineOnly = (on: boolean, storage?: Pick<Storage, 'setItem'>): void => {
  try {
    (storage ?? globalThis.localStorage)?.setItem(MINE_KEY, on ? '1' : '0');
  } catch {
    // A reader who cannot persist still gets a working checkbox this session.
  }
};

/**
 * Read the stored strict-mode preference, defaulting to off.
 *
 * Same discipline as {@link readMineOnly}: any failure, or any stored value
 * other than `'1'`, reads as off.
 *
 * Exported for test.
 */
export const readMineStrict = (storage?: Pick<Storage, 'getItem'>): boolean => {
  try {
    return ((storage ?? globalThis.localStorage)?.getItem(MINE_STRICT_KEY) ?? null) === '1';
  } catch {
    return false;
  }
};

/** Persist the strict-mode preference. Silent on failure — see {@link readMineStrict}. */
export const writeMineStrict = (on: boolean, storage?: Pick<Storage, 'setItem'>): void => {
  try {
    (storage ?? globalThis.localStorage)?.setItem(MINE_STRICT_KEY, on ? '1' : '0');
  } catch {
    // A reader who cannot persist still gets a working checkbox this session.
  }
};

/**
 * A branch row as the ownership rule reads it.
 *
 * A row with a PR is a `pr` row and matches on the author's handle, whatever
 * its plan fields say — the PR author is a host handle compared exactly, the
 * plan fields are free text resolved through `People`, and the two arms are
 * deliberately not merged. A row without a PR but with a plan naming an
 * assignee, author or approver is a `plan` row, resolved the same way the
 * Discovery card's `assignee`/`author`/`approver` fields are. A row with
 * neither — including a `build` row: a build of `main` belongs to nobody in
 * particular, and a build of a branch is owned by whoever owns the branch,
 * which no fact on the row says — names no owner at all. **The branch name is
 * deliberately not consulted** — `feature/jw-something` looks like a claim of
 * ownership and is not one, and guessing from it would invent an owner the
 * row never carried; a row without a PR and without a plan owner still names
 * none.
 *
 * Every field here is `''` where the plan (or the host, for `pr.author`) did
 * not answer, and `undefined` on a payload the client cast from an older
 * server. Both reach {@link isMine} as unknown, which shows the row — so the
 * values are passed through here rather than normalised, the way
 * {@link ownedFromCard} already does.
 */
export const ownedFromRow = (row: Pick<AgentRow, 'pr' | 'assignee' | 'author' | 'approver'>): OwnedRow => {
  if (row.pr) return { kind: 'pr', author: row.pr.author };
  return row.assignee || row.author || row.approver
    ? { kind: 'plan', assignee: row.assignee, author: row.author, approver: row.approver }
    : { kind: 'other' };
};

/**
 * A registry agent as the ownership rule reads it.
 *
 * `identity` says whether a manifest declared the agent or the registry
 * inferred it from a desk, and `state` says whether that desk is on this
 * machine. The rule wants both; neither is re-derived here.
 */
export const ownedFromAgent = (agent: Pick<AgentEntry, 'identity' | 'state'>): OwnedRow =>
  ({ kind: 'agent', identity: agent.identity, state: agent.state });

/**
 * A plan card as the ownership rule reads it — its assignee, author and
 * approver.
 *
 * Each is `''` or absent where the plan names nobody. The rule resolves all
 * three through the reader's directory; nothing is resolved here.
 */
export const ownedFromCard = (card: Pick<Card, 'assignee' | 'author' | 'approver'>): OwnedRow =>
  ({ kind: 'plan', assignee: card.assignee, author: card.author, approver: card.approver });

/**
 * Who is reading, as the ownership rule wants it — the identity fields
 * `ServerInfo` carries, and the `People` directory beside them.
 *
 * All are optional on {@link Reader} because the client CASTS the board
 * payload rather than parsing it, so a server from before those fields
 * delivers `undefined` where the schema promises a value. The rule treats
 * absent and empty alike; this passes them through rather than normalising, so
 * it cannot disagree with the rule about what empty means.
 */
export const readerFrom = (
  server?: { hostUser?: string; gitEmail?: string; people?: Record<string, string> },
): Reader => ({ hostUser: server?.hostUser, gitEmail: server?.gitEmail, directory: server?.people });

// RE-EXPORTED, not redefined. `AgentList` renders the "no identity configured"
// hint from this, and importing it alongside `readerFrom` keeps the reader's
// construction and its known-ness in one place rather than reaching back into
// `@plot-pm/domain` a second time for a single function.
export { readerIsKnown };

/**
 * The rows that stay in view, given the reader and the effective «Mine» mode.
 *
 * **`all` RETURNS THE ARRAY UNTOUCHED**, not a copy filtered by a predicate
 * that happens to admit everything: the identity of the array is what lets the
 * caller's `rowsBySection` memoise, and an unfiltered view must cost nothing.
 *
 * `mine-and-unknown` hides a row only where {@link isMine} answers false —
 * which it does only for a row somebody ELSE owns; a row whose owner cannot be
 * determined stays. `mine` keeps only a row {@link isMineStrict} answers true
 * for.
 */
export const rowsForReader = <T extends Pick<AgentRow, 'pr' | 'assignee' | 'author' | 'approver'>>(
  rows: T[],
  reader: Reader,
  mode: MineMode,
): T[] => {
  if (mode === 'all') return rows;
  const owns = mode === 'mine' ? isMineStrict : isMine;
  return rows.filter((r) => owns(ownedFromRow(r), reader));
};

/**
 * The Draft plan rows that stay in view, given the reader and the effective
 * «Mine» mode.
 *
 * `all` returns the array untouched, for the reason {@link rowsForReader}
 * gives. A Draft plan carries the same `assignee`/`author`/`approver` shape a
 * Discovery card does, so it goes through {@link ownedFromCard} rather than a
 * fourth variant of the mapping. `mine-and-unknown` hides a plan only where
 * {@link isMine} answers false, so a plan naming nobody stays visible; `mine`
 * keeps only a plan {@link isMineStrict} answers true for.
 */
export const draftsForReader = (drafts: DraftPlan[], reader: Reader, mode: MineMode): DraftPlan[] => {
  if (mode === 'all') return drafts;
  const owns = mode === 'mine' ? isMineStrict : isMine;
  return drafts.filter((d) => owns(ownedFromCard(d), reader));
};

/**
 * The registry agents that stay in view, given the reader and the effective
 * «Mine» mode.
 *
 * `all` returns the array untouched, for the reason {@link rowsForReader}
 * gives. `mine-and-unknown` hides an agent only where {@link isMine} answers
 * false for {@link ownedFromAgent}; `mine` keeps only an agent
 * {@link isMineStrict} answers true for.
 */
export const agentsForReader = <T extends Pick<AgentEntry, 'identity' | 'state'>>(
  agents: T[],
  reader: Reader,
  mode: MineMode,
): T[] => {
  if (mode === 'all') return agents;
  const owns = mode === 'mine' ? isMineStrict : isMine;
  return agents.filter((a) => owns(ownedFromAgent(a), reader));
};

/**
 * A ticket row as the ownership rule reads it, through the domain's
 * `ownedTicket` — the mapping Discovery's `lanesForReader` uses too.
 *
 * `source` is `null` where the board could not resolve how this read's
 * tickets name their assignees — {@link isMine} then sees `{ source: null }`
 * on the `ticket` arm, which `ticketOwnership` answers `unknown` for, same as
 * an unassigned row. Either way the row stays visible with the filter on.
 */
export const ownedFromTicket = (row: Pick<IssueRow, 'assignees'>, source: TicketSourceShape | null): OwnedRow =>
  ownedTicket(row.assignees, source);

/**
 * The tickets that stay in view, given the reader, how this read's tickets
 * name their assignees, and the effective «Mine» mode.
 *
 * `all` returns the array untouched, for the reason {@link rowsForReader}
 * gives. Otherwise a ticket is hidden only where {@link isMine} answers false
 * for {@link ownedFromTicket} — an unassigned ticket, or one whose owner
 * cannot be determined because `source` is `null`, stays visible.
 *
 * **This filter always uses the lenient `isMine` rule, never the strict one —
 * `mine` mode does not sharpen it.** The panel decided *the box wins*: this
 * view shows every open ticket, narrowed only by the `mine-and-unknown`
 * answer, so an unassigned ticket comes back here even while the stricter
 * mode hides unknown rows everywhere else. *Waiting on you*'s own inbox logic
 * (hide and count an unassigned ticket) lives separately in the domain's
 * `waitingTickets`, applied upstream by the server; this filter narrows what
 * `waitingTickets` already chose to show, the same way `rowsForReader`
 * narrows the sprint-filtered rows.
 */
export const ticketsForReader = <T extends Pick<IssueRow, 'assignees'>>(
  tickets: T[],
  reader: Reader,
  source: TicketSourceShape | null,
  mode: MineMode,
): T[] => (mode === 'all' ? tickets : tickets.filter((t) => isMine(ownedFromTicket(t, source), reader)));

/**
 * The board with only the plan cards that stay in view, how many cards the
 * effective mode hides, and how many cards have no known owner.
 *
 * `all` returns the board untouched and both counts `0`. `unknownCount`
 * counts every card answering `unknown`, before the filter, so it is the
 * same in `mine-and-unknown` and `mine`. Otherwise each column
 * keeps the cards {@link isMine} (`mine-and-unknown`) or {@link isMineStrict}
 * (`mine`) keeps for {@link ownedFromCard}; a card whose assignee is empty or
 * undeclared stays only under the lenient rule. Nothing but the columns'
 * cards changes.
 */
export const boardForReader = (
  board: Board,
  reader: Reader,
  mode: MineMode,
): { board: Board; hiddenCount: number; unknownCount: number } => {
  if (mode === 'all') return { board, hiddenCount: 0, unknownCount: 0 };
  const owns = mode === 'mine' ? isMineStrict : isMine;
  let hiddenCount = 0;
  let unknownCount = 0;
  const columns = board.columns.map((column) => {
    const cards = column.cards.filter((card) => owns(ownedFromCard(card), reader));
    hiddenCount += column.cards.length - cards.length;
    unknownCount += column.cards.filter((card) => ownership(ownedFromCard(card), reader) === 'unknown').length;
    return { ...column, cards };
  });
  return { board: { ...board, columns }, hiddenCount, unknownCount };
};

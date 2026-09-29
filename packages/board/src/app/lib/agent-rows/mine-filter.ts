import { isMine, type OwnedRow, type Reader } from '@plot-pm/domain';
import { type AgentEntry, type AgentRow, type Board, type Card } from '../../../contract/schema.js';

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
 * A branch row as the ownership rule reads it.
 *
 * A row with a PR is a `pr` row and matches on the author's handle; a row
 * without one names no owner at all. That includes a `build` row: a build of
 * `main` belongs to nobody in particular, and a build of a branch is owned by
 * whoever owns the branch, which no fact on the row says. **The branch name is deliberately not
 * consulted** — `feature/jw-something` looks like a claim of ownership and is
 * not one, and guessing from it would invent an owner the row never carried.
 *
 * `author` is `''` where the host did not answer and `undefined` on a payload
 * the client cast from an older server. Both reach {@link isMine} as unknown,
 * which shows the row.
 */
export const ownedFromRow = (row: Pick<AgentRow, 'pr'>): OwnedRow =>
  row.pr ? { kind: 'pr', author: row.pr.author } : { kind: 'other' };

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
 * A plan card as the ownership rule reads it — its `Assignee:` line.
 *
 * `assignee` is `''` where the plan names nobody. The rule resolves it through
 * the reader's directory; nothing is resolved here.
 */
export const ownedFromCard = (card: Pick<Card, 'assignee'>): OwnedRow =>
  ({ kind: 'plan', assignee: card.assignee });

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

/**
 * The rows that stay in view, given the reader and whether the filter is on.
 *
 * **OFF RETURNS THE ARRAY UNTOUCHED**, not a copy filtered by a predicate that
 * happens to admit everything: the identity of the array is what lets the
 * caller's `rowsBySection` memoise, and an unfiltered view must cost nothing.
 *
 * On, a row is hidden only where {@link isMine} answered false — which it does
 * only for a row somebody ELSE owns. A row whose owner cannot be determined
 * stays, so an unconfigured identity (`hostUser: ''`) hides nothing rather than
 * emptying the board.
 */
export const rowsForReader = <T extends Pick<AgentRow, 'pr'>>(
  rows: T[],
  reader: Reader,
  on: boolean,
): T[] => (on ? rows.filter((r) => isMine(ownedFromRow(r), reader)) : rows);

/**
 * The registry agents that stay in view, given the reader and whether the
 * filter is on.
 *
 * Off returns the array untouched, for the reason {@link rowsForReader} gives.
 * On, an agent is hidden only where {@link isMine} answers false for
 * {@link ownedFromAgent}.
 */
export const agentsForReader = <T extends Pick<AgentEntry, 'identity' | 'state'>>(
  agents: T[],
  reader: Reader,
  on: boolean,
): T[] => (on ? agents.filter((a) => isMine(ownedFromAgent(a), reader)) : agents);

/**
 * The board with only the plan cards that stay in view.
 *
 * Off returns the board untouched. On, each column keeps the cards
 * {@link isMine} keeps for {@link ownedFromCard}; a card whose assignee is
 * empty or undeclared stays. Nothing but the columns' cards changes.
 */
export const boardForReader = (board: Board, reader: Reader, on: boolean): Board =>
  on
    ? {
      ...board,
      columns: board.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((card) => isMine(ownedFromCard(card), reader)),
      })),
    }
    : board;

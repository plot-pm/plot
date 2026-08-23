import {
  type WaitingGroup,
} from '../../../contract/schema.js';
import { GROUPS } from './sections.js';

/**
 * The groups that start collapsed.
 *
 * Not a preference — the existing group order made effective. `GROUPS` is
 * already sorted actionable-before-diagnostic, and these two are the diagnostic
 * end: one means *go check whether this died*, the other *this is finished*.
 * Neither needs reading on arrival, and on the live board of 2026-08-16 they
 * cost twenty rows between them and pushed the footer — which reports when the
 * last scan ran — off the screen.
 *
 * Exported for test: a blanket default passes an assertion that checks only one
 * group, so both halves are pinned.
 */
export const COLLAPSED_BY_DEFAULT: WaitingGroup[] = ['quiet', 'done'];

/**
 * Where the collapse state lives.
 *
 * `localStorage`, and that is a deliberate departure. The board's convention for
 * view state is the URL — `?tab=agents`, `?lanes=1`, `?plan=…`, written with
 * `history.replaceState` — and there is no other `localStorage` in the app, so
 * this introduces a second mechanism for what looks like the same kind of state.
 *
 * The distinction that justifies it: **a URL is shareable, and collapse state
 * should not be.** Everything in the query string today is worth sending to
 * someone — *look at this plan*, *look at the agents tab*. A link carrying
 * `?collapsed=quiet,done` would hand my personal tidying to whoever opened it,
 * rebuilding their view as a side effect of "have a look at this". Collapse is
 * convenience, not subject matter.
 *
 * Persistence itself is not optional: this board is left running and reloaded
 * several times an hour, and without it the reader re-configures the view every
 * time — which teaches them not to bother.
 */
const COLLAPSE_KEY = 'plot-board:agents:collapsed';

/**
 * Read the stored collapse set, falling back to the default where nothing is
 * stored.
 *
 * The fallback is the load-bearing half: a first visit has no stored value, and
 * treating that as "nothing collapsed" would ship the crowded view to everyone
 * who has not yet clicked a header. Absent and empty are therefore different —
 * `[]` is a reader who opened everything and meant it.
 *
 * Every failure path yields the default rather than throwing. `localStorage`
 * throws on access in a blocked-cookie context, and a view that renders nothing
 * because it could not remember which sections were folded is a worse answer
 * than one that simply forgets.
 *
 * Exported for test.
 */
export function readCollapsed(storage?: Pick<Storage, 'getItem'>): Set<WaitingGroup> {
  const fallback = new Set(COLLAPSED_BY_DEFAULT);
  let raw: string | null = null;
  try {
    raw = (storage ?? globalThis.localStorage)?.getItem(COLLAPSE_KEY) ?? null;
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    // Filtered against the known groups: a stored key from a renamed group is
    // stale state, and carrying it forward would collapse nothing while looking
    // like it had.
    const known = new Set<string>(GROUPS.map((g) => g.key));
    return new Set(parsed.filter((k): k is WaitingGroup => typeof k === 'string' && known.has(k)));
  } catch {
    return fallback;
  }
}

/** Persist the collapse set. Silent on failure — see `readCollapsed`. */
export function writeCollapsed(
  collapsed: Set<WaitingGroup>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A reader who cannot persist still gets a working toggle for this session.
  }
}

/**
 * Can this group be collapsed at all?
 *
 * An EMPTY group never can. It hides nothing, and its header does not read
 * `(0)` — it reads the group's hint (*still thinking, or dead?*), which is the
 * explanation for the emptiness and exactly what a reader wants when there is
 * nothing to list. A collapse control on a group with nothing to hide is an
 * offer that leads nowhere, the same class of defect as a button that declines
 * its own action — and folding it would hide the hint, which is the only thing
 * in there worth reading.
 *
 * Exported for test: a blanket toggle passes "the control exists" and quietly
 * takes the hint away.
 */
export function isCollapsible(rowCount: number): boolean {
  return rowCount > 0;
}

/**
 * Where the row stops being a row.
 *
 * Arithmetic, not taste: the fixed tracks total 540 px and the gaps and padding
 * add 84 px, so **the grid needs 624 px before the branch column gets a single
 * pixel** — and a 375 px phone is 249 px short. Tailwind's `sm` breakpoint is
 * 640 px, the first stop above that number.
 *
 * The PR track's growth from `9rem` to `14rem` moved that number from 544 px to
 * 624 px and left the breakpoint where it is — 640 px is still the first stop
 * above it, with 16 px to spare. A further widening of any fixed track would
 * cross it, and then this constant has to move too.
 *
 * Below it each row becomes a small block: the branch on its own line, with
 * plan, kind, PR and age wrapped beneath it. **Nothing is dropped and nothing
 * is elided** — the same facts stack instead of ranging. Dropping the plan name
 * was the cheaper answer and is wrong: `showPlanHeading` just made naming the
 * plan the row's own responsibility whenever its group has no heading, and
 * removing it on a phone would re-open at one width the defect closed at every
 * width.
 *
 * The phone is a real reader — the server detects a Tailscale address, so the
 * board is reachable over a private network — and it is a READING surface
 * there: `/api/dispatch` is gated to localhost, so the row's action menu is
 * unavailable by construction rather than by layout.
 */
export const CARD_BELOW_PX = 640;

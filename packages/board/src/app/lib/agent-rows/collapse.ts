import { DELIVERY_LAYOUT } from '@plot-pm/domain';

/** A section or a group of `DELIVERY_LAYOUT`: the keys a collapse toggle holds. */
export type CollapseKey = string;

/** The sections the tab renders after the `DELIVERY_LAYOUT` sections: Tickets and Not placed. */
export const EXTRA_SECTION_KEYS: readonly CollapseKey[] = ['tickets', 'not-placed'];

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  ...DELIVERY_LAYOUT.flatMap(({ section, groups }) => [section, ...groups]),
  ...EXTRA_SECTION_KEYS,
]);

/**
 * The keys that start collapsed: Free agents, which fold into one line, and Not placed, which starts as one header line.
 * The Release delivery section starts open; its one key, `release-delivery`, holds its fold under both scope toggle states.
 *
 * A free agent owes nothing, so it needs no reading on arrival. Stored keys from the earlier vocabulary (`quiet`, `done`) are not in
 * `DELIVERY_LAYOUT` and fall away in `readCollapsed`.
 *
 * Exported for test.
 */
export const COLLAPSED_BY_DEFAULT: CollapseKey[] = ['free', 'not-placed'];

/**
 * Where the collapse state lives.
 *
 * `localStorage`, and that is a deliberate departure. The board's convention for
 * view state is the URL — `?tab=delivery`, `?lanes=1`, `?plan=…`, written with
 * `history.replaceState` — and there is no other `localStorage` in the app, so
 * this introduces a second mechanism for what looks like the same kind of state.
 *
 * The distinction that justifies it: **a URL is shareable, and collapse state
 * should not be.** Everything in the query string today is worth sending to
 * someone — *look at this plan*, *look at the Delivery tab*. A link carrying
 * `?collapsed=quiet,done` would hand my personal tidying to whoever opened it,
 * rebuilding their view as a side effect of "have a look at this". Collapse is
 * convenience, not subject matter.
 *
 * Persistence itself is not optional: this board is left running and reloaded
 * several times an hour, and without it the reader re-configures the view every
 * time — which teaches them not to bother.
 */
const COLLAPSE_KEY = 'plot-board:agents:collapsed';

/** The keys of `COLLAPSED_BY_DEFAULT` already applied to this reader's stored set. */
const DEFAULTS_KEY = 'plot-board:agents:collapsed-defaults';

/**
 * Adds each default key the record does not hold to a stored set, once, and writes the record.
 *
 * A reader who opens such a section afterwards keeps it open: the record then holds the key, so the next read adds nothing.
 */
const withNewDefaults = (kept: Set<CollapseKey>, storage: Partial<Pick<Storage, 'getItem' | 'setItem'>> | undefined): Set<CollapseKey> => {
  let applied: string[] = [];
  try {
    const raw = storage?.getItem?.(DEFAULTS_KEY) ?? null;
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) applied = parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return kept;
  }
  const missing = COLLAPSED_BY_DEFAULT.filter((k) => !applied.includes(k));
  if (missing.length === 0) return kept;
  for (const k of missing) kept.add(k);
  recordDefaults(storage);
  return kept;
};

/** Records every default key as applied. Silent on failure, as `writeCollapsed` is. */
const recordDefaults = (storage: Partial<Pick<Storage, 'setItem'>> | undefined): void => {
  try {
    storage?.setItem?.(DEFAULTS_KEY, JSON.stringify(COLLAPSED_BY_DEFAULT));
  } catch {
    // The defaults are added again on the next read, which folds nothing the reader opened since.
  }
};

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
export function readCollapsed(storage?: Partial<Pick<Storage, 'getItem' | 'setItem'>>): Set<CollapseKey> {
  const fallback = new Set(COLLAPSED_BY_DEFAULT);
  let store: Partial<Pick<Storage, 'getItem' | 'setItem'>> | undefined;
  let raw: string | null = null;
  try {
    store = storage ?? globalThis.localStorage;
    raw = store?.getItem?.(COLLAPSE_KEY) ?? null;
  } catch {
    return fallback;
  }
  if (raw === null) {
    recordDefaults(store);
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    // Filtered against the known groups: a stored key from a renamed group is
    // stale state, and carrying it forward would collapse nothing while looking
    // like it had.
    const kept = parsed.filter((k): k is CollapseKey => typeof k === 'string' && KNOWN_KEYS.has(k));
    // A stored set from the earlier vocabulary holds no current key: it is
    // stale, not a reader who opened everything, so the default applies.
    if (kept.length === 0 && parsed.length > 0) {
      recordDefaults(store);
      return fallback;
    }
    // A default key added since this set was stored joins it once.
    return withNewDefaults(new Set(kept), store);
  } catch {
    return fallback;
  }
}

/** Persist the collapse set. Silent on failure — see `readCollapsed`. */
export function writeCollapsed(
  collapsed: Set<CollapseKey>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // A reader who cannot persist still gets a working toggle for this session.
  }
}

/**
 * Can this GROUP be collapsed at all? A section always can: see `isFoldable`.
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

/** Whether a fold control folds a section or a group of one. */
export type FoldLevel = 'section' | 'group';

/** The Fleet groups that never fold: an agent at work or at a gate is what the section is read for. */
export const ALWAYS_OPEN_GROUPS: readonly CollapseKey[] = ['working', 'blocked'];

/**
 * Whether a section or group has a fold control.
 *
 * @param level - `section` or `group`.
 * @param rowCount - the rows the section or group holds.
 * @returns `true` for every section, also an empty one, and for a group with rows; `false` for an empty group (see `isCollapsible`).
 */
export const isFoldable = (level: FoldLevel, rowCount: number): boolean => level === 'section' || isCollapsible(rowCount);

/**
 * Whether a section or group renders folded.
 *
 * @param level - `section` or `group`.
 * @param key - the collapse key of the section or group.
 * @param rowCount - the rows it holds.
 * @param collapsed - the reader's collapse set.
 * @param always - `true` where it never folds; defaults to `true` for `ALWAYS_OPEN_GROUPS`.
 * @returns `true` where it is foldable, not always open, and `collapsed` holds its key. A stored key folds an empty section.
 */
export const isFolded = (
  level: FoldLevel,
  key: CollapseKey,
  rowCount: number,
  collapsed: ReadonlySet<CollapseKey>,
  always: boolean = level === 'group' && ALWAYS_OPEN_GROUPS.includes(key),
): boolean => !always && isFoldable(level, rowCount) && collapsed.has(key);

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

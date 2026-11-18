/**
 * How many cards a column shows at first, and how many more each [+] shows.
 *
 * Five plan cards fill one viewport on a 1080p display (see `Board.tsx`), and
 * every card column in the Board and Discovery tabs pages by the same number.
 */
export const COLUMN_STEP = 5;

/** What a paged column renders: the visible items and what it holds back. */
export interface ColumnPage<T> {
  /** The items on screen, newest first, plus a pinned item where one is asked for. */
  visible: T[];
  /** Items not shown. */
  hidden: number;
  /** The column's whole size, which the header count shows. */
  total: number;
  /** How many items the next [+] adds: at most {@link COLUMN_STEP}, 0 when nothing is hidden. */
  next: number;
  /** Whether the column shows more than its first page, so it can collapse back to it. */
  collapsible: boolean;
}

/**
 * Parses an ISO date or date-time into a sortable number.
 *
 * @param value - a date string, or null, undefined or empty for none.
 * @returns epoch milliseconds, or `-Infinity` where the value is absent or unparsable.
 */
export const recencyOf = (value: string | null | undefined): number => {
  if (!value) return -Infinity;
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(at) ? -Infinity : at;
};

/**
 * Orders a column newest first and cuts it to the number of items the reader asked for.
 *
 * Items that share a date keep their input order. An item with no date sorts last.
 * A pinned item outside the cut is shown in addition to it, never in place of
 * another item, so following a link to a card costs no other card.
 *
 * @param items - the column's items, in any order.
 * @param options.shown - how many items the reader asked for; defaults to {@link COLUMN_STEP}.
 * @param options.dateOf - the item's date, read by {@link recencyOf}.
 * @param options.pinned - an item that must be visible wherever it sorts.
 * @returns the page.
 */
export const pageColumn = <T>(
  items: readonly T[],
  { shown = COLUMN_STEP, dateOf, pinned }: { shown?: number; dateOf: (item: T) => string | null | undefined; pinned?: (item: T) => boolean },
): ColumnPage<T> => {
  const ordered = items
    .map((item, index) => ({ item, index, at: recencyOf(dateOf(item)) }))
    .sort((a, b) => (b.at === a.at ? a.index - b.index : b.at - a.at))
    .map((entry) => entry.item);
  const count = Math.max(0, shown);
  const visible = ordered.slice(0, count);
  const extra = pinned === undefined ? undefined : ordered.slice(count).find(pinned);
  if (extra !== undefined) visible.push(extra);
  const hidden = ordered.length - visible.length;
  return {
    visible,
    hidden,
    total: ordered.length,
    next: Math.min(COLUMN_STEP, hidden),
    collapsible: count > COLUMN_STEP && ordered.length > COLUMN_STEP,
  };
};

/**
 * The number of items a column shows after one more [+].
 *
 * @param shown - the number shown now, or undefined for a column the reader has not paged.
 * @returns `shown` plus {@link COLUMN_STEP}.
 */
export const showNext = (shown: number | undefined): number => (shown ?? COLUMN_STEP) + COLUMN_STEP;

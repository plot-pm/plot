import { COLUMN_STEP, type ColumnPage } from '../lib/column-page.js';

export interface ColumnPagerProps {
  /** The page the column renders. */
  page: Pick<ColumnPage<unknown>, 'hidden' | 'next' | 'collapsible'>;
  /** What the column holds, plural, for the labels: `plans`, `tickets`, `stories`. */
  noun: string;
  /** Shows the next {@link COLUMN_STEP} items. */
  onMore: () => void;
  /** Goes back to the first {@link COLUMN_STEP} items. */
  onCollapse: () => void;
}

const BUTTON =
  'rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200';

/**
 * The [+] control under a card column, and its collapse.
 *
 * [+] shows the next {@link COLUMN_STEP} older items and names how many stay hidden.
 * The collapse shows once the column shows more than its first page. A column
 * with nothing hidden and nothing to collapse renders nothing.
 */
export function ColumnPager({ page, noun, onMore, onCollapse }: ColumnPagerProps) {
  if (page.hidden === 0 && !page.collapsible) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {page.hidden > 0 && (
        <button
          type="button"
          onClick={onMore}
          aria-label={`Show ${page.next} older ${noun}, ${page.hidden} hidden`}
          className={`${BUTTON} flex-1`}
        >
          [+] {page.next} older · {page.hidden} hidden
        </button>
      )}
      {page.collapsible && (
        <button type="button" onClick={onCollapse} className={BUTTON}>
          Show the {COLUMN_STEP} most recent
        </button>
      )}
    </div>
  );
}

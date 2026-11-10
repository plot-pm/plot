import { ROW_COLUMNS, type Cell, type RowColumn, type RowCells } from '@plot-pm/domain';
import { linkLabel, resolveLink, type LinkContext, type ResolvedLink } from '../lib/agent-rows/delivery-link-targets.js';

/** The column heads, in render order. */
const HEADS: Record<RowColumn, string> = {
  kind: 'Kind',
  item: 'Item',
  where: 'Where',
  status: 'Status',
  do: 'Do',
  by: 'By',
  age: 'Age',
};

/**
 * The grid every row shares: seven columns from `sm` up, two below it so a row
 * wraps instead of scrolling sideways at 320 px.
 */
const GRID =
  'grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_3rem]';

/** What the tab does when a link is clicked. */
export interface LinkHandlers {
  context: LinkContext;
  onPlan: (planFile: string) => void;
  onReveal: (branch: string) => void;
  onAct: (action: string, id: string) => void;
}

/** Moves to a row and marks it for two seconds, so the reader sees where the link led. */
export const scrollToAnchor = (id: string): void => {
  const el = document.getElementById(id);
  if (el === null) return;
  el.scrollIntoView({ block: 'center' });
  el.setAttribute('data-link-target', '');
  window.setTimeout(() => el.removeAttribute('data-link-target'), 2000);
};

const LINK_CLASS = 'text-blue-600 hover:underline dark:text-blue-400';

const Linked = ({ resolved, handlers, children }: { resolved: ResolvedLink; handlers: LinkHandlers; children: string }) => {
  switch (resolved.kind) {
    case 'none':
      return <span>{children}</span>;
    case 'href':
      return <a href={resolved.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{children}</a>;
    case 'anchor':
      return (
        <a
          href={`#${resolved.id}`}
          onClick={(e) => { e.preventDefault(); scrollToAnchor(resolved.id); }}
          className={LINK_CLASS}
        >
          {children}
        </a>
      );
    case 'plan':
      return <button type="button" onClick={() => handlers.onPlan(resolved.planFile)} className={LINK_CLASS}>{children}</button>;
    case 'reveal':
      return <button type="button" onClick={() => handlers.onReveal(resolved.branch)} className={LINK_CLASS}>{children}</button>;
    case 'act':
      return <button type="button" onClick={() => handlers.onAct(resolved.action, resolved.id)} className={LINK_CLASS}>{children}</button>;
  }
};

/** One cell: the value, linked where it has one target, with a chip per target where it has several. */
const CellView = ({ column, cell, handlers }: { column: RowColumn; cell: Cell | null; handlers: LinkHandlers }) => {
  if (cell === null) return <span role="gridcell" data-row-cell={column} className="min-w-0" />;
  const [first, ...rest] = cell.links;
  return (
    <span role="gridcell" data-row-cell={column} className="min-w-0 truncate text-slate-700 dark:text-slate-200">
      {first === undefined ? cell.value : (
        <Linked resolved={resolveLink(first, handlers.context)} handlers={handlers}>{cell.value}</Linked>
      )}
      {rest.map((target) => (
        <span key={`${target.to}-${JSON.stringify(target)}`}>
          {' '}
          <Linked resolved={resolveLink(target, handlers.context)} handlers={handlers}>{linkLabel(target)}</Linked>
        </span>
      ))}
    </span>
  );
};

/** The header of every grid of rows. */
export const DeliveryHeadRow = () => (
  <li role="row" className="hidden gap-x-3 border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[4.5rem_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_3rem] dark:border-slate-800">
    {ROW_COLUMNS.map((c) => <span key={c} role="columnheader">{HEADS[c]}</span>)}
  </li>
);

/**
 * One row in the seven columns. The id is the anchor a link scrolls to; the
 * popover holds what the row leaves out.
 *
 * @param anchor - the DOM id of the row.
 * @param cells - the cells the domain computed.
 * @param details - the popover's lines; the popover shows only where there are some.
 * @param handlers - what a click on a link does.
 */
export const DeliveryRow = ({ anchor, cells, details, handlers, highlighted }: {
  anchor: string;
  cells: RowCells;
  details: readonly string[];
  handlers: LinkHandlers;
  highlighted?: boolean;
}) => (
  <li
    role="row"
    id={anchor}
    data-delivery-row
    data-highlighted={highlighted ? '' : undefined}
    className={`${GRID} border-t border-slate-100 first:border-t-0 data-[link-target]:bg-amber-100 data-[highlighted]:bg-amber-50 dark:border-slate-800 dark:data-[link-target]:bg-amber-900/40`}
  >
    {ROW_COLUMNS.map((c) => <CellView key={c} column={c} cell={cells[c]} handlers={handlers} />)}
    {details.length > 0 && (
      <details data-row-details className="relative col-span-2 text-xs text-slate-500 sm:col-span-7">
        <summary aria-label="Details" className="cursor-pointer select-none">details</summary>
        <ul className="mt-1 rounded border border-slate-200 bg-white p-2 font-mono shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {details.map((line) => <li key={line} className="break-all">{line}</li>)}
        </ul>
      </details>
    )}
  </li>
);

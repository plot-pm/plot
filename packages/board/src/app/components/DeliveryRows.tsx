import type { Cell } from '@plot-pm/domain';
import { linkLabel, resolveLink, type LinkContext, type ResolvedLink } from '../lib/agent-rows/delivery-link-targets.js';

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
      return <a data-row-link href={resolved.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>{children}</a>;
    case 'anchor':
      return (
        <a
          data-row-link
          href={`#${resolved.id}`}
          onClick={(e) => { e.preventDefault(); scrollToAnchor(resolved.id); }}
          className={LINK_CLASS}
        >
          {children}
        </a>
      );
    case 'plan':
      return <button type="button" data-row-link onClick={() => handlers.onPlan(resolved.planFile)} className={LINK_CLASS}>{children}</button>;
    case 'reveal':
      return <button type="button" data-row-link onClick={() => handlers.onReveal(resolved.branch)} className={LINK_CLASS}>{children}</button>;
    case 'act':
      return <button type="button" data-row-do onClick={() => handlers.onAct(resolved.action, resolved.id)} className={LINK_CLASS}>{children}</button>;
  }
};

/**
 * One cell's content: the value, linked where it has one target, with a chip
 * per further target. Renders nothing for a cell nobody read.
 *
 * @param cell - the cell the domain computed, or `null`.
 * @param handlers - what a click on a link does.
 */
export const RowCell = ({ cell, handlers }: { cell: Cell | null; handlers: LinkHandlers }) => {
  if (cell === null) return null;
  const [first, ...rest] = cell.links;
  return (
    <>
      {first === undefined ? cell.value : (
        <Linked resolved={resolveLink(first, handlers.context)} handlers={handlers}>{cell.value}</Linked>
      )}
      {rest.map((target) => (
        <span key={`${target.to}-${JSON.stringify(target)}`}>
          {' '}
          <Linked resolved={resolveLink(target, handlers.context)} handlers={handlers}>{linkLabel(target)}</Linked>
        </span>
      ))}
    </>
  );
};

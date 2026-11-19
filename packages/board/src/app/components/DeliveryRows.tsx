import { linkIconKind, type Cell, type LinkTarget } from '@plot-pm/domain';
import { LinkIcon } from './LinkIcon.js';
import { RoleChip } from './RoleChip.js';
import { linkLabel, resolveLink, type LinkContext, type ResolvedLink } from '../lib/agent-rows/delivery-link-targets.js';

/** What the tab does when a link is clicked. */
export interface LinkHandlers {
  context: LinkContext;
  onPlan: (planFile: string) => void;
  onReveal: (branch: string) => void;
  onAct: (action: string, id: string) => void;
}

/**
 * Moves to a row and marks it for two seconds, so the reader sees where the link led.
 *
 * An id on a zero-height anchor marks the row that follows the anchor as well,
 * because the anchor itself has no box to see.
 */
export const scrollToAnchor = (id: string): void => {
  const el = document.getElementById(id);
  if (el === null) return;
  el.scrollIntoView({ block: 'center' });
  const row = el.getAttribute('role') === 'presentation' ? el.nextElementSibling : null;
  for (const mark of row === null ? [el] : [el, row]) {
    mark.setAttribute('data-link-target', '');
    window.setTimeout(() => mark.removeAttribute('data-link-target'), 2000);
  }
};

const LINK_CLASS = 'text-blue-600 hover:underline dark:text-blue-400';

/** The four arms that lead somewhere; the `act` arm keeps `LINK_CLASS`, which the You section colours. */
const TARGET_CLASS = 'delivery-text-link';

const Linked = ({ resolved, handlers, children }: { resolved: ResolvedLink; handlers: LinkHandlers; children: string }) => {
  switch (resolved.kind) {
    case 'none':
      return <span>{children}</span>;
    case 'href':
      return <a data-row-link href={resolved.href} target="_blank" rel="noopener noreferrer" className={TARGET_CLASS}>{children}</a>;
    case 'anchor':
      return (
        <a
          data-row-link
          href={`#${resolved.id}`}
          onClick={(e) => { e.preventDefault(); scrollToAnchor(resolved.id); }}
          className={TARGET_CLASS}
        >
          {children}
        </a>
      );
    case 'plan':
      return <button type="button" data-row-link onClick={() => handlers.onPlan(resolved.planFile)} className={TARGET_CLASS}>{children}</button>;
    case 'reveal':
      return <button type="button" data-row-link onClick={() => handlers.onReveal(resolved.branch)} className={TARGET_CLASS}>{children}</button>;
    case 'act':
      return <button type="button" data-row-do onClick={() => handlers.onAct(resolved.action, resolved.id)} className={LINK_CLASS}>{children}</button>;
  }
};

/**
 * One cell's content: the value, linked where it has one target, with a chip
 * per further target. Renders nothing for a cell nobody read.
 *
 * Each link that leads somewhere is led by the icon of its target's kind. A gate mark draws none, and neither does a
 * cell whose role chip already names the agent.
 *
 * @param cell - the cell the domain computed, or `null`.
 * @param handlers - what a click on a link does.
 */
export const RowCell = ({ cell, handlers }: { cell: Cell | null; handlers: LinkHandlers }) => {
  if (cell === null) return null;
  const icon = (target: LinkTarget, resolved: ResolvedLink) =>
    cell.agent !== undefined || resolved.kind === 'none' || resolved.kind === 'act' ? null : <LinkIcon kind={linkIconKind(target)} />;
  if (cell.parts !== undefined) {
    return (
      <>
        {cell.parts.map((part, i) => (
          <span key={part.value}>
            {i > 0 && <span data-gate-separator>{' · '}</span>}
            <span data-gate-mark data-gate-outcome={part.outcome}>
              {part.link === null ? part.value : (
                <Linked resolved={resolveLink(part.link, handlers.context)} handlers={handlers}>{part.value}</Linked>
              )}
            </span>
          </span>
        ))}
      </>
    );
  }
  const [first, ...rest] = cell.links;
  const firstResolved = first === undefined ? null : resolveLink(first, handlers.context);
  return (
    <>
      {cell.agent === undefined ? null : <><RoleChip role={cell.agent.role} />{' '}</>}
      {first === undefined || firstResolved === null ? cell.value : (
        <>{icon(first, firstResolved)}<Linked resolved={firstResolved} handlers={handlers}>{cell.value}</Linked></>
      )}
      {cell.agent?.attempt == null ? null : <span data-agent-attempt>{' '}{cell.agent.attempt}</span>}
      {rest.map((target) => {
        const resolved = resolveLink(target, handlers.context);
        return (
          <span key={`${target.to}-${JSON.stringify(target)}`}>
            {' '}
            {icon(target, resolved)}
            <Linked resolved={resolved} handlers={handlers}>{linkLabel(target)}</Linked>
          </span>
        );
      })}
    </>
  );
};

/**
 * The Master Agent line: the branch icon, then the branch, linked to the host where `branchUrlBase` is known and as
 * plain text where it is empty.
 *
 * @param branch - the branch the master agent works on.
 * @param branchUrlBase - the base of a branch URL on the host; `''` where the host is unknown.
 */
export const MasterAgentLine = ({ branch, branchUrlBase }: { branch: string; branchUrlBase: string }) => (
  <div className="flex items-center gap-2 px-3 py-2 text-sm" data-master-agent>
    <span className="text-slate-500 dark:text-slate-400">Master Agent:</span>
    <span className="flex items-center">
      <LinkIcon kind={linkIconKind('branch')} />
      {branchUrlBase !== '' ? (
        <a
          href={`${branchUrlBase}${encodeURIComponent(branch)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {branch}
        </a>
      ) : (
        <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{branch}</span>
      )}
    </span>
  </div>
);

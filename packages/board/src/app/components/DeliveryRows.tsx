import type { Cell, LinkTarget } from '@plot-pm/domain';
import { RoleChip } from './RoleChip.js';
import { LinkTupleView, type SegmentControl } from './TupleRow.js';
import { artifactTuple } from '../lib/tuple-row.js';
import { cellArtifact, linkLabel, resolveLink, type LinkContext, type ResolvedLink } from '../lib/agent-rows/delivery-link-targets.js';

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

/** What a click on a cell's tuple segment does, by where `resolveLink` placed it; the hook is `data-row-link`. */
const cellControl = (resolved: ResolvedLink, handlers: LinkHandlers): SegmentControl | undefined => {
  const hook = { link: { 'data-row-link': '' }, text: { 'data-row-link': '' } };
  switch (resolved.kind) {
    case 'href':
      return { extraAttr: hook };
    case 'anchor':
      return { extraAttr: hook, onFollow: () => scrollToAnchor(resolved.id) };
    case 'plan':
      return { extraAttr: hook, onActivate: () => handlers.onPlan(resolved.planFile) };
    case 'reveal':
      return { extraAttr: hook, onActivate: () => handlers.onReveal(resolved.branch) };
    default:
      return undefined;
  }
};

/**
 * A cell link: the tuple of its artifact from `cellArtifact`, or the plain link where the target names no kind of
 * place or the click is an action. With `bare`, the segment draws no glyph.
 */
const CellLink = ({ target, label, handlers, bare }: { target: LinkTarget; label: string; handlers: LinkHandlers; bare: boolean }) => {
  const resolved = resolveLink(target, handlers.context);
  const artifact = cellArtifact(target, resolved, label);
  if (artifact === null) return <Linked resolved={resolved} handlers={handlers}>{label}</Linked>;
  const segments = artifactTuple(artifact, () => undefined).map((s) => (bare ? { ...s, icon: false } : s));
  return <LinkTupleView segments={segments} controls={[cellControl(resolved, handlers)]} />;
};

/**
 * One cell's content: the value, linked where it has one target, with a chip
 * per further target. Renders nothing for a cell nobody read.
 *
 * Each link to a kind of place draws as that artifact's tuple. A gate mark draws none, and a cell whose role chip
 * already names the agent draws its tuple with no glyph.
 *
 * @param cell - the cell the domain computed, or `null`.
 * @param handlers - what a click on a link does.
 */
export const RowCell = ({ cell, handlers }: { cell: Cell | null; handlers: LinkHandlers }) => {
  if (cell === null) return null;
  const bare = cell.agent !== undefined;
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
  return (
    <>
      {cell.agent === undefined ? null : <><RoleChip role={cell.agent.role} />{' '}</>}
      {first === undefined ? cell.value : <CellLink target={first} label={cell.value} handlers={handlers} bare={bare} />}
      {cell.agent?.attempt == null ? null : <span data-agent-attempt>{' '}{cell.agent.attempt}</span>}
      {rest.map((target) => (
        <span key={`${target.to}-${JSON.stringify(target)}`}>
          {' '}
          <CellLink target={target} label={linkLabel(target)} handlers={handlers} bare={bare} />
        </span>
      ))}
    </>
  );
};

/**
 * The Master Agent line: the branch tuple, linked to the host where `branchUrlBase` is known and as text where it is
 * empty.
 *
 * @param branch - the branch the master agent works on.
 * @param branchUrlBase - the base of a branch URL on the host; `''` where the host is unknown.
 */
export const MasterAgentLine = ({ branch, branchUrlBase }: { branch: string; branchUrlBase: string }) => (
  <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm" data-master-agent>
    <span className="shrink-0 text-slate-500 dark:text-slate-400">Master Agent:</span>
    <LinkTupleView
      segments={artifactTuple({ what: 'branch', label: branch, href: branchUrlBase === '' ? '' : `${branchUrlBase}${encodeURIComponent(branch)}` }, () => undefined)}
    />
  </div>
);

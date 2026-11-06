import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import { Badge, typeVariant } from './ui/badge.js';
import { cn } from '../lib/utils.js';
import type { CardRows, Facet, Part, Piece, PresentedAction, Tone } from '../lib/card-presentation.js';

/** Where a piece naming another item links, or `null` to leave it as text. */
export interface RefLink {
  href: string;
  /** Opens in the board on a plain left-click; absent follows the href. */
  onOpen?: () => void;
  /** Hover text for the link. */
  title?: string;
  /** Opens in a new tab. */
  external?: boolean;
}

export interface CardProps {
  /** The article's id, which `?plan=<slug>` scrolls to. */
  id: string;
  rows: CardRows;
  /** The title link's href. */
  titleHref: string;
  /** Opens the item in the board on a plain left-click of the title. */
  onOpenTitle: () => void;
  /** Where a piece naming another item links. */
  linkFor?: (ref: Ref) => RefLink | null;
  /** The control for an enabled action; `null` leaves it off the row. */
  renderAction: (action: PresentedAction, primary: boolean) => ReactNode;
  /** Classes for the card's frame, such as its phase accent. */
  className?: string;
  /** Marks the card as the one just arrived at. */
  highlighted?: boolean;
}

const TONE: Readonly<Record<Tone, string>> = {
  neutral: 'text-slate-600 dark:text-slate-300',
  muted: 'text-slate-400 italic dark:text-slate-500',
  warn: 'text-amber-700 dark:text-amber-400',
  alert: 'text-red-700 font-medium dark:text-red-300',
  type: '',
};

/** `data-*` attributes from a piece's map. */
const dataAttrs = (data: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));

/** A plain primary click; any modifier or other button keeps the browser's own behaviour. */
const plainClick = (e: MouseEvent): boolean =>
  !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

const PieceView = ({ piece, linkFor }: { piece: Piece; linkFor?: CardProps['linkFor'] }) => {
  if (piece.tone === 'type') {
    return (
      <span className="inline-flex" {...dataAttrs(piece.data)}>
        <Badge variant={typeVariant(piece.text)}>{piece.text}</Badge>
      </span>
    );
  }
  const link = piece.ref !== null && linkFor ? linkFor(piece.ref) : null;
  const attrs = { ...dataAttrs(piece.data), 'data-tone': piece.tone };
  const className = cn('text-xs', TONE[piece.tone]);
  if (link) {
    return (
      <a
        href={link.href}
        title={link.title ?? piece.detail ?? undefined}
        {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
        onClick={(e) => {
          if (!link.onOpen || !plainClick(e)) return;
          e.preventDefault();
          link.onOpen();
        }}
        className={cn(className, 'hover:underline focus-visible:outline focus-visible:outline-2')}
        {...attrs}
      >
        {piece.text}
      </a>
    );
  }
  return <span className={className} title={piece.detail ?? undefined} {...attrs}>{piece.text}</span>;
};

/** A list collapsed to its summary, expanding in place under a real button. */
const ListView = ({ part, linkFor }: { part: Extract<Part, { kind: 'list' }>; linkFor?: CardProps['linkFor'] }) => {
  const [open, setOpen] = useState(false);
  const listId = `${useId()}-${part.id}`;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        data-expander={part.id}
        onClick={() => setOpen((o) => !o)}
        className={cn('text-left text-xs underline decoration-dotted', TONE[part.summary.tone])}
        {...dataAttrs(part.summary.data)}
      >
        {part.summary.text}
      </button>
      <ul id={listId} hidden={!open} className="mt-1 flex flex-col gap-0.5 pl-2">
        {part.items.map((item, i) => (
          <li key={i}><PieceView piece={item} linkFor={linkFor} /></li>
        ))}
      </ul>
    </span>
  );
};

const PartsRow = ({ facet, parts, emphasis, linkFor, className }: {
  facet: Facet; parts: Part[]; emphasis: Facet; linkFor?: CardProps['linkFor']; className: string;
}) => {
  if (parts.length === 0) return null;
  return (
    <div
      data-card-row={facet}
      data-emphasis={facet === emphasis ? 'true' : undefined}
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className, facet === emphasis && 'font-medium')}
    >
      {parts.map((part, i) =>
        part.kind === 'piece'
          ? <PieceView key={i} piece={part.piece} linkFor={linkFor} />
          : <ListView key={i} part={part} linkFor={linkFor} />,
      )}
    </div>
  );
};

/** A disabled action, with its reason on the card rather than only on hover. */
const DisabledAction = ({ action }: { action: PresentedAction }) => {
  const reasonId = useId();
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1" data-action={action.action} data-action-disabled>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={reasonId}
        title={action.reason ?? undefined}
        className="cursor-not-allowed text-xs font-medium text-slate-400 dark:text-slate-500"
      >
        {action.label}
      </button>
      <span id={reasonId} data-action-reason className="text-xs text-slate-500 dark:text-slate-400">
        — {action.reason}
      </span>
    </span>
  );
};

/**
 * One card in the card grammar's five rows: title with type and alerts, lineage,
 * progress, the action row and ownership.
 *
 * Renders what `presentCard` returned and decides nothing. The title is the only
 * link that opens the item. The action row comes second in the DOM and is
 * placed fourth on screen, so the tab order is title, primary, secondaries,
 * then the links and expanders of the rows below.
 */
export const Card = ({
  id, rows, titleHref, onOpenTitle, linkFor, renderAction, className, highlighted = false,
}: CardProps) => {
  const { primary, secondary } = rows.next;
  // An enabled action whose control renders nothing (no capability answer to
  // act on) leaves no empty slot, and a row with no slot left is not drawn.
  const slots = [
    ...(primary === null ? [] : [{ action: primary, primary: true }]),
    ...secondary.map((action) => ({ action, primary: false })),
  ].flatMap(({ action, primary: isPrimary }) => {
    const control = action.enabled ? renderAction(action, isPrimary) : <DisabledAction action={action} />;
    return control === null || control === undefined || control === false ? [] : [{ action, isPrimary, control }];
  });
  return (
    <article
      id={id}
      data-card
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'flex scroll-mt-20 flex-col gap-2 rounded-md border border-l-4 bg-white p-3 shadow-sm',
        'border-slate-200 dark:border-slate-700 dark:bg-slate-900',
        className,
        highlighted && 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950',
      )}
    >
      <div data-card-row="identity" className="order-1 flex flex-col gap-1.5">
        <a
          href={titleHref}
          data-plan-ref
          data-card-title
          onClick={(e) => {
            if (!plainClick(e)) return;
            e.preventDefault();
            onOpenTitle();
          }}
          className="text-sm font-medium leading-snug text-slate-900 hover:underline dark:text-slate-100"
        >
          {rows.title.text}
        </a>
        {rows.identity.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {rows.identity.map((part, i) => part.kind === 'piece' && <PieceView key={i} piece={part.piece} />)}
          </div>
        )}
      </div>
      {slots.length > 0 && (
        <div
          data-card-row="next"
          data-emphasis={rows.emphasis === 'next' ? 'true' : undefined}
          className={cn(
            'order-4 flex flex-wrap items-center gap-x-3 gap-y-1',
            rows.emphasis === 'next' && 'rounded bg-slate-50 px-1.5 py-1 dark:bg-slate-800/60',
          )}
        >
          {slots.map(({ action, isPrimary, control }) => (
            <span key={action.action} className="inline-flex" data-action-slot={isPrimary ? 'primary' : 'secondary'}>
              {control}
            </span>
          ))}
        </div>
      )}
      <PartsRow facet="lineage" parts={rows.lineage} emphasis={rows.emphasis} linkFor={linkFor} className="order-2" />
      <PartsRow facet="progress" parts={rows.progress} emphasis={rows.emphasis} linkFor={linkFor} className="order-3" />
      <PartsRow facet="ownership" parts={rows.ownership} emphasis={rows.emphasis} linkFor={linkFor} className="order-5" />
    </article>
  );
};

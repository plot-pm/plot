import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import { useReasonTooltip } from './ui/reason-tooltip.js';
import { GLYPH_PATH, type GlyphKind } from '../lib/glyphs.js';
import { cn } from '../lib/utils.js';
import type {
  CardSections, Dot, Hue, IconKind, KindIcon, Part, Piece, PresentedAction, PresentedAssignees, Section, Tone,
} from '../lib/card-presentation.js';

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
  sections: CardSections;
  /** The title link's href. */
  titleHref: string;
  /** Opens the item in the board on a plain left-click of the title. */
  onOpenTitle: () => void;
  /** Where a piece naming another item links. */
  linkFor?: (ref: Ref) => RefLink | null;
  /** The control for an enabled action; `null` leaves it off the band. */
  renderAction: (action: PresentedAction, primary: boolean) => ReactNode;
  /** Marks the card as the one just arrived at. */
  highlighted?: boolean;
}

/** A hue as the three tokens `index.css` defines for it. */
const hue = (h: Hue) => ({ text: `var(--hue-${h})`, dot: `var(--hue-${h}-dot)`, soft: `var(--hue-${h}-soft)` });

const TONE: Readonly<Record<Tone, string>> = {
  neutral: 'text-(--card-body)',
  muted: 'text-(--card-meta)',
  unknown: 'text-(--card-meta) underline decoration-dotted decoration-1 underline-offset-2',
  warn: 'text-(--hue-amber) font-medium',
  alert: 'text-(--hue-red) font-medium',
  type: '',
};

/** The glyph each kind of item is drawn with; a slice wears the tuple rows' slice glyph. */
const GLYPH_OF: Readonly<Record<IconKind, GlyphKind>> = {
  ticket: 'ticket',
  story: 'story',
  plan: 'plan',
  sprint: 'sprint',
  slice: 'wave',
};

/**
 * A kind icon from the board's glyph table, 1em of the text beside it, in the
 * kind's hue. Its accessible name is the kind, so the word does not repeat.
 */
const KindIconView = ({ icon }: { icon: KindIcon }) => (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="currentColor"
    role="img"
    aria-label={icon.label}
    className="inline-block shrink-0"
    style={{ color: hue(icon.hue).text }}
    data-kind-icon={icon.kind}
  >
    <title>{icon.label}</title>
    <path d={GLYPH_PATH[GLYPH_OF[icon.kind]]} />
  </svg>
);

/** A coloured dot, decorative: the word beside it carries the meaning. */
const DotView = ({ h, className }: { h: Hue; className?: string }) => (
  <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: hue(h).dot }} />
);

/** `data-*` attributes from a piece's map. */
const dataAttrs = (data: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]));

/** A plain primary click; any modifier or other button keeps the browser's own behaviour. */
const plainClick = (e: MouseEvent): boolean =>
  !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

/**
 * A piece of text with its detail in the shared tooltip, which opens on hover
 * and on keyboard focus — the same one disabled actions use.
 */
const WithDetail = ({ detail, children, className, attrs }: {
  detail: string | null; children: ReactNode; className: string; attrs: Record<string, string>;
}) => {
  const tip = useReasonTooltip(detail, 'detail');
  if (detail === null) return <span className={className} {...attrs}>{children}</span>;
  return (
    <span {...tip.wrapperProps} className="relative inline-flex">
      <span tabIndex={0} {...tip.triggerProps} className={cn(className, 'rounded focus-visible:outline-2 focus-visible:outline-offset-2')} {...attrs}>
        {children}
      </span>
      {tip.tooltip}
    </span>
  );
};

const PieceView = ({ piece, linkFor }: { piece: Piece; linkFor?: CardProps['linkFor'] }) => {
  const attrs = { ...dataAttrs(piece.data), 'data-tone': piece.tone };
  if (piece.tone === 'type') {
    return (
      <span
        className="inline-flex items-center rounded-md border border-(--card-border) px-1.5 py-px text-xs font-medium text-(--card-body)"
        {...attrs}
      >
        {piece.text}
      </span>
    );
  }
  const content = (
    <>
      {piece.icon && <KindIconView icon={piece.icon} />}
      {piece.dot && <DotView h={piece.dot} />}
      <span>{piece.text}</span>
    </>
  );
  const link = piece.ref !== null && linkFor ? linkFor(piece.ref) : null;
  const className = cn('inline-flex items-center gap-1', TONE[piece.tone]);
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
        className={cn(className, 'rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2')}
        {...attrs}
      >
        {content}
      </a>
    );
  }
  return <WithDetail detail={piece.detail} className={className} attrs={attrs}>{content}</WithDetail>;
};

/** Dots and counts for a summary: one per state, the word kept for assistive technology. */
const DotsView = ({ dots }: { dots: Dot[] }) => (
  <span className="inline-flex items-center gap-2 tabular-nums">
    {dots.map((dot) => (
      <span key={dot.word} className="inline-flex items-center gap-1" data-dot={dot.word}>
        <DotView h={dot.hue} />
        {dot.count}
        <span className="sr-only"> {dot.word}</span>
      </span>
    ))}
  </span>
);

/** A list collapsed to its summary, expanding in place under a real button. */
const ListView = ({ part, linkFor }: { part: Extract<Part, { kind: 'list' }>; linkFor?: CardProps['linkFor'] }) => {
  const [open, setOpen] = useState(false);
  const listId = `${useId()}-${part.id}`;
  const tip = useReasonTooltip(part.summary.detail, 'detail');
  return (
    <span className="relative inline-flex flex-col" {...tip.wrapperProps}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        data-expander={part.id}
        {...tip.triggerProps}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2',
          TONE[part.summary.tone],
        )}
        {...dataAttrs(part.summary.data)}
      >
        {part.summary.icon && <KindIconView icon={part.summary.icon} />}
        <span>{part.summary.text}</span>
        {part.dots.length > 0 && <DotsView dots={part.dots} />}
      </button>
      {tip.tooltip}
      <ul id={listId} hidden={!open} className="mt-1 flex flex-col gap-1 pl-1">
        {part.items.map((item, i) => (
          <li key={i}><PieceView piece={item} linkFor={linkFor} /></li>
        ))}
      </ul>
    </span>
  );
};

/** Slices done of total, as words and a slim segmented bar. */
const WorkView = ({ part }: { part: Extract<Part, { kind: 'work' }> }) => (
  <span className="inline-flex items-center gap-1.5">
    <WithDetail detail={part.piece.detail} className={cn('tabular-nums', TONE[part.piece.tone])} attrs={dataAttrs(part.piece.data)}>
      {part.piece.text}
    </WithDetail>
    <span aria-hidden className="inline-flex gap-px" data-work-bar>
      {Array.from({ length: Math.min(part.total, 12) }, (_, i) => (
        <span
          key={i}
          className="h-1.5 w-2 first:rounded-l-full last:rounded-r-full"
          style={{
            background: part.done !== null && i < part.done ? hue('green').dot : 'var(--card-border)',
          }}
        />
      ))}
    </span>
  </span>
);

const PartView = ({ part, linkFor }: { part: Part; linkFor?: CardProps['linkFor'] }) =>
  part.kind === 'piece' ? <PieceView piece={part.piece} linkFor={linkFor} />
    : part.kind === 'list' ? <ListView part={part} linkFor={linkFor} />
      : <WorkView part={part} />;

/** The state pill: a dot and its word, on the state's soft hue. */
const StatePill = ({ piece }: { piece: Piece }) => (
  <span className="inline-flex rounded-full" style={{ background: hue(piece.dot ?? 'slate').soft }}>
  <WithDetail
    detail={piece.detail}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1.5 font-medium',
      piece.tone === 'unknown' && 'underline decoration-dotted underline-offset-2',
    )}
    attrs={{ ...dataAttrs(piece.data), 'data-state-pill': '' }}
  >
    <span className="inline-flex items-center gap-1.5" style={{ color: hue(piece.dot ?? 'slate').text }}>
      <DotView h={piece.dot ?? 'slate'} />
      {piece.text}
    </span>
  </WithDetail>
  </span>
);

/** Round initials avatars, with every name in the shared tooltip. */
const AssigneesView = ({ a }: { a: PresentedAssignees }) => (
  <WithDetail detail={a.detail} className={cn('inline-flex items-center gap-1.5', TONE[a.tone])} attrs={{ 'data-assignees': '' }}>
    {a.initials.length > 0 && (
      <span aria-hidden className="inline-flex -space-x-1">
        {a.initials.map((initials, i) => (
          <span
            key={i}
            className="inline-flex size-5 items-center justify-center rounded-full bg-(--hue-slate-soft) text-[10px] font-semibold text-(--hue-slate) ring-2 ring-(--card-surface)"
          >
            {initials}
          </span>
        ))}
      </span>
    )}
    <span>{a.text}</span>
  </WithDetail>
);

/** A disabled action: a focusable, `aria-disabled` outline whose reason is its description and tooltip. */
const DisabledAction = ({ action }: { action: PresentedAction }) => {
  const tip = useReasonTooltip(action.reason);
  return (
    <span {...tip.wrapperProps} className="relative inline-flex" data-action={action.action} data-action-disabled>
      <button
        type="button"
        aria-disabled="true"
        {...tip.triggerProps}
        onClick={(e) => { e.preventDefault(); tip.show(); }}
        className="inline-flex h-7 cursor-not-allowed items-center rounded-md border border-(--card-border) px-2.5 text-[13px] font-medium text-(--card-meta) focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {action.label}
      </button>
      {tip.tooltip}
    </span>
  );
};

/** The emphasised section draws a little heavier; position never changes. */
const emphasised = (section: Section, emphasis: Section) => section === emphasis;

/**
 * One card in the card grammar's four sections: header, context, status and
 * the action band. Renders what `presentCard` returned and decides nothing.
 *
 * The title is the only link that opens the item. The action band comes second
 * in the DOM and is placed last on screen, so the tab order is title, primary
 * (disabled or not), secondaries, then the links and expanders of the other
 * sections. An empty section is not drawn; the band is not drawn when no
 * action renders. Light and dark draw from the same tokens (`index.css`).
 */
export const Card = ({
  id, sections, titleHref, onOpenTitle, linkFor, renderAction, highlighted = false,
}: CardProps) => {
  const { header, context, status, actions, emphasis, accent } = sections;
  const slots = [
    ...(actions.primary === null ? [] : [{ action: actions.primary, primary: true }]),
    ...actions.secondary.map((action) => ({ action, primary: false })),
  ].flatMap(({ action, primary: isPrimary }) => {
    const control = action.enabled ? renderAction(action, isPrimary) : <DisabledAction action={action} />;
    return control === null || control === undefined || control === false ? [] : [{ action, isPrimary, control }];
  });
  const titleText = header.key === null ? header.title : `${header.key}: ${header.title}`;
  return (
    <article
      id={id}
      data-card
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'group/card relative flex scroll-mt-20 flex-col overflow-visible rounded-xl border border-(--card-border) bg-(--card-surface)',
        'shadow-(--card-shadow) transition-shadow duration-150 hover:shadow-(--card-shadow-raised) focus-within:shadow-(--card-shadow-raised)',
        highlighted && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-(--card-surface)',
      )}
    >
      {/* The 3 px accent in the state's colour; the state pill says it in words. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-xl" style={{ background: hue(accent).dot }} data-accent={accent} />
      <div data-section="header" data-card-row="identity" className="order-1 flex flex-col gap-1.5 px-4 pt-4">
        <div className="flex items-start gap-2 text-[15px] leading-snug">
          {/* One line tall and centred in it, so the icon sits on the title's first line when it wraps. */}
          <span className="inline-flex h-[1lh] shrink-0 items-center"><KindIconView icon={header.kind} /></span>
          <a
            href={titleHref}
            data-plan-ref
            data-card-title
            title={titleText}
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              onOpenTitle();
            }}
            className="line-clamp-2 rounded font-semibold text-(--card-title) hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {header.key !== null && <><span className="font-normal tabular-nums text-(--card-meta)">{header.key}:</span>{' '}</>}
            {header.title}
          </a>
        </div>
        {header.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pl-[calc(15px+0.5rem)] text-xs">
            {header.tags.map((tag, i) => <PieceView key={i} piece={tag} />)}
          </div>
        )}
      </div>
      {/* The band comes second in the DOM and is drawn last, so it leads the tab order after the title. */}
      {slots.length > 0 && (
        <div
          data-section="actions"
          data-card-row="next"
          data-action-band
          data-emphasis={emphasised('actions', emphasis) ? 'true' : undefined}
          className="order-4 flex flex-wrap items-center gap-2 rounded-b-xl border-t border-(--card-border) bg-(--card-band) px-4 py-2.5"
        >
          {slots.map(({ action, isPrimary, control }) => (
            <span key={action.action} className="inline-flex" data-action-slot={isPrimary ? 'primary' : 'secondary'}>
              {control}
            </span>
          ))}
        </div>
      )}
      {context.length > 0 && (
        <div
          data-section="context"
          data-card-row="lineage"
          data-emphasis={emphasised('context', emphasis) ? 'true' : undefined}
          className={cn('order-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2.5 text-[13px]', emphasised('context', emphasis) && 'font-medium')}
        >
          {context.map((part, i) => <PartView key={i} part={part} linkFor={linkFor} />)}
        </div>
      )}
      <div
        data-section="status"
        data-card-row="progress"
        data-emphasis={emphasised('status', emphasis) ? 'true' : undefined}
        className="order-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3 pb-4 text-xs"
      >
        <StatePill piece={status.state} />
        {status.measures.map((part, i) => <PartView key={i} part={part} linkFor={linkFor} />)}
        {/* Who and since when, aligned to the right of the same line. */}
        <span data-card-row="ownership" className="ml-auto inline-flex items-center gap-3 text-(--card-meta)">
          <AssigneesView a={status.assignees} />
          {status.age && <PieceView piece={status.age} />}
        </span>
      </div>
    </article>
  );
};

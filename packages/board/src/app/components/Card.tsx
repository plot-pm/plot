import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import { useReasonTooltip } from './ui/reason-tooltip.js';
import { GLYPH_PATH, type GlyphKind } from '../lib/glyphs.js';
import { cn } from '../lib/utils.js';
import type {
  CardSections, Dot, Hue, IconKind, KindIcon, Part, Piece, PresentedAction, PresentedAssignees, PrView, ReasonPart, Tone,
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

/** Where an item, or a PR's build, links; `null` to leave it as text. */
export type LinkFor = (ref: Ref, aspect?: 'item' | 'build') => RefLink | null;

export interface CardProps {
  /** The article's id, which `?plan=<slug>` scrolls to. */
  id: string;
  sections: CardSections;
  /** The title link's href. */
  titleHref: string;
  /** Opens the item in the board on a plain left-click of the title. */
  onOpenTitle: () => void;
  /**
   * Where an item a piece names links. `aspect: 'build'` asks for a PR's
   * build rather than the PR itself; absent asks for the item.
   */
  linkFor?: LinkFor;
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

/**
 * A link that reads as plain card text at rest and shows its underline and a
 * focus ring on hover and keyboard focus. A host link opens a new tab and says
 * so in its accessible name; a board link opens the item in place.
 */
const LinkView = ({ link, children, className, attrs, title }: {
  link: RefLink; children: ReactNode; className?: string; attrs?: Record<string, string>; title?: string;
}) => (
  <a
    href={link.href}
    title={title ?? link.title}
    {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
    onClick={(e) => {
      if (!link.onOpen || !plainClick(e)) return;
      e.preventDefault();
      link.onOpen();
    }}
    data-card-link={link.external ? 'host' : 'board'}
    className={cn(
      'cursor-pointer rounded text-inherit no-underline decoration-1 underline-offset-2 hover:underline',
      'focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hue-blue-dot)',
      className,
    )}
    {...attrs}
  >
    {children}
    {link.external && <span className="sr-only"> (opens in a new tab)</span>}
  </a>
);

/**
 * A pull request: its number links the PR and its build words link the build.
 * In a popover the branch link follows on a second line, under the number.
 */
const PrInline = ({ pr, linkFor, dot, withBranch }: { pr: PrView; linkFor?: LinkFor; dot: ReactNode; withBranch: boolean }) => {
  const prLink = linkFor?.(pr.prRef) ?? null;
  const showBranch = withBranch && pr.branch !== '';
  const branchLink = showBranch ? linkFor?.(pr.branchRef) ?? null : null;
  const buildLink = linkFor?.(pr.prRef, 'build') ?? null;
  const branch = <span className="font-mono text-[11px] text-(--card-meta)">{pr.branch}</span>;
  return (
    <span className="inline-grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-0.5">
      {dot ?? <span />}
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
        {prLink ? <LinkView link={prLink} className="tabular-nums" attrs={{ 'data-pr-link': String(pr.number) }}>#{pr.number}</LinkView> : <span className="tabular-nums">#{pr.number}</span>}
        {buildLink ? <LinkView link={buildLink} attrs={{ 'data-build-link': String(pr.number) }}>{pr.checks}</LinkView> : <span data-build={String(pr.number)}>{pr.checks}</span>}
      </span>
      {showBranch && (
        <>
          <span />
          {branchLink
            ? <LinkView link={branchLink} className="min-w-0 truncate" attrs={{ 'data-branch-link': pr.branch }}>{branch}</LinkView>
            : <span className="min-w-0 truncate">{branch}</span>}
        </>
      )}
    </span>
  );
};

const PieceView = ({ piece, linkFor, inPopover = false }: { piece: Piece; linkFor?: LinkFor; inPopover?: boolean }) => {
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
  const className = cn('inline-flex min-w-0 max-w-full items-center gap-1', TONE[piece.tone]);
  if (piece.pr) {
    return (
      <span className={className} {...attrs}>
        <PrInline pr={piece.pr} linkFor={linkFor} dot={piece.dot && <DotView h={piece.dot} />} withBranch={inPopover} />
      </span>
    );
  }
  // A related item's name is shortened to fit; the whole name is in its title and tooltip.
  const text = <span className={cn('min-w-0', piece.icon ? 'truncate' : '[overflow-wrap:anywhere]')}>{piece.text}</span>;
  const content = (
    <>
      {piece.icon && <KindIconView icon={piece.icon} />}
      {piece.dot && <DotView h={piece.dot} />}
      {text}
    </>
  );
  const link = piece.ref !== null && linkFor ? linkFor(piece.ref) : null;
  if (link) {
    return (
      <LinkView
        link={link}
        title={piece.detail ?? undefined}
        className={cn(className, piece.icon && !inPopover && 'max-w-[18rem]')}
        attrs={attrs}
      >
        {content}
      </LinkView>
    );
  }
  return <WithDetail detail={piece.detail} className={cn(className, piece.icon && !inPopover && 'max-w-[18rem]')} attrs={attrs}>{content}</WithDetail>;
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

/**
 * A count that opens a popover listing its items, each a link. The popover is
 * a dialog: it opens on click, Enter or Space, takes focus, and closes on
 * Escape or a click outside, returning focus to the count.
 */
const ListView = ({ part, linkFor }: { part: Extract<Part, { kind: 'list' }>; linkFor?: LinkFor }) => {
  const [open, setOpen] = useState(false);
  const dialogId = `${useId()}-${part.id}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    // Focus the first link inside, else the dialog itself.
    const first = dialogRef.current?.querySelector<HTMLElement>('a, button');
    (first ?? dialogRef.current)?.focus();
    const outside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        data-expander={part.id}
        title={part.summary.detail ?? undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1.5 rounded text-left no-underline decoration-1 underline-offset-2 hover:underline',
          'focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hue-blue-dot)',
          TONE[part.summary.tone],
        )}
        {...dataAttrs(part.summary.data)}
      >
        {part.summary.icon && <KindIconView icon={part.summary.icon} />}
        <span>{part.summary.text}</span>
        {part.dots.length > 0 && <DotsView dots={part.dots} />}
      </button>
      {open && (
        <div
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-label={part.summary.text}
          tabIndex={-1}
          data-popover={part.id}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close(true);
          }}
          className="absolute left-0 top-full z-30 mt-1.5 flex w-max max-w-[28rem] flex-col gap-1.5 rounded-lg border border-(--card-border) bg-(--card-surface) p-2.5 text-xs text-(--card-body) shadow-(--card-shadow-raised) outline-none"
        >
          <ul className="flex flex-col gap-1.5">
            {part.items.map((item, i) => (
              <li key={i}><PieceView piece={item} linkFor={linkFor} inPopover /></li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
};

/** Slices done of total, as words and a segmented bar stretched across the rest of the line. */
const WorkView = ({ part }: { part: Extract<Part, { kind: 'work' }> }) => (
  <span className="flex min-w-0 flex-1 items-center gap-2">
    <WithDetail detail={part.piece.detail} className={cn('shrink-0 tabular-nums', TONE[part.piece.tone])} attrs={dataAttrs(part.piece.data)}>
      {part.piece.text}
    </WithDetail>
    <span aria-hidden className="flex h-1.5 min-w-8 flex-1 gap-0.5" data-work-bar>
      {Array.from({ length: Math.max(1, Math.min(part.total, 24)) }, (_, i) => (
        <span
          key={i}
          className="h-full flex-1 first:rounded-l-full last:rounded-r-full"
          style={{
            background: part.done !== null && i < part.done ? hue('green').dot : 'var(--card-track)',
          }}
        />
      ))}
    </span>
  </span>
);

const PartView = ({ part, linkFor }: { part: Part; linkFor?: LinkFor }) =>
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

/**
 * The assignee avatar: the first assignee's initials, `+N` for the rest, and
 * every name in the shared tooltip and the accessible name. Nobody assigned,
 * or an unread list, is an empty dashed circle named for it.
 */
const AssigneesView = ({ a }: { a: PresentedAssignees }) => {
  const tip = useReasonTooltip(a.label, 'detail');
  return (
    <span {...tip.wrapperProps} className="relative inline-flex">
      <span
        tabIndex={0}
        role="img"
        aria-label={a.label}
        {...tip.triggerProps}
        data-assignees={a.kind}
        className="inline-flex items-center gap-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {a.initials === null ? (
          <span className="inline-flex size-6 rounded-full border border-dashed border-(--card-meta) opacity-70" />
        ) : (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-(--hue-slate-soft) text-[10px] font-semibold text-(--hue-slate)">
            {a.initials}
          </span>
        )}
        {a.more > 0 && <span aria-hidden className="text-xs tabular-nums text-(--card-meta)">+{a.more}</span>}
      </span>
      {tip.tooltip}
    </span>
  );
};

/** A reason's parts: the words as text, each branch or PR it names a link. */
const ReasonView = ({ parts, linkFor }: { parts: ReasonPart[]; linkFor?: LinkFor }) => (
  <>
    {parts.map((part, i) => {
      const link = part.ref !== null ? linkFor?.(part.ref) ?? null : null;
      return link ? <LinkView key={i} link={link} className="underline-offset-2">{part.text}</LinkView> : <span key={i}>{part.text}</span>;
    })}
  </>
);

/** A disabled action: a focusable, `aria-disabled` outline whose reason is its description and tooltip. */
const DisabledAction = ({ action, linkFor }: { action: PresentedAction; linkFor?: LinkFor }) => {
  const content = action.reasonParts ? <ReasonView parts={action.reasonParts} linkFor={linkFor} /> : undefined;
  const tip = useReasonTooltip(action.reason, 'reason', content);
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

/**
 * One card in the card grammar's three sections, each on its own surface: the
 * header on the card, the status in an inset panel, the footer in a tinted
 * band flush at the bottom. Renders what `presentCard` returned and decides
 * nothing; the emphasised section takes the stronger tint.
 *
 * Laid out on a grid so the DOM can lead with the title and the actions: the
 * tab order is title, primary (disabled or not), secondaries, then the meta
 * line's items, the panel's expanders and the assignee. Every section aligns
 * to the card's 16 px padding; only the title is indented past the kind icon.
 * Light and dark draw from the same tokens (`index.css`).
 */
export const Card = ({
  id, sections, titleHref, onOpenTitle, linkFor, renderAction, highlighted = false,
}: CardProps) => {
  const { header, status, footer, emphasis, accent } = sections;
  const slots = [
    ...(footer.primary === null ? [] : [{ action: footer.primary, primary: true }]),
    ...footer.secondary.map((action) => ({ action, primary: false })),
  ].flatMap(({ action, primary: isPrimary }) => {
    const control = action.enabled ? renderAction(action, isPrimary) : <DisabledAction action={action} linkFor={linkFor} />;
    return control === null || control === undefined || control === false ? [] : [{ action, isPrimary, control }];
  });
  const statusTwoLines = status.work !== null && status.signals.length > 0;
  const numberLink = header.numberRef !== null ? linkFor?.(header.numberRef) ?? null : null;
  return (
    <article
      id={id}
      data-card
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'relative grid scroll-mt-20 grid-cols-[1fr_auto] rounded-xl border border-(--card-border) bg-(--card-surface)',
        'shadow-(--card-shadow) transition-shadow duration-150 hover:shadow-(--card-shadow-raised) focus-within:shadow-(--card-shadow-raised)',
        highlighted && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-(--card-surface)',
      )}
      style={{ gridTemplateAreas: '"title title" "meta meta" "status status" "who actions"' }}
    >
      {/* The 3 px accent in the state's colour; the state pill says it in words. */}
      <span aria-hidden className="absolute inset-y-0 left-0 z-10 w-[3px] rounded-l-xl" style={{ background: hue(accent).dot }} data-accent={accent} />

      {/* HEADER — the title, on the card surface. */}
      <div data-section="header" data-card-row="identity" className="flex items-start gap-2 px-4 pt-4 text-[15px] leading-snug" style={{ gridArea: 'title' }}>
        {/* One line tall and centred in it, so the icon sits on the title's first line when it wraps. */}
        <span className="inline-flex h-[1lh] shrink-0 items-center"><KindIconView icon={header.kind} /></span>
        {/* The ticket number is its own link to the ticket; the title after it opens the item. */}
        <div className="line-clamp-2 min-w-0">
          {header.number !== null && (
            <>
              {numberLink
                ? <LinkView link={numberLink} className="font-normal tabular-nums text-(--card-meta)" attrs={{ 'data-title-number': '' }}>{header.number}</LinkView>
                : <span className="font-normal tabular-nums text-(--card-meta)" data-title-number>{header.number}</span>}
              {' '}
            </>
          )}
          <a
            href={titleHref}
            data-plan-ref
            data-card-title
            title={header.label}
            onClick={(e) => {
              if (!plainClick(e)) return;
              e.preventDefault();
              onOpenTitle();
            }}
            className={cn(
              'rounded font-semibold text-(--card-title) no-underline decoration-1 underline-offset-2 hover:underline',
              'focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hue-blue-dot)',
            )}
          >
            {header.title}
          </a>
        </div>
      </div>

      {/* FOOTER, actions half — second in the DOM so the actions follow the title in the tab order. */}
      <div
        data-section="footer"
        data-card-row="next"
        data-action-band
        data-emphasis={emphasis === 'footer' ? 'true' : undefined}
        className="relative z-[1] mt-3 flex flex-wrap items-center justify-end gap-1.5 py-2.5 pr-4 pl-2"
        style={{ gridArea: 'actions' }}
      >
        {slots.map(({ action, isPrimary, control }) => (
          <span key={action.action} className="inline-flex" data-action-slot={isPrimary ? 'primary' : 'secondary'}>
            {control}
          </span>
        ))}
      </div>

      {/* HEADER, meta line — number, type, alerts and related items. */}
      {header.meta.length > 0 && (
        <div
          data-card-row="lineage"
          data-meta
          data-emphasis={emphasis === 'header' ? 'true' : undefined}
          className={cn('flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pt-1.5 text-xs text-(--card-meta)', emphasis === 'header' && 'font-medium')}
          style={{ gridArea: 'meta' }}
        >
          {header.meta.map((part, i) => <PartView key={i} part={part} linkFor={linkFor} />)}
        </div>
      )}

      {/* STATUS — the inset panel: the state and the work, then the signals. */}
      <div className="px-4 pt-3" style={{ gridArea: 'status' }}>
        <div
          data-section="status"
          data-card-row="progress"
          data-emphasis={emphasis === 'status' ? 'true' : undefined}
          className={cn(
            'flex flex-col gap-1.5 rounded-lg px-3 py-2 text-xs',
            emphasis === 'status' ? 'bg-(--card-panel-strong)' : 'bg-(--card-panel)',
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5" data-status-line="1">
            <StatePill piece={status.state} />
            {status.work !== null && <WorkView part={status.work} />}
            {!statusTwoLines && status.signals.map((part, i) => <PartView key={i} part={part} linkFor={linkFor} />)}
          </div>
          {statusTwoLines && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-status-line="2">
              {status.signals.map((part, i) => <PartView key={i} part={part} linkFor={linkFor} />)}
            </div>
          )}
        </div>
      </div>

      {/* FOOTER, who half — the assignee and the age, on the left of the band. */}
      <div data-card-row="ownership" className="relative z-[1] mt-3 flex items-center gap-2 py-2.5 pl-4 text-xs text-(--card-meta)" style={{ gridArea: 'who' }}>
        <AssigneesView a={footer.assignees} />
        {footer.age && <PieceView piece={footer.age} />}
      </div>

      {/* The band's surface behind both halves: its tint and its top hairline. */}
      <span
        aria-hidden
        className={cn(
          'mt-3 rounded-b-xl border-t border-(--card-border)',
          emphasis === 'footer' ? 'bg-(--card-band-strong)' : 'bg-(--card-band)',
        )}
        style={{ gridRow: 4, gridColumn: '1 / -1' }}
        data-footer-band
      />
    </article>
  );
};

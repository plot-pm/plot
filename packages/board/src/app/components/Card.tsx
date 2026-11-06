import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import { useReasonTooltip } from './ui/reason-tooltip.js';
import { ActionMessageTarget } from './ui/action-message.js';
import { GLYPH_PATH, type GlyphKind } from '../lib/glyphs.js';
import { cn } from '../lib/utils.js';
import type {
  CardSections, Dot, Hue, IconKind, KindIcon, Part, Piece, PresentedAction, PresentedAssignees, PrView, Tone,
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
 * A button that opens a popover. The popover is a dialog: it opens on click,
 * Enter or Space, takes focus, and closes on Escape or a click outside,
 * returning focus to the button. With `keepMounted`, a closed popover stays in
 * the DOM, hidden, so the controls inside keep their state across a close.
 */
const PopoverButton = ({ label, buttonLabel, buttonClass, buttonAttrs, title, align = 'left', popoverId, keepMounted = false, children, trigger }: {
  /** The dialog's accessible name. */
  label: string;
  /** The button's accessible name, where its text does not give one. */
  buttonLabel?: string;
  buttonClass: string;
  buttonAttrs?: Record<string, string>;
  title?: string;
  /** Which edge of the button the popover lines up with. */
  align?: 'left' | 'right';
  popoverId: string;
  /** Keeps the closed popover's content mounted and hidden rather than removing it. */
  keepMounted?: boolean;
  children: ReactNode;
  trigger: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const dialogId = `${useId()}-${popoverId}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Focus the first control inside, else the dialog itself.
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
        aria-label={buttonLabel}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={buttonClass}
        {...buttonAttrs}
      >
        {trigger}
      </button>
      {(open || keepMounted) && (
        <div
          ref={dialogRef}
          id={dialogId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          hidden={!open}
          data-popover={popoverId}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
          }}
          className={cn(
            // The class and the attribute agree, so `flex` never shows a closed popover.
            open ? 'flex' : 'hidden',
            'absolute top-full z-30 mt-1.5 w-max max-w-[28rem] flex-col gap-1.5 rounded-lg border border-(--card-border) bg-(--card-surface) p-2.5 text-xs text-(--card-body) shadow-(--card-shadow-raised) outline-none',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </span>
  );
};

/** A count that opens a popover listing its items, each a link. */
const ListView = ({ part, linkFor }: { part: Extract<Part, { kind: 'list' }>; linkFor?: LinkFor }) => (
  <PopoverButton
    label={part.summary.text}
    popoverId={part.id}
    title={part.summary.detail ?? undefined}
    buttonAttrs={{ 'data-expander': part.id, ...dataAttrs(part.summary.data) }}
    buttonClass={cn(
      'inline-flex cursor-pointer items-center gap-1.5 rounded text-left no-underline decoration-1 underline-offset-2 hover:underline',
      'focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--hue-blue-dot)',
      TONE[part.summary.tone],
    )}
    trigger={(
      <>
        {part.summary.icon && <KindIconView icon={part.summary.icon} />}
        <span>{part.summary.text}</span>
        {part.dots.length > 0 && <DotsView dots={part.dots} />}
      </>
    )}
  >
    <ul className="flex flex-col gap-1.5">
      {part.items.map((item, i) => (
        <li key={i}><PieceView piece={item} linkFor={linkFor} inPopover /></li>
      ))}
    </ul>
  </PopoverButton>
);

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
  const tip = useReasonTooltip(a.detail, 'detail');
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
        {a.word !== null && <span aria-hidden className="text-xs text-(--card-meta)" data-assignee-word>{a.word}</span>}
      </span>
      {tip.tooltip}
    </span>
  );
};

/**
 * A disabled action: a focusable, `aria-disabled` outline whose reason is its
 * description and tooltip. The tooltip holds plain text only; every branch and
 * PR the reason names has its own link elsewhere on the card.
 */
const DisabledAction = ({ action }: { action: PresentedAction }) => {
  const tip = useReasonTooltip(action.reason, 'reason');
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
  const controlsOf = (actions: { action: PresentedAction; primary: boolean }[]) => actions.flatMap(({ action, primary: isPrimary }) => {
    const control = action.enabled ? renderAction(action, isPrimary) : <DisabledAction action={action} />;
    return control === null || control === undefined || control === false ? [] : [{ action, isPrimary, control }];
  });
  const slots = controlsOf([
    ...(footer.primary === null ? [] : [{ action: footer.primary, primary: true }]),
    ...footer.secondary.map((action) => ({ action, primary: false })),
  ]);
  const more = controlsOf(footer.more.map((action) => ({ action, primary: false })));
  const statusTwoLines = status.work !== null && status.signals.length > 0;
  const numberLink = header.numberRef !== null ? linkFor?.(header.numberRef) ?? null : null;
  const [messages, setMessages] = useState<HTMLDivElement | null>(null);
  return (
    <ActionMessageTarget.Provider value={messages}>
    <article
      id={id}
      data-card
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'relative grid scroll-mt-20 grid-cols-1 rounded-xl border border-(--card-border) bg-(--card-surface)',
        'shadow-(--card-shadow) transition-shadow duration-150 hover:shadow-(--card-shadow-raised) focus-within:shadow-(--card-shadow-raised)',
        highlighted && 'ring-2 ring-blue-500 ring-offset-2 ring-offset-(--card-surface)',
      )}
      style={{ gridTemplateAreas: '"title" "meta" "status" "footer"' }}
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

      {/*
        FOOTER — the band: one wrapping row, the assignees and age on the left and
        the action group on the right. The group comes first in the DOM, so the
        actions follow the title in the tab order; `order` draws it on the right
        of the assignee group's space. Where both do not fit, the whole group wraps
        to its own row and never splits.
      */}
      <div
        data-section="footer"
        data-footer-band
        data-emphasis={emphasis === 'footer' ? 'true' : undefined}
        className={cn(
          'mt-3 flex flex-wrap items-center rounded-b-xl border-t border-(--card-border)',
          emphasis === 'footer' ? 'bg-(--card-band-strong)' : 'bg-(--card-band)',
        )}
        style={{ gridArea: 'footer' }}
      >
        <div
          data-card-row="next"
          data-action-band
          className="order-2 ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5 py-2.5 pr-4 pl-2"
        >
          {slots.map(({ action, isPrimary, control }) => (
            <span key={action.action} className="inline-flex" data-action-slot={isPrimary ? 'primary' : 'secondary'}>
              {control}
            </span>
          ))}
          {more.length > 0 && (
            <span className="inline-flex" data-action-slot="more">
              <PopoverButton
                label="More actions"
                buttonLabel="More actions"
                popoverId="more-actions"
                align="right"
                keepMounted
                buttonClass="cursor-pointer"
                buttonAttrs={{ 'data-more-actions': '' }}
                trigger={<span aria-hidden>⋯</span>}
              >
                <ul className="flex flex-col items-start gap-1.5" data-more-list>
                  {more.map(({ action, control }) => (
                    <li key={action.action} className="inline-flex" data-action-slot="secondary" data-menu-action={action.action}>{control}</li>
                  ))}
                </ul>
              </PopoverButton>
            </span>
          )}
        </div>
        {/* The assignee group's space on the band; the group itself is drawn over it, last in the DOM. */}
        <div aria-hidden inert data-ownership-space className="invisible order-1 flex items-center gap-2 py-2.5 pl-4 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex size-6" />
            {footer.assignees.more > 0 && <span className="tabular-nums">+{footer.assignees.more}</span>}
            {footer.assignees.word !== null && <span>{footer.assignees.word}</span>}
          </span>
          {footer.age && <span>{footer.age.text}</span>}
        </div>
        {/* An action's refusal or confirmation: its own full-width row under the footer row, wrapping normally. */}
        <div ref={setMessages} data-action-messages className="order-3 flex basis-full flex-col gap-1 px-4 pb-2.5 [overflow-wrap:anywhere] empty:hidden" />
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

      {/*
        FOOTER, assignee group — last in the DOM so it follows the status in the tab
        order, drawn over its space at the band's top left (below the 12 px gap and
        the hairline).
      */}
      <div
        data-card-row="ownership"
        className="relative z-[1] mt-[calc(0.75rem+1px)] flex items-center gap-2 self-start justify-self-start py-2.5 pl-4 text-xs text-(--card-meta)"
        style={{ gridArea: 'footer' }}
      >
        <AssigneesView a={footer.assignees} />
        {footer.age && <PieceView piece={footer.age} />}
      </div>
    </article>
    </ActionMessageTarget.Provider>
  );
};

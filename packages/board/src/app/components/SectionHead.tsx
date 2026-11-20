import type { ReactNode, SyntheticEvent } from 'react';
import { sectionAnchor, type TabSection } from '../lib/agent-rows/delivery-view.js';
import { EMPTY_MARK, hiddenByMineWords, SCOPE_OFF_WORDS, type EmptyKind, type SectionEmpty } from '../lib/agent-rows/section-empty.js';

const EMPTY_MARK_CLASS: Readonly<Record<EmptyKind, string>> = {
  clear: 'delivery-text-ok',
  unread: 'delivery-text-warn',
  stopped: 'delivery-text-muted',
};

/** Keeps a click or key on a header control from reaching the header row, which toggles the fold. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** The handlers of a control inside a section header: a click or key on it does only what the control does. */
export const headerControl = { onClick: stop, onKeyDown: stop } as const;

export interface SectionHeadProps {
  section: TabSection;
  /** The section's name, for the fold button's accessible name. */
  label: string;
  folded: boolean;
  onToggle: () => void;
  /** The section title, an `h2`. */
  children: ReactNode;
  /** What the folded header shows beside the title. */
  summary?: ReactNode;
}

/**
 * The header row of a Delivery section: a 28 px fold button, the title and the summary slot, on one line.
 *
 * Only the button carries `aria-expanded` and the accessible name. A click anywhere else on the row toggles the
 * fold too, as a pointer shortcut with no role. The row carries the anchor `delivery-section-<key>`, which a jump
 * scrolls to where its own anchor stays unmounted.
 */
export const SectionHead = ({ section, label, folded, onToggle, children, summary }: SectionHeadProps) => (
  <div id={sectionAnchor(section)} data-section-head={section} onClick={onToggle} className="delivery-head flex cursor-pointer items-center gap-2">
    <button
      type="button"
      data-section-toggle={section}
      aria-expanded={!folded}
      aria-label={`${folded ? 'Expand' : 'Collapse'} ${label}`}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <svg
        aria-hidden="true"
        data-section-chevron
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="currentColor"
        className={`transition-transform motion-reduce:transition-none ${folded ? '' : 'rotate-90'}`}
      >
        <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
      </svg>
    </button>
    {children}
    <span data-section-summary-slot className="flex items-center gap-2">{summary}</span>
  </div>
);

export interface SectionEmptyFrameProps {
  section: TabSection;
  empty: SectionEmpty;
  /** Turns Mine off: the setter the Mine chip calls. Absent where the frame offers no Mine button. */
  onMine?: () => void;
  /** Sets the scope to the release: the setter the scope toggle calls. Absent where the frame offers no scope button. */
  onScopeOff?: () => void;
  /** Data attributes the frame element carries beside its own. */
  attrs?: Readonly<Record<`data-${string}`, string>>;
  /** Data attributes the note carries. */
  noteAttrs?: Readonly<Record<`data-${string}`, string>>;
}

/** The dashed frame an open section with no rows shows: the kind's mark, the sentence, the note and the filter buttons. */
export const SectionEmptyFrame = ({ section, empty, onMine, onScopeOff, attrs, noteAttrs }: SectionEmptyFrameProps) => (
  <div {...attrs} data-section-empty-frame={section} data-empty-kind={empty.kind} className="delivery-empty">
    <span aria-hidden="true" data-empty-mark className={EMPTY_MARK_CLASS[empty.kind]}>{EMPTY_MARK[empty.kind]}</span>
    <span data-empty-sentence>{empty.sentence}</span>
    {empty.hidden !== null && onMine !== undefined && (
      <button type="button" data-empty-hidden onClick={onMine} className="delivery-text-link">· {hiddenByMineWords(empty.hidden)}</button>
    )}
    {onScopeOff !== undefined && (
      <button type="button" data-empty-scope onClick={onScopeOff} className="delivery-text-link">· {SCOPE_OFF_WORDS}</button>
    )}
    {empty.note !== null && <span {...noteAttrs} data-empty-note className="basis-full text-xs">{empty.note}</span>}
  </div>
);

/** The mark of an empty kind as the folded summary slot shows it. */
export const SectionEmptyMark = ({ empty }: { empty: SectionEmpty }) => (
  <span data-section-empty={empty.kind} title={empty.sentence} className={EMPTY_MARK_CLASS[empty.kind]}>{EMPTY_MARK[empty.kind]}</span>
);

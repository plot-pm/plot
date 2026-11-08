import { createContext, useContext, useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Where a reason tooltip opens: `below` its control, or at its `start` edge
 * (left in a left-to-right page), beside it. A list of stacked controls, such
 * as the *More actions* menu, provides `start`, so a tooltip covers no sibling.
 */
export const TooltipPlacement = createContext<'below' | 'start'>('below');

/** What a control and its wrapper spread to carry a reason tooltip. */
export interface ReasonTooltip {
  /** Spread on the element wrapping the control; it anchors the tooltip and opens it on hover. */
  wrapperProps: {
    className?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onBlur?: (e: FocusEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
  };
  /** Spread on the control: its description, and opening on focus, closing on blur and Escape. */
  triggerProps: {
    'aria-describedby'?: string;
    onFocus?: (e: FocusEvent) => void;
  };
  /** Opens the tooltip; a refused click calls it, so a tap shows the reason and does nothing else. */
  show: () => void;
  /** The tooltip element, rendered after the control; `null` where there is no reason. */
  tooltip: ReactNode;
}

/**
 * A disabled control's reason, as its `aria-describedby` and a tooltip below it.
 *
 * The tooltip holds the sentence as plain text: a `role="tooltip"` element holds
 * no interactive content. It opens below the control, or beside it where a
 * {@link TooltipPlacement} provider says `start`. It opens on hover and on keyboard focus, closes when
 * focus leaves the wrapper, on leaving it with the pointer and on Escape, and
 * opens on `show()` for a tap. It replaces the native `title`, which shows on
 * neither focus nor touch. With no reason, every part is empty and the control
 * renders as it would without it.
 *
 * @param reason - the sentence to show; `null` or `''` for none.
 * @param kind - `reason` for why a control will not act (`data-action-reason`),
 *   `detail` for the rest of a fact's sentence (`data-detail`).
 * @returns the props for the wrapper and the control, `show`, and the tooltip element.
 */
export const useReasonTooltip = (reason: string | null, kind: 'reason' | 'detail' = 'reason'): ReasonTooltip => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const placement = useContext(TooltipPlacement);
  if (reason === null || reason.trim() === '') {
    return { wrapperProps: {}, triggerProps: {}, show: () => {}, tooltip: null };
  }
  return {
    wrapperProps: {
      className: 'relative inline-flex',
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onBlur: (e) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOpen(false);
      },
      onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false); },
    },
    triggerProps: {
      'aria-describedby': id,
      onFocus: () => setOpen(true),
    },
    show: () => setOpen(true),
    tooltip: (
      <span
        id={id}
        role="tooltip"
        {...(kind === 'reason' ? { 'data-action-reason': '' } : { 'data-detail': '' })}
        hidden={!open}
        data-placement={placement}
        className={`absolute z-20 w-max max-w-64 rounded bg-slate-800 px-2 py-1 text-xs font-normal text-white shadow dark:bg-slate-200 dark:text-slate-900 ${
          placement === 'start' ? 'top-0 right-full mr-2' : 'left-0 top-full mt-1'
        }`}
      >
        {reason}
      </span>
    ),
  };
};

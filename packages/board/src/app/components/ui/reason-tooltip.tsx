import { useId, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';

/** What a control and its wrapper spread to carry a reason tooltip. */
export interface ReasonTooltip {
  /** Spread on the element wrapping the control; it anchors the tooltip and opens it on hover. */
  wrapperProps: {
    className?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  };
  /** Spread on the control: its description, and opening on focus, closing on blur and Escape. */
  triggerProps: {
    'aria-describedby'?: string;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
  };
  /** Opens the tooltip; a refused click calls it, so a tap shows the reason and does nothing else. */
  show: () => void;
  /** The tooltip element, rendered after the control; `null` where there is no reason. */
  tooltip: ReactNode;
}

/**
 * A disabled control's reason, as its `aria-describedby` and a tooltip below it.
 *
 * The tooltip opens on hover and on keyboard focus, closes on blur, on leaving
 * and on Escape, and opens on `show()` for a tap. It replaces the native
 * `title`, which shows on neither focus nor touch. With no reason, every part
 * is empty and the control renders as it would without it.
 *
 * @param reason - the sentence to show; `null` or `''` for none.
 * @returns the props for the wrapper and the control, `show`, and the tooltip element.
 */
export const useReasonTooltip = (reason: string | null): ReasonTooltip => {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (reason === null || reason.trim() === '') {
    return { wrapperProps: {}, triggerProps: {}, show: () => {}, tooltip: null };
  }
  return {
    wrapperProps: {
      className: 'relative inline-flex',
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
    },
    triggerProps: {
      'aria-describedby': id,
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
      onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false); },
    },
    show: () => setOpen(true),
    tooltip: (
      <span
        id={id}
        role="tooltip"
        data-action-reason
        hidden={!open}
        className="absolute left-0 top-full z-20 mt-1 w-max max-w-64 rounded bg-slate-800 px-2 py-1 text-xs font-normal text-white shadow dark:bg-slate-200 dark:text-slate-900"
      >
        {reason}
      </span>
    ),
  };
};

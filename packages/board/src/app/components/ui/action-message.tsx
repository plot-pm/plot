import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The element a card gives its controls' messages: a full-width row under its footer row; `null` outside a card. */
export const ActionMessageTarget = createContext<HTMLElement | null>(null);

/**
 * A control's result message — a refusal or a confirmation. Inside a card it
 * renders in the card's message row, where it wraps across the card's width;
 * elsewhere it renders beside the control.
 *
 * @param className - the message's classes.
 * @param attrs - data attributes for the message element.
 * @param children - the message.
 */
export const ActionMessage = ({ className, attrs, children }: {
  className: string; attrs?: Record<string, string>; children: ReactNode;
}) => {
  const target = useContext(ActionMessageTarget);
  const node = <span className={className} {...attrs}>{children}</span>;
  return target ? createPortal(node, target) : node;
};

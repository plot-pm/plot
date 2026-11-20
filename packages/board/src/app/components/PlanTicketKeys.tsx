import { createContext, useContext, type ReactNode } from 'react';
import type { PlanLinkKey } from '@plot-pm/domain';

/** Resolves a ticket key to its address, or `undefined` where the board holds none. */
export type TicketHref = (key: string) => string | undefined;

/**
 * The board's ticket address lookup, `boardLinksOf(board).ticketHref`, for every plan link below it.
 *
 * The default resolves nothing, so a plan link outside a provider prints its keys as text.
 */
export const TicketHrefContext = createContext<TicketHref>(() => undefined);

/** The class of a ticket key, the plan card heading's ticket number style. */
const KEY_CLASS = 'font-normal tabular-nums text-(--card-meta)';

/**
 * A plan link's ticket keys, then the plan link: each key is its own link to its ticket, and the plan link follows
 * after one space.
 *
 * A key the board resolves to no address is muted text, never a link. With no keys, only `children` renders.
 *
 * @param keys - the printed keys, from `planReference`.
 * @param children - the surface's own plan link, which prints the slug alone.
 */
export const PlanTicketKeys = ({ keys, children }: { keys: readonly PlanLinkKey[]; children: ReactNode }) => {
  const ticketHref = useContext(TicketHrefContext);
  return (
    <>
      {keys.map(({ key, text }) => {
        const href = ticketHref(key);
        return (
          <span key={key} className="shrink-0 whitespace-pre">
            {href === undefined
              ? <span className={KEY_CLASS} data-title-number>{text}</span>
              : (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  data-title-number
                  data-ticket-link={key}
                  title={`Ticket ${text}`}
                  className={`${KEY_CLASS} hover:underline`}
                >
                  {text}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            {' '}
          </span>
        );
      })}
      {children}
    </>
  );
};

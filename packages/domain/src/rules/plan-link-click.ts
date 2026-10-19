import { z } from 'zod';

/**
 * What a plain click on a plan link does: open the modal for a resolved card,
 * remember the click while the board has not loaded, or let the anchor's own
 * navigation proceed.
 */
// plot-state: classification — one click's outcome, recomputed on every click; no value transitions into another.
export const PlanLinkClickSchema = z.enum(['open', 'wait', 'navigate']);
export type PlanLinkClick = z.infer<typeof PlanLinkClickSchema>;

/**
 * The outcome of a plain click on a plan link.
 *
 * `'open'` when the board holds a matching card. `'wait'` when the board has
 * not loaded yet — "not loaded" and "no card" are different answers, because a
 * click in the first seconds of a tab should not navigate away from a live
 * view for a plan the board is about to have. `'navigate'` when the board has
 * loaded and holds no matching card: the click cannot resolve, so it falls
 * back to the anchor's own navigation rather than being swallowed.
 *
 * @param boardLoaded - whether the board payload has arrived at least once.
 * @param cardFound - whether a card matching the clicked link exists in that payload.
 * @returns the click's outcome.
 */
export const planLinkClick = (boardLoaded: boolean, cardFound: boolean): PlanLinkClick => {
  if (cardFound) return 'open';
  if (!boardLoaded) return 'wait';
  return 'navigate';
};

/** The least time between two events the board server sends a page. */
export const SERVER_EVENT_WINDOW_MS = 1_000;

/** The least time between two refetches the page makes on an event. */
export const PAGE_REFETCH_WINDOW_MS = 2_000;

/** When the last event was admitted; `undefined` before the first. */
export interface EventWindow {
  admittedAt?: number;
}

/** The ruling on one arrival, and the window to carry forward. */
export interface EventRuling {
  admit: boolean;
  window: EventWindow;
}

/**
 * Whether an arrival at `now` opens a new window.
 *
 * The first arrival is admitted. Any arrival less than `windowMs` after the last
 * admitted one is dropped and does not move the window, so a burst yields its
 * first arrival and the next window opens `windowMs` after that one. A clock
 * that moved backwards admits, since a negative gap proves nothing about recency.
 *
 * @param window the window as of the last ruling
 * @param now the arrival time in milliseconds
 * @param windowMs the least gap between admitted arrivals
 */
export const ruleEventWindow = (window: EventWindow, now: number, windowMs: number): EventRuling => {
  const { admittedAt } = window;
  const inside = admittedAt !== undefined && now >= admittedAt && now - admittedAt < windowMs;
  return inside ? { admit: false, window } : { admit: true, window: { admittedAt: now } };
};

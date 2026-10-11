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
  /**
   * Set when the arrival was dropped: the time the open window closes. A caller
   * that wants the change heard schedules one send for then and asks again.
   */
  trailingAt?: number;
}

/**
 * Whether an arrival at `now` opens a new window.
 *
 * The first arrival is admitted. Any arrival less than `windowMs` after the last
 * admitted one is dropped and does not move the window, so a burst yields its
 * first arrival and the next window opens `windowMs` after that one. A clock
 * that moved backwards admits, since a negative gap proves nothing about recency.
 * A dropped arrival reports `trailingAt`, the end of the open window, so the
 * caller can send once for the whole burst instead of losing its tail.
 *
 * @param window the window as of the last ruling
 * @param now the arrival time in milliseconds
 * @param windowMs the least gap between admitted arrivals
 */
export const ruleEventWindow = (window: EventWindow, now: number, windowMs: number): EventRuling => {
  const { admittedAt } = window;
  const inside = admittedAt !== undefined && now >= admittedAt && now - admittedAt < windowMs;
  return inside ? { admit: false, window, trailingAt: admittedAt + windowMs } : { admit: true, window: { admittedAt: now } };
};

/** Whether the page has already heard one `welcome` on this stream. */
export interface WelcomeWindow {
  heard: boolean;
}

/** The ruling on one `welcome`, and the state to carry forward. */
export interface WelcomeRuling {
  refetch: boolean;
  window: WelcomeWindow;
}

/**
 * Whether a `welcome` makes the page refetch.
 *
 * The first `welcome` after the page opened its stream is current by
 * construction: the page loaded the board itself a moment earlier. Every later
 * `welcome` (a reconnect to the server or the channel) refetches.
 *
 * @param window the state as of the last `welcome`
 */
export const ruleWelcome = (window: WelcomeWindow): WelcomeRuling => ({
  refetch: window.heard,
  window: { heard: true },
});

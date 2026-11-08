import {
  PAGE_REFETCH_WINDOW_MS,
  ruleEventWindow,
  ruleWelcome,
  type EventWindow,
  type WelcomeState,
} from '@plot-pm/domain';

/** The slice of `EventSource` the listener uses, so a test can substitute one. */
export interface EventSourceLike {
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

/** The slice of `document` the visibility rule reads, so a test can substitute one. */
export interface PageLike {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface EventListenerOptions {
  /** Opens the stream; defaults to {@link openSharedEventSource}. */
  open?: () => EventSourceLike;
  /** The page whose visibility decides whether the stream is open; defaults to `document`. */
  page?: PageLike;
  /** Called at most once per window while events arrive. */
  refetch: () => void;
  /** Milliseconds clock; defaults to `Date.now`. */
  now?: () => number;
  /** The least gap between two refetches; defaults to {@link PAGE_REFETCH_WINDOW_MS}. */
  windowMs?: number;
}

const EVENTS_URL = '/api/events';
const SHARE_NAME = 'plot-board-events';

/**
 * Whether a page in this visibility state holds a stream and polls.
 *
 * A hidden page does neither, so a forgotten background tab keeps no board
 * watched. A page with no visibility reading counts as shown.
 */
export const pageShown = (visibility: DocumentVisibilityState | undefined): boolean => visibility !== 'hidden';

const defaultPage = (): PageLike | undefined => (typeof document === 'undefined' ? undefined : document);

/**
 * Run `start` while the page is shown, and the stop it returns while hidden.
 *
 * `start` runs at once when the page is shown, and again each time it shows
 * after a hide. With no page, `start` runs once and nothing stops it but the
 * returned function.
 *
 * @param page the page to watch; `undefined` counts as always shown
 * @param start begins the work and returns the function that ends it
 * @param onShow called after `start` each time the page shows after a hide
 * @returns a function that ends the work and removes the listener
 */
const whileShown = (page: PageLike | undefined, start: () => () => void, onShow?: () => void): (() => void) => {
  let stop: (() => void) | undefined;
  const apply = (): void => {
    const shown = pageShown(page?.visibilityState);
    if (shown && !stop) {
      stop = start();
      onShow?.();
    } else if (!shown && stop) {
      stop();
      stop = undefined;
    }
  };
  if (pageShown(page?.visibilityState)) stop = start();
  page?.addEventListener('visibilitychange', apply);
  return () => {
    page?.removeEventListener('visibilitychange', apply);
    stop?.();
    stop = undefined;
  };
};

/**
 * Call `poll` every `ms` milliseconds while the page is shown.
 *
 * A hidden page clears the interval; a shown page restores it and polls nothing
 * at once, since the page's own `visibilitychange` handler reloads on return.
 *
 * @param page the page to watch; `undefined` counts as always shown
 * @returns a function that clears the interval and removes the listener
 */
export const pollWhileShown = (page: PageLike | undefined, poll: () => void, ms: number): (() => void) =>
  whileShown(page, () => {
    const id = setInterval(poll, ms);
    return () => clearInterval(id);
  });

/**
 * One `EventSource` for every tab of a browser.
 *
 * A browser holds at most six HTTP/1.1 connections per host and the board
 * server speaks HTTP/1.1, so a seventh tab with its own stream never connects.
 * The tab holding the Web Lock `plot-board-events` opens the real stream and
 * relays each message over a `BroadcastChannel`; the others only listen. When the
 * holder closes, the browser grants the lock to the next waiting tab, which opens
 * the stream. Closing a tab that still waits aborts its lock request, so the
 * browser never grants the lock to it. A browser without either API gets a
 * stream of its own.
 */
export const openSharedEventSource = (): EventSourceLike => {
  if (typeof BroadcastChannel === 'undefined' || typeof navigator === 'undefined' || !navigator.locks) {
    // The DOM's handler type is narrower than the listener's; both are called with a message event.
    return new EventSource(EVENTS_URL) as unknown as EventSourceLike;
  }
  const relay = new BroadcastChannel(SHARE_NAME);
  const shared: EventSourceLike = { onmessage: null, onerror: null, close: () => undefined };
  const waiting = new AbortController();
  let closed = false;
  let release: (() => void) | undefined;
  let real: EventSource | undefined;
  relay.onmessage = (event) => shared.onmessage?.(event);
  navigator.locks
    .request(SHARE_NAME, { signal: waiting.signal }, () => {
      if (closed) return undefined;
      real = new EventSource(EVENTS_URL);
      real.onmessage = (event) => {
        relay.postMessage(event.data);
        shared.onmessage?.(event);
      };
      real.onerror = (event) => shared.onerror?.(event);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    })
    // An aborted request rejects; that is the close below, not a failure.
    .catch(() => undefined);
  shared.close = () => {
    closed = true;
    waiting.abort();
    real?.close();
    release?.();
    relay.close();
  };
  return shared;
};

const isWelcome = (event: unknown): boolean => {
  const data = (event as { data?: unknown } | null)?.data;
  if (typeof data !== 'string') return false;
  try {
    return (JSON.parse(data) as { type?: unknown } | null)?.type === 'welcome';
  } catch {
    return false;
  }
};

/**
 * Refetch the board when the server reports a change, and say nothing otherwise.
 *
 * The event body is ignored: the refetch is the only path into the page's state.
 * An event inside the window is not lost: one trailing refetch fires when the
 * window closes. A `welcome` within one window of the listener starting
 * refetches nothing, since the page loaded the board itself just before; every
 * later `welcome` refetches, including one relayed from the tab that holds the
 * shared stream and the first one of a stream this tab opens on taking it over.
 * A stream error is dropped on purpose — `EventSource` reconnects by itself and
 * the 30 s poll stays the authority, so an error neither shows nor stops anything.
 *
 * The stream is open only while the page is shown ({@link pageShown}). A page
 * that hides closes it, which for the shared stream releases the Web Lock or
 * aborts the waiting request and closes the relay. A page that shows again opens
 * a new stream and refetches once.
 *
 * @returns a function that closes the stream and stops watching the page
 */
export const listenForEvents = (options: EventListenerOptions): (() => void) => {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? PAGE_REFETCH_WINDOW_MS;
  const open = options.open ?? openSharedEventSource;
  let eventWindow: EventWindow = {};
  const welcomeState: WelcomeState = { startedAt: now() };
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const arrive = (): void => {
    const ruling = ruleEventWindow(eventWindow, now(), windowMs);
    eventWindow = ruling.window;
    if (ruling.admit) {
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
      options.refetch();
      return;
    }
    if (trailing || ruling.trailingAt === undefined) return;
    trailing = setTimeout(() => {
      trailing = undefined;
      arrive();
    }, Math.max(1, ruling.trailingAt - now()));
  };
  const start = (): (() => void) => {
    const source = open();
    source.onmessage = (event) => {
      if (isWelcome(event) && !ruleWelcome(welcomeState, now(), windowMs)) return;
      arrive();
    };
    source.onerror = () => undefined;
    return () => {
      if (trailing) clearTimeout(trailing);
      trailing = undefined;
      source.close();
    };
  };
  // A page that shows again was blind while hidden: it refetches once, and the
  // new stream's first `welcome` counts as current.
  const onShow = (): void => {
    welcomeState.startedAt = now();
    eventWindow = { admittedAt: now() };
    options.refetch();
  };
  return whileShown(options.page ?? defaultPage(), start, onShow);
};

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

export interface EventListenerOptions {
  /** Opens the stream; defaults to {@link openSharedEventSource}. */
  open?: () => EventSourceLike;
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
 * One `EventSource` for every tab of a browser.
 *
 * A browser holds at most six HTTP/1.1 connections per host and the board
 * server speaks HTTP/1.1, so a seventh tab with its own stream never connects.
 * The tab holding the Web Lock `plot-board-events` opens the real stream and
 * relays each message over a `BroadcastChannel`; the others only listen. When the
 * holder closes, the browser grants the lock to the next waiting tab, which opens
 * the stream. A browser without either API gets a stream of its own.
 */
export const openSharedEventSource = (): EventSourceLike => {
  if (typeof BroadcastChannel === 'undefined' || typeof navigator === 'undefined' || !navigator.locks) {
    // The DOM's handler type is narrower than the listener's; both are called with a message event.
    return new EventSource(EVENTS_URL) as unknown as EventSourceLike;
  }
  const relay = new BroadcastChannel(SHARE_NAME);
  const shared: EventSourceLike = { onmessage: null, onerror: null, close: () => undefined };
  let closed = false;
  let release: (() => void) | undefined;
  let real: EventSource | undefined;
  relay.onmessage = (event) => shared.onmessage?.(event);
  void navigator.locks.request(SHARE_NAME, () => {
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
  });
  shared.close = () => {
    closed = true;
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
 * @returns a function that closes the stream
 */
export const listenForEvents = (options: EventListenerOptions): (() => void) => {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? PAGE_REFETCH_WINDOW_MS;
  let eventWindow: EventWindow = {};
  const welcomeState: WelcomeState = { startedAt: now() };
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const source = (options.open ?? openSharedEventSource)();
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

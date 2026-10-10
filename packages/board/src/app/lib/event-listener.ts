import { PAGE_REFETCH_WINDOW_MS, ruleEventWindow, type EventWindow } from '@plot-pm/domain';

/** The slice of `EventSource` the listener uses, so a test can substitute one. */
export interface EventSourceLike {
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

export interface EventListenerOptions {
  /** Opens the stream; defaults to a real `EventSource` on `/api/events`. */
  open?: () => EventSourceLike;
  /** Called at most once per window while events arrive. */
  refetch: () => void;
  /** Milliseconds clock; defaults to `Date.now`. */
  now?: () => number;
  /** The least gap between two refetches; defaults to {@link PAGE_REFETCH_WINDOW_MS}. */
  windowMs?: number;
}

/**
 * Refetch the board when the server reports a change, and say nothing otherwise.
 *
 * The event body is ignored: the refetch is the only path into the page's state.
 * A stream error is dropped on purpose — `EventSource` reconnects by itself and
 * the 30 s poll stays the authority, so an error neither shows nor stops anything.
 *
 * @returns a function that closes the stream
 */
export const listenForEvents = (options: EventListenerOptions): (() => void) => {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? PAGE_REFETCH_WINDOW_MS;
  let window: EventWindow = {};
  const source = (options.open ?? (() => new EventSource('/api/events')))();
  source.onmessage = () => {
    const ruling = ruleEventWindow(window, now(), windowMs);
    window = ruling.window;
    if (ruling.admit) options.refetch();
  };
  source.onerror = () => undefined;
  return () => source.close();
};

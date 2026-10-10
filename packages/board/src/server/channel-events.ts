import type http from 'node:http';
import type { ChannelMessage } from '@plot-pm/domain';
import { ruleEventWindow, SERVER_EVENT_WINDOW_MS, type EventWindow } from '@plot-pm/domain';
import { subscribe, type Subscribed } from '@plot-pm/domain/adapters';

/**
 * The board's one subscription to the channel, and the SSE fan-out behind
 * `GET /api/events`.
 *
 * The server is a reader: it never publishes, never calls `seen` and never
 * writes to the channel. An event tells the page that something changed; the page
 * refetches `/api/board` and renders that answer, so the event body is for a log
 * or a test and the page ignores it.
 */

/** First reconnect delay and its cap, in milliseconds. */
export const RECONNECT_START_MS = 2_000;
export const RECONNECT_CAP_MS = 30_000;

export interface EventHubOptions {
  /** The channel's socket path. */
  address: string;
  /** Records a transition (connected, lost); called once per transition, not per attempt. */
  log?: (line: string) => void;
  /** Milliseconds clock; defaults to `Date.now`. */
  now?: () => number;
  /** The least gap between two events sent; defaults to {@link SERVER_EVENT_WINDOW_MS}. */
  windowMs?: number;
  /** First reconnect delay; defaults to {@link RECONNECT_START_MS}. */
  reconnectStartMs?: number;
  /** Reconnect delay cap; defaults to {@link RECONNECT_CAP_MS}. */
  reconnectCapMs?: number;
}

export interface EventHub {
  /** Hold `res` open as an event stream until the client goes away. */
  attach(req: http.IncomingMessage, res: http.ServerResponse): void;
  /** Number of streams currently held. */
  clients(): number;
  /** Stop the subscription and end every stream. */
  close(): void;
}

/**
 * Subscribe once and serve every attached response from that subscription.
 *
 * A missing channel is the normal case: the subscription retries with a doubling
 * delay and never throws into a request. Any end of an `everything` subscription
 * means reconnect, whatever the reason.
 */
export const startEventHub = (options: EventHubOptions): EventHub => {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? SERVER_EVENT_WINDOW_MS;
  const startMs = options.reconnectStartMs ?? RECONNECT_START_MS;
  const capMs = options.reconnectCapMs ?? RECONNECT_CAP_MS;
  const log = options.log ?? (() => undefined);

  const streams = new Set<http.ServerResponse>();
  let window: EventWindow = {};
  let subscription: Subscribed | undefined;
  let timer: NodeJS.Timeout | undefined;
  let delay = startMs;
  let connected = false;
  // Log transitions only: a channel that stays absent is one line, not one per attempt.
  let link: 'unknown' | 'up' | 'down' = 'unknown';
  let stopped = false;

  const write = (res: http.ServerResponse, data: string): void => {
    if (res.destroyed || res.writableEnded) {
      streams.delete(res);
      return;
    }
    res.write(`data: ${data}\n\n`);
  };

  const broadcast = (data: string): void => {
    for (const res of [...streams]) write(res, data);
  };

  const onMessage = (message: ChannelMessage): void => {
    if (message.type === 'welcome') {
      // A subscription that opens is current once; it bypasses the window but
      // opens one, so the burst of findings that follows folds into it.
      if (link !== 'up') log('channel: connected');
      link = 'up';
      connected = true;
      delay = startMs;
      window = { admittedAt: now() };
      broadcast(JSON.stringify({ type: 'welcome' }));
      return;
    }
    if (message.type !== 'finding') return;
    const ruling = ruleEventWindow(window, now(), windowMs);
    window = ruling.window;
    if (ruling.admit) broadcast(JSON.stringify({ type: 'finding', finding: message.finding }));
  };

  const connect = (): void => {
    timer = undefined;
    if (stopped) return;
    try {
      subscription = subscribe(
        { address: options.address, subscriber: 'board', purpose: { kind: 'everything' } },
        onMessage,
        (reason) => {
          subscription = undefined;
          if (link !== 'down') log(`channel: ${link === 'up' ? 'lost' : 'not reachable'} (${reason || 'closed'}); retrying`);
          link = 'down';
          connected = false;
          if (stopped) return;
          timer = setTimeout(connect, delay);
          timer.unref?.();
          delay = Math.min(delay * 2, capMs);
        },
      );
    } catch (err) {
      // subscribe reports failures through onEnd; this is the unexpected throw.
      log(`channel: subscribe failed (${err instanceof Error ? err.message : String(err)})`);
      timer = setTimeout(connect, delay);
      timer.unref?.();
      delay = Math.min(delay * 2, capMs);
    }
  };
  connect();

  return {
    attach: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': open\n\n');
      streams.add(res);
      const release = (): void => {
        streams.delete(res);
      };
      req.on('close', release);
      res.on('close', release);
      res.on('error', release);
      // A page that connects while the subscription is live is current once.
      if (connected) write(res, JSON.stringify({ type: 'welcome' }));
    },
    clients: () => streams.size,
    close: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      subscription?.close();
      for (const res of [...streams]) res.end();
      streams.clear();
    },
  };
};

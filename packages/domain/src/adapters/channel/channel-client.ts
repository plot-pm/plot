import { connect, type Socket } from 'node:net';
import { decode, type ChannelMessage } from '../../entities/channel-message.js';
import type { Finding } from '../../entities/finding.js';
import { SNAPSHOT_PROTOCOL, type Purpose, type SubscribeRequest } from '../../entities/subscription.js';
import { linkAfter, linkAfterEnd, type SnapshotLink } from '../../rules/snapshot-link.js';
import { applySnapshotMessage, type HeldSnapshot } from '../../rules/snapshot-sync.js';

/**
 * The subscriber's half of the channel — the side the master agent connects on.
 *
 * THE CHANNEL SLICE BUILT THE LISTENER AND NOT THE CALLER. `startChannel`
 * accepts subscriptions and its tests drive it with raw sockets; nothing yet
 * SPEAKS the protocol as a client, and every subscriber writing its own framing
 * is how two implementations of one wire format come to disagree.
 *
 * IT DECIDES NOTHING. It frames lines, sends the purpose and hands each message
 * on. Which findings license an act is `rules/acting.ts`'s and stays there.
 */

/** What a subscriber says when it connects, and where. */
export interface SubscribeOptions {
  /** The socket path the channel listens on. */
  address: string;
  /** The subscriber's own name, for the log. */
  subscriber: string;
  /** Why it connected. */
  purpose: Purpose;
}

/** What a subscriber does with each message, and how it lets go. */
export interface Subscribed {
  /** Stop listening and close the connection. */
  close(): void;
}

/**
 * Connect to the channel and hear what serves this purpose.
 *
 * A REFUSAL AND A SERVING BOTH END THE SUBSCRIPTION, and the caller hears
 * which. That is the distinction the `served` message exists to draw: a close
 * is what a crash looks like too, so a subscriber that only watched the socket
 * could not tell being served from being dropped.
 *
 * @param options where to connect and why
 * @param onMessage called once per message, in arrival order
 * @param onEnd called when the connection ends, with the reason where there was
 *   one — `''` for an ordinary close
 * @returns the handle to close it with
 */
export const subscribe = (
  options: SubscribeOptions,
  onMessage: (message: ChannelMessage) => void,
  onEnd: (reason: string) => void = () => undefined,
): Subscribed => {
  const socket: Socket = connect(options.address);
  let ended = false;
  const end = (reason: string) => {
    if (ended) return;
    ended = true;
    onEnd(reason);
  };

  socket.setEncoding('utf8');
  socket.on('connect', () => {
    const request: SubscribeRequest = {
      subscriber: options.subscriber,
      purpose: options.purpose,
    };
    socket.write(`${JSON.stringify(request)}\n`);
  });

  let buffer = '';
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      const message = decode(line);
      // A LINE THAT IS NOT THIS PROTOCOL IS SKIPPED, the tolerance `decode`
      // already applies for the reason it states: a subscriber that died on one
      // malformed line is one any stray write could kill.
      if (message !== undefined) onMessage(message);
    }
  });

  // A CHANNEL THAT IS NOT THERE IS NOT AN ERROR TO THROW. The monitors are
  // optional — nothing dispatches them in a repo with no fleet — and an
  // unhandled ECONNREFUSED would take down the agent that asked.
  socket.on('error', (error: Error) => end(error.message));
  socket.on('close', () => end(''));

  return {
    close: () => {
      ended = true;
      socket.destroy();
    },
  };
};

/** The findings a message carries, or none where it carries no finding. */
export const findingsIn = (message: ChannelMessage): readonly Finding[] => {
  if (message.type === 'welcome') return message.current;
  if (message.type === 'finding') return [message.finding];
  if (message.type === 'served') return [message.finding];
  return [];
};

/** First reconnect delay of a snapshot reader and its cap, in milliseconds. */
export const SNAPSHOT_RECONNECT_START_MS = 1_000;
export const SNAPSHOT_RECONNECT_CAP_MS = 30_000;

/** What {@link subscribeSnapshot} tunes; a test shortens the delays. */
export interface SubscribeSnapshotOptions {
  /** The subscriber's own name, for the log; `board` by default. */
  subscriber?: string;
  /** First reconnect delay; {@link SNAPSHOT_RECONNECT_START_MS} by default. */
  reconnectStartMs?: number;
  /** Reconnect delay cap; {@link SNAPSHOT_RECONNECT_CAP_MS} by default. */
  reconnectCapMs?: number;
}

/** What a snapshot reader reports on each change of its link or its copy. */
export type SnapshotStateListener = (link: SnapshotLink, held: HeldSnapshot | undefined) => void;

/**
 * Holds a copy of the sender's snapshot over the channel.
 *
 * Subscribes for the `snapshot` purpose, judges every `snapshot`, `delta` and
 * `refused` message through `applySnapshotMessage` and reports the resulting
 * link through `onState`. A `resync` closes the connection and subscribes
 * again at once; a lost connection subscribes again after a doubling delay;
 * a `mismatch` is retried at the delay cap, so a sender upgraded in place is
 * found without a restart of the reader. It decides nothing itself: every
 * judgement is `rules/snapshot-sync.ts`'s and `rules/snapshot-link.ts`'s.
 *
 * @param address - the channel's socket path.
 * @param onState - called after every change of the link or the copy; the
 *   first call is `absent`.
 * @param options - the subscriber name and reconnect delays.
 * @returns the handle: `held` is the copy now, `close` stops the reader.
 */
export const subscribeSnapshot = (
  address: string,
  onState: SnapshotStateListener,
  options: SubscribeSnapshotOptions = {},
): { held: () => HeldSnapshot | undefined; link: () => SnapshotLink; close: () => void } => {
  const startMs = options.reconnectStartMs ?? SNAPSHOT_RECONNECT_START_MS;
  const capMs = options.reconnectCapMs ?? SNAPSHOT_RECONNECT_CAP_MS;
  let held: HeldSnapshot | undefined;
  let link: SnapshotLink = { state: 'absent' };
  let delay = startMs;
  let current: Subscribed | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const report = (next: SnapshotLink): void => {
    link = next;
    onState(link, held);
  };

  const open = (): void => {
    timer = undefined;
    if (stopped) return;
    let over = false;
    const handle = subscribe(
      { address, subscriber: options.subscriber ?? 'board', purpose: { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL } },
      (message) => {
        if (over || (message.type !== 'snapshot' && message.type !== 'delta' && message.type !== 'refused')) return;
        const sync = applySnapshotMessage(held, message);
        if (sync.outcome === 'adopt' || sync.outcome === 'apply') {
          held = sync.held;
          delay = startMs;
        }
        report(linkAfter(sync));
        if (sync.outcome === 'resync') {
          over = true;
          handle.close();
          current = undefined;
          timer = setTimeout(open, 0);
          timer.unref?.();
        }
      },
      () => {
        if (over || stopped) return;
        over = true;
        current = undefined;
        const next = linkAfterEnd(link);
        if (next !== link) report(next);
        timer = setTimeout(open, link.state === 'mismatch' ? capMs : delay);
        timer.unref?.();
        delay = Math.min(delay * 2, capMs);
      },
    );
    current = handle;
  };

  onState(link, held);
  open();
  return {
    held: () => held,
    link: () => link,
    close: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      current?.close();
    },
  };
};

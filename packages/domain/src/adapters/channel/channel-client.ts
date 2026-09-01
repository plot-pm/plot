import { connect, type Socket } from 'node:net';
import { decode, type ChannelMessage } from '../../entities/channel-message.js';
import type { Finding } from '../../entities/finding.js';
import type { Purpose, SubscribeRequest } from '../../entities/subscription.js';

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

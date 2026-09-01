import type { ChannelMessage } from '../entities/channel-message.js';

/**
 * One connected subscriber, as the channel writes to it.
 *
 * The narrowest surface a transport can offer: send a message, or end the
 * connection. Everything else the protocol needs — which purposes are servable,
 * who receives what, when a subscription is finished — is decided in
 * `rules/channel.ts` against values, so nothing below is needed to test it.
 */
export interface ChannelConnection {
  /** The connection's id, unique for as long as it is open. */
  readonly id: string;
  /** Write one message. Failure is silent: a subscriber that has gone is not an error. */
  send(message: ChannelMessage): void;
  /** Close it — because its purpose was served, or because the channel is stopping. */
  close(): void;
}

/**
 * Where the channel listens, and how it stops.
 *
 * A SOCKET, NOT A PORT, and the Machine is why: everything runs on one
 * (DESIGN-machine.md — *"There is exactly one Machine"*), so the monitor, the
 * board and the master agent are neighbours rather than peers across a network.
 * A port is how you reach another machine; there is one.
 *
 * The wrapper decided it. `plot-dispatch.sh:275` calls it *"a fresh shell that
 * cannot reach"* the dispatcher — no inherited descriptors, no environment
 * beyond what is passed. A filesystem path is exactly what such a shell CAN
 * reach, and HTTP-to-the-board would have needed a board running: measured
 * 2026-08-30, none was.
 */
export interface ChannelPort {
  /** The path it listens on. */
  readonly address: string;
  /** Stop listening and close every subscriber. */
  stop(): Promise<void>;
}

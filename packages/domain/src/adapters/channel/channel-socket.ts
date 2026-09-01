import { createServer, type Server, type Socket } from 'node:net';
import { unlinkSync } from 'node:fs';
import type { ChannelConnection, ChannelPort } from '../../ports/channel.js';
import {
  decode,
  encode,
  type ChannelMessage,
} from '../../entities/channel-message.js';
import { MEASURABLE, absorb, admit, monitorLiveness, onJoin, route } from '../../rules/channel.js';
import { FindingSchema, type Finding, type MonitorName } from '../../entities/finding.js';
import { isServed, type Subscription } from '../../entities/subscription.js';

/**
 * The channel's transport: a unix socket under `.plot/`, speaking NDJSON.
 *
 * THE ONLY FILE HERE THAT REACHES THE WORLD. Every decision it makes is
 * `rules/channel.ts`'s — this opens the socket, frames the lines and holds the
 * connections, and defers on which purposes may be served, who receives a
 * finding and when a subscription is over. That split is what lets the protocol
 * be tested without a socket and the socket be tested for the boundary alone.
 *
 * TWO KINDS OF PEER ON ONE PATH, told apart by what they say first:
 *
 *   {"type":"publish","finding":{…}}   a monitor, reporting
 *   {"subscriber":"board","purpose":…} a subscriber, connecting with a purpose
 *
 * One path rather than two, because a monitor is not a privileged party — it
 * writes what any process on this Machine could write, and the socket's file
 * permissions are the boundary that matters. A second path would suggest a
 * trust distinction the filesystem is not making.
 */

/** How often the channel says it is alive, in milliseconds. */
const HEARTBEAT_MS = 10_000;

export interface ChannelOptions {
  /** The socket path — under `.plot/`, so it is present whenever the repo is. */
  address: string;
  /**
   * How often to beat, in ms.
   *
   * A test drives this rather than waiting: the heartbeat's PURPOSE is testable
   * in milliseconds, and the ten seconds is a cadence rather than a property.
   */
  heartbeatMs?: number;
  /** Reads the clock. Injected so `measuredAt` is assertable. */
  now?: () => string;
}

/** The channel, once it is listening. */
export interface RunningChannel extends ChannelPort {
  /** Every finding it currently holds — state, not history. */
  findings(): readonly Finding[];
  /** How many subscribers are connected. */
  subscriberCount(): number;
}

/**
 * Start the channel on a socket path.
 *
 * A STALE SOCKET IS REMOVED BEFORE BINDING. A monitor killed with SIGKILL
 * leaves its socket file behind, and `bind` on an existing path fails with
 * EADDRINUSE — which would mean a channel that never recovers from an unclean
 * death without someone deleting a file by hand. The file is not a lock: the
 * process holding it is gone, and refusing to start would be treating a
 * leftover as an owner.
 */
export const startChannel = async (options: ChannelOptions): Promise<RunningChannel> => {
  const { address } = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const now = options.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));

  /** The current findings, keyed by monitor and branch — replaced, never appended. */
  let held: readonly Finding[] = [];
  /** When each monitor last said anything, so the heartbeat can carry it. */
  const lastSeen = new Map<MonitorName, string>();
  /** The live subscriptions, by connection id. */
  const subscriptions = new Map<string, { subscription: Subscription; connection: ChannelConnection }>();

  let nextId = 0;

  const server: Server = createServer((socket) => {
    const id = `c${++nextId}`;
    const connection = connectionFor(id, socket);
    let joined = false;

    onLines(socket, (line) => {
      const parsed = safeJson(line);
      if (parsed === undefined) return;

      // A MONITOR PUBLISHING. Its connection carries no purpose and it is never
      // added to the subscriptions — a publisher is not a listener, and holding
      // one as though it were would send it its own findings.
      if (isPublish(parsed)) {
        const finding = FindingSchema.safeParse(parsed.finding);
        if (!finding.success) return;
        publish(finding.data);
        return;
      }

      // A SUBSCRIBER CONNECTING, and it may do so only once: a second purpose on
      // one connection would leave the first unaccounted for.
      if (joined) return;
      joined = true;

      const admission = admit(id, parsed);
      if (!admission.ok) {
        // REFUSED IMMEDIATELY rather than left pending, which is the whole
        // point — a subscriber waiting forever on a condition nobody checks is
        // the failure this channel exists to end.
        connection.send({
          type: 'refused',
          reason: admission.reason,
          asked: admission.asked,
          measurable: [...admission.measurable],
        });
        connection.close();
        return;
      }

      const { subscription } = admission;
      const { send, finished } = onJoin(subscription, held);
      connection.send({ type: 'welcome', current: [...send], measurable: [...MEASURABLE] });

      if (finished) {
        // Already true when it asked: served at once rather than made to wait
        // for the condition to happen a second time. `onJoin` only reports
        // finished for an `until` purpose, so the finding it names is the one
        // that matched.
        const served = send.find((f) => isServed(subscription.purpose, f));
        if (served) {
          connection.send({ type: 'served', finding: served });
          connection.close();
          return;
        }
      }

      subscriptions.set(id, { subscription, connection });
    });

    // A PURPOSE DIES WITH ITS SUBSCRIBER. A monitor holding purposes for absent
    // listeners accumulates state it can never discharge — which is how a
    // component that exists to notice things stops noticing.
    const forget = () => subscriptions.delete(id);
    socket.on('close', forget);
    socket.on('error', forget);
  });

  const publish = (finding: Finding): void => {
    held = absorb(held, finding);
    lastSeen.set(finding.monitor, finding.measuredAt);

    const live = [...subscriptions.values()];
    const { send, finished } = route(
      live.map((s) => s.subscription),
      finding,
    );
    const byId = new Map(live.map((s) => [s.subscription.id, s.connection]));

    for (const subscription of send) {
      byId.get(subscription.id)?.send({ type: 'finding', finding });
    }
    // SERVED IS A MESSAGE, NOT A CLOSE. A close is what a crash looks like too,
    // and a subscriber that waited for a condition needs to tell being served
    // from being dropped.
    for (const subscription of finished) {
      byId.get(subscription.id)?.send({ type: 'served', finding });
      byId.get(subscription.id)?.close();
      subscriptions.delete(subscription.id);
    }
  };

  // THE HEARTBEAT IS HOW A DEAD MONITOR IS VISIBLE. Nothing watches a
  // publisher's end of the socket, so a monitor that died quietly looks exactly
  // like one with nothing to say — unless something is beating.
  const beat = setInterval(() => {
    const message: ChannelMessage = {
      type: 'heartbeat',
      measuredAt: now(),
      monitors: [...lastSeen.entries()].map(([monitor, seen]) => ({ monitor, lastSeen: seen })),
    };
    for (const { connection } of subscriptions.values()) connection.send(message);
  }, heartbeatMs);
  beat.unref?.();

  removeStaleSocket(address);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    address,
    findings: () => held,
    subscriberCount: () => subscriptions.size,
    stop: async () => {
      clearInterval(beat);
      for (const { connection } of subscriptions.values()) connection.close();
      subscriptions.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      removeStaleSocket(address);
    },
  };
};

/** One subscriber, as the protocol writes to it. */
const connectionFor = (id: string, socket: Socket): ChannelConnection => ({
  id,
  send: (message) => {
    // A SUBSCRIBER THAT HAS GONE IS NOT AN ERROR. Writing to a closed socket
    // throws EPIPE, and a channel that died of one would be taken down by any
    // subscriber pressing ^C.
    if (!socket.destroyed) socket.write(encode(message), () => undefined);
  },
  close: () => socket.end(),
});

/**
 * Call back once per complete line.
 *
 * A TCP-shaped stream splits wherever it likes, so a message can arrive in two
 * chunks and two messages in one. The partial tail is carried rather than
 * parsed — the reason NDJSON needs framing at all.
 */
const onLines = (socket: Socket, onLine: (line: string) => void): void => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      onLine(line);
      index = buffer.indexOf('\n');
    }
  });
};

const safeJson = (line: string): unknown => {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const isPublish = (value: unknown): value is { type: 'publish'; finding: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'publish';

/** Remove a socket file left by an unclean death, so binding can succeed. */
const removeStaleSocket = (address: string): void => {
  try {
    unlinkSync(address);
  } catch {
    // Nothing there, or not ours to remove — `listen` will say which.
  }
};

export { decode, monitorLiveness };

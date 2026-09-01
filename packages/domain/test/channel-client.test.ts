import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startChannel, type RunningChannel } from '../src/adapters/channel/channel-socket.js';
import { findingsIn, subscribe, type Subscribed } from '../src/adapters/channel/channel-client.js';
import type { ChannelMessage } from '../src/entities/channel-message.js';
import type { Finding } from '../src/entities/finding.js';

/**
 * The SUBSCRIBER's half of the transport, against the real listener.
 *
 * The channel slice asserted the listener with raw sockets. What this asserts
 * is that a caller speaking the protocol through `subscribe` hears the same
 * things — a welcome carrying current state, a finding as it is published, a
 * refusal that ends rather than hangs.
 *
 * REAL SOCKETS ON BOTH SIDES, for the reason the listener's own test gives: a
 * mock of a transport asserts the mock, and the boundary is where the bugs are.
 */

const finding = (over: Partial<Finding> = {}): Finding => ({
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-08-31T10:00:00Z',
  evidence: '4 commits ahead, no PR',
  measuredAt: '2026-08-31T10:00:00Z',
  ...over,
});

/** A monitor, publishing one finding and going away. */
const publish = async (address: string, f: Finding): Promise<void> => {
  const socket: Socket = connect(address);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  socket.write(`${JSON.stringify({ type: 'publish', finding: f })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.destroy();
};

/** Wait until a predicate holds, or give up — never a bare sleep on a race. */
const until = async (holds: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

let channel: RunningChannel | undefined;
const opened: Subscribed[] = [];

const socketPath = (): string => join(mkdtempSync(join(tmpdir(), 'plot-client-')), 'c.sock');

afterEach(async () => {
  for (const s of opened.splice(0)) s.close();
  await channel?.stop();
  channel = undefined;
});

describe('a subscriber speaking the protocol', () => {
  it('is welcomed with what is true now, not a replay', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    await publish(address, finding({ finding: 'holds unlanded work' }));
    await publish(address, finding({ finding: 'owes a review' }));

    const seen: ChannelMessage[] = [];
    opened.push(subscribe({ address, subscriber: 't', purpose: { kind: 'everything' } },
      (m) => seen.push(m)));
    await until(() => seen.length > 0);

    const welcome = seen[0];
    expect(welcome.type).toBe('welcome');
    if (welcome.type === 'welcome') {
      // ONE finding, not two — the channel carries current state, and the
      // second reading about one branch REPLACED the first.
      expect(welcome.current).toHaveLength(1);
      expect(welcome.current[0].finding).toBe('owes a review');
    }
  });

  it('hears a finding published after it joined', async () => {
    const address = socketPath();
    channel = await startChannel({ address });

    const seen: ChannelMessage[] = [];
    opened.push(subscribe({ address, subscriber: 't', purpose: { kind: 'everything' } },
      (m) => seen.push(m)));
    await until(() => seen.length > 0);
    await publish(address, finding());
    await until(() => seen.some((m) => m.type === 'finding'));

    const message = seen.find((m) => m.type === 'finding');
    expect(message && findingsIn(message)[0].branch).toBe('feature/one');
  });

  // A REFUSED PURPOSE IS ANSWERED IMMEDIATELY rather than left pending. A
  // subscriber waiting forever on a condition nobody checks is the failure the
  // channel exists to end, reproduced inside the mechanism meant to end it.
  it('is told what could not be served, and the connection ends', async () => {
    const address = socketPath();
    channel = await startChannel({ address });

    const seen: ChannelMessage[] = [];
    let endedWith: string | undefined;
    opened.push(
      subscribe(
        // `ci is green` is refused BY DESIGN — no monitor asks the host about a
        // check run. The cast is what a subscriber asking for one would send.
        { address, subscriber: 't', purpose: { kind: 'until', finding: 'ci is green' as never, branch: '' } },
        (m) => seen.push(m),
        (reason) => { endedWith = reason; },
      ),
    );
    await until(() => endedWith !== undefined);

    expect(seen[0].type).toBe('refused');
    if (seen[0].type === 'refused') {
      expect(seen[0].asked).toBe('ci is green');
      expect(seen[0].measurable).toContain('owes a review');
    }
  });

  // AN ABSENT CHANNEL IS NOT AN ERROR TO THROW. The monitors are optional, and
  // an unhandled ECONNREFUSED would take down the agent that asked.
  it('reports a channel that is not there rather than throwing', async () => {
    let endedWith: string | undefined;
    opened.push(
      subscribe(
        { address: socketPath(), subscriber: 't', purpose: { kind: 'everything' } },
        () => undefined,
        (reason) => { endedWith = reason; },
      ),
    );
    await until(() => endedWith !== undefined);

    expect(endedWith).not.toBe('');
  });

  it('is served once and ended when its narrow purpose holds', async () => {
    const address = socketPath();
    channel = await startChannel({ address });

    const seen: ChannelMessage[] = [];
    let endedWith: string | undefined;
    opened.push(
      subscribe(
        { address, subscriber: 't', purpose: { kind: 'until', finding: 'owes a review', branch: 'feature/one' } },
        (m) => seen.push(m),
        (reason) => { endedWith = reason; },
      ),
    );
    await until(() => seen.length > 0);
    await publish(address, finding());
    await until(() => endedWith !== undefined);

    expect(seen.some((m) => m.type === 'served')).toBe(true);
    // SERVED IS A MESSAGE, NOT A CLOSE — a close is what a crash looks like too.
    expect(endedWith).toBe('');
  });
});

describe('what a message carries', () => {
  it('reads the findings out of every shape that holds one', () => {
    const f = finding();

    expect(findingsIn({ type: 'finding', finding: f })).toEqual([f]);
    expect(findingsIn({ type: 'served', finding: f })).toEqual([f]);
    expect(findingsIn({ type: 'welcome', current: [f], measurable: [] })).toEqual([f]);
    expect(findingsIn({ type: 'heartbeat', measuredAt: 'x', monitors: [] })).toEqual([]);
  });
});

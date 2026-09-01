import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startChannel, type RunningChannel } from '../src/adapters/channel/channel-socket.js';
import { decode, type ChannelMessage } from '../src/entities/channel-message.js';
import type { Finding } from '../src/entities/finding.js';

/**
 * The channel's TRANSPORT, which is all this file asserts.
 *
 * Every decision — which purposes may be served, who receives a finding, when a
 * subscription is over — is `rules/channel.ts`'s and is tested in
 * `channel.test.ts` without a socket. What can only be seen through a real
 * connection is here: that a line becomes a message, that two peers are told
 * apart by what they say first, that a purpose dies with its subscriber, and
 * that a socket left by a killed process does not stop the next one starting.
 *
 * REAL SOCKETS, NOT A MOCK. The adapter exists because a mock of it would
 * assert the mock; its whole job is the boundary, and the boundary is where the
 * bugs are — a half-line, a peer that disconnects mid-write, a stale file.
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

/**
 * One publish line, as a monitor writes it.
 *
 * NOT `encode`, and the difference is the protocol rather than a convenience.
 * `ChannelMessage` is what the channel SENDS; `publish` is what a monitor says
 * to it, parsed from raw JSON by `isPublish` and never modelled as a message.
 * Casting one to the other typechecks locally under vitest, which transpiles
 * without checking, and fails `tsc --noEmit` — measured 2026-09-01.
 */
const publishLine = (f: Finding): string =>
  `${JSON.stringify({ type: 'publish', finding: f })}\n`;

/** A client that collects whole messages, so a test never races a partial line. */
const peer = (address: string) => {
  const seen: ChannelMessage[] = [];
  const socket: Socket = connect(address);
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const at = buffer.indexOf('\n');
      if (at === -1) break;
      const message = decode(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (message) seen.push(message);
    }
  });
  return {
    socket,
    seen,
    ready: new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    }),
    say: (line: string) => socket.write(line),
    /** Waits for the nth message, rather than sleeping a guess. */
    nth: async (n: number): Promise<ChannelMessage> => {
      for (let tries = 0; tries < 200; tries += 1) {
        if (seen.length >= n) return seen[n - 1]!;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`only ${seen.length} message(s) arrived, wanted ${n}: ${JSON.stringify(seen)}`);
    },
  };
};

let channel: RunningChannel | undefined;
const addressIn = (): string => join(mkdtempSync(join(tmpdir(), 'plot-channel-')), 'sock');

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
});

describe('the channel socket — the boundary, not the protocol', () => {
  it('welcomes a subscriber with what it holds now and what it can measure', async () => {
    channel = await startChannel({ address: addressIn() });
    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');

    const welcome = await board.nth(1);
    expect(welcome.type).toBe('welcome');
    board.socket.end();
  });

  it('tells a publisher from a subscriber by what it says first', async () => {
    // ONE PATH, TWO PEERS. A monitor publishes and is never held as a listener:
    // holding one would send it its own findings.
    channel = await startChannel({ address: addressIn() });
    const monitor = peer(channel.address);
    await monitor.ready;
    monitor.say(publishLine(finding()));

    for (let tries = 0; tries < 200 && channel.findings().length === 0; tries += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(channel.findings()).toHaveLength(1);
    expect(channel.subscriberCount()).toBe(0);
    monitor.socket.end();
  });

  it('carries a published finding to a connected subscriber', async () => {
    channel = await startChannel({ address: addressIn() });
    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');
    await board.nth(1);

    const monitor = peer(channel.address);
    await monitor.ready;
    monitor.say(publishLine(finding()));

    const delivered = await board.nth(2);
    expect(delivered.type).toBe('finding');
    board.socket.end();
    monitor.socket.end();
  });

  it('refuses a purpose no monitor measures, naming it back', async () => {
    channel = await startChannel({ address: addressIn() });
    const asker = peer(channel.address);
    await asker.ready;
    asker.say(JSON.stringify({
      subscriber: 'agent',
      purpose: { kind: 'until', condition: 'CI-is-green' },
    }) + '\n');

    const answer = await asker.nth(1);
    expect(answer.type).toBe('refused');
    asker.socket.end();
  });

  it('forgets a subscriber that disconnects — a purpose dies with it', async () => {
    // A channel holding purposes for absent listeners accumulates state it can
    // never discharge, which is how a component that exists to notice things
    // stops noticing.
    channel = await startChannel({ address: addressIn() });
    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');
    await board.nth(1);
    expect(channel.subscriberCount()).toBe(1);

    board.socket.end();
    for (let tries = 0; tries < 200 && channel.subscriberCount() !== 0; tries += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(channel.subscriberCount()).toBe(0);
  });

  it('ignores a line that is not JSON rather than dying on it', async () => {
    // A peer writing rubbish must not take the channel down with it: every
    // other subscriber's purpose would die with it.
    channel = await startChannel({ address: addressIn() });
    const noisy = peer(channel.address);
    await noisy.ready;
    noisy.say('not json at all\n');

    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');
    expect((await board.nth(1)).type).toBe('welcome');
    noisy.socket.end();
    board.socket.end();
  });

  it('beats on its cadence, carrying when each monitor was last heard', async () => {
    // The heartbeat is what separates silence-because-healthy from
    // silence-because-gone, and the interval is injected so this is measured in
    // milliseconds rather than waited out.
    channel = await startChannel({ address: addressIn(), heartbeatMs: 20 });
    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');
    await board.nth(1);

    const beat = await board.nth(2);
    expect(beat.type).toBe('heartbeat');
    board.socket.end();
  });

  it('starts over a socket a killed process left behind', async () => {
    // A monitor killed with SIGKILL leaves the file; bind then fails
    // EADDRINUSE. The file is not a lock — its owner is gone — so refusing to
    // start would treat a leftover as an owner and need a human with `rm`.
    const address = addressIn();
    writeFileSync(address, '');
    expect(existsSync(address)).toBe(true);

    channel = await startChannel({ address });
    const board = peer(channel.address);
    await board.ready;
    board.say(JSON.stringify({ subscriber: 'board', purpose: { kind: 'everything' } }) + '\n');
    expect((await board.nth(1)).type).toBe('welcome');
    board.socket.end();
  });

  it('removes its socket when it stops, leaving nothing for the next start', async () => {
    const address = addressIn();
    channel = await startChannel({ address });
    expect(existsSync(address)).toBe(true);
    await channel.stop();
    channel = undefined;
    expect(existsSync(address)).toBe(false);
  });
});

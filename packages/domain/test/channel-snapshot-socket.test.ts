import { afterEach, describe, expect, it } from 'vitest';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startChannel, type RunningChannel } from '../src/adapters/channel/channel-socket.js';
import { subscribeSnapshot } from '../src/adapters/channel/channel-client.js';
import { decode, encode, type ChannelMessage } from '../src/entities/channel-message.js';
import { SNAPSHOT_PROTOCOL } from '../src/entities/subscription.js';
import { emptySnapshot, type ReadingKey, type RepoSnapshot } from '../src/entities/snapshot.js';
import type { Finding } from '../src/entities/finding.js';
import { recordReading } from '../src/rules/snapshot-record.js';
import type { SnapshotLink } from '../src/rules/snapshot-link.js';
import { admitBeforeSnapshot } from './fixtures/admit-before-snapshot.js';

/**
 * The snapshot purpose through a real socket: what fleetd serves, what an old
 * subscriber does not receive, and what a reader holds and reports.
 */

const dirs: string[] = [];
const addressIn = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-snapshot-channel-'));
  dirs.push(dir);
  return join(dir, 'sock');
};

/** A snapshot holder over the real record rule, as fleetd holds one. */
const holder = () => {
  let held: RepoSnapshot = emptySnapshot();
  return {
    current: () => held,
    set: (channel: RunningChannel, key: ReadingKey, value: string) => {
      const before = held;
      const recorded = recordReading(held, key, { state: 'read', readAt: 1, value: { k: value } } as never);
      held = recorded.snapshot;
      channel.snapshotChanged(before, held, recorded.changed);
    },
  };
};

const finding: Finding = {
  monitor: 'AgentMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'owes a review',
  since: '2026-08-31T10:00:00Z',
  evidence: 'e',
  measuredAt: '2026-08-31T10:00:00Z',
};

const peer = (address: string, purpose: unknown) => {
  const seen: ChannelMessage[] = [];
  const socket: Socket = connect(address);
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += String(chunk);
    for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
      const message = decode(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (message) seen.push(message);
    }
  });
  socket.on('connect', () => socket.write(`${JSON.stringify({ subscriber: 't', purpose })}\n`));
  socket.on('error', () => undefined);
  return { seen, socket };
};

const until = async (done: () => boolean, what: string): Promise<void> => {
  for (let tries = 0; tries < 300; tries += 1) {
    if (done()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

let channel: RunningChannel | undefined;
let server: Server | undefined;
const readers: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const reader of readers.splice(0)) reader.close();
  await channel?.stop();
  channel = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const read = (address: string) => {
  const states: SnapshotLink[] = [];
  const reader = subscribeSnapshot(address, (link) => states.push(link), { reconnectStartMs: 20, reconnectCapMs: 40 });
  readers.push(reader);
  return { reader, states };
};

describe('fleetd serves the snapshot purpose', () => {
  it('sends a late joiner one snapshot at the current generation, after three deltas', async () => {
    const snapshot = holder();
    channel = await startChannel({ address: addressIn(), snapshot: snapshot.current });
    snapshot.set(channel, 'config', 'a');
    snapshot.set(channel, 'config', 'b');
    snapshot.set(channel, 'config', 'c');
    const late = peer(channel.address, { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL });
    await until(() => late.seen.length >= 1, 'the snapshot');
    await new Promise((r) => setTimeout(r, 50));
    expect(late.seen).toHaveLength(1);
    expect(late.seen[0]).toMatchObject({ type: 'snapshot', protocol: SNAPSHOT_PROTOCOL, generation: 3, epoch: channel.epoch });
    late.socket.destroy();
  });

  it('sends a joined subscriber one delta per change, naming the readings that changed', async () => {
    const snapshot = holder();
    channel = await startChannel({ address: addressIn(), snapshot: snapshot.current });
    const joined = peer(channel.address, { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL });
    await until(() => joined.seen.length >= 1, 'the snapshot');
    snapshot.set(channel, 'config', 'a');
    snapshot.set(channel, 'config', 'a');
    await until(() => joined.seen.length >= 2, 'the delta');
    await new Promise((r) => setTimeout(r, 50));
    expect(joined.seen).toHaveLength(2);
    expect(joined.seen[1]).toMatchObject({ type: 'delta', base: 0, generation: 1, epoch: channel.epoch });
    expect(Object.keys((joined.seen[1] as { readings: object }).readings)).toEqual(['config']);
    joined.socket.destroy();
  });

  it('sends an everything subscriber welcome, findings and heartbeats and no snapshot or delta', async () => {
    const snapshot = holder();
    channel = await startChannel({ address: addressIn(), snapshot: snapshot.current, heartbeatMs: 20 });
    const old = peer(channel.address, { kind: 'everything' });
    await until(() => old.seen.length >= 1, 'the welcome');
    snapshot.set(channel, 'config', 'a');
    channel.publish(finding);
    await until(() => old.seen.some((m) => m.type === 'heartbeat') && old.seen.some((m) => m.type === 'finding'), 'finding and heartbeat');
    expect(old.seen[0]?.type).toBe('welcome');
    expect(old.seen.map((m) => m.type).filter((t) => t === 'snapshot' || t === 'delta')).toEqual([]);
    old.socket.destroy();
  });

  it('refuses the purpose by name where the process holds no snapshot', async () => {
    channel = await startChannel({ address: addressIn() });
    const reader = peer(channel.address, { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL });
    await until(() => reader.seen.length >= 1, 'the refusal');
    expect(reader.seen[0]).toMatchObject({ type: 'refused', reason: 'this channel holds no snapshot' });
  });

  it('refuses a protocol it does not speak, naming both versions', async () => {
    channel = await startChannel({ address: addressIn(), snapshot: () => emptySnapshot() });
    const reader = peer(channel.address, { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL + 1 });
    await until(() => reader.seen.length >= 1, 'the refusal');
    expect(reader.seen[0]).toMatchObject({ type: 'refused' });
    const reason = (reader.seen[0] as { reason: string }).reason;
    expect(reason).toContain(String(SNAPSHOT_PROTOCOL));
    expect(reason).toContain(String(SNAPSHOT_PROTOCOL + 1));
  });
});

describe('the snapshot reader', () => {
  it('holds the copy and follows deltas in order', async () => {
    const snapshot = holder();
    channel = await startChannel({ address: addressIn(), snapshot: snapshot.current });
    const { reader, states } = read(channel.address);
    await until(() => reader.link().state === 'current', 'current');
    snapshot.set(channel, 'config', 'a');
    snapshot.set(channel, 'config', 'b');
    await until(() => reader.held()?.snapshot.generation === 2, 'generation 2');
    expect(reader.held()?.epoch).toBe(channel.epoch);
    expect(reader.held()?.snapshot).toEqual(snapshot.current());
    expect(states[0]).toEqual({ state: 'absent' });
  });

  it('reports mismatch against an older fleetd that refuses the purpose, and the everything subscription still works', async () => {
    channel = await startChannel({ address: addressIn(), admit: admitBeforeSnapshot, snapshot: () => emptySnapshot() });
    const { reader } = read(channel.address);
    await until(() => reader.link().state === 'mismatch', 'mismatch');
    expect(reader.link()).toMatchObject({ state: 'mismatch', ours: SNAPSHOT_PROTOCOL, theirs: undefined });
    expect(reader.held()).toBeUndefined();
    const board = peer(channel.address, { kind: 'everything' });
    await until(() => board.seen.length >= 1, 'the welcome');
    expect(board.seen[0]?.type).toBe('welcome');
    board.socket.destroy();
  });

  it('reports mismatch against a fleetd that sends another protocol, naming both', async () => {
    const address = addressIn();
    server = createServer((socket) => {
      socket.on('data', () => {
        socket.write(encode({ type: 'snapshot', protocol: SNAPSHOT_PROTOCOL + 1, epoch: 'e', generation: 0, snapshot: emptySnapshot() }));
      });
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server!.listen(address, resolve));
    const { reader } = read(address);
    await until(() => reader.link().state === 'mismatch', 'mismatch');
    expect(reader.link()).toMatchObject({ ours: SNAPSHOT_PROTOCOL, theirs: SNAPSHOT_PROTOCOL + 1 });
  });

  it('resynchronises on a gap: resubscribes and holds the full snapshot again', async () => {
    const snapshot = holder();
    channel = await startChannel({ address: addressIn(), snapshot: snapshot.current });
    const { reader, states } = read(channel.address);
    await until(() => reader.link().state === 'current', 'current');
    // A delta whose base the reader does not hold: the sender moved without telling this connection.
    const skipped = recordReading(snapshot.current(), 'config', { state: 'read', readAt: 1, value: { k: 'a' } });
    channel.snapshotChanged({ ...snapshot.current(), generation: 1 }, { ...skipped.snapshot, generation: 2 }, ['config']);
    await until(() => states.some((s) => s.state === 'resyncing'), 'resyncing');
    await until(() => reader.link().state === 'current', 'current again');
    expect(reader.held()?.snapshot.generation).toBe(snapshot.current().generation);
  });

  it('resynchronises after fleetd stops and starts, and holds the new epoch', async () => {
    const address = addressIn();
    const first = holder();
    channel = await startChannel({ address, snapshot: first.current, epoch: 'epoch-one' });
    first.set(channel, 'config', 'a');
    const { reader, states } = read(address);
    await until(() => reader.held()?.epoch === 'epoch-one', 'epoch one');
    await channel.stop();
    await until(() => states.some((s) => s.state === 'resyncing'), 'resyncing');
    const second = holder();
    channel = await startChannel({ address, snapshot: second.current, epoch: 'epoch-two' });
    await until(() => reader.held()?.epoch === 'epoch-two', 'epoch two');
    expect(reader.link()).toMatchObject({ state: 'current', epoch: 'epoch-two' });
  });

  it('reads absent where no channel listens, and stops on close', async () => {
    const address = addressIn();
    const { reader, states } = read(address);
    await new Promise((r) => setTimeout(r, 80));
    expect(reader.link()).toEqual({ state: 'absent' });
    expect(states.every((s) => s.state === 'absent')).toBe(true);
    reader.close();
  });
});


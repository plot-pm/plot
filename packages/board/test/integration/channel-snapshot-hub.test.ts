import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startChannel, type RunningChannel } from '@plot-pm/domain/adapters';
import { SNAPSHOT_PROTOCOL } from '@plot-pm/domain/entities/subscription';
import { emptySnapshot } from '@plot-pm/domain/entities/snapshot';
import { startEventHub, type EventHub } from '../../src/server/channel-events.js';
import { admitBeforeSnapshot } from '../../../domain/test/fixtures/admit-before-snapshot.js';

/**
 * The hub's copy of fleetd's snapshot against a real channel socket: what it
 * reports for `/api/fleet`, and that the board keeps reading for itself when
 * the sender is an older fleetd.
 */

const until = async (holds: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

let channel: RunningChannel | undefined;
let hub: EventHub | undefined;
const dirs: string[] = [];
const socketPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-hub-'));
  dirs.push(dir);
  return join(dir, 'c.sock');
};

afterEach(async () => {
  hub?.close();
  hub = undefined;
  await channel?.stop();
  channel = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the hub holds fleetd snapshot', () => {
  it('reads absent before any channel exists', () => {
    hub = startEventHub({ address: socketPath(), reconnectStartMs: 20, reconnectCapMs: 40 });
    expect(hub.snapshotLink()).toEqual({ state: 'absent' });
    expect(hub.snapshot()).toBeUndefined();
  });

  it('reads current and holds the copy a fleetd serves', async () => {
    const address = socketPath();
    channel = await startChannel({ address, snapshot: () => ({ ...emptySnapshot(), generation: 3 }) });
    hub = startEventHub({ address, reconnectStartMs: 20, reconnectCapMs: 40 });
    await until(() => hub!.snapshotLink().state === 'current');
    expect(hub.snapshotLink()).toMatchObject({ state: 'current', epoch: channel.epoch, generation: 3 });
    expect(hub.snapshot()?.snapshot.generation).toBe(3);
  });

  it('reads mismatch against an older fleetd, logs one line naming the refusal, and keeps the event stream', async () => {
    const address = socketPath();
    const lines: string[] = [];
    channel = await startChannel({ address, admit: admitBeforeSnapshot, snapshot: () => emptySnapshot() });
    hub = startEventHub({ address, log: (line) => lines.push(line), reconnectStartMs: 10, reconnectCapMs: 20 });
    await until(() => hub!.snapshotLink().state === 'mismatch');
    expect(hub.snapshotLink()).toMatchObject({ state: 'mismatch', ours: SNAPSHOT_PROTOCOL, theirs: undefined });
    // The `everything` subscription is unaffected: it connected.
    await until(() => lines.includes('channel: connected'));
    // Several retries pass; the mismatch line is logged once.
    await new Promise((r) => setTimeout(r, 120));
    expect(lines.filter((l) => l.includes('snapshot protocol mismatch'))).toHaveLength(1);
    expect(lines.find((l) => l.includes('snapshot protocol mismatch'))).toContain(`this board speaks ${SNAPSHOT_PROTOCOL}`);
  });
});

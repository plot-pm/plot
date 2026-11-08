import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clockManual } from '@plot-pm/domain/adapters/clock/clock-system';
import { subscribeSnapshot } from '@plot-pm/domain/adapters/channel/channel-client';
import { connect } from 'node:net';
import { decode } from '@plot-pm/domain/entities/channel-message';
import { SNAPSHOT_PROTOCOL } from '@plot-pm/domain/entities/subscription';

import { CHANNEL_SOCKET, run, startFleetChannel } from '../../src/server/entry/registryd-main.js';
import { fleetDivisors } from '../../src/shared/fleet-clock.js';
import { createSnapshotHolder } from '../../src/shared/snapshot-fill.js';
import { buildSandbox, type Sandbox } from '../census/sandbox.js';

// The census fixture for GitHub (three desks, five open PRs) with fleetd's
// real channel: a snapshot subscriber follows the daemon through three passes.

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const beatsPerPass = fleetDivisors().reduce((acc, { everyNthBeat }) => (acc * everyNthBeat) / gcd(acc, everyNthBeat), 1);

describe('fleetd publishes its snapshot on the channel', () => {
  let box: Sandbox;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 3, openPrs: 5 });
    Object.assign(process.env, box.env);
  }, 120_000);

  afterAll(async () => {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await box.remove();
  }, 60_000);

  it('a subscriber holds the daemon snapshot through three passes, and a steady pass sends no delta', async () => {
    const snapshot = createSnapshotHolder();
    const clock = clockManual(Date.now());
    let stopped = false;
    let wake: (() => void) | null = null;
    let sleeps = 0;
    const sleep = (): Promise<void> =>
      new Promise<void>((resolve) => {
        sleeps += 1;
        wake = resolve;
      });
    const until = async (done: () => boolean, ms: number): Promise<void> => {
      const end = Date.now() + ms;
      while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    };
    // A raw peer, to count the bytes of every line the channel sends.
    const lines: Array<{ type: string; bytes: number; keys: string[]; at: number }> = [];
    let pass = 0;
    const daemon = run(
      ['--interval', '60'],
      join(box.scriptsDir, 'board'),
      () => undefined,
      sleep,
      Object.assign(() => stopped, { requested: new Promise<void>(() => undefined) }),
      () => undefined,
      box.repo,
      { snapshot, clock, probeAppKeys: () => undefined },
    );
    await until(() => sleeps >= 1, 60_000);
    const socket = connect(join(box.repo, CHANNEL_SOCKET));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ subscriber: 'measure', purpose: { kind: 'snapshot', protocol: SNAPSHOT_PROTOCOL } })}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        const message = decode(line);
        if (message?.type === 'snapshot' || message?.type === 'delta') {
          lines.push({
            type: message.type,
            bytes: Buffer.byteLength(line) + 1,
            keys: message.type === 'delta' ? Object.keys(message.readings) : [],
            at: pass,
          });
        }
      }
    });
    const reader = subscribeSnapshot(join(box.repo, CHANNEL_SOCKET), () => undefined, { reconnectStartMs: 50 });
    await until(() => reader.link().state === 'current', 10_000);
    for (pass = 1; pass <= 3; pass += 1) {
      const target = sleeps + 1;
      clock.advance(beatsPerPass);
      (wake as (() => void) | null)?.();
      await until(() => sleeps >= target, 120_000);
      await new Promise((r) => setTimeout(r, 300));
    }
    const held = reader.held();
    const daemonSnapshot = snapshot.current();
    reader.close();
    socket.destroy();
    stopped = true;
    (wake as (() => void) | null)?.();
    await daemon;
    expect(held?.snapshot.generation).toBe(daemonSnapshot.generation);
    expect(held?.snapshot).toEqual(daemonSnapshot);
    expect(lines[0]?.type).toBe('snapshot');
    const perPass = [1, 2, 3].map((n) => {
      const mine = lines.filter((l) => l.type === 'delta' && l.at === n);
      return { pass: n, deltas: mine.length, bytes: mine.reduce((sum, l) => sum + l.bytes, 0), keys: mine.map((l) => l.keys.join('+')) };
    });
    if (process.env['PLOT_DELTA_STATS']) writeFileSync(process.env['PLOT_DELTA_STATS'], JSON.stringify({ snapshotBytes: lines[0]?.bytes, perPass }, null, 2));
    expect(perPass[2]!.deltas).toBeLessThanOrEqual(perPass[0]!.deltas);
  }, 400_000);

  it('startFleetChannel passes the snapshot to the transport, and none where the caller holds none', async () => {
    const seen: Array<unknown> = [];
    const start = (async (options: { address: string; snapshot?: unknown }) => {
      seen.push(options.snapshot);
      throw new Error('stop');
    }) as unknown as Parameters<typeof startFleetChannel>[2];
    const holder = createSnapshotHolder();
    await startFleetChannel('/r', () => undefined, start, holder.current);
    await startFleetChannel('/r', () => undefined, start);
    expect(seen[0]).toBe(holder.current);
    expect(seen[1]).toBeUndefined();
  });
});

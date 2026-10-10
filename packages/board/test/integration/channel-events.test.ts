import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Finding } from '@plot-pm/domain';
import { startChannel, type RunningChannel } from '@plot-pm/domain/adapters';
import { startEventHub, type EventHub } from '../../src/server/channel-events.js';

/**
 * The SSE fan-out against a real channel socket and a real HTTP listener.
 * Waits are on messages and on `until`, never on a bare sleep.
 */

const finding = (n: number): Finding => ({
  monitor: 'AgentMonitor',
  branch: `feature/b${n}`,
  worktree: `/w/${n}`,
  finding: 'owes a review',
  since: '2026-10-10T10:00:00Z',
  evidence: 'ahead',
  measuredAt: '2026-10-10T10:00:00Z',
});

const until = async (holds: () => boolean, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

interface Client {
  events: string[];
  status: () => number | undefined;
  type: () => string | undefined;
  abort: () => void;
}

let channel: RunningChannel | undefined;
let hub: EventHub | undefined;
let server: http.Server | undefined;
const clients: Client[] = [];

const socketDirs: string[] = [];

const socketPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-ev-'));
  socketDirs.push(dir);
  return join(dir, 'c.sock');
};

const startHttp = async (): Promise<number> => {
  server = http.createServer((req, res) => {
    if (req.url === '/api/events') hub!.attach(req, res);
    else res.end('ok');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
};

const open = (port: number): Client => {
  const events: string[] = [];
  let status: number | undefined;
  let type: string | undefined;
  const req = http.get({ port, host: '127.0.0.1', path: '/api/events' }, (res) => {
    status = res.statusCode;
    type = res.headers['content-type'];
    res.setEncoding('utf8');
    let buffer = '';
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\n\n');
        if (block.startsWith('data: ')) events.push(block.slice(6));
      }
    });
    res.on('error', () => undefined);
  });
  req.on('error', () => undefined);
  const client = { events, status: () => status, type: () => type, abort: () => req.destroy() };
  clients.push(client);
  return client;
};

afterEach(async () => {
  for (const c of clients.splice(0)) c.abort();
  hub?.close();
  hub = undefined;
  await channel?.stop();
  channel = undefined;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server?.closeAllConnections();
  server = undefined;
  for (const dir of socketDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const hubOn = (address: string, extra: Partial<Parameters<typeof startEventHub>[0]> = {}) => {
  hub = startEventHub({ address, reconnectStartMs: 20, reconnectCapMs: 40, ...extra });
};

describe('GET /api/events', () => {
  it('sends one event per finding when findings are spaced beyond the window', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    let clock = 0;
    hubOn(address, { now: () => clock });
    const port = await startHttp();
    const client = open(port);
    await until(() => client.events.length === 1); // welcome
    for (let n = 1; n <= 3; n += 1) {
      clock += 1_500;
      channel.publish(finding(n));
      await until(() => client.events.length === 1 + n);
    }
    expect(client.events.map((e) => JSON.parse(e).type)).toEqual(['welcome', 'finding', 'finding', 'finding']);
  });

  it('sends one event for a burst and another once the window passes', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    let clock = 0;
    hubOn(address, { now: () => clock });
    const port = await startHttp();
    const client = open(port);
    await until(() => client.events.length === 1);
    clock = 10_000;
    for (let n = 1; n <= 10; n += 1) channel.publish(finding(n));
    await until(() => client.events.length === 2);
    // Let the rest of the burst arrive, then check none became an event.
    channel.publish(finding(11));
    await until(() => channel!.findings().length === 11);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.events).toHaveLength(2);
    clock = 12_000;
    channel.publish(finding(12));
    await until(() => client.events.length === 3);
  });

  it('sends the welcome as one event when the channel holds many findings', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    for (let n = 1; n <= 30; n += 1) channel.publish(finding(n));
    hubOn(address);
    const port = await startHttp();
    const client = open(port);
    await until(() => client.events.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.events).toHaveLength(1);
    expect(JSON.parse(client.events[0]!).type).toBe('welcome');
  });

  it('sends nothing for a heartbeat', async () => {
    const address = socketPath();
    let beats = 0;
    channel = await startChannel({ address, heartbeatMs: 10 });
    hubOn(address);
    const port = await startHttp();
    const client = open(port);
    await until(() => client.events.length === 1);
    const before = Date.now();
    await until(() => Date.now() - before > 120);
    beats = client.events.length;
    expect(beats).toBe(1);
  });

  it('answers 200 text/event-stream with no event when there is no channel', async () => {
    hubOn(socketPath());
    const port = await startHttp();
    const client = open(port);
    await until(() => client.status() !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.status()).toBe(200);
    expect(client.type()).toContain('text/event-stream');
    expect(client.events).toEqual([]);
  });

  it('hears a channel that starts after the board', async () => {
    const address = socketPath();
    hubOn(address);
    const port = await startHttp();
    const client = open(port);
    await until(() => client.status() === 200);
    channel = await startChannel({ address });
    await until(() => client.events.length === 1);
    expect(JSON.parse(client.events[0]!).type).toBe('welcome');
  });

  it('reaches the same client after the channel restarts', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    let clock = 0;
    hubOn(address, { now: () => clock });
    const port = await startHttp();
    const client = open(port);
    await until(() => client.events.length === 1);
    await channel.stop();
    channel = await startChannel({ address });
    await until(() => client.events.length === 2); // welcome from the new channel
    clock = 10_000;
    channel.publish(finding(1));
    await until(() => client.events.length === 3);
    expect(JSON.parse(client.events[2]!).type).toBe('finding');
  });

  it('holds one channel connection for two clients', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    hubOn(address);
    const port = await startHttp();
    const a = open(port);
    const b = open(port);
    await until(() => hub!.clients() === 2);
    await until(() => a.events.length >= 1 && b.events.length >= 1);
    expect(channel.subscriberCount()).toBe(1);
  });

  it('releases a client that goes away and keeps serving the rest', async () => {
    const address = socketPath();
    channel = await startChannel({ address });
    let clock = 0;
    hubOn(address, { now: () => clock });
    const port = await startHttp();
    const gone = open(port);
    const stays = open(port);
    await until(() => hub!.clients() === 2);
    gone.abort();
    await until(() => hub!.clients() === 1);
    clock = 10_000;
    channel.publish(finding(1));
    await until(() => stays.events.some((e) => JSON.parse(e).type === 'finding'));
  });

  it('does not keep the server from closing once streams are ended', async () => {
    const address = socketPath();
    hubOn(address);
    const port = await startHttp();
    const client = open(port);
    await until(() => client.status() === 200);
    hub!.close();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  });
});

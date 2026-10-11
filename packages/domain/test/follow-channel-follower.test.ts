import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startChannel, type RunningChannel } from '../src/adapters/channel/channel-socket.js';
import type { Finding } from '../src/entities/finding.js';

/**
 * The mod's follower against a real channel socket. `follow.mjs` is a declared
 * duplicate of `channel-client.ts`, and this is the test that holds the pair.
 */

const FOLLOWER = resolve(__dirname, '../../../mods/plot-follow/bin/follow.mjs');

const finding: Finding = {
  monitor: 'IndexMonitor',
  branch: 'feature/one',
  worktree: '/w/one',
  finding: 'checks failing',
  since: '2026-10-10T09:00:00Z',
  evidence: 'pull request #1',
  measuredAt: '2026-10-10T09:00:00Z',
};

let channel: RunningChannel | undefined;
const children: ChildProcess[] = [];
const roots: string[] = [];

/** Resolves once `proc` has exited, killing it first when it still runs. */
const exited = (proc: ChildProcess): Promise<void> =>
  new Promise((done) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return done();
    proc.once('exit', () => done());
    proc.kill();
  });

afterEach(async () => {
  for (const proc of children.splice(0)) await exited(proc);
  await channel?.stop();
  channel = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A repository root with the `.plot` directory the socket lives in. */
const repoRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'plot-follow-'));
  roots.push(root);
  mkdirSync(join(root, '.plot'));
  return root;
};

/** Publishes one finding on the channel at `address`. */
const publish = async (address: string, published: Finding): Promise<void> => {
  const publisher = connect(address);
  await new Promise<void>((r) => publisher.once('connect', () => r()));
  publisher.write(`${JSON.stringify({ type: 'publish', finding: published })}\n`);
  return new Promise((r) => publisher.end(() => r()));
};

const until = async (holds: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const run = (root: string) => {
  const out = { lines: [] as string[], stderr: '', code: undefined as number | null | undefined };
  let buffer = '';
  const proc = spawn('node', [FOLLOWER, root]);
  children.push(proc);
  proc.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    out.lines.push(...parts);
  });
  proc.stderr.setEncoding('utf8').on('data', (chunk: string) => (out.stderr += chunk));
  proc.on('close', (code) => (out.code = code));
  return out;
};

describe('the follower', () => {
  it('prints a welcome and a published finding as two JSON lines, and exits 0 when the channel closes', async () => {
    const root = repoRoot();
    const address = join(root, '.plot', 'fleet.sock');
    channel = await startChannel({ address });
    const out = run(root);

    await until(() => out.lines.length >= 1);
    const publisher = connect(address);
    await new Promise<void>((r) => publisher.once('connect', () => r()));
    publisher.write(`${JSON.stringify({ type: 'publish', finding })}\n`);
    await until(() => out.lines.length >= 2);
    publisher.destroy();

    expect(out.lines.map((l) => JSON.parse(l).type)).toEqual(['welcome', 'finding']);
    expect(JSON.parse(out.lines[1]).finding.branch).toBe('feature/one');

    await channel.stop();
    channel = undefined;
    await until(() => out.code !== undefined);
    expect(out.code).toBe(0);
  });

  it('lets exactly one of two followers in one repository claim a reading, and a later welcome claims nothing', async () => {
    const root = repoRoot();
    const address = join(root, '.plot', 'fleet.sock');
    channel = await startChannel({ address });
    const first = run(root);
    const second = run(root);
    await until(() => first.lines.length >= 1 && second.lines.length >= 1);

    await publish(address, finding);
    await until(() => first.lines.length >= 2 && second.lines.length >= 2);

    const claims = [first, second].map((out) => JSON.parse(out.lines[1]).claimed);
    expect(claims.sort()).toEqual([false, true]);

    // A third session connects later: the reading is already claimed.
    const third = run(root);
    await until(() => third.lines.length >= 1);
    const welcome = JSON.parse(third.lines[0]);
    expect(welcome.current).toHaveLength(1);
    expect(welcome.claimed).toEqual([false]);

    // A changed reading of the same slot is a new claim, which one of the three wins.
    await publish(address, { ...finding, evidence: 'pull request #2' });
    await until(() => [first, second, third].every((out) => out.lines.some((l) => l.includes('pull request #2'))));
    const changed = [first, second, third].map((out) => JSON.parse(out.lines.at(-1) ?? '{}').claimed);
    expect(changed.filter(Boolean)).toHaveLength(1);
  });

  it('removes a lease older than a day when it starts, so a crashed claimer blocks nothing for long', async () => {
    const root = repoRoot();
    const address = join(root, '.plot', 'fleet.sock');
    const leases = join(root, '.plot', 'state', 'follow-leases');
    channel = await startChannel({ address });
    const out = run(root);
    await until(() => out.lines.length >= 1);
    await publish(address, finding);
    await until(() => out.lines.length >= 2);
    expect(JSON.parse(out.lines[1]).claimed).toBe(true);

    const [lease] = readdirSync(leases);
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    utimesSync(join(leases, lease), old, old);
    writeFileSync(join(leases, 'fresh'), '');

    const later = run(root);
    await until(() => later.lines.length >= 1);
    expect(JSON.parse(later.lines[0]).claimed).toEqual([true]);
    expect(readdirSync(leases)).toContain('fresh');
  });

  it('exits 2 with a reason on stderr when no channel is listening', async () => {
    const out = run(repoRoot());

    await until(() => out.code !== undefined);
    expect(out.code).toBe(2);
    expect(out.stderr).not.toBe('');
    expect(out.lines).toEqual([]);
  });
});

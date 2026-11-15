import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bindableChannelAddress, channelAddressFor } from '../src/adapters/channel/channel-address.js';
import { startChannel, type RunningChannel } from '../src/adapters/channel/channel-socket.js';
import { subscribe } from '../src/adapters/channel/channel-client.js';
import type { ChannelMessage } from '../src/entities/channel-message.js';

/**
 * The address adapter against a real filesystem: the realpath key, the
 * per-user directory it makes, and the directories it refuses.
 *
 * Every test makes its own base under `/tmp` and removes that base by the name
 * `mkdtempSync` returned.
 */

const made: string[] = [];
let channel: RunningChannel | undefined;

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fresh = (parent: string, prefix: string): string => {
  const dir = mkdtempSync(join(parent, prefix));
  made.push(dir);
  return dir;
};

/** A checkout root whose in-checkout socket path passes the limit. */
const longRoot = (): string => {
  const root = join(fresh(tmpdir(), 'plot-addr-root-'), 'a'.repeat(60), 'b'.repeat(40));
  mkdirSync(join(root, '.plot'), { recursive: true });
  return root;
};

const uid = process.getuid?.() ?? 0;
const keyOf = (root: string): string => createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 16);

describe('the channel address on disk', () => {
  it('keeps a short checkout at its own .plot/fleet.sock, through its realpath', () => {
    const base = fresh('/tmp', 'plot-addr-');
    const root = fresh('/tmp', 'r-');
    const real = realpathSync(root);
    expect(channelAddressFor(root, { base })).toBe(join(real, '.plot', 'fleet.sock'));
    expect(bindableChannelAddress(root, { base })).toBe(join(real, '.plot', 'fleet.sock'));
    expect(existsSync(join(base, `plot-${uid}`))).toBe(false);
  });

  it('keys a root that does not exist by its resolved path', () => {
    expect(channelAddressFor('/no-such-plot-root/x/..')).toBe('/no-such-plot-root/.plot/fleet.sock');
  });

  it('makes the per-user directory 0700 for a long checkout and names the socket by the realpath hash', () => {
    const base = fresh('/tmp', 'plot-addr-');
    const root = longRoot();
    const address = bindableChannelAddress(root, { base });
    const dir = join(base, `plot-${uid}`);
    expect(address).toBe(join(dir, `${keyOf(root)}.sock`));
    const stat = lstatSync(dir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
    expect(channelAddressFor(root, { base })).toBe(address);
  });

  it('gives a client the address before any daemon made the directory', () => {
    const base = fresh('/tmp', 'plot-addr-');
    const root = longRoot();
    expect(channelAddressFor(root, { base })).toBe(join(base, `plot-${uid}`, `${keyOf(root)}.sock`));
    expect(existsSync(join(base, `plot-${uid}`))).toBe(false);
  });

  it('gives two checkouts two sockets', () => {
    const base = fresh('/tmp', 'plot-addr-');
    expect(bindableChannelAddress(longRoot(), { base })).not.toBe(bindableChannelAddress(longRoot(), { base }));
  });

  it('refuses a directory that is a symbolic link, for the daemon and the client alike', () => {
    const base = fresh('/tmp', 'plot-addr-');
    const target = fresh('/tmp', 'plot-addr-target-');
    symlinkSync(target, join(base, `plot-${uid}`));
    const root = longRoot();
    expect(() => bindableChannelAddress(root, { base })).toThrow(/is a symbolic link/);
    expect(() => channelAddressFor(root, { base })).toThrow(/is a symbolic link/);
  });

  it('refuses a directory another uid owns', () => {
    const base = fresh('/tmp', 'plot-addr-');
    mkdirSync(join(base, `plot-${uid + 1}`), { mode: 0o700 });
    expect(() => bindableChannelAddress(longRoot(), { base, uid: uid + 1 })).toThrow(
      new RegExp(`uid ${uid} owns it, not uid ${uid + 1}`),
    );
  });

  it('refuses a directory others can enter, and leaves its mode alone', () => {
    const base = fresh('/tmp', 'plot-addr-');
    const dir = join(base, `plot-${uid}`);
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    expect(() => bindableChannelAddress(longRoot(), { base })).toThrow(/its mode is 0755, not 0700/);
    expect(lstatSync(dir).mode & 0o777).toBe(0o755);
  });

  it('reports a base it cannot make the directory in', () => {
    const base = join(fresh('/tmp', 'plot-addr-'), 'missing');
    expect(() => bindableChannelAddress(longRoot(), { base })).toThrow(/ENOENT/);
  });

  it('binds a channel for a long checkout that a client reaches by the root alone', async () => {
    const base = fresh('/tmp', 'plot-addr-');
    const root = longRoot();
    expect(Buffer.byteLength(join(root, '.plot', 'fleet.sock'))).toBeGreaterThan(104);
    channel = await startChannel({ address: bindableChannelAddress(root, { base }) });
    const first = await new Promise<ChannelMessage>((resolve, reject) => {
      const handle = subscribe(
        { address: channelAddressFor(root, { base }), subscriber: 'test', purpose: { kind: 'everything' } },
        (message) => {
          handle.close();
          resolve(message);
        },
        (reason) => reject(new Error(reason)),
      );
    });
    expect(first.type).toBe('welcome');
  });
});

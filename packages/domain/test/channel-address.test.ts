import { describe, expect, it } from 'vitest';

import {
  CHANNEL_SOCKET,
  SHORT_SOCKET_BASE,
  SOCKET_PATH_MAX,
  channelAddress,
  channelDirFault,
} from '../src/rules/channel-address.js';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** A root whose `<root>/.plot/fleet.sock` is exactly `bytes` long. */
const rootOf = (bytes: number): string => `/${'r'.repeat(bytes - 1 - CHANNEL_SOCKET.length - 1)}`;

describe('channelAddress', () => {
  it('keeps the socket under the checkout while that path fits', () => {
    expect(channelAddress('/repo', KEY, 501)).toEqual({ address: '/repo/.plot/fleet.sock', dir: null });
  });

  it('keeps the checkout path at exactly the limit', () => {
    const root = rootOf(SOCKET_PATH_MAX);
    expect(channelAddress(root, KEY, 501)).toEqual({ address: `${root}/.plot/fleet.sock`, dir: null });
  });

  it('moves a path one byte past the limit to the per-user directory, keyed by the first 16 characters', () => {
    const root = rootOf(SOCKET_PATH_MAX + 1);
    expect(channelAddress(root, KEY, 501)).toEqual({
      address: `${SHORT_SOCKET_BASE}/plot-501/0123456789abcdef.sock`,
      dir: `${SHORT_SOCKET_BASE}/plot-501`,
    });
  });

  it('counts bytes, not characters', () => {
    // 'ü' is two bytes in UTF-8, so half as many characters reach the limit.
    const root = `/${'ü'.repeat(Math.ceil((SOCKET_PATH_MAX - CHANNEL_SOCKET.length - 1) / 2))}`;
    expect(root.length + CHANNEL_SOCKET.length + 1).toBeLessThanOrEqual(SOCKET_PATH_MAX);
    expect(channelAddress(root, KEY, 501).dir).toBe(`${SHORT_SOCKET_BASE}/plot-501`);
  });

  it('takes another base directory', () => {
    expect(channelAddress(rootOf(200), KEY, 7, '/run/x').address).toBe('/run/x/plot-7/0123456789abcdef.sock');
  });

  it('joins the filesystem root without a doubled slash', () => {
    expect(channelAddress('/', KEY, 501).address).toBe('/.plot/fleet.sock');
  });
});

describe('channelDirFault', () => {
  const owned = { directory: true, symlink: false, uid: 501, mode: 0o40700 };

  it('accepts a directory the uid owns with mode 0700', () => {
    expect(channelDirFault('/tmp/plot-501', owned, 501)).toBeNull();
  });

  it('refuses a symbolic link', () => {
    expect(channelDirFault('/tmp/plot-501', { ...owned, directory: false, symlink: true }, 501)).toBe(
      'refusing the channel directory /tmp/plot-501: it is a symbolic link',
    );
  });

  it('refuses a path that is not a directory', () => {
    expect(channelDirFault('/tmp/plot-501', { ...owned, directory: false }, 501)).toBe(
      'refusing the channel directory /tmp/plot-501: it is not a directory',
    );
  });

  it('refuses a directory another uid owns', () => {
    expect(channelDirFault('/tmp/plot-501', { ...owned, uid: 502 }, 501)).toBe(
      'refusing the channel directory /tmp/plot-501: uid 502 owns it, not uid 501',
    );
  });

  it('refuses a directory that others can enter', () => {
    expect(channelDirFault('/tmp/plot-501', { ...owned, mode: 0o40755 }, 501)).toBe(
      'refusing the channel directory /tmp/plot-501: its mode is 0755, not 0700',
    );
  });
});

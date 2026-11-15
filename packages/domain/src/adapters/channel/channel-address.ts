import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { channelAddress, channelDirFault, type ChannelAddress } from '../../rules/channel-address.js';

/**
 * The channel's socket path for a checkout, read from the filesystem.
 *
 * Every process that binds or connects to the channel asks here, so the daemon
 * and its clients name one path for one checkout. `rules/channel-address.ts`
 * decides the path; this file reads the realpath, hashes it, and makes or
 * checks the per-user directory.
 */

export interface ChannelAddressOptions {
  /** The directory that holds the per-user directory; `/tmp` by default. */
  base?: string;
  /** The user the directory must belong to; this process's uid by default. */
  uid?: number;
}

const realRoot = (root: string): string => {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
};

const locate = (root: string, options: ChannelAddressOptions): ChannelAddress & { uid: number } => {
  const real = realRoot(root);
  const uid = options.uid ?? process.getuid?.() ?? 0;
  const key = createHash('sha256').update(real).digest('hex');
  return { ...channelAddress(real, key, uid, options.base), uid };
};

const check = (dir: string, uid: number): void => {
  const stat = lstatSync(dir);
  const fault = channelDirFault(
    dir,
    { directory: stat.isDirectory(), symlink: stat.isSymbolicLink(), uid: stat.uid, mode: stat.mode },
    uid,
  );
  if (fault !== null) throw new Error(fault);
};

/**
 * The socket path a client connects to for a checkout.
 *
 * @param root - the checkout's root; its realpath keys the path.
 * @param options - the base directory and uid; tests name them.
 * @returns the socket path. A per-user directory that does not exist yet is
 *   not an error: the connect then finds nobody listening.
 * @throws an error naming the fault when the per-user directory exists and is
 *   a symbolic link, not a directory, owned by another uid, or open to others.
 */
export const channelAddressFor = (root: string, options: ChannelAddressOptions = {}): string => {
  const { address, dir, uid } = locate(root, options);
  if (dir === null) return address;
  try {
    check(dir, uid);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return address;
};

/**
 * The socket path the daemon binds for a checkout, with its directory made.
 *
 * @param root - the checkout's root; its realpath keys the path.
 * @param options - the base directory and uid; tests name them.
 * @returns the socket path, after making the per-user directory with mode 0700
 *   where it is missing.
 * @throws the `mkdir` error, or an error naming the fault when the directory is
 *   a symbolic link, not a directory, owned by another uid, or open to others.
 */
export const bindableChannelAddress = (root: string, options: ChannelAddressOptions = {}): string => {
  const { address, dir, uid } = locate(root, options);
  if (dir === null) return address;
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  check(dir, uid);
  return address;
};

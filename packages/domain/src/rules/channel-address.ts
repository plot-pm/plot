/**
 * Where the fleet channel's unix socket lives for one checkout.
 *
 * The socket stays at `<root>/.plot/fleet.sock` while that path fits a unix
 * socket path. A longer root gets `<base>/plot-<uid>/<key>.sock`, where `key`
 * is the first 16 hex characters of a hash of the root's realpath.
 */

/** The channel's socket under a checkout, relative to its root. */
export const CHANNEL_SOCKET = '.plot/fleet.sock';

/** The longest unix socket path in bytes: macOS's 104-byte `sun_path` less its terminating NUL. */
export const SOCKET_PATH_MAX = 103;

/** The directory that holds the per-user socket directories. */
export const SHORT_SOCKET_BASE = '/tmp';

/** Hex characters of the root's hash that name a socket in the per-user directory. */
const KEY_LENGTH = 16;

/** A socket path, and the per-user directory it needs, or `null` for a path under the checkout. */
export interface ChannelAddress {
  readonly address: string;
  readonly dir: string | null;
}

/** What `lstat` says about the per-user directory. */
export interface ChannelDirReading {
  readonly directory: boolean;
  readonly symlink: boolean;
  readonly uid: number;
  readonly mode: number;
}

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Chooses the channel's socket path for a checkout.
 *
 * @param root - the checkout's realpath.
 * @param key - a hex hash of `root`; its first 16 characters name the short socket.
 * @param uid - the user the per-user directory belongs to.
 * @param base - the directory that holds the per-user directory; {@link SHORT_SOCKET_BASE} by default.
 * @returns `<root>/.plot/fleet.sock` with `dir: null` where it is at most
 *   {@link SOCKET_PATH_MAX} bytes, else `<base>/plot-<uid>/<key>.sock` with that directory.
 */
export const channelAddress = (
  root: string,
  key: string,
  uid: number,
  base: string = SHORT_SOCKET_BASE,
): ChannelAddress => {
  const inCheckout = `${root.replace(/\/+$/, '')}/${CHANNEL_SOCKET}`;
  if (byteLength(inCheckout) <= SOCKET_PATH_MAX) return { address: inCheckout, dir: null };
  const dir = `${base}/plot-${uid}`;
  return { address: `${dir}/${key.slice(0, KEY_LENGTH)}.sock`, dir };
};

/**
 * Says why the per-user directory cannot hold the channel's socket.
 *
 * @param dir - the directory's path, for the message.
 * @param reading - what `lstat` read for it.
 * @param uid - the user it must belong to.
 * @returns `null` for a real directory that `uid` owns and no other user can
 *   enter, else a message naming the first fault: a symbolic link, not a
 *   directory, another owner, or group or other permission bits.
 */
export const channelDirFault = (dir: string, reading: ChannelDirReading, uid: number): string | null => {
  const refuse = (why: string): string => `refusing the channel directory ${dir}: ${why}`;
  if (reading.symlink) return refuse('it is a symbolic link');
  if (!reading.directory) return refuse('it is not a directory');
  if (reading.uid !== uid) return refuse(`uid ${reading.uid} owns it, not uid ${uid}`);
  const mode = reading.mode & 0o777;
  if ((mode & 0o077) !== 0) return refuse(`its mode is 0${mode.toString(8)}, not 0700`);
  return null;
};

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';

import { linuxFilesystemName, mountTypeOf } from '../../rules/desk-root.js';

/** The path itself where it exists, else its nearest existing parent, resolved. */
const nearestExisting = (path: string): string => {
  let dir = path;
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
};

/**
 * Reads the filesystem type of the mount that holds a path, or its nearest
 * existing parent: the `statfs` magic number on Linux, the `mount` line on
 * macOS. Starts one `mount` process on macOS and none on Linux.
 *
 * @param path - an absolute path; it need not exist.
 * @param platform - the operating system; `process.platform` by default.
 * @returns the type name, or `null` where it cannot be read or the platform is another.
 */
export const filesystemTypeOf = (path: string, platform: NodeJS.Platform = process.platform): string | null => {
  const at = nearestExisting(path);
  try {
    if (platform === 'linux') return linuxFilesystemName(statfsSync(at).type);
    if (platform === 'darwin') return mountTypeOf(execFileSync('mount', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), at);
  } catch {
    return null;
  }
  return null;
};

import { statSync, watch, type FSWatcher } from 'node:fs';

import type { Watch, WatchHandle } from '../../ports/watch.js';

/**
 * `Watch` over `fs.watch`, on directories only.
 *
 * After a `rename` event it arms the directory again only when the path no
 * longer names the directory it armed (another device and inode, or no entry),
 * so a directory replaced by rename keeps delivering. A rename of an entry
 * inside the directory keeps the open watcher: a close and re-open restarts
 * the platform watch, and changes in that gap are not delivered. Arming and
 * re-arming never throw: a failure sets `degraded` on the handle and ends
 * delivery.
 */
export const watchFs = (): Watch => ({
  arm: (dir, options, listener) => {
    let watcher: FSWatcher | undefined;
    let closed = false;
    let degraded = false;
    let armedAs: string | undefined;

    const identity = (): string | undefined => {
      try {
        const stats = statSync(dir);
        return `${stats.dev}:${stats.ino}`;
      } catch {
        return undefined;
      }
    };

    const open = (): void => {
      try {
        armedAs = identity();
        watcher = watch(dir, { recursive: options.recursive }, (eventType, filename) => {
          if (closed) return;
          const kind = eventType === 'rename' ? 'rename' : 'change';
          if (kind === 'rename' && identity() !== armedAs) {
            watcher?.close();
            open();
          }
          listener({ dir, name: filename ? String(filename) : '', kind });
        });
        watcher.on('error', () => {
          degraded = true;
          watcher?.close();
        });
      } catch {
        degraded = true;
        watcher = undefined;
      }
    };
    open();

    const handle: WatchHandle = {
      get degraded() {
        return degraded;
      },
      close: () => {
        closed = true;
        watcher?.close();
      },
    };
    return handle;
  },
});

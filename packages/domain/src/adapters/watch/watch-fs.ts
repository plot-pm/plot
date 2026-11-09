import { watch, type FSWatcher } from 'node:fs';

import type { Watch, WatchHandle } from '../../ports/watch.js';

/**
 * `Watch` over `fs.watch`, on directories only.
 *
 * After a `rename` event it closes the watcher and arms the directory again, so
 * a directory replaced by rename keeps delivering. Arming and re-arming never
 * throw: a failure sets `degraded` on the handle and ends delivery.
 */
export const watchFs = (): Watch => ({
  arm: (dir, options, listener) => {
    let watcher: FSWatcher | undefined;
    let closed = false;
    let degraded = false;

    const open = (): void => {
      try {
        watcher = watch(dir, { recursive: options.recursive }, (eventType, filename) => {
          if (closed) return;
          const kind = eventType === 'rename' ? 'rename' : 'change';
          if (kind === 'rename') {
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

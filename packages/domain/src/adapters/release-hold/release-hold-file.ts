import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeReleaseHold, encodeReleaseHold, type ReleaseHoldRecord } from '../../entities/release-hold.js';
import type { StateHome } from '../../entities/state-home.js';
import type { ReleaseHoldStore } from '../../ports/release-hold.js';

/** Where the record lives under a state home. */
export const releaseHoldPath = (home: StateHome): string => join(home, '.plot', 'state', 'release-hold.json');

/**
 * Keeps the release hold record in `.plot/state/release-hold.json`.
 *
 * @param home - the state home the file lives under.
 * @returns a `ReleaseHoldStore` over that one file.
 */
export const releaseHoldFile = (home: StateHome): ReleaseHoldStore => releaseHoldAt(releaseHoldPath(home));

/**
 * Keeps one release hold record in the file at `path`, read and written whole.
 *
 * @param path - the record's file.
 * @returns a `ReleaseHoldStore` over that one file.
 */
export const releaseHoldAt = (path: string): ReleaseHoldStore => ({
  read: async (): Promise<PortResult<ReleaseHoldRecord | null>> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return answered(null);
      return failed<ReleaseHoldRecord | null>();
    }
    return answered(decodeReleaseHold(text));
  },

  write: async (record: ReleaseHoldRecord): Promise<PortResult<void>> => {
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodeReleaseHold(record), { encoding: 'utf8' });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  },
});

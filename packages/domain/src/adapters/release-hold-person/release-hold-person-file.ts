import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeReleaseHoldPerson,
  encodeReleaseHoldPerson,
  type ReleaseHoldPersonRecord,
} from '../../entities/release-hold-person.js';
import type { StateHome } from '../../entities/state-home.js';
import type { ReleaseHoldPersonStore } from '../../ports/release-hold-person.js';

/** Where the record lives under a state home. */
export const releaseHoldPersonPath = (home: StateHome): string =>
  join(home, '.plot', 'state', 'release-hold-person.json');

/**
 * Keeps the person hold record in `.plot/state/release-hold-person.json`.
 *
 * @param home - the state home the file lives under.
 * @returns a `ReleaseHoldPersonStore` over that one file.
 */
export const releaseHoldPersonFile = (home: StateHome): ReleaseHoldPersonStore =>
  releaseHoldPersonAt(releaseHoldPersonPath(home));

/**
 * Keeps one person hold record in the file at `path`, read and written whole.
 *
 * @param path - the record's file.
 * @returns a `ReleaseHoldPersonStore` over that one file.
 */
export const releaseHoldPersonAt = (path: string): ReleaseHoldPersonStore => ({
  read: async (): Promise<PortResult<ReleaseHoldPersonRecord | null>> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return answered(null);
      return failed<ReleaseHoldPersonRecord | null>();
    }
    return answered(decodeReleaseHoldPerson(text));
  },

  write: async (record: ReleaseHoldPersonRecord): Promise<PortResult<void>> => {
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodeReleaseHoldPerson(record), { encoding: 'utf8' });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  },
});

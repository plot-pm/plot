import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeReleaseFinishRecord,
  encodeReleaseFinishRecord,
  validVersion,
  type ReleaseFinishRecord,
} from '../../entities/release-finish-record.js';
import type { StateHome } from '../../entities/state-home.js';
import type { ReleaseFinishRecordStore } from '../../ports/release-finish-record.js';

/**
 * Where the finish record of one version lives under a state home.
 *
 * @param home - the state home.
 * @param version - the tag spelling `vN.N.N`; the caller checks it with {@link validVersion}.
 * @returns `.plot/state/release-finish/<version>.json` under `home`.
 */
export const releaseFinishRecordPath = (home: StateHome, version: string): string =>
  join(home, '.plot', 'state', 'release-finish', `${version}.json`);

/**
 * Keeps release finish records in `.plot/state/release-finish/<version>.json`.
 *
 * A version that {@link validVersion} refuses has no file: it reads as no
 * record and refuses a write. A file whose `version` is not the one asked
 * reads as no record.
 *
 * @param home - the state home the files live under.
 * @returns a `ReleaseFinishRecordStore` over those files.
 */
export const releaseFinishRecordFile = (home: StateHome): ReleaseFinishRecordStore => ({
  read: async (version: string): Promise<PortResult<ReleaseFinishRecord | null>> => {
    if (!validVersion(version)) return answered<ReleaseFinishRecord | null>(null);
    let text: string;
    try {
      text = await readFile(releaseFinishRecordPath(home, version), 'utf8');
    } catch (error) {
      // No file is no record, which is an answer; any other error is a failure.
      if ((error as { code?: string }).code === 'ENOENT') return answered<ReleaseFinishRecord | null>(null);
      return failed<ReleaseFinishRecord | null>();
    }
    const record = decodeReleaseFinishRecord(text);
    return answered(record !== null && record.version === version ? record : null);
  },

  write: async (record: ReleaseFinishRecord): Promise<PortResult<void>> => {
    if (!validVersion(record.version)) return failed<void>();
    const path = releaseFinishRecordPath(home, record.version);
    // Whole or not at all: the rename is atomic within a directory.
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodeReleaseFinishRecord(record), { encoding: 'utf8' });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  },
});

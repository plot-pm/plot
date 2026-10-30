import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeRepairRecord, encodeRepairRecord, type RepairRecord } from '../../entities/repair-record.js';
import type { RepairRecordStore } from '../../ports/repair-record.js';

/** Where the record lives under a repository root. */
export const repairRecordPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'repair-record.json');

/**
 * Keeps the repair record in `.plot/state/repair-record.json`.
 *
 * @param repoRoot - the repository the file belongs to.
 * @returns a `RepairRecordStore` over that one file.
 */
export const repairRecordFile = (repoRoot: string): RepairRecordStore => {
  const path = repairRecordPath(repoRoot);
  return {
    read: async (): Promise<PortResult<RepairRecord | null>> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // No file is no record, which is an answer; any other error is a failure.
        if ((error as { code?: string }).code === 'ENOENT') return answered(null);
        return failed<RepairRecord | null>();
      }
      return answered(decodeRepairRecord(text));
    },

    write: async (record: RepairRecord): Promise<PortResult<void>> => {
      // Whole or not at all: the rename is atomic within a directory.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeRepairRecord(record), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeRepairRecord, encodeRepairRecord, type RepairRecord } from '../../entities/repair-record.js';
import type { RepairRecordStore } from '../../ports/repair-record.js';
import { baseRepairPath, validBase } from '../default-branch/default-branch-file.js';

/** Where the record lives under a repository root. */
export const repairRecordPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'repair-record.json');

/**
 * Keeps the repair record in `.plot/state/repair-record.json`.
 *
 * @param repoRoot - the repository the file belongs to.
 * @returns a `RepairRecordStore` over that one file.
 */
export const repairRecordFile = (repoRoot: string): RepairRecordStore => repairRecordAt(repairRecordPath(repoRoot));

/**
 * Keeps one repair record in the file at `path`, read and written whole.
 *
 * @param path - the record's file.
 * @param accepts - which decoded records read as a record; others read as none. Defaults to all.
 * @returns a `RepairRecordStore` over that one file.
 */
export const repairRecordAt = (path: string, accepts: (record: RepairRecord) => boolean = () => true): RepairRecordStore => {
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
      const record = decodeRepairRecord(text);
      return answered(record !== null && accepts(record) ? record : null);
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

/**
 * Keeps the repair record of a sprint base in `.plot/state/base-branches/<base>.repair.json`.
 *
 * A base that {@link validBase} refuses has no file: it reads as no record and
 * refuses a write. A file whose `branch` is not `base` reads as no record.
 *
 * @param repoRoot - the repository the file belongs to.
 * @param base - the base branch the record is kept for.
 * @returns a `RepairRecordStore` over that one file.
 */
export const baseRepairFile = (repoRoot: string, base: string): RepairRecordStore => {
  if (!validBase(base)) {
    return {
      read: async () => answered<RepairRecord | null>(null),
      write: async () => failed<void>(),
    };
  }
  return repairRecordAt(baseRepairPath(repoRoot, base), (record) => record.branch === base);
};

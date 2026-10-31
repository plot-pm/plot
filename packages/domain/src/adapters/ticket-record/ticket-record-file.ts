import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeTicketRecord, encodeTicketRecord, type TicketRecord } from '../../entities/ticket-record.js';
import type { TicketRecordStore } from '../../ports/ticket-record.js';

/** The subdirectory under `.plot/state/` holding one file per PR, a sibling of `fixer-attempts/`. */
const SUBDIR = 'tickets';

/** Where one PR's record lives under a repository root. */
export const ticketRecordPath = (repoRoot: string, pr: number): string =>
  join(repoRoot, '.plot', 'state', SUBDIR, `${pr}.json`);

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps one repository's ticket records, one JSON file per PR under
 * `.plot/state/tickets/`. Machine-local, like the rest of `.plot/state/`.
 *
 * @param repoRoot - the repository the records belong to.
 * @returns a `TicketRecordStore` backed by one file per PR.
 */
export const ticketRecordFile = (repoRoot: string): TicketRecordStore => ({
  read: async (pr: number): Promise<PortResult<TicketRecord | 'none' | 'unreadable'>> => {
    try {
      return answered(decodeTicketRecord(await readFile(ticketRecordPath(repoRoot, pr), 'utf8')));
    } catch (error) {
      if (isMissing(error)) return answered('none');
      return failed<TicketRecord | 'none' | 'unreadable'>();
    }
  },

  // ONE RENAME PER WRITE, so a reader sees the old record or the new one, never a torn file.
  write: async (pr: number, record: TicketRecord): Promise<PortResult<void>> => {
    const path = ticketRecordPath(repoRoot, pr);
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodeTicketRecord(record), { encoding: 'utf8' });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  },

  clear: async (pr: number): Promise<PortResult<void>> => {
    try {
      await rm(ticketRecordPath(repoRoot, pr), { force: true });
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  },
});

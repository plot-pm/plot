import type { TicketRecord } from '../entities/ticket-record.js';
import type { PortResult } from '../port-result.js';

/** Keeps one repository's ticket records, one per PR. */
export interface TicketRecordStore {
  /**
   * Reads one PR's record.
   *
   * @param pr - the PR number.
   * @returns the record, `'none'` where no file exists, `'unreadable'` where
   *   the file is not a record this build recognises; `failed` on any other error.
   */
  read(pr: number): Promise<PortResult<TicketRecord | 'none' | 'unreadable'>>;

  /**
   * Replaces one PR's record.
   *
   * @param pr - the PR number.
   * @param record - the whole record to keep.
   * @returns `failed` where the write did not complete; the old record then stands.
   */
  write(pr: number, record: TicketRecord): Promise<PortResult<void>>;

  /**
   * Removes one PR's record, for a `pending` record whose open call is known
   * not to have reached the tracker.
   *
   * @param pr - the PR number.
   * @returns `failed` where the file could not be removed; a missing file is removed.
   */
  clear(pr: number): Promise<PortResult<void>>;
}

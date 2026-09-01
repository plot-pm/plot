import {
  encodeEntry,
  withinLineCap,
  type BudgetEntry,
} from '../../entities/budget.js';
import type { BudgetRecord } from '../../ports/budget.js';
import { answered, failed, type PortResult } from '../../port-result.js';

/** What a fixture record starts out holding. */
export interface BudgetFixture {
  /** The lines the record already holds, oldest first. */
  lines?: readonly string[];
  /**
   * The path `location` reports.
   *
   * ONE VALUE, SHARED BY EVERY CALLER of a given fixture, which is the property
   * the real adapter has and the whole reason this slice exists: two checkouts
   * on one computer must resolve one record.
   */
  location?: string;
}

/**
 * A `BudgetRecord` held in memory, reaching no disk.
 *
 * THE IN-MEMORY LINES ARE THE POINT, not a convenience. The window rules are
 * pure and take lines as values, so a test of the reader's decisions needs no
 * file at all — and a test that used one would be measuring `node:fs` rather
 * than the rule. `budgetFile` is what the disk behaviour is asserted against.
 *
 * It enforces the line cap like the real adapter, because a fixture that
 * accepted an over-long line would let a caller ship a format the disk refuses.
 *
 * @param fixture - the lines to start with and the path to report.
 * @returns a `BudgetRecord` backed by an array.
 */
export const budgetFixture = (fixture: BudgetFixture = {}): BudgetRecord => {
  let held: string[] = [...(fixture.lines ?? [])];
  const path = fixture.location ?? '/fixture/.plot/state/budget.tsv';

  return {
    location: (): PortResult<string> => answered(path),

    append: async (entry: BudgetEntry): Promise<PortResult<void>> => {
      const line = encodeEntry(entry);
      if (!withinLineCap(line)) return failed<void>();
      held.push(line.replace(/\n$/, ''));
      return answered(undefined);
    },

    lines: async (): Promise<PortResult<readonly string[]>> => answered([...held]),

    truncate: async (keep: readonly BudgetEntry[]): Promise<PortResult<void>> => {
      held = keep.map((entry) => encodeEntry(entry).replace(/\n$/, ''));
      return answered(undefined);
    },
  };
};

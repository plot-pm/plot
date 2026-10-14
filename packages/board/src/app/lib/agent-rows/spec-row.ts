import type { DesignStatus } from '../../../contract/schema.js';
import type { PlanLevelRow } from './plan-level-row.js';

/**
 * The sentence shown once, above the section rows, when the fleet is halted
 * on spec run failures and no row already says so.
 */
const HALTED_LINE = 'The fleet starts no spec run until a person restarts one.';

/**
 * Turn the fleet's design payload into rows — `design.rows` becomes *Waiting
 * on you*, `design.running` becomes *Working*, and `halted` becomes a line
 * shown once rather than repeated per row.
 *
 * A going plan shows once, in *Working*: the domain's `specRow` also writes an
 * empty row for it into `design.rows`, and that row is dropped here.
 *
 * READS, NEVER DERIVES: `reason`, `log`, `restart` and `stopped` are copied
 * unchanged from the payload row, which the domain's `specRow` already
 * computed. `halted` on each row comes from that row's own `halted`.
 *
 * `design: null` (the server state file unreadable) answers no rows and no
 * line — nothing, not an empty-state message.
 *
 * @param design - the fleet's last-known design (spec run) state, or null.
 * @returns the rows for each section, and the halted line where one applies.
 */
export const specRows = (
  design: DesignStatus | null,
): { working: PlanLevelRow[]; waiting: PlanLevelRow[]; haltedLine: string | null } => {
  if (design === null) return { working: [], waiting: [], haltedLine: null };

  const going = new Set(design.running);
  const waiting: PlanLevelRow[] = design.rows
    .filter((row) => !going.has(row.plan))
    .map((row) => ({
      kind: 'spec',
      plan: row.plan,
      reason: row.reason,
      log: row.log,
      restart: row.restart,
      stopped: row.stopped,
      halted: row.halted,
    }));

  const working: PlanLevelRow[] = design.running.map((slug) => ({
    kind: 'spec',
    plan: slug,
    reason: 'spec run running',
    log: null,
    restart: null,
    halted: false,
    stopped: false,
  }));

  const anyRowHalted = waiting.some((row) => row.halted);
  const haltedLine = design.halted && !anyRowHalted ? HALTED_LINE : null;

  return { working, waiting, haltedLine };
};

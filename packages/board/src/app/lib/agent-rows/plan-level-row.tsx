import type { VerificationStatus } from '../../../contract/schema.js';
import { tupleFromPlan } from '../tuple-row.js';
import { TupleRowView } from '../../components/TupleRow.js';

/**
 * A run the fleet makes ON A PLAN rather than on a branch — a plan, a sentence,
 * no branch. `kind` discriminates the two fleets that render through this one
 * shape: `verify` is `plot-fleetd`'s auto-verify pass, populated here; `spec`
 * is `the-fleet-writes-the-design`'s design-run rows, a named consumer in an
 * adjacent plan and left unpopulated by this slice.
 */
export interface PlanLevelRow {
  kind: 'verify' | 'spec';
  plan: string;
  reason: string;
  log: string | null;
  restart: string | null;
  stopped: boolean;
  halted: boolean;
}

/**
 * The sentence shown once, above the section rows, when the fleet is halted
 * and no row already says so.
 */
const HALTED_LINE = 'The fleet starts no verify run until a person restarts one.';

/**
 * Turn the fleet's verification payload into rows — `verification.rows` becomes
 * *Waiting on you*, `verification.running` becomes *Working*, and `halted`
 * becomes a line shown once rather than repeated per row.
 *
 * READS, NEVER DERIVES: `reason`, `log`, `restart` and `stopped` are copied
 * unchanged from the payload row, which the domain's `verificationRow` already
 * computed. `halted` on each row comes from that row's own `fleetHalted`.
 *
 * `verification: null` (the server state file unreadable) answers no rows and
 * no line — nothing, not an empty-state message.
 *
 * @param verification - the fleet's last-known verification state, or null.
 * @returns the rows for each section, and the halted line where one applies.
 */
export function verificationRows(
  verification: VerificationStatus | null,
): { working: PlanLevelRow[]; waiting: PlanLevelRow[]; haltedLine: string | null } {
  if (verification === null) return { working: [], waiting: [], haltedLine: null };

  const waiting: PlanLevelRow[] = verification.rows.map((row) => ({
    kind: 'verify',
    plan: row.slug,
    reason: row.reason,
    log: row.log,
    restart: row.restart,
    stopped: row.stopped,
    halted: row.fleetHalted,
  }));

  const working: PlanLevelRow[] = verification.running.map((slug) => ({
    kind: 'verify',
    plan: slug,
    reason: 'verification running',
    log: null,
    restart: null,
    halted: false,
    stopped: false,
  }));

  const anyRowHalted = waiting.some((row) => row.halted);
  const haltedLine = verification.halted && !anyRowHalted ? HALTED_LINE : null;

  return { working, waiting, haltedLine };
}

/**
 * A plan-level run as a WAITING ON YOU or WORKING row: the plan's name, its
 * sentence, and where the payload carries one, the restart command and the
 * log path — both rendered as plain text, never links, by this board's
 * standing rule against a fabricated href.
 *
 * `planFile` is resolved by the caller (`cardForPlanFile`-style matching on the
 * row's `plan` against the board's cards), the same indirection `DraftPlanRowView`
 * needs for a row with no `AgentRow` of its own. Renders the slug with no plan
 * link where no card matches.
 */
export const PlanLevelRowView = (
  { row, planFile, onOpenPlan }: {
    row: PlanLevelRow;
    planFile: string;
    onOpenPlan?: (planFile: string) => boolean;
  },
) => {
  return (
    <TupleRowView
      tuple={tupleFromPlan({
        plan: row.plan,
        planFile,
        issues: [],
        phase: row.stopped ? 'stopped' : 'verification',
        waitingDays: null,
      })}
      onOpenPlan={onOpenPlan}
      rowAttr={{ 'data-plan-level-row': row.plan }}
      statusExtra={<>
        <span data-plan-level-reason className="min-w-0 truncate text-slate-500 dark:text-slate-400">
          {row.reason}
        </span>
        {row.restart && (
          <span data-plan-level-restart className="shrink-0 truncate font-mono text-xs text-slate-400 dark:text-slate-500">
            {row.restart}
          </span>
        )}
      </>}
    />
  );
};

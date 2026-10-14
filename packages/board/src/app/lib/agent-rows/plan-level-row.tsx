import type { VerificationStatus } from '../../../contract/schema.js';
import { tupleFromPlan } from '../tuple-row.js';
import { TupleRowView } from '../../components/TupleRow.js';

/**
 * A run the fleet makes ON A PLAN rather than on a branch — a plan, a sentence,
 * no branch. `kind` discriminates the two fleets that render through this one
 * shape: `verify` is `plot-fleetd`'s auto-verify pass, populated here; `spec`
 * is its design-run rows, populated by `specRows` in `./spec-row.js`.
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
export const verificationRows = (
  verification: VerificationStatus | null,
): { working: PlanLevelRow[]; waiting: PlanLevelRow[]; haltedLine: string | null } => {
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
};

/**
 * The status word a plan-level row shows: `stopped` for a stopped run of
 * either kind, otherwise `verification` for a `verify` row and `design` for a
 * `spec` row.
 *
 * @param row - the plan-level row.
 * @returns the word the row renders beside the plan name.
 */
export const planLevelStatus = (row: Pick<PlanLevelRow, 'kind' | 'stopped'>): string =>
  row.stopped ? 'stopped' : row.kind === 'spec' ? 'design' : 'verification';

/**
 * The plan file of the board card whose `slug` is `slug`, as the basename the
 * `/plan/<file>` route reads, or `''` where no card holds that slug.
 *
 * @param cards - the board payload's cards.
 * @param slug - the plan slug a plan-level row names.
 * @returns the card's plan file name, or `''`.
 */
export const planFileForSlug = (
  cards: readonly { slug: string; path: string }[],
  slug: string,
): string => {
  const card = cards.find((c) => c.slug === slug);
  return card ? (card.path.split(/[/\\]/).pop() ?? '') : '';
};

/**
 * The number a section's heading shows. *Working* counts its registry rows and
 * its running plan-level rows. *Waiting on you* counts its branch rows, broken
 * agents, draft plans and waiting plan-level rows; the halted line is not a row
 * and no count includes it. Every other section counts its branch rows.
 *
 * @param section - the section key.
 * @param held - how many rows of each kind the section holds.
 * @returns the section's count.
 */
export const sectionCount = (
  section: string,
  held: {
    branches: number;
    registry: number;
    broken: number;
    drafts: number;
    planLevel: { working: number; waiting: number };
  },
): number =>
  section === 'working'
    ? held.registry + held.planLevel.working
    : section === 'waiting-on-you'
      ? held.branches + held.broken + held.drafts + held.planLevel.waiting
      : held.branches;

/**
 * A plan-level run as a WAITING ON YOU or WORKING row: the plan's name, the
 * status word `planLevelStatus` answers, the reason, and where the payload
 * carries one, the restart command and the log path, both as plain text and
 * never as links.
 *
 * `planFile` comes from the caller, which reads it off the board card whose
 * `slug` is the row's `plan` (`planFileForSlug`). `''` renders the slug with no
 * plan link.
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
        phase: planLevelStatus(row),
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
        {row.log && (
          <span data-plan-level-log className="shrink-0 truncate font-mono text-xs text-slate-400 dark:text-slate-500">
            {row.log}
          </span>
        )}
      </>}
    />
  );
};

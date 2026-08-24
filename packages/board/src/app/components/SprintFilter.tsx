import type { FleetSprint, SprintCounts } from '../../contract/schema.js';

/**
 * The sprint filter control for the Agents tab.
 *
 * Shows one toggle per Active sprint, each with its target release and three
 * exhaustive counts: open, WIP, done. When no sprint is Active the control is
 * **disabled but visible**, showing estate totals — a control that vanishes
 * teaches a reader it does not exist.
 *
 * ## What this wave implements
 *
 * - Three exhaustive buckets: open (not started), WIP (in progress), done
 *   (delivered) — replacing the old four status buckets
 * - A total that equals `open + wip + done` — the arithmetic that exposes gaps
 * - One row per active sprint, independently toggleable
 * - The toggle is labelled "Sprint only" so readers know what it does
 * - The line reads "Sprint: <name>" to identify the kind of thing
 * - The release shows "target <version>" to clarify where the sprint is going
 *
 * ## Design decisions (from the plan)
 *
 * - THREE BUCKETS answer the question "how much is left": open/WIP/done
 * - Every member lands in exactly one bucket — the sum is the total
 * - Draft members are counted (in "open"), unlike the old four buckets
 * - It reads `plan.status`, it does not compute it — tallied server-side
 */

interface SprintFilterProps {
  /** The active sprints from the fleet payload. */
  sprints: FleetSprint[];
  /** Which sprint slugs are currently selected (showing their plans only). */
  selected: ReadonlySet<string>;
  /** Toggle a sprint's filter state. */
  onToggle: (slug: string) => void;
  /**
   * Estate-wide totals, for the disabled state when no sprint is Active.
   * These are the same three counts, aggregated over all plans.
   */
  estateTotals?: SprintCounts;
}

/**
 * Format a sprint's counts as a compact string.
 *
 * The format is `<total> members · <open> open · <wip> WIP · <done> done`.
 * All three bucket counts are shown, even when zero — the shape is the point,
 * and hiding zeros would make the total harder to verify by eye.
 */
function formatCounts(counts: SprintCounts): string {
  return `${counts.total} members · ${counts.open} open · ${counts.wip} WIP · ${counts.done} done`;
}

/**
 * The sprint filter for the Agents tab. One row per active sprint, each with
 * a toggle, release target, and three exhaustive counts.
 */
export function SprintFilter({ sprints, selected, onToggle, estateTotals }: SprintFilterProps) {
  // No active sprints: show disabled state with estate totals
  if (sprints.length === 0) {
    return (
      <div
        data-sprint-filter
        data-disabled
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled
            className="h-3.5 w-3.5 cursor-not-allowed opacity-50"
            title="No active sprint"
          />
          <span className="italic">No active sprint</span>
        </div>
        {estateTotals && (
          <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Total — {formatCounts(estateTotals)}
          </div>
        )}
      </div>
    );
  }

  // One or more active sprints: show one row per sprint
  return (
    <div data-sprint-filter className="space-y-1">
      {sprints.map((sprint) => {
        const isSelected = selected.has(sprint.slug);
        return (
          <label
            key={sprint.slug}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
              isSelected
                ? 'border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-950/30'
                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                data-sprint-toggle={sprint.slug}
                checked={isSelected}
                onChange={() => onToggle(sprint.slug)}
                className="h-3.5 w-3.5 accent-green-600"
              />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Sprint only
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  <span className="font-normal text-slate-500 dark:text-slate-400">Sprint:</span>{' '}
                  {sprint.title}
                </span>
                {/* Release target — only show if set */}
                {sprint.release && (
                  <span className="text-slate-500 dark:text-slate-400">
                    target {sprint.release}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {formatCounts(sprint.counts)}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

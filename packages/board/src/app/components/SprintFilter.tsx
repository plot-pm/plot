import type { FleetSprint, SprintCounts } from '../../contract/schema.js';

/**
 * The sprint filter control for the Agents tab.
 *
 * Shows one toggle per Active sprint, each with its target release and four
 * `status` counts: delivered, deliverable, in progress, approved. When no
 * sprint is Active the control is **disabled but visible**, showing unreleased
 * estate totals — a control that vanishes teaches a reader it does not exist.
 *
 * ## What this wave implements
 *
 * - The control: toggle, the counts, the disabled-with-totals state
 * - One row per active sprint, independently toggleable
 * - Plan-less rows always visible under the filter (the predicate is in
 *   AgentList, not here)
 *
 * ## Design decisions (from the plan)
 *
 * - The counts are the point, not decoration: `deliverable` is the actionable
 *   one — plans whose every wave has merged and whose delivery decision is
 *   outstanding
 * - It reads `plan.status`, it does not compute it — this plan must not derive
 *   its own counts
 * - Two sprints may be Active (two teams, one train): the control shows one
 *   row per active sprint, each independently toggleable
 */

interface SprintFilterProps {
  /** The active sprints from the fleet payload. */
  sprints: FleetSprint[];
  /** Which sprint slugs are currently selected (showing their plans only). */
  selected: ReadonlySet<string>;
  /** Toggle a sprint's filter state. */
  onToggle: (slug: string) => void;
  /**
   * Estate-wide unreleased totals, for the disabled state when no sprint is
   * Active. These are the same four counts, aggregated differently.
   */
  estateTotals?: SprintCounts;
}

/**
 * Format a sprint's counts as a compact string.
 *
 * The counts are the point: `deliverable` is the actionable one — plans whose
 * every wave has merged and whose delivery decision is outstanding.
 */
function formatCounts(counts: SprintCounts): string {
  const parts: string[] = [];
  // Only show non-zero counts to keep it compact
  if (counts.delivered > 0) parts.push(`${counts.delivered} delivered`);
  if (counts.deliverable > 0) parts.push(`${counts.deliverable} deliverable`);
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
  if (counts.approved > 0) parts.push(`${counts.approved} approved`);
  return parts.join(' · ') || 'empty';
}

/**
 * The sprint filter for the Agents tab. One row per active sprint, each with
 * a toggle, release target, and status counts.
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
            Unreleased: {formatCounts(estateTotals)}
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
            <input
              type="checkbox"
              data-sprint-toggle={sprint.slug}
              checked={isSelected}
              onChange={() => onToggle(sprint.slug)}
              className="mt-0.5 h-3.5 w-3.5 accent-green-600"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {sprint.title}
                </span>
                {/* Release target — only show if set */}
                {sprint.release && (
                  <span className="text-slate-500 dark:text-slate-400">
                    → {sprint.release}
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

import { useEffect } from 'react';
import type { SprintCard, SprintMember } from '../../contract/schema.js';

export interface SprintModalProps {
  sprint: SprintCard;
  onClose: () => void;
  /** Navigate to a plan in the Plans tab. */
  onOpenPlan?: (slug: string) => void;
}

/**
 * Group members by their MoSCoW tier.
 */
const TIERS = ['Must', 'Should', 'Could', 'Wont'] as const;
type Tier = (typeof TIERS)[number];

function groupByTier(members: SprintMember[]): Record<Tier, SprintMember[]> {
  const groups: Record<Tier, SprintMember[]> = {
    Must: [],
    Should: [],
    Could: [],
    Wont: [],
  };
  for (const m of members) {
    const tier = (m.tier as Tier) || 'Could';
    if (groups[tier]) groups[tier].push(m);
  }
  return groups;
}

/**
 * Sprint overlay — shows sprint details with MoSCoW-grouped members.
 */
export function SprintModal({ sprint, onClose, onOpenPlan }: SprintModalProps) {
  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const byTier = groupByTier(sprint.members);
  const totalPlans = sprint.members.length;
  const checkedPlans = sprint.members.filter((m) => m.checked).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Sprint: ${sprint.title || sprint.slug}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="mr-auto truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            Sprint
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Title and phase */}
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {sprint.title || sprint.slug}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {sprint.phase}
              </span>
              {sprint.release && (
                <span className="text-slate-500 dark:text-slate-400">
                  Release: <span className="font-medium">{sprint.release}</span>
                </span>
              )}
              {(sprint.start || sprint.end) && (
                <span className="text-slate-500 dark:text-slate-400">
                  {sprint.start && sprint.end
                    ? `${sprint.start} → ${sprint.end}`
                    : sprint.start
                      ? `Start: ${sprint.start}`
                      : `End: ${sprint.end}`}
                </span>
              )}
            </div>
          </div>

          {/* Sprint goal */}
          {sprint.goal && (
            <div className="mb-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-800 dark:bg-cyan-950/30">
              <p className="text-sm font-medium text-cyan-800 dark:text-cyan-200">
                {sprint.goal}
              </p>
            </div>
          )}

          {/* Progress */}
          <div className="mb-4 rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600 dark:text-slate-300">Progress</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">
                {checkedPlans} / {totalPlans} plans completed
              </span>
            </div>
            {totalPlans > 0 && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all"
                  style={{ width: `${(checkedPlans / totalPlans) * 100}%` }}
                />
              </div>
            )}
          </div>

          {/* MoSCoW sections */}
          {TIERS.map((tier) => {
            const members = byTier[tier];
            if (members.length === 0) return null;
            return (
              <div key={tier} className="mb-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {tier} ({members.length})
                </h4>
                <ul className="space-y-1">
                  {members.map((m) => (
                    <li
                      key={m.slug}
                      className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm dark:bg-slate-800"
                    >
                      {/* Checkbox indicator */}
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          m.checked
                            ? 'border-cyan-500 bg-cyan-500 text-white'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {m.checked && (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      {/* Plan slug (members don't carry titles) */}
                      {onOpenPlan ? (
                        <button
                          type="button"
                          onClick={() => onOpenPlan(m.slug)}
                          className={`min-w-0 truncate text-left hover:underline ${
                            m.checked
                              ? 'text-slate-500 line-through dark:text-slate-400'
                              : 'text-cyan-600 dark:text-cyan-400'
                          }`}
                        >
                          {m.slug}
                        </button>
                      ) : (
                        <span
                          className={`min-w-0 truncate ${
                            m.checked
                              ? 'text-slate-500 line-through dark:text-slate-400'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {m.slug}
                        </span>
                      )}
                      {/* Delivered badge */}
                      {m.checked && (
                        <span
                          className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        >
                          Delivered
                        </span>
                      )}
                      {/* Unknown badge */}
                      {!m.known && (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          title="Plan not found in board"
                        >
                          ?
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {/* Empty state */}
          {totalPlans === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No plans in this sprint yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

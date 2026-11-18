import type { PersonCard, SliceState } from '@plot-pm/domain';

const SEGMENT_CLASS: Record<SliceState, string> = {
  delivered: 'bg-emerald-500 dark:bg-emerald-400',
  'at-a-gate': 'bg-sky-500 dark:bg-sky-400',
  'being-built': 'bg-blue-300 dark:bg-blue-500',
  blocked: 'bg-amber-500 dark:bg-amber-400',
  'not-started': 'bg-slate-300 dark:bg-slate-600',
};

const SEGMENT_WORD: Record<SliceState, string> = {
  delivered: 'delivered',
  'at-a-gate': 'at a gate',
  'being-built': 'being built',
  blocked: 'blocked',
  'not-started': 'not started',
};

/**
 * The person cards of one Release delivery block: one card per sprint owner with a bar per sprint.
 *
 * Every label, count and wording comes from `releasePersonCards`; this component decides nothing.
 */
export function ReleasePersonCards({ cards }: { cards: readonly PersonCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div data-person-cards className="flex flex-wrap gap-2 px-3">
      {cards.map((card) => (
        <div key={card.key || 'no-owner'} data-person-card={card.key} className="min-w-48 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-900/40">
          <p data-person-card-label className="font-medium text-slate-700 dark:text-slate-200">{card.label}</p>
          {card.sprints.map((sprint) => (
            <div key={sprint.slug} data-person-card-sprint={sprint.slug} className="space-y-0.5">
              <p className="text-slate-500 dark:text-slate-400">{sprint.title}</p>
              {sprint.bar === null ? (
                <p data-person-card-missing className="text-slate-500 dark:text-slate-400">{sprint.missingText}</p>
              ) : (
                <div data-person-card-bar role="img" aria-label={sprint.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  {sprint.bar.map((s) => (
                    s.count > 0 ? <span key={s.state} data-person-card-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

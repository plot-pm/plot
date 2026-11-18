import type { SliceState, SprintCardsView } from '@plot-pm/domain';

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
 * The Delivery tab header's sprint card: one block per owned Active sprint with
 * its end date, target release, five-segment bar and progress per tier.
 *
 * Every word and count comes from `sprintCards`; this component decides nothing.
 */
export function SprintCard({ view }: { view: SprintCardsView }) {
  if (view.cards.length === 0) return null;
  return (
    <div
      data-sprint-card
      className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40"
    >
      {view.cards.map((card) => (
        <div key={card.slug} data-sprint-card-sprint={card.slug} className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{card.title}</span>
            {card.endLine !== '' && <span data-sprint-card-end className="text-slate-500 dark:text-slate-400">{card.endLine}</span>}
            {card.release !== '' && <span data-sprint-card-release className="text-slate-500 dark:text-slate-400">release {card.release}</span>}
          </div>
          {card.bar === null ? (
            <p data-sprint-card-missing className="text-slate-500 dark:text-slate-400">The merge reading for this sprint is missing.</p>
          ) : (
            <div data-sprint-card-bar role="img" aria-label={card.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              {card.bar.map((s) => (
                s.count > 0 ? <span key={s.state} data-sprint-card-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
              ))}
            </div>
          )}
          {card.tierLine !== '' && <p data-sprint-card-tiers className="text-slate-500 tabular-nums dark:text-slate-400">{card.tierLine}</p>}
        </div>
      ))}
      {view.unknownOwners.map((o) => (
        <p key={o.slug} data-sprint-card-unknown-owner={o.slug} className="text-amber-700 dark:text-amber-500">
          Sprint {o.slug} names the Owner “{o.handle}”, which People does not declare.
        </p>
      ))}
    </div>
  );
}

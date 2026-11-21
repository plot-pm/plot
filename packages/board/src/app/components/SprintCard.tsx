import { SLICE_STATE_WORDS, type SprintCardsView } from '@plot-pm/domain';
import { SEGMENT_CLASS } from '../lib/agent-rows/state-classes.js';

export { SEGMENT_CLASS } from '../lib/agent-rows/state-classes.js';
/** The slice-state words, kept under the card's old name until the Release group replaces the card. */
export const SEGMENT_WORD = SLICE_STATE_WORDS;

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
      className="delivery-card space-y-2 text-[13px]"
    >
      {view.cards.map((card) => (
        <div key={card.slug} data-sprint-card-sprint={card.slug} className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="delivery-title">{card.title}</span>
            {card.endLine !== '' && <span data-sprint-card-end className="delivery-text-muted">{card.endLine}</span>}
            {card.release !== '' && <span data-sprint-card-release className="delivery-text-muted">release {card.release}</span>}
          </div>
          {card.bar === null ? (
            <p data-sprint-card-missing className="delivery-text-muted">The merge reading for this sprint is missing.</p>
          ) : (
            <div data-sprint-card-bar role="img" aria-label={card.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded bg-(--card-track)">
              {card.bar.map((s) => (
                s.count > 0 ? <span key={s.state} data-sprint-card-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
              ))}
            </div>
          )}
          {card.tierLine !== '' && <p data-sprint-card-tiers className="delivery-text-muted tabular-nums">{card.tierLine}</p>}
        </div>
      ))}
      {view.unknownOwners.map((o) => (
        <p key={o.slug} data-sprint-card-unknown-owner={o.slug} className="delivery-text-warn">
          Sprint {o.slug} names the Owner “{o.handle}”, which People does not declare.
        </p>
      ))}
    </div>
  );
}

import type { PersonCard } from '@plot-pm/domain';
import { SEGMENT_CLASS, SEGMENT_WORD } from './SprintCard.js';

/**
 * The person cards of one Release delivery block: one card per sprint owner with a bar per sprint.
 *
 * Every label, count and wording comes from `releasePersonCards`; this component decides nothing.
 */
export const ReleasePersonCards = ({ cards }: { cards: readonly PersonCard[] }) => {
  if (cards.length === 0) return null;
  return (
    <div data-person-cards className="flex flex-wrap gap-2 px-3">
      {cards.map((card) => (
        <div key={card.key === '' ? 'none' : `owner:${card.key}`} data-person-card={card.key} className="delivery-person-card min-w-48 space-y-1 p-2">
          <p data-person-card-label className="delivery-title">{card.label}</p>
          {card.sprints.map((sprint) => (
            <div key={sprint.slug} data-person-card-sprint={sprint.slug} className="space-y-0.5">
              <p className="delivery-text-muted">{sprint.title}</p>
              {sprint.bar === null ? (
                <p data-person-card-missing className="delivery-text-muted">{sprint.missingText}</p>
              ) : (
                <div data-person-card-bar role="img" aria-label={sprint.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded bg-(--card-track)">
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
};

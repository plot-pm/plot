import type { ReleaseCardView } from '@plot-pm/domain';
import type { AgentRow } from '../../contract/schema.js';
import { ReleaseApprove } from './ReleaseApprove.js';
import { SEGMENT_CLASS, SEGMENT_WORD } from './SprintCard.js';

/**
 * The Delivery tab header's release cards: one per release the Active sprints
 * target or a release PR carries, each with its bar, people, state and the
 * "Approve release" button.
 *
 * Every word and count comes from `releaseCards`; this component decides nothing.
 */
export const ReleaseCard = ({ cards, rows }: { cards: readonly ReleaseCardView[]; rows: Readonly<Record<string, AgentRow>> }) => (
  <div data-release-cards className="space-y-2">
    {cards.map((card) => (
      <div
        key={card.key}
        id={card.anchor}
        data-release-card={card.kind}
        data-release-card-version={card.version}
        className="min-w-0 space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span data-release-card-title className="min-w-0 break-words font-semibold text-slate-800 dark:text-slate-100">{card.title}</span>
          {card.stateText !== '' && <span data-release-card-state className="text-slate-500 dark:text-slate-400">{card.stateText}</span>}
          {card.peopleText !== '' && <span data-release-card-people className="text-slate-500 tabular-nums dark:text-slate-400">{card.peopleText}</span>}
        </div>
        {card.readingMissing && <p data-release-card-missing className="text-slate-500 dark:text-slate-400">{card.missingText}</p>}
        {card.bar !== null && (
          <div data-release-card-bar role="img" aria-label={card.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
            {card.bar.map((s) => (
              s.count > 0 ? <span key={s.state} data-release-card-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ReleaseApprove card={card} row={card.rowId === null ? null : rows[card.rowId] ?? null} />
        </div>
      </div>
    ))}
  </div>
);

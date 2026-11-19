import { linkIconKind, type ReleaseCardView } from '@plot-pm/domain';
import type { AgentRow } from '../../contract/schema.js';
import { LinkIcon } from './LinkIcon.js';
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
        className="delivery-card min-w-0 space-y-2 text-[13px]"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="inline-flex min-w-0 items-baseline">
            <LinkIcon kind={linkIconKind('release')} />
            <span data-release-card-title className="delivery-title min-w-0 break-words">{card.title}</span>
          </span>
          {card.stateText !== '' && <span data-release-card-state className="delivery-text-muted">{card.stateText}</span>}
          {card.peopleText !== '' && <span data-release-card-people className="delivery-text-muted tabular-nums">{card.peopleText}</span>}
        </div>
        {card.readingMissing && <p data-release-card-missing className="delivery-text-muted">{card.missingText}</p>}
        {card.bar !== null && (
          <>
            <div data-release-card-bar role="img" aria-label={card.bar.map((s) => `${s.count} ${SEGMENT_WORD[s.state]}`).join(', ')} className="flex w-full overflow-hidden">
              {card.bar.map((s) => (
                s.count > 0 ? <span key={s.state} data-release-card-segment={s.state} data-count={s.count} style={{ flexGrow: s.count }} className={SEGMENT_CLASS[s.state]} /> : null
              ))}
            </div>
            <p data-release-card-legend className="flex flex-wrap gap-x-2.5 gap-y-0.5">
              {card.bar.map((s) => (
                s.count > 0 ? (
                  <span key={s.state} data-release-card-legend-item={s.state} className="inline-flex items-center tabular-nums">
                    <span aria-hidden className={`delivery-release-swatch ${SEGMENT_CLASS[s.state]}`} />
                    {s.count} {SEGMENT_WORD[s.state]}
                  </span>
                ) : null
              ))}
            </p>
          </>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ReleaseApprove card={card} row={card.rowId === null ? null : rows[card.rowId] ?? null} />
        </div>
      </div>
    ))}
  </div>
);

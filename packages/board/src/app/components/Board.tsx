import type { Board, Card } from '../../contract/schema.js';
import { NO_SPRINT, NO_STORY, passesFilter } from '../lib/filters.js';
import { PlanCard } from './PlanCard.js';

export interface BoardViewProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  /** Open a plan in the in-board modal. */
  onOpenPlan: (card: Card) => void;
}

export function BoardView({ board, sprintSel, storySel, onOpenPlan }: BoardViewProps) {
  const showSprint = sprintSel.length === 0;
  const showStory = storySel.length === 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {board.columns.map((column) => {
        // Sprint and story filters intersect.
        const cards = column.cards.filter(
          (c) =>
            passesFilter(c, sprintSel, 'sprint', NO_SPRINT) &&
            passesFilter(c, storySel, 'story', NO_STORY),
        );
        return (
          <section
            key={column.phase}
            className="flex flex-col rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50"
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                {column.phase}
              </h2>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {cards.length}
              </span>
            </header>
            <div className="flex flex-col gap-3">
              {cards.length > 0 ? (
                cards.map((card) => (
                  <PlanCard
                    key={card.path}
                    card={card}
                    showSprint={showSprint}
                    showStory={showStory}
                    onOpen={onOpenPlan}
                  />
                ))
              ) : (
                <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                  No plans in this phase.
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

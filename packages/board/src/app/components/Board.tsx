import type { Board, Card } from '../../contract/schema.js';
import { PHASE_LEADERSHIP } from '../../contract/schema.js';
import { NO_SPRINT, NO_STORY, passesFilter } from '../lib/filters.js';
import { PlanCard } from './PlanCard.js';

export interface BoardViewProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting: (active: boolean) => void;
  /** Open a plan in the in-board modal. */
  onOpenPlan: (card: Card) => void;
  /** Switch to lane layout and scroll to a story's row. */
  onGoToStory: (story: string) => void;
}

export function BoardView({
  board,
  sprintSel,
  storySel,
  pulse,
  onStarting,
  onOpenPlan,
  onGoToStory,
}: BoardViewProps) {
  const showSprint = sprintSel.length === 0;
  const showStory = storySel.length === 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
            <header className="mb-3 flex items-center justify-between gap-2">
              {/* Leadership rides on the symbol and the title text, never on
                  colour alone — the accent stripe only repeats it. */}
              <h2
                className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
                title={`${column.phase} — ${PHASE_LEADERSHIP[column.phase].who}`}
              >
                <span aria-hidden>{PHASE_LEADERSHIP[column.phase].icon}</span>
                <span className="truncate">{column.phase}</span>
              </h2>
              <span className="flex shrink-0 items-center gap-1">
                {/* What is left before signoff — the question the column asks. */}
                {column.phase === 'Endgame' && board.checklist && (
                  <span
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    title="Release checklist"
                  >
                    ☑ {board.checklist.done}/{board.checklist.total}
                  </span>
                )}
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {cards.length}
                </span>
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
                    dispatch={board.dispatch}
                    pulse={pulse}
                    onStarting={onStarting}
                    onOpen={onOpenPlan}
                    onGoToStory={onGoToStory}
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

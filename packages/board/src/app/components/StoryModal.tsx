import type { Card, Phase, StoryCard } from '../../contract/schema.js';
import { BOARD_PHASES } from '../../contract/schema.js';
import { storyHref } from '../lib/plan.js';
import { DocModal } from './DocModal.js';

export interface StoryModalProps {
  story: StoryCard;
  /**
   * Every card the board holds — the story's plan list is DERIVED from these.
   * Passed whole rather than pre-filtered so the filtering rule lives beside
   * the rendering that depends on it.
   */
  cards: Card[];
  onClose: () => void;
  /** Switch to the board, filtered to this story. */
  onShowInBoard?: (story: StoryCard) => void;
  /** Open one of the story's plans, replacing this overlay. */
  onOpenPlan?: (card: Card) => void;
}

/**
 * The story's plans, in board-phase order.
 *
 * DERIVED from the board's own cards, not parsed from the STORY file's
 * hand-maintained "Current Plan" prose. Every fact needed is already on a plan
 * card — `story` and `phase` — and the hand-written section is precisely the
 * thing that drifts: four of twelve open points in one story were stale when
 * swept, because nothing marks an item resolved when its plan lands. A derived
 * list cannot drift.
 *
 * Ordered by phase rather than by title so the row reads as a pipeline: what is
 * still being found, what is in flight, what is done.
 *
 * Exported for test — the disagreement between a stale prose section and the
 * live cards is the assertion that matters, and it is made here.
 */
export function plansInStory(cards: Card[], slug: string): Card[] {
  const order = new Map<Phase, number>(BOARD_PHASES.map((p, i) => [p, i]));
  return cards
    .filter((c) => c.story === slug)
    .slice()
    .sort((a, b) => (order.get(a.phase) ?? 0) - (order.get(b.phase) ?? 0));
}

/**
 * In-board story viewer — the plan modal's twin.
 *
 * Its HEADER is literally the plan modal's, because both render `DocModal`: a
 * reader who has learned one set of controls should not have to learn a second.
 * Its BODY is its own, and has to be — a story has no worktree, and the thing
 * its card cannot say is what it is MADE OF.
 */
export function StoryModal({ story, cards, onClose, onShowInBoard, onOpenPlan }: StoryModalProps) {
  const plans = plansInStory(cards, story.slug);

  return (
    <DocModal
      label="Story"
      ariaLabel={`Story: ${story.title || story.slug}`}
      href={storyHref(story)}
      frameTitle={`Story: ${story.slug}`}
      onShowInBoard={onShowInBoard && (() => onShowInBoard(story))}
      onClose={onClose}
    >
      <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Plans in this story
        </p>
        {plans.length === 0 ? (
          // A real answer, not an empty section: a story that is shaped and not
          // yet planned is a state worth naming, and the same one the swimlane
          // row states as "no plans yet".
          <p className="text-xs text-slate-500 dark:text-slate-400">No plans yet.</p>
        ) : (
          <ul className="space-y-1">
            {plans.map((card) => (
              <li key={card.path} className="flex items-baseline gap-2 text-xs">
                <span className="w-24 shrink-0 text-slate-500 dark:text-slate-400">
                  {card.phase}
                </span>
                {onOpenPlan ? (
                  <button
                    type="button"
                    onClick={() => onOpenPlan(card)}
                    className="min-w-0 truncate text-left text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {card.title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                    {card.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DocModal>
  );
}

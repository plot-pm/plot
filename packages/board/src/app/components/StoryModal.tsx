import { useState } from 'react';
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
 *
 * Enhanced to show:
 * - Objective (from `## Objective` section, truncated)
 * - Design section (collapsible, from `## Design` section)
 * - Design docs list (DESIGN-*.md files)
 * - Content indicators (open points, session log)
 * - Plans with back-navigation
 */
export function StoryModal({ story, cards, onClose, onShowInBoard, onOpenPlan }: StoryModalProps) {
  const plans = plansInStory(cards, story.slug);
  const [designExpanded, setDesignExpanded] = useState(false);

  return (
    <DocModal
      label="Story"
      ariaLabel={`Story: ${story.title || story.slug}`}
      href={storyHref(story)}
      frameTitle={`Story: ${story.slug}`}
      onShowInBoard={onShowInBoard && (() => onShowInBoard(story))}
      onClose={onClose}
    >
      {/* Status and drift warning */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Status
        </span>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {story.status || 'draft'}
        </span>
        {story.statusDrift && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
            title={story.statusDrift}
          >
            ⚠️ {story.statusDrift}
          </span>
        )}
        {/* Content indicators */}
        {story.hasOpenPoints && (
          <span
            className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
            title="Has open points to resolve"
          >
            📋 Open points
          </span>
        )}
        {story.hasSessionLog && (
          <span
            className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            title="Has session log"
          >
            📝 Session log
          </span>
        )}
      </div>

      {/* Objective */}
      {story.objective && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Objective
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {story.objective}
          </p>
        </div>
      )}

      {/* Design section (collapsible) */}
      {story.design && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setDesignExpanded(!designExpanded)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Design
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {designExpanded ? '▼' : '▶'}
            </span>
          </button>
          {designExpanded && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">
              {story.design}
            </p>
          )}
        </div>
      )}

      {/* Design docs */}
      {story.designDocs && story.designDocs.length > 0 && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Design Documents ({story.designDocs.length})
          </p>
          <ul className="space-y-0.5">
            {story.designDocs.map((doc) => (
              <li key={doc} className="text-xs text-slate-600 dark:text-slate-300">
                📄 {doc}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dates */}
      {(story.created || story.updated) && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
            {story.created && <span>Created: {story.created}</span>}
            {story.updated && <span>Updated: {story.updated}</span>}
            {story.author && <span>Author: {story.author}</span>}
          </div>
        </div>
      )}

      {/* Plans in this story */}
      <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Plans in this story ({plans.length})
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

      {/* Sprints this story appears in */}
      {story.sprints && story.sprints.length > 0 && (
        <div className="px-4 py-2">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Sprints ({story.sprints.length})
          </p>
          <ul className="space-y-0.5">
            {story.sprints.map((sprint) => (
              <li key={sprint.slug} className="flex items-baseline gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">{sprint.slug}</span>
                <span className="text-slate-400 dark:text-slate-500">
                  ({sprint.planCount} {sprint.planCount === 1 ? 'plan' : 'plans'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DocModal>
  );
}

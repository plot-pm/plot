import { useState } from 'react';
import type { Card, Phase, StoryCard } from '../../contract/schema.js';
import { BOARD_PHASES } from '../../contract/schema.js';
import { planHref, storyHref } from '../lib/plan.js';
import { DocModal } from './DocModal.js';

/**
 * Convert basic markdown to HTML for display.
 *
 * Handles **bold**, *italic*, and `code` — enough for design sections
 * without pulling in a full markdown parser.
 */
function renderMarkdown(text: string): string {
  return text
    // Escape HTML first to prevent XSS
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Then apply markdown formatting
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-200 px-1 dark:bg-slate-700">$1</code>')
    // Convert line breaks
    .replace(/\n/g, '<br />');
}

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
  /** Navigate to a sprint in the Agents tab. */
  onOpenSprint?: (sprintSlug: string) => void;
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
 * In-board story viewer — the plan modal's twin, with in-overlay plan navigation.
 *
 * Its HEADER is literally the plan modal's, because both render `DocModal`: a
 * reader who has learned one set of controls should not have to learn a second.
 * Its BODY is its own, and has to be — a story has no worktree, and the thing
 * its card cannot say is what it is MADE OF.
 *
 * When a plan is clicked, the overlay navigates to show that plan's content
 * with a back button to return to the story view — no new overlay is opened.
 *
 * Enhanced to show:
 * - Objective (from `## Objective` section, truncated)
 * - Design section (collapsible, from `## Design` section)
 * - Design docs list (DESIGN-*.md files)
 * - Content indicators (open points, session log)
 * - Plans with in-overlay navigation
 */
/**
 * Build href for a design doc within a story directory.
 * Uses /design/ route with format: /design/<story-slug>/<doc-name>
 */
function designDocHref(story: StoryCard, docName: string): string {
  return `/design/${encodeURIComponent(`${story.slug}/${docName}`)}`;
}

export function StoryModal({ story, cards, onClose, onShowInBoard, onOpenSprint }: StoryModalProps) {
  const plans = plansInStory(cards, story.slug);
  const [designExpanded, setDesignExpanded] = useState(false);
  // In-overlay navigation: null = story view, Card = plan view, string = design doc
  const [viewingPlan, setViewingPlan] = useState<Card | null>(null);
  const [viewingDesignDoc, setViewingDesignDoc] = useState<string | null>(null);

  // When viewing a design doc, show it in DocModal with back navigation
  if (viewingDesignDoc) {
    return (
      <DocModal
        label="Design Doc"
        ariaLabel={`Design: ${viewingDesignDoc}`}
        href={designDocHref(story, viewingDesignDoc)}
        frameTitle={`Design: ${viewingDesignDoc}`}
        onClose={onClose}
      >
        {/* Back to story button */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setViewingDesignDoc(null)}
            className="flex items-center gap-1 text-xs text-cyan-600 hover:underline dark:text-cyan-400"
          >
            ← Back to {story.title || story.slug}
          </button>
        </div>
      </DocModal>
    );
  }

  // When viewing a plan, show a different DocModal with back navigation
  if (viewingPlan) {
    return (
      <DocModal
        label="Plan"
        ariaLabel={`Plan: ${viewingPlan.title}`}
        href={planHref(viewingPlan)}
        frameTitle={`Plan: ${viewingPlan.slug}`}
        onShowInBoard={onShowInBoard && (() => onShowInBoard(story))}
        onClose={onClose}
      >
        {/* Back to story button */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setViewingPlan(null)}
            className="flex items-center gap-1 text-xs text-cyan-600 hover:underline dark:text-cyan-400"
          >
            ← Back to {story.title || story.slug}
          </button>
        </div>
      </DocModal>
    );
  }

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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
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
          <div
            className="text-sm text-slate-700 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(story.objective) }}
          />
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
            <div
              className="prose prose-sm prose-slate mt-2 max-w-none text-xs dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(story.design) }}
            />
          )}
        </div>
      )}

      {/* Design docs — clickable links with in-overlay navigation */}
      {story.designDocs && story.designDocs.length > 0 && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Design Documents ({story.designDocs.length})
          </p>
          <ul className="space-y-0.5">
            {story.designDocs.map((doc) => (
              <li key={doc}>
                <button
                  type="button"
                  onClick={() => setViewingDesignDoc(doc)}
                  className="text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                >
                  📄 {doc}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dates */}
      {(story.created || story.updated) && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
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
                <button
                  type="button"
                  onClick={() => setViewingPlan(card)}
                  className="min-w-0 truncate text-left text-cyan-600 hover:underline dark:text-cyan-400"
                >
                  {card.title}
                </button>
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
                {onOpenSprint ? (
                  <button
                    type="button"
                    onClick={() => onOpenSprint(sprint.slug)}
                    className="text-cyan-600 hover:underline dark:text-cyan-400"
                  >
                    {sprint.slug}
                  </button>
                ) : (
                  <span className="text-slate-600 dark:text-slate-300">{sprint.slug}</span>
                )}
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

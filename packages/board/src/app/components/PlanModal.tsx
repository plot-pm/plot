import type { Card, StoryCard } from '../../contract/schema.js';
import { planHref, storyHref } from '../lib/plan.js';
import { DocModal } from './DocModal.js';

export interface PlanModalProps {
  card: Card;
  /**
   * The story card for `card.story`, if the board collected one. Absent for a
   * plan with no story, and for a plan naming a story nobody has written — and
   * the `Open story` control then does not render at all.
   */
  story?: StoryCard;
  onClose: () => void;
  /**
   * Close, switch to the board, and land on this card — highlighted, among its
   * neighbours.
   *
   * The modal answers *what does this plan say*; the board answers *where does
   * it sit*. Without this the second question costs a manual tab switch and a
   * filter, which is the friction this control exists to remove.
   */
  onShowInBoard?: (card: Card) => void;
  /**
   * Open this plan's story, REPLACING this modal rather than stacking above it.
   * Absent where the plan has no story file to open.
   */
  onOpenStory?: (story: StoryCard) => void;
}

/**
 * In-board plan viewer. The chrome, the fetch-and-embed and the three header
 * controls come from `DocModal`, which the story overlay shares — that shared
 * component is what keeps the two headers identical rather than merely similar.
 */
export function PlanModal({ card, story, onClose, onShowInBoard, onOpenStory }: PlanModalProps) {
  // A story with no file gets no button, rather than one that 404s — the same
  // rule the badge follows, and the reason the emptiness is checked here rather
  // than inside the href helper alone.
  const canOpenStory = Boolean(onOpenStory && story && storyHref(story));

  return (
    <DocModal
      label="Plan"
      ariaLabel={`Plan: ${card.title}`}
      href={planHref(card)}
      frameTitle={`Plan: ${card.slug}`}
      onShowInBoard={onShowInBoard && (() => onShowInBoard(card))}
      onClose={onClose}
    >
      {/* The story this plan belongs to, as an ACTION rather than a label.
          The badge on the card names the story at triage time; a named button
          is where people look for something to do once they have stopped
          triaging — and the modal's header is exactly that list. Kept in the
          body rather than the header so the header stays identical to the
          story overlay's, which is the symmetry both are meant to preserve. */}
      {canOpenStory && story && (
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Story
          </span>
          <span className="truncate text-xs text-slate-600 dark:text-slate-300">
            {story.title || story.slug}
          </span>
          <button
            type="button"
            onClick={() => onOpenStory!(story)}
            className="ml-auto shrink-0 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Open story
          </button>
        </div>
      )}
      {/* Where this plan's work is checked out on THIS machine.

          Under the header rather than in the row: a row is a triage line and
          is already full, while a filesystem path is what you want once you
          have stopped triaging and decided to go look. Shown for CLEAN
          worktrees too — dirtiness is evidence of work, presence is evidence
          of location, and this asks about location.

          Labelled "on this machine", because that is the whole caveat: the
          path is true here and meaningless anywhere else. A card with no
          worktrees renders nothing at all rather than an empty section. */}
      {card.worktrees && card.worktrees.length > 0 && (
        <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Checked out on this machine
          </p>
          <ul className="space-y-1">
            {card.worktrees.map((wt) => (
              <li key={wt.branch} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400">
                  {wt.branch}
                </span>
                {/* Selectable, because the next thing anyone does with it is
                    `cd`. A text input rather than a copy button: it works
                    without the clipboard permission, in an insecure context,
                    and it shows the value it would copy. */}
                <input
                  readOnly
                  value={wt.path}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Worktree path for ${wt.branch}`}
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </DocModal>
  );
}

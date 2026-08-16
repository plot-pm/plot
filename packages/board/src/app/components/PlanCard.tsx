import type { MouseEvent } from 'react';
import type { Card, Phase } from '../../contract/schema.js';
import { Badge, typeVariant } from './ui/badge.js';
import { cn } from '../lib/utils.js';
import { planHref } from '../lib/plan.js';

// Colour only ever REPEATS what the column header already says in symbol and
// word — it must not be the sole carrier of the human/agent distinction.
const PHASE_ACCENT: Record<Phase, string> = {
  Discovery: 'border-l-sky-400',
  Design: 'border-l-slate-400',
  Development: 'border-l-green-500',
  Endgame: 'border-l-violet-500',
  Released: 'border-l-orange-500',
};

export interface PlanCardProps {
  card: Card;
  /** Show the sprint badge (suppressed when a sprint filter is active). */
  showSprint: boolean;
  /** Show the story badge (suppressed when a story filter is active). */
  showStory: boolean;
  /** Open the plan in the in-board modal (plain left-click only). */
  onOpen: (card: Card) => void;
  /**
   * Jump to this card's story swimlane. Absent where there is nowhere to jump —
   * the board layout has no lanes — and the story badge stays plain text rather
   * than becoming a link that goes nowhere.
   */
  onGoToStory?: (story: string) => void;
}

export function PlanCard({ card, showSprint, showStory, onOpen, onGoToStory }: PlanCardProps) {
  const href = planHref(card);

  // The Open control is a real anchor so cmd/ctrl/shift/middle-click open the
  // plan page natively (new tab, etc.). Only a plain primary click is
  // intercepted for the in-board modal — never preventDefault a modified click.
  const handleOpen = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(card);
  };

  return (
    <article
      className={cn(
        'rounded-md border border-l-4 bg-white p-3 shadow-sm',
        'border-slate-200 dark:border-slate-700 dark:bg-slate-900',
        PHASE_ACCENT[card.phase],
      )}
    >
      <div className="text-sm font-medium leading-snug text-slate-900 dark:text-slate-100">
        {card.title}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant={typeVariant(card.type)}>{card.type}</Badge>
        {/* Ready/In-progress used to be a badge because Approved was one
            column. The distinction is now the column itself — a card in
            Development IS started — so only the waiting half still needs
            saying, and only where it is not already obvious. */}
        {card.phase === 'Design' && card.started === false && (
          <Badge variant="neutral">Ready</Badge>
        )}
        {showSprint && card.sprint && <Badge variant="sprint">{card.sprint}</Badge>}
        {showStory && card.story && (
          // A real anchor to the lane's fragment, so cmd/ctrl/middle-click and
          // "copy link address" behave. The plain click is intercepted only to
          // switch the board into lane layout first — a fragment cannot scroll
          // to a row that is not rendered yet.
          onGoToStory ? (
            <a
              href={`#story-${encodeURIComponent(card.story)}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onGoToStory(card.story!);
              }}
              className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              title={`Go to the ${card.story} swimlane`}
            >
              <Badge variant="story" className="hover:underline">{card.story}</Badge>
            </a>
          ) : (
            <Badge variant="story">{card.story}</Badge>
          )
        )}
        {/* Optional is not the same as invisible. Rendering nothing for a plan
            with no story makes "belongs to none" indistinguishable from "the
            badge is switched off" — an absence that reads as a non-answer.
            Neutral, not a warning colour: naming no story is a legitimate
            choice, and colouring it like a defect would re-create the
            obligation a story lint was deliberately dropped to avoid. */}
        {showStory && !card.story && <Badge variant="neutral">no story</Badge>}
        {card.waveSummary && card.waveSummary.branches > 0 && (
          // Answers the question a tile is actually asked: how much work is
          // left, and is anyone on it? Deferred branches are excluded from the
          // count — they are not outstanding.
          <Badge variant="neutral">
            {card.waveSummary.waves} waves · {card.waveSummary.branches} branches
            {card.waveSummary.claimed > 0 && ` · ${card.waveSummary.claimed} claimed`}
          </Badge>
        )}
      </div>
      <div className="mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">{card.path}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={href}
          onClick={handleOpen}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Open
        </a>
        {/* A PR the board has no URL for stays plain text. The host adapter is
            the only thing that knows what a PR address looks like; guessing one
            here would render a confident link that is wrong on GitHub
            Enterprise and on every self-hosted Bitbucket. */}
        {card.prs.map((pr) =>
          pr.url ? (
            <a
              key={pr.number}
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              #{pr.number}
            </a>
          ) : (
            <span
              key={pr.number}
              className="text-xs text-slate-400 dark:text-slate-500"
              title="No link — the host has not reported a URL for this PR"
            >
              #{pr.number}
            </span>
          ),
        )}
        {card.assignee && (
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            @{card.assignee}
          </span>
        )}
      </div>
    </article>
  );
}

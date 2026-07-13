import type { Card, Phase } from '../../contract/schema.js';
import { Badge, typeVariant } from './ui/badge.js';
import { cn } from '../lib/utils.js';

const PHASE_ACCENT: Record<Phase, string> = {
  Draft: 'border-l-slate-400',
  Approved: 'border-l-green-500',
  Delivered: 'border-l-violet-500',
  Released: 'border-l-orange-500',
};

export interface PlanCardProps {
  card: Card;
  /** Show the sprint badge (suppressed when a sprint filter is active). */
  showSprint: boolean;
  /** Show the story badge (suppressed when a story filter is active). */
  showStory: boolean;
}

export function PlanCard({ card, showSprint, showStory }: PlanCardProps) {
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
        {showSprint && card.sprint && <Badge variant="sprint">{card.sprint}</Badge>}
        {showStory && card.story && <Badge variant="story">{card.story}</Badge>}
      </div>
      <div className="mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">{card.path}</div>
      {card.assignee && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">@{card.assignee}</div>
      )}
    </article>
  );
}

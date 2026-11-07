import type { Card as PlanCardData, DispatchInfo, StoryCard } from '../../contract/schema.js';
import { linkTargetOf, storyHref, type BoardLinks } from '../lib/plan.js';
import { presentCard, UNREADABLE_CARD, type PresentedAction } from '../lib/card-presentation.js';
import { Card, type LinkFor } from './Card.js';
import { AddPlanButton } from './AddPlanButton.js';

export interface StoryItemCardProps {
  story: StoryCard;
  /** Whether this board will start the idea agent — `Board.idea`; *Add plan* reads it. */
  idea: DispatchInfo;
  /** The board's lookups for the items the card names; absent leaves every related item as text. */
  links?: BoardLinks;
  /** Opens a story in the in-board overlay; the title calls it with this card's story. */
  onOpenStory: (story: StoryCard) => void;
  /** Opens a plan in the in-board overlay. Absent leaves a plan as text. */
  onOpenPlan?: (card: PlanCardData) => void;
  /** Opens a sprint in the in-board sprint view. Absent leaves a sprint as text. */
  onOpenSprint?: (sprintSlug: string) => void;
}

/**
 * A story's card on the Discovery board: its `facts`, worded by `presentCard`
 * for the `stories` board and rendered by the shared `<Card>`. This component
 * only wires *Add plan* to its control and each named item to its link.
 */
export const StoryItemCard = ({ story, idea, links, onOpenStory, onOpenPlan, onOpenSprint }: StoryItemCardProps) => {
  const href = storyHref(story) || '#';
  // A story the payload carries no facts for shows its title and says so.
  if (story.facts === undefined) {
    return (
      <article
        id={`story-${story.slug}`}
        data-card
        data-card-unreadable
        className="flex flex-col gap-1.5 rounded-xl border border-(--card-border) bg-(--card-surface) p-4 shadow-(--card-shadow)"
      >
        <a
          href={href}
          data-card-title
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onOpenStory(story);
          }}
          className="text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
        >
          {story.title || story.slug}
        </a>
        <span data-alert="unreadable-card" className="text-xs text-amber-700 dark:text-amber-400">{UNREADABLE_CARD}</span>
      </article>
    );
  }
  const sections = presentCard(story.facts, 'stories', { unavailable: { 'add-plan': idea.reason }, now: Date.now() });

  const lookups: BoardLinks = {
    ticketHref: (key) => links?.ticketHref(key),
    branchHref: (branch) => links?.branchHref(branch),
    storyOf: (slug) => (slug === story.slug ? story : links?.storyOf(slug)),
    planOf: (slug) => links?.planOf(slug),
  };

  /** Each item the card names, linked by `linkTargetOf`; a board view opens only where its handler exists. */
  const linkFor: LinkFor = (ref, aspect = 'item') => {
    const target = linkTargetOf(ref, aspect, [], lookups);
    if (target === null) return null;
    const { opens } = target;
    if (opens === null) return { href: target.href, external: true };
    if (opens.kind === 'story') return { href: target.href, onOpen: () => onOpenStory(opens.story) };
    if (opens.kind === 'plan') return onOpenPlan ? { href: target.href, onOpen: () => onOpenPlan(opens.card) } : null;
    return onOpenSprint ? { href: target.href, onOpen: () => onOpenSprint(opens.slug) } : null;
  };

  const renderAction = (action: PresentedAction) =>
    action.action === 'add-plan' ? <AddPlanButton slug={story.slug} idea={idea} /> : null;

  return (
    <Card
      id={`story-${story.slug}`}
      sections={sections}
      titleHref={href}
      onOpenTitle={() => onOpenStory(story)}
      linkFor={linkFor}
      renderAction={renderAction}
    />
  );
};

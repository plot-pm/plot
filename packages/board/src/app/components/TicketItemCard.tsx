import { ticketCardIssueRow } from '@plot-pm/domain';
import type { Card as PlanCardData, DispatchInfo, IssueAnswer, StoryCard, TicketLaneRow } from '../../contract/schema.js';
import { linkTargetOf, type BoardLinks } from '../lib/plan.js';
import { presentCard, UNREADABLE_CARD, type CardSections, type PresentedAction } from '../lib/card-presentation.js';
import { Card, type LinkFor } from './Card.js';
import { CreatePlanButton } from './CreatePlanButton.js';
import { CreateStoryButton } from './CreateStoryButton.js';
import type { ReactNode } from 'react';

/** What a ticket's card and its modal both read. */
export interface TicketControls {
  /** Whether this board will start the idea agent — `Board.idea`; *Create plan* reads it. */
  idea: DispatchInfo;
  /** Whether this board will start the story agent; *Create story* reads it. */
  story: DispatchInfo;
  /** Whether the tracker can be asked at all — `Board.issueAnswer`. */
  issueAnswer: IssueAnswer | null;
  /** The board's lookups for the items the card names; absent leaves every related item as text. */
  links?: BoardLinks;
  /** Opens a story in the in-board overlay. */
  onOpenStory: (story: StoryCard) => void;
  /** Opens a plan in the in-board overlay. Absent leaves a plan as text. */
  onOpenPlan?: (card: PlanCardData) => void;
  /** Opens a sprint in the in-board sprint view. Absent leaves a sprint as text. */
  onOpenSprint?: (sprintSlug: string) => void;
}

/**
 * The card's sections for one ticket, worded by `presentCard` for the `tickets`
 * board.
 *
 * @param ticket - the ticket row; its `facts` must be present.
 * @param controls - what the board runs.
 * @param now - epoch milliseconds the age is measured from.
 * @returns the sections `<Card>` renders.
 */
export const ticketSections = (ticket: TicketLaneRow, controls: Pick<TicketControls, 'idea' | 'story'>, now: number): CardSections =>
  presentCard(ticket.facts!, 'tickets', {
    unavailable: { 'create-plan': controls.idea.reason, 'create-story': controls.story.reason },
    now,
  });

/**
 * Where each item a ticket names links, by `linkTargetOf`; a board view opens
 * only where its handler exists.
 *
 * @param controls - the board's lookups and open handlers.
 * @returns the lookup `<Card>` takes.
 */
export const ticketLinkFor = (controls: TicketControls): LinkFor => (ref, aspect = 'item') => {
  const target = linkTargetOf(ref, aspect, [], controls.links ?? {
    ticketHref: () => undefined, branchHref: () => undefined, storyOf: () => undefined, planOf: () => undefined,
  });
  if (target === null) return null;
  const { opens } = target;
  if (opens === null) return { href: target.href, external: true };
  if (opens.kind === 'story') return { href: target.href, onOpen: () => controls.onOpenStory(opens.story) };
  if (opens.kind === 'plan') return controls.onOpenPlan ? { href: target.href, onOpen: () => controls.onOpenPlan!(opens.card) } : null;
  return controls.onOpenSprint ? { href: target.href, onOpen: () => controls.onOpenSprint!(opens.slug) } : null;
};

/**
 * The control for an enabled ticket action: *Create plan* and *Create story*
 * through their buttons, anything else left off.
 *
 * @param ticket - the ticket row.
 * @param controls - what the board runs.
 * @returns the control, or `null`.
 */
export const ticketAction = (ticket: TicketLaneRow, controls: TicketControls) => (action: PresentedAction): ReactNode => {
  const issue = ticketCardIssueRow(ticket);
  if (action.action === 'create-plan') return <CreatePlanButton issue={issue} idea={controls.idea} issueAnswer={controls.issueAnswer} />;
  if (action.action === 'create-story') return <CreateStoryButton issue={issue} story={controls.story} issueAnswer={controls.issueAnswer} />;
  return null;
};

export interface TicketItemCardProps extends TicketControls {
  ticket: TicketLaneRow;
  /** Opens the ticket's modal; the title calls it. */
  onOpenTicket: (ticket: TicketLaneRow) => void;
}

/**
 * A ticket's card on the Discovery board: its `facts`, worded by `presentCard`
 * for the `tickets` board and rendered by the shared `<Card>`. The title is the
 * card's only open link.
 */
export const TicketItemCard = ({ ticket, onOpenTicket, ...controls }: TicketItemCardProps) => {
  const id = `ticket-${ticket.id}`;
  // A ticket the payload carries no facts for shows its title and says so.
  if (ticket.facts === undefined) {
    return (
      <article
        id={id}
        data-card
        data-card-unreadable
        className="flex flex-col gap-1.5 rounded-xl border border-(--card-border) bg-(--card-surface) p-4 shadow-(--card-shadow)"
      >
        <a
          href={ticket.url}
          target="_blank"
          rel="noreferrer"
          data-card-title
          className="text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
        >
          {ticket.title || ticket.id}
        </a>
        <span data-alert="unreadable-card" className="text-xs text-amber-700 dark:text-amber-400">{UNREADABLE_CARD}</span>
      </article>
    );
  }
  return (
    <Card
      id={id}
      sections={ticketSections(ticket, controls, Date.now())}
      titleHref={ticket.url}
      onOpenTitle={() => onOpenTicket(ticket)}
      linkFor={ticketLinkFor(controls)}
      renderAction={ticketAction(ticket, controls)}
    />
  );
};

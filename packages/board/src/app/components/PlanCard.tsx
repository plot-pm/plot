import type { Card as PlanCardData, DispatchInfo, StoryCard } from '../../contract/schema.js';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import { checksVerdict, planRoute } from '@plot-pm/domain';
import { storyHref } from '../lib/plan.js';
import { presentCard, type CardBoard, type PresentedAction } from '../lib/card-presentation.js';
import { Card, type RefLink } from './Card.js';
import { StartWorkButton } from './StartWorkButton.js';
import { ApproveButton } from './ApproveButton.js';
import { InterrogateButton } from './InterrogateButton.js';
import { DeliverButton } from './DeliverButton.js';

type Card = PlanCardData;

// Colour only ever REPEATS what the column header already says in symbol and
// word — it must not be the sole carrier of the human/agent distinction.
const PHASE_ACCENT: Record<string, string> = {
  neutral: 'border-l-slate-300',
  Discovery: 'border-l-sky-400',
  Design: 'border-l-slate-400',
  Development: 'border-l-green-500',
  Testing: 'border-l-violet-500',
  Released: 'border-l-orange-500',
};

/**
 * Approved, started or not. `plot-dispatch.sh` hard-gates on phase `approved`
 * and refuses every other one — Draft exits 1 with "Review it, then:
 * /plot-approve" — so a control keyed on anything narrower would sit on plans
 * where it could only fail, or hide from approved-but-unstarted plans, which is
 * the first-dispatch case the button is most for.
 *
 * Reads `controls.dispatch`, which the server decides from the plan's status
 * (`approved` or `in-progress`). Kept as a named predicate: the dispatch gate it
 * mirrors lives in a shell script that cannot import it.
 */
export function isApproved(card: Card): boolean {
  return card.controls.dispatch;
}

/**
 * A plan still under review — the one state `/plot-approve` acts on.
 *
 * Reads `controls.approve`, which the server decides from the plan's state:
 * `draft` and `design` both qualify. The card makes no column-name judgment.
 *
 * Note what this deliberately does NOT check: whether the plan PR is ready,
 * whether one exists, what review channel the plan declared. Every one of those
 * is a precondition of `/plot-approve`, and copying any of them here would put
 * the same rule in two places — the failure mode the skill-shaped indirection
 * exists to prevent. The command refuses in its own words; the card shows them.
 *
 * Exported for test: "only Draft cards, and every Draft card" is the assertion
 * the plan names twice, and both halves are this one expression.
 */
export function isDraft(card: Card): boolean {
  return card.controls.approve;
}

/**
 * The interrogation badge's text, or "" when there is nothing to say.
 *
 * **Draft and Design.** Past Design the count is history: approval settled
 * the question it measures. Reads `controls.roundsBadge`, which the server decides
 * from the plan's state: `draft` and `design` qualify.
 *
 * **Absent and 0 are two statements, and both render.** `undefined` means no
 * interrogation is recorded, and the badge says `not interrogated`; a recorded
 * 0 says `0 rounds` — the plan went through the skill and it found nothing. The
 * check is on `undefined` itself: `?? 0` would erase the distinction the
 * contract keeps the field optional to carry (`schema.ts`, `rounds`).
 * {@link roundsRecorded} tells the two apart for styling.
 */
export function roundsBadgeText(card: Card): string {
  if (!card.controls.roundsBadge) return '';
  if (card.rounds === undefined) return 'not interrogated';
  return card.rounds === 1 ? '1 round' : `${card.rounds} rounds`;
}

/** Whether the plan records a `Rounds:` value at all, 0 included. */
export const roundsRecorded = (card: Card): boolean => card.rounds !== undefined;

/**
 * The badge's classes: a recorded count takes the filled neutral badge, and an
 * absent one an outlined, italic badge, so the two never read alike.
 */
export const roundsBadgeClass = (card: Card): string =>
  roundsRecorded(card)
    ? ''
    : 'border border-dashed border-slate-400 bg-transparent italic text-slate-600 dark:border-slate-500 dark:bg-transparent dark:text-slate-300';

export interface PlanCardProps {
  card: Card;
  /** The column's `accent`: a default phase's name, or `'neutral'`. */
  accent?: string;
  /** Show the sprint badge (suppressed when a sprint filter is active). */
  showSprint: boolean;
  /** Show the story badge (suppressed when a story filter is active). */
  showStory: boolean;
  /**
   * Whether this server will act on Start work, and why not. Absent where the
   * board has not said — the button then does not render at all, rather than
   * offering a control whose outcome is unknown.
   */
  dispatch?: DispatchInfo;
  /**
   * Whether this server will act on Approve, and why not. Its own field rather
   * than a reading of `dispatch`: a board on localhost in a project that has
   * declared no `Approve command` can start work and cannot approve, and one
   * flag could not say that. Absent where the board has not said — the button
   * then does not render at all.
   */
  approve?: DispatchInfo;
  /**
   * Whether this server will act on Interrogate, and why not. Absent where the
   * board has not said — the button then does not render.
   */
  interrogate?: DispatchInfo;
  /** Whether this server will act on Deliver, and why not. Absent leaves Deliver off. */
  deliver?: DispatchInfo;
  /** The board the card renders on; it decides only which row is emphasised. */
  board?: CardBoard;
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
  /** Open the plan in the in-board modal (plain left-click only). */
  onOpen: (card: Card) => void;
  /**
   * The story card for `card.story`, when the board collected one. Absent for a
   * plan with no story and for one naming a story nobody has written — the
   * story then stays plain text, never a link that 404s.
   */
  story?: StoryCard;
  /** Open the story in the in-board overlay (plain left-click only). */
  onOpenStory?: (story: StoryCard) => void;
  /**
   * Mark this card as the one just arrived at — a ring, and the anchor the
   * board scrolls to. Transient: it says *here you are*, not *this is selected*,
   * so it clears on the next interaction rather than persisting as a filter.
   */
  highlighted?: boolean;
}

/**
 * A plan's card on the planning board and in swimlanes: its `facts`, worded by
 * `presentCard` and rendered by the shared `<Card>`. This component only wires
 * each enabled action to the control that runs it, and each named item to its
 * link.
 */
export function PlanCard({
  card,
  accent = 'neutral',
  showSprint,
  showStory,
  dispatch,
  approve,
  interrogate,
  deliver,
  board = 'plans',
  pulse = 0,
  onStarting,
  onOpen,
  story,
  onOpenStory,
  highlighted = false,
}: PlanCardProps) {
  const hide = [...(showStory ? [] : ['stories' as const]), ...(showSprint ? [] : ['sprints' as const])];
  const rows = presentCard(card.facts, board, { hide });
  const storyPage = story ? storyHref(story) : '';

  const linkFor = (ref: Ref): RefLink | null => {
    if (ref.kind === 'story' && story && storyPage && onOpenStory && ref.slug === story.slug) {
      return { href: storyPage, onOpen: () => onOpenStory(story), title: `Open the ${ref.slug} story` };
    }
    if (ref.kind === 'slice' && ref.pr !== null) {
      // The host adapter is the only thing that knows a PR's address; no URL, no link.
      const pr = card.prs.find((one) => one.number === ref.pr);
      if (!pr?.url) return null;
      // The hover keeps the build's whole sentence (the commit it ran against,
      // a skipped lookup), from the same domain rule the rows read.
      const { detail } = checksVerdict({
        checks: pr.checks, mergeable: pr.mergeable, checksSha: pr.checksSha, checksLookup: pr.checksLookup,
      });
      return { href: pr.url, external: true, title: detail };
    }
    return null;
  };

  const renderAction = (action: PresentedAction) => {
    switch (action.action) {
      case 'start-work':
        return dispatch ? <StartWorkButton card={card} dispatch={dispatch} pulse={pulse} onStarting={onStarting} /> : null;
      case 'approve':
      case 'confirm-slices':
        return approve
          ? <ApproveButton card={card} approve={approve} onApproving={onStarting} confirm={action.action === 'confirm-slices'} />
          : null;
      case 'approve-spike':
        return approve ? <ApproveButton card={card} approve={approve} onApproving={onStarting} spike /> : null;
      case 'interrogate':
        return interrogate
          ? <InterrogateButton card={card} interrogate={interrogate} pulse={pulse} onActing={onStarting} />
          : null;
      case 'deliver':
        return deliver ? <DeliverButton slug={card.slug} deliver={deliver} onActing={onStarting} /> : null;
      default:
        return null;
    }
  };

  return (
    <Card
      // What `?plan=<slug>` scrolls to.
      id={`plan-${card.slug}`}
      rows={rows}
      titleHref={planRoute(card.path)}
      onOpenTitle={() => onOpen(card)}
      linkFor={linkFor}
      renderAction={renderAction}
      className={PHASE_ACCENT[accent] ?? PHASE_ACCENT.neutral}
      highlighted={highlighted}
    />
  );
}

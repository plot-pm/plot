import type { MouseEvent } from 'react';
import type { Card, DispatchInfo, Phase, StoryCard } from '../../contract/schema.js';
import { Badge, typeVariant } from './ui/badge.js';
import { cn } from '../lib/utils.js';
import { planHref, storyHref } from '../lib/plan.js';
import { StartWorkButton } from './StartWorkButton.js';

// Colour only ever REPEATS what the column header already says in symbol and
// word — it must not be the sole carrier of the human/agent distinction.
const PHASE_ACCENT: Record<Phase, string> = {
  Discovery: 'border-l-sky-400',
  Design: 'border-l-slate-400',
  Development: 'border-l-green-500',
  Endgame: 'border-l-violet-500',
  Released: 'border-l-orange-500',
};

/**
 * Approved, and nobody has started it — the exact state `plot-dispatch.sh`
 * requires and the exact state the **Ready** badge already described. The board
 * splits `approved` across two columns (Design without a Started record,
 * Development with one), so neither column alone answers "is this plan
 * approved"; `started === false` in Design does, and the card was already
 * computing it.
 *
 * Exported so the badge and the Start work button are the SAME expression and
 * cannot drift into disagreeing about what Ready means.
 */
export function isReadyToStart(card: Card): boolean {
  return card.phase === 'Design' && card.started === false;
}

/**
 * Approved, in whichever column the card sits. `plot-dispatch.sh` hard-gates on
 * phase `approved` and refuses every other one — Draft exits 1 with "Review it,
 * then: /plot-approve" — so keying the button on a COLUMN would put it on plans
 * where it could only fail, and hide it from approved-but-unstarted plans,
 * which is the first-dispatch case the button is most for.
 */
export function isApproved(card: Card): boolean {
  return isReadyToStart(card) || (card.phase === 'Development' && card.started === true);
}

/**
 * The wave badge's text, or "" when there is nothing worth saying.
 *
 * Answers the question a tile is actually asked — how much work is left, and is
 * anyone on it? — from two halves with different rules:
 *
 * **Shape** (`N waves · M branches`) only where shape says something. "1 waves ·
 * 1 branches" is noise, so it is kept to multi-wave plans. Deferred branches are
 * already excluded upstream: they are not outstanding.
 *
 * **Occupancy** (`claimed`, `ready`) renders for every plan that has it,
 * single-wave included — that question is worth answering whether a plan has one
 * branch or nine.
 *
 * Both occupancy counts are optional, and **absent means unknown, never zero**.
 * A board whose git scan has not landed omits them rather than asserting that
 * nothing is claimed — the two must not render alike, since that
 * indistinguishability is the defect this whole change exists to remove. `> 0`
 * excludes `undefined` along with 0, so a card says nothing rather than
 * something it cannot support.
 *
 * Exported for test: this is display logic with real edge cases (a single-wave
 * plan with nothing claimed has nothing to show at all), and an empty badge on
 * screen is exactly the kind of thing prose promises and code forgets.
 */
export function waveBadgeText(s: NonNullable<Card['waveSummary']>): string {
  const parts: string[] = [];
  if (s.waves > 1) parts.push(`${s.waves} waves · ${s.branches} branches`);
  if ((s.claimed ?? 0) > 0) parts.push(`${s.claimed} claimed`);
  if ((s.eligible ?? 0) > 0) parts.push(`${s.eligible} ready`);
  return parts.join(' · ');
}

export interface PlanCardProps {
  card: Card;
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
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
  /** Open the plan in the in-board modal (plain left-click only). */
  onOpen: (card: Card) => void;
  /**
   * Jump to this card's story swimlane. Absent where there is nowhere to jump —
   * the board layout has no lanes — and the story badge stays plain text rather
   * than becoming a link that goes nowhere.
   */
  onGoToStory?: (story: string) => void;
  /**
   * The story card for `card.story`, when the board collected one. Absent for a
   * plan with no story and for one naming a story nobody has written — the
   * badge then stays plain text (or a lane jump), never a link that 404s.
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

export function PlanCard({
  card,
  showSprint,
  showStory,
  dispatch,
  pulse = 0,
  onStarting,
  onOpen,
  onGoToStory,
  story,
  onOpenStory,
  highlighted = false,
}: PlanCardProps) {
  const href = planHref(card);
  // The story's own page, or "" — a story with no file gets no link, the same
  // rule plan rows follow for `planFile: ''`.
  const storyPage = story ? storyHref(story) : '';

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
      // What `?plan=<slug>` scrolls to. `scroll-mt` keeps the card clear of the
      // header when it lands.
      id={`plan-${card.slug}`}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'scroll-mt-20 rounded-md border border-l-4 bg-white p-3 shadow-sm',
        'border-slate-200 dark:border-slate-700 dark:bg-slate-900',
        PHASE_ACCENT[card.phase],
        // A ring rather than a background: the left border already carries the
        // phase, and a second colour fill would compete with it.
        highlighted && 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950',
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
        {isReadyToStart(card) && <Badge variant="neutral">Ready</Badge>}
        {showSprint && card.sprint && <Badge variant="sprint">{card.sprint}</Badge>}
        {showStory && card.story && (
          // Three renderings, in order of how much the badge can offer.
          //
          // The badge NAMES the story on the card, at triage time — which is a
          // different question from the modal's `Open story` button, where you
          // GO once you have stopped triaging. Both exist deliberately; this is
          // the naming half, and it links to the story ARTEFACT because that is
          // what the name refers to.
          //
          // A real anchor throughout, so cmd/ctrl/middle-click and "copy link
          // address" behave; only the plain click is intercepted.
          storyPage && onOpenStory && story ? (
            <a
              href={storyPage}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onOpenStory(story);
              }}
              className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              title={`Open the ${card.story} story`}
            >
              <Badge variant="story" className="hover:underline">{card.story}</Badge>
            </a>
          ) : onGoToStory ? (
            // No story FILE to open — a typo, or a story nobody has written
            // yet. The lane jump is still true and still useful, so the badge
            // keeps it rather than going inert.
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
        {card.waveSummary && card.waveSummary.branches > 0 && waveBadgeText(card.waveSummary) && (
          <Badge variant="neutral">{waveBadgeText(card.waveSummary)}</Badge>
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
        {/* The button sits on the PLAN card, not on an agent row, and that is
            not cosmetic: plot-dispatch.sh takes a SLUG, then asks
            plot-fleet-scan.sh --next which branch is eligible. A button on a
            branch row would promise "start this one" and deliver "start
            whichever is next" — a lie the layout would tell on the board's
            behalf. */}
        {dispatch && isApproved(card) && (
          <StartWorkButton
            card={card}
            dispatch={dispatch}
            pulse={pulse}
            onStarting={onStarting}
          />
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

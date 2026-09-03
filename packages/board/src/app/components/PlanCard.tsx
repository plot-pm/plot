import type { MouseEvent } from 'react';
import type { Card, DispatchInfo, Phase, StoryCard } from '../../contract/schema.js';
import { Badge, typeVariant } from './ui/badge.js';
import { cn } from '../lib/utils.js';
import { planHref, storyHref } from '../lib/plan.js';
import { StartWorkButton } from './StartWorkButton.js';
import { ApproveButton } from './ApproveButton.js';

// Colour only ever REPEATS what the column header already says in symbol and
// word — it must not be the sole carrier of the human/agent distinction.
const PHASE_ACCENT: Record<Phase, string> = {
  Discovery: 'border-l-sky-400',
  Design: 'border-l-slate-400',
  Development: 'border-l-green-500',
  Testing: 'border-l-violet-500',
  Released: 'border-l-orange-500',
};

/**
 * Approved, and nobody has started it — the exact state `plot-dispatch.sh`
 * requires and the exact state the **Ready** badge already described.
 *
 * **The column is now `Development`, not `Design`.** This predicate read
 * `phase === 'Design'` while the board manufactured its Design column by
 * forking `approved` on `started`; once `toBoardPhase` maps approved to
 * Development *whether or not* a branch has started, an approved-unstarted plan
 * is a Development card and this expression found nothing. Measured: the
 * `Start work` button vanished from every plan that could be started, and nine
 * browser tests timed out looking for a control that was no longer rendered.
 *
 * `started === false` still carries the whole distinction — it is the half that
 * was always doing the work, and it is now the only half, since the column no
 * longer varies with it.
 *
 * Exported so the badge and the Start work button are the SAME expression and
 * cannot drift into disagreeing about what Ready means.
 */
export function isReadyToStart(card: Card): boolean {
  return card.phase === 'Development' && card.started === false;
}

/**
 * Approved, started or not. `plot-dispatch.sh` hard-gates on phase `approved`
 * and refuses every other one — Draft exits 1 with "Review it, then:
 * /plot-approve" — so a control keyed on anything narrower would sit on plans
 * where it could only fail, or hide from approved-but-unstarted plans, which is
 * the first-dispatch case the button is most for.
 *
 * **This is now exactly `phase === 'Development'`**, and it is written that way
 * rather than as the two-branch union it used to be. While Design and
 * Development split `approved` on `started`, the union named two real cases;
 * once approved maps to Development regardless, the same union reads
 * `(Development && !started) || (Development && started)` — a tautology whose
 * shape suggests a distinction the board no longer draws.
 *
 * Kept as a named predicate rather than inlined: it is the one place that says
 * *which board column means approved*, and the dispatch gate it mirrors lives
 * in a shell script that cannot import it.
 */
export function isApproved(card: Card): boolean {
  return card.phase === 'Development';
}

/**
 * A plan still under review — the one state `/plot-approve` acts on.
 *
 * `Discovery` IS Draft on this board: the mapping is one-to-one and documented
 * in `toBoardPhase` (a plan under review is the investigation deciding whether
 * there is a commitment at all, and approval is where it ends). No other column
 * can hold a Draft plan, so the column is the honest test.
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
  return card.phase === 'Discovery';
}

/**
 * The slice badge's text, or "" when there is nothing worth saying.
 *
 * Answers the question a tile is actually asked — how much work is left, and is
 * anyone on it? — from two halves with different rules:
 *
 * **Shape** (`N waves · M branches`) only where shape says something. "1 slices ·
 * 1 branches" is noise, so it is kept to multi-slice plans. Deferred branches are
 * already excluded upstream: they are not outstanding.
 *
 * **Occupancy** (`claimed`, `ready`) renders for every plan that has it,
 * single-slice included — that question is worth answering whether a plan has one
 * branch or nine.
 *
 * Both occupancy counts are optional, and **absent means unknown, never zero**.
 * A board whose git scan has not landed omits them rather than asserting that
 * nothing is claimed — the two must not render alike, since that
 * indistinguishability is the defect this whole change exists to remove. `> 0`
 * excludes `undefined` along with 0, so a card says nothing rather than
 * something it cannot support.
 *
 * Exported for test: this is display logic with real edge cases (a single-slice
 * plan with nothing claimed has nothing to show at all), and an empty badge on
 * screen is exactly the kind of thing prose promises and code forgets.
 */
export function sliceBadgeText(s: NonNullable<Card['sliceSummary']>): string {
  const parts: string[] = [];
  if (s.slices > 1) parts.push(`${s.slices} slices · ${s.branches} branches`);
  if ((s.claimed ?? 0) > 0) parts.push(`${s.claimed} claimed`);
  if ((s.eligible ?? 0) > 0) parts.push(`${s.eligible} ready`);
  return parts.join(' · ');
}

/**
 * The interrogation badge's text, or "" when there is nothing honest to say.
 *
 * Two conditions, and neither is decoration:
 *
 * **Draft only.** Past Discovery the count is history — the design question it
 * answers has been settled by approval, and a number nobody acts on is exactly
 * the crowding this board keeps removing. `isDraft` is reused rather than
 * re-tested so the badge and the Approve button cannot drift about what Draft
 * means.
 *
 * **Absent shows nothing.** `undefined` means no interrogation is recorded, and
 * it must never render as `0 rounds` — that would read as *interrogated and
 * found nothing*, the opposite claim. `?? 0` would erase precisely the
 * distinction the contract carries the field as optional to preserve, so the
 * check is on `undefined` itself.
 *
 * A recorded 0 still renders, and that is the same rule from the other side: the
 * block exists, so the plan HAS been through the skill, and saying so is true.
 *
 * Exported for test — "only Draft cards, and no badge where nothing is known"
 * are the two assertions the plan names, and both are this one expression.
 */
export function roundsBadgeText(card: Card): string {
  if (!isDraft(card)) return '';
  if (card.rounds === undefined) return '';
  return card.rounds === 1 ? '1 round' : `${card.rounds} rounds`;
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
  /**
   * Whether this server will act on Approve, and why not. Its own field rather
   * than a reading of `dispatch`: a board on localhost in a project that has
   * declared no `Approve command` can start work and cannot approve, and one
   * flag could not say that. Absent where the board has not said — the button
   * then does not render at all.
   */
  approve?: DispatchInfo;
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse?: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting?: (active: boolean) => void;
  /** Open the plan in the in-board modal (plain left-click only). */
  onOpen: (card: Card) => void;
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
  approve,
  pulse = 0,
  onStarting,
  onOpen,
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
          // The badge NAMES the story on the card, at triage time — a different
          // question from the modal's `Open story` button, which is where you
          // GO once you have stopped triaging. Both exist deliberately; this is
          // the naming half, and it points at the story ARTEFACT, because that
          // is what the name refers to.
          //
          // A real anchor, so cmd/ctrl/middle-click and "copy link address"
          // behave; only the plain click is intercepted for the overlay.
          //
          // A story with no FILE renders no link at all — the rule plan rows
          // already follow for `planFile: ''`, and the reason the lane-jump
          // fallback that used to sit here is gone: a badge that is sometimes a
          // story and sometimes a scroll position teaches nothing, and the
          // swimlane view still reaches every lane on its own.
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
        {card.sliceSummary && card.sliceSummary.branches > 0 && sliceBadgeText(card.sliceSummary) && (
          <Badge variant="neutral">{sliceBadgeText(card.sliceSummary)}</Badge>
        )}
        {/* How hard this plan has been questioned — a Discovery-column answer to
            "has anyone pushed on this yet?", which is the one thing a reader of
            a Draft card cannot see without opening the file. No badge where the
            plan records no interrogation: silence, not a zero. */}
        {roundsBadgeText(card) && (
          <Badge variant="neutral">{roundsBadgeText(card)}</Badge>
        )}
        {/* This plan is in THIS checkout and on no ref the board can read — it
            was written here and not yet pushed.

            Every other card on this board is a statement about what everyone
            can see, because the estate is read from `origin/<default>`. This
            one is not, and the marker is the difference stated rather than
            hidden: without it a local file would wear the authority of a shared
            one, which is the defect the ref read exists to end. The card is
            SHOWN rather than dropped because a plan is otherwise invisible for
            the minutes between writing and pushing — five were, in one session
            on 2026-08-27.

            Neutral, not a warning colour, and for the same reason `no story` is:
            an unpushed plan is a normal moment in authoring a plan, not a fault
            to be scolded for. The `title` carries the consequence, since the
            two words alone do not say who cannot see it. */}
        {card.notPushed && (
          <Badge
            variant="neutral"
            title="This plan is in the board's working tree but not on the ref it reads — nobody else can see it yet"
          >
            not pushed
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
        {/* Draft ONLY, and EVERY Draft.

            Only: an approved plan has nothing to approve, and offering it would
            invite a second approval whose one effect is a confusing error.
            `isDraft` is the whole rule — the board holds no other precondition,
            and that is deliberate.

            Every: including plans whose PR is not yet marked ready, a state
            that occurred repeatedly in one evening. Hiding the button there
            would mean the board knew Approve's preconditions and had to keep
            them in step with the skill — the same rule in two places, which is
            precisely what running through the skill exists to avoid. The
            command refuses in its own words instead, and the card shows them. */}
        {approve && isDraft(card) && (
          <ApproveButton card={card} approve={approve} onApproving={onStarting} />
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

import { useState } from 'react';
import type { Board, Card, Phase, StoryCard } from '../../contract/schema.js';
import { PHASE_LEADERSHIP } from '../../contract/schema.js';
import { NO_SPRINT, NO_STORY, passesFilter } from '../lib/filters.js';
import { PlanCard } from './PlanCard.js';

/**
 * How many cards a column shows before it offers the rest behind a control.
 *
 * MEASURED, not chosen. Against the live board at three viewports (1440×900,
 * 1728×1117, 1920×1080), a plan card renders 161–226px tall — median 176 — and
 * the columns begin 110px down. So the number of cards fully visible without
 * scrolling is 4 on a 900px laptop and 5 on a 1080p display, at every width
 * measured; six overruns the fold on all three. Five is therefore the largest
 * number that costs nothing on the common desktop, and the page it produces is
 * roughly one viewport rather than the 1.8–2.2 it is today.
 *
 * ONE number for every column, with no exception for `Released`. It holds
 * thirteen today and `Endgame` ten, and a rule with a hard-coded exception is a
 * rule someone has to remember — the exception would have to be removed the
 * week `Endgame` overtook it.
 */
export const COLUMN_LIMIT = 5;

/**
 * How recent a card is, for ordering — its phase date as a comparable number,
 * or `-Infinity` where it has none.
 *
 * Dateless cards sort LAST rather than first: "" means this plan records no
 * date for its phase, and an unknown date must never displace a known one out
 * of the visible set. That is the same rule `groupByPlan` follows for a null
 * age — *we do not know* is not *ancient*, and here it is not *newest* either.
 *
 * String comparison would do for `YYYY-MM-DD`, but only by accident of format;
 * this states the intent, and "" would sort before every real date under it.
 */
function recency(card: Card): number {
  if (!card.phaseDate) return -Infinity;
  const at = Date.parse(`${card.phaseDate}T00:00:00Z`);
  return Number.isNaN(at) ? -Infinity : at;
}

/** What a column renders: the visible cards, and how many it is holding back. */
export interface ColumnView {
  visible: Card[];
  /** Cards not shown. 0 when the column is under the limit or expanded. */
  hidden: number;
  /** The column's WHOLE size — what the header count must say. */
  total: number;
}

/**
 * A column's cards, most recent first, cut to `limit` — with the remainder
 * counted rather than dropped.
 *
 * **Sorted by the phase's own date**, which is what makes the cut honest: a
 * column claiming to show the latest five and showing five arbitrary ones is
 * worse than showing all thirteen, because the reader cannot tell. `phaseDate`
 * is picked per phase on the server, so `Released` sorts by release and
 * `Endgame` by delivery without this function knowing either record exists.
 *
 * **Stable within a day.** Plot records dates, not timestamps, so several cards
 * routinely share one — five plans were delivered on 2026-08-16. A comparator
 * returning 0 for those leaves `Array.prototype.sort` to its stability
 * guarantee, so same-day cards keep the order they arrived in rather than
 * shuffling between polls; the board re-renders every few seconds, and cards
 * swapping places under the cursor would be the more visible bug.
 *
 * **Sorting happens whether or not anything is hidden.** A column of three
 * still shows its newest first — the order is the column's own meaning, not a
 * side effect of being too long. Applying it only past the limit would make a
 * column reorder itself the moment a fourth card arrived.
 *
 * **A highlighted card is never hidden**, wherever it falls in the order. The
 * board scrolls to `#plan-<slug>` when a reader arrives via `?plan=` or the
 * modal's *Show in board*, and an element that was truncated away is not merely
 * unscrolled-to — `getElementById` returns null and the arrival silently lands
 * nowhere. That is reachable today: *Show in board* on a plan delivered in July
 * aims at a card the newest five would not include. It is kept in ADDITION to
 * the limit rather than in place of one of them, so following a link never
 * costs the reader a card they would otherwise have seen.
 *
 * `expanded` shows everything and reports 0 hidden; the caller keeps that state
 * so the control can toggle.
 */
export function truncateColumn(
  cards: Card[],
  {
    limit = COLUMN_LIMIT,
    expanded = false,
    highlight = '',
  }: { limit?: number; expanded?: boolean; highlight?: string } = {},
): ColumnView {
  const ordered = [...cards].sort((a, b) => recency(b) - recency(a));
  if (expanded || ordered.length <= limit) {
    return { visible: ordered, hidden: 0, total: ordered.length };
  }
  const visible = ordered.slice(0, limit);
  // Appended rather than swapped in: dropping the fifth card to make room would
  // mean following a link cost you a card, and the count below still reports
  // exactly what is not on screen either way.
  const pinned = highlight && ordered.some((c) => c.slug === highlight)
    && !visible.some((c) => c.slug === highlight)
    ? ordered.find((c) => c.slug === highlight)
    : undefined;
  if (pinned) visible.push(pinned);
  return {
    visible,
    hidden: ordered.length - visible.length,
    total: ordered.length,
  };
}

export interface BoardViewProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting: (active: boolean) => void;
  /** Open a plan in the in-board modal. */
  onOpenPlan: (card: Card) => void;
  /**
   * Open a story in the in-board overlay — what a card's story badge does.
   *
   * It replaced a jump to the story's swimlane row. The badge names an
   * ARTEFACT, and pointing that name at a scroll position taught a reader that
   * the same badge sometimes opened a document and sometimes moved the page.
   * The `Story lanes` toggle still reaches every lane.
   */
  onOpenStory?: (story: StoryCard) => void;
  /** Slug of the card just arrived at, or "" — see PlanCard's `highlighted`. */
  highlight?: string;
}

export function BoardView({
  board,
  sprintSel,
  storySel,
  pulse,
  onStarting,
  onOpenPlan,
  onOpenStory,
  highlight = '',
}: BoardViewProps) {
  const showSprint = sprintSel.length === 0;
  const showStory = storySel.length === 0;
  // Which columns the reader has opened up, by phase.
  //
  // Component state rather than the URL, and rather than localStorage. The
  // board's convention is that the query string holds what is worth SENDING to
  // someone — `?tab`, `?lanes`, `?plan` — and "I unfolded Released" is not; the
  // sibling collapse work makes the same argument for the Agents tab's groups.
  // Nor is it persisted: unlike a group a reader collapses to keep it out of
  // the way for the session, this is opened to answer one question, and the
  // truncated view is the one worth returning to.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (phase: Phase) =>
    setExpanded((prev) => ({ ...prev, [phase]: !prev[phase] }));
  // The board's own stories, by slug — so a card's badge is handed the story it
  // names rather than reconstructing a path from the slug.
  const storyBySlug = new Map(board.stories.map((s) => [s.slug, s]));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {board.columns.map((column) => {
        // Sprint and story filters intersect.
        const cards = column.cards.filter(
          (c) =>
            passesFilter(c, sprintSel, 'sprint', NO_SPRINT) &&
            passesFilter(c, storySel, 'story', NO_STORY),
        );
        // Truncation reads the FILTERED set, so a story filter that leaves four
        // cards shows all four. The limit is about how tall a column gets on
        // screen, and a filter has already made it shorter.
        const view = truncateColumn(cards, {
          expanded: expanded[column.phase],
          highlight,
        });
        return (
          <section
            key={column.phase}
            className="flex flex-col rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50"
          >
            <header className="mb-3 flex items-center justify-between gap-2">
              {/* Leadership rides on the symbol and the title text, never on
                  colour alone — the accent stripe only repeats it. */}
              <h2
                className="flex min-w-0 items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
                title={`${column.phase} — ${PHASE_LEADERSHIP[column.phase].who}`}
              >
                <span aria-hidden>{PHASE_LEADERSHIP[column.phase].icon}</span>
                <span className="truncate">{column.phase}</span>
              </h2>
              <span className="flex shrink-0 items-center gap-1">
                {/* What is left before signoff — the question the column asks. */}
                {column.phase === 'Endgame' && board.checklist && (
                  <span
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                    title="Release checklist"
                  >
                    ☑ {board.checklist.done}/{board.checklist.total}
                  </span>
                )}
                {/* The column's WHOLE size, never the number rendered below it.
                    `Released (13)` with five cards showing states plainly that
                    eight are hidden; five cards over a `5` reads as *there are
                    five*, which is the failure truncating must not introduce.
                    The count was already here — it simply must keep counting the
                    column rather than the visible slice. */}
                <span
                  className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  title={
                    view.hidden > 0
                      ? `${view.total} plans — ${view.hidden} hidden`
                      : `${view.total} plans`
                  }
                >
                  {view.total}
                </span>
              </span>
            </header>
            <div className="flex flex-col gap-3">
              {view.total > 0 ? (
                view.visible.map((card) => (
                  <PlanCard
                    key={card.path}
                    card={card}
                    showSprint={showSprint}
                    showStory={showStory}
                    dispatch={board.dispatch}
                    pulse={pulse}
                    onStarting={onStarting}
                    onOpen={onOpenPlan}
                    story={card.story ? storyBySlug.get(card.story) : undefined}
                    onOpenStory={onOpenStory}
                    highlighted={card.slug === highlight}
                  />
                ))
              ) : (
                <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                  No plans in this phase.
                </p>
              )}
              {/* The control for the rest — the half that makes this truncation
                  rather than a hard cut. It renders only where there IS a rest:
                  a column under the limit offers nothing, the same rule the
                  Agents tab's groups follow (a collapse control on a group with
                  nothing to hide is an offer that leads nowhere).

                  It says the NUMBER hidden, not "show more". `Show 8 older` is
                  a second statement of the same fact the header count implies,
                  and the one a reader deciding whether to click actually needs.
                  "older" rather than "more": the cut is by date, and the word is
                  what tells them the eight are the oldest rather than an
                  arbitrary remainder. */}
              {(view.hidden > 0 || expanded[column.phase]) && view.total > COLUMN_LIMIT && (
                <button
                  type="button"
                  onClick={() => toggle(column.phase)}
                  aria-expanded={view.hidden === 0}
                  className="rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200"
                >
                  {view.hidden > 0
                    ? `Show ${view.hidden} older`
                    : `Show the ${COLUMN_LIMIT} most recent`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import { useMemo, useState, type CSSProperties } from 'react';
import { planningColumns } from '@plot-pm/domain/rules/workflow-phases';
import type { Board, Card, StoryCard } from '../../contract/schema.js';
import { NO_STORY, passesFilter, passesSprintFilter, sprintMembershipLookup } from '../lib/filters.js';
import { boardLinksOf, checksUnaskableOn } from '../lib/plan.js';
import { COLUMN_STEP, pageColumn, showNext, type ColumnPage } from '../lib/column-page.js';
import { ColumnPager } from './ColumnPager.js';
import { PlanCard } from './PlanCard.js';
import { PlanSourceLine } from './PlanSourceLine.js';

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
 * thirteen today and `Testing` ten, and a rule with a hard-coded exception is a
 * rule someone has to remember — the exception would have to be removed the
 * week `Testing` overtook it.
 */
export const COLUMN_LIMIT = COLUMN_STEP;

/**
 * The `grid-template-columns` value of the board at the `xl` breakpoint: one
 * equal track per declared column, so the grid has no empty track and wraps no
 * column onto a second row.
 *
 * @param count - the number of columns the payload declares.
 * @returns a `repeat(count, minmax(0, 1fr))` track list.
 */
export const boardGridColumns = (count: number): string =>
  `repeat(${count}, minmax(0, 1fr))`;

/** What a column renders: the visible cards, and how many it is holding back. */
export type ColumnView = ColumnPage<Card>;

/**
 * A column's cards, most recent first, cut to `limit` — with the remainder
 * counted rather than dropped.
 *
 * Recency is the card's `phaseDate`, picked per phase on the server, so
 * `Released` sorts by release and `Testing` by delivery. Cards that share a
 * date keep the order they arrived in, so they do not swap places between
 * polls. A dateless card sorts last: *we do not know* is not *newest*. The
 * order holds whether or not anything is hidden.
 *
 * A highlighted card is never hidden, wherever it falls in the order: the board
 * scrolls to `#plan-<slug>` when a reader arrives via `?plan=` or *Show in
 * board*, and a truncated card is not in the DOM. It is kept in addition to the
 * limit, so following a link costs no other card.
 *
 * @param cards - the column's cards after the sprint and story filters.
 * @param options.limit - how many cards the reader asked for; defaults to {@link COLUMN_LIMIT}.
 * @param options.highlight - the slug of the card just arrived at, or "".
 * @returns the page, with what the [+] control adds next.
 */
export function truncateColumn(
  cards: Card[],
  { limit = COLUMN_LIMIT, highlight = '' }: { limit?: number; highlight?: string } = {},
): ColumnView {
  return pageColumn(cards, {
    shown: limit,
    dateOf: (card) => card.phaseDate,
    pinned: highlight ? (card) => card.slug === highlight : undefined,
  });
}

export interface BoardViewProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting: (active: boolean) => void;
  /** Open a plan by file in the in-board modal; `false` where the board holds no card for it. */
  onOpenPlan: (file: string) => boolean;
  /**
   * Open a story in the in-board overlay — what a card's story badge does.
   *
   * It replaced a jump to the story's swimlane row. The badge names an
   * ARTEFACT, and pointing that name at a scroll position taught a reader that
   * the same badge sometimes opened a document and sometimes moved the page.
   * The `Story lanes` toggle still reaches every lane.
   */
  onOpenStory?: (story: StoryCard) => void;
  /** Open a sprint in the in-board sprint view. */
  onOpenSprint?: (sprintSlug: string) => void;
  /** Slug of the card just arrived at, or "" — see PlanCard's `highlighted`. */
  highlight?: string;
  /** Whether the released-only columns are drawn; `?released=1`. */
  showReleased?: boolean;
  /**
   * How old the plan read is, in seconds, from `/api/board`'s own
   * `planRefAgeSeconds` — or null before any fetch has succeeded.
   *
   * The NUMBER rather than the fleet, deliberately: this view needs one fact to
   * date its provenance line, and taking the whole `Fleet` to reach it would
   * give the board tab a dependency on the agents' contract for no other
   * purpose. Null is omitted rather than shown as 0, which would claim a
   * freshness nothing measured.
   */
  planAgeSeconds?: number | null;
  /** Whether `/api/board` is unreachable — see `PlanSourceLine`'s `frozen`. */
  planSourceFrozen?: boolean;
}

export function BoardView({
  board,
  sprintSel,
  storySel,
  pulse,
  onStarting,
  onOpenPlan,
  onOpenStory,
  onOpenSprint,
  highlight = '',
  planAgeSeconds = null,
  planSourceFrozen = false,
  showReleased = false,
}: BoardViewProps) {
  // The grid sizes by the SHOWN columns, not the payload's.
  const columns = planningColumns(board.columns, showReleased);
  const showSprint = sprintSel.length === 0;
  const showStory = storySel.length === 0;
  // How many cards each column shows, by phase; a phase absent here shows
  // COLUMN_LIMIT. Component state rather than the URL: the query string holds
  // what is worth sending to someone, and a paged column is not.
  const [shown, setShown] = useState<Record<string, number>>({});
  const more = (phase: string) => setShown((prev) => ({ ...prev, [phase]: showNext(prev[phase]) }));
  const collapse = (phase: string) =>
    setShown((prev) => {
      const { [phase]: _dropped, ...rest } = prev;
      return rest;
    });
  // The board's own stories, by slug — so a card's badge is handed the story it
  // names rather than reconstructing a path from the slug.
  const storyBySlug = new Map(board.stories.map((s) => [s.slug, s]));
  const links = useMemo(() => boardLinksOf(board), [board]);

  // Sprint membership: which plans each sprint contains, by slug.
  //
  // Membership comes from the SPRINT FILE's `- [ ] [slug]` lines, not from
  // the plan's `Sprint:` back-reference field. The plan measured: 19 plans
  // in the sprint, only 5 carry the back-reference, 14 empty/placeholder.
  // Joining on card.sprint would show 5 of 19.
  const membership = useMemo(
    () => sprintMembershipLookup(board.sprints),
    [board.sprints],
  );

  return (
    <>
    {board.phaseMapRefusal && (
      <p
        role="alert"
        className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      >
        {board.phaseMapRefusal} — drawing the default phases.
      </p>
    )}
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-(--board-columns)"
      style={{ '--board-columns': boardGridColumns(columns.length) } as CSSProperties}
    >
      {columns.map((column) => {
        // Sprint and story filters intersect.
        const cards = column.cards.filter(
          (c) =>
            passesSprintFilter(c, sprintSel, membership) &&
            passesFilter(c, storySel, 'story', NO_STORY),
        );
        // Truncation reads the FILTERED set, so a story filter that leaves four
        // cards shows all four. The limit is about how tall a column gets on
        // screen, and a filter has already made it shorter.
        const view = truncateColumn(cards, {
          limit: shown[column.phase],
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
                title={column.leadership ? `${column.phase} — ${column.leadership.who}` : column.phase}
              >
                {column.leadership && <span aria-hidden>{column.leadership.icon}</span>}
                <span className="truncate">{column.phase}</span>
              </h2>
              <span className="flex shrink-0 items-center gap-1">
                {/* What is left before signoff — the question the column asks. */}
                {column.checklist && board.checklist && (
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
                    accent={column.accent}
                    showSprint={showSprint}
                    showStory={showStory}
                    dispatch={board.dispatch}
                    approve={board.approve}
                    interrogate={board.interrogate}
                    deliver={board.deliver}
                    pulse={pulse}
                    onStarting={onStarting}
                    onOpen={(opened) => { onOpenPlan(opened.path); }}
                    story={card.story ? storyBySlug.get(card.story) : undefined}
                    onOpenStory={onOpenStory}
                    onOpenSprint={onOpenSprint}
                    links={links}
                    highlighted={card.slug === highlight}
                  />
                ))
              ) : (
                <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                  No plans in this phase.
                </p>
              )}
              <ColumnPager
                page={view}
                noun="plans"
                onMore={() => more(column.phase)}
                onCollapse={() => collapse(column.phase)}
              />
            </div>
          </section>
        );
      })}
    </div>
    {/* Beneath the columns, not above them: it dates what was just read, and a
        provenance line at the top would be read as a warning before the reader
        has seen anything to be warned about. Same placement rule as the Agents
        tab's view-status footer. */}
    <PlanSourceLine
        planSource={board.planSource}
        ageSeconds={planAgeSeconds}
        frozen={planSourceFrozen}
        checksUnaskable={checksUnaskableOn(board)}
        ci={board.server?.ci ?? ''}
        recordLag={board.recordLag}
        recordKeyRemoved={board.recordKeyRemoved}
      />
    </>
  );
}

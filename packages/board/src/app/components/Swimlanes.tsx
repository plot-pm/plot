import { useMemo } from 'react';
import type { Board, Card, StoryCard } from '../../contract/schema.js';
import { BOARD_PHASES, PHASE_LEADERSHIP } from '../../contract/schema.js';
import { NO_STORY, passesFilter, passesSprintFilter, sprintMembershipLookup } from '../lib/filters.js';
import { storyHref } from '../lib/plan.js';
import { PlanCard } from './PlanCard.js';
import { PlanSourceLine } from './PlanSourceLine.js';

export interface SwimlanesProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  /** Bumps once per board refresh; the Start work button counts these. */
  pulse: number;
  /** A Start work click became outstanding (true) or settled (false). */
  onStarting: (active: boolean) => void;
  onOpenPlan: (card: Card) => void;
  /**
   * Open a story in the in-board overlay — what a lane's row header does.
   *
   * The lane view is the OTHER place a story is named and led nowhere: the
   * column view names it on a badge, this one names it as a row header, and
   * both now point at the story's own file.
   */
  onOpenStory?: (story: StoryCard) => void;
  /** Slug of the card just arrived at, or "" — see PlanCard's `highlighted`. */
  highlight?: string;
  /**
   * How old the plan read is, in seconds, or null before any scan has landed.
   *
   * Carried here as well as on `BoardView` because lanes are the SAME board in
   * another layout: the cards have the same provenance either way, and a fact
   * that appeared and vanished with a layout checkbox would read as a property
   * of the layout rather than of the plans.
   */
  planAgeSeconds?: number | null;
}

/** One row: a story (or the catch-all), with its plans bucketed by phase. */
interface Lane {
  key: string;
  title: string;
  subtitle: string;
  cards: Card[];
  /**
   * The story this row IS, where one exists as a file — so the row header can
   * open it. Absent for the orphan and catch-all lanes, whose headers name no
   * artefact and therefore link to none. Same rule as a card's story badge.
   */
  story?: StoryCard;
}

/**
 * The phase columns a lane renders — every board phase, in board order.
 *
 * It used to drop Discovery, on the reasoning that the row header *was* the
 * Discovery cell. That was only coherent while no plan could ever be in
 * Discovery: the filter hid nothing because there was nothing to hide. Now that
 * Draft plans land there, a row header that silently dropped them would be the
 * same bug wearing different clothes — work visible in the column view and gone
 * from the lane view.
 *
 * Exported so a test can assert the two views over ONE payload rather than
 * re-deriving the list and agreeing with itself.
 */
export const LANE_PHASES = BOARD_PHASES;

/**
 * Group cards into lanes. Stories keep their declared order; the catch-all goes
 * last because "belongs to no story" is the least specific thing a row can say.
 *
 * A story with no plans still gets a row — "shaped, nothing planned yet" is
 * itself worth showing, and hiding the row would hide it.
 */
export function buildLanes(cards: Card[], stories: StoryCard[]): Lane[] {
  const lanes: Lane[] = stories.map((s) => ({
    key: s.slug,
    title: s.title || s.slug,
    subtitle: s.status ? `${s.slug} · ${s.status}` : s.slug,
    cards: cards.filter((c) => c.story === s.slug),
    story: s,
  }));

  // Plans can name a story that has no file — a typo, or a story not yet
  // written. Dropping them would make work vanish from the board, so they get
  // their own lane rather than being silently merged into "no story".
  const known = new Set(stories.map((s) => s.slug));
  const orphaned = new Map<string, Card[]>();
  for (const c of cards) {
    if (!c.story || known.has(c.story)) continue;
    const list = orphaned.get(c.story) ?? [];
    list.push(c);
    orphaned.set(c.story, list);
  }
  for (const [slug, list] of orphaned) {
    lanes.push({ key: slug, title: slug, subtitle: 'no story file', cards: list });
  }

  const loose = cards.filter((c) => !c.story);
  if (loose.length > 0) {
    lanes.push({
      key: '__none__',
      title: '(no story)',
      subtitle: 'plans created directly',
      cards: loose,
    });
  }
  return lanes;
}

export function Swimlanes({
  board,
  sprintSel,
  storySel,
  pulse,
  onStarting,
  onOpenPlan,
  onOpenStory,
  highlight = '',
  planAgeSeconds = null,
}: SwimlanesProps) {
  const showSprint = sprintSel.length === 0;

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

  const visible = board.columns.flatMap((c) => c.cards).filter(
    (c) =>
      passesSprintFilter(c, sprintSel, membership) &&
      passesFilter(c, storySel, 'story', NO_STORY),
  );
  const lanes = buildLanes(visible, board.stories);

  const phases = LANE_PHASES;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div
          className="mb-2 grid gap-3 border-b border-slate-200 pb-2 dark:border-slate-800"
          style={{ gridTemplateColumns: `14rem repeat(${phases.length}, minmax(0, 1fr))` }}
        >
          {/* The row-label column. It named itself "Discovery" while Discovery
              was not a card column; now that it is one, this header says what
              the column under it actually holds. */}
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Story
          </div>
          {phases.map((phase) => (
            <div
              key={phase}
              className="flex items-baseline gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              title={`${phase} — ${PHASE_LEADERSHIP[phase].who}`}
            >
              <span aria-hidden>{PHASE_LEADERSHIP[phase].icon}</span>
              {phase}
            </div>
          ))}
        </div>

        {lanes.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
            No stories yet — plans without one appear here once they exist.
          </p>
        ) : (
          lanes.map((lane) => (
            <div
              key={lane.key}
              // Where a story's `Show in board` lands. `scroll-mt` keeps the
              // row clear of the sticky header when the jump arrives, so the
              // lane lands visible rather than tucked underneath.
              id={`story-${lane.key}`}
              className="mb-3 grid scroll-mt-4 gap-3 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-900"
              style={{ gridTemplateColumns: `14rem repeat(${phases.length}, minmax(0, 1fr))` }}
            >
              <div className="pr-2">
                <div className="text-sm font-medium leading-snug text-slate-800 dark:text-slate-200">
                  {/* A real anchor where the row names a story that has a
                      file; plain text otherwise — the orphan and catch-all
                      rows name no artefact, and a link that 404s is worse
                      than no link. Same rule as a card's story badge. */}
                  {onOpenStory && lane.story && storyHref(lane.story) ? (
                    <a
                      href={storyHref(lane.story)}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                        e.preventDefault();
                        onOpenStory(lane.story!);
                      }}
                      className="hover:underline"
                      title={`Open the ${lane.story.slug} story`}
                    >
                      {lane.title}
                    </a>
                  ) : (
                    lane.title
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-600">
                  {lane.subtitle}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                  {lane.cards.length === 0
                    ? 'no plans yet'
                    : `${lane.cards.length} plan${lane.cards.length === 1 ? '' : 's'}`}
                </div>
              </div>
              {phases.map((phase) => {
                const cards = lane.cards.filter((c) => c.phase === phase);
                return (
                  // A row is as tall as its FULLEST cell, and the others stay
                  // empty — harmless in columns, multiplied across rows here.
                  // Capping the cell and scrolling inside it keeps every lane
                  // reachable without collapsing what a lane contains.
                  <div key={phase} className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5">
                    {cards.map((card) => (
                      <PlanCard
                        key={card.path}
                        card={card}
                        showSprint={showSprint}
                        // The row already says which story this is; repeating it
                        // on every card is noise.
                        showStory={false}
                        dispatch={board.dispatch}
                        approve={board.approve}
                        pulse={pulse}
                        onStarting={onStarting}
                        onOpen={onOpenPlan}
                        highlighted={card.slug === highlight}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      {/* The same provenance line the column view carries, for the same cards.
          See `PlanSourceLine`. */}
      <PlanSourceLine planSource={board.planSource} ageSeconds={planAgeSeconds} />
    </div>
  );
}

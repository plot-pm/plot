import type { Board, Card, StoryCard } from '../../contract/schema.js';
import { BOARD_PHASES, PHASE_LEADERSHIP } from '../../contract/schema.js';
import { NO_SPRINT, NO_STORY, passesFilter } from '../lib/filters.js';
import { PlanCard } from './PlanCard.js';

export interface SwimlanesProps {
  board: Board;
  sprintSel: string[];
  storySel: string[];
  onOpenPlan: (card: Card) => void;
}

/** One row: a story (or the catch-all), with its plans bucketed by phase. */
interface Lane {
  key: string;
  title: string;
  subtitle: string;
  cards: Card[];
}

/**
 * Group cards into lanes. Stories keep their declared order; the catch-all goes
 * last because "belongs to no story" is the least specific thing a row can say.
 *
 * A story with no plans still gets a row. That is not an empty state to hide —
 * it reads as "shaped, nothing planned yet", which is exactly the Discovery
 * phase and the reason the column doubles as a row header.
 */
export function buildLanes(cards: Card[], stories: StoryCard[]): Lane[] {
  const lanes: Lane[] = stories.map((s) => ({
    key: s.slug,
    title: s.title || s.slug,
    subtitle: s.status ? `${s.slug} · ${s.status}` : s.slug,
    cards: cards.filter((c) => c.story === s.slug),
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

export function Swimlanes({ board, sprintSel, storySel, onOpenPlan }: SwimlanesProps) {
  const showSprint = sprintSel.length === 0;
  const visible = board.columns.flatMap((c) => c.cards).filter(
    (c) =>
      passesFilter(c, sprintSel, 'sprint', NO_SPRINT) &&
      passesFilter(c, storySel, 'story', NO_STORY),
  );
  const lanes = buildLanes(visible, board.stories);

  // Discovery holds no plans — it is where a story lives before anything is
  // planned — so it is the row header rather than a card column.
  const phases = BOARD_PHASES.filter((p) => p !== 'Discovery');

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div
          className="mb-2 grid gap-3 border-b border-slate-200 pb-2 dark:border-slate-800"
          style={{ gridTemplateColumns: `14rem repeat(${phases.length}, minmax(0, 1fr))` }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            👤 Discovery
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
              className="mb-3 grid gap-3 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-900"
              style={{ gridTemplateColumns: `14rem repeat(${phases.length}, minmax(0, 1fr))` }}
            >
              <div className="pr-2">
                <div className="text-sm font-medium leading-snug text-slate-800 dark:text-slate-200">
                  {lane.title}
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
                        onOpen={onOpenPlan}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

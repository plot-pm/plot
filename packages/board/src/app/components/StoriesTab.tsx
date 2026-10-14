import { useMemo, useState } from 'react';
import type { StoryCard, StoryLaneGroup, Topic, TicketLaneGroups, TicketLaneRow } from '../../contract/schema.js';

/** Lane metadata for display, in D7's order. */
const STORY_LANE_META: Record<StoryLaneGroup['lane'], { label: string; icon: string }> = {
  Draft: { label: 'Draft', icon: '📝' },
  Active: { label: 'Active', icon: '🚀' },
  Done: { label: 'Done', icon: '✅' },
  Archived: { label: 'Archived', icon: '📦' },
};

/** Ticket lane metadata for display, in the same Open → In progress → Done order the server returns. */
const TICKET_LANE_META: Record<'open' | 'in-progress' | 'done', { label: string; icon: string }> = {
  open: { label: 'Open', icon: '🔵' },
  'in-progress': { label: 'In progress', icon: '🟡' },
  done: { label: 'Done', icon: '✅' },
};

export interface StoriesTabProps {
  /** D7's story lanes, server-computed by `storyLanes` — replaces the old client-side `COLUMN_OF` lookup. */
  storyLaneGroups: StoryLaneGroup[];
  /** The ticket lane groups, or null before the first issue read or where the issue source is `nobody`. */
  tickets: TicketLaneGroups | null;
  /** True when the plans directory could not be read this pass — `tickets` is then the last good reading, not a fresh one. */
  plansUnreadable: boolean;
  /**
   * Semantic topics extracted by the server using TF-IDF.
   * Each topic includes storySlugs for filtering (including when a topic
   * was found in a plan title, not just the story title).
   */
  topics: Topic[];
  /** Whether the `?archived=1` toggle is on. */
  showArchived: boolean;
  /** Flips the `?archived=1` toggle — re-fetches the board with the wider scope. */
  onShowArchived: (next: boolean) => void;
  /** Open a story in the modal. */
  onOpenStory: (story: StoryCard) => void;
  /** Open a sprint in the Delivery tab. */
  onOpenSprint?: (sprintSlug: string) => void;
}

/**
 * Get size class for a topic pill based on its count relative to max.
 * Topics with higher counts get slightly larger pills.
 */
function topicSizeClass(count: number, maxCount: number): string {
  if (maxCount <= 1) return 'text-xs px-2.5 py-0.5';
  const ratio = count / maxCount;
  if (ratio >= 0.8) return 'text-sm px-3 py-1'; // Large
  if (ratio >= 0.4) return 'text-xs px-2.5 py-0.5'; // Medium
  return 'text-[11px] px-2 py-0.5'; // Small
}

/**
 * Render basic markdown (bold, italic) to JSX for inline display.
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  // Split on **bold** and *italic* patterns
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    // Check for **bold**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    // Check for *italic*
    const italicMatch = remaining.match(/\*([^*]+)\*/);

    // Find the earliest match
    const boldIdx = boldMatch?.index ?? Infinity;
    const italicIdx = italicMatch?.index ?? Infinity;

    if (boldIdx === Infinity && italicIdx === Infinity) {
      // No more markdown
      parts.push(remaining);
      break;
    }

    if (boldIdx <= italicIdx && boldMatch) {
      // Bold comes first
      if (boldIdx > 0) parts.push(remaining.slice(0, boldIdx));
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldIdx + boldMatch[0].length);
    } else if (italicMatch) {
      // Italic comes first
      if (italicIdx > 0) parts.push(remaining.slice(0, italicIdx));
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicIdx + italicMatch[0].length);
    }
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>;
}

/**
 * Discovery tab — the strategic layer above plans.
 *
 * Shows story cards grouped by status (Draft/Active/Done/Archived), with a tag
 * cloud for topic navigation. Clicking a story opens the StoryModal.
 */
export function StoriesTab({
  storyLaneGroups,
  tickets,
  plansUnreadable,
  topics,
  showArchived,
  onShowArchived,
  onOpenStory,
  onOpenSprint,
}: StoriesTabProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // Per-view only — not kept in the URL. `?archived=1` is the one URL
  // parameter; a second one for Done's expansion would let the two interact
  // in ways neither toggle's name describes.
  const [storiesDoneExpanded, setStoriesDoneExpanded] = useState(false);
  const [ticketsDoneExpanded, setTicketsDoneExpanded] = useState(false);

  // Build a lookup: topic -> set of story slugs that contain it
  const topicToSlugs = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of topics) {
      map.set(t.topic, new Set(t.storySlugs));
    }
    return map;
  }, [topics]);

  // Filter each lane by the selected topic — uses server's storySlugs to
  // match stories (includes stories where the topic was found in a plan
  // title).
  const filteredLaneGroups = useMemo(() => {
    if (!selectedTag) return storyLaneGroups;
    const matchingSlugs = topicToSlugs.get(selectedTag) ?? new Set();
    return storyLaneGroups.map((group) => ({
      ...group,
      stories: group.stories.filter((s) => matchingSlugs.has(s.slug)),
    }));
  }, [storyLaneGroups, selectedTag, topicToSlugs]);

  // Max topic count for sizing
  const maxTopicCount = topics.length > 0 ? Math.max(...topics.map((t) => t.count)) : 1;

  return (
    <div className="space-y-4">
      {/* Tag cloud — server-computed topics with variable sizing */}
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 py-2">
          {topics.map((t) => {
            const isSelected = selectedTag === t.topic;
            const sizeClass = topicSizeClass(t.count, maxTopicCount);
            return (
              <button
                key={t.topic}
                type="button"
                onClick={() => setSelectedTag(isSelected ? null : t.topic)}
                className={`inline-flex items-center gap-1 rounded-full font-medium transition-all ${sizeClass} ${
                  isSelected
                    ? 'border-2 border-cyan-500 bg-cyan-100 text-cyan-800 dark:border-cyan-400 dark:bg-cyan-900/50 dark:text-cyan-200'
                    : selectedTag
                      ? 'border border-slate-200 bg-slate-100 text-slate-400 hover:border-slate-300 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:bg-slate-700'
                      : 'border border-slate-200 bg-slate-100 text-slate-600 hover:border-cyan-300 hover:bg-cyan-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-cyan-600 dark:hover:bg-cyan-900/30'
                }`}
                title={`Filter by "${t.topic}" (${t.count} stories)`}
              >
                <span>{t.topic}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] ${
                    isSelected
                      ? 'bg-cyan-200 text-cyan-700 dark:bg-cyan-800 dark:text-cyan-200'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
          {selectedTag && (
            <button
              type="button"
              onClick={() => setSelectedTag(null)}
              className="ml-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Archived toggle — adds the Archived story lane and the rest of Done */}
      <div className="flex items-center justify-end gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-slate-500"
          />
          Show archived
        </label>
      </div>

      {/* Tickets lane group */}
      {plansUnreadable ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Plans could not be read — showing the last known ticket lanes.
        </p>
      ) : null}
      {tickets ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {(['open', 'in-progress', 'done'] as const).map((lane) => {
            const meta = TICKET_LANE_META[lane];
            const rows = tickets[lane];
            const visibleRows = lane === 'done' && !ticketsDoneExpanded ? rows.slice(0, 5) : rows;
            return (
              <section
                key={lane}
                className="flex flex-col rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50"
              >
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="flex items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <span aria-hidden>{meta.icon}</span>
                    <span>{meta.label}</span>
                  </h2>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {rows.length}
                  </span>
                </header>
                <div className="flex flex-col gap-2">
                  {visibleRows.length > 0 ? (
                    visibleRows.map((row) => <TicketRowView key={row.id} ticket={row} />)
                  ) : (
                    <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                      No tickets in this lane.
                    </p>
                  )}
                  {lane === 'done' && !ticketsDoneExpanded && (rows.length > 5 || tickets.moreCount > 0) && (
                    <button
                      type="button"
                      onClick={() => setTicketsDoneExpanded(true)}
                      className="px-1 text-left text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                    >
                      Show all done ({rows.length - 5 + tickets.moreCount} more)
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {/* Story lane groups */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${filteredLaneGroups.length}, minmax(0, 1fr))`,
        }}
      >
        {filteredLaneGroups.map((group) => {
          const meta = STORY_LANE_META[group.lane];
          const isDone = group.lane === 'Done';
          const visibleStories = isDone && !storiesDoneExpanded ? group.stories.slice(0, 5) : group.stories;
          return (
            <section
              key={group.lane}
              className="flex flex-col rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50"
            >
              <header className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <span aria-hidden>{meta.icon}</span>
                  <span>{meta.label}</span>
                </h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {group.stories.length}
                </span>
              </header>
              <div className="flex flex-col gap-3">
                {visibleStories.length > 0 ? (
                  visibleStories.map((story) => (
                    <StoryCardView
                      key={story.slug}
                      story={story}
                      onOpen={() => onOpenStory(story)}
                      onOpenSprint={onOpenSprint}
                    />
                  ))
                ) : (
                  <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                    No stories in this lane.
                  </p>
                )}
                {isDone && !storiesDoneExpanded && group.stories.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setStoriesDoneExpanded(true)}
                    className="px-1 text-left text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                  >
                    Show all done ({group.stories.length - 5} more)
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface TicketRowViewProps {
  ticket: TicketLaneRow;
}

/** A ticket row in the ticket lane group — title and link only, no full card chrome. */
function TicketRowView({ ticket }: TicketRowViewProps) {
  return (
    <a
      href={ticket.url}
      target="_blank"
      rel="noreferrer"
      className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-cyan-600"
    >
      <span className="line-clamp-2 text-slate-700 dark:text-slate-200">{ticket.title}</span>
    </a>
  );
}

interface StoryCardViewProps {
  story: StoryCard;
  onOpen: () => void;
  onOpenSprint?: (sprintSlug: string) => void;
}

/**
 * A story card in the column view.
 */
function StoryCardView({ story, onOpen, onOpenSprint }: StoryCardViewProps) {
  return (
    <div className="w-full rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Clickable header area */}
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left transition-opacity hover:opacity-80"
      >
        {/* Header: title + drift warning */}
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100">
            {story.title || story.slug}
          </h3>
          {story.statusDrift && (
            <span
              className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
              title={story.statusDrift}
            >
              ⚠️
            </span>
          )}
        </div>

        {/* Counts */}
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {story.planCount} {story.planCount === 1 ? 'plan' : 'plans'} · {story.deliveredCount} delivered
        </p>

        {/* Age */}
        {(story.created || story.updated) && (
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            {story.created && `Created: ${formatDate(story.created)}`}
            {story.created && story.updated && ' · '}
            {story.updated && `Updated: ${formatDate(story.updated)}`}
          </p>
        )}

        {/* Objective preview - more lines, with markdown rendering */}
        {story.objective && (
          <p className="line-clamp-4 text-xs italic text-slate-600 dark:text-slate-300">
            "{renderInlineMarkdown(story.objective)}"
          </p>
        )}
      </button>

      {/* Sprints - vertical list with links */}
      {story.sprints && story.sprints.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Sprints
          </p>
          <ul className="space-y-1">
            {story.sprints.map((s) => (
              <li key={s.slug}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSprint?.(s.slug);
                  }}
                  className="text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                >
                  {s.slug}
                </button>
                <span className="ml-1 text-xs text-slate-400">
                  ({s.planCount} {s.planCount === 1 ? 'plan' : 'plans'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Format an ISO date string for display.
 */
function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}

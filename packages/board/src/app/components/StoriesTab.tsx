import { useMemo, useState } from 'react';
import { discoveryGroups, lanesForTopic, storyDateText, ticketCardIssueRow, ticketCardView, topicCountFor } from '@plot-pm/domain';
import type { DiscoveryShow } from '@plot-pm/domain';
import type { StoryCard, StoryLaneGroup, Topic, TicketLaneGroups, TicketLaneRow, DispatchInfo, IssueAnswer } from '../../contract/schema.js';
import { CreatePlanButton } from './CreatePlanButton.js';
import { CreateStoryButton } from './CreateStoryButton.js';

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

/** The `?show=` control's options, in the order the reader sees them. */
const SHOW_OPTIONS: { value: DiscoveryShow; label: string }[] = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'stories', label: 'Stories' },
  { value: 'both', label: 'Both' },
];

export interface StoriesTabProps {
  /** D7's story lanes, server-computed by `storyLanes` — replaces the old client-side `COLUMN_OF` lookup. */
  storyLaneGroups: StoryLaneGroup[];
  /** The ticket lane groups, or null before the first issue read or where the issue source is `nobody`. */
  tickets: TicketLaneGroups | null;
  /** True when the plans directory could not be read this pass — `tickets` is then the last good reading, not a fresh one. */
  plansUnreadable: boolean;
  /** The closed-ticket route's absence sentence while the toggle is on, or null. */
  closedAbsence?: string | null;
  /** The board's sentence for an issue source that cannot be listed, or null while a read is merely pending. */
  issueAbsence?: string | null;
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
  /** Which lane groups the `?show=` control keeps on screen. */
  show: DiscoveryShow;
  /** Writes the `?show=` choice. */
  onShow: (next: DiscoveryShow) => void;
  /** Open a story in the modal. */
  onOpenStory: (story: StoryCard) => void;
  /** Open a sprint in the Delivery tab. */
  onOpenSprint?: (sprintSlug: string) => void;
  /** Whether *Create plan* can act — the same binding `AgentList`'s issue rows read. */
  idea: DispatchInfo;
  /** Whether *Create story* can act — the same binding `AgentList`'s issue rows read. */
  story: DispatchInfo;
  /** Whether the tracker can be asked at all — read together with `idea`/`story` the same way `fleet.issueAnswer` is elsewhere. */
  issueAnswer: IssueAnswer;
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
  closedAbsence = null,
  issueAbsence = null,
  topics,
  showArchived,
  onShowArchived,
  show,
  onShow,
  onOpenStory,
  onOpenSprint,
  idea,
  story,
  issueAnswer,
}: StoriesTabProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // Per-view only — not kept in the URL. `?archived=1` is the one URL
  // parameter; a second one for Done's expansion would let the two interact
  // in ways neither toggle's name describes.
  const [storiesDoneExpanded, setStoriesDoneExpanded] = useState(false);
  const [ticketsDoneExpanded, setTicketsDoneExpanded] = useState(false);

  // The domain decides which rows survive the selected topic, and which
  // lanes the topic emptied.
  const filtered = useMemo(
    () => lanesForTopic(storyLaneGroups, tickets, topics.find((t) => t.topic === selectedTag) ?? null),
    [storyLaneGroups, tickets, topics, selectedTag],
  );
  const filteredLaneGroups = filtered.storyLanes;
  const groups = discoveryGroups(show, filtered.storyLanes, filtered.tickets, issueAbsence);

  // The cloud counts only the groups on screen; max topic count is for sizing.
  const topicCounts = topics.map((t) => topicCountFor(t, groups));
  const maxTopicCount = topicCounts.length > 0 ? Math.max(...topicCounts) : 1;

  return (
    <div className="space-y-4">
      {/* Tag cloud — server-computed topics with variable sizing */}
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 py-2">
          {topics.map((t, i) => {
            const isSelected = selectedTag === t.topic;
            const topicCount = topicCounts[i];
            const sizeClass = topicSizeClass(topicCount, maxTopicCount);
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
                title={`Filter by "${t.topic}" (${topicCount})`}
              >
                <span>{t.topic}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] ${
                    isSelected
                      ? 'bg-cyan-200 text-cyan-700 dark:bg-cyan-800 dark:text-cyan-200'
                      : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                  }`}
                >
                  {topicCount}
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

      {/* Group control and archived toggle — `?show=` and `?archived=1` are independent parameters */}
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs dark:border-slate-600">
          {SHOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={show === option.value}
              onClick={() => onShow(option.value)}
              className={`px-3 py-1 font-medium ${
                show === option.value
                  ? 'bg-cyan-600 text-white dark:bg-cyan-500'
                  : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
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
      {closedAbsence ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {closedAbsence}
        </p>
      ) : null}
      {groups.tickets.reason ? (
        <p
          data-discovery-reason="tickets"
          className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
        >
          {groups.tickets.reason}
        </p>
      ) : null}
      {groups.tickets.shows ? (
        <h2
          data-discovery-group="tickets"
          className="text-base font-semibold text-slate-700 dark:text-slate-200"
        >
          {groups.tickets.heading}
        </h2>
      ) : null}
      {groups.tickets.shows && filtered.tickets ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {(['open', 'in-progress', 'done'] as const).map((lane) => {
            const meta = TICKET_LANE_META[lane];
            const { rows, hiddenByTopic } = filtered.tickets![lane];
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
                    visibleRows.map((row) => (
                      <TicketRowView
                        key={row.id}
                        ticket={row}
                        lane={lane}
                        idea={idea}
                        story={story}
                        issueAnswer={issueAnswer}
                      />
                    ))
                  ) : (
                    <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                      {hiddenByTopic ? 'This topic hides every ticket in this lane.' : 'No tickets in this lane.'}
                    </p>
                  )}
                  {lane === 'done' && !ticketsDoneExpanded && (rows.length > 5 || filtered.tickets!.moreCount > 0) && (
                    <button
                      type="button"
                      onClick={() => setTicketsDoneExpanded(true)}
                      className="px-1 text-left text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                    >
                      Show all done ({rows.length - 5 + filtered.tickets!.moreCount} more)
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {/* Story lane groups */}
      {groups.stories.shows ? (
        <h2
          data-discovery-group="stories"
          className="text-base font-semibold text-slate-700 dark:text-slate-200"
        >
          {groups.stories.heading}
        </h2>
      ) : null}
      {groups.stories.shows ? (
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${filteredLaneGroups.length}, minmax(0, 1fr))`,
        }}
      >
        {filteredLaneGroups.map((group) => {
          const meta = STORY_LANE_META[group.lane];
          const isDone = group.lane === 'Done';
          const visibleStories = isDone && !storiesDoneExpanded ? group.rows.slice(0, 5) : group.rows;
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
                  {group.rows.length}
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
                    {group.hiddenByTopic ? 'This topic hides every story in this lane.' : 'No stories in this lane.'}
                  </p>
                )}
                {isDone && !storiesDoneExpanded && group.rows.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setStoriesDoneExpanded(true)}
                    className="px-1 text-left text-xs text-cyan-600 hover:underline dark:text-cyan-400"
                  >
                    Show all done ({group.rows.length - 5} more)
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      ) : null}
    </div>
  );
}

/**
 * The open/closed state icons a ticket card wears on its first line.
 *
 * NEW — no open/closed pair exists in `KIND_ICON_PATH` (`tuple-row.ts`):
 * `KindIcon` renders exactly one glyph per row `kind`, and a ticket row's
 * `kind` is always `'ticket'`, so there is no variant to reuse here. These
 * match `KindIcon`'s own 14px/`currentColor`/`aria-hidden` Octicon convention
 * (`issue-opened` / `issue-closed`) rather than `KIND_ICON_PATH` itself,
 * since that map has no slot for a second glyph under one kind.
 */
const TICKET_STATE_ICON_PATH: Record<'open' | 'closed', string> = {
  open: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
  closed:
    'M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z' +
    'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
};

function TicketStateIcon({ state }: { state: 'open' | 'closed' }) {
  return (
    <svg
      aria-hidden
      data-ticket-card-icon={state}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
      className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500"
    >
      <path d={TICKET_STATE_ICON_PATH[state]} />
    </svg>
  );
}

interface TicketRowViewProps {
  ticket: TicketLaneRow;
  lane: 'open' | 'in-progress' | 'done';
  idea: DispatchInfo;
  story: DispatchInfo;
  issueAnswer: IssueAnswer;
}

/** A ticket row in the ticket lane group — the card helper's view, rendered. */
function TicketRowView({ ticket, lane, idea, story, issueAnswer }: TicketRowViewProps) {
  const view = useMemo(() => ticketCardView(ticket, lane, Date.now()), [ticket, lane]);
  const issue = useMemo(() => ticketCardIssueRow(ticket), [ticket]);
  return (
    <div
      data-ticket-card={ticket.id}
      className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-cyan-600"
    >
      <a href={view.url} target="_blank" rel="noreferrer" className="flex items-start gap-1.5">
        <TicketStateIcon state={view.icon} />
        <span className="line-clamp-2 text-slate-700 dark:text-slate-200">{view.heading}</span>
      </a>
      {view.type || view.owner ? (
        <p className="mt-1 flex items-center gap-1.5 pl-[20px]">
          {view.type ? (
            <span
              data-ticket-type
              className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
            >
              {view.type}
            </span>
          ) : null}
          {view.owner ? (
            <span data-ticket-owner className="text-slate-500 dark:text-slate-400">
              {view.owner}
            </span>
          ) : null}
        </p>
      ) : null}
      {view.subtitle ? (
        <p className="mt-1 truncate pl-[20px] text-slate-400 dark:text-slate-500">{view.subtitle}</p>
      ) : null}
      {view.showsActions ? (
        <div className="mt-2 flex items-center gap-2 pl-[20px]">
          <CreatePlanButton issue={issue} idea={idea} issueAnswer={issueAnswer} />
          <CreateStoryButton issue={issue} story={story} issueAnswer={issueAnswer} />
        </div>
      ) : null}
    </div>
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
  const now = new Date();
  const createdText = storyDateText(story.created, now);
  const updatedText = storyDateText(story.updated, now);

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
        {(createdText || updatedText) && (
          <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">
            {createdText && `Created: ${createdText}`}
            {createdText && updatedText && ' · '}
            {updatedText && `Updated: ${updatedText}`}
          </p>
        )}

        {/* Objective preview - more lines, with markdown rendering */}
        {story.objective && (
          <p className="line-clamp-4 text-xs italic text-slate-600 dark:text-slate-300">
            {renderInlineMarkdown(story.objective)}
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

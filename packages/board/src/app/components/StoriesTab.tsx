import { useMemo, useState } from 'react';
import type { StoryCard } from '../../contract/schema.js';

/**
 * Story status columns in display order.
 *
 * Follows the lifecycle: Draft → Active → Done → Archived.
 * Archived is hidden by default behind a toggle.
 */
const STORY_STATUSES = ['draft', 'active', 'done', 'archived'] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];

/** Column metadata for display. */
const STATUS_META: Record<StoryStatus, { label: string; icon: string }> = {
  draft: { label: 'Draft', icon: '📝' },
  active: { label: 'Active', icon: '🚀' },
  done: { label: 'Done', icon: '✅' },
  archived: { label: 'Archived', icon: '📦' },
};

export interface StoriesTabProps {
  stories: StoryCard[];
  /** Open a story in the modal. */
  onOpenStory: (story: StoryCard) => void;
}

/**
 * Tag cloud entry — a story slug with its plan count.
 */
interface TagEntry {
  slug: string;
  count: number;
  status: string;
}

/**
 * Compute tag cloud entries from stories.
 *
 * Each story is a "tag" with count = its planCount.
 * Sorted by count descending so the most active stories appear first.
 */
function computeTags(stories: StoryCard[]): TagEntry[] {
  return stories
    .map((s) => ({ slug: s.slug, count: s.planCount, status: s.status }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Compute font size for a tag based on its count.
 *
 * Moderate scaling (1x to 2x) using logarithmic compression to avoid extremes
 * where a story with 71 plans would dwarf one with 2.
 */
function tagFontSize(count: number, maxCount: number): string {
  if (maxCount <= 1) return '1rem';
  // Log scale: min 1rem, max 2rem
  const scale = 1 + Math.log(count + 1) / Math.log(maxCount + 1);
  return `${scale.toFixed(2)}rem`;
}

/**
 * Color for a tag based on story status.
 */
function tagColor(status: string): string {
  switch (status) {
    case 'active':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'done':
      return 'text-blue-600 dark:text-blue-400';
    case 'archived':
      return 'text-slate-400 dark:text-slate-500';
    default: // draft
      return 'text-amber-600 dark:text-amber-400';
  }
}

/**
 * Stories tab — the strategic layer above plans.
 *
 * Shows story cards grouped by status (Draft/Active/Done/Archived), with a tag
 * cloud for topic navigation. Clicking a story opens the StoryModal.
 */
export function StoriesTab({ stories, onOpenStory }: StoriesTabProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Group stories by status
  const byStatus = useMemo(() => {
    const groups: Record<StoryStatus, StoryCard[]> = {
      draft: [],
      active: [],
      done: [],
      archived: [],
    };
    for (const story of stories) {
      const status = (story.status?.toLowerCase() ?? 'draft') as StoryStatus;
      const bucket = groups[status] ?? groups.draft;
      bucket.push(story);
    }
    return groups;
  }, [stories]);

  // Filter by selected tag if any
  const filteredByStatus = useMemo(() => {
    if (!selectedTag) return byStatus;
    const result: Record<StoryStatus, StoryCard[]> = {
      draft: [],
      active: [],
      done: [],
      archived: [],
    };
    for (const status of STORY_STATUSES) {
      result[status] = byStatus[status].filter((s) => s.slug === selectedTag);
    }
    return result;
  }, [byStatus, selectedTag]);

  // Tag cloud
  const tags = useMemo(() => computeTags(stories), [stories]);
  const maxCount = tags.length > 0 ? tags[0].count : 1;

  // Which columns to show
  const visibleStatuses = showArchived
    ? STORY_STATUSES
    : STORY_STATUSES.filter((s) => s !== 'archived');

  return (
    <div className="space-y-4">
      {/* Tag cloud */}
      {tags.length > 0 && (
        <div className="rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {tags.map((tag) => (
              <button
                key={tag.slug}
                type="button"
                onClick={() => setSelectedTag(selectedTag === tag.slug ? null : tag.slug)}
                className={`transition-opacity hover:opacity-80 ${tagColor(tag.status)} ${
                  selectedTag && selectedTag !== tag.slug ? 'opacity-40' : ''
                }`}
                style={{ fontSize: tagFontSize(tag.count, maxCount) }}
                title={`${tag.slug}: ${tag.count} plans`}
              >
                {tag.slug}
                <span className="ml-0.5 text-xs opacity-60">({tag.count})</span>
              </button>
            ))}
            {selectedTag && (
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                Clear filter
              </button>
            )}
          </div>
        </div>
      )}

      {/* Archived toggle */}
      <div className="flex items-center justify-end gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 accent-slate-500"
          />
          Show archived
        </label>
      </div>

      {/* Columns */}
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${visibleStatuses.length}, minmax(0, 1fr))`,
        }}
      >
        {visibleStatuses.map((status) => {
          const column = filteredByStatus[status];
          const meta = STATUS_META[status];
          return (
            <section
              key={status}
              className="flex flex-col rounded-lg bg-slate-100/70 p-3 dark:bg-slate-900/50"
            >
              <header className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <span aria-hidden>{meta.icon}</span>
                  <span>{meta.label}</span>
                </h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {column.length}
                </span>
              </header>
              <div className="flex flex-col gap-3">
                {column.length > 0 ? (
                  column.map((story) => (
                    <StoryCardView
                      key={story.slug}
                      story={story}
                      onOpen={() => onOpenStory(story)}
                    />
                  ))
                ) : (
                  <p className="px-1 py-4 text-center text-xs text-slate-400 dark:text-slate-600">
                    No stories in this status.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface StoryCardViewProps {
  story: StoryCard;
  onOpen: () => void;
}

/**
 * A story card in the column view.
 */
function StoryCardView({ story, onOpen }: StoryCardViewProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
    >
      {/* Header: slug + drift warning */}
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
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

      {/* Objective preview */}
      {story.objective && (
        <p className="line-clamp-2 text-xs italic text-slate-600 dark:text-slate-300">
          "{story.objective}"
        </p>
      )}

      {/* Sprints */}
      {story.sprints && story.sprints.length > 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Sprints:{' '}
          {story.sprints.map((s, i) => (
            <span key={s.slug}>
              {i > 0 && ', '}
              {s.slug} ({s.planCount})
            </span>
          ))}
        </p>
      )}
    </button>
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

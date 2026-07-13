import type { Board, Card } from '../../contract/schema.js';

/** Sentinels for "plans with no sprint / no story assigned". */
export const NO_SPRINT = '__no_sprint__';
export const NO_STORY = '__no_story__';

/** A single option in a multi-select filter. */
export interface FilterOption {
  value: string;
  label: string;
}

/**
 * Sprint filter options, unioned from two sources:
 *  1. the sprint *directory* (`board.sprints`) — these carry human titles;
 *  2. the sprint values written *inline on plans* (`card.sprint`) — a plan can
 *     reference a sprint that has no directory entry, and that sprint must still
 *     be filterable.
 *
 * Directory titles win when a slug appears in both; inline-only sprints fall
 * back to their raw slug as the label. Sorted for stable rendering. This is why
 * the sprint filter can be non-empty even when the sprint directory is: the
 * board carries the fact (card.sprint) and the client composes the filter.
 */
export function sprintFilterOptions(board: Board | null): FilterOption[] {
  const labels = new Map<string, string>();
  for (const s of board?.sprints ?? []) labels.set(s.slug, s.title);
  for (const col of board?.columns ?? []) {
    for (const card of col.cards) {
      if (card.sprint && !labels.has(card.sprint)) labels.set(card.sprint, card.sprint);
    }
  }
  return [...labels.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([value, label]) => ({ value, label }));
}

/** Read a comma-separated multi-value filter from the URL query. */
export function readList(param: string): string[] {
  const raw = new URLSearchParams(window.location.search).get(param);
  return raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
}

/** Write a multi-value filter back to the URL (replaceState, no reload). */
export function writeList(param: string, values: string[]): void {
  const url = new URL(window.location.href);
  if (values.length) url.searchParams.set(param, values.join(','));
  else url.searchParams.delete(param);
  history.replaceState(null, '', url.toString());
}

/**
 * Does a card pass one multi-select filter? Empty selection = no filter. A
 * card with the field set matches when its value is selected; a card without
 * the field matches only when the "none" sentinel is selected.
 */
export function passesFilter(
  card: Card,
  selected: string[],
  key: 'sprint' | 'story',
  noneSentinel: string,
): boolean {
  if (selected.length === 0) return true;
  const value = card[key];
  return value ? selected.includes(value) : selected.includes(noneSentinel);
}

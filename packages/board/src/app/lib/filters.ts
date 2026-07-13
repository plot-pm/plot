import type { Board, Card } from '../../contract/schema.js';

/** Sentinels for "plans with no sprint / no story assigned". */
export const NO_SPRINT = '__no_sprint__';
export const NO_STORY = '__no_story__';

/** A single option in a multi-select filter. */
export interface FilterOption {
  value: string;
  label: string;
}

/** A filter option annotated with how many plans fall in its bucket. */
export interface CountedFilterOption extends FilterOption {
  count: number;
}

/**
 * Annotate each option with the number of cards in its bucket. The "none"
 * sentinel counts cards missing the field; every other option counts cards
 * whose field equals its value. Counts are over the whole board (all columns),
 * independent of the current selection — a stable "how many plans carry this?"
 * facet, not a live cross-filter.
 */
export function withCounts(
  options: FilterOption[],
  cards: Card[],
  key: 'sprint' | 'story',
  noneSentinel: string,
): CountedFilterOption[] {
  return options.map((o) => ({
    ...o,
    count: cards.filter((c) => (o.value === noneSentinel ? !c[key] : c[key] === o.value)).length,
  }));
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

/**
 * Keep only selections that correspond to a currently-valid option. URL filter
 * state (`?sprint=a,b`) is arbitrary user input: a stale or mistyped slug that
 * matches no option would otherwise make `passesFilter` hide every card,
 * leaving a mysteriously empty board. Dropping unknown values means an
 * all-invalid selection collapses to "no filter" (show all) — the plan's
 * promised "validated against known slugs" behavior, done by pure derivation
 * so there is no state/URL churn on every render or poll. Sentinels
 * (`__no_sprint__`, `__no_story__`) are themselves options, so they survive.
 */
export function sanitizeSelection(selected: string[], options: FilterOption[]): string[] {
  const valid = new Set(options.map((o) => o.value));
  return selected.filter((v) => valid.has(v));
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

import type { Card } from '../../contract/schema.js';

/** Sentinels for "plans with no sprint / no story assigned". */
export const NO_SPRINT = '__no_sprint__';
export const NO_STORY = '__no_story__';

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

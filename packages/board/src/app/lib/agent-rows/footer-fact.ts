import type { UnplacedView } from './delivery-view.js';

/** A reading's freshness against its own refresh interval. */
export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'unknown';

/** The word beside a dot; it is also the dot's accessible name. */
export const FRESHNESS_WORD: Record<FreshnessState, string> = {
  fresh: 'fresh',
  aging: 'aging',
  stale: 'stale',
  unknown: 'age unknown',
};

/**
 * The dot state of a reading `ageSeconds` old that refreshes every `intervalMs`.
 *
 * Fresh up to one interval, aging up to three, stale beyond. A null interval
 * yields `unknown`, never `fresh`: no interval means the age has no reference.
 */
export const freshnessState = (ageSeconds: number, intervalMs: number | null): FreshnessState => {
  if (intervalMs === null || !(intervalMs > 0)) return 'unknown';
  const intervalSeconds = intervalMs / 1000;
  if (ageSeconds <= intervalSeconds) return 'fresh';
  if (ageSeconds <= 3 * intervalSeconds) return 'aging';
  return 'stale';
};

/** Seconds below one minute, whole minutes from 60 s. */
export const durationText = (seconds: number): string =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

/** One reading's line segment: dot, age, and the next read where one is known. */
export interface FreshnessEntry {
  key: 'board' | 'pr';
  state: FreshnessState;
  word: string;
  /** The text after the dot, without the dot or its word. */
  text: string;
  /** Null where no next read is known; the age then stands alone. */
  next: string | null;
}

export interface FooterInput {
  /** The ticked age of the last successful ref read; null when none has succeeded. */
  boardAgeSeconds: number | null;
  /** The client's poll interval in seconds; null when nothing polls. */
  pollSeconds: number | null;
  /** Seconds to the next board read, already ticked; null where unknown. */
  boardNextSeconds: number | null;
  /** The ticked age of the PR data; null when none has landed. */
  prAgeSeconds: number | null;
  prIntervalMs: number | null;
  /** Seconds to the next PR read, already ticked; null where no reader schedules one. */
  prNextSeconds: number | null;
  prError: boolean;
  /** True while the tab is stale and its ages no longer advance: every dot then reads stale. */
  frozen: boolean;
  /** False while the scan still runs: only the total is provisional. */
  complete: boolean;
  branches: number;
  plans: number;
  notPlaced: readonly UnplacedView[];
}

export interface FooterFact {
  freshness: FreshnessEntry[];
  counts: string;
  notPlaced: { count: number; text: string; details: { id: string; text: string }[] } | null;
  /** The whole line as plain text. It holds no desk path. */
  line: string;
}

/** The not-placed entries behind **details**: the same array the count reads. */
export const unplacedDetails = (notPlaced: readonly UnplacedView[]): { id: string; text: string }[] =>
  notPlaced.map((u) => ({ id: u.id, text: `${u.label} — ${u.note}` }));

const dotText = (e: FreshnessEntry): string =>
  `● ${e.word} · ${e.text}${e.next === null ? '' : ` · ${e.next}`}`;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The not-placed count in words: desks and work items are counted apart. */
const notPlacedText = (notPlaced: readonly UnplacedView[]): string => {
  const desks = notPlaced.filter((u) => u.subject === 'agent').length;
  const items = notPlaced.length - desks;
  const parts = [...(desks > 0 ? [plural(desks, 'desk', 'desks')] : []), ...(items > 0 ? [plural(items, 'work item', 'work items')] : [])];
  return `${parts.join(' and ')} not placed`;
};

/** Derives the Delivery tab footer from readings. The component does no arithmetic or wording. */
export const footerFact = (i: FooterInput): FooterFact => {
  const frozen = i.frozen ? ' (frozen)' : '';
  const freshness: FreshnessEntry[] = [];

  if (i.boardAgeSeconds !== null) {
    const state = i.frozen ? 'stale' : freshnessState(i.boardAgeSeconds, i.pollSeconds === null ? null : i.pollSeconds * 1000);
    freshness.push({
      key: 'board', state, word: FRESHNESS_WORD[state],
      text: `board read ${durationText(i.boardAgeSeconds)} old${frozen}`,
      next: i.boardNextSeconds === null ? null : `next in ${durationText(i.boardNextSeconds)}`,
    });
  }
  if (i.prAgeSeconds !== null) {
    const state = i.frozen ? 'stale' : freshnessState(i.prAgeSeconds, i.prIntervalMs);
    freshness.push({
      key: 'pr', state, word: FRESHNESS_WORD[state],
      text: `PR data ${durationText(i.prAgeSeconds)} old${frozen}`,
      next: i.prNextSeconds === null ? null : `next read in ${durationText(i.prNextSeconds)}`,
    });
  } else if (!i.prError) {
    const state: FreshnessState = i.frozen ? 'stale' : 'unknown';
    freshness.push({ key: 'pr', state, word: FRESHNESS_WORD[state], text: 'no PR data yet', next: null });
  }

  const counts = `${i.branches} branches across ${i.plans} plans${i.complete ? '' : ' so far'}`;
  const n = i.notPlaced.length;
  const notPlaced = n === 0 ? null : {
    count: n,
    text: notPlacedText(i.notPlaced),
    details: unplacedDetails(i.notPlaced),
  };

  const line = [...freshness.map(dotText), counts, ...(notPlaced === null ? [] : [`${notPlaced.text} · details`])].join(' · ');
  return { freshness, counts, notPlaced, line };
};

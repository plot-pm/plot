import type { Board, Card, SprintCard } from '../../contract/schema.js';

/** Sentinels for "plans with no sprint / no story assigned". */
export const NO_SPRINT = '__no_sprint__';
export const NO_STORY = '__no_story__';

/**
 * Build a lookup from sprint slug to the set of plan slugs it contains.
 *
 * Membership comes from the SPRINT FILE's `- [ ] [slug]` lines, parsed into
 * `sprint.members`, not from the plan's `Sprint:` back-reference field. The
 * plan "the-agents-tab-filters-to-the-sprint" measured: 19 plans in the
 * sprint file, only 5 carry the back-reference, 14 empty/placeholder/absent.
 * Joining on the field would show 5 of 19.
 *
 * Deferred plans are EXCLUDED: they are in the file under `### Deferred` and
 * are not commitments. The plan's Done-when says "does not include plans a
 * sprint deferred".
 */
export function sprintMembershipLookup(
  sprints: SprintCard[],
): Map<string, Set<string>> {
  const lookup = new Map<string, Set<string>>();
  for (const sprint of sprints) {
    const memberSlugs = new Set(
      sprint.members
        .filter((m) => m.tier !== 'deferred')
        .map((m) => m.slug),
    );
    lookup.set(sprint.slug, memberSlugs);
  }
  return lookup;
}

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
 *
 * Used for STORY filtering. Sprint filtering uses {@link withSprintCounts}
 * which joins on sprint membership rather than card.sprint.
 */
export function withCounts(
  options: FilterOption[],
  cards: Card[],
  key: 'story',
  noneSentinel: string,
): CountedFilterOption[] {
  return options.map((o) => ({
    ...o,
    count: cards.filter((c) => (o.value === noneSentinel ? !c[key] : c[key] === o.value)).length,
  }));
}

/**
 * Annotate sprint options with the number of cards in each sprint's membership.
 *
 * For sprints WITH a file in `board.sprints`, membership comes from the
 * sprint file's `- [ ] [slug]` lines — see {@link sprintMembershipLookup}.
 * For sprints WITHOUT a file (inline-only, where a plan's `Sprint:` names a
 * sprint that has no directory entry), we fall back to `card.sprint` matching.
 *
 * The "none" sentinel counts cards that are NOT a member of ANY sprint by
 * either method: neither named in a sprint file's members, nor carrying an
 * inline sprint reference.
 */
export function withSprintCounts(
  options: FilterOption[],
  cards: Card[],
  membership: Map<string, Set<string>>,
): CountedFilterOption[] {
  // A card belongs to a sprint if:
  // - its slug is in that sprint's members list (file-based), OR
  // - the sprint has no file and card.sprint matches (inline-only)
  const cardInSomeSprint = new Set<string>();
  for (const members of membership.values()) {
    for (const slug of members) cardInSomeSprint.add(slug);
  }
  // Also count cards with inline sprints (card.sprint set)
  for (const c of cards) {
    if (c.sprint) cardInSomeSprint.add(c.slug);
  }

  return options.map((o) => {
    if (o.value === NO_SPRINT) {
      // Cards not in any sprint (neither file nor inline)
      return {
        ...o,
        count: cards.filter((c) => !cardInSomeSprint.has(c.slug)).length,
      };
    }
    const members = membership.get(o.value);
    if (members) {
      // Sprint has a file: count cards whose slug is in its members
      return { ...o, count: cards.filter((c) => members.has(c.slug)).length };
    }
    // Sprint has no file (inline-only): count cards whose card.sprint matches
    return { ...o, count: cards.filter((c) => c.sprint === o.value).length };
  });
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
 *
 * Used for STORY filtering. Sprint filtering uses {@link passesSprintFilter}
 * which joins on sprint membership rather than card.sprint.
 */
export function passesFilter(
  card: Card,
  selected: string[],
  key: 'story',
  noneSentinel: string,
): boolean {
  if (selected.length === 0) return true;
  const value = card[key];
  return value ? selected.includes(value) : selected.includes(noneSentinel);
}

/**
 * Does a card pass the sprint filter?
 *
 * Empty selection = no filter (show all). A card passes if it belongs to ANY
 * selected sprint. The NO_SPRINT sentinel matches cards that belong to NO
 * sprint by either method.
 *
 * For sprints WITH a file in `board.sprints`, membership comes from the
 * sprint file's `- [ ] [slug]` lines — see {@link sprintMembershipLookup}.
 * For sprints WITHOUT a file (inline-only), we fall back to `card.sprint`.
 *
 * The plan "the-agents-tab-filters-to-the-sprint" measured: a join on
 * card.sprint alone showed 5 of 19 plans in the active sprint because 14
 * lacked the back-ref. This fixes that for sprints WITH files, while
 * preserving inline-only sprint filtering for repos without sprint files.
 */
export function passesSprintFilter(
  card: Card,
  selected: string[],
  membership: Map<string, Set<string>>,
): boolean {
  if (selected.length === 0) return true;

  // Is this card a member of any sprint at all?
  // Either via file membership OR via an inline sprint reference
  let inAnySprint = false;
  for (const members of membership.values()) {
    if (members.has(card.slug)) {
      inAnySprint = true;
      break;
    }
  }
  // Also counts if the card has an inline sprint
  if (card.sprint) inAnySprint = true;

  // Check each selected sprint
  for (const sprintSlug of selected) {
    if (sprintSlug === NO_SPRINT) {
      // The "No sprint" selection matches cards NOT in any sprint
      if (!inAnySprint) return true;
    } else {
      // Check if the sprint has a file
      const members = membership.get(sprintSlug);
      if (members) {
        // Sprint has a file: match by file membership
        if (members.has(card.slug)) return true;
      } else {
        // Sprint has no file (inline-only): match by card.sprint
        if (card.sprint === sprintSlug) return true;
      }
    }
  }
  return false;
}

import type { Board, Card, FleetSprint, SprintCard } from '../../contract/schema.js';
import { NO_SPRINT, type FilterOption } from '@plot-pm/domain';

export { NO_SPRINT, type FilterOption };
/** Sentinel for "plans with no story assigned". */
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
 *
 * Accepts both `SprintCard[]` (from board.sprints) and `FleetSprint[]` (from
 * fleet.sprints) — both carry the same `members` structure and the function
 * reads only `slug` and `members.slug` / `members.tier`.
 */
export function sprintMembershipLookup(
  sprints: SprintCard[] | FleetSprint[],
): Map<string, Set<string>> {
  const lookup = new Map<string, Set<string>>();
  for (const sprint of sprints) {
    const memberSlugs = new Set(
      sprint.members
        // A BARE MEMBER NAMES NO PLAN, so it belongs to no card. Without the
        // second filter the set holds `''`, and any card whose own slug were
        // ever empty would read as a member of this sprint.
        .filter((m) => m.tier !== 'deferred' && m.slug !== '')
        .map((m) => m.slug),
    );
    lookup.set(sprint.slug, memberSlugs);
  }
  return lookup;
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
 * Sprint filter options — the ACTIVE sprints, and only those.
 *
 * `board.sprints` is `collectSprints`' read of `<sprintDir>/active/`, so a
 * sprint that has been closed has no entry and is not offered. That is the whole
 * rule.
 *
 * **It used to union in `card.sprint` as well**, so any sprint slug written on
 * any plan became an option. Measured 2026-08-26, hours after W35 closed: the
 * filter offered three sprints — all Closed — while the Delivery tab header
 * correctly read *No active sprint*. Two views of one fact, disagreeing, because
 * a plan's `Sprint:` field is HISTORY and does not clear when its sprint ends.
 * 133 plans carry one; three sprints have ever existed; none is active. The
 * filter looked like three sprints were running.
 *
 * The union was not unreasonable — it made *what shipped in W35?* answerable,
 * and 35 plans can answer it. It is dropped anyway: a control that offers a
 * closed sprint beside an open one, with nothing to tell them apart, states
 * something untrue in order to keep a query available. The query can come back
 * behind a label that says *closed*, which needs the phase, which needs the
 * sprint FILE — `collectSprints` reads only `active/` today, so the phase is
 * simply not in reach from here.
 *
 * A consequence, accepted deliberately: **the filter is empty when no sprint is
 * active**, and `MultiSelect` renders nothing rather than a list nobody can act
 * on. An empty control and an honest one are the same control here.
 */
export function sprintFilterOptions(board: Board | null): FilterOption[] {
  return (board?.sprints ?? [])
    .map((s) => ({ value: s.slug, label: s.title }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** What the *Active sprint* button offers: a selection, and whether it can act. */
export interface ActiveSprintButton {
  /** Every slug of `sprints` — the full selection a click would set. */
  selection: string[];
  /** True when there is no Active sprint to select. */
  disabled: boolean;
  /** The reason the button is disabled, or what it does when enabled. */
  sentence: string;
}

/**
 * Select every Active sprint in one step — D32 (story Open Point 12).
 *
 * `sprints` is already the Active set (`fleet.sprints`), so the button is the
 * existing multiselect with every option checked: it answers WHICH slugs to
 * select and whether it can, and does not filter rows itself.
 */
export const activeSprintButton = (sprints: FleetSprint[]): ActiveSprintButton =>
  sprints.length === 0
    ? { selection: [], disabled: true, sentence: 'No sprint is Active.' }
    : {
        selection: sprints.map((s) => s.slug),
        disabled: false,
        sentence: `Select all ${sprints.length} Active sprints.`,
      };

/**
 * Read a comma-separated multi-value filter from the URL query.
 *
 * Returns `[]` with no `window` — a mount-time read of this kind runs during
 * server rendering too (`AgentList`'s own unit suite renders it with
 * `renderToStaticMarkup`), where there is no URL to read and "no filter" is
 * the correct answer regardless.
 */
export function readList(param: string): string[] {
  if (typeof window === 'undefined') return [];
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

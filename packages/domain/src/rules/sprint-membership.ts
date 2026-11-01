import { itemsFrom } from '../entities/sprint.js';
import { slugOf } from './state-transition.js';
import { struckSlugs } from './sprint-scope.js';

/** Which sprint a plan belongs to, and where. */
export interface SprintMembership {
  /** The sprint's slug, cut from its file name by {@link slugOf}. */
  sprint: string;
  /** The sprint file's path. */
  file: string;
}

/** One dated sprint file as read from disk. */
export interface SprintFile {
  /** The sprint file's path. */
  file: string;
  /** The whole sprint file's markdown. */
  content: string;
}

/** One sprint's reading against a plan slug: whether it lists the slug, and the sprint's own stated state and start date. */
export interface SprintListingEntry {
  /** The sprint's slug, cut from its file name by {@link slugOf}. */
  sprint: string;
  /** The sprint file's path. */
  file: string;
  /** The sprint's own `## Status` `State:` value, as the file states it. */
  state: string;
  /** The sprint's own `## Status` `Start:` value, as the file states it. */
  start: string;
}

/**
 * The plan slugs an unstruck Must/Should/Could line of a sprint file names.
 *
 * Reads every item {@link itemsFrom} finds, keeps only the Must/Should/Could
 * tiers (Deferred is never membership), and subtracts {@link struckSlugs} —
 * the one place that reads a `~~[slug]~~` line, so an item left in the
 * sprint by that strikethrough is not also counted as a commitment here.
 *
 * @param content - the whole sprint file.
 * @returns each unstruck plan slug named on a Must/Should/Could line, deduplicated.
 */
export const unstruckSprintMembers = (content: string): string[] => {
  const struck = struckSlugs(content);
  return [
    ...new Set(
      itemsFrom(content)
        .filter((item) => item.tier !== 'deferred')
        .map((item) => item.plan)
        .filter((plan) => plan !== '' && !struck.has(plan)),
    ),
  ];
};

const STATE_FIELD = /^- \*\*State:\*\* (.+)$/m;
const START_FIELD = /^- \*\*Start:\*\* (.+)$/m;

/**
 * Every sprint that lists a plan slug on an unstruck Must/Should/Could line,
 * with the sprint's own stated state and start date.
 *
 * Not consumed by this slice's callers yet: the writer and gate slices use
 * it to name "the other open sprint" in a refusal.
 *
 * @param slug - the plan's slug.
 * @param sprints - every dated sprint file.
 * @returns each listing sprint, in the order `sprints` names them.
 */
export const sprintsListing = (slug: string, sprints: readonly SprintFile[]): SprintListingEntry[] =>
  sprints
    .filter((sprint) => unstruckSprintMembers(sprint.content).includes(slug))
    .map((sprint) => ({
      sprint: slugOf('sprint', sprint.file),
      file: sprint.file,
      state: sprint.content.match(STATE_FIELD)?.[1].trim() ?? '',
      start: sprint.content.match(START_FIELD)?.[1].trim() ?? '',
    }));

/**
 * Which sprint a plan slug belongs to, among every dated sprint file.
 *
 * Considers only sprints {@link sprintsListing} names. Among those, prefers
 * a sprint whose stated state is not `Closed`, then the latest `Start:`,
 * then the file name sorting last — each tiebreak applied only when the one
 * before it leaves more than one sprint standing.
 *
 * @param slug - the plan's slug.
 * @param sprints - every dated sprint file.
 * @returns the sprint and its file, or `null` when no sprint lists the slug.
 */
export const sprintOfPlan = (slug: string, sprints: readonly SprintFile[]): SprintMembership | null => {
  const listing = sprintsListing(slug, sprints);
  if (listing.length === 0) return null;

  const open = listing.filter((entry) => entry.state !== 'Closed');
  const pool = open.length > 0 ? open : listing;

  // `Start:` can be the template's unfilled `YYYY-MM-DD`, which `Date.parse`
  // reads as `NaN` — read as the earliest possible date rather than dropped,
  // so a sprint with a real date always outranks one that never got one, and
  // two placeholder dates still tie through to the file-name tiebreak.
  const starts = pool.map((entry) => {
    const parsed = Date.parse(entry.start);
    return Number.isNaN(parsed) ? -Infinity : parsed;
  });
  const newest = Math.max(...starts);
  const latest = pool.filter((_, i) => starts[i] === newest);

  const winner = [...latest].sort((a, b) => (a.file < b.file ? 1 : -1))[0]!;
  return { sprint: winner.sprint, file: winner.file };
};

const MUST_SHOULD_COULD: ReadonlyArray<RegExp> = [/^### Must Have\b/, /^### Should Have\b/, /^### Could Have\b/];
const ANY_HEADING = /^#{2,3} /;
const MEMBER_SLUG_LINE = /^- \[( |x)\] (?:~~)?\[([a-z0-9][a-z0-9-]*)\]/;

/**
 * The line index of a plan's Must/Should/Could member line in a sprint file.
 *
 * @param content - the whole sprint file.
 * @param slug - the plan's slug.
 * @returns the zero-based line index, or `-1` when no such line exists.
 */
export const memberLineIndex = (content: string, slug: string): number => {
  const lines = content.split('\n');
  let inTier = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (ANY_HEADING.test(line)) {
      inTier = MUST_SHOULD_COULD.some((heading) => heading.test(line));
      continue;
    }
    if (!inTier) continue;
    const m = line.match(MEMBER_SLUG_LINE);
    if (m && m[2] === slug) return i;
  }
  return -1;
};

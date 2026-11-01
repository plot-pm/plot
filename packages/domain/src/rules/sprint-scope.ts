import type { FleetReading } from '../entities/fleet.js';
import { sprintFrom, sprintMembers, type Sprint } from '../entities/sprint.js';

/**
 * Why {@link sprintScope} or `sprintScopeRef` answers `none` rather than a scope.
 * `sprint-link-escapes` and `sprint-link-missing` come only from `sprintScopeRef`:
 * the active symlink points outside the sprint directory, or at no regular file.
 */
export type ScopeRefusal =
  | 'no-active-sprint'
  | 'multiple-active-sprints'
  | 'no-unstruck-items'
  | 'sprint-link-escapes'
  | 'sprint-link-missing';

/** The branches fleetd may review or merge, and why not where there are none. */
export type SprintScope =
  | { read: 'scope'; sprint: Sprint; slugs: readonly string[]; branches: readonly string[] }
  | { read: 'none'; why: ScopeRefusal };

/**
 * A struck MoSCoW line's plan slug: `~~[slug]~~` or `~~[slug](...)~~`.
 *
 * {@link itemsFrom}'s own `MEMBER_LINE` matches and discards the optional
 * `~~`, so a struck item parses identically to an unstruck one. Scanning the
 * raw text separately — rather than adding a `struck` field to `SprintItem`
 * — keeps every existing `itemsFrom` caller's output shape unchanged.
 */
const STRUCK_SLUG = /^- \[( |x)\] ~~\[([a-z0-9][a-z0-9-]*)\]/;

/**
 * The plan slugs a sprint file strikes through.
 *
 * @param content - the whole sprint file.
 * @returns each struck slug, deduplicated.
 */
export const struckSlugs = (content: string): ReadonlySet<string> =>
  new Set(
    content
      .split('\n')
      .map((line) => line.match(STRUCK_SLUG)?.[2])
      .filter((slug): slug is string => slug !== undefined),
  );

/**
 * Which branches the fleet pulse names for a set of plan slugs.
 *
 * Reads only `FleetReading.plans[].slices[].branches[].branch`, never derives
 * a branch name by convention: a plan can rename or re-slice its branches
 * between pulses, and the pulse is the one source already walked for this.
 *
 * @param slugs - the in-scope plan slugs.
 * @param pulse - the fleet's last reading.
 * @param planSlug - cuts a plan's identity from its file path.
 * @returns every branch a scope plan's pulse entry names, in pulse order.
 */
const scopedBranches = (
  slugs: ReadonlySet<string>,
  pulse: FleetReading,
  planSlug: (file: string) => string,
): readonly string[] =>
  pulse.plans
    .filter((plan) => slugs.has(planSlug(plan.file)))
    .flatMap((plan) => plan.slices)
    .flatMap((slice) => slice.branches)
    .map((branch) => branch.branch);

/**
 * The branches fleetd is allowed to review or merge right now.
 *
 * Reads the active sprint's commitment, with struck items subtracted —
 * neither `sprintFrom` nor `sprintMembers` filters them, so this is the one
 * place that does. The scope is re-derived from its inputs on every call: a
 * caller that wants it current passes a freshly-read sprint text and pulse,
 * never a cached answer.
 *
 * @param input.sprintTexts - the sprint file(s) found under the active
 *   directory, each with the slug its filename carries. Zero or two or more
 *   is itself the `none` case — mirroring `plot-sprint-release.sh`'s own
 *   threshold — never a guess at which one is current.
 * @param input.pulse - the fleet's last reading, or `null` when none exists.
 * @param input.planSlug - cuts a plan's identity from its file path, matching
 *   a sprint item's slug against `FleetReading.plans[].file`.
 * @returns `{ read: 'scope', ... }` naming the sprint, its unstruck plan
 *   slugs and the branches the pulse maps them to; `{ read: 'none', why }`
 *   when there is no single active sprint, or when every item it names is
 *   struck (never a vacuously empty scope).
 */
export const sprintScope = (input: {
  sprintTexts: readonly { content: string; slug: string }[];
  pulse: FleetReading | null;
  planSlug: (file: string) => string;
}): SprintScope => {
  if (input.sprintTexts.length === 0) return { read: 'none', why: 'no-active-sprint' };
  if (input.sprintTexts.length > 1) return { read: 'none', why: 'multiple-active-sprints' };

  const { content, slug } = input.sprintTexts[0]!;
  const sprint = sprintFrom(content, slug);
  const struck = struckSlugs(content);
  const slugs = sprintMembers(sprint).filter((s) => !struck.has(s));
  if (slugs.length === 0) return { read: 'none', why: 'no-unstruck-items' };

  const slugSet = new Set(slugs);
  const branches = input.pulse === null ? [] : scopedBranches(slugSet, input.pulse, input.planSlug);
  return { read: 'scope', sprint, slugs, branches };
};

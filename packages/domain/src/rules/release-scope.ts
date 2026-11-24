import { normalizeVersion } from '../entities/release.js';
import { planSlug } from './auto-dispatch.js';
import { groupChangesets, type ReleaseChangeset } from './release-prepare.js';

/**
 * The unstruck plan slugs under the Must, Should and Could headings of a sprint file.
 *
 * @param content - the whole sprint file.
 * @returns each slug once, in file order.
 */
export const scopeSlugs = (content: string): string[] => {
  const slugs: string[] = [];
  let inTier = false;
  for (const line of content.split('\n')) {
    if (/^#{2,3} /.test(line)) {
      inTier = /^#{2,3} (Must|Should|Could)\b/i.test(line);
      continue;
    }
    const m = inTier ? line.match(/^- \[[ x]\] \[([a-z0-9][a-z0-9-]*)\]/) : null;
    if (m?.[1] !== undefined && !slugs.includes(m[1])) slugs.push(m[1]);
  }
  return slugs;
};

/**
 * The plan slugs that shipped changesets name outside the sprint's scope.
 *
 * Splits through {@link groupChangesets}, so the sprint/outside decision has one home.
 *
 * @param shipped - the changesets the release merge removed.
 * @param slugs - the sprint scope's plan slugs.
 * @returns each named slug once, in changeset order; changesets naming no plan add none.
 */
export const namedOutsideScope = (shipped: readonly ReleaseChangeset[], slugs: readonly string[]): string[] => {
  const outside = new Set(groupChangesets(shipped, slugs).outside);
  const named: string[] = [];
  for (const c of shipped) {
    if (c.plan === '' || !outside.has(c.file)) continue;
    const slug = planSlug(c.plan);
    if (!named.includes(slug)) named.push(slug);
  }
  return named;
};

/** A sprint file as the release scope reads it, active or closed. */
export interface ReleaseScopeSprint {
  /** The sprint's slug. */
  readonly slug: string;
  /** The `State:` (or legacy `Phase:`) value as the file spells it. */
  readonly state: string;
  /** The `Start:` date as the file states it, or `''`. */
  readonly start: string;
  /** The `Release:` field as the file spells it, or `''`. */
  readonly release: string;
  /** The unstruck plan slugs of the sprint, as {@link scopeSlugs} reads them. */
  readonly slugs: readonly string[];
}

/** A plan file as the release scope reads it. */
export interface ReleaseScopePlan {
  /** The plan's slug. */
  readonly slug: string;
  /** The plan file's path, relative to the repository root; `''` where the file is absent or unreadable. */
  readonly file: string;
  /** The plan's `State:`, lower case. */
  readonly phase: string;
  /** The `Released:` record as written, or `''`. */
  readonly releasedRecord: string;
}

/** The plans and sprints one release owes. */
export interface ReleaseScope<S extends ReleaseScopeSprint> {
  /** The sprints of the release, in the order given. */
  readonly sprints: readonly S[];
  /** The unstruck plan slugs of those sprints, each once, in sprint order. */
  readonly sprintSlugs: readonly string[];
  /** The plan slugs a removed changeset names outside {@link sprintSlugs}, each once; empty where `shipped` is `'unaskable'`. */
  readonly named: readonly string[];
}

/**
 * Whether a sprint's `State:` reads closed.
 *
 * @param sprint - the sprint.
 * @returns true for `Closed` in any case.
 */
export const sprintClosed = (sprint: Pick<ReleaseScopeSprint, 'state'>): boolean =>
  sprint.state.trim().toLowerCase() === 'closed';

/**
 * The sprints and plans one release names.
 *
 * The sprints are every sprint whose `Release:` names `version`, active or
 * closed. Where no sprint names it, an open sprint with an empty `Release:`
 * whose `Start:` is empty or no later than `tagDate` is the release's sprint.
 * The named plans are the plans a removed changeset names outside those
 * sprints, through {@link namedOutsideScope}.
 *
 * @param version - the release version, canonically `vN.N.N`.
 * @param tagDate - the tag's date as `YYYY-MM-DD`, or `''` where unknown; an unknown date admits every open unnamed sprint.
 * @param sprints - every sprint file, active or closed.
 * @param shipped - the changesets the release merge removed, or `'unaskable'`.
 * @returns the scope.
 */
export const releaseScope = <S extends ReleaseScopeSprint>(
  version: string,
  tagDate: string,
  sprints: readonly S[],
  shipped: readonly ReleaseChangeset[] | 'unaskable',
): ReleaseScope<S> => {
  const named = sprints.filter((s) => s.release.trim() !== '' && normalizeVersion(s.release) === version);
  const day = tagDate.slice(0, 10);
  const inScope =
    named.length > 0
      ? named
      : sprints.filter(
          (s) => s.release.trim() === '' && !sprintClosed(s) && (day === '' || s.start.trim() === '' || s.start.trim() <= day),
        );
  const sprintSlugs: string[] = [];
  for (const s of inScope) for (const slug of s.slugs) if (!sprintSlugs.includes(slug)) sprintSlugs.push(slug);
  return {
    sprints: inScope,
    sprintSlugs,
    named: shipped === 'unaskable' ? [] : namedOutsideScope(shipped, sprintSlugs),
  };
};

/**
 * Whether the release still owes a plan its `Released:` record.
 *
 * A sprint plan is owed where it reads Delivered or Released and holds no
 * record. A plan only a changeset names is owed where it reads Delivered and
 * holds no record. A plan with no file is never owed.
 *
 * @param plan - the plan, or `undefined` where no plan file has its slug.
 * @param inSprint - whether a sprint of the release names it.
 * @returns true where booking it is still owed.
 */
export const releaseOwes = (plan: ReleaseScopePlan | undefined, inSprint: boolean): boolean =>
  plan !== undefined &&
  plan.file !== '' &&
  plan.releasedRecord.trim() === '' &&
  (plan.phase === 'delivered' || (inSprint && plan.phase === 'released'));

/**
 * The slugs of the plans a release still owes, in scope order.
 *
 * @param scope - the release's scope.
 * @param plans - every plan file read.
 * @returns the owed slugs, sprint plans first, each once.
 */
export const releaseOwed = (
  scope: Pick<ReleaseScope<ReleaseScopeSprint>, 'sprintSlugs' | 'named'>,
  plans: readonly ReleaseScopePlan[],
): string[] => {
  const bySlug = new Map(plans.map((p) => [p.slug, p]));
  return [
    ...scope.sprintSlugs.filter((slug) => releaseOwes(bySlug.get(slug), true)),
    ...scope.named.filter((slug) => releaseOwes(bySlug.get(slug), false)),
  ];
};

/**
 * A field of a sprint file's `## Status` section, as the file spells it.
 *
 * @param content - the whole sprint file.
 * @param names - the field's names; the first one the section holds answers.
 * @returns the trimmed value, or `''` where the section holds none of them.
 */
export const sprintStatusField = (content: string, names: readonly string[]): string => {
  const body = content.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  for (const name of names) {
    const value = body.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm'))?.[1];
    if (value !== undefined) return value.trim();
  }
  return '';
};

/**
 * Reads one sprint file for the release scope.
 *
 * @param file - the sprint file's path; its slug is the file name without `.md` and without a leading `YYYY-Www-`.
 * @param content - the whole sprint file.
 * @returns the slug, the `State:` (or legacy `Phase:`), the `Start:`, the `Release:` and the scope slugs.
 */
export const releaseScopeSprintOf = (file: string, content: string): ReleaseScopeSprint => ({
  slug: (file.split('/').pop() ?? file).replace(/\.md$/, '').replace(/^\d{4}-W\d{2}-/, ''),
  state: sprintStatusField(content, ['State', 'Phase']),
  start: sprintStatusField(content, ['Start']),
  release: sprintStatusField(content, ['Release']),
  slugs: scopeSlugs(content),
});

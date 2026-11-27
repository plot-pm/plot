import { normalizeVersion } from '../entities/release.js';
import { planSlug } from './auto-dispatch.js';
import { groupChangesets, type ReleaseChangeset } from './release-prepare.js';
import { releasePr, releaseTag, type ReleasePrRow, type ReleaseTagPrRow } from './release-tag.js';

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

/** One plan's slice merges, as the tag arm reads them. */
export interface ReleaseTagPlanReading {
  /**
   * One row per PR reference the plan's slice lines name, read through
   * `branchClaims` and joined with the branch's deferral; a branch whose lines
   * name neither a PR nor a commit has one `reference: null` row, and a branch
   * that names a commit and no PR has none.
   */
  readonly references: readonly ReleasePrRow[];
  /**
   * One row per non-deferred local PR and per non-deferred commit the slice
   * lines name in this repository. A PR's `mergeCommit` and `mergedAt` come
   * from its merge subject and are `''` where no merge subject names it; a
   * commit row carries `number: 0` and the commit itself.
   */
  readonly merges: readonly ReleaseTagPrRow[];
  /** Whether a non-deferred slice line names a commit in another repository. */
  readonly foreignCommit: boolean;
}

/**
 * The tag reading: per plan slug, the slice merges the tag arm reads.
 * `'unaskable'` where the read failed; a plan absent from the map has no
 * reading and the tag arm neither books it nor names it.
 */
export type ReleaseTagSlices = ReadonlyMap<string, ReleaseTagPlanReading> | 'unaskable';

/** Why the tag arm did not book a plan with a slice in the tag. */
export type ReleaseTagSkip = 'not-delivered' | 'slice-after-tag' | 'no-merge-subject' | 'slice-foreign' | 'already-released';

/** A plan the tag arm considered and did not book. */
export interface ReleaseTagSkipped {
  readonly slug: string;
  readonly reason: ReleaseTagSkip;
}

/** The plans and sprints one release owes. */
export interface ReleaseScope<S extends ReleaseScopeSprint> {
  /** The sprints of the release, in the order given. */
  readonly sprints: readonly S[];
  /** The unstruck plan slugs of those sprints, each once, in sprint order. */
  readonly sprintSlugs: readonly string[];
  /** The plan slugs a removed changeset names outside {@link sprintSlugs}, each once; empty where `shipped` is `'unaskable'`. */
  readonly named: readonly string[];
  /**
   * The Delivered plans with no `Released:` record whose every non-deferred
   * slice first shipped in this version's tag, outside {@link sprintSlugs}
   * and {@link named}, in plan order; empty where the tag reading is `'unaskable'`.
   */
  readonly tagged: readonly string[];
  /** The plans the tag arm considered and did not book, outside {@link sprintSlugs} and {@link named}, in plan order. */
  readonly tagSkipped: readonly ReleaseTagSkipped[];
}

/** What the tag arm reads from one plan's slice merges alone. */
type TagVerdict = 'in-tag' | 'slice-after-tag' | 'no-merge-subject' | 'slice-foreign' | 'outside';

/**
 * What one plan's slice merges say about one tag.
 *
 * `in-tag` where {@link releasePr} names local PRs or the plan names local
 * commits only, every row has a merge commit, {@link releaseTag} resolves to
 * `wanted` and every row's tags contain `wanted`. `no-merge-subject` where a
 * non-deferred branch names no PR or commit, or a PR has no merge subject.
 * `slice-foreign` where a non-deferred slice names a PR or commit in another
 * repository. `outside` where no row first shipped in `wanted` and no other
 * answer holds; `slice-after-tag` where one did and the plan is not `in-tag`.
 *
 * @param reading - the plan's slice merges.
 * @param wanted - the release tag, `vN.N.N`.
 * @returns the verdict, and whether a row first shipped in `wanted`.
 */
export const tagVerdict = (reading: ReleaseTagPlanReading, wanted: string): { verdict: TagVerdict; touches: boolean } => {
  const touches = reading.merges.some((row) => row.mergeCommit !== '' && row.containingTags[0] === wanted);
  const shipped = reading.references.filter((row) => !row.deferred);
  if (shipped.some((row) => row.reference === null)) return { verdict: 'no-merge-subject', touches };
  if (reading.foreignCommit || releasePr(reading.references).outcome === 'all-foreign' || shipped.some((row) => row.reference!.repo !== '')) {
    return { verdict: 'slice-foreign', touches };
  }
  if (reading.merges.length === 0) return { verdict: 'outside', touches };
  if (reading.merges.some((row) => row.mergeCommit === '')) return { verdict: 'no-merge-subject', touches };
  if (!touches) return { verdict: 'outside', touches };
  const resolved = releaseTag({ prs: reading.merges, wantedVersion: wanted });
  const all = reading.merges.every((row) => row.containingTags.includes(wanted));
  return { verdict: resolved.outcome === 'resolved' && all ? 'in-tag' : 'slice-after-tag', touches };
};

/**
 * The tag arm: the plans the tag reading books, and the candidates it does not.
 *
 * A plan is a candidate where a row first shipped in `version`'s tag, or where
 * it reads Delivered with no `Released:` record and its verdict is
 * `no-merge-subject` or `slice-foreign`. A candidate is booked where it reads
 * Delivered with no record and its verdict is `in-tag`; otherwise it carries
 * `already-released`, `not-delivered` or its verdict, in that order. Plans in
 * `taken` are left out.
 *
 * @param version - the release version, `vN.N.N`.
 * @param slices - the tag reading.
 * @param plans - every plan file read, in plan order.
 * @param taken - the slugs the sprint and changeset arms already hold.
 * @returns the booked slugs and the skipped candidates.
 */
const tagArm = (
  version: string,
  slices: ReleaseTagSlices,
  plans: readonly ReleaseScopePlan[],
  taken: ReadonlySet<string>,
): Pick<ReleaseScope<ReleaseScopeSprint>, 'tagged' | 'tagSkipped'> => {
  if (slices === 'unaskable') return { tagged: [], tagSkipped: [] };
  const tagged: string[] = [];
  const tagSkipped: ReleaseTagSkipped[] = [];
  for (const plan of plans) {
    const reading = slices.get(plan.slug);
    if (reading === undefined || plan.file === '' || taken.has(plan.slug) || tagged.includes(plan.slug)) continue;
    const { verdict, touches } = tagVerdict(reading, version);
    const owed = plan.phase === 'delivered' && plan.releasedRecord.trim() === '';
    const unproven = verdict === 'no-merge-subject' || verdict === 'slice-foreign';
    if (!touches && !(owed && unproven)) continue;
    if (owed && verdict === 'in-tag') {
      tagged.push(plan.slug);
      continue;
    }
    const reason: ReleaseTagSkip =
      plan.releasedRecord.trim() !== '' || plan.phase === 'released'
        ? 'already-released'
        : plan.phase !== 'delivered'
          ? 'not-delivered'
          : verdict === 'outside' || verdict === 'in-tag'
            ? 'slice-after-tag'
            : verdict;
    tagSkipped.push({ slug: plan.slug, reason });
  }
  return { tagged, tagSkipped };
};

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
 * sprints, through {@link namedOutsideScope}. The tagged plans are the
 * Delivered plans the tag reading places wholly in `version`'s tag, outside
 * both: see {@link tagVerdict}.
 *
 * @param version - the release version, canonically `vN.N.N`.
 * @param tagDate - the tag's date as `YYYY-MM-DD`, or `''` where unknown; an unknown date admits every open unnamed sprint.
 * @param sprints - every sprint file, active or closed.
 * @param shipped - the changesets the release merge removed, or `'unaskable'`.
 * @param slices - the tag reading, or `'unaskable'`.
 * @param plans - every plan file read, in plan order.
 * @returns the scope.
 */
export const releaseScope = <S extends ReleaseScopeSprint>(
  version: string,
  tagDate: string,
  sprints: readonly S[],
  shipped: readonly ReleaseChangeset[] | 'unaskable',
  slices: ReleaseTagSlices,
  plans: readonly ReleaseScopePlan[],
): ReleaseScope<S> => {
  const naming = sprints.filter((s) => s.release.trim() !== '' && normalizeVersion(s.release) === version);
  const day = tagDate.slice(0, 10);
  const inScope =
    naming.length > 0
      ? naming
      : sprints.filter(
          (s) => s.release.trim() === '' && !sprintClosed(s) && (day === '' || s.start.trim() === '' || s.start.trim() <= day),
        );
  const sprintSlugs: string[] = [];
  for (const s of inScope) for (const slug of s.slugs) if (!sprintSlugs.includes(slug)) sprintSlugs.push(slug);
  const named = shipped === 'unaskable' ? [] : namedOutsideScope(shipped, sprintSlugs);
  return {
    sprints: inScope,
    sprintSlugs,
    named,
    ...tagArm(version, slices, plans, new Set([...sprintSlugs, ...named])),
  };
};

/**
 * Whether the release still owes a plan its `Released:` record.
 *
 * A sprint plan is owed where it reads Delivered or Released and holds no
 * record. A plan only a changeset or the tag arm names is owed where it reads
 * Delivered and holds no record. A plan with no file is never owed.
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
 * @returns the owed slugs, sprint plans first, then changeset plans, then tagged plans, each once.
 */
export const releaseOwed = (
  scope: Pick<ReleaseScope<ReleaseScopeSprint>, 'sprintSlugs' | 'named' | 'tagged'>,
  plans: readonly ReleaseScopePlan[],
): string[] => {
  const bySlug = new Map(plans.map((p) => [p.slug, p]));
  return [
    ...scope.sprintSlugs.filter((slug) => releaseOwes(bySlug.get(slug), true)),
    ...scope.named.filter((slug) => releaseOwes(bySlug.get(slug), false)),
    ...scope.tagged.filter((slug) => releaseOwes(bySlug.get(slug), false)),
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
  slug: file.slice(file.lastIndexOf('/') + 1).replace(/\.md$/, '').replace(/^\d{4}-W\d{2}-/, ''),
  state: sprintStatusField(content, ['State', 'Phase']),
  start: sprintStatusField(content, ['Start']),
  release: sprintStatusField(content, ['Release']),
  slugs: scopeSlugs(content),
});

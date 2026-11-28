import { MERGE_SUBJECT_FORMS } from '@plot-pm/domain/adapters/host/merge-subjects';
import { branchClaims } from '@plot-pm/domain/rules/cross-repo-reference';
import { carriesMergeOf, mergedBySubject } from '@plot-pm/domain/rules/merge-subject';
import type { ReleaseTagPlanReading, ReleaseTagSlices } from '@plot-pm/domain/rules/release-scope';
import type { ReleasePrRow, ReleaseTagPrRow } from '@plot-pm/domain/rules/release-tag';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';
import type { PlanRecordBranch } from '@plot-pm/domain/ports/plan-store';
import type { MergeCommit, Refs } from '@plot-pm/domain/ports/refs';

/** How many merges one walk reads at most, per ref. */
export const TAG_SLICES_WALK_LIMIT = 20000;

/** The repository reads the tag reading needs; none of them reaches a host. */
export type TagSlicesRefs = Pick<Refs, 'mergeSubjects' | 'listBranches' | 'commitSubjects' | 'tagsContaining' | 'remoteUrl'>;

/** One plan, as the tag reading needs it. */
export interface TagSlicesPlan {
  /** The plan's slug. */
  readonly slug: string;
  /** The plan file's text. */
  readonly text: string;
  /** Every branch line of the plan's slices, as the plan parser read them. */
  readonly branches: readonly PlanRecordBranch[];
}

/**
 * The branch prefixes a plan's own slice branches use, without the slash.
 *
 * @param branches - the plan's branch lines.
 * @returns each first path segment once.
 */
const prefixesOf = (branches: readonly PlanRecordBranch[]): readonly string[] => [
  ...new Set(branches.filter((b) => b.branch.includes('/')).map((b) => b.branch.slice(0, b.branch.indexOf('/')))),
];

/**
 * Reads, for each plan, the slice merges the release scope's tag arm decides on.
 *
 * Every answer comes from the local clone; no call reaches a host. A slice
 * PR is the `→ #N` a slice line names, read through `branchClaims` and joined
 * with the branch's deferral. Its merge commit is the newest merge on
 * `mainRef` or on an `origin/sprint/*` branch whose subject is a host's merge
 * subject for that PR number and branch, with every host's form tried and the
 * origin's owner pinned where it reads. A slice line's `→ commit <sha>` in
 * this repository is its own merge commit. Each merge commit's tags come from
 * `Refs.tagsContaining`, `[]` where that read fails.
 *
 * @param refs - the repository reads.
 * @param plans - the plans to read; an empty list reads nothing.
 * @param mainRef - the default branch's remote ref, such as `origin/main`.
 * @returns the reading per plan slug; `'unaskable'` where a walk of
 *   `mainRef` or of a sprint branch, or the branch listing, failed.
 */
export const readTagSlices = async (
  refs: TagSlicesRefs,
  plans: readonly TagSlicesPlan[],
  mainRef: string,
): Promise<ReleaseTagSlices> => {
  if (plans.length === 0) return new Map();
  const listed = await refs.listBranches(true);
  if (!listed.ok) return 'unaskable';
  const walked = [mainRef, ...listed.value.filter((b) => b.startsWith('sprint/')).map((b) => `origin/${b}`)];
  const merges: MergeCommit[] = [];
  const seen = new Set<string>();
  for (const ref of walked) {
    const read = await refs.mergeSubjects(ref, TAG_SLICES_WALK_LIMIT);
    if (!read.ok) return 'unaskable';
    for (const merge of read.value) {
      if (seen.has(merge.sha)) continue;
      seen.add(merge.sha);
      merges.push(merge);
    }
  }
  const remote = await refs.remoteUrl('origin');
  const owner = remote.ok ? ownerOfRemote(remote.value) : null;
  const forms = Object.values(MERGE_SUBJECT_FORMS).flat();
  const subjectOf = new Map(merges.map((m) => [m.sha, m.subject]));
  const claimsOf = new Map(plans.map((p) => [p.slug, branchClaims(p.text, prefixesOf(p.branches))]));
  const asked = [...new Set([...claimsOf.values()].flatMap((claims) => claims.map((c) => c.branch)))];
  const matches = mergedBySubject({ subjects: merges, branches: asked, forms, owner });

  const tagMemo = new Map<string, Promise<readonly string[]>>();
  const tagsOf = (sha: string): Promise<readonly string[]> => {
    const held = tagMemo.get(sha);
    if (held !== undefined) return held;
    // plot-ancestry: evidence — `releaseTag` decides; a tag that does not
    // contain the commit books nothing, and a failed read answers `[]`.
    const read = refs.tagsContaining(sha).then((r) => (r.ok ? r.value : []));
    tagMemo.set(sha, read);
    return read;
  };
  const mergedAtOf = async (sha: string): Promise<string> => {
    const read = await refs.commitSubjects(`${sha}^!`);
    const at = read.ok ? read.value[0]?.at : undefined;
    return at === undefined ? '' : new Date(at).toISOString();
  };
  const rowFor = async (number: number, sha: string): Promise<ReleaseTagPrRow> => {
    const mergedAt = sha === '' ? '' : await mergedAtOf(sha);
    if (mergedAt === '') return { number, mergeCommit: '', mergedAt: '', containingTags: [] };
    return { number, mergeCommit: sha, mergedAt, containingTags: await tagsOf(sha) };
  };

  const out = new Map<string, ReleaseTagPlanReading>();
  for (const plan of plans) {
    const deferred = new Map(plan.branches.map((b) => [b.branch, b.deferred]));
    const commits = new Map(plan.branches.map((b) => [b.branch, b.commits ?? []]));
    const references: ReleasePrRow[] = claimsOf
      .get(plan.slug)!
      .filter((c) => c.reference !== null || (commits.get(c.branch) ?? []).length === 0)
      .map((c) => ({ reference: c.reference, deferred: deferred.get(c.branch) ?? false }));
    const rows: ReleaseTagPrRow[] = [];
    for (const claim of claimsOf.get(plan.slug)!) {
      if (claim.reference === null || claim.reference.repo !== '' || deferred.get(claim.branch) === true) continue;
      const { number } = claim.reference;
      const hit = matches.find(
        (m) => m.branch === claim.branch && carriesMergeOf({ subjects: [subjectOf.get(m.sha) ?? ''], number, branch: claim.branch, forms, owner }),
      );
      rows.push(await rowFor(number, hit?.sha ?? ''));
    }
    const shipped = plan.branches.filter((b) => !b.deferred).flatMap((b) => b.commits ?? []);
    for (const commit of shipped.filter((c) => !c.includes('@'))) rows.push(await rowFor(0, commit));
    out.set(plan.slug, { references, merges: rows, foreignCommit: shipped.some((c) => c.includes('@')) });
  }
  return out;
};

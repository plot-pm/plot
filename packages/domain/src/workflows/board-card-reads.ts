import type { DeliveredInput, SprintsValue, StoriesValue, StoryRecord } from '../entities/board-readings.js';
import type { BranchPlansValue } from '../entities/snapshot.js';
import { answered, failed, type PortResult } from '../port-result.js';
import type { PlanRecord, PlanStore } from '../ports/plan-store.js';
import type { Refs } from '../ports/refs.js';
import { branchPlanSet, isPlanBlob, type BranchPlanTree } from '../rules/branch-plans.js';
import { sprintRecordOf } from '../rules/sprint-record.js';
import { designDocsIn, storyRecordOf } from '../rules/story-record.js';
import { verificationClaimLines } from '../rules/verification-record.js';
import { listRecordBlobs, type RecordSource } from './record-listing.js';

/** The object name git gives an empty file; a branch plan with no bytes gets no record. */
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

/** The directory part of a repository path, or `''`. */
const dirOf = (file: string): string => file.slice(0, Math.max(0, file.lastIndexOf('/')));

/** The basename of a repository path. */
const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/**
 * The verification inputs of every Delivered plan among `records`.
 *
 * @param refs - the ref reader.
 * @param records - the parsed plans and the blob each was read from.
 * @param recordRef - the ref that holds the `Delivered:` records, such as `origin/main`.
 * @returns plan path → its claim lines and delivery commit. A plan whose text
 *   is not in the answer, or whose delivery commit cannot be read, is absent.
 *   Fails where the blobs cannot be read.
 */
export const readDeliveredInputs = async (
  refs: Refs,
  records: readonly { readonly record: PlanRecord; readonly sha: string }[],
  recordRef: string,
): Promise<PortResult<Record<string, DeliveredInput>>> => {
  const delivered = records.filter(({ record }) => record.phase === 'delivered');
  if (delivered.length === 0) return answered({});
  const texts = await refs.readBlobs(delivered.map(({ sha }) => sha));
  if (!texts.ok) return failed();
  const found: Record<string, DeliveredInput> = {};
  for (const { record, sha } of delivered) {
    const text = texts.value.get(sha);
    if (text === undefined) continue;
    const commit = await refs.recordCommit(record.file, 'Delivered', recordRef);
    if (!commit.ok) continue;
    found[record.file] = { claimLines: verificationClaimLines(text), deliveryCommit: commit.value };
  }
  return answered(found);
};

/** What {@link readBranchPlans} reads beside the ports. */
export interface BranchPlansInput {
  /** The default branch's name. */
  readonly mainBranch: string;
  /** The commit `origin/<mainBranch>` resolved to. */
  readonly mainSha: string;
  readonly planDir: string;
  /** The configured branch prefixes without a trailing slash, such as `['idea', 'feature']`. */
  readonly prefixes: readonly string[];
  /** Where the `State branch` records live; the state ref's plans count as on the default branch. */
  readonly recordSource: RecordSource;
}

/**
 * The parsed plans on prefixed branches that the default branch does not
 * hold, selected by `branchPlanSet`.
 *
 * @param refs - the ref reader.
 * @param store - the plan store that parses blobs by object name.
 * @param input - the default branch, its commit, the plan directory and the prefixes.
 * @returns one entry per selected plan, in branch order, with its record. A
 *   branch whose containment cannot be read is read as not contained; a
 *   branch whose tree cannot be listed adds no plan; an empty plan file is
 *   skipped. Fails where the branches or the default branch's plans cannot be
 *   listed, or the parse fails.
 */
export const readBranchPlans = async (
  refs: Refs,
  store: PlanStore,
  input: BranchPlansInput,
): Promise<PortResult<BranchPlansValue>> => {
  if (input.prefixes.length === 0) return answered([]);
  const tips = await refs.branchTips(input.prefixes.map((p) => `refs/remotes/origin/${p}/*`));
  if (!tips.ok) return failed();
  const branches = tips.value.filter((tip) => tip.branch !== '' && tip.branch !== input.mainBranch);
  if (branches.length === 0) return answered([]);
  const onDefault = await listRecordBlobs(refs, input.recordSource, input.mainSha, input.planDir);
  if (!onDefault.ok) return failed();
  // plot-ancestry: prefilter — a "yes" only skips listing a branch's tree; a
  // wrong "no" or "unknown" costs one listing, and `onDefault` still drops any
  // path the default branch carries.
  const contained = await refs.containsMany(branches.map((tip) => ({ ancestor: tip.sha, descendant: input.mainSha })));
  const trees: BranchPlanTree[] = [];
  for (const [at, tip] of branches.entries()) {
    const merged = contained.ok ? contained.value[at] ?? 'unknown' : 'unknown';
    if (merged === 'yes') {
      trees.push({ branch: tip.branch, merged, blobs: null });
      continue;
    }
    const listed = await refs.listBlobs(`origin/${tip.branch}`, input.planDir);
    trees.push({ branch: tip.branch, merged, blobs: listed.ok ? listed.value : null });
  }
  const picked = branchPlanSet(
    trees,
    new Set(onDefault.value.filter(isPlanBlob).map((blob) => blob.path)),
  ).filter((ref) => ref.sha !== EMPTY_BLOB);
  const parsed = await store.readPlansAt(picked.map(({ sha, path }) => ({ sha, path })), input.prefixes);
  if (!parsed.ok) return failed();
  return answered(picked.map(({ branch, path }, at) => ({ branch, path, record: parsed.value[at]! })));
};

/**
 * The markdown files beneath `dir` at `ref`, by repository path, in listing order.
 *
 * @returns the files and every listed path, or a failure where the listing or the blobs cannot be read.
 */
const readMarkdown = async (
  refs: Refs,
  ref: string,
  dir: string,
): Promise<PortResult<{ files: [string, string][]; paths: string[] }>> => {
  const listing = await refs.listBlobs(ref, dir);
  if (!listing.ok) return failed();
  const blobs = listing.value.filter(isPlanBlob);
  const read = blobs.length === 0 ? answered(new Map<string, string>()) : await refs.readBlobs(blobs.map((b) => b.sha));
  if (!read.ok) return failed();
  const files: [string, string][] = [];
  for (const blob of blobs) {
    const text = read.value.get(blob.sha);
    if (text !== undefined) files.push([blob.path, text]);
  }
  return answered({ files, paths: blobs.map((b) => b.path) });
};

/**
 * The sprint files in `<sprintDir>/active/` at `ref`, parsed by `sprintRecordOf`.
 *
 * @param refs - the ref reader.
 * @param ref - the ref to read, such as `origin/main`.
 * @param sprintDir - the configured sprint directory, such as `docs/sprints/`.
 * @returns each file that parses as a sprint, in listing order. Fails where
 *   the listing or the blobs cannot be read.
 */
export const readSprints = async (refs: Refs, ref: string, sprintDir: string): Promise<PortResult<SprintsValue>> => {
  const read = await readMarkdown(refs, ref, `${sprintDir.replace(/\/+$/, '')}/active`);
  if (!read.ok) return failed();
  return answered(
    read.value.files.flatMap(([path, text]) => {
      const sprint = sprintRecordOf(text, path);
      return sprint === null ? [] : [{ path, sprint }];
    }),
  );
};

/**
 * The story files beneath `storyDir` at `ref`, parsed by `storyRecordOf`.
 *
 * A file named `STORY-<slug>.md` is a story; one under an `archived`
 * directory is an archived story. A slug read twice is kept at its first
 * path. Each story lists the `DESIGN-*.md` files beside it at `ref`.
 *
 * @param refs - the ref reader.
 * @param ref - the ref to read, such as `origin/main`.
 * @param storyDir - the configured story directory, such as `docs/stories/`.
 * @param legacyIssueKey - the front-matter key read for a story's ticket where `issue:` names none.
 * @returns the live and the archived stories, in listing order. Fails where
 *   the listing or the blobs cannot be read.
 */
export const readStories = async (
  refs: Refs,
  ref: string,
  storyDir: string,
  legacyIssueKey: string,
): Promise<PortResult<StoriesValue>> => {
  const read = await readMarkdown(refs, ref, storyDir);
  if (!read.ok) return failed();
  const live: StoryRecord[] = [];
  const archived: StoryRecord[] = [];
  for (const [path, text] of read.value.files) {
    const slug = /^STORY-(.+)\.md$/.exec(baseOf(path))?.[1];
    if (slug === undefined) continue;
    const into = path.split('/').includes('archived') ? archived : live;
    if (into.some((story) => story.slug === slug)) continue;
    into.push(storyRecordOf(text, slug, path, designDocsIn(read.value.paths, dirOf(path)), legacyIssueKey));
  }
  return answered({ live, archived });
};

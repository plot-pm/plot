import { answered, failed, type PortResult } from '../port-result.js';
import type { PlanRecord, PlanStore } from '../ports/plan-store.js';
import type { Refs } from '../ports/refs.js';
import { estatePlans, type EstateIndexLink, type EstatePlanBlob } from '../rules/plan-walk-estate.js';

/** What the estate stage is asked. */
export interface EstateInput {
  /** The default branch's name, such as `main`. */
  mainBranch: string;
  /** The plan directory, such as `docs/plans/`. */
  planDir: string;
  /** The active-index directory. */
  activeDir: string;
  /** The delivered-index directory. */
  deliveredDir: string;
  /** The configured branch prefixes without a trailing slash, such as `['idea', 'feature']`. */
  prefixes: readonly string[];
}

/** The estate: which plans exist, parsed from the snapshot's object names. */
export interface Estate {
  /** The default branch's commit the estate was read at. */
  mainSha: string;
  /** One record per plan blob, in enumeration order, beside where it was found. */
  plans: ReadonlyArray<{ blob: EstatePlanBlob; record: PlanRecord }>;
  /** The symlinks in the active and delivered indexes. */
  indexes: readonly EstateIndexLink[];
  /** Default-branch symlinks whose target the snapshot does not hold. */
  dangling: readonly string[];
  /**
   * Where the plans were read: `worktree` where the default branch did not
   * resolve and the plans came from the checkout, with `mainSha` `''`.
   * Absent means `ref`.
   */
  source?: 'ref' | 'worktree';
}

/**
 * Reads the estate: the walk's first stage.
 *
 * Resolves the default branch and every prefix branch to a commit ONCE, lists
 * each at that commit, and parses the plan blobs by object name. A fetch that
 * lands during the read moves no name this function looks up again.
 *
 * AN UNREADABLE SNAPSHOT FAILS THE BEAT. The default branch not resolving, a
 * tree not listing, a symlink or plan blob not reading, or the parser
 * rejecting a file each answer `failed`, never an empty estate: an empty
 * answer is indistinguishable from a repository with no plans, and the board
 * would drop every plan when one fetch glitched.
 *
 * A DEFAULT BRANCH THAT DOES NOT RESOLVE READS THE CHECKOUT where `worktree`
 * is given, as `plot-fleet-scan.sh` does for a repository with no remote or
 * with refs never fetched: every `*.md` file directly in the plan directory,
 * parsed through `worktree.readPlans`, with `source` `worktree`, `mainSha`
 * `''`, no branch plans and no index links. A plan directory that cannot be
 * listed or a parser failure still answers `failed`.
 *
 * @param refs - the ref reader.
 * @param plans - the plan store, read through `readPlansAt`.
 * @param input - the configuration the stage needs.
 * @param worktree - the plan store over the checkout, read where the default
 *   branch does not resolve. Absent, that case answers `failed`.
 * @returns the estate, or a failure when any part of the snapshot is unreadable.
 */
export const readEstate = async (
  refs: Refs,
  plans: PlanStore,
  input: EstateInput,
  worktree?: PlanStore,
): Promise<PortResult<Estate>> => {
  const mainSha = await refs.resolve(`origin/${input.mainBranch}`);
  if (!mainSha.ok || mainSha.value === '') {
    return worktree === undefined ? failed<Estate>() : readWorktreeEstate(worktree, input.planDir);
  }
  const main = await refs.listBlobs(mainSha.value, input.planDir);
  if (!main.ok) return failed<Estate>();

  const tips = await refs.branchTips(input.prefixes.map((p) => `refs/remotes/origin/${p}/*`));
  if (!tips.ok) return failed<Estate>();
  const ordered = [...tips.value]
    .filter((tip) => tip.branch !== input.mainBranch && tip.branch !== 'HEAD')
    .sort((a, b) => (a.branch < b.branch ? -1 : 1));
  const branches = [];
  for (const tip of ordered) {
    const blobs = await refs.listBlobs(tip.sha, input.planDir);
    if (!blobs.ok) return failed<Estate>();
    branches.push({ branch: tip.branch, blobs: blobs.value });
  }

  const linkShas = main.value.filter((blob) => blob.mode === '120000').map((blob) => blob.sha);
  const linkTexts = await refs.readBlobs(linkShas);
  if (!linkTexts.ok) return failed<Estate>();
  if (linkShas.some((sha) => !linkTexts.value.has(sha))) return failed<Estate>();

  const found = estatePlans({
    planDir: input.planDir,
    activeDir: input.activeDir,
    deliveredDir: input.deliveredDir,
    main: main.value,
    links: linkTexts.value,
    branches,
  });
  const records = await plans.readPlansAt(
    found.plans.map(({ sha, path }) => ({ sha, path })),
    input.prefixes,
  );
  if (!records.ok) return records as PortResult<never>;
  return answered({
    source: 'ref',
    mainSha: mainSha.value,
    plans: found.plans.map((blob, at) => ({ blob, record: records.value[at]! })),
    indexes: found.indexes,
    dangling: found.dangling,
  });
};

/**
 * Reads the plans directly in the checkout's plan directory.
 *
 * @param worktree - the plan store over the checkout.
 * @param planDir - the plan directory, such as `docs/plans/`.
 * @returns the estate with `source` `worktree`, or a failure where the
 *   directory cannot be listed or a plan cannot be parsed.
 */
const readWorktreeEstate = async (worktree: PlanStore, planDir: string): Promise<PortResult<Estate>> => {
  const dir = planDir.endsWith('/') ? planDir : `${planDir}/`;
  const names = await worktree.listDir(dir);
  if (!names.ok) return failed<Estate>();
  const files = names.value.filter((name) => name.endsWith('.md')).map((name) => `${dir}${name}`);
  const records = await worktree.readPlans(files);
  if (!records.ok) return records as PortResult<never>;
  return answered({
    source: 'worktree',
    mainSha: '',
    plans: records.value.map((record) => ({ blob: { sha: '', path: record.file, source: 'main' }, record })),
    indexes: [],
    dangling: [],
  });
};

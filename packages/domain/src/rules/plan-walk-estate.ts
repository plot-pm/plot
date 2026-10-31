import type { TreeBlob } from '../ports/refs.js';

/** The directory part of a slash-separated path; `''` for a bare name. */
const dirOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
};

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Resolves `.` and `..` segments the way `path.join` does for a relative link. */
const joinPath = (dir: string, link: string): string => {
  const out: string[] = [];
  for (const part of `${dir}/${link}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};

/** One prefix branch's plan-directory listing, taken at the tip the snapshot named. */
export interface EstateBranchListing {
  /** The branch name without `origin/`. */
  branch: string;
  /** Every blob beneath the plan directory at that tip. */
  blobs: readonly TreeBlob[];
}

/** The readings the estate stage reads, all taken from one snapshot. */
export interface EstateReadings {
  /** The plan directory with a trailing slash, such as `docs/plans/`. */
  planDir: string;
  /** The active-index directory with a trailing slash. */
  activeDir: string;
  /** The delivered-index directory with a trailing slash. */
  deliveredDir: string;
  /** Every blob beneath the plan directory on the default branch's snapshot. */
  main: readonly TreeBlob[];
  /** Each symlink blob's content, keyed by object name: the target path it holds. */
  links: ReadonlyMap<string, string>;
  /** The prefix branches in ref order, the default branch excluded. */
  branches: readonly EstateBranchListing[];
}

/** One plan blob the estate holds, and where it was found. */
export interface EstatePlanBlob {
  /** The blob's object name. */
  sha: string;
  /** The path the plan is reported under. */
  path: string;
  /** `main` for the default branch, otherwise the branch that supplied the plan. */
  source: string;
}

/** One symlink in an index directory. */
export interface EstateIndexLink {
  /** Which index the link is in. */
  index: 'active' | 'delivered';
  /** The link's own path. */
  path: string;
  /** The path the link holds, verbatim. */
  target: string;
}

/** The estate stage's answer. */
export interface EstatePlans {
  /** The blobs to parse, in the order the shell scan enumerates them. */
  plans: readonly EstatePlanBlob[];
  /** The symlinks in the active and delivered indexes. */
  indexes: readonly EstateIndexLink[];
  /** Default-branch symlinks in the plan directory whose target the snapshot does not hold. */
  dangling: readonly string[];
}

/**
 * Enumerates which plan blobs the estate holds.
 *
 * Follows `plot-fleet-scan.sh`'s `enumerate_estate` in ref mode: the plan
 * directory of the default branch, one level, following a symlink to its
 * target; then, for each prefix branch in order, each regular `.md` file one
 * level under the plan directory that the default branch does not carry and no
 * earlier branch supplied. Index links come from the same default-branch
 * snapshot. Computes no eligibility and no branch state.
 *
 * @param readings - the listings of one snapshot.
 * @returns the plan blobs in enumeration order, the index links, and any
 *   symlink whose target the snapshot does not hold.
 */
export const estatePlans = (readings: EstateReadings): EstatePlans => {
  const dir = readings.planDir.replace(/\/$/, '');
  const direct = (blob: TreeBlob): boolean => blob.path.endsWith('.md') && dirOf(blob.path) === dir;
  const shaAt = new Map(readings.main.map((blob) => [blob.path, blob.sha] as const));

  const plans: EstatePlanBlob[] = [];
  const dangling: string[] = [];
  const onDefault = new Set<string>();
  for (const blob of readings.main.filter(direct)) {
    onDefault.add(blob.path);
    if (blob.mode !== '120000') {
      plans.push({ sha: blob.sha, path: blob.path, source: 'main' });
      continue;
    }
    const link = (readings.links.get(blob.sha) ?? '').trim();
    const resolved = link.startsWith('/') ? `${dir}/${baseOf(link)}` : joinPath(dirOf(blob.path), link);
    const sha = shaAt.get(resolved);
    if (sha === undefined) dangling.push(blob.path);
    else plans.push({ sha, path: resolved, source: 'main' });
  }

  const seen = new Set<string>();
  for (const { branch, blobs } of readings.branches) {
    for (const blob of blobs.filter(direct)) {
      if (!['100644', '100755'].includes(blob.mode) || onDefault.has(blob.path) || seen.has(blob.path)) continue;
      seen.add(blob.path);
      plans.push({ sha: blob.sha, path: blob.path, source: branch });
    }
  }

  const indexDirs: ReadonlyArray<readonly ['active' | 'delivered', string]> = [
    ['active', readings.activeDir.replace(/\/$/, '')],
    ['delivered', readings.deliveredDir.replace(/\/$/, '')],
  ];
  const indexes = readings.main.flatMap((blob) =>
    blob.mode !== '120000'
      ? []
      : indexDirs.flatMap(([index, indexDir]) =>
          dirOf(blob.path) === indexDir
            ? [{ index, path: blob.path, target: (readings.links.get(blob.sha) ?? '').trim() }]
            : [],
        ),
  );
  return { plans, indexes, dangling };
};

/**
 * Where Plot creates dispatch worktrees and writes its action records.
 *
 * One rule, so that every reader looks in one place for one desk. The answer is
 * `<repo>/.worktrees` unless the repository configured a `Worktree root`, in
 * which case an absolute value is taken as given and a relative one resolves
 * against the repository root.
 *
 * It is string work: no path it returns need exist, and it reaches no
 * filesystem. The domain may import `zod` and nothing else outside
 * `adapters/`, so the composition here is plain string handling rather than
 * `node:path`.
 *
 * Paths are POSIX: a value is absolute when it starts with `/`. Plot's shell
 * estate and its board both run on POSIX paths, and a Windows drive letter is
 * not a shape this rule has ever been handed.
 *
 * @concept desk-root
 */

/** The directory under the repository root when nothing is configured. */
export const DEFAULT_DESK_ROOT = '.worktrees';

/** What the caller read before asking. */
export interface DeskRootReading {
  /** The `Worktree root` value as configured; empty when the key is absent. */
  readonly configured: string;
  /**
   * Absolute path to the repository's MAIN checkout.
   *
   * The caller resolves it. This composes strings and reaches no working
   * directory, so a relative root composes a relative answer — which a caller
   * would then resolve against its own cwd rather than the repository's.
   */
  readonly repoRoot: string;
}

/** A path, and where it sits relative to the repository. */
export interface DeskRootPlacement {
  /** Whether the desk root lies inside the repository. */
  readonly inside: boolean;
  /**
   * The desk root as a repository-relative path with a leading and trailing
   * `/`, in the form `git check-ignore` and `info/exclude` take — `undefined`
   * when the root lies outside the repository.
   */
  readonly excludeLine?: string;
}

/** Removes trailing `/` from a path, keeping a lone `/` intact. */
const trimTrailing = (p: string): string => {
  let end = p.length;
  while (end > 1 && p[end - 1] === '/') end -= 1;
  return p.slice(0, end);
};

/** Joins a segment under a root, never doubling the separator. */
const join = (root: string, segment: string): string =>
  root.endsWith('/') ? `${root}${segment}` : `${root}/${segment}`;

/**
 * Resolves the desk root from the configured value and the repository root.
 *
 * An empty `configured` is the absent row, never a relative path: a repository
 * that declares the key with no value has configured nothing.
 *
 * @param reading - the configured `Worktree root` and the main checkout's path.
 * @returns an absolute directory path with no trailing slash; it need not exist.
 */
export const deskRoot = (reading: DeskRootReading): string => {
  const root = trimTrailing(reading.repoRoot.trim());
  const configured = reading.configured.trim();
  if (configured === '') return join(root, DEFAULT_DESK_ROOT);
  if (configured.startsWith('/')) return trimTrailing(configured);
  return join(root, trimTrailing(configured));
};

/**
 * Whether a desk root lies inside the repository, and the line that excludes it.
 *
 * A root equal to the repository root is not inside it: excluding the whole
 * checkout is never the answer, and no configured value composes to one.
 *
 * @param reading - the configured `Worktree root` and the main checkout's path.
 * @returns whether the root is inside the repository, and its exclude line.
 */
export const deskRootPlacement = (reading: DeskRootReading): DeskRootPlacement => {
  const root = trimTrailing(reading.repoRoot.trim());
  const resolved = deskRoot(reading);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!resolved.startsWith(prefix)) return { inside: false };
  return { inside: true, excludeLine: `/${resolved.slice(prefix.length)}/` };
};

/**
 * The filesystem types a desk root may not lie on. A FIFO on a network
 * filesystem lives in each host's kernel, so a liveness token read from
 * another host answers `released` for a live agent.
 */
export const NETWORK_FILESYSTEMS: readonly string[] = ['nfs', 'smbfs', 'cifs', 'afpfs', 'webdav'];

/**
 * The refusal for a desk root on a network filesystem.
 *
 * @param root - the desk root.
 * @param type - the filesystem type of the root, or of its nearest existing parent; `null` where it could not be read.
 * @returns the reason the root is refused, naming the type; `null` for a type outside {@link NETWORK_FILESYSTEMS} or an unread one.
 */
export const deskRootRefusal = (root: string, type: string | null): string | null =>
  type !== null && NETWORK_FILESYSTEMS.includes(type)
    ? `the desk root ${root} lies on a ${type} filesystem; desks must be on a local filesystem`
    : null;

/** Linux `statfs` magic numbers and the names `mount` prints for them. */
const LINUX_MAGIC: Readonly<Record<number, string>> = {
  0x6969: 'nfs',
  0x517b: 'smbfs',
  0xff534d42: 'cifs',
  0xfe534d42: 'cifs',
  0xef53: 'ext4',
  0x58465342: 'xfs',
  0x9123683e: 'btrfs',
  0x01021994: 'tmpfs',
  0x794c7630: 'overlay',
  0x65735546: 'fuse',
};

/**
 * The filesystem type name for a Linux `statfs` magic number.
 *
 * @param magic - `f_type` as `statfs` returns it.
 * @returns the name, or the number in hex where it is not one this table names.
 */
export const linuxFilesystemName = (magic: number): string => LINUX_MAGIC[magic >>> 0] ?? `0x${(magic >>> 0).toString(16)}`;

/**
 * The filesystem type of the mount that holds a path, from macOS `mount` output.
 *
 * Each line reads `<device> on <mount point> (<type>, <options>)`. The longest
 * mount point that is the path or a parent of it wins.
 *
 * @param mountOutput - what `mount` printed.
 * @param path - an absolute, resolved path.
 * @returns the type, or `null` where no line holds the path.
 */
export const mountTypeOf = (mountOutput: string, path: string): string | null => {
  let best: { point: string; type: string } | null = null;
  for (const line of mountOutput.split('\n')) {
    const m = / on (\/.*?) \(([^,)]+)[,)]/.exec(line);
    if (m === null) continue;
    const point = m[1]!;
    const inside = point === '/' || path === point || path.startsWith(`${point}/`);
    if (inside && (best === null || point.length > best.point.length)) best = { point, type: m[2]!.trim() };
  }
  return best?.type ?? null;
};

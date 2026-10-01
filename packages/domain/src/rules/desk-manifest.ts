/**
 * The join between a desk and the manifest that names it.
 *
 * A manifest's `worktree` field is the ONE link from an agent to the desk it
 * works in. Four readers made that join in four ways and they disagreed: the
 * shell derived the directory from the desk instead of the main checkout and
 * ignored the `Agent registry` key, the supervisor matched on the raw path
 * alone, and two more each resolved the directory privately. This rule is the
 * join, and every reader asks it.
 *
 * It is string work: no path it returns need exist, and it reaches no
 * filesystem. The caller takes the readings — it resolves the desk's realpath
 * and reads the manifests — and hands them in as values. The domain may import
 * `zod` and nothing else outside `adapters/`, so the path composition here is
 * plain string handling rather than `node:path`.
 *
 * Paths are POSIX: a value is absolute when it starts with `/`. Plot's shell
 * estate and its board both run on POSIX paths, and a Windows drive letter is
 * not a shape this rule has ever been handed.
 *
 * @concept desk-manifest
 */

/** The directory under the main checkout when `Agent registry` is absent. */
export const DEFAULT_MANIFEST_DIR = '.plot/agents';

/** What the caller read before asking where the manifests are. */
export interface ManifestDirectoryReading {
  /**
   * Absolute path to the repository's MAIN checkout.
   *
   * Never a desk. A relative `Agent registry` joins to this, and a desk must
   * resolve the same directory the checkout does — the reason `CLAUDE.md`
   * already gives for `Board artifact` and `Agent settings`.
   */
  readonly mainCheckout: string;
  /** The `Agent registry` value as configured; empty when the key is absent. */
  readonly configured: string;
}

/** What the caller read of one manifest file. */
export interface ManifestReading {
  /** The manifest file's own path. */
  readonly path: string;
  /** The manifest's `worktree` field, verbatim; empty when it carries none. */
  readonly worktree: string;
  /**
   * The `worktree` field resolved through `realpath`, when the caller could
   * resolve it.
   *
   * The dispatcher records a RESOLVED path, but a manifest may have been
   * written against a symlinked one — and a desk registered by its symlinked
   * path must still be found by its real one. So BOTH sides carry both forms
   * and either matches either. Absent when the path could not be resolved,
   * which a reader must not treat as a non-match.
   */
  readonly worktreeReal?: string;
}

/** What the caller read of the desk it is asking about. */
export interface DeskManifestReading {
  /** The desk's path as the caller was handed it. */
  readonly desk: string;
  /** The same desk through `realpath`; the caller passes `desk` when it could not resolve it. */
  readonly deskReal: string;
  /** Every manifest the caller could read, in any order. */
  readonly manifests: readonly ManifestReading[];
}

/** Exactly one manifest names the desk. */
export interface NamedDesk {
  readonly kind: 'named';
  /** That manifest's path. */
  readonly path: string;
}

/** No manifest names the desk. */
export interface UnnamedDesk {
  readonly kind: 'unnamed';
}

/** More than one manifest names the desk — an estate defect. */
export interface SeveralDesk {
  readonly kind: 'several';
  /** Every manifest that named it, in the order the readings were given. */
  readonly paths: readonly string[];
}

/** Which manifest names a desk, or that none or several do. */
export type DeskManifest = NamedDesk | UnnamedDesk | SeveralDesk;

/** Removes trailing `/` from a path, keeping a lone `/` intact. */
const trimTrailing = (p: string): string => {
  let end = p.length;
  while (end > 1 && p[end - 1] === '/') end -= 1;
  return p.slice(0, end);
};

/**
 * The absolute directory the agent manifests live in.
 *
 * An absolute `configured` is taken as given, so a project may name a registry
 * outside its own tree; a relative one joins to `mainCheckout`; an empty one
 * means {@link DEFAULT_MANIFEST_DIR}. A trailing `/` is trimmed from the
 * answer, because `plot-dispatch.sh`'s own resolver trims one and two answers
 * to *where is the registry* is the defect this rule removes.
 *
 * @param reading - the main checkout, and what the config named.
 * @returns the directory, with no trailing separator.
 */
export const manifestDirectory = (reading: ManifestDirectoryReading): string => {
  const configured = reading.configured.trim();
  if (configured.startsWith('/')) return trimTrailing(configured);
  const root = trimTrailing(reading.mainCheckout);
  // `trimTrailing` keeps a lone `/`, so a non-empty segment stays non-empty and
  // there is no empty-segment arm to take. A lone `/` as the ROOT does keep its
  // separator, so joining under it must not double one: `path.join` and the
  // shell both answer `/agents` for that root.
  const segment = trimTrailing(configured === '' ? DEFAULT_MANIFEST_DIR : configured);
  return root.endsWith('/') ? `${root}${segment}` : `${root}/${segment}`;
};

/**
 * Which manifest names this desk.
 *
 * A manifest names the desk when either form of its `worktree` field equals
 * either form of the desk's path. BOTH SIDES CARRY BOTH FORMS: a manifest
 * records the resolved path, git may report either, and a desk registered by a
 * symlinked path must be found by its real one.
 *
 * `several` is its own answer and not the first match. Two manifests on one
 * desk is an estate defect, and returning the first would hide it; every
 * caller reads `several` as *no manifest* and names it.
 *
 * ABSENT IS NOT FALSE. An empty desk path, an empty `manifests` list and a
 * manifest carrying no `worktree` all answer `unnamed` rather than throwing or
 * guessing.
 *
 * @param reading - the desk, its realpath, and the manifests that were read.
 * @returns `named` with the one path, `unnamed`, or `several` with every path.
 */
export const deskManifest = (reading: DeskManifestReading): DeskManifest => {
  const wanted = new Set([reading.desk, reading.deskReal].filter((p) => p !== ''));
  if (wanted.size === 0) return { kind: 'unnamed' };

  const matched: string[] = [];
  for (const manifest of reading.manifests) {
    const forms = [manifest.worktree, manifest.worktreeReal ?? ''].filter((p) => p !== '');
    if (forms.some((form) => wanted.has(form))) matched.push(manifest.path);
  }

  if (matched.length === 0) return { kind: 'unnamed' };
  if (matched.length === 1) return { kind: 'named', path: matched[0]! };
  return { kind: 'several', paths: matched };
};

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

/** What a monitor read before asking which desk to watch this pass. */
export interface WatchedDeskReading {
  /** The desk this monitor was launched on, fixed for its whole life. */
  readonly launched: string;
  /** The manifest's `worktree` field this pass, verbatim; empty when absent, unset, or unreadable. */
  readonly manifestWorktree: string;
}

/** What a waiting loop read before asking whether its manifest still stands. */
export interface LoopRegistrationReading {
  /** `PLOT_MANIFEST_FILE` as the loop holds it, verbatim; empty when the loop was hand-started. */
  readonly manifestFile: string;
  /** Whether that path exists. The caller takes this reading; the rule does no I/O. */
  readonly exists: boolean;
}

/** Whether a waiting loop's manifest still names it. */
export type LoopRegistration = 'registered' | 'unset' | 'gone';

/** What a row read before asking what to say about a desk no manifest names. */
export interface UnnamedDeskReading {
  /** The branch the desk has checked out; `''` when it holds none. */
  readonly checkout: string;
  /** Whether a process is working this desk now — the caller's own liveness reading. */
  readonly live: boolean;
}

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
 * guessing. A manifest whose `worktree` is empty names no desk even when the
 * reading carries a `worktreeReal`.
 *
 * @param reading - the desk, its realpath, and the manifests that were read.
 * @returns `named` with the one path, `unnamed`, or `several` with every path.
 */
export const deskManifest = (reading: DeskManifestReading): DeskManifest => {
  const wanted = new Set([reading.desk, reading.deskReal].filter((p) => p !== ''));
  if (wanted.size === 0) return { kind: 'unnamed' };

  const matched: string[] = [];
  for (const manifest of reading.manifests) {
    // A manifest with no `worktree` names no desk, whatever realpath came with
    // it: `worktreeReal` resolves the field, so without the field it resolves
    // nothing the manifest said.
    if (manifest.worktree === '') continue;
    const forms = [manifest.worktree, manifest.worktreeReal ?? ''].filter((p) => p !== '');
    if (forms.some((form) => wanted.has(form))) matched.push(manifest.path);
  }

  if (matched.length === 0) return { kind: 'unnamed' };
  if (matched.length === 1) return { kind: 'named', path: matched[0]! };
  return { kind: 'several', paths: matched };
};

/**
 * Which desk a monitor reads THIS PASS, after a hop may have moved its agent.
 *
 * The manifest's `worktree` when it is non-empty, else the desk the monitor
 * was launched on. A monitor's `PLOT_WORKTREE` is fixed at launch, but
 * `update_manifest_on_hop` rewrites the manifest when the loop cuts a new
 * desk — so a monitor that never re-reads the manifest watches the launch
 * desk forever, asking the host about commits its agent no longer makes.
 *
 * ABSENT IS NOT FALSE: a hand-started monitor with no `PLOT_MANIFEST_FILE`, a
 * manifest that is gone, and a manifest whose `worktree` is empty all answer
 * `launched` — "watch what you were launched on" — never "watch nothing" and
 * never a crash. Whitespace-only is the same absence, trimmed first. A
 * `worktree` naming a directory that does not exist is NOT answered here —
 * this is string work, and the caller's own `[ -d … ]` guard is what answers
 * that case.
 *
 * @param reading - the launch desk, and the manifest's `worktree` this pass.
 * @returns the desk to watch this pass.
 */
export const watchedDesk = (reading: WatchedDeskReading): string => {
  const worktree = reading.manifestWorktree.trim();
  return worktree === '' ? reading.launched : worktree;
};

/**
 * Whether a waiting loop's manifest still stands.
 *
 * ABSENT IS NOT FALSE. An empty `manifestFile` means a hand-started loop —
 * `#1101`'s continuation route is not the only way an agent comes to exist —
 * and `unset` keeps it waiting forever, exactly as it does today. Only a NAME
 * that points at nothing answers `gone`, because that is the one shape a
 * registry can no longer vouch for: the manifest it handed the loop at launch
 * has since disappeared out from under it.
 *
 * The caller takes the existence reading; this rule does no I/O. It mirrors
 * {@link deskManifest}'s own split between a reading and the judgement made of
 * it, so a wait that reads `gone` can end honestly rather than spin at
 * `Worker bound` on a manifest nobody will ever restore.
 *
 * @param reading - the manifest path the loop holds, and whether it exists.
 * @returns `registered`, `unset`, or `gone`.
 */
export const loopRegistration = (reading: LoopRegistrationReading): LoopRegistration => {
  if (reading.manifestFile === '') return 'unset';
  return reading.exists ? 'registered' : 'gone';
};

/**
 * The words a row shows for a desk no manifest names.
 *
 * NAMES THE ABSENCE FIRST, because `#1101` measured the alternative: a
 * synthesized entry carried `branch: wt.branch` and the row read as an agent
 * working that branch, when the branch is a fact about the DESK's checkout and
 * not an assignment from the registry. No manifest ever claimed this agent, so
 * the label says so before it says anything about the process.
 *
 * `live` IS THE CALLER'S OWN READING, not the board's full state enum. The
 * caller already turns its state into a liveness boolean for other purposes
 * (`isLiveState`) and the domain may not import the board's vocabulary to
 * re-derive one here — the layering rule points inward, and this package may
 * import `zod` and nothing else outside `adapters/`.
 *
 * ABSENT IS NOT FALSE, applied to `checkout`. A desk between slices holds no
 * branch, so the label omits the checkout clause entirely rather than naming
 * an empty one — *no manifest names this desk, and it is idle* reads honestly
 * where *checked out `` * would not.
 *
 * @param reading - the desk's checkout, and whether it is live.
 * @returns the label's words; no trailing punctuation.
 */
export const unnamedDeskLabel = (reading: UnnamedDeskReading): string => {
  const base = 'no manifest names this desk';
  const activity = reading.live ? 'working' : 'idle';
  const checkout = reading.checkout.trim();
  return checkout === '' ? `${base}, ${activity}` : `${base}, ${activity}, checked out ${checkout}`;
};

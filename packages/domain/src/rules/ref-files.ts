import type { Worktree } from '../entities/worktree.js';
import type { BranchTip, RefScope, RefState } from '../ports/refs.js';

/**
 * Git's ref rules over the text of the files git keeps: loose refs,
 * `packed-refs`, symbolic refs, the repository `config` and each
 * `worktrees/<id>/` directory.
 *
 * A declared duplicate of git (`docs/shell-and-domain.md`):
 * `corpus/ref-files.corpus.test.ts` compares every answer with git's own. Each
 * function answers `undefined` where git's rule is not covered here, and the
 * caller then asks git.
 */

/** What one ref holds: an object name, or the name of another ref. */
export type RefValue =
  | { readonly oid: string; readonly peeled?: string }
  | { readonly symbolic: string };

/** Every ref the files hold, by full name. */
export type RefTable = ReadonlyMap<string, RefValue>;

/** A SHA-1 or SHA-256 object name. */
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The namespaces each {@link RefScope} lists, as `refsGit` passes them to `for-each-ref`. */
const NAMESPACES: Record<RefScope, readonly string[]> = {
  local: ['refs/heads'],
  remote: ['refs/remotes/origin'],
  both: ['refs/heads', 'refs/remotes'],
};

/** Git's `ref_rev_parse_rules`, as prefix and suffix around a short name. */
const RULES: readonly (readonly [prefix: string, suffix: string])[] = [
  ['', ''],
  ['refs/', ''],
  ['refs/tags/', ''],
  ['refs/heads/', ''],
  ['refs/remotes/', ''],
  ['refs/remotes/', '/HEAD'],
];

/** Ref namespaces each worktree keeps in its own git directory. */
export const PER_WORKTREE_PREFIXES: readonly string[] = ['refs/bisect/', 'refs/worktree/', 'refs/rewritten/'];

/** Byte order of two distinct ASCII names, as git sorts refs. */
const byName = (a: string, b: string): number => (a < b ? -1 : 1);

/**
 * Whether a name is a valid ref name under `git check-ref-format`, for the
 * names a loose-ref scan meets.
 *
 * @param name - the full ref name.
 * @returns false for a name git refuses.
 */
export const isRefName = (name: string): boolean => {
  if (name === '' || name === '@' || name.endsWith('/') || name.endsWith('.')) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.') && !part.endsWith('.lock'));
};

/**
 * Reads one ref file: an object name, or `ref: <name>`.
 *
 * @param text - the file's text.
 * @returns the value, or undefined for text that is neither.
 */
export const looseRefOf = (text: string): RefValue | undefined => {
  const target = symbolicTarget(text);
  if (target !== undefined) return { symbolic: target };
  const oid = text.trim();
  return OID.test(oid) ? { oid } : undefined;
};

/**
 * Reads the target of a symbolic ref file.
 *
 * @param text - the file's text, such as `ref: refs/heads/main\n`.
 * @returns the target ref name, or undefined when the file holds an object name or anything else.
 */
export const symbolicTarget = (text: string): string | undefined => {
  const match = /^ref:\s*(\S+)\s*$/.exec(text);
  return match?.[1];
};

/**
 * Parses `packed-refs`: the `# pack-refs with:` header, `<oid> <ref>` lines,
 * and `^<oid>` lines that peel the ref on the line above them.
 *
 * @param text - the file's text.
 * @returns the packed refs by name, or undefined where a line does not parse or
 *   a `^` line has no ref above it.
 */
export const packedRefsOf = (text: string): RefTable | undefined => {
  const refs = new Map<string, RefValue>();
  let last: string | undefined;
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('^')) {
      const peeled = line.slice(1);
      const above = last === undefined ? undefined : refs.get(last);
      if (above === undefined || !('oid' in above) || !OID.test(peeled)) return undefined;
      refs.set(last as string, { oid: above.oid, peeled });
      continue;
    }
    const space = line.indexOf(' ');
    const oid = line.slice(0, space);
    const name = line.slice(space + 1);
    if (space < 0 || !OID.test(oid) || !isRefName(name)) return undefined;
    refs.set(name, { oid });
    last = name;
  }
  return refs;
};

/**
 * Merges loose and packed refs: a loose ref shadows the packed ref of the same name.
 *
 * @param files - the loose refs and the packed refs.
 * @returns every ref, by name.
 */
export const refsFrom = (files: { loose: RefTable; packed: RefTable }): RefTable =>
  new Map([...files.packed, ...files.loose]);

/**
 * Follows a ref one level to its object name.
 *
 * @param name - the full ref name.
 * @param refs - the table.
 * @returns the object name, null where the table holds no such ref, and
 *   undefined for a symbolic chain or a dangling symbolic ref.
 */
export const oidOf = (name: string, refs: RefTable): string | null | undefined => {
  const value = refs.get(name);
  if (value === undefined) return null;
  if ('oid' in value) return value.oid;
  const target = refs.get(value.symbolic);
  return target !== undefined && 'oid' in target ? target.oid : undefined;
};

/**
 * Whether a name is one {@link resolveName} answers: a ref name, never a
 * revision expression or an object name.
 */
const isPlainName = (name: string): boolean =>
  isRefName(name) &&
  !name.startsWith('-') &&
  !/^[0-9a-f]{4,64}$/i.test(name) &&
  !(/^[A-Z_]+$/.test(name) && name !== 'HEAD') &&
  !name.startsWith('main-worktree/') &&
  !name.startsWith('worktrees/');

/**
 * Resolves a short or full ref name as `git rev-parse <name>` does, through
 * git's short-name order (`gitrevisions(7)`).
 *
 * An annotated tag answers its own object name, as `rev-parse` does; the peeled
 * commit is not the answer.
 *
 * @param name - the name, such as `main`, `origin/main` or `refs/heads/main`.
 * @param refs - the table, `HEAD` included.
 * @returns the object name, null where no rule finds a ref, and undefined for
 *   anything that is not a plain name (`^`, `~`, `:`, `@{`, `..`, an object
 *   name or prefix) or that ends at a symbolic chain or a dangling ref.
 */
export const resolveName = (name: string, refs: RefTable): string | null | undefined => {
  if (!isPlainName(name)) return undefined;
  for (const [index, [prefix, suffix]] of RULES.entries()) {
    if (index === 0 && name !== 'HEAD' && !name.startsWith('refs/')) continue;
    const found = oidOf(`${prefix}${name}${suffix}`, refs);
    if (found !== null) return found;
  }
  return null;
};

/**
 * Shortens a full ref name as git's `shorten_unambiguous_ref` does.
 *
 * @param ref - the full ref name.
 * @param refs - the table the shortened name must stay unambiguous in.
 * @param strict - true checks every other rule (`%(refname:short)`,
 *   `rev-parse --abbrev-ref`); false checks only the rules before the matched
 *   one (`symbolic-ref --short`).
 * @returns the shortest unambiguous name, or the full name.
 */
export const shortRefName = (ref: string, refs: RefTable, strict: boolean): string => {
  const exists = (name: string): boolean => typeof oidOf(name, refs) === 'string';
  for (let index = RULES.length - 1; index > 0; index -= 1) {
    const [prefix, suffix] = RULES[index] as readonly [string, string];
    if (!ref.startsWith(prefix) || !ref.endsWith(suffix) || ref.length <= prefix.length + suffix.length) continue;
    const short = ref.slice(prefix.length, ref.length - suffix.length);
    const checked = strict ? RULES.length : index;
    const clash = RULES.slice(0, checked).some(
      ([p, s], other) => other !== index && exists(`${p}${short}${s}`),
    );
    if (!clash) return short;
  }
  return ref;
};

/** Converts one `for-each-ref` glob segment to a regular expression, `/` excluded. */
const globOf = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('')
      .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|]/g, '\\$&')))
      .join('')}$`,
  );

/**
 * Whether `for-each-ref` lists a ref for a pattern: a prefix that ends at a `/`,
 * or a glob in which `*` and `?` match no `/`.
 *
 * @param ref - the full ref name.
 * @param pattern - the pattern.
 * @returns the answer, or undefined for a pattern with `[`, `\` or `**`.
 */
export const refMatches = (ref: string, pattern: string): boolean | undefined => {
  if (/[[\\]/.test(pattern) || pattern.includes('**')) return undefined;
  if (
    ref.startsWith(pattern) &&
    (ref.length === pattern.length || ref[pattern.length] === '/' || pattern.endsWith('/'))
  ) {
    return true;
  }
  return /[*?]/.test(pattern) ? globOf(pattern).test(ref) : false;
};

/**
 * Lists the refs that match any pattern, sorted by name, each with the object
 * name a symbolic ref points at.
 *
 * @param refs - the table.
 * @param patterns - the `for-each-ref` patterns.
 * @returns the matches, or undefined where a pattern is not covered or a
 *   match is a symbolic chain or a dangling symbolic ref.
 */
export const matchingRefs = (
  refs: RefTable,
  patterns: readonly string[],
): readonly { ref: string; oid: string }[] | undefined => {
  const found: { ref: string; oid: string }[] = [];
  for (const ref of [...refs.keys()].filter((name) => name.startsWith('refs/')).sort(byName)) {
    const hits = patterns.map((pattern) => refMatches(ref, pattern));
    if (hits.includes(undefined)) return undefined;
    if (!hits.includes(true)) continue;
    const oid = oidOf(ref, refs);
    if (typeof oid !== 'string') return undefined;
    found.push({ ref, oid });
  }
  return found;
};

/**
 * Reads `Refs.refState` from the table, as `for-each-ref --format='%(refname)
 * %(objectname) %(HEAD)'` over the scope's namespaces answers. No scope lists
 * `refs/tags`.
 *
 * @param refs - the table, `HEAD` included.
 * @param scope - which namespaces to list.
 * @returns the refs, sorted by name, or undefined where a match cannot be read.
 */
export const refStateOf = (refs: RefTable, scope: RefScope): readonly RefState[] | undefined => {
  const head = refs.get('HEAD');
  const attached = head !== undefined && 'symbolic' in head ? head.symbolic : undefined;
  return matchingRefs(refs, NAMESPACES[scope])?.map(({ ref, oid }) =>
    ref === attached ? { ref, sha: oid, head: true as const } : { ref, sha: oid },
  );
};

/**
 * Reads `Refs.listBranches`: the local branches, or `origin`'s with `HEAD` left out.
 *
 * @param refs - the table.
 * @param remote - true lists `refs/remotes/origin`, false lists `refs/heads`.
 * @returns the names without their namespace, or undefined where a match cannot be read.
 */
export const listBranchesOf = (refs: RefTable, remote: boolean): readonly string[] | undefined =>
  matchingRefs(refs, [remote ? 'refs/remotes/origin' : 'refs/heads'])
    ?.map(({ ref }) => ref.split('/').slice(remote ? 3 : 2).join('/'))
    .filter((name) => name !== 'HEAD');

/**
 * Reads `Refs.branchTips`: `%(refname:short)` with `origin/` removed, and the object name.
 *
 * @param refs - the table.
 * @param patterns - the `for-each-ref` patterns.
 * @returns the tips, sorted by full ref name, or undefined where a pattern or a match is not covered.
 */
export const branchTipsOf = (refs: RefTable, patterns: readonly string[]): readonly BranchTip[] | undefined =>
  matchingRefs(refs, patterns)?.map(({ ref, oid }) => ({
    branch: shortRefName(ref, refs, true).replace(/^origin\//, ''),
    sha: oid,
  }));

/**
 * Reads `Refs.defaultBranch` from `refs/remotes/origin/HEAD`, as `git
 * symbolic-ref --short` with `origin/` removed answers.
 *
 * @param refs - the table.
 * @returns the branch name, or undefined where `origin/HEAD` is absent, holds an
 *   object name, or points at a ref the table does not hold.
 */
export const defaultBranchOf = (refs: RefTable): string | undefined => {
  const head = refs.get('refs/remotes/origin/HEAD');
  if (head === undefined || !('symbolic' in head) || typeof oidOf(head.symbolic, refs) !== 'string') return undefined;
  return shortRefName(head.symbolic, refs, false).replace(/^origin\//, '');
};

/**
 * Reads `Refs.currentBranch`, as `git rev-parse --abbrev-ref HEAD` answers.
 *
 * @param refs - the table, `HEAD` included.
 * @returns the short branch name, `HEAD` when detached, or undefined where
 *   `HEAD` is absent or names a branch with no commit.
 */
export const currentBranchOf = (refs: RefTable): string | undefined => {
  const head = refs.get('HEAD');
  if (head === undefined) return undefined;
  if ('oid' in head) return 'HEAD';
  return typeof oidOf('HEAD', refs) === 'string' ? shortRefName(head.symbolic, refs, true) : undefined;
};

/**
 * Reads `Trees.currentBranch`, as `git branch --show-current` answers: `HEAD`'s
 * symbolic target with `refs/heads/` removed, never shortened against other refs.
 *
 * @param refs - the table, `HEAD` included.
 * @returns the branch name, also for a branch with no commit; `''` when
 *   detached; undefined where `HEAD` is absent or names a ref outside `refs/heads/`.
 */
export const checkoutBranchOf = (refs: RefTable): string | undefined => {
  const head = refs.get('HEAD');
  if (head === undefined) return undefined;
  if ('oid' in head) return '';
  return head.symbolic.startsWith('refs/heads/') ? head.symbolic.slice('refs/heads/'.length) : undefined;
};

/** The repository settings the reader depends on, read from `<common>/config`. */
export interface RepoConfig {
  /** `extensions.refStorage`, lower case; `files` where unset. */
  refStorage: string;
  /** `core.bare`. */
  bare: boolean;
}

/** Git's boolean words. */
const truthy = (value: string | undefined): boolean =>
  value === undefined || ['true', 'yes', 'on', '1'].includes(value.toLowerCase());

/**
 * Reads `extensions.refStorage` and `core.bare` from a repository config file.
 *
 * @param text - the config file's text.
 * @returns the two settings, with git's defaults where unset.
 */
export const repoConfigOf = (text: string): RepoConfig => {
  let section = '';
  const config: RepoConfig = { refStorage: 'files', bare: false };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[#;].*$/, '').trim();
    const header = /^\[([^\]\s"]+)(?:\s+"[^"]*")?\]$/.exec(line);
    if (header) {
      section = line.includes('"') ? '' : (header[1] as string).toLowerCase();
      continue;
    }
    const entry = /^([A-Za-z][\w-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!entry) continue;
    const key = `${section}.${(entry[1] as string).toLowerCase()}`;
    const value = entry[2]?.replace(/^"(.*)"$/, '$1').trim();
    if (key === 'extensions.refstorage') config.refStorage = (value ?? '').toLowerCase();
    if (key === 'core.bare') config.bare = truthy(value);
  }
  return config;
};

/** One `worktrees/<id>/` directory, as the adapter read it. */
export interface WorktreeFiles {
  /** The `gitdir` file's text, resolved to an absolute path; undefined where the file is absent or empty. */
  gitdir: string | undefined;
  /** The `HEAD` file's text; undefined where unreadable. */
  head: string | undefined;
  /** Whether a `locked` file is present. */
  locked: boolean;
  /** Whether the path `gitdir` names exists. */
  present: boolean;
}

/** Reads one worktree's `HEAD` into its branch and detachment. */
const checkoutOf = (head: string | undefined): { branch: string; detached: boolean } | undefined => {
  const value = head === undefined ? undefined : looseRefOf(head);
  if (value === undefined) return undefined;
  return 'oid' in value
    ? { branch: '', detached: true }
    : { branch: value.symbolic.replace(/^refs\/heads\//, ''), detached: false };
};

/**
 * Builds the `Trees.list` answer from the main checkout and each
 * `worktrees/<id>/` directory, as `git worktree list --porcelain` reports them.
 *
 * A directory with no `gitdir` is left out, as git leaves it out. A linked
 * worktree is prunable where its `gitdir` names a missing path and no `locked`
 * file is present.
 *
 * @param entries - the main checkout's path and `HEAD`, and the linked worktrees' files.
 * @returns the main checkout first and the linked worktrees after it in the
 *   order given, or undefined where a `HEAD` cannot be read.
 */
export const worktreesFrom = (entries: {
  main: { path: string; head: string | undefined };
  linked: readonly WorktreeFiles[];
}): readonly Worktree[] | undefined => {
  const trees: Worktree[] = [];
  const add = (path: string, head: string | undefined, isMain: boolean, prunable: boolean): boolean => {
    const checkout = checkoutOf(head);
    if (checkout === undefined) return false;
    trees.push({ path, ...checkout, isMain, clean: false, agentSession: null, prunable });
    return true;
  };
  if (!add(entries.main.path, entries.main.head, true, false)) return undefined;
  for (const tree of entries.linked) {
    if (tree.gitdir === undefined) continue;
    const path = tree.gitdir.replace(/\/\.git$/, '');
    if (!add(path, tree.head, false, !tree.locked && !tree.present)) return undefined;
  }
  return trees;
};

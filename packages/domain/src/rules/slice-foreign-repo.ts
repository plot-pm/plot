import { LIST_CLAIM, REFERENCE, type CrossRepoReference } from './cross-repo-reference.js';
import { hostAndPathOfRemote } from './remote-url.js';

/** `<owner>/<repo>:` at the start of a claim line's description, after its separator. */
const PREFIX = /^\s*(?:[—–-]|:)?\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+):/;

/** HTML comments on a claim line: `<!-- deferred: … -->`, `<!-- waits: … -->` and the rest. */
const COMMENT = /<!--[\s\S]*?-->/g;

const same = (a: string, b: string | null): boolean => b !== null && a.toLowerCase() === b.toLowerCase();

/**
 * The `<owner>/<repo>` a remote URL names: the last two segments of its path.
 *
 * @param url - a remote URL as git reports it.
 * @returns `owner/repo` with `.git` and trailing slashes removed, or `null` for a
 *   local path, an empty string, or a URL naming fewer than two segments.
 */
export const repoOfRemote = (url: string): string | null => {
  const parsed = hostAndPathOfRemote(url.trim().replace(/\/+$/, '').replace(/\.git$/, ''));
  if (parsed === null) return null;
  const segments = parsed.path.split('/').filter((s) => s !== '');
  return segments.length < 2 ? null : `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
};

/**
 * The PR in another repository that a claim line's arrow names.
 *
 * Reads `→ owner/repo#N` and `PR: owner/repo#N`. A line that also names a PR of
 * this repository — `→ #N`, or `→ <thisRepo>#N` — is claimed here, and answers `null`.
 *
 * @param line - one claim line of a plan, verbatim.
 * @param thisRepo - this repository as `owner/repo`, or `null` where it is unread.
 * @returns the first foreign reference, or `null`.
 */
export const sliceForeignReference = (line: string, thisRepo: string | null): CrossRepoReference | null => {
  const refs = [...line.matchAll(REFERENCE)].map((m) => ({ repo: m[1] ?? '', number: Number(m[2]) }));
  if (refs.some((r) => r.repo === '' || same(r.repo, thisRepo))) return null;
  return refs[0] ?? null;
};

/**
 * The repository a slice line places its branch in, where that is not this one.
 *
 * Two forms count. The description starts `<owner>/<repo>:` — read at the start
 * of the description only, after the backticked branch, its comments and its
 * separator; a repository named later in prose is not a placement. Or the line
 * carries `→ owner/repo#N` (see {@link sliceForeignReference}). A line that names
 * a PR of this repository is claimed here and answers `null`.
 *
 * Where `thisRepo` is `null`, every `<owner>/<repo>:` prefix and every
 * `→ owner/repo#N` reads foreign: a missed claim costs one dispatch by a person,
 * and a false claim churns a ref in a repository that does not hold the work.
 * Repository names compare without case.
 *
 * @param line - one claim line of a plan, verbatim.
 * @param thisRepo - this repository as `owner/repo`, or `null` where it is unread.
 * @returns the foreign repository as the line spells it, or `null`.
 */
export const sliceForeignRepo = (line: string, thisRepo: string | null): string | null => {
  const refs = [...line.matchAll(REFERENCE)].map((m) => m[1] ?? '');
  if (refs.some((repo) => repo === '' || same(repo, thisRepo))) return null;
  const claim = LIST_CLAIM.exec(line);
  if (claim !== null) {
    const description = line.slice(claim[0].length).replace(COMMENT, '');
    const prefixed = PREFIX.exec(description)?.[1];
    if (prefixed !== undefined && !same(prefixed, thisRepo)) return prefixed;
  }
  return sliceForeignReference(line, thisRepo)?.repo ?? null;
};

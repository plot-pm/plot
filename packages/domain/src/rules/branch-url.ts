import { hostAndPathOfRemote } from './remote-url.js';

/** How one git host links a branch page: which hosts it covers and the prefix it builds. */
export interface BranchUrlScheme {
  /** Whether the origin's host (no user, no port) belongs to this scheme. */
  readonly matches: (host: string) => boolean;
  /** The branch-page prefix, ending where the branch name starts. */
  readonly base: (host: string, repoPath: string) => string;
}

/**
 * The branch-URL prefix for an origin URL.
 *
 * @param origin - the output of `git remote get-url origin`.
 * @param schemes - the hosts that can be linked; the first whose `matches` accepts the host answers.
 * @returns the matching scheme's prefix, and `''` for a host no scheme
 *   matches, an unparseable URL or a path that names no repository.
 */
export const branchUrlBase = (origin: string, schemes: readonly BranchUrlScheme[]): string => {
  const trimmed = origin.trim();
  if (!trimmed) return '';
  const parsed = hostAndPathOfRemote(trimmed);
  if (parsed === null) return '';
  const host = parsed.host;
  const repoPath = parsed.path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  if (!repoPath || repoPath.includes('..')) return '';
  const scheme = schemes.find((candidate) => candidate.matches(host));
  return scheme === undefined ? '' : scheme.base(host, repoPath);
};

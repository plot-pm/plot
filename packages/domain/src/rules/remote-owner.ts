import { hostAndPathOfRemote } from './remote-url.js';

/**
 * The account a remote URL names, or `null` where it names none.
 *
 * ONE PARSER, so the scan and the supervisor read one answer. The scan passes
 * the `origin` URL to its bundle and parses nothing itself; the supervisor
 * reads the URL through its refs port and calls this.
 *
 * `null` is not a failure. It is the answer for a local path, which has no
 * account at all, and {@link ../rules/merge-subject.js} reads it as *any owner
 * counts* — today's behaviour for a repository whose origin is a bare path.
 *
 * @param url - a remote URL as git reports it.
 * @returns the owner segment, lowercased, or `null` for a local path, a URL
 *   naming only a repository, or any other shape.
 */
export const ownerOfRemote = (url: string): string | null => {
  const parsed = hostAndPathOfRemote(url);
  if (parsed === null) return null;
  // The segments before the repository name. An owner is the LAST of them:
  // a self-hosted host may serve `group/sub/repo`, where the account that
  // owns the repository is `sub`, which is the segment a merge subject names.
  const segments = parsed.path.split('/').filter((s) => s !== '');
  if (segments.length < 2) return null;
  return segments[segments.length - 2].toLowerCase();
};

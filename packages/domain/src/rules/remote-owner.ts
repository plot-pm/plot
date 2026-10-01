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
  const path = pathOf(url);
  if (path === null) return null;
  // The segments before the repository name. An owner is the LAST of them:
  // a self-hosted host may serve `group/sub/repo`, where the account that
  // owns the repository is `sub`, which is the segment a merge subject names.
  const segments = path.split('/').filter((s) => s !== '');
  if (segments.length < 2) return null;
  return segments[segments.length - 2].toLowerCase();
};

/**
 * The path part of a remote URL — everything after the host.
 *
 * @param url - a remote URL as git reports it.
 * @returns the path, or `null` where the URL carries no host to strip.
 */
const pathOf = (url: string): string | null => {
  // A scheme'd URL. `file://` is deliberately absent: it addresses a local
  // path, whose first segment is a directory and not an account.
  const scheme = /^(?:https?|ssh):\/\/(?:[^@/]*@)?[^/]+(\/.*)$/.exec(url);
  if (scheme !== null) return scheme[1];
  // A LOCAL-PATH SCHEME NAMES NO ACCOUNT, and it is refused before the
  // scp-style form below, which would otherwise read `file` as a host and
  // `/srv/git` as an owner. `file://` addresses a directory; its first segment
  // is a parent directory, not an account.
  if (/^file:\/\//i.test(url)) return null;
  // The scp-style form, `[user@]host:path`. The colon must precede the first
  // slash, which is what separates it from a local path legally holding one —
  // and the host must carry no slash, so `C:/git/repo` reads as the Windows
  // path it is rather than as a host named `C`.
  const scp = /^(?:[^@/:]*@)?([^/:]+):(.*)$/.exec(url);
  if (scp !== null) {
    // A single-character host is a Windows drive letter, not a host. git makes
    // the same reading, and a repository whose owner is one character cannot be
    // told from one, so the quieter error is to answer nothing.
    if (scp[1].length < 2) return null;
    return `/${scp[2]}`;
  }
  return null;
};

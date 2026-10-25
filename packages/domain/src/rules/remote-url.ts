/**
 * Splits a git remote URL into its host and path.
 *
 * Handles three shapes: `http://`/`https://`/`ssh://` with an optional user
 * and port, and the scp-style `[user@]host:path`. `file://` is excluded on
 * purpose — it addresses a local directory, which has no host to read. A
 * single-character scp-style host is excluded too: git reads that as a
 * Windows drive letter (`C:/git/repo`) rather than a host, and an owner that
 * short cannot be told from one.
 *
 * @param url - a remote URL as git reports it, with `.git` and trailing
 *   slashes already removed by the caller where that matters to it.
 * @returns the host without user or port, and the path starting with `/`;
 *   `null` for a local path, a `file://` URL, or any other unparseable shape.
 */
export const hostAndPathOfRemote = (url: string): { host: string; path: string } | null => {
  if (/^file:\/\//i.test(url)) return null;
  const scheme = /^(?:https?|ssh):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)$/.exec(url);
  if (scheme !== null) return { host: scheme[1], path: scheme[2] };
  const scp = /^(?:[^@/:]*@)?([^/:]+):(.*)$/.exec(url);
  if (scp === null) return null;
  if (scp[1].length < 2) return null;
  return { host: scp[1], path: `/${scp[2]}` };
};

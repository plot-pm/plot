/**
 * The `<owner>/<repo>` slug a remote URL names on one git host, or `null` where it names none.
 *
 * A URL with a scheme (`https://`, `ssh://`) may carry a port after the host,
 * and the rule drops it. An scp-style remote (`[user@]host:path`) has no port:
 * its colon starts the path, so a numeric first segment is a workspace.
 * The host matches `domain` itself or any subdomain of it (`ssh.<domain>`).
 * `.git` and trailing slashes are removed before the slug is captured.
 *
 * `null` is an answer, not a failure: it covers a host outside `domain`,
 * a local path, an empty string and a URL naming no repository. The rule
 * never throws.
 *
 * @param url - a remote URL as git reports it.
 * @param domain - the host's registrable domain, such as `example.org`.
 * @returns `<owner>/<repo>` with the URL's case kept, or `null`.
 */
export const remoteSlug = (url: string, domain: string): string | null => {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const parsed = hostAndPath(trimmed);
  if (parsed === null || !isHostOf(parsed.host, domain)) return null;
  const match = /^([^/]+)\/(.+)$/.exec(parsed.path.replace(/^\/+/, ''));
  return match === null ? null : `${match[1]}/${match[2]}`;
};

/**
 * Whether a host is `domain` or a subdomain of it, ignoring case.
 *
 * @param host - a host without user or port.
 * @param domain - the registrable domain.
 */
const isHostOf = (host: string, domain: string): boolean => {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
};

/**
 * Splits a remote URL into its host and path.
 *
 * @param url - a remote URL with `.git` and trailing slashes already removed.
 * @returns the host without user or port, and the path after it; `null` for a local path.
 */
const hostAndPath = (url: string): { host: string; path: string } | null => {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)$/i.exec(url);
  if (scheme !== null) return { host: scheme[1], path: scheme[2] };
  const scp = /^(?:[^@/:]*@)?([^/:]+):(.*)$/.exec(url);
  return scp === null ? null : { host: scp[1], path: scp[2] };
};

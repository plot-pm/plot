/** How a Jenkins HTTP status reads: an answer, a dead session, a redirect to a foreign host, or a failure. */
export type JenStatusClass = 'ok' | 'auth' | 'foreign' | 'failed';

/**
 * Strips one trailing `/`, as the shell's `${url%/}` does.
 *
 * @param url - a URL.
 * @returns the URL without one trailing slash.
 */
const withoutSlash = (url: string): string => (url.endsWith('/') ? url.slice(0, -1) : url);

/**
 * Resolves an instance identifier to a URL.
 *
 * A declared duplicate of `jen_url_for` in `jen`, held to it by
 * `corpus/jen-url.corpus.test.ts`, without the pattern arm: a value with a
 * scheme passes through, a value with a dot is a host and gains `https://`,
 * and a bare slug names no URL here, because the pattern that expands it
 * names one organisation's hosts.
 *
 * @param slug - a slug, a host or a URL.
 * @returns the URL with one trailing slash removed, or null for a bare slug.
 */
export const jenUrlFor = (slug: string): string | null => {
  if (slug.startsWith('http://') || slug.startsWith('https://')) return withoutSlash(slug);
  if (slug.includes('.')) return withoutSlash(`https://${slug}`);
  return null;
};

/**
 * Reads the instance URL: `JEN_URL` where set, else the declared instance.
 *
 * A declared duplicate of `jen_instance_url`, without the pattern arm.
 *
 * @param jenUrl - the value of `JEN_URL`, or undefined where unset.
 * @param slug - the declared instance's slug, host or URL.
 * @returns the URL, or null where `JEN_URL` is unset and the slug is bare.
 */
export const jenInstanceUrl = (jenUrl: string | undefined, slug: string): string | null =>
  jenUrl !== undefined && jenUrl !== '' ? withoutSlash(jenUrl) : jenUrlFor(slug);

/**
 * Reads the `host[:port]` of an absolute URL, in lower case.
 *
 * A declared duplicate of `jen_url_host`. It never invents a host: a relative
 * or empty value answers the empty string, so a redirect with no `Location`
 * cannot compare equal to the instance.
 *
 * @param url - a URL.
 * @returns the host, or '' where the value is not an absolute `http:` or `https:` URL.
 */
export const jenUrlHost = (url: string): string => {
  if (!/^https?:\/\//.test(url)) return '';
  return url.replace(/^https?:\/\/([^/?#]*)[\s\S]*$/, '$1').toLowerCase();
};

/**
 * Names the secret-store key of an instance: the host it resolves to.
 *
 * A declared duplicate of `jen_key_for`.
 *
 * @param slug - a slug, a host or a URL.
 * @returns the key, or null where the slug names no URL.
 */
export const jenKeyFor = (slug: string): string | null => {
  const url = jenUrlFor(slug);
  return url === null ? null : jenUrlHost(url);
};

/**
 * Names the file a `jen` file backend keeps one secret in.
 *
 * A declared duplicate of `jen_secret_file`: `:` and `/` in the key become `_`.
 *
 * @param configDir - the store directory.
 * @param key - the secret's key, such as `keycloak-token`.
 * @returns the file path.
 */
export const jenSecretFile = (configDir: string, key: string): string => `${configDir}/${key.replace(/[:/]/g, '_')}.secret`;

/**
 * Stamps a token response with its absolute expiry.
 *
 * A declared duplicate of `jen_save_token`: `expires_at` is `now` plus
 * `expires_in` (300 where absent) minus 30 seconds, appended to the response's
 * own keys, and the result is compact JSON.
 *
 * @param response - the token endpoint's JSON object.
 * @param now - the clock, whole epoch seconds.
 * @returns the blob to store.
 */
export const jenSaveToken = (response: Readonly<Record<string, unknown>>, now: number): string => {
  const expiresIn = typeof response['expires_in'] === 'number' ? response['expires_in'] : 300;
  return JSON.stringify({ ...response, expires_at: now + expiresIn - 30 });
};

/**
 * Percent-encodes a value as `jq`'s `@uri` does.
 *
 * A declared duplicate of `jen_urlencode`: every byte but `A-Z a-z 0-9 - _ . ~` becomes `%XX` in upper case.
 *
 * @param value - the text.
 * @returns the encoded text.
 */
export const jenUrlencode = (value: string): string =>
  [...Buffer.from(value, 'utf8')]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return /[A-Za-z0-9\-_.~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');

/**
 * Turns a job path into a URL path.
 *
 * A declared duplicate of `jen_job_path`: `a/b` becomes `/job/a/job/b`, and a
 * branch is encoded whole, so `docs/foo` becomes `docs%2Ffoo`, and appended as
 * the last segment.
 *
 * @param input - the job path, such as `team/portal`.
 * @param branch - a branch name, or '' for none.
 * @returns the URL path, or '' for the root.
 */
export const jenJobPath = (input: string, branch = ''): string => {
  let result = '';
  if (input !== '' && input !== '/') {
    let path = input.startsWith('/') ? input.slice(1) : input;
    path = path.endsWith('/') ? path.slice(0, -1) : path;
    for (const segment of path.split('/')) result += `/job/${segment}`;
  }
  if (branch !== '') result += `/job/${jenUrlencode(branch)}`;
  return result;
};

/**
 * Classifies a Jenkins reply by its status and `Location`.
 *
 * A declared duplicate of the redirect classes of `jen_check_http`. A `3xx`
 * to `/oauth2/` or to the realm's host is a dead session (`auth`). A `3xx` to
 * the instance's own host is an answer (`ok`). A `3xx` to any other host, or
 * with no `Location`, is `foreign`: the client sends no credential there. A
 * `401` or `403` is `auth`, any other status from `400` up is `failed`, and
 * the rest are `ok`.
 *
 * @param status - the HTTP status.
 * @param location - the `Location` header, or ''.
 * @param realmUrl - the identity provider's realm URL.
 * @param instanceKey - the instance's `host[:port]`, from {@link jenKeyFor}.
 * @returns the class.
 */
export const jenStatusClass = (status: number, location: string, realmUrl: string, instanceKey: string): JenStatusClass => {
  if (status >= 300 && status <= 399) {
    const target = jenUrlHost(location);
    const realm = jenUrlHost(realmUrl);
    if (location.includes('/oauth2/') || (realm !== '' && target === realm)) return 'auth';
    if (target !== '' && target === instanceKey) return 'ok';
    return 'foreign';
  }
  if (status === 401 || status === 403) return 'auth';
  return status >= 400 ? 'failed' : 'ok';
};

/**
 * Reads the job list off a job's API body.
 *
 * A declared duplicate of `jq '.jobs'` in `jen job list --json`: a container's
 * body carries `jobs`, and a plain job's carries none, which reads `null`.
 *
 * @param body - the parsed API body.
 * @returns the `jobs` value, or null where the body has none.
 */
export const jenJobsOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const jobs = (body as { jobs?: unknown }).jobs;
  return jobs === undefined ? null : jobs;
};

import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

import { budgetFile } from '../budget/budget-file.js';
import { slotsFile } from '../slots/slots-file.js';
import type { BudgetEntry } from '../../entities/budget.js';
import { decodeEntry } from '../../entities/budget.js';
import type { LimitReading } from '../../entities/limit.js';
import type { BudgetRecord } from '../../ports/budget.js';
import type { HostRefusal, LimitObservation } from '../../ports/host.js';
import type { Slots } from '../../ports/slots.js';
import { boundFromLimit, SLOT_POLL_MS, SLOT_WAIT_MAX_MS } from '../../rules/concurrency.js';

/** The environment variable that overrides the API base URL, as on Actions and for GitHub Enterprise Server. */
export const GITHUB_API_URL_ENV = 'GITHUB_API_URL';

/** How long one request may take before it answers `failed`, in milliseconds. */
export const REQUEST_BOUND_MS = 30_000;

/** The connector word every ledger entry this client writes carries. */
export const GITHUB_CONNECTOR = 'github';

/** The account a ledger entry carries where `GET /user` named no login. */
export const UNKNOWN_ACCOUNT = 'unknown';

/** Where the client's token came from. */
export type TokenSource = 'GH_TOKEN' | 'GITHUB_TOKEN' | 'gh auth token';

/** The repository the `origin` remote names. */
export interface GithubOrigin {
  /** The git host, such as `github.com` or a GitHub Enterprise Server host. */
  readonly host: string;
  /** `owner/repo`, or null where the remote names none. */
  readonly slug: string | null;
}

/** One request to the GitHub API. */
export interface GithubRequest {
  /** The HTTP method. */
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** The path below the API base, such as `/repos/o/r/pulls`; `/graphql` names the GraphQL endpoint. */
  readonly path: string;
  /** The JSON body, where the request carries one. */
  readonly body?: unknown;
  /** Names the request in a refusal, such as `graphql, page 2`. */
  readonly label: string;
}

/** What GitHub answered. */
export interface GithubReply {
  /** The HTTP status. */
  readonly status: number;
  /** The response headers, names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body, or the raw text where it is not JSON. */
  readonly body: unknown;
}

/** The answer to one {@link GithubApi.request}. */
export type GithubAnswer =
  | { readonly ok: true; readonly reply: GithubReply }
  | { readonly ok: false; readonly refusal: HostRefusal; readonly reply: GithubReply | null };

/** The seams the client reads; every one has a production default. */
export interface GithubApiOptions {
  /** The `origin` remote's URL, or null where the repository has none. */
  origin: string | null;
  /** Reads the token, proxy and API variables; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Runs `gh auth token --hostname <host>`; null where it answers no token. */
  ghAuthToken?: (host: string) => Promise<string | null>;
  /** The shared ledger; defaults to `budgetFile({ rotate: true })`. */
  budget?: BudgetRecord;
  /** The shared host slots; defaults to `slotsFile()`. */
  slots?: Slots;
  /** Receives what each reply observed about the rate limit. */
  observe?: (observed: LimitObservation) => void;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** The per-request bound; defaults to {@link REQUEST_BOUND_MS}. */
  boundMs?: number;
  /** How often a caller at the slot bound asks again; defaults to `SLOT_POLL_MS`. */
  pollMs?: number;
  /** How long a caller waits for a slot before it proceeds; defaults to `SLOT_WAIT_MAX_MS`. */
  waitMaxMs?: number;
}

/** The one in-process GitHub HTTPS client. */
export interface GithubApi {
  /** The repository the `origin` remote names. */
  readonly origin: GithubOrigin;
  /** The REST base URL, with no trailing slash. */
  readonly base: string;
  /** The GraphQL endpoint URL. */
  readonly graphql: string;
  /** Where the current token came from, resolving it on the first call; null where none resolves. */
  tokenSource(): Promise<TokenSource | null>;
  /** The login the current token belongs to, or `unknown`. */
  account(): Promise<string>;
  /** Sends one request. Never rejects: a refused or unanswered request is a refusal. */
  request(request: GithubRequest): Promise<GithubAnswer>;
}

/**
 * Reads the git host and `owner/repo` from an `origin` URL.
 *
 * The slug follows `gh_origin_slug` in `plot-host.sh`: a trailing `.git` is
 * removed and the last two path segments are taken. A URL with no host reads
 * as `github.com`.
 *
 * @param url - the remote URL, or null.
 * @returns the host and the slug.
 */
export const githubOrigin = (url: string | null): GithubOrigin => {
  const text = (url ?? '').trim();
  const stripped = text.replace(/\.git\/?$/, '');
  const match = /^.*[:/]([^/:]+\/[^/:]+)$/.exec(stripped);
  const slug = match !== null && /^[^/]+\/[^/]+$/.test(match[1]) ? match[1] : null;
  const scheme = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)/i.exec(text);
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/\/)/.exec(text);
  const host = scheme?.[1] ?? (text.startsWith('/') ? null : scp?.[1]) ?? 'github.com';
  return { host: host.toLowerCase(), slug };
};

/**
 * The REST base URL and the GraphQL endpoint for a git host.
 *
 * `GITHUB_API_URL` overrides the host. `github.com` reads `api.github.com`; any
 * other host reads GitHub Enterprise Server's `/api/v3` and `/api/graphql`.
 *
 * @param host - the git host.
 * @param env - the environment to read `GITHUB_API_URL` from.
 * @returns both URLs, with no trailing slash.
 */
export const apiUrlsFor = (
  host: string,
  env: Record<string, string | undefined>,
): { base: string; graphql: string } => {
  const override = (env[GITHUB_API_URL_ENV] ?? '').replace(/\/+$/, '');
  const base = override !== '' ? override : host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const graphql = /\/api\/v3$/.test(base) ? base.replace(/\/api\/v3$/, '/api/graphql') : `${base}/graphql`;
  return { base, graphql };
};

/** Runs `gh auth token --hostname <host>`, with the token on stdout only. */
const ghAuthTokenOf =
  (env: Record<string, string | undefined>) =>
  (host: string): Promise<string | null> =>
    new Promise((resolve) => {
      execFile('gh', ['auth', 'token', '--hostname', host], { env, timeout: 10_000, encoding: 'utf8' }, (error, stdout) => {
        const token = error === null ? stdout.trim() : '';
        resolve(token === '' ? null : token);
      });
    });

/** The proxy variables Node's agent reads, upper and lower case. */
const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/** A number from a header, or null. */
const headerNumber = (value: string | undefined): number | null => {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return null;
  return Number(value.trim());
};

/** GitHub's `message`, or the text of a body that carries none. */
const messageOf = (body: unknown): string => {
  if (typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }
  return typeof body === 'string' ? body.trim() : '';
};

/** A GraphQL `RATE_LIMITED` error's message, or null. */
const graphqlRateLimited = (body: unknown): string | null => {
  const errors = typeof body === 'object' && body !== null ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(errors)) return null;
  const hit = errors.find((e) => typeof e === 'object' && e !== null && (e as { type?: unknown }).type === 'RATE_LIMITED');
  if (hit === undefined) return null;
  const message = (hit as { message?: unknown }).message;
  return typeof message === 'string' ? message : 'API rate limit exceeded';
};

/** The limit reading a ledger entry records. */
const readingOf = (entry: BudgetEntry): LimitReading => ({
  connector: entry.key.connector,
  bucket: entry.key.bucket,
  limit: entry.limit,
  remaining: entry.remaining,
  resetAt: entry.resetAt,
  basis: entry.basis,
});

/** The outcome of one transport attempt: a reply, or why none came. */
type Sent = { reply: GithubReply } | { error: string; timedOut: boolean };

/**
 * Builds the one in-process GitHub HTTPS client.
 *
 * The token comes from `GH_TOKEN`, then `GITHUB_TOKEN`, then one
 * `gh auth token --hostname <host>` on the first request. `GET /user` names the
 * token's login once per token, and every ledger entry is charged to it. A
 * `401` on a token from `gh` runs `gh auth token` once more and retries once;
 * a second `401`, or a `401` on an environment token, answers kind `auth` with
 * the source and the fix in `said`.
 *
 * Each request takes one host slot under the token's login where the ledger
 * licenses a bound, sends through an agent built from `HTTPS_PROXY`,
 * `HTTP_PROXY` and `NO_PROXY`, ends after the bound with kind `failed`, and
 * appends one `BudgetEntry` whose bucket and window come from the
 * `X-RateLimit-*` headers. A `403` or `429` naming a secondary limit answers
 * `secondary`, an exhausted window `throttled`, each with GitHub's message
 * verbatim in `said`.
 *
 * @param options - the origin and the seams.
 * @returns the client.
 */
export const githubApi = (options: GithubApiOptions): GithubApi => {
  const env = options.env ?? process.env;
  const origin = githubOrigin(options.origin);
  const { base, graphql } = apiUrlsFor(origin.host, env);
  const ghAuthToken = options.ghAuthToken ?? ghAuthTokenOf(env);
  const budget = options.budget ?? budgetFile({ env, rotate: true });
  const slots = options.slots ?? slotsFile({ env });
  const now = options.now ?? Date.now;
  const boundMs = options.boundMs ?? REQUEST_BOUND_MS;
  const pollMs = options.pollMs ?? SLOT_POLL_MS;
  const waitMaxMs = options.waitMaxMs ?? SLOT_WAIT_MAX_MS;

  const proxyEnv: Record<string, string> = {};
  for (const name of PROXY_VARS) {
    const value = env[name];
    if (value !== undefined && value !== '') proxyEnv[name] = value;
  }
  const agents = {
    'https:': new https.Agent({ proxyEnv }),
    'http:': new http.Agent({ proxyEnv }),
  };

  let token: { value: string; source: TokenSource } | null = null;
  let login: { token: string; account: Promise<string> } | null = null;
  const bounds = new Map<string, number | null>();

  const resolveToken = async (): Promise<{ value: string; source: TokenSource } | null> => {
    if (token !== null) return token;
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
      const value = env[name];
      if (value !== undefined && value !== '') return (token = { value, source: name });
    }
    const asked = await ghAuthToken(origin.host);
    return asked === null ? null : (token = { value: asked, source: 'gh auth token' });
  };

  const urlFor = (path: string): URL => new URL(path === '/graphql' ? graphql : `${base}${path}`);

  const send = (request: GithubRequest, secret: string): Promise<Sent> =>
    new Promise((resolve) => {
      const url = urlFor(request.path);
      const payload = request.body === undefined ? undefined : JSON.stringify(request.body);
      const transport = url.protocol === 'http:' ? http : https;
      let settled = false;
      const finish = (sent: Sent): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(sent);
      };
      const req = transport.request(
        url,
        {
          method: request.method,
          agent: url.protocol === 'http:' ? agents['http:'] : agents['https:'],
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'plot',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (error) => finish({ error: error.message, timedOut: false }));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: unknown = text;
            try {
              body = text === '' ? null : JSON.parse(text);
            } catch {
              body = text;
            }
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(res.headers)) {
              if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            }
            finish({ reply: { status: res.statusCode ?? 0, headers, body } });
          });
        },
      );
      const timer = setTimeout(() => {
        finish({ error: 'timeout', timedOut: true });
        req.destroy();
      }, boundMs);
      req.on('error', (error) => finish({ error: error.message, timedOut: false }));
      if (payload !== undefined) req.write(payload);
      req.end();
    });

  const charge = async (request: GithubRequest, account: string, reply: GithubReply | null): Promise<void> => {
    const headers = reply?.headers ?? {};
    const limit = headerNumber(headers['x-ratelimit-limit']);
    const reset = headerNumber(headers['x-ratelimit-reset']);
    const entry: BudgetEntry = {
      key: {
        connector: GITHUB_CONNECTOR,
        account,
        bucket: headers['x-ratelimit-resource'] ?? (request.path === '/graphql' ? 'graphql' : 'core'),
      },
      at: now(),
      spent: 1,
      limit,
      remaining: limit === null ? null : headerNumber(headers['x-ratelimit-remaining']),
      resetAt: reset === null ? null : reset * 1000,
      basis: limit === null ? 'unknown' : 'actual',
    };
    if (limit !== null) bounds.set(account, boundFromLimit(readingOf(entry)));
    await budget.append(entry);
  };

  const boundFor = async (account: string): Promise<number | null> => {
    if (bounds.has(account)) return bounds.get(account) ?? null;
    const lines = await budget.lines();
    let bound: number | null = null;
    if (lines.ok) {
      const latest = lines.value
        .map(decodeEntry)
        .filter((e): e is BudgetEntry => e !== null && e.key.connector === GITHUB_CONNECTOR && e.key.account === account)
        .filter((e) => e.basis !== 'unknown')
        .sort((a, b) => b.at - a.at)[0];
      if (latest !== undefined) bound = boundFromLimit(readingOf(latest));
    }
    bounds.set(account, bound);
    return bound;
  };

  // ONE ACQUIRE AT A TIME IN THIS PROCESS. `slotsFile` names its scratch claim
  // by pid and millisecond, so two acquires from one process in one
  // millisecond would share it and both fail.
  let acquiring: Promise<unknown> = Promise.resolve();
  const acquireOne = (account: string, bound: number): ReturnType<Slots['acquire']> => {
    const next = acquiring.then(() => slots.acquire(account, bound));
    acquiring = next.catch(() => undefined);
    return next;
  };

  const takeSlot = async (account: string): Promise<number | null> => {
    const bound = await boundFor(account);
    if (bound === null) return null;
    const started = now();
    for (;;) {
      const asked = await acquireOne(account, bound);
      if (!asked.ok) return null;
      if (asked.value !== null) return asked.value;
      if (now() - started >= waitMaxMs) return null;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  const accountFor = (secret: string): Promise<string> => {
    if (login !== null && login.token === secret) return login.account;
    const request: GithubRequest = { method: 'GET', path: '/user', label: 'user' };
    const account = (async (): Promise<string> => {
      const sent = await send(request, secret);
      const reply = 'reply' in sent ? sent.reply : null;
      const named = reply !== null && reply.status === 200 ? (reply.body as { login?: unknown } | null)?.login : undefined;
      const name = typeof named === 'string' && named !== '' ? named : UNKNOWN_ACCOUNT;
      await charge(request, name, reply);
      return name;
    })();
    login = { token: secret, account };
    return account;
  };

  const attempt = async (request: GithubRequest, secret: string): Promise<{ sent: Sent; account: string }> => {
    const account = await accountFor(secret);
    const slot = await takeSlot(account);
    try {
      const sent = await send(request, secret);
      await charge(request, account, 'reply' in sent ? sent.reply : null);
      return { sent, account };
    } finally {
      if (slot !== null) await slots.release(account, slot);
    }
  };

  const authFix = (source: TokenSource): string =>
    source === 'gh auth token'
      ? `run gh auth login --hostname ${origin.host}`
      : `set ${source} to a valid token where fleetd starts (the fleetd unit's EnvironmentVariables), or unset it to read the token from gh`;

  const classify = (request: GithubRequest, sent: Sent, source: TokenSource): GithubAnswer => {
    const apiHost = urlFor(request.path).host;
    if (!('reply' in sent)) {
      const said = sent.timedOut
        ? `no answer from ${apiHost} within ${boundMs / 1000} s (${request.label})`
        : `no answer from ${apiHost}: ${sent.error} (${request.label})`;
      return { ok: false, refusal: { kind: 'failed', said }, reply: null };
    }
    const { reply } = sent;
    const message = messageOf(reply.body);
    const retryAfter = headerNumber(reply.headers['retry-after']);
    const remaining = headerNumber(reply.headers['x-ratelimit-remaining']);
    const reset = headerNumber(reply.headers['x-ratelimit-reset']);
    const resetWait = reset === null ? undefined : Math.max(0, reset * 1000 - now());
    const waitOf = (fallback: number | undefined): { waitMs?: number } => {
      const waitMs = retryAfter !== null ? retryAfter * 1000 : fallback;
      return waitMs === undefined ? {} : { waitMs };
    };
    if (reply.status === 401) {
      const said = `GitHub refused the token from ${source} (HTTP 401: ${message || 'Bad credentials'}); ${authFix(source)}`;
      return { ok: false, refusal: { kind: 'auth', said }, reply };
    }
    if (reply.status === 403 || reply.status === 429) {
      if (/secondary rate limit/i.test(message) || (retryAfter !== null && remaining !== 0)) {
        options.observe?.('secondary');
        return { ok: false, refusal: { kind: 'secondary', said: message, ...waitOf(undefined) }, reply };
      }
      if (remaining === 0) {
        options.observe?.('throttled');
        return { ok: false, refusal: { kind: 'throttled', said: message, ...waitOf(resetWait) }, reply };
      }
    }
    if (reply.status >= 200 && reply.status < 300) {
      const limited = graphqlRateLimited(reply.body);
      if (limited !== null) {
        options.observe?.('throttled');
        return { ok: false, refusal: { kind: 'throttled', said: limited, ...waitOf(resetWait) }, reply };
      }
      options.observe?.('ok');
      return { ok: true, reply };
    }
    return { ok: false, refusal: { kind: 'failed', said: `HTTP ${reply.status}: ${message} (${request.label})` }, reply };
  };

  return {
    origin,
    base,
    graphql,
    tokenSource: async () => (await resolveToken())?.source ?? null,
    account: async () => {
      const current = await resolveToken();
      return current === null ? UNKNOWN_ACCOUNT : accountFor(current.value);
    },
    request: async (request) => {
      let current = await resolveToken();
      if (current === null) {
        const said = `no GitHub token: GH_TOKEN and GITHUB_TOKEN are unset and gh auth token --hostname ${origin.host} answered none; run gh auth login --hostname ${origin.host}`;
        return { ok: false, refusal: { kind: 'auth', said }, reply: null };
      }
      let { sent } = await attempt(request, current.value);
      if ('reply' in sent && sent.reply.status === 401 && current.source === 'gh auth token') {
        const refreshed = await ghAuthToken(origin.host);
        if (refreshed !== null) {
          token = current = { value: refreshed, source: 'gh auth token' };
          ({ sent } = await attempt(request, current.value));
        }
      }
      return classify(request, sent, current.source);
    },
  };
};

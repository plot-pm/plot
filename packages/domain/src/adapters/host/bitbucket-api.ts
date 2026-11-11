import { readFile } from 'node:fs/promises';

import type { BudgetRecord } from '../../ports/budget.js';
import type { HostRefusal, LimitObservation } from '../../ports/host.js';
import type { Slots } from '../../ports/slots.js';
import { bitbucketBudgetAccount } from '../../rules/bitbucket-budget-account.js';
import { envFileCandidates, pickEnvFile, type EnvFileRead } from '../../rules/env-file.js';
import { remoteSlug } from '../../rules/remote-slug.js';
import {
  connectorHttps,
  headerNumber,
  throttledOf,
  type ConnectorCall,
  type ConnectorReply,
  type Sent,
} from './connector-https.js';

/** The environment variable that overrides the API base URL. */
export const BITBUCKET_API_BASE_ENV = 'BITBUCKET_API_BASE';

/** The API base URL where {@link BITBUCKET_API_BASE_ENV} is unset. */
export const DEFAULT_BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

/** The connector word every ledger entry this client writes carries. */
export const BITBUCKET_CONNECTOR = 'bitbucket';

/** The bucket every ledger entry this client writes carries, as `budget_bucket` names it. */
export const BITBUCKET_BUCKET = 'api';

/** The hourly limit a reply with no rate-limit headers records, as `budget_reading` predicts it. */
export const PREDICTED_LIMIT = 1000;

/** The two variables the client reads its credential from, in the order the Basic header joins them. */
export const BITBUCKET_CREDENTIAL_VARS = ['BB_EMAIL', 'BB_TOKEN'] as const;

/** Why the Bitbucket reads stay on the shell where no credential resolves; the composition passes it as `noCredential`. */
export const BITBUCKET_NO_CREDENTIAL =
  "no credentials: BB_EMAIL and BB_TOKEN are unset in the environment and in the worktree's and the main checkout's .env";

/** Where the client's credential came from. */
export type BitbucketCredentialSource = 'environment' | 'worktree .env' | 'main checkout .env';

/** One request to the Bitbucket API. */
export interface BitbucketRequest {
  /** The HTTP method. */
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The path below the API base, such as `/repositories/{ws}/{repo}/pullrequests?state=OPEN`; `{ws}` and `{repo}` name the origin's workspace and repository. */
  readonly path: string;
  /** The JSON body, where the request carries one. */
  readonly body?: unknown;
  /** Names the request in a refusal, such as `pr-list state=OPEN, page 2`. */
  readonly label: string;
}

/** The answer to one {@link BitbucketApi.request}. */
export type BitbucketAnswer =
  | { readonly ok: true; readonly reply: ConnectorReply }
  | { readonly ok: false; readonly refusal: HostRefusal; readonly reply: ConnectorReply | null };

/** The answer to one {@link BitbucketApi.nextPath}. */
export type BitbucketNext = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly refusal: HostRefusal };

/** The seams the client reads; every one has a production default. */
export interface BitbucketApiOptions {
  /** The `origin` remote's URL, or null where the repository has none. */
  origin: string | null;
  /** Reads the credential, base URL, account override and proxy variables; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The checkout's top level, whose `.env` is read first; defaults to `PLOT_REPO_ROOT`. */
  top?: string | null;
  /** The common git directory, whose parent's `.env` is read second; defaults to `PLOT_GIT_COMMON_DIR`. */
  commonDir?: string | null;
  /** Reads one `.env` file; null where it cannot be read. Defaults to a UTF-8 file read. */
  readText?: (path: string) => Promise<string | null>;
  /** The shared ledger; defaults to `budgetFile({ rotate: true })`. */
  budget?: BudgetRecord;
  /** The shared host slots; defaults to `slotsFile()`. */
  slots?: Slots;
  /** Receives what each reply observed about the rate limit. */
  observe?: (observed: LimitObservation) => void;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** The per-request bound; defaults to `REQUEST_BOUND_MS`. */
  boundMs?: number;
  /** How often a caller at the slot bound asks again; defaults to `SLOT_POLL_MS`. */
  pollMs?: number;
  /** How long a caller waits for a slot before it proceeds; defaults to `SLOT_WAIT_MAX_MS`. */
  waitMaxMs?: number;
}

/** The one in-process Bitbucket HTTPS client. */
export interface BitbucketApi {
  /** The API base URL, with no trailing slash. */
  readonly base: string;
  /** `workspace/repository` from the `origin` remote, or null where it names no Bitbucket repository. */
  readonly slug: string | null;
  /** The account every ledger entry and host slot is charged to. */
  readonly account: string;
  /** Where the current credential came from, resolving it on the first call; null where none resolves. */
  credentialSource(): Promise<BitbucketCredentialSource | null>;
  /** Sends one request. Never rejects: a refused or unanswered request is a refusal. */
  request(request: BitbucketRequest): Promise<BitbucketAnswer>;
  /** The path below the base a page's `next` link names, or a refusal where it lies outside the base. */
  nextPath(next: string): BitbucketNext;
}

/** One resolved credential. */
interface Credential {
  readonly email: string;
  readonly token: string;
  readonly source: BitbucketCredentialSource;
}

/**
 * The API base URL: {@link BITBUCKET_API_BASE_ENV}, else {@link DEFAULT_BITBUCKET_API_BASE}.
 *
 * @param env - the environment to read the override from.
 * @returns the base URL, with no trailing slash.
 */
export const bitbucketApiBase = (env: Record<string, string | undefined>): string => {
  const override = (env[BITBUCKET_API_BASE_ENV] ?? '').replace(/\/+$/, '');
  return override !== '' ? override : DEFAULT_BITBUCKET_API_BASE;
};

/** Bitbucket's `error.message`, or the text of a body that carries none. */
const messageOf = (body: unknown): string => {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined;
  if (typeof message === 'string') return message;
  return typeof body === 'string' ? body.trim() : '';
};

/** Reads one file as UTF-8, or null where it cannot be read. */
const readTextFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/** What to set, and where, for a credential the client cannot use. */
const CREDENTIAL_FIX =
  "set BB_EMAIL and BB_TOKEN (an Atlassian API token) in the environment fleetd starts with or in the main checkout's .env";

/**
 * Builds the one in-process Bitbucket HTTPS client.
 *
 * The credential is `BB_EMAIL` and `BB_TOKEN` from the environment where both
 * are set, else from the worktree's `.env`, then the main checkout's, where the
 * file holds both. The client runs no process to find a credential. It sends
 * the pair as a Basic `Authorization` header and nowhere else. A `401` reads
 * the environment and both `.env` files once more and retries once; a second
 * `401` answers kind `auth` with the source and the fix in `said`.
 *
 * The workspace and repository come from the `origin` remote, and replace
 * `{ws}` and `{repo}` in a request path as `bb api` replaces them. Every
 * request takes one host slot where the ledger licenses a bound, and appends
 * one `BudgetEntry` with connector `bitbucket`, bucket `api` and the
 * workspace as the account. A reply with `X-RateLimit-Limit` and
 * `X-RateLimit-Remaining` records basis `actual`; any other records basis
 * `predicted` with limit 1000. A `429` answers `throttled` with the
 * `Retry-After` wait; an unanswered request answers `failed`.
 *
 * @param options - the origin and the seams.
 * @returns the client.
 */
export const bitbucketApi = (options: BitbucketApiOptions): BitbucketApi => {
  const env = options.env ?? process.env;
  const base = bitbucketApiBase(env);
  const slug = options.origin === null ? null : remoteSlug(options.origin, 'bitbucket.org');
  const account = bitbucketBudgetAccount(options.origin, env['PLOT_BUDGET_ACCOUNT']);
  const top = options.top === undefined ? (env['PLOT_REPO_ROOT'] ?? null) : options.top;
  const commonDir = options.commonDir === undefined ? (env['PLOT_GIT_COMMON_DIR'] ?? null) : options.commonDir;
  const readText = options.readText ?? readTextFile;
  const transport = connectorHttps({
    env,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.slots === undefined ? {} : { slots: options.slots }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.boundMs === undefined ? {} : { boundMs: options.boundMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(options.waitMaxMs === undefined ? {} : { waitMaxMs: options.waitMaxMs }),
  });
  const apiHost = new URL(base).host;

  let held: Credential | null = null;

  const readCredential = async (): Promise<Credential | null> => {
    const [emailVar, tokenVar] = BITBUCKET_CREDENTIAL_VARS;
    const email = env[emailVar] ?? '';
    const token = env[tokenVar] ?? '';
    if (email !== '' && token !== '') return { email, token, source: 'environment' };
    const reads: EnvFileRead[] = await Promise.all(
      envFileCandidates(top, commonDir).map(async (candidate) => ({ candidate, text: await readText(candidate.path) })),
    );
    const picked = pickEnvFile(reads, BITBUCKET_CREDENTIAL_VARS);
    if (picked === null) return null;
    return {
      email: picked.values[0],
      token: picked.values[1],
      source: picked.source === 'worktree' ? 'worktree .env' : 'main checkout .env',
    };
  };

  const resolveCredential = async (): Promise<Credential | null> => (held ??= await readCredential());

  const pathFor = (path: string): string | null => {
    if (!/\{ws\}|\{repo\}/.test(path)) return path;
    if (slug === null) return null;
    const [workspace = '', repository = ''] = slug.split('/');
    return path.replaceAll('{ws}', encodeURIComponent(workspace)).replaceAll('{repo}', encodeURIComponent(repository));
  };

  const callOf = (request: BitbucketRequest, path: string, credential: Credential): ConnectorCall => ({
    url: new URL(`${base}${path.startsWith('/') ? '' : '/'}${path}`),
    method: request.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credential.email}:${credential.token}`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'plot',
    },
    ...(request.body === undefined ? {} : { body: request.body }),
    connector: BITBUCKET_CONNECTOR,
    account,
    spend: (reply) => {
      const headers = reply?.headers ?? {};
      const limit = headerNumber(headers['x-ratelimit-limit']);
      const remaining = headerNumber(headers['x-ratelimit-remaining']);
      if (limit === null || remaining === null) {
        return { bucket: BITBUCKET_BUCKET, limit: PREDICTED_LIMIT, remaining: null, resetAt: null, basis: 'predicted' };
      }
      const reset = headerNumber(headers['x-ratelimit-reset']);
      return { bucket: BITBUCKET_BUCKET, limit, remaining, resetAt: reset === null ? null : reset * 1000, basis: 'actual' };
    },
  });

  const classify = (request: BitbucketRequest, sent: Sent, source: BitbucketCredentialSource): BitbucketAnswer => {
    if (!('reply' in sent)) {
      const said = sent.timedOut
        ? `no answer from ${apiHost} within ${transport.boundMs / 1000} s (${request.label})`
        : `no answer from ${apiHost}: ${sent.error} (${request.label})`;
      return { ok: false, refusal: { kind: 'failed', said }, reply: null };
    }
    const { reply } = sent;
    const message = messageOf(reply.body);
    if (reply.status === 401) {
      const said = `Bitbucket refused BB_EMAIL and BB_TOKEN from the ${source} (HTTP 401: ${message || 'Unauthorized'}); ${CREDENTIAL_FIX}`;
      return { ok: false, refusal: { kind: 'auth', said }, reply };
    }
    const throttled = throttledOf(reply, message, options.observe);
    if (throttled !== null) return { ok: false, refusal: throttled, reply };
    if (reply.status >= 200 && reply.status < 300) {
      options.observe?.('ok');
      return { ok: true, reply };
    }
    return { ok: false, refusal: { kind: 'failed', said: `HTTP ${reply.status}: ${message} (${request.label})` }, reply };
  };

  return {
    base,
    slug,
    account,
    credentialSource: async () => (await resolveCredential())?.source ?? null,
    request: async (request) => {
      const path = pathFor(request.path);
      if (path === null) {
        const said = `the origin remote names no Bitbucket workspace and repository, so ${request.path} cannot be asked (${request.label})`;
        return { ok: false, refusal: { kind: 'failed', said }, reply: null };
      }
      let current = await resolveCredential();
      if (current === null) {
        return { ok: false, refusal: { kind: 'auth', said: `no Bitbucket credential: ${CREDENTIAL_FIX}` }, reply: null };
      }
      let sent = await transport.exchange(callOf(request, path, current));
      if ('reply' in sent && sent.reply.status === 401) {
        held = null;
        const refreshed = await resolveCredential();
        if (refreshed !== null) {
          current = refreshed;
          sent = await transport.exchange(callOf(request, path, current));
        }
      }
      return classify(request, sent, current.source);
    },
    nextPath: (next) => {
      if (next.startsWith(`${base}/`)) return { ok: true, path: next.slice(base.length) };
      return { ok: false, refusal: { kind: 'failed', said: `next page '${next}' is outside ${base}; refusing to read past it` } };
    },
  };
};

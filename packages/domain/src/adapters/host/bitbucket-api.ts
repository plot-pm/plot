import { readFile } from 'node:fs/promises';

import { budgetOpOf } from '../../entities/budget.js';
import type { BudgetRecord } from '../../ports/budget.js';
import type { HostRefusal, LimitObservation } from '../../ports/host.js';
import type { Slots } from '../../ports/slots.js';
import { bbCeiling, bbLimitReading, type BbCeiling, type BbLimitFields } from '../../rules/bb-ledger.js';
import { bitbucketBudgetAccount } from '../../rules/bitbucket-budget-account.js';
import { DEFAULT_PREDICTED_HOST_LIMIT } from '../../rules/declared-host-limit.js';
import { envFileCandidates, pickEnvFile, readEnvVar, type EnvFileRead } from '../../rules/env-file.js';
import { remoteSlug } from '../../rules/remote-slug.js';
import {
  connectorHttps,
  headerNumber,
  throttledOf,
  type ConnectorCall,
  type ConnectorReply,
  type Sent,
} from './connector-https.js';
import { bbLedgerFile, type BbLedger } from './bb-ledger-file.js';

/** The environment variable that overrides the API base URL. */
export const BITBUCKET_API_BASE_ENV = 'BITBUCKET_API_BASE';

/** The API base URL where {@link BITBUCKET_API_BASE_ENV} is unset. */
export const DEFAULT_BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

/** The connector word every ledger entry this client writes carries. */
export const BITBUCKET_CONNECTOR = 'bitbucket';

/** The bucket every ledger entry this client writes carries, as `budget_bucket` names it. */
export const BITBUCKET_BUCKET = 'api';

/** The two variables the client reads its credential from, in the order the Basic header joins them. */
export const BITBUCKET_CREDENTIAL_VARS = ['BB_EMAIL', 'BB_TOKEN'] as const;

/** Why the Bitbucket reads stay on the shell where no credential resolves; the composition passes it as `noCredential`. */
export const BITBUCKET_NO_CREDENTIAL =
  "no credentials: BB_EMAIL and BB_TOKEN are unset in the environment and in the worktree's and the main checkout's .env";

/** The `bb` variables the client reads from the environment, else from the `.env` files. */
export const BB_LEDGER_VARS = ['BB_HOURLY_LIMIT', 'BB_STATE_DIR', 'XDG_STATE_HOME'] as const;

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
  /** The hourly limit a reply with no numeric `X-RateLimit-Limit` records where the ledger keeps no count; defaults to `DEFAULT_PREDICTED_HOST_LIMIT`. */
  predictedLimit?: number;
  /** The declared `Host rate limit`, or null where none is declared; lowers the ledger's ceiling and never raises it. */
  declaredLimit?: number | null;
  /** `bb`'s request ledger; defaults to `bbLedgerFile` over `BB_STATE_DIR`, `XDG_STATE_HOME` and `HOME`. */
  ledger?: BbLedger;
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
 * workspace as the account. A reply with a numeric `X-RateLimit-Limit`
 * records basis `actual` with that limit, with `X-RateLimit-Remaining` and
 * `X-RateLimit-Reset` where the reply carries them and null where it does not;
 * any other reply records basis `predicted` from `bb`'s ledger
 * (`bbLimitReading`), or with `options.predictedLimit`, 800 where it is unset,
 * where the ledger keeps no count. The bucket is
 * `api` whatever `X-RateLimit-Resource` names. A `429` answers `throttled` with the
 * `Retry-After` wait; an unanswered request answers `failed`.
 *
 * Every exchange, the retry after a `401` included, first passes `bb`'s ledger
 * for the credential's email: during a pause or at the ceiling it answers
 * `throttled` in `bb`'s words and sends nothing, so it takes no slot and
 * appends no `BudgetEntry`; otherwise it appends one request line and sends.
 * The ceiling is `BB_HOURLY_LIMIT`, lowered to `options.declaredLimit` where
 * that is smaller; an invalid `BB_HOURLY_LIMIT` answers `failed` for every
 * request. `BB_HOURLY_LIMIT`, `BB_STATE_DIR` and `XDG_STATE_HOME` come from
 * `env` where set and not empty, else from the worktree's `.env`, then the main
 * checkout's. A `429` starts or extends `bb`'s pause, and the refusal's wait is
 * the time left on it.
 *
 * @param options - the origin and the seams.
 * @returns the client.
 */
export const bitbucketApi = (options: BitbucketApiOptions): BitbucketApi => {
  const env = options.env ?? process.env;
  const base = bitbucketApiBase(env);
  const slug = options.origin === null ? null : remoteSlug(options.origin, 'bitbucket.org');
  const account = bitbucketBudgetAccount(options.origin, env['PLOT_BUDGET_ACCOUNT']);
  const predicted = options.predictedLimit ?? DEFAULT_PREDICTED_HOST_LIMIT;
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
  const now = options.now ?? Date.now;
  const declared = options.declaredLimit ?? null;

  let held: Credential | null = null;
  let ledgerHeld: Promise<{ ledger: BbLedger; ceiling: BbCeiling }> | null = null;

  const readLedgerVars = async (): Promise<Record<string, string | undefined>> => {
    const values: Record<string, string | undefined> = {};
    const missing = BB_LEDGER_VARS.filter((name) => (env[name] ?? '') === '');
    for (const name of BB_LEDGER_VARS) if (!missing.includes(name)) values[name] = env[name];
    if (missing.length === 0) return values;
    const texts = await Promise.all(envFileCandidates(top, commonDir).map((candidate) => readText(candidate.path)));
    for (const name of missing) {
      for (const text of texts) {
        const value = text === null ? '' : readEnvVar(text, name);
        if (value !== '') {
          values[name] = value;
          break;
        }
      }
    }
    return values;
  };

  const resolveLedger = (): Promise<{ ledger: BbLedger; ceiling: BbCeiling }> =>
    (ledgerHeld ??= (async () => {
      const vars = await readLedgerVars();
      const ledger =
        options.ledger ??
        bbLedgerFile({
          env: { BB_STATE_DIR: vars['BB_STATE_DIR'], XDG_STATE_HOME: vars['XDG_STATE_HOME'], HOME: env['HOME'] },
          now,
        });
      return { ledger, ceiling: bbCeiling(vars['BB_HOURLY_LIMIT'], declared) };
    })());

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

  const callOf = (
    request: BitbucketRequest,
    path: string,
    credential: Credential,
    fields: BbLimitFields | null,
  ): ConnectorCall => ({
    url: new URL(`${base}${path.startsWith('/') ? '' : '/'}${path}`),
    method: request.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${credential.email}:${credential.token}`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'plot',
    },
    ...(request.body === undefined ? {} : { body: request.body }),
    connector: BITBUCKET_CONNECTOR,
    op: budgetOpOf(request.label),
    account,
    spend: (reply) => {
      const headers = reply?.headers ?? {};
      const limit = headerNumber(headers['x-ratelimit-limit']);
      if (limit === null) {
        if (fields === null) {
          return { bucket: BITBUCKET_BUCKET, limit: predicted, remaining: null, resetAt: null, basis: 'predicted' };
        }
        const reading = bbLimitReading(fields, declared, now());
        return { bucket: BITBUCKET_BUCKET, limit: reading.limit, remaining: reading.remaining, resetAt: reading.resetAt, basis: 'predicted' };
      }
      const remaining = headerNumber(headers['x-ratelimit-remaining']);
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

  /** One exchange behind `bb`'s ledger: a refusal sends nothing; a `429` writes the pause. */
  const guarded = async (
    request: BitbucketRequest,
    path: string,
    credential: Credential,
  ): Promise<{ refused: BitbucketAnswer } | { sent: Sent; pauseEnd: number | null }> => {
    const { ledger, ceiling } = await resolveLedger();
    if (!ceiling.ok) return { refused: { ok: false, refusal: { kind: 'failed', said: ceiling.said }, reply: null } };
    const verdict = await ledger.guard(credential.email, ceiling.ceiling);
    if (verdict.verdict !== 'send') {
      return {
        refused: { ok: false, refusal: { kind: 'throttled', said: verdict.said, waitMs: verdict.waitSeconds * 1000 }, reply: null },
      };
    }
    const sent = await transport.exchange(callOf(request, path, credential, verdict.fields));
    if (!('reply' in sent) || sent.reply.status !== 429) return { sent, pauseEnd: null };
    const pause = await ledger.pauseAfter429(credential.email, sent.reply.headers['retry-after'] ?? null);
    return { sent, pauseEnd: pause.end };
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
      let step = await guarded(request, path, current);
      if ('refused' in step) return step.refused;
      if ('reply' in step.sent && step.sent.reply.status === 401) {
        held = null;
        const refreshed = await resolveCredential();
        if (refreshed !== null) {
          current = refreshed;
          step = await guarded(request, path, current);
          if ('refused' in step) return step.refused;
        }
      }
      const answer = classify(request, step.sent, current.source);
      if (answer.ok || answer.refusal.kind !== 'throttled' || step.pauseEnd === null) return answer;
      return { ...answer, refusal: { ...answer.refusal, waitMs: Math.max(0, step.pauseEnd * 1000 - now()) } };
    },
    nextPath: (next) => {
      if (next.startsWith(`${base}/`)) return { ok: true, path: next.slice(base.length) };
      return { ok: false, refusal: { kind: 'failed', said: `next page '${next}' is outside ${base}; refusing to read past it` } };
    },
  };
};

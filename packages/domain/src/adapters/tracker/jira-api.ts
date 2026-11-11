import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { BudgetRecord } from '../../ports/budget.js';
import type { HostRefusal, LimitObservation } from '../../ports/host.js';
import type { Slots } from '../../ports/slots.js';
import { envFileCandidates, pickEnvFile, type EnvFileCandidate } from '../../rules/env-file.js';
import { jiraBudgetAccount, UNKNOWN_BUDGET_ACCOUNT } from '../../rules/jira-budget-account.js';
import { givenGitDirs } from '../git-dirs/git-dirs.js';
import {
  connectorHttps,
  headerNumber,
  throttledOf,
  type ConnectorCall,
  type ConnectorReply,
  type Sent,
} from '../host/connector-https.js';

/** The connector word every ledger entry this client writes carries. */
export const JIRA_CONNECTOR = 'jira';

/** The bucket every ledger entry this client writes carries, as `budget_record_jira` writes it. */
export const JIRA_BUCKET = 'api';

/** The environment variable that overrides the configured base URL. */
export const JIRA_BASE_URL_ENV = 'PLOT_JIRA_BASE_URL';

/** The two variables the client authenticates with. */
export const JIRA_CREDENTIAL_NAMES = ['JIRA_EMAIL', 'JIRA_API_TOKEN'] as const;

/** What a read answers where no base URL is configured: `jira_require_config`'s sentence in `plot-host.sh`. */
export const JIRA_NO_BASE_URL =
  "Tracker is jira but no base URL is configured (write 'Tracker: jira https://your.atlassian.net' or set PLOT_JIRA_BASE_URL)";

/** What a read answers where no credentials resolve: `jira_require_config`'s lines in `plot-host.sh`. */
export const JIRA_NO_CREDENTIALS = [
  'Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment — an unauthenticated Jira must not read as an empty inbox',
  '  Create a token at https://id.atlassian.com/manage-profile/security/api-tokens',
  '  then export JIRA_EMAIL=<your account email> and JIRA_API_TOKEN=<the token>,',
  "  or put both in this repository's .env (which .gitignore already excludes).",
].join('\n');

/** Where the client's credentials came from. */
export type JiraCredentialSource =
  | { readonly kind: 'environment' }
  | { readonly kind: '.env'; readonly path: string; readonly source: EnvFileCandidate['source'] };

/** One request to the Jira REST API. */
export interface JiraRequest {
  /** The HTTP method. */
  readonly method: 'GET' | 'POST' | 'PUT';
  /** The path below the base URL, such as `/rest/api/2/search/jql`. */
  readonly path: string;
  /** The query parameters, encoded by the client. */
  readonly query?: Readonly<Record<string, string>>;
  /** The JSON body, where the request carries one. */
  readonly body?: unknown;
  /** Names the request in a refusal, such as `open issues, page 2`. */
  readonly label: string;
}

/** The answer to one {@link JiraApi.request}. */
export type JiraAnswer =
  | { readonly ok: true; readonly reply: ConnectorReply }
  | { readonly ok: false; readonly refusal: HostRefusal; readonly reply: ConnectorReply | null };

/** The seams the client reads; every one but `repoRoot` has a production default. */
export interface JiraApiOptions {
  /** The checkout whose `.env` and main checkout's `.env` the client may read. */
  repoRoot: string;
  /** The base URL the `Tracker` config value names, trailing slashes allowed; `''` where none. */
  baseUrl?: string;
  /** Reads the credential, base URL, proxy and git-dir variables; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Reads one file's text, null where it cannot be read; defaults to `readFileSync`. */
  readText?: (path: string) => string | null;
  /** The shared ledger; defaults to `budgetFile({ rotate: true })`. */
  budget?: BudgetRecord;
  /** The shared host slots; defaults to `slotsFile()`. */
  slots?: Slots;
  /** Receives what each reply observed about the rate limit. */
  observe?: (observed: LimitObservation) => void;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** The per-request bound; defaults to the transport's 30 s. */
  boundMs?: number;
  /** How often a caller at the slot bound asks again. */
  pollMs?: number;
  /** How long a caller waits for a slot before it proceeds. */
  waitMaxMs?: number;
}

/** The one in-process Jira HTTPS client. */
export interface JiraApi {
  /** The base URL, or `''` where none is configured. */
  readonly base: string;
  /** Where the current credentials came from, resolving them on the first call; null where none resolve. */
  credentialSource(): JiraCredentialSource | null;
  /** The ledger account of the current credentials, or `unknown`. */
  account(): string;
  /** Sends one request. Never rejects: a refused or unanswered request is a refusal. */
  request(request: JiraRequest): Promise<JiraAnswer>;
}

/**
 * The base URL the client sends to.
 *
 * Follows `tracker_base_url` in `plot-host.sh`: a non-empty
 * `PLOT_JIRA_BASE_URL` wins as given, else the configured address with its
 * trailing slashes removed.
 *
 * @param configured - the second token of the `Tracker` config value, or `''`.
 * @param env - the environment to read the override from.
 * @returns the base URL, or `''` where neither names one.
 */
export const jiraBaseUrl = (configured: string, env: Record<string, string | undefined>): string => {
  const override = env[JIRA_BASE_URL_ENV] ?? '';
  return override !== '' ? override : configured.replace(/\/+$/, '');
};

const readTextOf = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Jira's `errorMessages` and `message`, or the text of a body that carries neither. */
const messageOf = (body: unknown): string => {
  if (typeof body === 'object' && body !== null) {
    const { errorMessages, message } = body as { errorMessages?: unknown; message?: unknown };
    if (Array.isArray(errorMessages) && errorMessages.length > 0) return errorMessages.map(String).join('; ');
    if (typeof message === 'string') return message;
    return '';
  }
  return typeof body === 'string' ? body.trim() : '';
};

/** `X-RateLimit-Reset` as epoch milliseconds: whole seconds, or an ISO 8601 timestamp. */
const resetOf = (value: string | undefined): number | null => {
  const seconds = headerNumber(value);
  if (seconds !== null) return seconds * 1000;
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Builds the one in-process Jira HTTPS client, over the shared transport.
 *
 * The credentials are `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment.
 * Where both are unset, the client reads the worktree's `.env`, then the main
 * checkout's, as `jira_load_env_file` does; the main checkout comes from
 * `PLOT_GIT_COMMON_DIR` or `PLOT_REPO_ROOT`, so no `git` starts. With no base
 * URL or no credentials a request answers kind `failed` with the shell's
 * sentence and sends nothing. The credentials travel as Basic auth in a header
 * only.
 *
 * A `401` re-reads the environment and `.env` once and retries once; a second
 * `401`, or a re-read that finds nothing, answers kind `auth` with the source
 * and the fix in `said`. A `429` answers `throttled` with the `Retry-After`
 * wait. No answer within the bound and any other status answer `failed`.
 *
 * Every request sent appends one ledger entry with connector `jira`, bucket
 * `api` and the account `jira:` plus 12 hex digits of the email's SHA-256.
 * The basis is `unknown` unless the answer carries `X-RateLimit-Limit`, which
 * makes it `actual`.
 *
 * @param options - the checkout and the seams.
 * @returns the client.
 */
export const jiraApi = (options: JiraApiOptions): JiraApi => {
  const env = options.env ?? process.env;
  const readText = options.readText ?? readTextOf;
  const base = jiraBaseUrl(options.baseUrl ?? '', env);
  const transport = connectorHttps({
    env,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.slots === undefined ? {} : { slots: options.slots }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.boundMs === undefined ? {} : { boundMs: options.boundMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(options.waitMaxMs === undefined ? {} : { waitMaxMs: options.waitMaxMs }),
  });

  interface Credential {
    readonly email: string;
    readonly token: string;
    readonly source: JiraCredentialSource;
    readonly account: string;
  }

  const credentialOf = (email: string, token: string, source: JiraCredentialSource): Credential => ({
    email,
    token,
    source,
    account: jiraBudgetAccount({ email, connector: JIRA_CONNECTOR, sha256Hex }),
  });

  const readCredential = (): Credential | null => {
    const email = env[JIRA_CREDENTIAL_NAMES[0]] ?? '';
    const token = env[JIRA_CREDENTIAL_NAMES[1]] ?? '';
    if (email !== '' && token !== '') return credentialOf(email, token, { kind: 'environment' });
    if (email !== '' || token !== '') return null;
    const dirs = givenGitDirs(options.repoRoot, env);
    const candidates = envFileCandidates(dirs?.toplevel ?? options.repoRoot, dirs?.commonDir ?? null);
    const picked = pickEnvFile(
      candidates.map((candidate) => ({ candidate, text: readText(candidate.path) })),
      JIRA_CREDENTIAL_NAMES,
    );
    return picked === null
      ? null
      : credentialOf(picked.values[0], picked.values[1], { kind: '.env', path: picked.path, source: picked.source });
  };

  let held: Credential | null | undefined;
  const credential = (): Credential | null => (held === undefined ? (held = readCredential()) : held);

  const urlFor = (request: JiraRequest): URL => {
    const url = new URL(`${base}${request.path}`);
    for (const [name, value] of Object.entries(request.query ?? {})) url.searchParams.set(name, value);
    return url;
  };

  const callOf = (request: JiraRequest, current: Credential): ConnectorCall => ({
    url: urlFor(request),
    method: request.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${current.email}:${current.token}`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'plot',
    },
    ...(request.body === undefined ? {} : { body: request.body }),
    connector: JIRA_CONNECTOR,
    account: current.account,
    spend: (reply) => {
      const headers = reply?.headers ?? {};
      const limit = headerNumber(headers['x-ratelimit-limit']);
      return {
        bucket: JIRA_BUCKET,
        limit,
        remaining: limit === null ? null : headerNumber(headers['x-ratelimit-remaining']),
        resetAt: limit === null ? null : resetOf(headers['x-ratelimit-reset']),
        basis: limit === null ? 'unknown' : 'actual',
      };
    },
  });

  const sourceText = (source: JiraCredentialSource): string =>
    source.kind === 'environment' ? 'the environment' : source.path;

  const authFix = (source: JiraCredentialSource): string =>
    source.kind === 'environment'
      ? 'set JIRA_EMAIL and JIRA_API_TOKEN to a valid pair where fleetd starts, or unset both to read them from .env'
      : `replace JIRA_API_TOKEN in ${source.path} with a token from https://id.atlassian.com/manage-profile/security/api-tokens`;

  const classify = (request: JiraRequest, sent: Sent, source: JiraCredentialSource): JiraAnswer => {
    const host = urlFor(request).host;
    if (!('reply' in sent)) {
      const said = sent.timedOut
        ? `no answer from ${host} within ${transport.boundMs / 1000} s (${request.label})`
        : `no answer from ${host}: ${sent.error} (${request.label})`;
      return { ok: false, refusal: { kind: 'failed', said }, reply: null };
    }
    const { reply } = sent;
    const message = messageOf(reply.body);
    if (reply.status === 401) {
      const said = `Jira refused JIRA_EMAIL and JIRA_API_TOKEN from ${sourceText(source)} (HTTP 401: ${message || 'Unauthorized'}); ${authFix(source)}`;
      return { ok: false, refusal: { kind: 'auth', said }, reply };
    }
    const throttled = throttledOf(reply, message || 'HTTP 429', options.observe);
    if (throttled !== null) return { ok: false, refusal: throttled, reply };
    if (reply.status >= 200 && reply.status < 300) {
      options.observe?.('ok');
      return { ok: true, reply };
    }
    return { ok: false, refusal: { kind: 'failed', said: `HTTP ${reply.status}: ${message} (${request.label})` }, reply };
  };

  return {
    base,
    credentialSource: () => credential()?.source ?? null,
    account: () => credential()?.account ?? UNKNOWN_BUDGET_ACCOUNT,
    request: async (request) => {
      if (base === '') return { ok: false, refusal: { kind: 'failed', said: JIRA_NO_BASE_URL }, reply: null };
      const first = credential();
      if (first === null) return { ok: false, refusal: { kind: 'failed', said: JIRA_NO_CREDENTIALS }, reply: null };
      const sent = await transport.exchange(callOf(request, first));
      if (!('reply' in sent) || sent.reply.status !== 401) return classify(request, sent, first.source);
      held = readCredential();
      if (held === null) return classify(request, sent, first.source);
      return classify(request, await transport.exchange(callOf(request, held)), held.source);
    },
  };
};

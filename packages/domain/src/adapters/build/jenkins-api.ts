import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { BudgetRecord } from '../../ports/budget.js';
import type { Slots } from '../../ports/slots.js';
import { bitbucketBudgetAccount } from '../../rules/bitbucket-budget-account.js';
import { listingBuildMap, plainBuildMap, shapeOfJob, type CiBuildMap } from '../../rules/ci-build-map.js';
import { ciRunsOf, type CiRun } from '../../rules/ci-sha-runs.js';
import {
  jenInstanceUrl,
  jenJobPath,
  jenJobsOf,
  jenSaveToken,
  jenSecretFile,
  jenStatusClass,
  jenUrlHost,
} from '../../rules/jen-url.js';
import { connectorHttps, throttledOf, type ConnectorCall, type ConnectorReply, type Sent } from '../host/connector-https.js';
import type { HostRefusal } from '../../ports/host.js';

/** The connector word every ledger entry this client writes carries. */
export const JENKINS_CONNECTOR = 'jenkins';

/** The bucket of an instance request: the shell's `budget_bucket` names none for this connector. */
export const JENKINS_BUCKET = '';

/** The bucket of a token-endpoint request, kept apart so it never sets the slot bound. */
export const JENKINS_TOKEN_BUCKET = 'token';

/** The limit an instance request records, as `ci-limit` predicts it. */
export const JENKINS_PREDICTED_LIMIT = 60;

/** The secret key `jen` keeps the identity provider's token blob under. */
export const KEYCLOAK_TOKEN_KEY = 'keycloak-token';

/** The client id of the refresh grant, as `jen` sends it where `JEN_CLIENT_ID` is unset. */
export const DEFAULT_CLIENT_ID = 'cli';

/** The longest piece of a reply body a refusal quotes. */
const BODY_CUT = 200;

/** The refusal kinds this client answers. `unaskable` names a question this transport must not send. */
export type JenkinsRefusalKind = 'auth' | 'unaskable' | 'failed' | 'throttled';

/** Why one Jenkins request got no answer. */
export interface JenkinsRefusal {
  /** What kind of refusal. */
  readonly kind: JenkinsRefusalKind;
  /** The reason in plain words; it never holds a credential. */
  readonly said: string;
  /** How long to wait before asking again, where the instance said. */
  readonly waitMs?: number;
}

/** One request to the Jenkins instance. */
export interface JenkinsRequest {
  /** The path below the instance URL, such as `/job/team/job/portal/api/json`. */
  readonly path: string;
  /** Names the request in a refusal. */
  readonly label: string;
}

/** The answer to one {@link JenkinsApi.request}. */
export type JenkinsAnswer =
  | { readonly ok: true; readonly reply: ConnectorReply }
  | { readonly ok: false; readonly refusal: JenkinsRefusal; readonly reply: ConnectorReply | null };

/** Where the bearer came from. */
export type JenkinsCredentialSource = 'environment' | 'store';

/** What {@link JenkinsApi.ready} answers. */
export type JenkinsReady =
  | { readonly ok: true; readonly source: JenkinsCredentialSource; readonly dir: string | null; readonly realm: string }
  | { readonly ok: false; readonly kind: 'auth' | 'unaskable'; readonly reason: string };

/** The seams the client reads; every one has a production default. */
export interface JenkinsApiOptions {
  /** The declared Jenkins instance: a slug, a host or a URL. */
  instance: string;
  /** Reads `JEN_URL`, `JEN_REALM_URL`, `JEN_CLIENT_ID`, `JEN_CONFIG_DIR`, `XDG_CONFIG_HOME`, `HOME`, `JEN_TOKEN`, `JENKINS_USER`, `JENKINS_API_TOKEN`, `PLOT_BUDGET_ACCOUNT` and the proxy variables; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The shared ledger; defaults to `budgetFile({ rotate: true })`. */
  budget?: BudgetRecord;
  /** The shared host slots; defaults to `slotsFile()`. */
  slots?: Slots;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** The per-request bound; defaults to `REQUEST_BOUND_MS`. */
  boundMs?: number;
  /** How often a caller at the slot bound asks again. */
  pollMs?: number;
  /** How long a caller waits for a slot before it proceeds. */
  waitMaxMs?: number;
  /** How long to wait before re-reading an empty or unparseable token blob; defaults to 100. */
  tornReadMs?: number;
  /** How old the refresh lock may be before it is stolen; defaults to 30 000. */
  lockStaleMs?: number;
  /** How often a caller waiting for the lock asks again; defaults to 25. */
  lockPollMs?: number;
  /** How long a caller waits for the lock before it refuses; defaults to 45 000. */
  lockWaitMs?: number;
}

/** The one in-process Jenkins HTTPS client. */
export interface JenkinsApi {
  /** The instance URL with no trailing slash, or null where the declared instance names none. */
  readonly url: string | null;
  /** The account every ledger entry and host slot is charged to. */
  readonly account: string;
  /** The directory the token store is read from, or null where no home resolves. */
  readonly dir: string | null;
  /** Probes whether this client can ask. Sends nothing and refreshes nothing. */
  ready(): Promise<JenkinsReady>;
  /** Sends one request. Never rejects: a refused or unanswered request is a refusal. */
  request(request: JenkinsRequest): Promise<JenkinsAnswer>;
}

/** The token blob `jen` keeps, the keys this client reads. */
interface Blob {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_at?: number;
}

/** One bearer the client may send. */
interface Bearer {
  readonly token: string;
  readonly source: JenkinsCredentialSource;
}

type BearerAnswer = { readonly ok: true; readonly bearer: Bearer } | { readonly ok: false; readonly refusal: JenkinsRefusal };

/** The hosts a credential may reach over `http:`. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Tells whether a credential may go to a URL: `https:`, or `http:` on a loopback host.
 *
 * @param text - the URL.
 * @returns true where the scheme and host admit a credential.
 */
export const credentialSafe = (text: string): boolean => {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
};

/** Waits. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a file as text with trailing newlines removed, as `$(cat file)` does; null where it cannot be read. */
const readSecret = async (path: string): Promise<string | null> => {
  try {
    return (await readFile(path, 'utf8')).replace(/\n+$/, '');
  } catch {
    return null;
  }
};

/** Parses a token blob; null where the text is not a JSON object with an `access_token`. */
const parseBlob = (text: string): Blob | null => {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record['access_token'] !== 'string' || record['access_token'] === '') return null;
    return {
      access_token: record['access_token'],
      ...(typeof record['refresh_token'] === 'string' && record['refresh_token'] !== '' ? { refresh_token: record['refresh_token'] } : {}),
      ...(typeof record['expires_at'] === 'number' ? { expires_at: record['expires_at'] } : {}),
    };
  } catch {
    return null;
  }
};

/**
 * Reads the `iss` claim of a JWT without checking its signature.
 *
 * The token comes from the user's own store or environment, and the claim only
 * names where to refresh it; the identity provider checks the grant.
 *
 * @param token - the access token.
 * @returns the issuer, or null where the token carries none.
 */
export const issuerOf = (token: string): string | null => {
  const payload = token.split('.')[1];
  if (payload === undefined || payload === '') return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const iss = typeof claims === 'object' && claims !== null ? (claims as { iss?: unknown }).iss : undefined;
    return typeof iss === 'string' && iss !== '' ? iss : null;
  } catch {
    return null;
  }
};

/** Narrows a host refusal to this client's kinds: a secondary limit is a throttle here. */
const narrowed = (refusal: HostRefusal): JenkinsRefusal => ({
  kind: refusal.kind === 'secondary' ? 'throttled' : refusal.kind,
  said: refusal.said,
  ...(refusal.waitMs === undefined ? {} : { waitMs: refusal.waitMs }),
});

/** Cuts a text body to {@link BODY_CUT} characters with tags removed. */
const plainText = (text: string): string => text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BODY_CUT);

/** The instance's own `message`, or the cut text of a body that carries none. */
const messageOf = (body: unknown): string => {
  if (typeof body === 'string') return plainText(body);
  const message = typeof body === 'object' && body !== null ? (body as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? plainText(message) : '';
};

/** What to run where the session is dead. */
const LOGIN_FIX = 'run `jen auth login`';

/**
 * The token store's directory, as `jen` resolves `JEN_CONFIG_DIR`.
 *
 * @param env - the environment.
 * @returns the directory, or null where no `JEN_CONFIG_DIR`, `XDG_CONFIG_HOME` or `HOME` names one.
 */
export const jenConfigDir = (env: Record<string, string | undefined>): string | null => {
  const explicit = env['JEN_CONFIG_DIR'] ?? '';
  if (explicit !== '') return explicit;
  const xdg = env['XDG_CONFIG_HOME'] ?? '';
  if (xdg !== '') return `${xdg}/jen`;
  const home = env['HOME'] ?? '';
  return home === '' ? null : `${home}/.config/jen`;
};

/**
 * Builds the one in-process Jenkins HTTPS client.
 *
 * The client sends two headers, as `jen` does: `Authorization: Bearer` with
 * the identity provider's access token, and `X-Jenkins-Authorization: Basic`
 * with the Jenkins user and API token where both exist. The bearer is
 * `JEN_TOKEN` where set, else `keycloak-token.secret` in the store directory.
 * The Jenkins pair is `JENKINS_USER` and `JENKINS_API_TOKEN`, else the
 * per-instance files of the same store. The client runs no process and reads no
 * `.env`. A credential goes only to `https:` URLs and to loopback `http:`.
 *
 * An expired stored token refreshes under an `O_EXCL` lock on
 * `keycloak-token.lock` in the store directory, so two clients, in one process
 * or two, post one grant. Under the lock the client re-reads the store and
 * adopts a newer blob before it posts. It writes the new blob through a
 * mode-`0600` temp file and `rename`, so a reader never sees a partial blob.
 * An environment bearer is never refreshed or written.
 *
 * The transport follows no redirect. A `401`, a `403` and a redirect to
 * `/oauth2/` or the realm host re-read the source and retry once, then answer
 * kind `auth`. A redirect to the instance's own host is an answer. A redirect
 * to any other host answers `unaskable` after one request.
 *
 * Every instance request appends one ledger entry with connector `jenkins`,
 * bucket `''` and basis `predicted`, limit 60. A refresh appends one entry with
 * bucket `token` and basis `unknown`, which sets no slot bound.
 *
 * @param options - the declared instance and the seams.
 * @returns the client.
 */
export const jenkinsApi = (options: JenkinsApiOptions): JenkinsApi => {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const tornReadMs = options.tornReadMs ?? 100;
  const lockStaleMs = options.lockStaleMs ?? 30_000;
  const lockPollMs = options.lockPollMs ?? 25;
  const lockWaitMs = options.lockWaitMs ?? 45_000;
  const url = jenInstanceUrl(env['JEN_URL'], options.instance);
  const instanceKey = url === null ? '' : jenUrlHost(url);
  const account = bitbucketBudgetAccount(null, env['PLOT_BUDGET_ACCOUNT']);
  const dir = jenConfigDir(env);
  const clientId = (env['JEN_CLIENT_ID'] ?? '') === '' ? DEFAULT_CLIENT_ID : (env['JEN_CLIENT_ID'] as string);
  const transport = connectorHttps({
    env,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.slots === undefined ? {} : { slots: options.slots }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.boundMs === undefined ? {} : { boundMs: options.boundMs }),
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
    ...(options.waitMaxMs === undefined ? {} : { waitMaxMs: options.waitMaxMs }),
  });

  const blobPath = dir === null ? null : jenSecretFile(dir, KEYCLOAK_TOKEN_KEY);
  const lockPath = dir === null ? null : join(dir, 'keycloak-token.lock');
  const nowSeconds = (): number => Math.floor(now() / 1000);
  const fresh = (blob: Blob): boolean => (blob.expires_at ?? 0) > nowSeconds();

  /** Reads the stored blob: an empty or unparseable read is a torn read of a writer, so it reads once more after a pause. */
  const readBlob = async (): Promise<Blob | null> => {
    if (blobPath === null) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await readSecret(blobPath);
      if (text === null) return null;
      const blob = text === '' ? null : parseBlob(text);
      if (blob !== null) return blob;
      if (attempt === 0) await sleep(tornReadMs);
    }
    return null;
  };

  const writeBlob = async (text: string): Promise<void> => {
    if (dir === null || blobPath === null) throw new Error('no store directory');
    const temp = join(dir, `.${KEYCLOAK_TOKEN_KEY}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(text);
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, blobPath);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  };

  /** Runs `work` holding the store's lock; null where the lock stayed held past the wait. */
  const underLock = async <T>(work: () => Promise<T>): Promise<{ value: T } | null> => {
    if (lockPath === null) return null;
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      try {
        const handle = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        await handle.writeFile(String(process.pid));
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const held = await stat(lockPath);
          if (Date.now() - held.mtimeMs > lockStaleMs) {
            await unlink(lockPath).catch(() => undefined);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) return null;
        await sleep(lockPollMs);
      }
    }
    try {
      return { value: await work() };
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  };

  const realmOf = (access: string | null): string | null => {
    const declared = (env['JEN_REALM_URL'] ?? '').replace(/\/+$/, '');
    if (declared !== '') return declared;
    return access === null ? null : issuerOf(access);
  };

  const refusal = (kind: JenkinsRefusalKind, said: string): { ok: false; refusal: JenkinsRefusal } => ({ ok: false, refusal: { kind, said } });

  /** Posts one refresh grant, and stores the answer. */
  const grant = async (blob: Blob, realm: string): Promise<BearerAnswer> => {
    const endpoint = `${realm}/protocol/openid-connect/token`;
    if (!credentialSafe(endpoint)) return refusal('unaskable', `the token endpoint ${jenUrlHost(endpoint) || 'URL'} is neither https nor loopback, so no credential is sent`);
    const call: ConnectorCall = {
      url: new URL(endpoint),
      method: 'POST',
      headers: { Accept: 'application/json', 'User-Agent': 'plot' },
      form: { grant_type: 'refresh_token', client_id: clientId, refresh_token: blob.refresh_token ?? '' },
      connector: JENKINS_CONNECTOR,
      account,
      spend: () => ({ bucket: JENKINS_TOKEN_BUCKET, limit: null, remaining: null, resetAt: null, basis: 'unknown' }),
    };
    const sent: Sent = await transport.exchange(call);
    if (!('reply' in sent)) return refusal('failed', `no answer from the token endpoint at ${jenUrlHost(endpoint)}: ${sent.timedOut ? 'timeout' : 'unreachable'}`);
    const body = sent.reply.body;
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (sent.reply.status >= 200 && sent.reply.status < 300 && typeof fields['access_token'] === 'string' && fields['access_token'] !== '') {
      const text = jenSaveToken(fields, nowSeconds());
      try {
        await writeBlob(text);
      } catch {
        return refusal('failed', `the refreshed token could not be written to ${dir ?? 'the store'}`);
      }
      return { ok: true, bearer: { token: fields['access_token'], source: 'store' } };
    }
    if (sent.reply.status === 429) {
      const throttled = throttledOf(sent.reply, 'the token endpoint is rate limiting');
      if (throttled !== null) return { ok: false, refusal: narrowed(throttled) };
    }
    const error = typeof fields['error'] === 'string' ? plainText(fields['error']) : '';
    const description = typeof fields['error_description'] === 'string' ? plainText(fields['error_description']) : '';
    if (error === 'invalid_grant') {
      const adopted = await readBlob();
      if (adopted !== null && adopted.access_token !== blob.access_token && fresh(adopted)) {
        return { ok: true, bearer: { token: adopted.access_token, source: 'store' } };
      }
      return refusal('auth', `the identity provider refused the refresh token (invalid_grant${description === '' ? '' : `: ${description}`}); ${LOGIN_FIX}`);
    }
    const said = `the token endpoint answered HTTP ${sent.reply.status}${error === '' ? '' : ` (${error}${description === '' ? '' : `: ${description}`})`}`;
    return refusal(sent.reply.status >= 500 ? 'failed' : 'auth', sent.reply.status >= 500 ? said : `${said}; ${LOGIN_FIX}`);
  };

  const refreshing = { current: null as Promise<BearerAnswer> | null };

  const refresh = async (stale: Blob): Promise<BearerAnswer> => {
    const realm = realmOf(stale.access_token);
    if (realm === null) return refusal('unaskable', 'the stored token names no realm');
    const done = await underLock(async (): Promise<BearerAnswer> => {
      const latest = await readBlob();
      if (latest !== null && fresh(latest)) return { ok: true, bearer: { token: latest.access_token, source: 'store' } };
      const current = latest ?? stale;
      if ((current.refresh_token ?? '') === '') return refusal('auth', `the session expired and no refresh token is stored; ${LOGIN_FIX}`);
      return grant(current, realm);
    });
    return done === null ? refusal('failed', `the token store lock in ${dir ?? 'the store'} stayed held`) : done.value;
  };

  /** Reads the source once more and answers the bearer, refreshing a stored one that has expired. */
  const bearer = async (): Promise<BearerAnswer> => {
    const environment = env['JEN_TOKEN'] ?? '';
    if (environment !== '') return { ok: true, bearer: { token: environment, source: 'environment' } };
    const blob = await readBlob();
    if (blob === null) return refusal('auth', `no Jenkins session is stored in ${dir ?? 'the store'}; ${LOGIN_FIX}`);
    if (fresh(blob)) return { ok: true, bearer: { token: blob.access_token, source: 'store' } };
    refreshing.current ??= refresh(blob).finally(() => {
      refreshing.current = null;
    });
    return refreshing.current;
  };

  /** The Basic value of the Jenkins user and API token, or null where either is missing. */
  const basic = async (): Promise<string | null> => {
    const fromEnv = (name: string): string => env[name] ?? '';
    let user = fromEnv('JENKINS_USER');
    let token = fromEnv('JENKINS_API_TOKEN');
    if (dir !== null && instanceKey !== '') {
      if (user === '') user = (await readSecret(jenSecretFile(dir, `jenkins-user:${instanceKey}`))) ?? '';
      if (token === '') token = (await readSecret(jenSecretFile(dir, `jenkins-token:${instanceKey}`))) ?? '';
    }
    return user !== '' && token !== '' ? Buffer.from(`${user}:${token}`).toString('base64') : null;
  };

  const ready = async (): Promise<JenkinsReady> => {
    if (url === null) return { ok: false, kind: 'unaskable', reason: 'the Jenkins instance is a slug; write its host' };
    if (!credentialSafe(url)) {
      return { ok: false, kind: 'unaskable', reason: `the Jenkins instance ${jenUrlHost(url) || 'URL'} is neither https nor loopback, so no credential is sent` };
    }
    const environment = env['JEN_TOKEN'] ?? '';
    const blob = environment === '' ? await readBlob() : null;
    if (environment === '' && blob === null) {
      return {
        ok: false,
        kind: 'auth',
        reason: `no Jenkins credential: JEN_TOKEN is unset and ${dir === null ? 'no token store directory resolves (JEN_CONFIG_DIR, XDG_CONFIG_HOME and HOME are unset)' : `${blobPath} is absent or unreadable`}`,
      };
    }
    const realm = realmOf(environment === '' ? (blob?.access_token ?? null) : environment);
    if (realm === null) return { ok: false, kind: 'unaskable', reason: 'the stored token names no realm' };
    if (!credentialSafe(realm)) {
      return { ok: false, kind: 'unaskable', reason: `the realm ${jenUrlHost(realm) || 'URL'} is neither https nor loopback, so no credential is sent` };
    }
    return { ok: true, source: environment === '' ? 'store' : 'environment', dir: environment === '' ? dir : null, realm };
  };

  const callOf = (path: string, headers: Record<string, string>): ConnectorCall => ({
    url: new URL(`${url}${path.startsWith('/') ? '' : '/'}${path}`),
    method: 'GET',
    headers: { ...headers, Accept: 'application/json', 'User-Agent': 'plot' },
    connector: JENKINS_CONNECTOR,
    account,
    spend: () => ({ bucket: JENKINS_BUCKET, limit: JENKINS_PREDICTED_LIMIT, remaining: null, resetAt: null, basis: 'predicted' }),
  });

  type Attempt =
    | { readonly kind: 'answered'; readonly answer: JenkinsAnswer }
    | { readonly kind: 'dead-session'; readonly answer: JenkinsAnswer };

  const attempt = async (request: JenkinsRequest, realm: string): Promise<Attempt> => {
    const got = await bearer();
    if (!got.ok) return { kind: 'answered', answer: { ok: false, refusal: got.refusal, reply: null } };
    const headers: Record<string, string> = { Authorization: `Bearer ${got.bearer.token}` };
    const pair = await basic();
    if (pair !== null) headers['X-Jenkins-Authorization'] = `Basic ${pair}`;
    const sent = await transport.exchange(callOf(request.path, headers));
    if (!('reply' in sent)) {
      const said = sent.timedOut
        ? `no answer from ${instanceKey} within ${transport.boundMs / 1000} s (${request.label})`
        : `no answer from ${instanceKey}: ${sent.error} (${request.label})`;
      return { kind: 'answered', answer: { ok: false, refusal: { kind: 'failed', said }, reply: null } };
    }
    const { reply } = sent;
    const location = reply.headers['location'] ?? '';
    const klass = jenStatusClass(reply.status, location, realm, instanceKey);
    if (klass === 'auth') {
      const said = `Jenkins refused the request (HTTP ${reply.status}, ${request.label}); ${LOGIN_FIX}`;
      return { kind: 'dead-session', answer: { ok: false, refusal: { kind: 'auth', said }, reply } };
    }
    if (klass === 'foreign') {
      const target = jenUrlHost(location);
      const said = `HTTP ${reply.status} redirected to ${target === '' ? 'an unnamed target' : target}, which is not ${instanceKey}; no credential was sent there (${request.label})`;
      return { kind: 'answered', answer: { ok: false, refusal: { kind: 'unaskable', said }, reply } };
    }
    if (klass === 'failed') {
      const throttled = throttledOf(reply, messageOf(reply.body));
      if (throttled !== null) return { kind: 'answered', answer: { ok: false, refusal: narrowed(throttled), reply } };
      const message = messageOf(reply.body);
      return { kind: 'answered', answer: { ok: false, refusal: { kind: 'failed', said: `HTTP ${reply.status}${message === '' ? '' : `: ${message}`} (${request.label})` }, reply } };
    }
    return { kind: 'answered', answer: { ok: true, reply } };
  };

  return {
    url,
    account,
    dir,
    ready,
    request: async (request) => {
      const state = await ready();
      if (!state.ok) return { ok: false, refusal: { kind: state.kind, said: state.reason }, reply: null };
      const first = await attempt(request, state.realm);
      if (first.kind === 'answered') return first.answer;
      const again = await attempt(request, state.realm);
      return again.answer;
    },
  };
};

/** What the composition chose. */
export type JenkinsComposition =
  | { readonly kind: 'in-process'; readonly api: JenkinsApi; readonly source: JenkinsCredentialSource; readonly dir: string | null }
  | { readonly kind: 'shell'; readonly reason: string };

/**
 * Chooses the transport for the Jenkins reads, once.
 *
 * The first call probes the client with {@link JenkinsApi.ready}. It logs one
 * line, the credential directory or the reason the shell stays, and every
 * later call answers the same choice with no further log line.
 *
 * @param options - the client's options.
 * @param log - receives the one line.
 * @returns a function answering the choice.
 */
export const composeJenkins = (options: JenkinsApiOptions, log: (line: string) => void = () => undefined): (() => Promise<JenkinsComposition>) => {
  let chosen: Promise<JenkinsComposition> | null = null;
  return () =>
    (chosen ??= (async (): Promise<JenkinsComposition> => {
      const api = jenkinsApi(options);
      const state = await api.ready();
      if (!state.ok) {
        log(`Jenkins reads stay on the shell: ${state.reason}`);
        return { kind: 'shell', reason: state.reason };
      }
      log(`Jenkins reads run in-process, credentials from ${state.dir ?? 'the environment'}`);
      return { kind: 'in-process', api, source: state.source, dir: state.dir };
    })());
};

/** What {@link JenkinsReads.builds} answers: the runs, or why Jenkins could not be asked. */
export type JenkinsBuildsRead =
  | { readonly ok: true; readonly runs: readonly CiRun[] }
  | { readonly ok: false; readonly said: string };

/** What {@link JenkinsReads.builds} is asked. */
export interface JenkinsBuildsQuery {
  /** The job path, such as `team/portal`. Never empty: a sha lives in a job's builds. */
  readonly job: string;
  readonly branch: string;
  /** The commit asked about, or '' for the branch's history. */
  readonly sha: string;
  readonly limit: number;
}

/** The three Jenkins questions the build port asks in-process. */
export interface JenkinsReads {
  /**
   * Reads the branch-to-checks map of a job.
   *
   * A refusal on the job's own request, or on the listing, reads `failed`: a
   * dead session reads like an unreachable Jenkins, as it does in the shell. A
   * `FreeStyleProject` or any other unmeasured class reads `unknown`.
   *
   * @param job - the job path; '' for the root.
   * @returns the map and its status.
   */
  colourMap(job: string): Promise<CiBuildMap>;
  /**
   * Reads a job's builds for a commit, or for a branch.
   *
   * Asks the branch's path first and the job root second, for `3 × limit`
   * builds, and filters after the fetch. A multibranch root that answers
   * with no builds is an empty answer; a Jenkins that answers nothing is a
   * refusal.
   *
   * @param query - what to read.
   * @returns the runs, or the reason Jenkins could not be asked.
   */
  builds(query: JenkinsBuildsQuery): Promise<JenkinsBuildsRead>;
}

const MULTIBRANCH_CLASS = 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject';

/** The `tree` parameter of the builds read, `limit` builds with their revision records. */
const buildsTree = (window: number): string =>
  `tree=builds%5Bnumber,result,building,timestamp,url,actions%5BlastBuiltRevision%5BSHA1,branch%5Bname%5D%5D%5D%5D%7B0,${window}%7D`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Builds the Jenkins reads over one client.
 *
 * A declared duplicate of `jenkins_build_map` and `jenkins_sha_runs` in
 * `plot-host.sh`, held to them by `corpus/jenkins-reads.corpus.test.ts`. It
 * calls {@link JenkinsApi.request} only, so the credential, the budget and
 * the refusal classes stay the client's.
 *
 * @param api - the client.
 * @returns the reads.
 */
export const jenkinsReads = (api: JenkinsApi): JenkinsReads => ({
  colourMap: async (job) => {
    if (job !== '') {
      const view = await api.request({ path: `${jenJobPath(job)}/api/json?tree=_class,color`, label: 'job view' });
      if (!view.ok) return { status: 'failed', map: {} };
      const shape = shapeOfJob(view.reply.body);
      if (shape === 'plain') return plainBuildMap(view.reply.body, job);
      if (shape === 'other') return { status: 'unknown', map: {} };
    }
    const listing = await api.request({ path: `${jenJobPath(job)}/api/json?tree=jobs%5Bname,color%5D`, label: 'job list' });
    if (!listing.ok) return { status: 'failed', map: {} };
    return listingBuildMap(jenJobsOf(listing.reply.body), job);
  },

  builds: async ({ job, branch, sha, limit }) => {
    const root = jenJobPath(job);
    let plain = false;
    let branchAnswered = false;
    let refusal = '';
    for (const path of [jenJobPath(job, branch), root]) {
      const answer = await api.request({ path: `${path}/api/json?${buildsTree(limit * 3)}`, label: 'builds' });
      if (answer.ok) {
        const body = answer.reply.body;
        if (isObject(body) && Array.isArray(body.builds)) {
          return { ok: true, runs: ciRunsOf(body.builds, { sha, job, branch, plain, limit }) };
        }
        if (path !== root && body !== null && body !== false && typeof body !== 'string') branchAnswered = true;
        if (path === root && isObject(body) && body._class === MULTIBRANCH_CLASS) {
          return { ok: true, runs: ciRunsOf([], { sha, job, branch, plain: true, limit }) };
        }
      } else {
        refusal = answer.refusal.said;
      }
      plain = true;
    }
    if (branchAnswered) return { ok: false, said: `Jenkins has no branch '${branch}' indexed for '${job}'` };
    return { ok: false, said: refusal === '' ? `Jenkins did not answer for '${job}'` : refusal };
  },
});

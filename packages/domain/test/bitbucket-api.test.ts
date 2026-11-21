import { spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { bbAccountKey, bbLedgerFile } from '../src/adapters/host/bb-ledger-file.js';
import {
  BITBUCKET_NO_CREDENTIAL,
  bitbucketApi,
  bitbucketApiBase,
  type BitbucketApiOptions,
} from '../src/adapters/host/bitbucket-api.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import type { LimitObservation } from '../src/ports/host.js';
import { bbHourStamp, bbPauseFileName, bbRequestFileName } from '../src/rules/bb-ledger.js';
import { hostTransportOf } from '../src/rules/host-transport.js';

/** One request the stub server saw. */
interface Seen {
  method: string;
  path: string;
  auth: string;
}

type Handler = (seen: Seen, res: http.ServerResponse) => void;

const basic = (email: string, token: string): string => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const PAGE = { values: [], size: 0, pagelen: 50 };
const UNAUTHORIZED = { type: 'error', error: { message: 'Unauthorized' } };

const servers: net.Server[] = [];
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-bitbucket-api-'));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          (server as http.Server).closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
  rmSync(root, { recursive: true, force: true });
});

/** A stub Bitbucket API on 127.0.0.1 under `/2.0` that records every request. */
const stubApi = async (handler: Handler) => {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const one = { method: req.method ?? '', path: req.url ?? '', auth: String(req.headers.authorization ?? '') };
      seen.push(one);
      handler(one, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { seen, base: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/2.0` };
};

/** The client under test, against a private ledger, `bb` state and slot directory, with no `.env` unless one is written. */
const client = (base: string, over: Partial<BitbucketApiOptions> = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const ledger = bbLedgerFile({ env: { BB_STATE_DIR: join(root, 'bb') }, log: () => undefined, ...(over.now === undefined ? {} : { now: over.now }) });
  const api = bitbucketApi({
    origin: 'git@bitbucket.org:quatico/portal.git',
    env: { BITBUCKET_API_BASE: base, BB_EMAIL: 'me@example.test', BB_TOKEN: 'fixture-token' },
    top: join(root, 'desk'),
    commonDir: join(root, 'main', '.git'),
    budget,
    slots,
    ledger,
    pollMs: 20,
    ...over,
  });
  const entries = async (): Promise<BudgetEntry[]> => {
    const lines = await budget.lines();
    return lines.ok ? lines.value.map(decodeEntry).filter((e): e is BudgetEntry => e !== null) : [];
  };
  return { api, entries };
};

const LIST = { method: 'GET' as const, path: '/repositories/{ws}/{repo}/pullrequests?state=OPEN&pagelen=50', label: 'pr-list state=OPEN' };

describe('the base URL and the repository', () => {
  it('reads api.bitbucket.org/2.0 by default and BITBUCKET_API_BASE over it', () => {
    expect(bitbucketApiBase({})).toBe('https://api.bitbucket.org/2.0');
    expect(bitbucketApiBase({ BITBUCKET_API_BASE: '' })).toBe('https://api.bitbucket.org/2.0');
    expect(bitbucketApiBase({ BITBUCKET_API_BASE: 'http://127.0.0.1:9/2.0/' })).toBe('http://127.0.0.1:9/2.0');
  });

  it('takes the workspace and repository from the origin remote, and charges the workspace', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api } = client(stub.base);

    expect(api.slug).toBe('quatico/portal');
    expect(api.account).toBe('quatico');
    expect((await api.request(LIST)).ok).toBe(true);
    expect(stub.seen.map((s) => s.path)).toEqual(['/2.0/repositories/quatico/portal/pullrequests?state=OPEN&pagelen=50']);
  });

  it('answers failed and sends nothing where the origin names no Bitbucket repository', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api } = client(stub.base, { origin: '/tmp/census/origin.git' });

    const answer = await api.request(LIST);

    expect(api.slug).toBeNull();
    expect(answer.ok || answer.refusal).toMatchObject({ kind: 'failed', said: expect.stringMatching(/names no Bitbucket workspace/) });
    expect(stub.seen).toEqual([]);
    expect(bitbucketApi({ origin: null, env: {} }).slug).toBeNull();
  });

  it('reads a next link on the base as its path and refuses one outside the base', async () => {
    const { api } = client('https://api.bitbucket.org/2.0');

    expect(api.nextPath('https://api.bitbucket.org/2.0/repositories/q/p/pullrequests?page=2')).toEqual({
      ok: true,
      path: '/repositories/q/p/pullrequests?page=2',
    });
    expect(api.nextPath('https://evil.example.test/2.0/x')).toEqual({
      ok: false,
      refusal: { kind: 'failed', said: "next page 'https://evil.example.test/2.0/x' is outside https://api.bitbucket.org/2.0; refusing to read past it" },
    });
  });
});

describe('credentials', () => {
  it('sends BB_EMAIL and BB_TOKEN from the environment as a Basic header only', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api } = client(stub.base);

    expect(await api.credentialSource()).toBe('environment');
    await api.request(LIST);

    expect(stub.seen[0]?.auth).toBe(basic('me@example.test', 'fixture-token'));
    expect(stub.seen[0]?.path).not.toMatch(/fixture-token/);
  });

  it("reads the worktree's .env first, then the main checkout's, where the environment holds no pair", async () => {
    mkdirSync(join(root, 'desk'), { recursive: true });
    mkdirSync(join(root, 'main'), { recursive: true });
    writeFileSync(join(root, 'main', '.env'), 'BB_EMAIL=main@example.test\nBB_TOKEN="main-token"\n');
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const env = { BITBUCKET_API_BASE: stub.base, BB_TOKEN: 'half-a-pair' };

    const fromMain = client(stub.base, { env }).api;
    expect(await fromMain.credentialSource()).toBe('main checkout .env');
    await fromMain.request(LIST);
    expect(stub.seen.at(-1)?.auth).toBe(basic('main@example.test', 'main-token'));

    writeFileSync(join(root, 'desk', '.env'), 'export BB_EMAIL=desk@example.test\nBB_TOKEN=desk-token\n');
    expect(await client(stub.base, { env }).api.credentialSource()).toBe('worktree .env');
  });

  it('defaults the two .env locations to PLOT_REPO_ROOT and PLOT_GIT_COMMON_DIR', async () => {
    mkdirSync(join(root, 'main'), { recursive: true });
    writeFileSync(join(root, 'main', '.env'), 'BB_EMAIL=a@example.test\nBB_TOKEN=t\n');
    const api = bitbucketApi({
      origin: 'git@bitbucket.org:quatico/portal.git',
      env: { PLOT_REPO_ROOT: join(root, 'desk'), PLOT_GIT_COMMON_DIR: join(root, 'main', '.git') },
    });

    expect(await api.credentialSource()).toBe('main checkout .env');
  });

  it('keeps the shell where no credential resolves, sends nothing, and starts no security process', async () => {
    const bin = join(root, 'bin');
    const log = join(root, 'security.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'security'), `#!/bin/sh\necho "$@" >> '${log}'\n`);
    chmodSync(join(bin, 'security'), 0o755);
    writeFileSync(log, '');
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const savedPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:${savedPath ?? ''}`;
    try {
      const { api } = client(stub.base, { env: { BITBUCKET_API_BASE: stub.base, PATH: process.env['PATH'] } });

      const source = await api.credentialSource();
      const answer = await api.request(LIST);
      const choice = hostTransportOf({
        backend: 'bitbucket',
        ci: '',
        override: undefined,
        inProcessBackends: ['github', 'bitbucket'],
        shellCi: [],
        tokenSource: source,
        noCredential: BITBUCKET_NO_CREDENTIAL,
      });

      expect(source).toBeNull();
      expect(answer.ok || answer.refusal).toMatchObject({ kind: 'auth', said: expect.stringMatching(/BB_EMAIL and BB_TOKEN/) });
      expect(stub.seen).toEqual([]);
      expect(choice).toMatchObject({ transport: 'shell', reason: expect.stringMatching(/^no credentials: BB_EMAIL and BB_TOKEN/) });
      expect(readFileSync(log, 'utf8')).toBe('');
      // The stub is the one on PATH, so the zero above counts real calls.
      expect(spawnSync('security', ['probe'], { env: { PATH: process.env['PATH'] } }).status).toBe(0);
      expect(readFileSync(log, 'utf8')).toBe('probe\n');
    } finally {
      process.env['PATH'] = savedPath;
    }
  });

  it('re-reads the environment and .env on a first 401 and retries once with the new credential', async () => {
    mkdirSync(join(root, 'main'), { recursive: true });
    writeFileSync(join(root, 'main', '.env'), 'BB_EMAIL=me@example.test\nBB_TOKEN=old\n');
    const stub = await stubApi((seen, res) =>
      seen.auth === basic('me@example.test', 'new') ? json(res, 200, PAGE) : json(res, 401, UNAUTHORIZED),
    );
    const { api, entries } = client(stub.base, { env: { BITBUCKET_API_BASE: stub.base } });
    expect(await api.credentialSource()).toBe('main checkout .env');

    writeFileSync(join(root, 'main', '.env'), 'BB_EMAIL=me@example.test\nBB_TOKEN=new\n');
    const answer = await api.request(LIST);

    expect(answer.ok).toBe(true);
    expect(stub.seen.map((s) => s.auth)).toEqual([basic('me@example.test', 'old'), basic('me@example.test', 'new')]);
    expect(await entries()).toHaveLength(2);
    expect((await api.request(LIST)).ok).toBe(true);
    expect(stub.seen).toHaveLength(3);
  });

  it('answers kind auth naming the source and the fix on a second 401', async () => {
    const stub = await stubApi((_seen, res) => json(res, 401, UNAUTHORIZED));
    const { api } = client(stub.base);

    const answer = await api.request(LIST);

    expect(stub.seen).toHaveLength(2);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.kind).toBe('auth');
    expect(answer.refusal.said).toBe(
      "Bitbucket refused BB_EMAIL and BB_TOKEN from the environment (HTTP 401: Unauthorized); set BB_EMAIL and BB_TOKEN (an Atlassian API token) in the environment fleetd starts with or in the main checkout's .env",
    );
    expect(answer.refusal.said).not.toMatch(/fixture-token/);
  });

  it('answers auth on a 401 whose refreshed read finds no credential, without a second request', async () => {
    mkdirSync(join(root, 'main'), { recursive: true });
    writeFileSync(join(root, 'main', '.env'), 'BB_EMAIL=me@example.test\nBB_TOKEN=old\n');
    const stub = await stubApi((_seen, res) => json(res, 401, 'nope'));
    const { api } = client(stub.base, { env: { BITBUCKET_API_BASE: stub.base } });
    await api.credentialSource();
    writeFileSync(join(root, 'main', '.env'), '');

    const answer = await api.request(LIST);

    expect(stub.seen).toHaveLength(1);
    expect(answer.ok || answer.refusal).toMatchObject({ kind: 'auth', said: expect.stringMatching(/main checkout \.env \(HTTP 401: nope\)/) });
  });
});

describe('every request charges the shared ledger', () => {
  it("appends one entry per request: connector bitbucket, bucket api, the workspace, predicted from bb's ledger with no headers", async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api, entries } = client(stub.base);

    await api.request(LIST);
    const afterFirst = await entries();
    await api.request(LIST);
    const afterSecond = await entries();

    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond.at(-1)).toMatchObject({
      key: { connector: 'bitbucket', account: 'quatico', bucket: 'api' },
      spent: 1,
      limit: 800,
      remaining: 798,
      resetAt: null,
      basis: 'predicted',
    });
  });

  it("records bb's ceiling, never raised by a declared limit, where the reply states none, and the stated one over it", async () => {
    let stated = false;
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE, stated ? { 'X-RateLimit-Limit': '5000' } : {}));
    const { api, entries } = client(stub.base, { predictedLimit: 2000, declaredLimit: 2000 });

    await api.request(LIST);
    stated = true;
    await api.request(LIST);

    const [declared, read] = await entries();
    expect(declared).toMatchObject({ limit: 800, remaining: 799, basis: 'predicted' });
    expect(read).toMatchObject({ limit: 5000, remaining: null, basis: 'actual' });
  });

  it('records basis actual with the window where the reply carries X-RateLimit-Limit and -Remaining', async () => {
    const stub = await stubApi((_seen, res) =>
      json(res, 200, PAGE, { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '997', 'X-RateLimit-Reset': '1788003600' }),
    );
    const { api, entries } = client(stub.base);

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ limit: 1000, remaining: 997, resetAt: 1_788_003_600_000, basis: 'actual' });
  });

  it('records the stated limit as actual with remaining null where the reply carries X-RateLimit-Limit alone', async () => {
    const stub = await stubApi((_seen, res) =>
      json(res, 200, PAGE, { 'X-RateLimit-Limit': '10000', 'X-RateLimit-Resource': 'api', 'X-RateLimit-NearLimit': 'false' }),
    );
    const { api, entries } = client(stub.base);

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({
      key: { connector: 'bitbucket', account: 'quatico', bucket: 'api' },
      limit: 10_000,
      remaining: null,
      resetAt: null,
      basis: 'actual',
    });
  });

  it('keeps a stated reset beside a stated limit with no remaining count', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE, { 'X-RateLimit-Limit': '10000', 'X-RateLimit-Reset': '1788003600' }));
    const { api, entries } = client(stub.base);

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ limit: 10_000, remaining: null, resetAt: 1_788_003_600_000, basis: 'actual' });
  });

  it('records the prediction where X-RateLimit-Limit is not a number, whatever X-RateLimit-Remaining says', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE, { 'X-RateLimit-Limit': 'many', 'X-RateLimit-Remaining': '5' }));
    const { api, entries } = client(stub.base);

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ limit: 800, remaining: 799, resetAt: null, basis: 'predicted' });
  });

  it('records actual with no reset where the reply names none, and charges PLOT_BUDGET_ACCOUNT where it is set', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE, { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '5' }));
    const { api, entries } = client(stub.base, {
      env: { BITBUCKET_API_BASE: stub.base, BB_EMAIL: 'e', BB_TOKEN: 't', PLOT_BUDGET_ACCOUNT: 'census' },
    });

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ key: { account: 'census' }, remaining: 5, resetAt: null, basis: 'actual' });
  });
});

describe('the answers', () => {
  it("maps a 429 to throttled with the wait of bb's pause it starts, and observes it", async () => {
    const stub = await stubApi((_seen, res) => json(res, 429, { type: 'error', error: { message: 'Rate limit for this resource has been exceeded' } }, { 'Retry-After': '30' }));
    const observed: LimitObservation[] = [];
    const { api } = client(stub.base, { observe: (o) => observed.push(o), now: () => NOW_MS });

    const answer = await api.request(LIST);

    // bb's first pause is 300 s, and a Retry-After shorter than that does not shorten it.
    expect(answer.ok || answer.refusal).toEqual({ kind: 'throttled', said: 'Rate limit for this resource has been exceeded', waitMs: 300_000 });
    expect(observed).toEqual(['throttled']);
  });

  it('answers ok on a 2xx and observes ok', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const observed: LimitObservation[] = [];
    const { api } = client(stub.base, { observe: (o) => observed.push(o) });

    const answer = await api.request({ ...LIST, method: 'POST', body: { a: 1 } });

    expect(answer.ok && answer.reply.body).toEqual(PAGE);
    expect(observed).toEqual(['ok']);
  });

  it('answers failed with the status and the message on any other status', async () => {
    const stub = await stubApi((_seen, res) => json(res, 404, { type: 'error', error: { message: 'Repository not found' } }));
    const { api } = client(stub.base);

    const answer = await api.request({ ...LIST, path: 'repositories/{ws}/{repo}' });

    expect(answer.ok || answer.refusal).toEqual({ kind: 'failed', said: 'HTTP 404: Repository not found (pr-list state=OPEN)' });
    expect(stub.seen[0]?.path).toBe('/2.0/repositories/quatico/portal');
  });

  it('answers failed naming the host where no answer comes within the bound, and where the connection fails', async () => {
    const stub = await stubApi(() => undefined);
    const slow = client(stub.base, { boundMs: 50 }).api;
    const late = await slow.request(LIST);
    expect(late.ok || late.refusal).toMatchObject({ kind: 'failed', said: expect.stringMatching(/^no answer from 127\.0\.0\.1:\d+ within 0\.05 s/) });

    const refused = client('http://127.0.0.1:1/2.0').api;
    const down = await refused.request(LIST);
    expect(down.ok || down.refusal).toMatchObject({ kind: 'failed', said: expect.stringMatching(/^no answer from 127\.0\.0\.1:1: /) });
  });
});

const NOW_S = 1_788_000_123;
const NOW_MS = NOW_S * 1000;
const EMAIL = 'me@example.test';
const KEY = bbAccountKey(EMAIL);
const requestFile = (): string => join(root, 'bb', bbRequestFileName(KEY, bbHourStamp(NOW_S)));
const pauseFile = (): string => join(root, 'bb', bbPauseFileName(KEY));
const requestLines = (): string => (existsSync(requestFile()) ? readFileSync(requestFile(), 'utf8') : '');

/** The client over the default file ledger in `<root>/bb`, with `BB_HOURLY_LIMIT` as given. */
const ledgered = (base: string, hourly: string | undefined, over: Partial<BitbucketApiOptions> = {}) =>
  client(base, {
    env: {
      BITBUCKET_API_BASE: base,
      BB_EMAIL: EMAIL,
      BB_TOKEN: 'fixture-token',
      BB_STATE_DIR: join(root, 'bb'),
      ...(hourly === undefined ? {} : { BB_HOURLY_LIMIT: hourly }),
    },
    ledger: undefined,
    now: () => NOW_MS,
    ...over,
  });

describe("bb's request ledger", () => {
  it('appends one byte-exact request line per exchange before it sends', async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api } = ledgered(stub.base, undefined);

    await api.request(LIST);
    await api.request(LIST);

    expect(requestLines()).toBe(`${NOW_S}\n${NOW_S}\n`);
    expect(stub.seen).toHaveLength(2);
  });

  it('refuses at the ceiling in bb\'s words, sends nothing, appends no line and records no BudgetEntry', async () => {
    mkdirSync(join(root, 'bb'), { recursive: true });
    writeFileSync(requestFile(), `${NOW_S - 10}\n${NOW_S - 5}\n`);
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api, entries } = ledgered(stub.base, '2');

    const answer = await api.request(LIST);

    expect(answer.ok || answer.refusal).toEqual({
      kind: 'throttled',
      said: 'rate limited — 2 requests in the last hour from this machine; next request at 11:41:53Z (in 3590 s)',
      waitMs: 3_590_000,
    });
    expect(stub.seen).toEqual([]);
    expect(requestLines()).toBe(`${NOW_S - 10}\n${NOW_S - 5}\n`);
    expect(await entries()).toEqual([]);
  });

  it("refuses during bb's pause, sends nothing and records no BudgetEntry", async () => {
    mkdirSync(join(root, 'bb'), { recursive: true });
    writeFileSync(pauseFile(), `${NOW_S + 100} 300\n`);
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api, entries } = ledgered(stub.base, undefined);

    const answer = await api.request(LIST);

    expect(answer.ok || answer.refusal).toMatchObject({
      kind: 'throttled',
      said: expect.stringMatching(/^rate limited — bb paused until \S+ after Bitbucket refused a request \(in 100 s\)$/),
      waitMs: 100_000,
    });
    expect(stub.seen).toEqual([]);
    expect(requestLines()).toBe('');
    expect(await entries()).toEqual([]);
  });

  it('guards and counts the second exchange after a 401', async () => {
    let calls = 0;
    const stub = await stubApi((_seen, res) => (calls++ === 0 ? json(res, 401, UNAUTHORIZED) : json(res, 200, PAGE)));
    const counted = ledgered(stub.base, undefined).api;

    expect((await counted.request(LIST)).ok).toBe(true);
    expect(requestLines()).toBe(`${NOW_S}\n${NOW_S}\n`);

    rmSync(join(root, 'bb'), { recursive: true, force: true });
    calls = 0;
    const capped = ledgered(stub.base, '1').api;
    const answer = await capped.request(LIST);

    expect(answer.ok || answer.refusal).toMatchObject({ kind: 'throttled', said: expect.stringMatching(/^rate limited — 1 requests/) });
    expect(stub.seen).toHaveLength(3);
  });

  it('writes the pause after a 429 as one byte-exact line', async () => {
    const stub = await stubApi((_seen, res) => json(res, 429, 'slow down', { 'Retry-After': '30' }));
    const { api } = ledgered(stub.base, undefined);

    await api.request(LIST);

    expect(readFileSync(pauseFile(), 'utf8')).toBe(`${NOW_S + 300} 300\n`);
    expect(readdirSync(join(root, 'bb')).filter((name) => name.startsWith('pause-'))).toEqual([bbPauseFileName(KEY)]);
  });

  it.each([
    [null, 2000],
    [500, 500],
    [5000, 2000],
  ])('takes ceiling %s → %i from BB_HOURLY_LIMIT=2000 and the declared limit', async (declaredLimit, ceiling) => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api, entries } = ledgered(stub.base, '2000', { declaredLimit });

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ limit: ceiling, remaining: ceiling - 1, basis: 'predicted' });
  });

  it('reads BB_HOURLY_LIMIT and BB_STATE_DIR from the main checkout\'s .env where the environment holds none', async () => {
    mkdirSync(join(root, 'main'), { recursive: true });
    writeFileSync(join(root, 'main', '.env'), `BB_HOURLY_LIMIT=40\nBB_STATE_DIR=${join(root, 'bb')}\n`);
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api, entries } = client(stub.base, {
      env: { BITBUCKET_API_BASE: stub.base, BB_EMAIL: EMAIL, BB_TOKEN: 't', BB_HOURLY_LIMIT: '' },
      ledger: undefined,
      now: () => NOW_MS,
    });

    await api.request(LIST);

    expect(requestLines()).toBe(`${NOW_S}\n`);
    expect((await entries()).at(-1)).toMatchObject({ limit: 40, remaining: 39 });
  });

  it("refuses every request as failed in bb's words where BB_HOURLY_LIMIT is not a whole number", async () => {
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const { api } = ledgered(stub.base, 'abc');

    const answer = await api.request(LIST);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'failed', said: "error: BB_HOURLY_LIMIT must be a whole number, got 'abc'" });
    expect(stub.seen).toEqual([]);
  });

  it('sends and records the prediction where the state directory cannot be used', async () => {
    writeFileSync(join(root, 'bb'), 'a file, not a directory');
    const stub = await stubApi((_seen, res) => json(res, 200, PAGE));
    const lines: string[] = [];
    const { api, entries } = client(stub.base, {
      ledger: bbLedgerFile({ env: { BB_STATE_DIR: join(root, 'bb') }, log: (line) => lines.push(line) }),
    });

    expect((await api.request(LIST)).ok).toBe(true);
    expect((await api.request(LIST)).ok).toBe(true);

    expect(stub.seen).toHaveLength(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^warning: bb-ledger cannot keep its request count in /);
    expect((await entries()).at(-1)).toMatchObject({ limit: 800, remaining: null, basis: 'predicted' });
  });
});

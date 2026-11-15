import { spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import {
  BITBUCKET_NO_CREDENTIAL,
  bitbucketApi,
  bitbucketApiBase,
  type BitbucketApiOptions,
} from '../src/adapters/host/bitbucket-api.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import type { LimitObservation } from '../src/ports/host.js';
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

/** The client under test, against a private ledger and slot directory, with no `.env` unless one is written. */
const client = (base: string, over: Partial<BitbucketApiOptions> = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const api = bitbucketApi({
    origin: 'git@bitbucket.org:quatico/portal.git',
    env: { BITBUCKET_API_BASE: base, BB_EMAIL: 'me@example.test', BB_TOKEN: 'fixture-token' },
    top: join(root, 'desk'),
    commonDir: join(root, 'main', '.git'),
    budget,
    slots,
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
  it('appends one entry per request: connector bitbucket, bucket api, the workspace, predicted 1000 with no headers', async () => {
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
      limit: 1000,
      remaining: null,
      resetAt: null,
      basis: 'predicted',
    });
  });

  it('records basis actual with the window where the reply carries X-RateLimit-Limit and -Remaining', async () => {
    const stub = await stubApi((_seen, res) =>
      json(res, 200, PAGE, { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '997', 'X-RateLimit-Reset': '1788003600' }),
    );
    const { api, entries } = client(stub.base);

    await api.request(LIST);

    expect((await entries()).at(-1)).toMatchObject({ limit: 1000, remaining: 997, resetAt: 1_788_003_600_000, basis: 'actual' });
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
  it('maps a 429 with Retry-After to throttled with the wait, and observes it', async () => {
    const stub = await stubApi((_seen, res) => json(res, 429, { type: 'error', error: { message: 'Rate limit for this resource has been exceeded' } }, { 'Retry-After': '30' }));
    const observed: LimitObservation[] = [];
    const { api } = client(stub.base, { observe: (o) => observed.push(o) });

    const answer = await api.request(LIST);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'throttled', said: 'Rate limit for this resource has been exceeded', waitMs: 30_000 });
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

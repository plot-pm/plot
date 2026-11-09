import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import {
  apiUrlsFor,
  githubApi,
  githubOrigin,
  REQUEST_BOUND_MS,
  type GithubApiOptions,
} from '../src/adapters/host/github-api.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import type { LimitObservation } from '../src/ports/host.js';
import { refusalKind, refusalKindOf } from '../src/rules/refusal.js';

/** One request the stub server saw. */
interface Seen {
  method: string;
  path: string;
  auth: string;
}

/** A handler answers one request; returning null leaves it unanswered. */
type Handler = (seen: Seen, res: http.ServerResponse) => void;

const RATE = (bucket: string, remaining = 4999, limit = 5000): Record<string, string> => ({
  'X-RateLimit-Resource': bucket,
  'X-RateLimit-Limit': String(limit),
  'X-RateLimit-Remaining': String(remaining),
  'X-RateLimit-Reset': '1788003600',
});

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** The default stub: `/user` names `someone`, everything else answers `{data:{}}` on the bucket it spends. */
const answering =
  (login = 'someone'): Handler =>
  (seen, res) => {
    if (seen.path === '/user') return json(res, 200, { login }, RATE('core'));
    return json(res, 200, { data: {} }, RATE(seen.path === '/graphql' ? 'graphql' : 'core'));
  };

const servers: net.Server[] = [];
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-github-api-'));
});

afterEach(async () => {
  vi.useRealTimers();
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

const listen = async <S extends net.Server>(server: S): Promise<{ server: S; port: number }> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { server, port: (server.address() as net.AddressInfo).port };
};

/** A stub GitHub API on 127.0.0.1 that records every request. */
const stubApi = async (handler: Handler) => {
  const seen: Seen[] = [];
  const { port } = await listen(
    http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const one = { method: req.method ?? '', path: req.url ?? '', auth: String(req.headers.authorization ?? '') };
        seen.push(one);
        handler(one, res);
      });
    }),
  );
  return { seen, url: `http://127.0.0.1:${port}` };
};

/** The client under test, against a private ledger and slot directory. */
const client = (url: string, over: Partial<GithubApiOptions> = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const api = githubApi({
    origin: 'git@github.com:owner/repo.git',
    env: { GITHUB_API_URL: url, GH_TOKEN: 'fixture-token' },
    budget,
    slots,
    pollMs: 20,
    ...over,
  });
  const entries = async (): Promise<BudgetEntry[]> => {
    const lines = await budget.lines();
    return lines.ok ? lines.value.map(decodeEntry).filter((e): e is BudgetEntry => e !== null) : [];
  };
  return { api, budget, slots, entries, home };
};

const GRAPHQL = { method: 'POST' as const, path: '/graphql', body: { query: '{ viewer { login } }' }, label: 'graphql' };

describe('the origin and the API host', () => {
  it('reads the host and the slug from the remote forms gh_origin_slug reads', () => {
    expect(githubOrigin('git@github.com:owner/repo.git')).toEqual({ host: 'github.com', slug: 'owner/repo' });
    expect(githubOrigin('https://github.com/owner/repo')).toEqual({ host: 'github.com', slug: 'owner/repo' });
    expect(githubOrigin('ssh://git@GHE.example.test:2222/owner/repo.git/')).toEqual({
      host: 'ghe.example.test',
      slug: 'owner/repo',
    });
    expect(githubOrigin('/tmp/x/origin.git')).toEqual({ host: 'github.com', slug: 'x/origin' });
    expect(githubOrigin(null)).toEqual({ host: 'github.com', slug: null });
  });

  it('reads api.github.com for github.com, the host itself for GHE, and GITHUB_API_URL over both', () => {
    expect(apiUrlsFor('github.com', {})).toEqual({ base: 'https://api.github.com', graphql: 'https://api.github.com/graphql' });
    expect(apiUrlsFor('ghe.example.test', {})).toEqual({
      base: 'https://ghe.example.test/api/v3',
      graphql: 'https://ghe.example.test/api/graphql',
    });
    expect(apiUrlsFor('ghe.example.test', { GITHUB_API_URL: 'http://127.0.0.1:9/' })).toEqual({
      base: 'http://127.0.0.1:9',
      graphql: 'http://127.0.0.1:9/graphql',
    });
  });
});

describe('every request charges the shared ledger', () => {
  it('appends one entry per request with the header bucket and window, basis actual, under the token login', async () => {
    const stub = await stubApi(answering('someone'));
    const { api, entries } = client(stub.url);

    const first = await api.request(GRAPHQL);
    const afterFirst = await entries();
    const second = await api.request(GRAPHQL);
    const afterSecond = await entries();

    expect(first.ok && second.ok).toBe(true);
    expect(stub.seen.filter((s) => s.path === '/user')).toHaveLength(1);
    expect(stub.seen.filter((s) => s.path === '/graphql')).toHaveLength(2);
    expect(afterSecond).toHaveLength(afterFirst.length + 1);
    expect(afterSecond.at(-1)).toMatchObject({
      key: { connector: 'github', account: 'someone', bucket: 'graphql' },
      spent: 1,
      limit: 5000,
      remaining: 4999,
      resetAt: 1_788_003_600_000,
      basis: 'actual',
    });
    expect(stub.seen.every((s) => s.auth === 'Bearer fixture-token')).toBe(true);
  });

  it('charges unknown where GET /user fails, and asks again with the next token', async () => {
    let userCalls = 0;
    const stub = await stubApi((seen, res) => {
      if (seen.path === '/user') {
        userCalls += 1;
        return userCalls === 1 ? json(res, 500, { message: 'boom' }) : json(res, 200, { login: 'second' }, RATE('core'));
      }
      if (seen.auth === 'Bearer old') return json(res, 401, { message: 'Bad credentials' });
      return json(res, 200, { data: {} }, RATE('graphql'));
    });
    const tokens = ['old', 'new'];
    const { api, entries } = client(stub.url, {
      env: { GITHUB_API_URL: stub.url },
      ghAuthToken: async () => tokens.shift() ?? null,
    });

    expect(await api.account()).toBe('unknown');
    const answer = await api.request(GRAPHQL);

    expect(answer.ok).toBe(true);
    expect(userCalls).toBe(2);
    expect((await entries()).at(-1)?.key.account).toBe('second');
  });

  it('records basis unknown with no window where the headers are stripped', async () => {
    const stub = await stubApi((seen, res) => json(res, 200, seen.path === '/user' ? { login: 'someone' } : { data: {} }));
    const { api, entries } = client(stub.url);

    await api.request(GRAPHQL);

    expect((await entries()).at(-1)).toMatchObject({ key: { bucket: 'graphql' }, limit: null, remaining: null, basis: 'unknown' });
  });
});

describe('a refused token', () => {
  it('runs gh auth token once more on a 401 and retries the request once', async () => {
    const stub = await stubApi((seen, res) =>
      seen.auth === 'Bearer stale' ? json(res, 401, { message: 'Bad credentials' }) : answering()(seen, res),
    );
    const asked: string[] = [];
    const tokens = ['stale', 'fresh'];
    const { api } = client(stub.url, {
      env: { GITHUB_API_URL: stub.url },
      ghAuthToken: async (host) => {
        asked.push(host);
        return tokens.shift() ?? null;
      },
    });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok).toBe(true);
    expect(asked).toEqual(['github.com', 'github.com']);
    expect(stub.seen.filter((s) => s.path === '/graphql').map((s) => s.auth)).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(await api.tokenSource()).toBe('gh auth token');
  });

  it('answers kind auth on a second 401, naming the source and the fix', async () => {
    const stub = await stubApi((_seen, res) => json(res, 401, { message: 'Bad credentials' }));
    let asks = 0;
    const { api } = client(stub.url, {
      env: { GITHUB_API_URL: stub.url },
      ghAuthToken: async () => {
        asks += 1;
        return `token-${asks}`;
      },
    });

    const answer = await api.request(GRAPHQL);

    expect(asks).toBe(2);
    expect(stub.seen.filter((s) => s.path === '/graphql')).toHaveLength(2);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.kind).toBe('auth');
    expect(answer.refusal.said).toBe(
      'GitHub refused the token from gh auth token (HTTP 401: Bad credentials); run gh auth login --hostname github.com',
    );
    expect(refusalKindOf(answer.refusal.kind, answer.refusal.said)).toBe('auth');
  });

  it('does not refresh a token from GH_TOKEN, and names the variable and the unit file', async () => {
    const stub = await stubApi((_seen, res) => json(res, 401, { message: 'Bad credentials' }));
    const ghAuthToken = vi.fn(async () => 'never');
    const { api } = client(stub.url, { ghAuthToken });

    const answer = await api.request(GRAPHQL);

    expect(ghAuthToken).not.toHaveBeenCalled();
    expect(stub.seen.filter((s) => s.path === '/graphql')).toHaveLength(1);
    expect(answer.ok || answer.refusal.kind).toBe('auth');
    expect(answer.ok || answer.refusal.said).toMatch(/token from GH_TOKEN \(HTTP 401: Bad credentials\); set GH_TOKEN .*EnvironmentVariables/);
    expect(await api.tokenSource()).toBe('GH_TOKEN');
  });

  it('reads GITHUB_TOKEN where GH_TOKEN is unset', async () => {
    const stub = await stubApi(answering());
    const { api } = client(stub.url, { env: { GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'from-actions' } });

    await api.request(GRAPHQL);

    expect(await api.tokenSource()).toBe('GITHUB_TOKEN');
    expect(stub.seen[0]?.auth).toBe('Bearer from-actions');
  });

  it('answers kind auth with the fix where no token resolves, and sends nothing', async () => {
    const stub = await stubApi(answering());
    const { api } = client(stub.url, { env: { GITHUB_API_URL: stub.url }, ghAuthToken: async () => null });

    const answer = await api.request(GRAPHQL);

    expect(stub.seen).toHaveLength(0);
    expect(answer.ok || answer.refusal).toEqual({
      kind: 'auth',
      said: 'no GitHub token: GH_TOKEN and GITHUB_TOKEN are unset and gh auth token --hostname github.com answered none; run gh auth login --hostname github.com',
    });
    expect(await api.tokenSource()).toBeNull();
    expect(await api.account()).toBe('unknown');
  });
});

describe('the rate-limit observations', () => {
  const SECONDARY =
    'You have exceeded a secondary rate limit. Please wait a few minutes before you try again. If you reach out to GitHub Support for help, please include the request ID.';

  it('reads a 403 with the secondary-limit message as secondary, with the message verbatim', async () => {
    const stub = await stubApi((seen, res) =>
      seen.path === '/user' ? answering()(seen, res) : json(res, 403, { message: SECONDARY }, RATE('graphql', 4000)),
    );
    const observed: LimitObservation[] = [];
    const { api } = client(stub.url, { observe: (o) => observed.push(o) });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'secondary', said: SECONDARY });
    expect(observed).toEqual(['secondary']);
    expect(refusalKind(SECONDARY)).toBe('secondary');
  });

  it('carries a 429 Retry-After as the wait', async () => {
    const stub = await stubApi((seen, res) =>
      seen.path === '/user' ? answering()(seen, res) : json(res, 429, { message: 'slow down' }, { 'Retry-After': '60' }),
    );
    const { api } = client(stub.url);

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'secondary', said: 'slow down', waitMs: 60_000 });
  });

  it('reads an exhausted window as throttled, waiting until its reset', async () => {
    const message = 'API rate limit exceeded for user ID 1.';
    const stub = await stubApi((seen, res) =>
      seen.path === '/user' ? answering()(seen, res) : json(res, 403, { message }, RATE('graphql', 0)),
    );
    const observed: LimitObservation[] = [];
    const { api } = client(stub.url, { observe: (o) => observed.push(o), now: () => 1_788_003_000_000 });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'throttled', said: message, waitMs: 600_000 });
    expect(observed).toEqual(['throttled']);
    expect(refusalKindOf('throttled', message)).toBe('quota');
  });

  it('reads a GraphQL RATE_LIMITED error as throttled', async () => {
    const stub = await stubApi((seen, res) =>
      seen.path === '/user'
        ? answering()(seen, res)
        : json(res, 200, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, RATE('graphql', 0)),
    );
    const { api } = client(stub.url, { now: () => 1_788_004_000_000 });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'throttled', said: 'API rate limit exceeded', waitMs: 0 });
  });

  it('answers other refusals as failed, naming the status and the request', async () => {
    const stub = await stubApi((seen, res) =>
      seen.path === '/user' ? answering()(seen, res) : json(res, 502, { message: 'Server Error' }),
    );
    const observed: LimitObservation[] = [];
    const { api } = client(stub.url, { observe: (o) => observed.push(o) });

    const forbidden = await api.request({ method: 'GET', path: '/repos/owner/repo', label: 'repo' });

    expect(forbidden.ok || forbidden.refusal).toEqual({ kind: 'failed', said: 'HTTP 502: Server Error (repo)' });
    expect(observed).toEqual([]);
  });

  it('reports ok on an answer', async () => {
    const stub = await stubApi(answering());
    const observed: LimitObservation[] = [];
    const { api } = client(stub.url, { observe: (o) => observed.push(o) });

    const answer = await api.request({ method: 'GET', path: '/repos/owner/repo', label: 'repo' });

    expect(answer.ok && answer.reply.body).toEqual({ data: {} });
    expect(observed).toEqual(['ok']);
  });
});

/** Seeds the ledger with an `actual` reading whose limit licenses `bound` slots. */
const seedBound = (home: string, account: string, limit: number): void => {
  writeFileSync(
    join(home, 'budget.tsv'),
    `b1\tgithub\t${account}\tgraphql\t${Date.now()}\t1\t${limit}\t${limit - 1}\t-\tactual\n`,
  );
};

describe('the request bound', () => {
  it('is 30 s by default', () => {
    expect(REQUEST_BOUND_MS).toBe(30_000);
  });

  it('ends a request the server never answers with kind failed, naming the request and the bound, and releases its slot', async () => {
    const stub = await stubApi((seen, res) => {
      if (seen.path === '/user') answering()(seen, res);
    });
    const { api, slots, home } = client(stub.url, { boundMs: 200 });
    // A bound of 1 at 900 calls an hour.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(home, { recursive: true });
    seedBound(home, 'someone', 900);

    const started = Date.now();
    const answer = await api.request({ ...GRAPHQL, label: 'graphql, page 2' });

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(answer.ok || answer.refusal).toEqual({
      kind: 'failed',
      said: `no answer from 127.0.0.1:${new URL(stub.url).port} within 0.2 s (graphql, page 2)`,
    });
    expect(refusalKindOf('failed', answer.ok ? '' : answer.refusal.said)).toBe('outage');
    const held = await slots.held('someone');
    expect(held.ok && held.value).toEqual([]);
  });

  it('names the default bound as 30 s', async () => {
    let hung: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      hung = resolve;
    });
    const stub = await stubApi((seen, res) => {
      if (seen.path === '/user') return answering()(seen, res);
      hung();
    });
    const { api } = client(stub.url);
    await api.account();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const pending = api.request(GRAPHQL);
    await arrived;
    vi.advanceTimersByTime(REQUEST_BOUND_MS);
    const answer = await pending;

    expect(answer.ok || answer.refusal.said).toMatch(/within 30 s \(graphql\)$/);
  });

  it('answers failed where the connection is refused', async () => {
    const { port, server } = await listen(net.createServer());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.splice(servers.indexOf(server), 1);
    const { api } = client(`http://127.0.0.1:${port}`);

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal.kind).toBe('failed');
    expect(answer.ok || answer.refusal.said).toMatch(/^no answer from 127\.0\.0\.1:\d+: .*ECONNREFUSED.* \(graphql\)$/);
  });
});

describe('slots', () => {
  it('holds no more requests in flight than the bound, and one slot per request', async () => {
    let inFlight = 0;
    let most = 0;
    const heldDuring: number[] = [];
    let slotsRef: ReturnType<typeof client>['slots'] | null = null;
    const stub = await stubApi((seen, res) => {
      // 1800 calls an hour licenses 2 slots at 4 s a call, read from every reply.
      if (seen.path === '/user') return json(res, 200, { login: 'someone' }, RATE('core', 1799, 1800));
      inFlight += 1;
      most = Math.max(most, inFlight);
      void slotsRef?.held('someone').then((held) => heldDuring.push(held.ok ? held.value.length : -1));
      setTimeout(() => {
        inFlight -= 1;
        json(res, 200, { data: {} }, RATE('graphql', 1799, 1800));
      }, 80);
    });
    const made = client(stub.url);
    slotsRef = made.slots;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(made.home, { recursive: true });
    seedBound(made.home, 'someone', 1800);

    const answers = await Promise.all(Array.from({ length: 5 }, () => made.api.request(GRAPHQL)));

    expect(answers.every((a) => a.ok)).toBe(true);
    expect(most).toBe(2);
    expect(Math.max(...heldDuring)).toBeLessThanOrEqual(2);
    const held = await made.slots.held('someone');
    expect(held.ok && held.value).toEqual([]);
  });

  it('claims exactly one slot for a single request', async () => {
    let during = -1;
    let slotsRef: ReturnType<typeof client>['slots'] | null = null;
    const stub = await stubApi((seen, res) => {
      if (seen.path === '/user') return answering()(seen, res);
      void slotsRef?.held('someone').then((held) => {
        during = held.ok ? held.value.length : -1;
        answering()(seen, res);
      });
    });
    const made = client(stub.url);
    slotsRef = made.slots;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(made.home, { recursive: true });
    seedBound(made.home, 'someone', 5000);

    await made.api.request(GRAPHQL);

    expect(during).toBe(1);
  });

  it('proceeds without a slot once the wait runs out', async () => {
    const stub = await stubApi(answering());
    const made = client(stub.url, { waitMaxMs: 50 });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(made.home, { recursive: true });
    seedBound(made.home, 'someone', 900);
    const other = slotsFile({ home: made.home, pid: 1, isAlive: () => true });
    await other.acquire('someone', 1);

    const answer = await made.api.request(GRAPHQL);

    expect(answer.ok).toBe(true);
  });
});

/** A stub proxy: forwards plain HTTP, records CONNECT targets and refuses them. */
const stubProxy = async () => {
  const forwarded: string[] = [];
  const connects: string[] = [];
  const server = http.createServer((req, res) => {
    forwarded.push(req.url ?? '');
    const target = new URL(req.url ?? '');
    const upstream = http.request(target, { method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    req.pipe(upstream);
  });
  server.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  const { port } = await listen(server);
  return { forwarded, connects, url: `http://127.0.0.1:${port}` };
};

describe('proxies', () => {
  it('sends every plain-HTTP request through HTTP_PROXY', async () => {
    const stub = await stubApi(answering());
    const proxy = await stubProxy();
    const { api } = client(stub.url, { env: { GITHUB_API_URL: stub.url, GH_TOKEN: 't', HTTP_PROXY: proxy.url } });

    expect((await api.request(GRAPHQL)).ok).toBe(true);

    expect(proxy.forwarded).toEqual([`${stub.url}/user`, `${stub.url}/graphql`]);
  });

  it('tunnels every HTTPS request through HTTPS_PROXY', async () => {
    const proxy = await stubProxy();
    const { api } = client('https://127.0.0.1:9', {
      env: { GITHUB_API_URL: 'https://127.0.0.1:9', GH_TOKEN: 't', HTTPS_PROXY: proxy.url },
    });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok || answer.refusal.kind).toBe('failed');
    expect(proxy.connects).toEqual(['127.0.0.1:9', '127.0.0.1:9']);
  });

  it('goes direct to a host NO_PROXY names', async () => {
    const proxy = await stubProxy();
    let direct = 0;
    const { port } = await listen(
      net.createServer((socket) => {
        direct += 1;
        socket.destroy();
      }),
    );
    const base = `https://127.0.0.1:${port}`;
    const { api } = client(base, {
      env: { GITHUB_API_URL: base, GH_TOKEN: 't', HTTPS_PROXY: proxy.url, NO_PROXY: '127.0.0.1' },
    });

    const answer = await api.request(GRAPHQL);

    expect(answer.ok).toBe(false);
    expect(proxy.connects).toEqual([]);
    expect(direct).toBe(2);
  });
});

describe('a GitHub Enterprise origin', () => {
  it('sends requests to its own host and asks gh auth token for that host', async () => {
    const proxy = await stubProxy();
    const asked: string[] = [];
    const { api } = client('', {
      origin: 'git@ghe.example.test:owner/repo.git',
      env: { HTTPS_PROXY: proxy.url },
      ghAuthToken: async (host) => {
        asked.push(host);
        return 'ghe-token';
      },
    });

    await api.request(GRAPHQL);

    expect(api.base).toBe('https://ghe.example.test/api/v3');
    expect(api.graphql).toBe('https://ghe.example.test/api/graphql');
    expect(api.origin).toEqual({ host: 'ghe.example.test', slug: 'owner/repo' });
    expect(asked[0]).toBe('ghe.example.test');
    expect(proxy.connects).toEqual(['ghe.example.test:443', 'ghe.example.test:443']);
  });
});

import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import {
  JIRA_NO_BASE_URL,
  JIRA_NO_CREDENTIALS,
  jiraApi,
  jiraBaseUrl,
  type JiraApiOptions,
} from '../src/adapters/tracker/jira-api.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import type { LimitObservation } from '../src/ports/host.js';

/** One request the stub server saw. */
interface Seen {
  method: string;
  url: string;
  auth: string;
}

type Handler = (seen: Seen, res: http.ServerResponse) => void;

const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const PAGE = { issues: [], isLast: true };
const answering: Handler = (_seen, res) => json(res, 200, PAGE);

const basic = (email: string, token: string): string => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
const hashed = (email: string): string => `jira:${createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 12)}`;

const servers: net.Server[] = [];
let root = '';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-jira-api-')));
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

/** A stub Jira on 127.0.0.1 that records every request. */
const stubJira = async (handler: Handler) => {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const one = { method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? '') };
      seen.push(one);
      handler(one, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { seen, url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
};

/**
 * A main checkout and one linked worktree, laid out as `git worktree add`
 * leaves them, so the client finds both `.env` locations with no `git`.
 */
const checkouts = () => {
  const main = join(root, 'main');
  const worktree = join(root, 'desk');
  mkdirSync(join(main, '.git', 'worktrees', 'desk'), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'desk')}\n`);
  return { main, worktree, common: join(main, '.git') };
};

/** The client under test, against a private ledger and slot directory. */
const client = (env: Record<string, string | undefined>, over: Partial<JiraApiOptions> = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const api = jiraApi({ repoRoot: join(root, 'nowhere'), env, budget, slots, pollMs: 20, ...over });
  const entries = async (): Promise<BudgetEntry[]> => {
    const lines = await budget.lines();
    return lines.ok ? lines.value.map(decodeEntry).filter((e): e is BudgetEntry => e !== null) : [];
  };
  return { api, entries };
};

const SEARCH = { method: 'GET' as const, path: '/rest/api/2/search/jql', query: { jql: 'project IN (A)', maxResults: '100' }, label: 'open issues' };
const CREDS = { JIRA_EMAIL: 'someone@example.test', JIRA_API_TOKEN: 'tok-1' };

describe('the base URL', () => {
  it('takes PLOT_JIRA_BASE_URL over the configured address, and removes the configured trailing slashes', () => {
    expect(jiraBaseUrl('https://x.atlassian.net//', {})).toBe('https://x.atlassian.net');
    expect(jiraBaseUrl('https://x.atlassian.net', { PLOT_JIRA_BASE_URL: 'http://127.0.0.1:9' })).toBe('http://127.0.0.1:9');
    expect(jiraBaseUrl('https://x.atlassian.net', { PLOT_JIRA_BASE_URL: '' })).toBe('https://x.atlassian.net');
  });

  it('answers failed with the shell sentence and sends nothing where no base URL is configured', async () => {
    const { api, entries } = client({ ...CREDS });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'failed', said: JIRA_NO_BASE_URL });
    expect(await entries()).toEqual([]);
    expect(readFileSync(new URL('../../../skills/plot/scripts/plot-host.sh', import.meta.url), 'utf8')).toContain(JIRA_NO_BASE_URL);
  });

  it('sends the path and query below the base URL', async () => {
    const jira = await stubJira(answering);
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    await api.request(SEARCH);

    expect(jira.seen.map((s) => [s.method, s.url])).toEqual([['GET', '/rest/api/2/search/jql?jql=project+IN+%28A%29&maxResults=100']]);
  });
});

describe('credentials', () => {
  it('answers failed with the shell sentence, never an empty list, where neither the environment nor a .env holds them', async () => {
    const jira = await stubJira(answering);
    const { api, entries } = client({ PLOT_JIRA_BASE_URL: jira.url });

    const answer = await api.request(SEARCH);

    expect(answer.ok).toBe(false);
    expect(answer.ok || answer.refusal).toEqual({ kind: 'failed', said: JIRA_NO_CREDENTIALS });
    expect(answer.ok || answer.reply).toBeNull();
    expect(jira.seen).toEqual([]);
    expect(await entries()).toEqual([]);
    expect(api.credentialSource()).toBeNull();
    expect(api.account()).toBe('unknown');
    const shell = readFileSync(new URL('../../../skills/plot/scripts/plot-host.sh', import.meta.url), 'utf8');
    for (const line of JIRA_NO_CREDENTIALS.split('\n')) expect(shell).toContain(line);
  });

  it('sends the environment pair as Basic auth in a header, and never in the URL', async () => {
    const jira = await stubJira(answering);
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    expect((await api.request(SEARCH)).ok).toBe(true);

    expect(jira.seen[0]?.auth).toBe(basic(CREDS.JIRA_EMAIL, CREDS.JIRA_API_TOKEN));
    expect(jira.seen[0]?.url).not.toContain('tok-1');
    expect(api.credentialSource()).toEqual({ kind: 'environment' });
  });

  it('reads the worktree .env, then the main checkout .env, where both variables are unset', async () => {
    const jira = await stubJira(answering);
    const { main, worktree, common } = checkouts();
    writeFileSync(join(main, '.env'), 'export JIRA_EMAIL="main@example.test"\nJIRA_API_TOKEN=main-tok\n');
    const env = { PLOT_JIRA_BASE_URL: jira.url, PLOT_GIT_COMMON_DIR: common };

    const fromMain = client(env, { repoRoot: worktree }).api;
    expect((await fromMain.request(SEARCH)).ok).toBe(true);
    expect(fromMain.credentialSource()).toEqual({ kind: '.env', path: join(main, '.env'), source: 'main-checkout' });

    writeFileSync(join(worktree, '.env'), 'JIRA_EMAIL=desk@example.test\nJIRA_API_TOKEN=desk-tok\n');
    const fromDesk = client(env, { repoRoot: worktree }).api;
    expect((await fromDesk.request(SEARCH)).ok).toBe(true);
    expect(fromDesk.credentialSource()).toEqual({ kind: '.env', path: join(worktree, '.env'), source: 'worktree' });
    expect(fromDesk.account()).toBe(hashed('desk@example.test'));

    expect(jira.seen.map((s) => s.auth)).toEqual([basic('main@example.test', 'main-tok'), basic('desk@example.test', 'desk-tok')]);
  });

  it('reads no .env where one of the pair is set, as jira_load_env_file does', async () => {
    const jira = await stubJira(answering);
    const { main, common } = checkouts();
    writeFileSync(join(main, '.env'), 'JIRA_EMAIL=main@example.test\nJIRA_API_TOKEN=main-tok\n');
    const { api } = client({ PLOT_JIRA_BASE_URL: jira.url, PLOT_GIT_COMMON_DIR: common, JIRA_EMAIL: 'half@example.test' }, { repoRoot: main });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'failed', said: JIRA_NO_CREDENTIALS });
    expect(jira.seen).toEqual([]);
  });

  it('re-reads the source once on a 401 and retries once, so a new token in .env takes effect', async () => {
    const { main, common } = checkouts();
    const file = join(main, '.env');
    writeFileSync(file, 'JIRA_EMAIL=main@example.test\nJIRA_API_TOKEN=old\n');
    const jira = await stubJira((seen, res) => {
      if (seen.auth === basic('main@example.test', 'old')) {
        writeFileSync(file, 'JIRA_EMAIL=main@example.test\nJIRA_API_TOKEN=new\n');
        return json(res, 401, { errorMessages: ['Unauthorized'] });
      }
      return json(res, 200, PAGE);
    });
    const { api, entries } = client({ PLOT_JIRA_BASE_URL: jira.url, PLOT_GIT_COMMON_DIR: common }, { repoRoot: main });

    const answer = await api.request(SEARCH);

    expect(answer.ok).toBe(true);
    expect(jira.seen.map((s) => s.auth)).toEqual([basic('main@example.test', 'old'), basic('main@example.test', 'new')]);
    expect(await entries()).toHaveLength(2);
  });

  it('answers kind auth on a second 401, naming the source and the fix, after exactly two requests', async () => {
    const jira = await stubJira((_seen, res) => json(res, 401, { errorMessages: ['Client must be authenticated'] }));
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    const answer = await api.request(SEARCH);

    expect(jira.seen).toHaveLength(2);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.kind).toBe('auth');
    expect(answer.refusal.said).toContain('the environment');
    expect(answer.refusal.said).toContain('HTTP 401: Client must be authenticated');
    expect(answer.refusal.said).toContain('JIRA_API_TOKEN');
    expect(answer.refusal.said).not.toContain('tok-1');
  });

  it('names the .env path in the auth refusal for a credential read from one', async () => {
    const jira = await stubJira((_seen, res) => json(res, 401, {}));
    const { main, common } = checkouts();
    writeFileSync(join(main, '.env'), 'JIRA_EMAIL=main@example.test\nJIRA_API_TOKEN=main-tok\n');
    const { api } = client({ PLOT_JIRA_BASE_URL: jira.url, PLOT_GIT_COMMON_DIR: common }, { repoRoot: main });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal.kind).toBe('auth');
    expect(answer.ok || answer.refusal.said).toContain(join(main, '.env'));
  });

  it('answers kind auth where the re-read finds no credential any more', async () => {
    const { main, common } = checkouts();
    const file = join(main, '.env');
    writeFileSync(file, 'JIRA_EMAIL=main@example.test\nJIRA_API_TOKEN=old\n');
    const jira = await stubJira((_seen, res) => {
      writeFileSync(file, '');
      json(res, 401, { message: 'gone' });
    });
    const { api } = client({ PLOT_JIRA_BASE_URL: jira.url, PLOT_GIT_COMMON_DIR: common }, { repoRoot: main });

    const answer = await api.request(SEARCH);

    expect(jira.seen).toHaveLength(1);
    expect(answer.ok || answer.refusal.kind).toBe('auth');
    expect(answer.ok || answer.refusal.said).toContain('HTTP 401: gone');
  });
});

describe('the ledger', () => {
  it('appends one entry per request: connector jira, bucket api, the hashed account and basis unknown', async () => {
    const jira = await stubJira(answering);
    const { api, entries } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url }, { now: () => 1_000 });

    await api.request(SEARCH);

    expect(await entries()).toEqual([
      {
        key: { connector: 'jira', account: hashed(CREDS.JIRA_EMAIL), bucket: 'api' },
        at: 1_000,
        spent: 1,
        limit: null,
        remaining: null,
        resetAt: null,
        basis: 'unknown',
      },
    ]);
    expect(api.account()).toBe(hashed(CREDS.JIRA_EMAIL));
    expect(JSON.stringify(await entries())).not.toContain('someone');
  });

  it('records basis actual where the answer carries rate-limit headers, with an ISO or epoch reset', async () => {
    let n = 0;
    const jira = await stubJira((_seen, res) => {
      n += 1;
      const reset = n === 1 ? '2026-11-11T08:00:00.000Z' : '1788003600';
      json(res, 200, PAGE, { 'X-RateLimit-Limit': '350', 'X-RateLimit-Remaining': '349', 'X-RateLimit-Reset': reset });
    });
    const { api, entries } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    await api.request(SEARCH);
    await api.request(SEARCH);

    expect((await entries()).map((e) => [e.basis, e.limit, e.remaining, e.resetAt])).toEqual([
      ['actual', 350, 349, Date.parse('2026-11-11T08:00:00.000Z')],
      ['actual', 350, 349, 1788003600 * 1000],
    ]);
  });

  it('reads no reset where the header is neither a date nor a number', async () => {
    const jira = await stubJira((_seen, res) => json(res, 200, PAGE, { 'X-RateLimit-Limit': '10', 'X-RateLimit-Reset': 'soon' }));
    const { api, entries } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    await api.request(SEARCH);

    expect((await entries()).map((e) => [e.basis, e.limit, e.remaining, e.resetAt])).toEqual([['actual', 10, null, null]]);
  });
});

describe('the answers', () => {
  it('reads a 429 with Retry-After: 30 as throttled with a 30 s wait, and reports it', async () => {
    const jira = await stubJira((_seen, res) => json(res, 429, { errorMessages: ['Rate limit exceeded'] }, { 'Retry-After': '30' }));
    const observed: LimitObservation[] = [];
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url }, { observe: (o) => observed.push(o) });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal).toEqual({ kind: 'throttled', said: 'Rate limit exceeded', waitMs: 30_000 });
    expect(observed).toEqual(['throttled']);
  });

  it('reports ok on a 2xx answer and returns the parsed body', async () => {
    const jira = await stubJira(answering);
    const observed: LimitObservation[] = [];
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url }, { observe: (o) => observed.push(o) });

    const answer = await api.request(SEARCH);

    expect(answer.ok && answer.reply.body).toEqual(PAGE);
    expect(observed).toEqual(['ok']);
  });

  it('answers failed with the status, the message and the label on any other status', async () => {
    const jira = await stubJira((seen, res) =>
      seen.url.startsWith('/a') ? json(res, 400, { errorMessages: ['bad jql', 'second'] }) : res.writeHead(503).end('down'),
    );
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    const bad = await api.request({ method: 'GET', path: '/a', label: 'one' });
    const down = await api.request({ method: 'GET', path: '/b', label: 'two' });

    expect(bad.ok || bad.refusal).toEqual({ kind: 'failed', said: 'HTTP 400: bad jql; second (one)' });
    expect(down.ok || down.refusal).toEqual({ kind: 'failed', said: 'HTTP 503: down (two)' });
  });

  it('answers failed, naming the host, where no answer comes within the bound', async () => {
    const jira = await stubJira(() => undefined);
    const { api, entries } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url }, { boundMs: 50 });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal.kind).toBe('failed');
    expect(answer.ok || answer.refusal.said).toMatch(/^no answer from 127\.0\.0\.1:\d+ within 0\.05 s \(open issues\)$/);
    expect(await entries()).toHaveLength(1);
  });

  it('answers failed with the transport error where the connection is refused', async () => {
    const jira = await stubJira(answering);
    const closed = servers.pop() as http.Server;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: jira.url });

    const answer = await api.request(SEARCH);

    expect(answer.ok || answer.refusal.said).toMatch(/^no answer from 127\.0\.0\.1:\d+: .*ECONNREFUSED.* \(open issues\)$/);
  });

  it('sends a JSON body where the request carries one', async () => {
    const bodies: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        json(res, 201, { key: 'A-1' });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const { api } = client({ ...CREDS, PLOT_JIRA_BASE_URL: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` });

    const answer = await api.request({ method: 'POST', path: '/rest/api/2/issue', body: { fields: {} }, label: 'open' });

    expect(answer.ok && answer.reply.body).toEqual({ key: 'A-1' });
    expect(bodies).toEqual(['{"fields":{}}']);
  });
});

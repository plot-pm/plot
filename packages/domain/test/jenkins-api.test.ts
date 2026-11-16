import http from 'node:http';
import net from 'node:net';
import { chmodSync, renameSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { composeJenkins, credentialSafe, issuerOf, jenkinsApi, type JenkinsApiOptions } from '../src/adapters/build/jenkins-api.js';
import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';

const servers: net.Server[] = [];
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-jenkins-api-'));
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

interface Seen {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const stub = async (handler: (seen: Seen, res: http.ServerResponse) => void) => {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const one = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      seen.push(one);
      handler(one, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { seen, url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
};

const jwt = (iss: string): string => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss })).toString('base64url')}.sig`;

const NOW = 1_800_000_000_000;
const SECOND = Math.floor(NOW / 1000);

/** A token store directory holding one blob. */
const store = (name: string, blob: object | string | null): string => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (blob !== null) writeFileSync(join(dir, 'keycloak-token.secret'), typeof blob === 'string' ? blob : JSON.stringify(blob), { mode: 0o600 });
  return dir;
};

const okJenkins = (_: Seen, res: http.ServerResponse): void => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
};

const grantAnswer = (token: string) => (seen: Seen, res: http.ServerResponse): void => {
  if (seen.path.endsWith('/protocol/openid-connect/token')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: token, refresh_token: 'R2-secret', expires_in: 300 }));
    return;
  }
  okJenkins(seen, res);
};

const client = (env: Record<string, string>, over: Partial<JenkinsApiOptions> = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const entries = async (): Promise<BudgetEntry[]> => {
    const lines = await budget.lines();
    return lines.ok ? lines.value.map(decodeEntry).filter((e): e is BudgetEntry => e !== null) : [];
  };
  const api = jenkinsApi({ instance: 'jenkins.example.org', env, budget, slots, now: () => NOW, pollMs: 20, tornReadMs: 20, ...over });
  return { api, entries };
};

const GET = { path: '/job/team/api/json', label: 'job read' };

describe('credentialSafe', () => {
  it('admits https and loopback http, and nothing else', () => {
    expect(credentialSafe('https://ci.example.org/x')).toBe(true);
    expect(credentialSafe('http://127.0.0.1:8080/x')).toBe(true);
    expect(credentialSafe('http://localhost/x')).toBe(true);
    expect(credentialSafe('http://ci.example.org/x')).toBe(false);
    expect(credentialSafe('not a url')).toBe(false);
  });
});

describe('issuerOf', () => {
  it('reads iss without a signature check, and answers null where absent', () => {
    expect(issuerOf(jwt('https://sso.example.org/realms/x'))).toBe('https://sso.example.org/realms/x');
    expect(issuerOf('opaque')).toBeNull();
  });
});

describe('the realm and the guard', () => {
  it('takes JEN_REALM_URL over the iss claim', async () => {
    const api = await stub(grantAnswer('A2'));
    const dir = store('s', { access_token: jwt('https://elsewhere.example.org/r'), refresh_token: 'R1', expires_at: SECOND - 10 });
    const { api: c } = client({ JEN_URL: `${api.url}/jenkins`, JEN_REALM_URL: `${api.url}/realm`, JEN_CONFIG_DIR: dir });
    const got = await c.request(GET);
    expect(got.ok).toBe(true);
    expect(api.seen.map((s) => s.path)).toEqual(['/realm/protocol/openid-connect/token', '/jenkins/job/team/api/json']);
  });

  it('keeps the shell for an http: instance on a non-loopback host and sends no request', async () => {
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client({ JEN_URL: 'http://ci.example.org', JEN_REALM_URL: 'https://sso.example.org/r', JEN_CONFIG_DIR: dir });
    const state = await c.ready();
    expect(state).toMatchObject({ ok: false, kind: 'unaskable' });
    expect(await c.request(GET)).toMatchObject({ ok: false, refusal: { kind: 'unaskable' }, reply: null });
  });

  it('keeps the shell for an http: realm on a non-loopback host', async () => {
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client({ JEN_URL: 'https://ci.example.org', JEN_REALM_URL: 'http://sso.example.org/r', JEN_CONFIG_DIR: dir });
    expect(await c.ready()).toMatchObject({ ok: false, kind: 'unaskable' });
  });

  it('keeps the shell where the stored token names no realm', async () => {
    const dir = store('s', { access_token: 'opaque', expires_at: SECOND + 100 });
    const { api: c } = client({ JEN_URL: 'https://ci.example.org', JEN_CONFIG_DIR: dir });
    expect(await c.ready()).toEqual({ ok: false, kind: 'unaskable', reason: 'the stored token names no realm' });
  });

  it('keeps the shell for a bare slug with no JEN_URL', async () => {
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client({ JEN_CONFIG_DIR: dir }, { instance: 'portal' });
    expect(await c.ready()).toMatchObject({ ok: false, kind: 'unaskable', reason: expect.stringContaining('slug') });
  });
});

describe('credential sources and headers', () => {
  it('sends the bearer and the Jenkins Basic pair from the environment, and writes no file', async () => {
    const api = await stub(okJenkins);
    const dir = store('empty', null);
    const { api: c } = client({
      JEN_URL: `${api.url}/jenkins`, JEN_REALM_URL: `${api.url}/realm`, JEN_CONFIG_DIR: dir,
      JEN_TOKEN: 'ENVBEARER', JENKINS_USER: 'u', JENKINS_API_TOKEN: 't',
    });
    expect((await c.request(GET)).ok).toBe(true);
    expect(api.seen[0]?.headers.authorization).toBe('Bearer ENVBEARER');
    expect(api.seen[0]?.headers['x-jenkins-authorization']).toBe(`Basic ${Buffer.from('u:t').toString('base64')}`);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reads the per-instance Jenkins pair from the store', async () => {
    const api = await stub(okJenkins);
    const dir = store('s', { access_token: 'STORED', expires_at: SECOND + 100 });
    const key = `127.0.0.1:${new URL(api.url).port}`;
    const { jenSecretFile } = await import('../src/rules/jen-url.js');
    writeFileSync(jenSecretFile(dir, `jenkins-user:${key}`), 'su\n');
    writeFileSync(jenSecretFile(dir, `jenkins-token:${key}`), 'st\n');
    const { api: c } = client({ JEN_URL: `${api.url}/jenkins`, JEN_REALM_URL: `${api.url}/realm`, JEN_CONFIG_DIR: dir });
    expect((await c.request(GET)).ok).toBe(true);
    expect(api.seen[0]?.headers.authorization).toBe('Bearer STORED');
    expect(api.seen[0]?.headers['x-jenkins-authorization']).toBe(`Basic ${Buffer.from('su:st').toString('base64')}`);
  });
});

describe('refresh', () => {
  const env = (url: string, dir: string) => ({ JEN_URL: `${url}/jenkins`, JEN_REALM_URL: `${url}/realm`, JEN_CONFIG_DIR: dir });

  it('posts one grant for an expired blob, writes the store 0600, and starts no process', async () => {
    const api = await stub(grantAnswer('A2'));
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1', expires_at: SECOND - 10 });
    const { api: c } = client({ ...env(api.url, dir), PATH: join(root, 'nowhere') });
    expect((await c.request(GET)).ok).toBe(true);
    const grants = api.seen.filter((s) => s.path.endsWith('/token'));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.body).toContain('grant_type=refresh_token');
    expect(grants[0]?.body).toContain('client_id=cli');
    expect(api.seen.at(-1)?.headers.authorization).toBe('Bearer A2');
    const file = join(dir, 'keycloak-token.secret');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ access_token: 'A2', refresh_token: 'R2-secret' });
  });

  it('posts no grant where a newer blob is on disk', async () => {
    const api = await stub(grantAnswer('A9'));
    const dir = store('s', { access_token: 'NEW', refresh_token: 'R1', expires_at: SECOND + 200 });
    const { api: c } = client(env(api.url, dir));
    expect((await c.request(GET)).ok).toBe(true);
    expect(api.seen.some((s) => s.path.endsWith('/token'))).toBe(false);
    expect(api.seen[0]?.headers.authorization).toBe('Bearer NEW');
  });

  it('posts one grant for two clients over two repository roots and one store', async () => {
    const api = await stub((seen, res) => {
      if (seen.path.endsWith('/token')) {
        setTimeout(() => grantAnswer('A2')(seen, res), 60);
        return;
      }
      okJenkins(seen, res);
    });
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1', expires_at: SECOND - 10 });
    const one = client({ ...env(api.url, dir), PLOT_REPO_ROOT: join(root, 'r1') }).api;
    const two = client({ ...env(api.url, dir), PLOT_REPO_ROOT: join(root, 'r2') }, { now: () => NOW }).api;
    const [a, b] = await Promise.all([one.request(GET), two.request(GET)]);
    expect(a.ok && b.ok).toBe(true);
    expect(api.seen.filter((s) => s.path.endsWith('/token'))).toHaveLength(1);
    expect(existsSync(join(dir, 'keycloak-token.lock'))).toBe(false);
  });

  it('refuses with kind auth on invalid_grant, naming jen auth login and no token', async () => {
    const api = await stub((_seen, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Token is not active', refresh_token: 'LEAK-R' }));
    });
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1-secret', expires_at: SECOND - 10 });
    const { api: c } = client(env(api.url, dir));
    const got = await c.request(GET);
    expect(got).toMatchObject({ ok: false, refusal: { kind: 'auth' } });
    if (!got.ok) {
      expect(got.refusal.said).toContain('jen auth login');
      expect(got.refusal.said).not.toContain('LEAK-R');
      expect(got.refusal.said).not.toContain('R1-secret');
    }
  });

  it('adopts a newer blob on invalid_grant', async () => {
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1', expires_at: SECOND - 10 });
    const api = await stub((seen, res) => {
      if (seen.path.endsWith('/token')) {
        writeFileSync(join(dir, 'keycloak-token.secret'), JSON.stringify({ access_token: 'RACED', refresh_token: 'R9', expires_at: SECOND + 200 }));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid_grant"}');
        return;
      }
      okJenkins(seen, res);
    });
    const { api: c } = client(env(api.url, dir));
    expect((await c.request(GET)).ok).toBe(true);
    expect(api.seen.at(-1)?.headers.authorization).toBe('Bearer RACED');
  });

  it('never lets a polling reader parse a partial blob across 100 write-backs', async () => {
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1', expires_at: SECOND - 10 });
    let n = 0;
    const api = await stub((seen, res) => {
      if (seen.path.endsWith('/token')) {
        n += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: `A${n}`.padEnd(4000, 'x'), refresh_token: 'R2', expires_in: 300 }));
        return;
      }
      okJenkins(seen, res);
    });
    let stop = false;
    let bad = 0;
    const file = join(dir, 'keycloak-token.secret');
    const reader = (async () => {
      while (!stop) {
        try {
          JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          bad += 1;
        }
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 100; i += 1) {
      writeFileSync(`${file}.seed`, JSON.stringify({ access_token: 'old', refresh_token: 'R1', expires_at: SECOND - 10 }));
      renameSync(`${file}.seed`, file);
      const { api: c } = client(env(api.url, dir));
      await c.request(GET);
    }
    stop = true;
    await reader;
    expect(bad).toBe(0);
    expect(n).toBeGreaterThanOrEqual(100);
  }, 120_000);
});

describe('status and redirects', () => {
  const env = (url: string, dir: string) => ({ JEN_URL: `${url}/jenkins`, JEN_REALM_URL: `${url}/realm`, JEN_CONFIG_DIR: dir });

  it('retries a 401 once and then refuses with kind auth naming jen auth login', async () => {
    const api = await stub((_, res) => {
      res.writeHead(401);
      res.end();
    });
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client(env(api.url, dir));
    const got = await c.request(GET);
    expect(api.seen).toHaveLength(2);
    expect(got).toMatchObject({ ok: false, refusal: { kind: 'auth' } });
    if (!got.ok) expect(got.refusal.said).toContain('jen auth login');
  });

  it('refuses a redirect to a third host after one request and sends that host nothing', async () => {
    const third = await stub(okJenkins);
    const api = await stub((_, res) => {
      res.writeHead(302, { Location: `${third.url}/landed` });
      res.end();
    });
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client(env(api.url, dir));
    const got = await c.request(GET);
    expect(got).toMatchObject({ ok: false, refusal: { kind: 'unaskable' } });
    expect(api.seen).toHaveLength(1);
    expect(third.seen).toEqual([]);
  });

  it('refuses a redirect with no Location as unaskable', async () => {
    const api = await stub((_, res) => {
      res.writeHead(302);
      res.end();
    });
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client(env(api.url, dir));
    expect(await c.request(GET)).toMatchObject({ ok: false, refusal: { kind: 'unaskable' } });
    expect(api.seen).toHaveLength(1);
  });

  it('cuts an HTML error body to 200 characters with tags removed', async () => {
    const api = await stub((_, res) => {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><b>${'x'.repeat(500)}</b></html>`);
    });
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c } = client(env(api.url, dir));
    const got = await c.request(GET);
    expect(got).toMatchObject({ ok: false, refusal: { kind: 'failed' } });
    if (!got.ok) {
      expect(got.refusal.said).not.toContain('<');
      expect(got.refusal.said.length).toBeLessThan(260);
    }
  });
});

describe('the ledger', () => {
  const env = (url: string, dir: string) => ({ JEN_URL: `${url}/jenkins`, JEN_REALM_URL: `${url}/realm`, JEN_CONFIG_DIR: dir });

  it('appends one jenkins entry, bucket empty, predicted 60, for one instance request', async () => {
    const api = await stub(okJenkins);
    const dir = store('s', { access_token: 'T', expires_at: SECOND + 100 });
    const { api: c, entries } = client(env(api.url, dir));
    await c.request(GET);
    const all = await entries();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: { connector: 'jenkins', bucket: '' }, limit: 60, basis: 'predicted', spent: 1 });
  });

  it('appends one token entry with basis unknown for a refresh, beside the instance entry', async () => {
    const api = await stub(grantAnswer('A2'));
    const dir = store('s', { access_token: 'A1', refresh_token: 'R1', expires_at: SECOND - 10 });
    const { api: c, entries } = client(env(api.url, dir));
    await c.request(GET);
    const all = await entries();
    const token = all.filter((e) => e.key.bucket === 'token');
    expect(token).toHaveLength(1);
    expect(token[0]).toMatchObject({ key: { connector: 'jenkins' }, basis: 'unknown' });
    expect(all.filter((e) => e.key.bucket === '')).toHaveLength(1);
    expect(all.filter((e) => e.limit === 60 && e.basis === 'predicted')).toHaveLength(1);
  });
});

describe('no credential in any text', () => {
  it('keeps recognisable secrets out of every refusal, ledger line and log', async () => {
    const SECRETS = ['SECRET-REFRESH-9f3', 'SECRET-ACCESS-7c1', 'SECRET-JUSER-2b8', 'SECRET-JTOKEN-4d5'];
    const api = await stub((seen, res) => {
      if (seen.path.endsWith('/token')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'bad', refresh_token: SECRETS[0], access_token: SECRETS[1] }));
        return;
      }
      res.writeHead(401);
      res.end(`<p>${SECRETS.join(' ')}</p>`);
    });
    const dir = store('s', { access_token: SECRETS[1], refresh_token: SECRETS[0], expires_at: SECOND - 10 });
    const logs: string[] = [];
    const home = join(root, 'budget');
    const compose = composeJenkins(
      { instance: 'x', env: { JEN_URL: `${api.url}/jenkins`, JEN_REALM_URL: `${api.url}/realm`, JEN_CONFIG_DIR: dir, JENKINS_USER: SECRETS[2] as string, JENKINS_API_TOKEN: SECRETS[3] as string }, budget: budgetFile({ home }), slots: slotsFile({ home, isAlive: () => true }), now: () => NOW },
      (line) => logs.push(line),
    );
    const chosen = await compose();
    expect(chosen.kind).toBe('in-process');
    const said: string[] = [];
    if (chosen.kind === 'in-process') {
      const got = await chosen.api.request(GET);
      if (!got.ok) said.push(got.refusal.said);
      const ready = await chosen.api.ready();
      said.push(JSON.stringify(ready));
    }
    const ledger = existsSync(join(home, 'budget.tsv')) ? readFileSync(join(home, 'budget.tsv'), 'utf8') : '';
    const text = [...logs, ...said, ledger].join('\n');
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });
});

describe('composition', () => {
  const only = (home: string) => ({ PATH: '/usr/bin', PLOT_REPO_ROOT: join(root, 'repo'), HOME: home, JEN_URL: 'https://ci.example.org', JEN_REALM_URL: 'https://sso.example.org/r' });

  it('picks in-process with only PATH, PLOT_REPO_ROOT and HOME and names the directory', async () => {
    const home = join(root, 'home');
    mkdirSync(join(home, '.config', 'jen'), { recursive: true });
    writeFileSync(join(home, '.config', 'jen', 'keycloak-token.secret'), JSON.stringify({ access_token: 'T', expires_at: SECOND + 100 }));
    const logs: string[] = [];
    const compose = composeJenkins({ instance: 'ci.example.org', env: only(home), now: () => NOW }, (l) => logs.push(l));
    const chosen = await compose();
    expect(chosen).toMatchObject({ kind: 'in-process', dir: join(home, '.config', 'jen') });
    await compose();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(join(home, '.config', 'jen'));
  });

  it('picks the shell with the reason, once, where no token file exists', async () => {
    const home = join(root, 'home');
    mkdirSync(home, { recursive: true });
    const logs: string[] = [];
    const compose = composeJenkins({ instance: 'ci.example.org', env: only(home), now: () => NOW }, (l) => logs.push(l));
    expect(await compose()).toMatchObject({ kind: 'shell' });
    await compose();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('keycloak-token.secret');
  });

  it('picks the shell where only a .env holds JENKINS_API_TOKEN', async () => {
    const home = join(root, 'home');
    mkdirSync(join(home, '.config'), { recursive: true });
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, '.env'), 'JENKINS_API_TOKEN=abc\n');
    chmodSync(join(repo, '.env'), 0o600);
    const compose = composeJenkins({ instance: 'ci.example.org', env: only(home), now: () => NOW });
    expect(await compose()).toMatchObject({ kind: 'shell' });
  });
});

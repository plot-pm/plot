import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { budgetFile } from '../src/adapters/budget/budget-file.js';
import {
  connectorHttps,
  headerNumber,
  REQUEST_BOUND_MS,
  throttledOf,
  type ConnectorCall,
  type ConnectorReply,
} from '../src/adapters/host/connector-https.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';
import { decodeEntry, type BudgetEntry } from '../src/entities/budget.js';
import type { LimitObservation } from '../src/ports/host.js';

const servers: net.Server[] = [];
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-connector-https-'));
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

const BITBUCKET = (url: string, over: Partial<ConnectorCall> = {}): ConnectorCall => ({
  url: new URL(`${url}/2.0/repositories/ws/repo/pullrequests`),
  method: 'GET',
  headers: { Authorization: 'Basic Zml4dHVyZQ==' },
  connector: 'bitbucket',
  account: 'ws',
  spend: (reply) => {
    const limit = reply === null ? null : (headerNumber(reply.headers['x-ratelimit-limit']) ?? null);
    return limit === null
      ? { bucket: 'api', limit: 1000, remaining: null, resetAt: null, basis: 'predicted' }
      : { bucket: 'api', limit, remaining: headerNumber(reply?.headers['x-ratelimit-remaining']), resetAt: null, basis: 'actual' };
  },
  ...over,
});

const transport = (over: Parameters<typeof connectorHttps>[0] = {}) => {
  const home = join(root, 'budget');
  const budget = budgetFile({ home });
  const slots = slotsFile({ home, isAlive: () => true });
  const entries = async (): Promise<BudgetEntry[]> => {
    const lines = await budget.lines();
    return lines.ok ? lines.value.map(decodeEntry).filter((e): e is BudgetEntry => e !== null) : [];
  };
  return { https: connectorHttps({ env: {}, budget, slots, pollMs: 20, ...over }), entries };
};

describe('one request through the shared transport', () => {
  it('sends the caller headers and JSON body, and parses a JSON reply', async () => {
    const api = await stub((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"size":1}');
    });
    const { https } = transport();
    const sent = await https.exchange(BITBUCKET(api.url, { method: 'POST', body: { a: 1 } }));
    expect(sent).toMatchObject({ reply: { status: 200, body: { size: 1 } } });
    expect(api.seen[0]?.headers.authorization).toBe('Basic Zml4dHVyZQ==');
    expect(api.seen[0]?.headers['content-type']).toBe('application/json');
    expect(api.seen[0]?.body).toBe('{"a":1}');
  });

  it('returns the raw text where the body is not JSON, and null where it is empty', async () => {
    const api = await stub((seen, res) => {
      res.writeHead(200);
      res.end(seen.path.endsWith('empty') ? '' : 'plain');
    });
    const { https } = transport();
    const plain = await https.send(BITBUCKET(api.url));
    const empty = await https.send(BITBUCKET(api.url, { url: new URL(`${api.url}/empty`) }));
    expect(plain).toMatchObject({ reply: { body: 'plain' } });
    expect(empty).toMatchObject({ reply: { body: null } });
  });
});

describe('the ledger entry', () => {
  it('carries the connector, account and bucket the caller named, basis predicted with no headers', async () => {
    const api = await stub((_, res) => {
      res.writeHead(200);
      res.end('{}');
    });
    const { https, entries } = transport({ now: () => 1_788_000_000_000 });
    await https.exchange(BITBUCKET(api.url));
    expect(await entries()).toEqual([
      {
        key: { connector: 'bitbucket', account: 'ws', bucket: 'api' },
        at: 1_788_000_000_000,
        spent: 1,
        limit: 1000,
        remaining: null,
        resetAt: null,
        basis: 'predicted',
      },
    ]);
  });

  it('records basis actual where the caller reads a window off the headers', async () => {
    const api = await stub((_, res) => {
      res.writeHead(200, { 'X-RateLimit-Limit': '1000', 'X-RateLimit-Remaining': '990' });
      res.end('{}');
    });
    const { https, entries } = transport();
    await https.exchange(BITBUCKET(api.url));
    expect((await entries())[0]).toMatchObject({ limit: 1000, remaining: 990, basis: 'actual' });
  });

  it('charges a request that got no answer, with no reply to read', async () => {
    const { https, entries } = transport();
    const sent = await https.exchange(BITBUCKET('http://127.0.0.1:9'));
    expect(sent).toMatchObject({ error: expect.any(String), timedOut: false });
    expect(await entries()).toHaveLength(1);
  });
});

describe('the request bound', () => {
  it('is 30 s by default', () => {
    expect(REQUEST_BOUND_MS).toBe(30_000);
    expect(transport().https.boundMs).toBe(30_000);
  });

  it('ends a request the server never answers with timedOut', async () => {
    const api = await stub(() => undefined);
    const { https } = transport({ boundMs: 80 });
    expect(await https.send(BITBUCKET(api.url))).toEqual({ error: 'timeout', timedOut: true });
  });
});

describe('host slots', () => {
  it('holds no more requests in flight than the ledger bound for the connector and account', async () => {
    let live = 0;
    let peak = 0;
    const api = await stub((_, res) => {
      live += 1;
      peak = Math.max(peak, live);
      setTimeout(() => {
        live -= 1;
        res.writeHead(200, { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '99' });
        res.end('{}');
      }, 30);
    });
    const { https } = transport();
    await https.exchange(BITBUCKET(api.url));
    peak = 0;
    const calls = await Promise.all(Array.from({ length: 12 }, () => https.exchange(BITBUCKET(api.url))));
    expect(calls.every((c) => 'reply' in c)).toBe(true);
    expect(peak).toBeLessThan(12);
  });

  it('takes no slot where the ledger licenses no bound', async () => {
    let live = 0;
    let peak = 0;
    const api = await stub((_, res) => {
      live += 1;
      peak = Math.max(peak, live);
      setTimeout(() => {
        live -= 1;
        res.writeHead(200);
        res.end('{}');
      }, 30);
    });
    const { https } = transport();
    const unknown = (): ConnectorCall =>
      BITBUCKET(api.url, { connector: 'jira', account: 'unknown', spend: () => ({ bucket: 'api', limit: null, remaining: null, resetAt: null, basis: 'unknown' }) });
    await Promise.all(Array.from({ length: 6 }, () => https.exchange(unknown())));
    expect(peak).toBe(6);
  });
});

describe('throttledOf', () => {
  const reply = (status: number, headers: Record<string, string> = {}): ConnectorReply => ({ status, headers, body: null });

  it('maps a 429 with Retry-After to throttled with the wait, and reports it', () => {
    const observed: LimitObservation[] = [];
    expect(throttledOf(reply(429, { 'retry-after': '7' }), 'Too many requests', (o) => observed.push(o))).toEqual({
      kind: 'throttled',
      said: 'Too many requests',
      waitMs: 7000,
    });
    expect(observed).toEqual(['throttled']);
  });

  it('maps a 429 with no Retry-After to throttled with no wait', () => {
    expect(throttledOf(reply(429), 'slow down')).toEqual({ kind: 'throttled', said: 'slow down' });
  });

  it('answers null for any other status', () => {
    expect(throttledOf(reply(200), 'ok')).toBeNull();
    expect(throttledOf(reply(403, { 'retry-after': '3' }), 'no')).toBeNull();
  });
});

describe('headerNumber', () => {
  it('reads an integer and nothing else', () => {
    expect(headerNumber(' 42 ')).toBe(42);
    expect(headerNumber('-1')).toBe(-1);
    expect(headerNumber('4.5')).toBeNull();
    expect(headerNumber(undefined)).toBeNull();
  });
});

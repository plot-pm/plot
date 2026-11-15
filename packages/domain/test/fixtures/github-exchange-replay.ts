import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { budgetFile } from '../../src/adapters/budget/budget-file.js';
import { githubApi, type GithubApi } from '../../src/adapters/host/github-api.js';
import { slotsFile } from '../../src/adapters/slots/slots-file.js';
import { canonical } from './github-replay.js';

/** The repository the issue and run fixtures were recorded against. */
export const EXCHANGE_ORIGIN = 'git@github.com:plot-fixture/issues.git';

/** One request `gh` sent, REST or GraphQL, and the answer the recorder's stub gave. */
export interface Exchange {
  readonly request: { readonly method: string; readonly path: string; readonly body?: unknown };
  readonly status: number;
  readonly response: unknown;
}

/** One `gh` invocation `plot-host.sh` made, what it printed and how it exited. */
export interface ExchangeCall {
  readonly argv: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** One fixture `corpus/record-github-issues-runs.mjs` wrote. */
export interface ExchangeFixture {
  readonly name: string;
  readonly gh: string;
  readonly shell: { readonly code: number };
  readonly calls: readonly ExchangeCall[];
  readonly exchanges: readonly Exchange[];
  readonly [field: string]: unknown;
}

/** Reads every fixture in one of the recorder's directories, by name. */
export const readExchangeFixtures = (directory: 'github-issue-reads' | 'github-runs-for-sha'): ExchangeFixture[] => {
  const root = new URL(`../../corpus/fixtures/${directory}`, import.meta.url).pathname;
  return readdirSync(root)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file): ExchangeFixture => ({ ...(JSON.parse(readFileSync(join(root, file), 'utf8')) as ExchangeFixture), name: file.replace(/\.json$/, '') }));
};

/** One request the stub received, in the recorder's shape. */
export interface SentRequest {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

/** How the stub answers one request before the recording does; null leaves it to the recording. */
export type ExchangeOverride = (sent: SentRequest, index: number) => { status: number; body: unknown; headers?: Record<string, string> } | null;

/** A stub GitHub API on 127.0.0.1 that answers recorded exchanges. */
export interface ExchangeReplay {
  readonly url: string;
  /** The requests the client sent, `/user` excluded, in order. */
  readonly sent: SentRequest[];
  close(): Promise<void>;
}

/**
 * Starts a stub GitHub API that answers each request with the recorded
 * answer whose method, path and body match, and `GET /user` with the login
 * `fixture`. A request no exchange recorded answers HTTP 500
 * `unrecorded request`.
 *
 * @param exchanges - the recorded exchanges.
 * @param override - answers a request before the recording does.
 * @returns the stub.
 */
export const startExchangeReplay = async (exchanges: readonly Exchange[], override: ExchangeOverride = () => null): Promise<ExchangeReplay> => {
  const sent: SentRequest[] = [];
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    req.on('end', () => {
      const path = req.url ?? '/';
      const graphql = path === '/graphql';
      const reply = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        const rate = { 'X-RateLimit-Resource': graphql ? 'graphql' : 'core', 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Reset': '1788003600' };
        res.writeHead(status, { 'Content-Type': 'application/json', ...rate, ...headers });
        res.end(JSON.stringify(body));
      };
      if (path === '/user') return reply(200, { login: 'fixture' });
      const request: SentRequest = graphql ? { method: req.method ?? 'GET', path, body: JSON.parse(text) as unknown } : { method: req.method ?? 'GET', path };
      sent.push(request);
      const forced = override(request, sent.length - 1);
      if (forced !== null) return reply(forced.status, forced.body, forced.headers);
      const hit = exchanges.find((one) => canonical(one.request) === canonical(request));
      return hit === undefined ? reply(500, { message: 'unrecorded request' }) : reply(hit.status, hit.response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    sent,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/**
 * A client against a stub, with its own ledger and slot directory under a new
 * temp directory, and the fixture token.
 *
 * @param url - the stub's base URL.
 * @param origin - the `origin` remote the client reads; defaults to {@link EXCHANGE_ORIGIN}.
 * @returns the client and the call that removes its temp directory.
 */
export const exchangeClient = (url: string, origin: string | null = EXCHANGE_ORIGIN): { api: GithubApi; cleanup: () => void } => {
  const home = mkdtempSync(join(tmpdir(), 'plot-github-exchange-'));
  const api = githubApi({
    origin,
    env: { GITHUB_API_URL: url, GH_TOKEN: 'fixture' },
    budget: budgetFile({ home }),
    slots: slotsFile({ home, isAlive: () => true }),
  });
  return { api, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

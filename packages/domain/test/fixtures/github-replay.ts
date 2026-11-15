import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { budgetFile } from '../../src/adapters/budget/budget-file.js';
import { githubApi, type GithubApi } from '../../src/adapters/host/github-api.js';
import { slotsFile } from '../../src/adapters/slots/slots-file.js';
import type { PrListingQuery } from '../../src/ports/host.js';

/** One GraphQL request `gh` sent and the answer the recorder's stub gave. */
export interface RecordedExchange {
  readonly request: { readonly query: string; readonly variables?: Record<string, unknown> };
  readonly response: unknown;
}

/** One `gh` invocation `plot-host.sh` made and what `gh` printed. */
export interface RecordedCall {
  readonly argv: readonly string[];
  readonly stdout: string;
}

/** One fixture `corpus/record-github-pr-listing.mjs` wrote. */
export interface ListingFixture {
  readonly name: string;
  readonly gh: string;
  readonly query: PrListingQuery;
  readonly args: readonly string[];
  readonly calls: readonly RecordedCall[];
  readonly exchanges: readonly RecordedExchange[];
}

/** Where the recorder writes its fixtures. */
export const LISTING_FIXTURES = new URL('../../corpus/fixtures/github-pr-listing', import.meta.url).pathname;

/** Reads every recorded listing fixture, by name. */
export const readListingFixtures = (): ListingFixture[] =>
  readdirSync(LISTING_FIXTURES)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ name: file.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(join(LISTING_FIXTURES, file), 'utf8')) as Omit<ListingFixture, 'name'>) }));

/** A JSON value with every object's keys sorted, so two bodies compare by content. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** How the stub answers one GraphQL request; null answers it from the recorded exchanges. */
export type ReplayOverride = (body: unknown, index: number) => { status: number; body: unknown; headers?: Record<string, string> } | null;

/** A stub GitHub API on 127.0.0.1 that answers recorded GraphQL exchanges. */
export interface GithubReplay {
  readonly url: string;
  /** The GraphQL bodies the client sent, in order. */
  readonly sent: unknown[];
  close(): Promise<void>;
}

/**
 * Starts a stub GitHub API that answers each GraphQL body with the recorded
 * response whose request has the same content, and `GET /user` with the login
 * `fixture`. A body no exchange recorded answers HTTP 500 `unrecorded request`.
 *
 * @param exchanges - the recorded exchanges.
 * @param override - answers a request before the recording does.
 * @returns the stub.
 */
export const startGithubReplay = async (exchanges: readonly RecordedExchange[], override: ReplayOverride = () => null): Promise<GithubReplay> => {
  const sent: unknown[] = [];
  const rate = { 'X-RateLimit-Resource': 'graphql', 'X-RateLimit-Limit': '5000', 'X-RateLimit-Remaining': '4999', 'X-RateLimit-Reset': '1788003600' };
  const server = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    req.on('end', () => {
      const reply = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...rate, ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/user') return reply(200, { login: 'fixture' });
      const body: unknown = JSON.parse(text);
      sent.push(body);
      const forced = override(body, sent.length - 1);
      if (forced !== null) return reply(forced.status, forced.body, forced.headers);
      const hit = exchanges.find((one) => canonical(one.request) === canonical(body));
      return hit === undefined ? reply(500, { message: 'unrecorded request' }) : reply(200, hit.response);
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
 * @returns the client and the call that removes its temp directory.
 */
export const replayClient = (url: string): { api: GithubApi; cleanup: () => void } => {
  const home = mkdtempSync(join(tmpdir(), 'plot-github-replay-'));
  const api = githubApi({
    origin: 'git@github.com:plot-fixture/listing.git',
    env: { GITHUB_API_URL: url, GH_TOKEN: 'fixture' },
    budget: budgetFile({ home }),
    slots: slotsFile({ home, isAlive: () => true }),
  });
  return { api, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { budgetFile } from '../../src/adapters/budget/budget-file.js';
import { bitbucketApi, type BitbucketApi } from '../../src/adapters/host/bitbucket-api.js';
import { slotsFile } from '../../src/adapters/slots/slots-file.js';
import type { PrListingQuery } from '../../src/ports/host.js';

/** The base URL the recorded `next` links name. */
export const RECORDED_BASE = 'https://api.bitbucket.org/2.0';

/** The workspace and repository the recorder's stub served. */
export const RECORDED_SLUG = 'plot-fixture/listing';

/** One page the recorder's stub served: the request path below the base, `{ws}` and `{repo}` unresolved, and the body. */
export interface BitbucketExchange {
  readonly path: string;
  readonly response: unknown;
}

/** One `bb` invocation `plot-host.sh` made and what `bb` printed. */
export interface BitbucketCall {
  readonly argv: readonly string[];
  readonly stdout: string;
}

/** One fixture `corpus/record-bitbucket-pr-listing.mjs` wrote. */
export interface BitbucketListingFixture {
  readonly name: string;
  readonly query: PrListingQuery;
  readonly args: readonly string[];
  readonly calls: readonly BitbucketCall[];
  readonly exchanges: readonly BitbucketExchange[];
}

/** Where the recorder writes its fixtures. */
export const BITBUCKET_LISTING_FIXTURES = new URL('../../corpus/fixtures/bitbucket-pr-listing', import.meta.url).pathname;

/** Reads every recorded listing fixture, by name. */
export const readBitbucketFixtures = (): BitbucketListingFixture[] =>
  readdirSync(BITBUCKET_LISTING_FIXTURES)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ name: file.replace(/\.json$/, ''), ...(JSON.parse(readFileSync(join(BITBUCKET_LISTING_FIXTURES, file), 'utf8')) as Omit<BitbucketListingFixture, 'name'>) }));

/** A request path with the recorded workspace and repository replaced by `{ws}` and `{repo}`. */
export const unresolved = (path: string): string => path.replace(`/repositories/${RECORDED_SLUG}/`, '/repositories/{ws}/{repo}/');

/** A request path with its percent-encoding undone, so two encodings of one query compare equal. */
export const decoded = (path: string): string => decodeURIComponent(path);

/** How the stub answers one request; null answers it from the recorded exchanges. */
export type BitbucketOverride = (path: string, index: number) => { status: number; body: unknown; headers?: Record<string, string> } | null;

/** A stub Bitbucket API on 127.0.0.1 under `/2.0`. */
export interface BitbucketReplay {
  /** The base URL the client is pointed at, ending in `/2.0`. */
  readonly base: string;
  /** The request paths the client sent, `{ws}` and `{repo}` unresolved, in order. */
  readonly sent: string[];
  close(): Promise<void>;
}

/**
 * Starts a stub Bitbucket API that answers each request with the recorded
 * response for the same path. The recorded base in a response's `next` link
 * is rewritten to the stub's own. A path no exchange recorded answers HTTP 500.
 *
 * @param exchanges - the recorded exchanges.
 * @param override - answers a request before the recording does.
 * @returns the stub.
 */
export const startBitbucketReplay = async (exchanges: readonly BitbucketExchange[], override: BitbucketOverride = () => null): Promise<BitbucketReplay> => {
  const sent: string[] = [];
  let base = '';
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const reply = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      const path = unresolved((req.url ?? '').replace(/^\/2\.0/, ''));
      sent.push(path);
      const forced = override(path, sent.length - 1);
      if (forced !== null) return reply(forced.status, forced.body, forced.headers);
      const hit = exchanges.find((one) => decoded(one.path) === decoded(path));
      if (hit === undefined) return reply(500, { message: 'unrecorded request' });
      return reply(200, JSON.parse(JSON.stringify(hit.response).replaceAll(RECORDED_BASE, base)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/2.0`;
  return {
    base,
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
 * temp directory, and a fixture credential.
 *
 * @param base - the stub's base URL.
 * @returns the client and the call that removes its temp directory.
 */
export const bitbucketReplayClient = (base: string): { api: BitbucketApi; cleanup: () => void } => {
  const home = mkdtempSync(join(tmpdir(), 'plot-bitbucket-replay-'));
  const api = bitbucketApi({
    origin: `git@bitbucket.org:${RECORDED_SLUG}.git`,
    env: { BITBUCKET_API_BASE: base, BB_EMAIL: 'fixture@example.test', BB_TOKEN: 'fixture' },
    budget: budgetFile({ home }),
    slots: slotsFile({ home, isAlive: () => true }),
  });
  return { api, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

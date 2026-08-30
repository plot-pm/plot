import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario, type Scenario, type ScenarioName } from './states.js';

/**
 * THE MOCK BOARD — it serves a named state, and it is NOT the board.
 *
 * ## What it is
 *
 * An `http.createServer` of a few dozen lines that answers three things:
 *
 *   GET /            → `dist/client/index.html`, the real built client
 *   GET /api/board   → the named scenario's board payload
 *   GET /api/fleet   → the named scenario's fleet payload
 *
 * and 404s everything else. No refresh timer, no estate scan, no git, no
 * `board-server.mjs`.
 *
 * ## Why it is a SERVER at all, when the precedent is not
 *
 * `tuple-row.browser.test.ts` is the only test in this suite that already starts
 * no server: it bundles a component with `esbuild`, calls
 * `page.setContent('<div id="root"></div>')` and mounts it. That is the cheaper
 * shape and it was read first, because a migration with a working example beside
 * it should start from the example.
 *
 * It does not carry this subject, and the reason is a difference in what is
 * under test rather than a preference:
 *
 *   - `tuple-row` mounts ONE COMPONENT and hands it its data as props. It never
 *     fetches, so it needs no origin and `setContent` costs it nothing.
 *   - The board's client FETCHES. `App.tsx` polls `/api/board` and `/api/fleet`
 *     on relative URLs and reads `location.search` for `?tab=agents`. Under
 *     `setContent` the page's origin is `about:blank`: a relative fetch has no
 *     base to resolve against, `page.route('**\/api/*')` has no request to
 *     intercept, and the query string the tab selection reads cannot be set.
 *
 * So the departure is that the subject here IS a fetching, routing application,
 * and stubbing that away would test the renderer while leaving untested the
 * three behaviours — relative resolution, same-origin, query routing — that only
 * a real origin exercises. The plan says the same in one line ("the mock keeps
 * the transport honest"); this is the comparison behind it.
 *
 * What the two shapes share is the thing that matters: neither starts the board.
 *
 * ## What it must never become
 *
 * It must never import `board-server.mjs`, and "reuse the artifact, pointed at a
 * fixture" is the shortcut it exists to refuse — that reintroduces the refresh
 * timer and the 115 git processes per scan the whole plan is about. The
 * constraint is asserted by grep in `mock-board.test.ts` rather than left to
 * this comment.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The real built client, read from disk once per process.
 *
 * The BUILT artifact rather than the source, because the thing under test is
 * what the board actually serves: `vite-plugin-singlefile` inlines every script
 * and style into this one file, and a bug in that inlining is a bug a test
 * against source could not see. It is the same file `src/server/index.ts`
 * imports and `res.end()`s.
 */
const CLIENT_HTML = path.resolve(here, '../../dist/client/index.html');

let cachedHtml: string | null = null;

const clientHtml = (): string => {
  if (cachedHtml !== null) return cachedHtml;
  if (!fs.existsSync(CLIENT_HTML)) {
    throw new Error(
      `Missing ${CLIENT_HTML} — run \`pnpm build:board\` before the browser tests. `
      + 'The mock serves the BUILT client, so a stale or absent artifact fails here '
      + 'rather than in a locator timeout thirty seconds later.',
    );
  }
  cachedHtml = fs.readFileSync(CLIENT_HTML, 'utf8');
  return cachedHtml;
};

/** What a started mock hands back — the shape `startServer` returns, so a test swaps one line. */
export interface MockBoard {
  /** The OS-assigned port this mock is listening on. */
  port: number;
  /** `http://localhost:<port>/` — what a test navigates to. */
  baseURL: string;
  /** Serve a different state from now on, without restarting. */
  serve: (name: ScenarioName, over?: Partial<Scenario>) => void;
  /** Stop listening. Resolves once the server is closed. */
  stop: () => Promise<void>;
  /** Synchronous stop, for an `afterAll` that does not await. */
  kill: () => void;
}

const json = (res: http.ServerResponse, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // The board is a local tool and the client polls; a cached payload would
    // make `serve()` silently ineffective for the rest of a test.
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

/**
 * Start a mock board serving one named state.
 *
 * `PORT: 0` in spirit — `listen(0)` lets the OS assign during the bind itself,
 * so there is no window in which a port is known-free but unbound. The helper
 * this mirrors (`startServer`) documents the race that motivated it; binding
 * zero directly is the same fix with no readiness line to parse.
 */
export const startMockBoard = async (
  name: ScenarioName,
  over: Partial<Scenario> = {},
): Promise<MockBoard> => {
  let current = scenario(name, over);
  // Read the client BEFORE listening, so a missing artifact fails with the
  // message above rather than as a blank page in a browser.
  const html = clientHtml();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/board') return json(res, current.board);
    if (url.pathname === '/api/fleet') return json(res, current.fleet);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    // Everything else 404s, LOUDLY rather than with an empty 200. A test whose
    // subject needs an endpoint this mock does not serve should fail saying so,
    // not render half a page and time out on a locator.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`mock board serves / and /api/{board,fleet} only — not ${url.pathname}`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock board did not bind a TCP port');
  }
  const { port } = address;

  return {
    port,
    baseURL: `http://localhost:${port}/`,
    serve: (next, nextOver) => { current = scenario(next, nextOver); },
    stop: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
    kill: () => { server.close(); },
  };
};

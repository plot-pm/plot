import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard, renderPlanPage, type BuildBoardOptions } from './board.js';
import { buildFleet } from './fleet.js';
import { dispatchAvailability, handleDispatch } from './dispatch.js';
// Inlined at build time by esbuild's text loader — the artifact is a single
// self-contained file, served from memory (no filesystem static serving, so no
// path-traversal surface).
import clientHtml from '../../dist/client/index.html';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The port to ASK for — not necessarily the one served. `PORT=0` asks the OS to
 * assign one during `listen()`, which is the only way to get a port that is
 * bound the instant it is known. The default stays 7777 on purpose: a dev board
 * on a random address is not bookmarkable, and `pnpm board` would land somewhere
 * new every time.
 */
const REQUESTED_PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? 'localhost';

/**
 * The port actually bound, known only inside the `listen` callback. Everything
 * that needs to NAME this server's address reads this — never REQUESTED_PORT,
 * which under `PORT=0` is the literal 0 and would make the /api/dispatch
 * same-origin allowlist read `http://localhost:0` and refuse every browser.
 */
let boundPort = REQUESTED_PORT;

/**
 * Plans come from the current repo (CWD); helper scripts ship next to this
 * artifact (skills/plot/scripts/board/board-server.mjs → ../ = the scripts
 * dir). Both are overridable for dev and tests.
 */
const opts: BuildBoardOptions = {
  repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
  scriptsDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
};

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${HOST}:${boundPort}`);

  // Allow-listed AHEAD of the blanket 405 below, rather than by weakening it.
  // Per-route method checks would be the more conventional shape, and are
  // rejected for the reason this repo rejects prose MUSTs: a check every future
  // route has to remember is a rule, while a default that refuses is a gate.
  // Exactly one path-and-verb pair slips past; /api/board, /api/fleet and
  // /plan/* stay protected precisely as they are today.
  if (url.pathname === '/api/dispatch' && req.method === 'POST') {
    // `boundPort`, not the requested one: under PORT=0 they differ, and this
    // port is the same-origin allowlist for the endpoint that spawns processes.
    void handleDispatch(req, res, { ...opts, host: HOST, port: boundPort }).catch((err) => {
      console.error('Error dispatching:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    });
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  if (url.pathname === '/api/board') {
    try {
      // Whether Start work will act is a fact about this SERVER's binding, not
      // about any plan, so it is attached here — where the binding is known —
      // rather than threaded through the plan walker.
      const board = { ...buildBoard(opts), dispatch: dispatchAvailability(HOST) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(board));
    } catch (err) {
      // The board depends on `bash` + Plot's helper scripts. If either is
      // missing we surface a clear error rather than silently forking a second
      // parser.
      console.error('Error building board:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/fleet') {
    // Reads a cache the server refreshes on its own timer — never runs the
    // scan inline. A 1.05 s synchronous scan on a 4 s poll would block this
    // single-threaded server roughly a quarter of the time.
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildFleet(opts)));
    } catch (err) {
      console.error('Error building fleet:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url.pathname.startsWith('/plan/')) {
    // The modal embeds the plan with ?embed=1 to drop the back-to-board
    // titlebar; the plain new-tab / direct-URL view keeps it.
    const embed = url.searchParams.get('embed') === '1';
    try {
      // decodeURIComponent throws URIError on a malformed % escape (e.g.
      // /plan/%E0%A4%A). Decode INSIDE the try so a bad request is a 400 — not
      // an uncaught throw in the request listener that crashes the process (DoS).
      // `<filename>` is a plan basename; renderPlanPage resolves it against the
      // board's own plan allowlist, so traversal (../) can't escape the plan dir.
      const filename = decodeURIComponent(url.pathname.slice('/plan/'.length));
      const html = renderPlanPage(opts, filename, { embed });
      if (html === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Plan not found');
        return;
      }
      // Rendered markdown is static — no script should ever run. `marked` does
      // not sanitize raw HTML, so a plan carrying <script> or inline handlers
      // would otherwise execute in the full-page view (the modal iframe is
      // sandboxed, but the direct /plan page is not). CSP blocks that.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "script-src 'none'",
      });
      res.end(html);
    } catch (err) {
      if (err instanceof URIError) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
      }
      console.error('Error rendering plan:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error rendering plan');
    }
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(clientHtml);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

const server = http.createServer(handleRequest);

/**
 * The failed bind IS the check.
 *
 * Asking beforehand whether the port is free would rebuild the very race this
 * server was changed to remove: between the answer and the `listen()` the port
 * belongs to nobody. `EADDRINUSE` is the OS answering the same question at the
 * only moment it cannot go stale — and a second `pnpm board` then names the
 * running one and exits 0 rather than dying with a stack trace that says a port
 * is taken without saying by what, or where to go instead.
 *
 * It reports and stops; it never kills the running board. Several worktrees run
 * side by side, and a `pnpm board` in one terminal shooting down another's is a
 * worse failure than the one being fixed.
 */
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Plot board already running at http://localhost:${REQUESTED_PORT}`);
    process.exit(0);
  }
  throw err;
});

server.listen(REQUESTED_PORT, HOST, () => {
  // Read the port from the server rather than from the constant: with PORT=0
  // the OS assigned it during this very listen, and nothing else knows it.
  const addr = server.address();
  if (addr && typeof addr === 'object') boundPort = addr.port;
  console.log(`Plot board: http://localhost:${boundPort}`);
  if (HOST === '0.0.0.0') {
    try {
      const tsIp = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim();
      if (tsIp) console.log(`  tailscale:  http://${tsIp}:${boundPort}`);
    } catch {
      /* tailscale not running or not installed */
    }
  }
});

import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard, renderPlanPage, renderStoryPage, type BuildBoardOptions } from './board.js';
import { buildFleet } from './fleet.js';
import { buildAttention } from './attention.js';
import { dispatchAvailability, handleDispatch, SLUG_RE } from './dispatch.js';
import { agentPanel } from './agent-panel.js';
import { workerLog } from './worker-log.js';
import { serverInfo } from './server-info.js';
import { exitWithParent } from './lifetime.js';
import {
  approveAvailability,
  approveStatus,
  handleApprove,
} from './approve.js';
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

/**
 * The markdown-viewer routes, which differ ONLY in which allowlist they consult.
 *
 * Everything else — the decode, the try/catch that turns a URIError into a 400
 * rather than a process exit, the 404, the CSP, `?embed=1` — is one code path
 * below. A table rather than two `if` blocks, because the shape of the table is
 * the claim: adding a third viewer must be a line here, never a second copy of
 * the handling.
 */
const MARKDOWN_ROUTES = [
  { prefix: '/plan/', label: 'Plan', render: renderPlanPage },
  { prefix: '/story/', label: 'Story', render: renderStoryPage },
] as const;

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${HOST}:${boundPort}`);

  // Allow-listed AHEAD of the blanket 405 below, rather than by weakening it.
  // Per-route method checks would be the more conventional shape, and are
  // rejected for the reason this repo rejects prose MUSTs: a check every future
  // route has to remember is a rule, while a default that refuses is a gate.
  // Two path-and-verb pairs slip past now rather than one; /api/board,
  // /api/fleet and /plan/* stay protected precisely as they are today.
  if (url.pathname === '/api/approve' && req.method === 'POST') {
    void handleApprove(req, res, { ...opts, host: HOST, port: boundPort }).catch((err) => {
      console.error('Error approving:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    });
    return;
  }

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
      // rather than threaded through the plan walker. `server` rides along for
      // the same reason and needs the same fact: how to start this board again
      // and where it listens, carried on the last successful poll so the page
      // still holds it once nothing is answering.
      const board = {
        ...buildBoard(opts),
        dispatch: dispatchAvailability(HOST),
        server: serverInfo(opts, boundPort),
        // Its own field, and now the SAME answer as dispatch: both scripts ship
        // with Plot, so both controls ask one question — is this a local,
        // same-origin request. It stays a separate field rather than collapsing
        // into `dispatch` because it is a separate capability, and the client
        // asking one flag about two of them is how they diverged before.
        approve: approveAvailability(HOST),
      };
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

  if (url.pathname === '/api/attention') {
    // Reads the same cache `/api/fleet` does, through `buildFleet` — never its
    // own scan, and never the raw pulse. Both halves of that matter: the cache
    // is what keeps a 1.05 s scan off this single-threaded server, and building
    // on the ROWS is what lets a caller audit these verdicts against
    // `/api/fleet` without running anything.
    //
    // A GET beside the other two reads, above the blanket 405 by virtue of
    // being one: this endpoint names candidates and reserves nothing. Claiming
    // is `/api/claim` and starting is `/api/dispatch`, both deliberately
    // separate — an agent asking what is available has not yet committed to
    // doing it, and conflating the two would make a survey a mutation.
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildAttention(opts)));
    } catch (err) {
      console.error('Error building attention:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // A running worker's own console output, on demand.
  //
  // **Served here and pushed nowhere.** The pulse carries not one byte of this,
  // and that is the point of the wave rather than an optimisation: a 4 s poll
  // shipping every agent's console output to every open tab is a different
  // product, and one nobody asked for. The row offers the log; this answers when
  // a person asks.
  //
  // THE BRANCH IS THE PARAMETER, AND THE PATH IS NEVER ONE. A request naming a
  // file would be a read primitive aimed at the whole filesystem, dressed as a
  // board feature. `workerLog` resolves the branch against the worktrees the
  // PULSE reported and reads a constant filename inside the answer — so a branch
  // this machine does not hold is a 404 rather than a read attempt, and no
  // request text ever becomes a path segment.
  //
  // A QUERY parameter rather than a path segment, unlike `/api/approve/<slug>`
  // one route down. Branch names contain slashes — `feature/x` is the normal
  // case — so a path segment would either need encoding every caller must
  // remember or a greedy suffix match that cannot say where the branch ends.
  // `?branch=` carries the name whole and `URLSearchParams` has already decoded
  // it. The slug route stays as it is: a slug has no slashes to lose.
  if (url.pathname === '/api/worker-log') {
    const branch = url.searchParams.get('branch');
    if (!branch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch is required' }));
      return;
    }
    try {
      const log = workerLog(opts, branch);
      // 404 for `no-worktree`, 200 for everything else the read can say.
      //
      // The split is between *this machine cannot answer for that branch* and
      // *here is the answer*, NOT between good and bad news. A worktree with no
      // log is a successful observation — the branch is here and no worker has
      // written — and a 404 would tell the client to stop asking about a row it
      // should keep offering. `reason` carries the three-way distinction in the
      // body, where a client can render each differently; the status code only
      // says whether this server had anything to look at.
      const status = !log.ok && log.reason === 'no-worktree' ? 404 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(log));
    } catch (err) {
      console.error('Error reading worker log:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // GET /api/agent-panel?branch=… — what one WORKING row can say about its agent.
  //
  // A SECOND on-demand route rather than new fields on the row, and the choice
  // is the wave's central one. The panel wants pid, uptime, worktree, command
  // and the transcript's model and context — per-agent facts that would
  // otherwise ride the 4 s pulse to every open tab whether or not anyone had a
  // panel open. `/api/worker-log` established the pattern for exactly this
  // reason and this follows it: the row asks, the server assembles.
  //
  // The branch is resolved against the worktrees the PULSE reported — the same
  // lookup-not-validator boundary `/api/worker-log` documents — so no request
  // text ever becomes a path segment, and a branch this machine does not hold
  // is an answer rather than a read attempt.
  if (url.pathname === '/api/agent-panel') {
    const branch = url.searchParams.get('branch');
    if (!branch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch is required' }));
      return;
    }
    try {
      const panel = agentPanel(opts, branch);
      // 404 only for a branch this server cannot answer for, matching
      // /api/worker-log: the status says whether there was anything to look at,
      // and `reason` carries the distinction the client renders.
      res.writeHead(panel.ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(panel));
    } catch (err) {
      console.error('Error building agent panel:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // How the approve command's own words reach the card that asked for them.
  //
  // A separate READ because the POST cannot carry the answer: the command is
  // spawned detached and the 202 is written before it has finished — the same
  // constraint /api/dispatch documents. Start work resolves that by watching
  // the row move, which works because a dispatch CHANGES the board. A refused
  // approval changes nothing at all, so there is no row to watch and the reason
  // has to be fetched.
  //
  // A slug, validated by the same expression the POST uses — it is a filename
  // component here, and `../` must reach no log but the one it names.
  if (url.pathname.startsWith('/api/approve/')) {
    const slug = url.pathname.slice('/api/approve/'.length);
    res.writeHead(SLUG_RE.test(slug) ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(
      SLUG_RE.test(slug)
        ? JSON.stringify(approveStatus(opts, slug))
        : JSON.stringify({ error: 'slug must be a plan slug' }),
    );
    return;
  }

  // `/plan/<file>` and `/story/<slug>` are ONE route with two allowlists.
  //
  // They were very nearly two, and the second copy would have been the
  // dangerous one. Traversal is the obvious attack and an allowlist-based
  // resolver is the obvious defence, so a fresh route gets that right; the
  // second attack is a single line and easy to miss — `decodeURIComponent`
  // THROWS a URIError on a malformed `%` escape, and an uncaught throw in a
  // request listener takes the whole single-process server down. One malformed
  // URL, no board. Sharing the handler means neither route can lose that.
  const markdownRoute = MARKDOWN_ROUTES.find((r) => url.pathname.startsWith(r.prefix));
  if (markdownRoute) {
    // The modal embeds the document with ?embed=1 to drop the back-to-board
    // titlebar; the plain new-tab / direct-URL view keeps it.
    const embed = url.searchParams.get('embed') === '1';
    try {
      // Decode INSIDE the try — see above. A bad request is a 400, never a
      // crash. The decoded name is resolved against the board's OWN collected
      // documents (plan basenames / story slugs), so traversal (`../`) cannot
      // escape the configured directory: it simply matches no entry and 404s.
      const name = decodeURIComponent(url.pathname.slice(markdownRoute.prefix.length));
      const html = markdownRoute.render(opts, name, { embed });
      if (html === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`${markdownRoute.label} not found`);
        return;
      }
      // Rendered markdown is static — no script should ever run. `marked` does
      // not sanitize raw HTML, so a document carrying <script> or inline
      // handlers would otherwise execute in the full-page view (the modal
      // iframe is sandboxed, but the direct page is not). CSP blocks that.
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
      console.error(`Error rendering ${markdownRoute.label.toLowerCase()}:`, err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error rendering ${markdownRoute.label.toLowerCase()}`);
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

/**
 * Armed BEFORE `listen()`, not inside its callback: a server whose launcher
 * dies during startup is the same orphan as one whose launcher dies later, and
 * a gate that only covers the running server would leave the narrower case
 * open. Does nothing unless `PLOT_EXIT_WITH_PARENT` is set — see lifetime.ts
 * for why the gate is an explicit variable and not the ppid change itself.
 */
exitWithParent();

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

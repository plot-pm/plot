import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBoard, renderPlanPage, type BuildBoardOptions } from './board.js';
// Inlined at build time by esbuild's text loader — the artifact is a single
// self-contained file, served from memory (no filesystem static serving, so no
// path-traversal surface).
import clientHtml from '../../dist/client/index.html';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 7777);
const HOST = process.env.HOST ?? 'localhost';

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
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

  if (url.pathname === '/api/board') {
    try {
      const board = buildBoard(opts);
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

  if (url.pathname.startsWith('/plan/')) {
    // `<filename>` is a plan basename; renderPlanPage resolves it against the
    // board's own plan allowlist, so traversal (../) can't escape the plan dir.
    const filename = decodeURIComponent(url.pathname.slice('/plan/'.length));
    // The modal embeds the plan with ?embed=1 to drop the back-to-board
    // titlebar; the plain new-tab / direct-URL view keeps it.
    const embed = url.searchParams.get('embed') === '1';
    try {
      const html = renderPlanPage(opts, filename, { embed });
      if (html === null) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Plan not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
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
server.listen(PORT, HOST, () => {
  console.log(`Plot board: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    try {
      const tsIp = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim();
      if (tsIp) console.log(`  tailscale:  http://${tsIp}:${PORT}`);
    } catch {
      /* tailscale not running or not installed */
    }
  }
});

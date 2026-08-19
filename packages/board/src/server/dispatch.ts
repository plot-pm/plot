import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { BuildBoardOptions } from './board.js';

/**
 * The board's ONE state-changing route.
 *
 * Everything else this server does is a read. `POST /api/dispatch` is a change
 * in kind rather than degree, which is why the conditions under which it exists
 * are designed rather than added:
 *
 *   - It runs `plot-dispatch.sh`, and DECIDES NOTHING itself. Which branch,
 *     whether the wave is open, whether the phase gate allows it, whether the
 *     claim wins its race — all of that lives in the script and its own chain.
 *     The board expresses an intent about a plan; it cannot bypass a rule it
 *     never evaluates.
 *   - It exists only while the server is bound to localhost. Whoever reaches
 *     localhost:7777 is sitting at the machine that owns the worktrees; that IS
 *     the permission, and it needs no token to express.
 *   - It requires the request to have come from the board's own page. The
 *     binding answers *reachability*, and a browser is not a network question:
 *     any site the user visits can POST to localhost, and the worktree exists
 *     and the claim is pushed before the attacker's unreadable response is
 *     written. Textual CSRF — the one hole the binding argument cannot cover.
 */

/** `--max 1`: a button is ONE decision. Fanning out a wave stays with /plot-dispatch. */
const MAX_PER_CLICK = '1';

export interface DispatchOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act at all, and why not — the same answer the button
 * needs BEFORE it is clicked. A control that looks live and 403s on click is a
 * worse answer than one that says up front what it cannot do.
 */
export interface DispatchAvailability {
  available: boolean;
  /** Empty when available; a human sentence otherwise. */
  reason: string;
}

/**
 * Loopback only. `0.0.0.0` (what the fleet user test uses to reach the board
 * over Tailscale) is deliberately NOT localhost: it is reachable from the
 * network, and "sitting at this machine" stops being true the moment it is.
 *
 * This is a refusal to invent an auth scheme, not an oversight. A hand-rolled
 * token in a URL would look like security while being a shared secret in shell
 * history. When the board legitimately needs to act over a network, that is a
 * plan with an auth design in it — not a flag.
 */
export function dispatchAvailability(host: string): DispatchAvailability {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — starting work is available only on the machine that owns the worktrees`,
  };
}

/**
 * Did this request come from the board's own page?
 *
 * Both headers are set by the browser and cannot be forged by page JavaScript,
 * which is exactly why they are worth checking and a token is not. Absent
 * headers pass: a non-browser caller (curl, a test) sends neither, and it was
 * never the browser's cross-site behaviour that this guards against.
 */
export function isSameOrigin(req: http.IncomingMessage, port: number): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const allowed = [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
    ];
    if (!allowed.includes(origin)) return false;
  }
  return true;
}

/**
 * Read a JSON request body, bounded — this route takes one short field.
 *
 * Shared with `/api/approve` rather than copied. Both take the same one-field
 * body, and a second implementation would be a second place for the bound to be
 * forgotten.
 */
export function readJsonBody(req: http.IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * A plan slug, as `plot-dispatch.sh` will use it to find a plan file. Rejected
 * rather than sanitized: the slug reaches a script that globs with it, and a
 * value that is not a slug is a caller bug, not something to repair silently.
 */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Where the script's own words go. Chosen BEFORE spawning and keyed by SLUG,
 * because the server cannot know the branch: `--max 1` asks `--next` at runtime
 * which branch is eligible, and the worktree path derives from that answer.
 * `<repo>/../plot-dispatch-<slug>.log` is knowable at 202 time;
 * `<worktree>/.plot-worker.log` is not. Both exist and neither replaces the
 * other — the first records what the dispatcher did, the second what the agent
 * is doing.
 */
export function dispatchLogPath(repoRoot: string, slug: string): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-dispatch-${slug}.log`);
}

/**
 * Handle `POST /api/dispatch`. Refuses, or spawns and answers 202 — never both,
 * and never a result: see below.
 */
export async function handleDispatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: DispatchOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // The loopback boundary is NOT checked here any more — it is enforced in the
  // router, ahead of every write route, by `write-gate.ts`.
  //
  // This handler checked it itself until 2026-08-19, and the check was correct
  // and insufficient in the same way: correct for this route, and silent about
  // the four beside it. Worse, once the gate grew a named opt-in, a surviving
  // copy here would have honoured a DIFFERENT policy — the opt-in would open
  // /api/claim and be refused at /api/dispatch, so one variable would mean two
  // things depending on which route read it. That is the exact failure
  // `approve.ts` records for capability flags: one answer to two questions is
  // how they diverge without anyone noticing.
  //
  // `dispatchAvailability` itself stays, and is still the source the gate reads
  // — and still answers `/api/board`'s capability flags, which is a different
  // question (will this BUTTON act) asked at a different time.
  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  const log = dispatchLogPath(opts.repoRoot, slug);
  let out: number;
  try {
    out = fs.openSync(log, 'a');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Spawn DETACHED and answer immediately. A dispatch creates a worktree and
  // pushes a claim — a network write, strictly slower than the 0.5–1.05 s scan
  // that already forced the fleet cache to exist on this single-threaded
  // server. Awaiting the script would freeze every viewer's board for the
  // duration of someone else's click.
  //
  // So the response CANNOT carry a result: the script's summary line only
  // exists once the run has finished. That is not a gap to paper over — it is
  // the same shape as start_worker's own detached spawn, and it is why the row
  // moving is the answer rather than the reply being one.
  const child = spawn(
    'bash',
    [path.join(opts.scriptsDir, 'plot-dispatch.sh'), '--max', MAX_PER_CLICK, slug],
    { cwd: opts.repoRoot, detached: true, stdio: ['ignore', out, out] },
  );
  child.on('error', (err) => console.error('dispatch failed to spawn:', err));
  child.unref();
  fs.closeSync(out);

  json(202, { slug, log });
}

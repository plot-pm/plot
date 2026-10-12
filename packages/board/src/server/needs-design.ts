import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import type { Detached } from '@plot-pm/domain';
import { agentLogPath } from './agent-log.js';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';

/** The bundle the route starts, relative to the scripts directory. */
export const NEEDS_DESIGN_BUNDLE = 'board/plot-needs-design.mjs';

/** What the route needs of the server. */
export interface NeedsDesignOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
  /** Starts the bundle; the default runs a real detached `node` process. */
  detached?: Detached;
}

/** Where the bundle's output goes, keyed by slug beside the other routes' logs. */
export const needsDesignLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'needs-design', slug, 'log');

/**
 * Handles `POST /api/needs-design`.
 *
 * Starts `plot-needs-design.mjs <slug> --channel board [--who <name>]` detached
 * and answers 202 with the log path, because the bundle can push to the host and
 * the server answers no other viewer while it waits. `--channel board` makes the
 * bundle record `board` as the move's channel. The route spawns nothing itself: the
 * `Detached` port starts the bundle, which inherits the board's environment and
 * refuses a run under `PLOT_UNATTENDED=1` on its own.
 *
 * Answers 403 for a cross-origin request, 400 for a body without a valid slug
 * and 500 where the log cannot be opened or the bundle cannot start.
 *
 * @param req - the request.
 * @param res - the response.
 * @param opts - the server options; `detached` is replaceable in tests.
 */
export const handleNeedsDesign = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: NeedsDesignOptions,
): Promise<void> => {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

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
  const whoRaw = (body as { who?: unknown })?.who;
  const who = typeof whoRaw === 'string' ? whoRaw.trim() : '';

  const log = needsDesignLogPath(opts.repoRoot, slug);
  const script = path.join(opts.scriptsDir, NEEDS_DESIGN_BUNDLE);
  const args = [slug, '--channel', 'board', ...(who ? ['--who', who] : [])];
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    (opts.detached ?? detachedNode()).node(script, args, opts.repoRoot, log);
  } catch (err) {
    json(500, { error: `cannot start ${NEEDS_DESIGN_BUNDLE}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  json(202, { slug, log });
};

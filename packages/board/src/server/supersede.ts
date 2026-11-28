import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import {
  supersedePlan,
  supersessionContext,
  type Context,
  type SupersedeRefusalReason,
} from './entry/supersession.js';

/** What the route needs of the server. */
export interface SupersedeOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
  /** The supersession's ports; the real adapters over `repoRoot` where absent. */
  context?: Context;
  /** The environment the supersession reads `PLOT_UNATTENDED` from; `process.env` where absent. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The HTTP status for a supersession refusal: 403 for an unattended board,
 * 404 for a slug that names no plan, 409 for a plan whose state refuses,
 * 422 for a successor the domain refuses or a plan that does not parse, and
 * 500 for a write, booking or push that did not complete.
 *
 * @param reason - the refusal's reason.
 * @returns the status code.
 */
export const refusalStatus = (reason: SupersedeRefusalReason): number => {
  switch (reason) {
    case 'unattended':
      return 403;
    case 'plan-not-found':
      return 404;
    case 'state-terminal':
    case 'state-wrong':
    case 'state-unreadable':
    case 'state-too-early':
      return 409;
    case 'push-rejected':
    case 'failed':
      return 500;
    default:
      return 422;
  }
};

/**
 * Handles `POST /api/supersede {"slug":"<slug>","by":"<successor>"}`, where
 * the successor is a slug or `owner/repo:slug`.
 *
 * Runs `supersedePlan` in this process with `by` trimmed, and waits for it:
 * the booking push is part of the answer. The controller parses `by`, so a
 * string that names neither form answers 422 `successor-unparsed`. Answers 200
 * with the `summary:` line where the plan is Superseded, and the refusal's
 * status from {@link refusalStatus} with `{ reason, error }` otherwise.
 * Answers 403 for a cross-origin request, and 400 for a body whose `slug` is
 * not a plan slug or whose `by` is not a string.
 *
 * @param req - the request.
 * @param res - the response.
 * @param opts - the server options; `context` and `env` are replaceable in tests.
 */
export const handleSupersede = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SupersedeOptions,
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
  const by = (body as { by?: unknown })?.by;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }
  if (typeof by !== 'string') {
    json(400, { error: "by must name the successor plan: a slug, or 'owner/repo:slug'" });
    return;
  }
  const whoRaw = (body as { who?: unknown })?.who;
  const who = typeof whoRaw === 'string' ? whoRaw.trim() : '';

  const steps: string[] = [];
  const outcome = await supersedePlan(
    opts.context ?? supersessionContext(opts.repoRoot, opts.scriptsDir),
    { slug, by: by.trim(), who },
    (line) => steps.push(line),
    opts.env ?? process.env,
  );
  if (outcome.outcome === 'superseded') {
    json(200, { slug, by: by.trim(), summary: outcome.summary, steps: steps.join('') });
    return;
  }
  json(refusalStatus(outcome.reason), { slug, by: by.trim(), reason: outcome.reason, error: outcome.detail });
};

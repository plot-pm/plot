import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { STORY_STATUS_SLUG } from '@plot-pm/domain/rules/story-status-edit';
import {
  setStoryStatusAt,
  storyStatusContext,
  type Context,
  type StoryStatusRefusalReason,
} from './entry/story-status-move.js';

/** What the route needs of the server. */
export interface StoryStatusOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
  /** The move's ports; the real adapters over `repoRoot` where absent. */
  context?: Context;
  /** The environment the move reads `PLOT_UNATTENDED` from; `process.env` where absent. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The HTTP status for a story status refusal: 403 for an unattended board,
 * 404 for a slug that names no story, 409 for a move the domain refuses,
 * 422 for an invalid slug, an unknown status or a story that does not parse,
 * and 500 for a write, booking or push that did not complete.
 *
 * @param reason - the refusal's reason.
 * @returns the status code.
 */
export const refusalStatus = (reason: StoryStatusRefusalReason): number => {
  switch (reason) {
    case 'unattended':
      return 403;
    case 'story-not-found':
      return 404;
    case 'status-terminal':
    case 'status-unreachable':
    case 'status-unchanged':
    case 'precondition-unmet':
      return 409;
    case 'push-rejected':
    case 'failed':
      return 500;
    default:
      return 422;
  }
};

/**
 * Handles `POST /api/story-status {"slug":"<slug>","status":"<status>"}`.
 *
 * Runs `setStoryStatusAt` in this process and waits for it: the booking push
 * is part of the answer. Answers 200 with the `summary:` line where the story
 * holds the status, and the refusal's status from {@link refusalStatus} with
 * `{ reason, error }` otherwise. Answers 403 for a cross-origin request and
 * 400 for a body without a valid slug and a status string.
 *
 * @param req - the request.
 * @param res - the response.
 * @param opts - the server options; `context` and `env` are replaceable in tests.
 */
export const handleStoryStatus = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: StoryStatusOptions,
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
  const status = (body as { status?: unknown })?.status;
  if (typeof slug !== 'string' || !STORY_STATUS_SLUG.test(slug)) {
    json(400, { error: 'slug must be a story slug' });
    return;
  }
  if (typeof status !== 'string' || status.trim() === '') {
    json(400, { error: 'status must name the status to move to' });
    return;
  }
  const whoRaw = (body as { who?: unknown })?.who;
  const who = typeof whoRaw === 'string' ? whoRaw.trim() : '';

  const steps: string[] = [];
  const outcome = await setStoryStatusAt(
    opts.context ?? storyStatusContext(opts.repoRoot, opts.scriptsDir),
    { slug, status: status.trim(), who },
    (line) => steps.push(line),
    opts.env ?? process.env,
  );
  if (outcome.outcome === 'moved') {
    json(200, { slug, status: status.trim(), summary: outcome.summary, steps: steps.join('') });
    return;
  }
  json(refusalStatus(outcome.reason), { slug, status, reason: outcome.reason, error: outcome.detail });
};

import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { callerOf } from '@plot-pm/domain/workflows/decision';
import { versionFinishContextFor } from './entry/merge-ports.js';
import {
  finishReleaseVersion,
  releaseVersionArg,
  type FinishContext,
  type FinishOutcome,
} from './entry/release-finish.js';

/** What the route needs of the server. */
export interface ReleaseFinishOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
  /** The finish's ports; the real adapters over `repoRoot` where absent. */
  context?: FinishContext;
  /** The environment the caller is read from; `process.env` where absent. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The HTTP status for a finish refusal: 403 for an unattended caller, 409 for a
 * refusal the release's state decides, and 500 for a fetch, write or push that
 * did not complete.
 *
 * @param reason - the refusal's reason.
 * @returns the status code.
 */
export const releaseFinishStatus = (reason: string): number => {
  switch (reason) {
    case 'unattended':
      return 403;
    case 'default-branch-unfetched':
    case 'booking-unprepared':
    case 'push-rejected':
    case 'write-failed':
      return 500;
    default:
      return 409;
  }
};

/**
 * Handles `POST /api/release-finish {"version":"<N.N.N>"}`.
 *
 * Runs `finishReleaseVersion` in this process and waits for it: the booking
 * push is part of the answer. Answers 200 with `{ version, outcome, booked,
 * notes }` where the finish booked, and 200 with `outcome: 'already-released'`
 * where nothing remained. A refusal answers the status from
 * {@link releaseFinishStatus} with `{ version, reason, error }`. Answers 403 for
 * a cross-origin request and 400 for a body without an `N.N.N` version. No
 * passkey assertion is read.
 *
 * @param req - the request.
 * @param res - the response.
 * @param opts - the server options; `context` and `env` are replaceable in tests.
 */
export const handleReleaseFinish = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ReleaseFinishOptions,
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

  const version = (body as { version?: unknown })?.version;
  if (typeof version !== 'string' || releaseVersionArg(version) === null) {
    json(400, { error: 'version must be N.N.N or vN.N.N' });
    return;
  }

  const env = opts.env ?? process.env;
  const context = opts.context ?? versionFinishContextFor(opts, callerOf({ unattended: env.PLOT_UNATTENDED === '1' }));
  const steps: string[] = [];
  const outcome: FinishOutcome = await finishReleaseVersion(
    context,
    version,
    (line) => steps.push(line),
    (line) => steps.push(line),
  );
  switch (outcome.outcome) {
    case 'booked':
      json(200, { version: outcome.version, outcome: 'booked', booked: outcome.booked, notes: outcome.notes, steps: steps.join('') });
      return;
    case 'already-released':
      json(200, { version: outcome.version, outcome: 'already-released', booked: [], notes: [], detail: outcome.detail, steps: steps.join('') });
      return;
    case 'refused':
      json(releaseFinishStatus(outcome.reason), { version, reason: outcome.reason, error: outcome.detail });
  }
};

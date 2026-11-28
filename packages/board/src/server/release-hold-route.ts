import http from 'node:http';
import { callerOf } from '@plot-pm/domain/workflows/decision';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import {
  holdWho,
  releaseHoldAt,
  releaseHoldLiftAt,
  releaseHoldPortsFor,
  type ReleaseHoldResult,
} from './entry/release-hold.js';
import type { ReleaseHoldPorts } from '@plot-pm/domain/workflows/release-hold';

/** What the two hold routes need of the server. */
export interface ReleaseHoldOptions extends BuildBoardOptions {
  port: number;
  /** The hold's ports, whose caller the route reads from `env`; the real adapters over `repoRoot` where absent. */
  ports?: ReleaseHoldPorts;
  /** The environment the caller is read from; `process.env` where absent. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The HTTP status for a hold or lift refusal: 403 for an unattended caller,
 * 500 for a read or write that did not complete, and 409 otherwise.
 *
 * @param reason - the refusal's reason.
 * @returns the status code.
 */
export const releaseHoldStatus = (reason: string): number =>
  reason === 'unattended' ? 403 : reason === 'unaskable' ? 500 : 409;

const routeFor = (act: (ports: ReleaseHoldPorts, sha: string) => Promise<ReleaseHoldResult>) =>
  async (req: http.IncomingMessage, res: http.ServerResponse, opts: ReleaseHoldOptions): Promise<void> => {
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!isSameOrigin(req, opts.port)) return json(403, { error: 'cross-origin request refused' });
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : String(err) });
    }
    const { sha, who } = (body ?? {}) as { sha?: unknown; who?: unknown };
    if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
      return json(400, { error: 'sha must be a hex commit of 7 to 40 characters' });
    }
    const env = opts.env ?? process.env;
    const caller = callerOf({ unattended: env.PLOT_UNATTENDED === '1' });
    const ports = opts.ports === undefined
      ? await releaseHoldPortsFor(opts, caller, holdWho(typeof who === 'string' ? who : undefined))
      : { ...opts.ports, caller };
    const result = await act(ports, sha);
    json(result.ok ? 200 : releaseHoldStatus(result.reason), result);
  };

/**
 * Handles `POST /api/release-hold {"sha":"<release head>"}`.
 *
 * Runs `releaseHoldAt` in this process and answers 200 with the hold, or the
 * refusal with the status from {@link releaseHoldStatus}. Answers 403 for a
 * cross-origin request and 400 for a body without a hex `sha`.
 */
export const handleReleaseHold = routeFor(releaseHoldAt);

/**
 * Handles `POST /api/release-hold-lift {"sha":"<held head>"}`.
 *
 * Runs `releaseHoldLiftAt` in this process; answers as {@link handleReleaseHold}.
 */
export const handleReleaseHoldLift = routeFor(releaseHoldLiftAt);

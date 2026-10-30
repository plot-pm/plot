import http from 'node:http';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { pulseFor } from './fleet.js';
import type { FleetReading } from '../contract/schema.js';
import { localCapability } from './controllers/caller.js';
import type { DeskMonitors } from '@plot-pm/domain';
import { restartBranch, type RestartReaders } from '@plot-pm/fleet/shared/restart-command';
import { BODY_LIMIT, type ContinueRefusal } from '@plot-pm/fleet/shared/continuation';

/** What the board listens on; the same shape `handleContinue` takes. */
export interface RestartOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/** The readings this route takes from outside itself; a test replaces each. */
export interface RestartDeps {
  /** The cached pulse the branch → worktree lookup comes from. */
  pulse?: (opts: BuildBoardOptions) => FleetReading | null;
  /** The configured `Worker command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** Starts the desk's monitor; the shell script under `scriptsDir` where absent. */
  monitors?: DeskMonitors;
  /** The pull-request and process readings; the adapters where absent. */
  readers?: RestartReaders;
}

/**
 * Handles `POST /api/restart {"branch":"<branch>"}`.
 *
 * Refuses a cross-origin request with 403 and a missing branch with 400. Every
 * other refusal is the one `restartBranch` names, answered as
 * `{ ok: false, branch, reason, detail }`. A restart that starts answers 202
 * with the new `pid`, the `previousPid` it replaces and the worker's `log`.
 */
export const handleRestart = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: RestartOptions,
  deps: RestartDeps = {},
): Promise<void> => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req, BODY_LIMIT);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const branch = (body as { branch?: unknown })?.branch;
  if (typeof branch !== 'string' || branch === '') {
    json(400, { error: 'branch is required' });
    return;
  }
  const started = await restartBranch({
    opts,
    readCfg: deps.config ?? readConfig,
    pulse: (deps.pulse ?? pulseFor)(opts),
    branch,
    // No in-process fleetd caller reaches this entrance yet — `PLOT_UNATTENDED`
    // maps to 'unattended', never to 'fleetd'.
    caller: process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person',
    monitors: deps.monitors,
    readers: deps.readers,
  });
  if (started.kind === 'refused') {
    const reason: ContinueRefusal = started.reason;
    json(started.status, { ok: false, branch, reason, detail: started.detail });
    return;
  }
  if (started.kind === 'failed') {
    json(500, { error: started.error });
    return;
  }
  json(202, {
    ok: true,
    branch,
    pid: started.pid,
    previousPid: started.previousPid,
    log: started.log,
    warning: started.warning,
  });
};

/**
 * Whether restarting is available at all.
 *
 * Its own function, so the client holds a flag apart from `continue`'s.
 */
export const restartAvailability = (host: string): { available: boolean; reason: string } =>
  localCapability(host, 'restarting an agent', 'the worktrees');

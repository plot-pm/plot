import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { callerOf, type Caller } from '@plot-pm/domain/workflows/decision';
import { deleteLooseBranch, type LooseDeletePorts } from '@plot-pm/fleet/shared/loose-delete-command';
import { BODY_LIMIT } from '@plot-pm/fleet/shared/continuation';

/** What the board listens on; the same shape `handleRestart` takes. */
export interface LooseDeleteOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/** The ports this route takes from outside itself; a test replaces them. */
export interface LooseDeleteDeps {
  ports?: LooseDeletePorts;
  /** Who is asking; `PLOT_UNATTENDED=1` maps to `'unattended'` where absent. */
  caller?: Caller;
}

/**
 * Handles `POST /api/loose-delete {"branch":"<branch>"}`.
 *
 * Refuses a cross-origin request with 403 and a missing branch with 400. Every
 * other refusal is the one `deleteLooseBranch` names, answered as
 * `{ ok: false, branch, reason, detail }`. A delete that lands answers 200 with
 * the `tip` it pinned and the `pin` ref that restores it.
 */
export const handleLooseDelete = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: LooseDeleteOptions,
  deps: LooseDeleteDeps = {},
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
  const outcome = await deleteLooseBranch({
    repoRoot: opts.repoRoot,
    scriptsDir: opts.scriptsDir,
    branch,
    caller: deps.caller ?? callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' }),
    ports: deps.ports,
  });
  if (outcome.kind === 'refused') {
    json(outcome.status, { ok: false, branch, reason: outcome.reason, detail: outcome.detail });
    return;
  }
  if (outcome.kind === 'failed') {
    json(500, { error: outcome.error });
    return;
  }
  json(200, { ok: true, branch, tip: outcome.tip, pin: outcome.pin });
};

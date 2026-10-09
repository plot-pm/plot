import http from 'node:http';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { gatherReadingsAndRelease } from '@plot-pm/fleet/shared/release-claim-reader';

/**
 * `POST /api/release-claim` — release a branch's claim: clears the manifests
 * naming it, deletes its remote ref, and detaches its desk.
 *
 * A DIFFERENT ACT FROM `/api/release`, which cuts a versioned release through
 * `plot-deliver.sh --release`. This one runs `plot-dispatch.sh --release`, the
 * dispatcher's own claim-abandonment verb — unrelated code, sharing only a
 * word.
 *
 * THE SAME FUNCTION THE CLI PATH CALLS. {@link gatherReadingsAndRelease} is
 * the one place readings are assembled and the decision is made — now in
 * `release-claim-reader.ts`, the non-HTTP half of this route, re-exported
 * here unchanged so an existing import of this module keeps working.
 * `main.ts`'s `release-claim` command calls it too, so there is exactly one
 * computation of "is this branch releasable", reached from two callers.
 */
export { gatherReadingsAndRelease, type ReleaseClaimResult } from '@plot-pm/fleet/shared/release-claim-reader';

export interface ReleaseClaimOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * Handle `POST /api/release-claim`. Synchronous end to end — the adapter's
 * script call blocks rather than polling a log, so unlike `/api/release` this
 * answers once, with no 202 and no background process.
 */
export async function handleReleaseClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ReleaseClaimOptions,
): Promise<void> {
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
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const branch = (body as { branch?: unknown })?.branch;
  if (typeof branch !== 'string' || branch === '') {
    json(400, { error: 'branch is required' });
    return;
  }

  const { status, result } = await gatherReadingsAndRelease(branch, {
    repoRoot: opts.repoRoot,
    scriptDir: opts.scriptsDir,
  });
  json(status, result);
}

import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ClaimResult } from '../contract/index.js';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';

/**
 * `POST /api/claim` — reserve one branch of a plan, and say what resulted.
 *
 * IT WRAPS THE CLAIM; IT DOES NOT PERFORM ONE. `plot-dispatch.sh` already
 * claims atomically by pushing a ref whose tip is an EMPTY COMMIT, and that
 * detail is the whole mechanism: two independent claims diverge, so the loser's
 * push is rejected as non-fast-forward, and git is the lock. Pushing a branch
 * that merely points at `origin/<main>` would not work — the remote already has
 * that commit, both pushes succeed, and both callers believe they won.
 *
 * Reimplementing that here would put a second claim mechanism beside the one
 * the fleet restarts from, which is the defect this repo removed from
 * `plot-worker-state.sh` the morning this branch was written: five states
 * carried in duplicate, and the copies had already drifted on the sixth.
 *
 * CLAIMING IS NOT DISPATCHING, and the separation is deliberate rather than
 * incidental. `--no-start` is a flag `plot-dispatch.sh` already has: it creates
 * the worktree and pushes the claim and starts no worker. That is exactly the
 * act an agent wants when it has decided to take work but intends to do the
 * work ITSELF — which is the case for every caller of this endpoint, since a
 * caller that wanted a detached agent would post to `/api/dispatch`.
 *
 * `/api/attention` states the other half of the same split: an agent asking
 * what is available has not yet committed to doing it, and conflating the two
 * would make a survey a mutation. This is the commitment, and it still is not
 * the doing.
 */

/** `--max 1`: one call reserves ONE branch. Fanning out a wave stays with /plot-dispatch. */
const MAX_PER_CALL = '1';

/**
 * How long the claim may take before this server stops waiting.
 *
 * A claim pushes to the git host, so it is a network write and genuinely slow —
 * and unlike `/api/dispatch` this route cannot answer 202 and let the caller
 * watch a row move, because its entire contract is to RETURN THE RESULTING
 * STATE. Awaiting is therefore not a choice made carelessly; it is what the
 * endpoint is for.
 *
 * 60 s rather than a tight bound, and the reason is a measurement rather than a
 * preference: a 1 ms budget that passed on macOS and lost on CI is one of two
 * races this repo recorded in a single day. A timeout tuned to a fast local
 * push is a test that passes here and fails on a loaded runner. This one is far
 * above any real claim and exists only so a hung `git push` cannot hold a
 * single-threaded server open forever.
 */
const CLAIM_TIMEOUT_MS = 60_000;

export interface ClaimOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * Read the outcome out of the script's own output.
 *
 * PARSED, NOT RE-DERIVED. Every fact below is something `plot-dispatch.sh`
 * printed; nothing here asks git a second question. The distinction matters
 * because a second question would be asked at a different moment than the
 * claim, and the answer could disagree with the act it claims to describe —
 * which is precisely the class of bug this endpoint exists to spare its caller.
 *
 * The script's contract, from its own usage block:
 *   `dispatched <branch> → <worktree>`  — this run claimed it
 *   `reusing existing worktree for <branch> → <worktree>` — already ours
 *   `skipped <branch> (claimed by another session)` — lost the race
 *   `summary: dispatched=N reused=N skipped=N started=N …`
 */
export function parseClaim(slug: string, stdout: string): ClaimResult {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = lines.find((l) => l.startsWith('summary:')) ?? '';

  // `dispatched` first, then `reusing`: a run that claimed something new is
  // reporting a stronger fact than one that adopted a worktree it already had,
  // and only the first is a claim this call won.
  const claimed = lines.find((l) => l.startsWith('dispatched '));
  const reused = lines.find((l) => l.startsWith('reusing existing worktree for '));
  const hit = claimed ?? reused;
  if (hit) {
    // `→` is the script's own separator and it is a literal in the format
    // string, never part of a branch name or a path git would produce.
    const [left, right] = hit.split(' → ');
    const branch = left.replace(/^dispatched /, '').replace(/^reusing existing worktree for /, '');
    return {
      slug,
      claimed: true,
      branch: branch || null,
      worktree: right ?? null,
      reason: hit,
      summary,
    };
  }

  const skipped = lines.find((l) => l.startsWith('skipped '));
  return {
    slug,
    claimed: false,
    branch: null,
    worktree: null,
    // The script says nothing at all when the eligible set is empty, and a
    // silence is not a reason a caller can act on. Naming the two situations
    // apart is this endpoint's own work rather than a paraphrase of the
    // script's: `skipped` means someone won the race and different work should
    // be asked for, while nothing means this plan has no work left to take.
    reason:
      skipped ??
      'nothing eligible to claim for this plan — every branch is already claimed, merged, deferred, or blocked by an earlier wave',
    summary,
  };
}

/**
 * Handle `POST /api/claim`. Awaits the claim and answers with what resulted.
 *
 * The loopback gate is NOT checked here: it is applied in the router, ahead of
 * every write route, so that a sixth endpoint cannot be added without it. See
 * `write-gate.ts` for why that placement is the point rather than a shortcut.
 */
export async function handleClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ClaimOptions,
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

  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  // `execFile`, never a shell string: the slug is already validated, so this is
  // defence in depth rather than the only barrier — which is exactly when it is
  // worth having. `/api/approve` makes the same choice and says so.
  const result = await new Promise<ClaimResult>((resolve) => {
    execFile(
      'bash',
      [path.join(opts.scriptsDir, 'plot-dispatch.sh'), '--no-start', '--max', MAX_PER_CALL, slug],
      { cwd: opts.repoRoot, timeout: CLAIM_TIMEOUT_MS, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // A NON-ZERO EXIT IS NOT NECESSARILY A FAILED CLAIM, and parsing before
        // branching on the error is what keeps that true. The script exits
        // non-zero for its own reasons — a phase gate, an unresolvable
        // `origin/<main>` — and in those cases stdout carries no `dispatched`
        // line, so the parse already reports `claimed: false`. Treating the
        // exit code as the answer would throw away the reason.
        const parsed = parseClaim(slug, stdout ?? '');
        if (!err || parsed.claimed) {
          resolve(parsed);
          return;
        }
        // Nothing was claimed AND the script failed: its stderr is the only
        // account of why, so it travels instead of the generic sentence the
        // parse would otherwise have supplied.
        const said = (stderr ?? '').trim();
        resolve({ ...parsed, reason: said || parsed.reason });
      },
    );
  });

  // 200 for both outcomes, and `claimed` carries the answer.
  //
  // A 409 for a lost race was the alternative and it is worse: losing a claim
  // race is the NORMAL result of a fleet working correctly — two dispatchers
  // ask at once and git refuses the second — and a 4xx would train a caller to
  // treat its own healthy behaviour as an error, retry, and lose again. The
  // request was well formed and the server did exactly what was asked; what
  // resulted is in the body, which is the whole premise of this endpoint.
  json(200, result);
}

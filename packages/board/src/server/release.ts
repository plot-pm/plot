import fs from 'node:fs';
import http from 'node:http';
import { agentLogPath } from './agent-log.js';
import { scriptsFor, type BuildBoardOptions } from './board.js';
import {
  isSameOrigin,
  readJsonBody,
  SLUG_RE,
} from './dispatch.js';
import { recordActionReceipt } from './action-receipt.js';

/**
 * The board's EIGHTH state-changing route, and the one that cuts a Delivered
 * plan's `Released:` record — the other half of `an-in-session-approval-has-a-
 * controller`'s slice 2, beside `/api/approve`'s `--who` arm.
 *
 * **It has NO AGENT ARM, unlike `/api/deliver`.** Delivering is a judgement —
 * is every branch really merged, does a partial deliverable count — so that
 * route spawns `/plot-deliver` to decide it. Releasing a plan that is already
 * Delivered is not: the version, the tag and the merge commit it must contain
 * are all facts `plot-deliver.sh --release` reads and refuses on by itself
 * (`plot-approve.sh`'s argument for its own two entrances, applied here with
 * one entrance rather than two). So this route calls the SCRIPT directly,
 * the way `/api/approve` does when no `Approve command` is configured —
 * never `sh -c` through a configured command, because there is no judgement
 * step for a command to stand in for.
 *
 * **It writes none of the transition itself.** `plot-deliver.sh --release`
 * resolves the version from the plan's merge commit, asks the domain's
 * `release` verb for the write, and performs it — this route only starts that
 * script and reports back. The standing rule for board writes: reuse an
 * agent-spawn or script-start shape rather than inventing a lifecycle
 * transition in TypeScript.
 */

/** The script this route runs — Plot ships it, so there is no configuration gap. */
export const RELEASE_SCRIPT = 'plot-deliver.sh';

/** A version as a caller may spell it: with or without the `v` prefix. */
export const VERSION_RE = /^v?\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/;

export interface ReleaseOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Where the command's own words go, keyed by slug and in {@link agentLogDir} —
 * the same neighbourhood `approveLogPath` and `dispatchLogPath` use.
 */
export function releaseLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'release', slug, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function releaseStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'release', slug, 'state');
}

/**
 * What a card may say about a release it asked for — the same three-and-
 * `unknown` shape `approve.ts`'s `ApproveState` carries, for the same reason.
 */
export type ReleaseState = 'unknown' | 'running' | 'done' | 'failed';

export interface ReleaseStatus {
  state: ReleaseState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the card cannot hold. */
  log: string;
}

/**
 * The tail of the log, as a message for a card. Shares {@link lastLines}'s
 * shape rather than importing it from `approve.ts`, so the two routes do not
 * reach across each other for a four-line helper — matched by
 * `test/reconcile`'s byte comparison of the two, which is what keeps them from
 * drifting silently.
 */
function lastLines(text: string, max = 3, maxChars = 400): string {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const tail = lines.slice(-max).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function releaseStatus(opts: BuildBoardOptions, slug: string): ReleaseStatus {
  const log = releaseLogPath(opts.repoRoot, slug);
  const statePath = releaseStatePath(opts.repoRoot, slug);
  let recorded = '';
  try {
    recorded = fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    return fs.existsSync(log)
      ? { state: 'running', message: '', log }
      : { state: 'unknown', message: '', log };
  }
  if (recorded === '0') return { state: 'done', message: '', log };
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return {
    state: 'failed',
    message: lastLines(text) || `the release command exited ${recorded}`,
    log,
  };
}

/**
 * Handle `POST /api/release`. Refuses, or spawns and answers 202 — never both,
 * and never a result.
 *
 * Detached and immediate, for the reason `/api/approve` documents: this server
 * is single-threaded, and a release writes to the git host, so awaiting it
 * would freeze every viewer's board. The outcome is read back from
 * `GET /api/release/<slug>` once the command has finished.
 */
export async function handleRelease(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ReleaseOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // The loopback boundary is enforced in the router by `write-gate.ts` for
  // every write route at once — see the note in `handleDispatch`.
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

  const version = (body as { version?: unknown })?.version;
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    json(400, { error: 'version must be a version such as 1.2.3 or v1.2.3' });
    return;
  }

  const log = releaseLogPath(opts.repoRoot, slug);
  const statePath = releaseStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended: this route's log is read back AS the answer,
    // the same choice `approve.ts` makes for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    try {
      fs.writeFileSync(statePath, String(signal ? `signal ${signal}` : code ?? 1), 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  };
  const onError = (err: Error): void => {
    console.error('release failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  };
  // ABOVE THE SPAWN, because the controller's authorisation precedes the
  // write it authorises. `plot-controller-gate.sh` refuses `plot-deliver.sh
  // --release` invoked with no receipt, and reads the command line to tell
  // this action apart from a bare `plot-deliver.sh <slug>` delivery — see the
  // note in `action-receipt.ts` on why `release` is a distinct action sharing
  // this script.
  recordActionReceipt(opts.repoRoot, 'release', slug);
  scriptsFor(opts).start(RELEASE_SCRIPT, ['--release', version, slug], { log: out, onExit, onError });
  // `detached` WITHOUT `unref` — see `approve.ts` for why both matter and
  // neither substitutes for the other.
  fs.closeSync(out);

  json(202, { slug, version, log });
}

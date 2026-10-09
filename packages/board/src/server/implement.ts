import fs from 'node:fs';
import http from 'node:http';
import { readConfig, type BuildBoardOptions } from './board.js';
import { readRunState } from './board-run.js';
import {
  IMPLEMENT_COMMAND_KEY,
  IMPLEMENT_TIMEOUT_MS,
  composeImplementPrompt,
  implementBranchRecordPath,
  implementBranchStatePath,
  implementLogPath,
  implementRunning,
  implementStatePath,
  readImplementBranch,
  startImplement,
  type ImplementStartFailure,
} from '@plot-pm/fleet/shared/implement-run';

export {
  IMPLEMENT_COMMAND_KEY,
  IMPLEMENT_TIMEOUT_MS,
  composeImplementPrompt,
  implementBranchRecordPath,
  implementBranchStatePath,
  implementLogPath,
  implementRunning,
  implementStatePath,
  readImplementBranch,
  startImplement,
  type ImplementStartFailure,
};
import { startableBranches } from '@plot-pm/domain';
import { pulseFor } from './fleet.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { lastLines, usableCommand, type IdeaState } from './idea.js';
import { localCapability } from './controllers/caller.js';

/**
 * Preparing an approved plan for implementation — the route behind the board's
 * **Implement** control, and its EIGHTH state-changing route.
 *
 * **It is the entrance a person walks, run from the board.** `/plot-implement`
 * is the preparation that comes before writing code: the staleness preflight,
 * the branch, the hand-off brief, the `Started:` record. Dispatch fans a plan
 * out to detached workers; this prepares ONE slice the way a person picking the
 * plan up would, and then stops. The board offers both on the plan row because
 * *am I picking this up, or is the fleet taking it?* is the operator's question
 * and has no default a server can compute.
 *
 * **It composes no prompt file, and that is the one way it differs from its
 * siblings.** `/api/idea` and `/api/commission` write a file because their
 * input is untrusted free text — an issue body, a plan's prose — that must
 * never become a shell word. `/plot-implement` takes only a SLUG: it reads the
 * plan itself from disk, so there is no operator text to carry. The slug is
 * `SLUG_RE`-bounded and travels as ONE argument via `"$@"`, so nothing a page
 * supplies is interpolated into the command string either. A file would be
 * ceremony guarding against a value that is already a plan slug.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED — `isSameOrigin`, the bounded body reader and
 * `SLUG_RE` from `dispatch.ts`, the command sentinel and the log helpers from
 * `idea.ts` — for the reason every write route states: a second copy of a
 * security decision is a second place for it to be weakened. This spawns a
 * process on the machine the board runs on, so it is deliberately the same
 * shape as the seven beside it and not an eighth one.
 */

/**
 * The branch a brief writer for this plan should brief: the first branch of the
 * first eligible slice that is startable and unclaimed, by the rule auto-dispatch
 * counts with ({@link startableBranches}).
 *
 * @param opts - the board's options.
 * @param slug - the plan slug.
 * @returns the branch, or `null` where the board has no reading or no branch is eligible.
 */
export const nextBriefBranch = (opts: BuildBoardOptions, slug: string): string | null => {
  const pulse = pulseFor(opts);
  if (!pulse) return null;
  return startableBranches(pulse, slug, new Set())[0] ?? null;
};

/** Why implementing a plan was refused — each sends the reader somewhere different. */
export type ImplementRefusal =
  /** No `Implement command` is configured, so no agent can be started. */
  | 'no-implement-command';

export interface ImplementOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, and its OWN named export rather than a re-export.
 *
 * Implement shares the same "spawn a plot agent on this disk" binding as idea,
 * commission and reslice — unavailable off localhost for the same reason — so
 * the four answer the same question today. But the repo's rule is one
 * capability, one flag: a single flag answering several capabilities is
 * precisely how they diverge without anyone noticing. So this is its own name
 * with the same body, and the day preparing a plan needs a different
 * precondition than creating one, there is already a seam to put it in.
 */
export function implementAvailability(host: string): { available: boolean; reason: string } {
  return localCapability(host, 'preparing a plan for implementation', 'the repo');
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function implementCommand(opts: BuildBoardOptions): string {
  return usableCommand(readConfig(opts, IMPLEMENT_COMMAND_KEY, ''));
}

/**
 * What the board may say about a plan it asked to implement — the same four
 * states `IdeaState` carries, for the same reason, so the type is reused rather
 * than re-declared.
 */
export interface ImplementStatus {
  state: IdeaState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/** What `implementRunState` reads from the state file and the log's presence. */
export interface ImplementRunState {
  /** As {@link readRunState} answers it: `running`, `done` — state `0`, `failed` — any other record, `unknown`. */
  state: IdeaState;
  /** The recorded exit as written, trimmed; `''` where no state file was read. */
  recorded: string;
  /** The log's absolute path, whether or not it exists. */
  log: string;
  /** The state file's absolute path, whether or not it exists. */
  statePath: string;
}

/**
 * Reads an implement run's state from the state file alone, without reading
 * the log's content. Never spawns, never blocks, never throws.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug the run is keyed on.
 * @returns the run's state, its recorded exit, and both file paths.
 */
export const implementRunState = (repoRoot: string, slug: string): ImplementRunState => {
  const log = implementLogPath(repoRoot, slug);
  const statePath = implementStatePath(repoRoot, slug);
  const { state, recorded } = readRunState(statePath, log);
  return { state, recorded, log, statePath };
};

/**
 * Reads back what an earlier POST started. Never spawns, never blocks.
 *
 * @param opts - the board's options; only `repoRoot` is read.
 * @param slug - the plan slug the run is keyed on.
 * @returns the run's state, the log's last lines on a failure (or the exit
 *          sentence where the log is empty or gone), and the log's path.
 */
export const implementStatus = (opts: BuildBoardOptions, slug: string): ImplementStatus => {
  const { state, recorded, log } = implementRunState(opts.repoRoot, slug);
  if (state !== 'failed') return { state, message: '', log };
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return {
    state: 'failed',
    message: lastLines(text) || `the implement command exited ${recorded}`,
    log,
  };
};

/** The one fact this route reads from outside itself, injectable for test. */
export interface ImplementDeps {
  /** The configured `Implement command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The branch to brief for a plan; {@link nextBriefBranch} where absent. */
  briefBranch?: (opts: BuildBoardOptions, slug: string) => string | null;
}

/**
 * Handle `POST /api/implement` — refuse, or spawn `/plot-implement` on the slug.
 *
 * Detached and answered 202 immediately, for the reason `/api/idea` documents:
 * this server is single-threaded, and awaiting an agent would freeze every
 * viewer's board for the length of somebody else's click. The outcome is read
 * back from `GET /api/implement/<slug>`; there is no row to watch move, because
 * `/plot-implement` prepares work rather than changing a plan's phase — so the
 * status route is how the button learns what its click did.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | malformed slug | the value reaches a skill that finds a plan by it; a non-slug is a caller bug |
 * | `no-implement-command` | no script can do `/plot-implement`'s judgement; accepting the click and doing nothing is the silent failure |
 */
export async function handleImplement(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ImplementOptions,
  deps: ImplementDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: ImplementRefusal, slug: string, detail: string) =>
    json(status, { ok: false, slug, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // that used to sit above it is enforced in the router for every write route at
  // once — see `write-gate.ts`. `implementAvailability` still answers this
  // control's capability flag, which is the question the BUTTON asks before it
  // is clicked.
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

  // THE SLUG IS THE WHOLE REQUEST. Nothing else a page supplies is read: the
  // plan is resolved from the slug by `/plot-implement` itself, from the file on
  // disk, never from the caller. `SLUG_RE` bounds it to a plan slug — the same
  // value the skill will glob with — so a value that is not a slug is a caller
  // bug refused, not something to sanitize.
  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  // ASKED BEFORE ANYTHING IS WRITTEN. A repo with no runner cannot act on this
  // click at all. Unlike commission, there is no phase to check here: whether
  // the plan is approved and has eligible work is the gate the BUTTON already
  // applies (`hasEligibleWork`), and `/plot-implement` re-checks the phase and
  // stops itself if it has moved — so the route does not duplicate a weaker copy
  // of a decision the skill owns.
  const usable = usableCommand(readCfg(opts, IMPLEMENT_COMMAND_KEY, ''));
  if (!usable) {
    refuse(
      409,
      'no-implement-command',
      slug,
      `no \`${IMPLEMENT_COMMAND_KEY}\` in Plot Config — preparing a plan runs the /plot-implement SKILL, which no script can do; add the key or run /plot-implement yourself`,
    );
    return;
  }

  // ONE SPAWN, SHARED WITH `/api/dispatch`. This route used to hold its own
  // copy; the two drifted in the one way that mattered — only this one wrote
  // the state file the status route reads — so the child belongs to
  // `startImplement` and both callers get the same log, bound and recording.
  const branch = (deps.briefBranch ?? nextBriefBranch)(opts, slug);
  const started = startImplement(opts, slug, usable, undefined, readCfg, branch);
  if ('failure' in started) {
    json(500, { error: started.failure.detail });
    return;
  }
  const { log } = started;

  json(202, { ok: true, slug, log });
}

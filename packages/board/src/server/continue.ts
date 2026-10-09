import http from 'node:http';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { pulseFor } from './fleet.js';
import type { FleetReading } from '../contract/schema.js';
import { branchFromPulse } from './agent-panel.js';
import { localCapability } from './controllers/caller.js';
import type { DeskMonitors } from '@plot-pm/domain';
import {
  continueOnDesk,
  ANSWER_MAX,
  BODY_LIMIT,
  type ContinueRefusal,
} from '@plot-pm/fleet/shared/continuation';

/**
 * Continuing an answered agent — the board's SECOND state-changing route, and
 * deliberately built as a sibling of `/api/dispatch` rather than as a second
 * mechanism.
 *
 * **A CONTINUATION IS NOT A REPLY, and the naming is the design.** `claude -p`
 * is a one-way process: there is no stdin after launch, so the agent that wrote
 * the question is gone by the time anyone reads it. What this route does is
 * start a NEW worker in the same worktree. Calling the control *Reply* would
 * promise a channel that does not exist — the reader would expect the agent
 * they were talking to to hear them, and no such agent is listening. What
 * continues is the WORK, not the conversation.
 *
 * The consequences of that are structural rather than cosmetic:
 *
 *   - the previous pid is never reused. A new process gets a new pid, and the
 *     row must show a new worker — see {@link handleContinue}, which refuses to
 *     inherit `.plot-worker.pid` and overwrites it.
 *   - the prompt is composed fresh from durable sources, never carried over
 *     from the previous run — see {@link composeContinuation}.
 *
 * The guard and the body bound are IMPORTED from `dispatch.ts` rather than
 * rewritten. This is the same class of endpoint — it spawns a process on the
 * machine the board runs on — and the reasons those two exist there apply here
 * unchanged. A second copy is a second place to forget them.
 *
 * `CONTINUATION_NAME`, `ANSWER_MAX`, `BODY_LIMIT`, `ContinueRefusal` and
 * `continueOnDesk` itself live in `continuation.ts` — the non-HTTP half of this
 * route, with no `node:http`, `dispatch.js` or `fleet.js` import, so a non-board
 * entry point can hold the engine without holding the route.
 */

export interface ContinueOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * The two facts this route reads from outside itself, injectable.
 *
 * **A seam rather than a mock, and the codebase's own shape**: `agentPanel`
 * takes `{ home? }` for exactly this reason. Reassigning an ES module export in
 * a test does not work — the binding is read-only — and a `vi.mock` factory
 * would put this route's test in a different style from every other test here.
 * Optional parameters defaulting to the real readers keep the production path
 * identical while making the refusals assertable without a live fleet scan.
 */
export interface ContinueDeps {
  /** The cached pulse — where the branch → worktree lookup comes from. */
  pulse?: (opts: BuildBoardOptions) => FleetReading | null;
  /** The configured `Worker command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** Starts the desk's monitor; defaults to the shell script under `scriptsDir`. */
  monitors?: DeskMonitors;
}

/**
 * Handle `POST /api/continue` — refuse, or write the prompt and spawn a NEW
 * worker in the branch's existing worktree.
 *
 * ## Why the missing marker is a refusal
 *
 * A branch with no `PLOT-BLOCKED`/`TODO(you)` marker in its tree is not
 * waiting on anybody, and continuing it would start a second worker in a
 * worktree that may already hold a live one. That is the one failure this route
 * can cause that a person cannot easily undo: two agents committing to one
 * branch. The marker is what makes the branch read `waiting`, so requiring it
 * makes the route's precondition exactly the state the UI offered the control
 * for.
 *
 * ## The stale-marker decision, and why it went to the WORKER
 *
 * A marker left in the tree after its answer makes finished work read as
 * blocked — measured on 2026-08-19, a stale marker survived its own answer by
 * 55 minutes. So somebody must clear it, and there are only two candidates.
 *
 * **This route could delete it at spawn time.** Rejected. It would put a WRITE
 * to the branch's tree in an endpoint whose job is to start a process, and it
 * would lie in the window that matters: between the delete and the new worker's
 * first commit the branch reads `finished` — clean tree, no marker — which is
 * the *review it* verdict, aimed at a human, for work that has not been done.
 * The row would go quiet at the exact moment it became busiest. Worse, if the
 * worker fails to start (bad `Worker command`, a full disk) the question is
 * gone with nothing running: the branch reads finished, forever, and the
 * question is only recoverable from git history nobody will think to search.
 *
 * **So the new worker clears it**, and the prompt says so in as many words.
 * The marker therefore stands from the answer until the continuation has read
 * it — which is the honest reading of the state during that window: a person
 * HAS answered, and the work is not yet done. The branch reads `waiting` a
 * little longer than it is strictly true, and that error points at a live
 * worker rather than at absent work. Erring toward *still busy* is the
 * direction this board can afford; erring toward *ready for review* is the one
 * that wasted the 55 minutes.
 *
 * The cost is real and named: a continuation whose worker dies before clearing
 * the marker leaves the branch reading `waiting`, and a person will answer a
 * question that has already been answered. That is recoverable by looking —
 * the log and the panel both show the newer run — and the alternative is
 * unrecoverable by looking, because it shows nothing at all.
 */
export async function handleContinue(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ContinueOptions,
  deps: ContinueDeps = {},
): Promise<void> {
  const readPulse = deps.pulse ?? pulseFor;
  const readCfg = deps.config ?? readConfig;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: ContinueRefusal, branch: string, detail: string) =>
    json(status, { ok: false, branch, reason, detail });

  // The same-origin gate `/api/dispatch` documents, imported rather than
  // reimplemented. The loopback gate that used to sit above it is now enforced
  // in the router for all five write routes at once — see `write-gate.ts`, and
  // the note in `handleDispatch` for why one surviving copy would have made the
  // named opt-in mean two different things on two different routes.
  //
  // `continueAvailability` still answers the board's third capability flag,
  // which is the question the CONTROL asks before it is clicked.
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
  const answer = (body as { answer?: unknown })?.answer;
  if (typeof branch !== 'string' || branch === '') {
    json(400, { error: 'branch is required' });
    return;
  }
  if (typeof answer !== 'string' || answer.trim() === '') {
    // An EMPTY answer is refused rather than sent. Starting a worker whose new
    // fact is nothing would burn a run to re-read a brief it already has and
    // hit the same question again.
    json(400, { error: 'answer is required' });
    return;
  }
  if (answer.length > ANSWER_MAX) {
    json(400, { error: `answer is longer than ${ANSWER_MAX} characters` });
    return;
  }

  // A LOOKUP, not a check — the same security boundary `worktreeForBranch` and
  // `branchFromPulse` document. The branch names a record the scan already
  // produced; no request text becomes a path segment, so `../../etc` matches
  // nothing and comes back as a refusal rather than as a write.
  const pulse = readPulse(opts);
  const found = branchFromPulse(pulse, branch);
  if (!found) {
    refuse(404, 'unknown-branch', branch, 'no plan on this board names that branch');
    return;
  }
  if (!found.worktree) {
    refuse(404, 'no-worktree', branch, 'this machine holds no worktree for that branch');
    return;
  }

  const started = await continueOnDesk({
    opts,
    readCfg,
    branch,
    worktree: found.worktree,
    main: pulse?.main ?? '',
    previousPid: found.pid,
    answer,
    monitors: deps.monitors,
  });
  if (started.kind === 'refused') {
    refuse(started.status, started.reason, branch, started.detail);
    return;
  }
  if (started.kind === 'failed') {
    json(500, { error: started.error });
    return;
  }
  json(202, {
    ok: true,
    branch,
    /** The NEW pid. A caller asserting a new run compares this to the old one. */
    pid: started.pid,
    /** The pid this continuation replaced, so the answer names both. */
    previousPid: started.previousPid,
    prompt: started.prompt,
    log: started.log,
  });
}

/**
 * Whether continuing is available at all — the same binding question
 * `/api/dispatch` asks, with the same answer.
 *
 * Its own function rather than a re-export so the client can hold a separate
 * flag, which is the lesson `approve` records: two capabilities behind one flag
 * is how they diverge. Today the answer is identical, and the day one of them
 * grows a condition the other lacks, only this function changes.
 */
export function continueAvailability(host: string): { available: boolean; reason: string } {
  return localCapability(host, 'continuing an agent', 'the worktrees');
}

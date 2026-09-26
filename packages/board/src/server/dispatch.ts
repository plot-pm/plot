import fs from 'node:fs';
import http from 'node:http';
import { agentLogPath, migrateAgentLogs } from './agent-log.js';
import type { BuildBoardOptions } from './board.js';
import { readConfig, scriptsFor } from './board.js';
import { readTail, type LogMissReason } from './worker-log.js';
import {
  IMPLEMENT_COMMAND_KEY,
  implementLogPath,
  implementRunning,
  startImplement,
} from './implement.js';
import { usableCommand } from './idea.js';
import { localCapability } from './controllers/caller.js';
import { recordActionReceipt } from './action-receipt.js';

/**
 * The board's ONE state-changing route.
 *
 * Everything else this server does is a read. `POST /api/dispatch` is a change
 * in kind rather than degree, which is why the conditions under which it exists
 * are designed rather than added:
 *
 *   - It runs `plot-dispatch.sh`, and DECIDES NOTHING itself. Which branch,
 *     whether the slice is open, whether the phase gate allows it, whether the
 *     claim wins its race — all of that lives in the script and its own chain.
 *     The board expresses an intent about a plan; it cannot bypass a rule it
 *     never evaluates.
 *   - It exists only while the server is bound to localhost. Whoever reaches
 *     localhost:7777 is sitting at the machine that owns the worktrees; that IS
 *     the permission, and it needs no token to express.
 *   - It requires the request to have come from the board's own page. The
 *     binding answers *reachability*, and a browser is not a network question:
 *     any site the user visits can POST to localhost, and the worktree exists
 *     and the claim is pushed before the attacker's unreadable response is
 *     written. Textual CSRF — the one hole the binding argument cannot cover.
 */

/** The fan-out Plot ships — the one this package starts, never a path a caller holds. */
export const DISPATCH_SCRIPT = 'plot-dispatch.sh';

/** `--max 1`: a button is ONE decision. Fanning out a slice stays with /plot-dispatch. */
const MAX_PER_CLICK = '1';

export interface DispatchOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act at all, and why not — the same answer the button
 * needs BEFORE it is clicked. A control that looks live and 403s on click is a
 * worse answer than one that says up front what it cannot do.
 */
export interface DispatchAvailability {
  available: boolean;
  /** Empty when available; a human sentence otherwise. */
  reason: string;
}

/**
 * Loopback only. `0.0.0.0` (what the fleet user test uses to reach the board
 * over Tailscale) is deliberately NOT localhost: it is reachable from the
 * network, and "sitting at this machine" stops being true the moment it is.
 *
 * This is a refusal to invent an auth scheme, not an oversight. A hand-rolled
 * token in a URL would look like security while being a shared secret in shell
 * history. When the board legitimately needs to act over a network, that is a
 * plan with an auth design in it — not a flag.
 */
export function dispatchAvailability(host: string): DispatchAvailability {
  return localCapability(host, 'starting work', 'the worktrees');
}

/**
 * Did this request come from the board's own page?
 *
 * Both headers are set by the browser and cannot be forged by page JavaScript,
 * which is exactly why they are worth checking and a token is not. Absent
 * headers pass: a non-browser caller (curl, a test) sends neither, and it was
 * never the browser's cross-site behaviour that this guards against.
 */
export function isSameOrigin(req: http.IncomingMessage, port: number): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const allowed = [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
    ];
    if (!allowed.includes(origin)) return false;
  }
  return true;
}

/**
 * Read a JSON request body, bounded — this route takes one short field.
 *
 * Shared with `/api/approve` rather than copied. Both take the same one-field
 * body, and a second implementation would be a second place for the bound to be
 * forgotten.
 */
export function readJsonBody(req: http.IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * A plan slug, as `plot-dispatch.sh` will use it to find a plan file. Rejected
 * rather than sanitized: the slug reaches a script that globs with it, and a
 * value that is not a slug is a caller bug, not something to repair silently.
 */
export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Where the script's own words go. Chosen BEFORE spawning and keyed by SLUG,
 * because the server cannot know the branch: `--max 1` asks `--next` at runtime
 * which branch is eligible, and the worktree path derives from that answer.
 * The dispatcher's own log is knowable at 202 time (see {@link agentLogPath});
 * `<worktree>/.plot-worker.log` is not. Both exist and neither replaces the
 * other — the first records what the dispatcher did, the second what the agent
 * is doing.
 */
export function dispatchLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'dispatch', slug, 'log');
}

/**
 * What the dispatcher log read can say — the SAME shape as `WorkerLog`, keyed by
 * SLUG rather than branch because that is what names this file.
 *
 * The two logs are siblings (`dispatchLogPath`), and rendering them wants the
 * same panel — a tail of text, a full size, a path to open the rest. So the
 * payload matches `WorkerLog` field for field, and only the key differs: a
 * dispatcher log belongs to a plan, a worker log to a branch. Sharing the type
 * outright would have misnamed the key, which is the one fact a reader uses to
 * know WHICH of the two this is.
 *
 * `no-log` is the ordinary state, not a failure: a plan nobody has clicked Start
 * work on has no dispatcher log, and the file is created the first time one is
 * dispatched (`handleDispatch` opens it `'a'`). `no-worktree` cannot arise —
 * the path is knowable without one — so the miss union is narrower here.
 */
export type DispatchLog =
  | {
      ok: true;
      slug: string;
      /** The log's absolute path — so a reader can open the whole file itself. */
      path: string;
      /** The tail, or "" for a log that exists and holds nothing. */
      text: string;
      /** The log's FULL size in bytes, not the length of `text`. */
      bytes: number;
      /** Whether `text` is the whole log or its end — see `readTail`. */
      truncated: boolean;
      /** Last write to the log, ISO-8601. */
      modifiedAt: string;
    }
  | { ok: false; slug: string; reason: Exclude<LogMissReason, 'no-worktree'>; path: string };

/**
 * The dispatcher log for a slug, bounded, with absence and emptiness told apart.
 *
 * The path is DERIVED from the slug — validated by `SLUG_RE` at the route, and a
 * slug has no slashes to escape with — so unlike `workerLog` there is no worktree
 * lookup: `dispatchLogPath` is the whole address. The read reuses `readTail`, so
 * a multi-megabyte log costs the same as a small one.
 */
export function dispatchLog(opts: BuildBoardOptions, slug: string): DispatchLog {
  const logPath = dispatchLogPath(opts.repoRoot, slug);

  let fd: number;
  try {
    fd = fs.openSync(logPath, 'r');
  } catch (err) {
    // ENOENT is *nobody has dispatched this plan* — the normal state, said as
    // `no-log`; anything else is a file that exists and would not open.
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      slug,
      reason: code === 'ENOENT' ? 'no-log' : 'unreadable',
      path: logPath,
    };
  }

  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, slug, reason: 'unreadable', path: logPath };
    const { text, truncated } = readTail(fd, st.size);
    return {
      ok: true,
      slug,
      path: logPath,
      text,
      bytes: st.size,
      truncated,
      modifiedAt: st.mtime.toISOString(),
    };
  } catch {
    return { ok: false, slug, reason: 'unreadable', path: logPath };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Whether a dispatcher log exists for this slug — one `stat`, not a read.
 *
 * This is the presence signal the card carries so the `Status` menu entry can be
 * offered *whenever a dispatcher log exists* and omitted otherwise. It is a
 * `stat` deliberately: the log's BODY still travels only on demand through
 * `/api/dispatch-log`, so the pulse gains one filesystem check per card and not
 * one file read — the same discipline `worktreesFromPulse` and the worker log
 * keep, that the periodic scan carries locations and existence, never contents.
 */
export function dispatchLogExists(repoRoot: string, slug: string): boolean {
  return fs.existsSync(dispatchLogPath(repoRoot, slug));
}

/** Dependencies for `handleDispatch`, injectable for tests. */
export interface DispatchDeps {
  /** Read a Plot Config key, or return the fallback. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
}

/**
 * Handle `POST /api/dispatch`. Refuses, or spawns and answers 202 — never both.
 *
 * ## The brief gate — slice 2 of a-dispatch-hands-over-a-brief
 *
 * A dispatch now calls `/plot-implement` FIRST and waits for it to complete
 * before spawning `plot-dispatch.sh`. The implement command creates the
 * hand-off brief that tells the worker what to build and what decisions are
 * already settled, so the worker does not spend its first hour re-deriving
 * them.
 *
 * Without an `Implement command` in Plot Config, the route refuses and names
 * the missing key — the same shape `/api/implement` uses. This is a refusal
 * to act without a runner, not an oversight: `/plot-implement` is judgement
 * (staleness preflight, brief authorship), and no script can substitute.
 *
 * ## The contract, changed 2026-09-26 by `a-dispatch-does-not-hold-the-loop`
 *
 * This docblock read *"the implement step is SYNCHRONOUS: the 202 is written
 * only after it completes successfully"*. **It no longer is, and the 202 no
 * longer means the brief exists.** The implement ran on the request's stack
 * under a five-minute bound, and a single-threaded server answered nothing for
 * the duration: measured 2026-09-26, the port holder sat at 0.0% CPU while
 * `/api/board` timed out and the page told the operator to restart a live
 * server.
 *
 * So the 202 now means **the implement was started**, and it carries the two
 * log paths. The brief gate is unchanged in what it decides — `plot-dispatch.sh`
 * still runs only after the implement exits 0 — and changed in WHERE the
 * decision is read: from the child's `exit` listener, with the outcome recorded
 * for `GET /api/implement/<slug>`.
 *
 * **The refusal did not move from the response to nowhere.** It never reached
 * the operator through the response: the client aborts every action at
 * `ACTION_TIMEOUT_MS = 15_000` (`bounded-fetch.ts:45`) and a real
 * `/plot-implement` takes minutes, so the button got `Fetch is aborted` and
 * never the `409 implement-failed`. The status read-back is the refusal's first
 * working route to a person.
 *
 * A second POST for a slug whose implement is still `running` is REFUSED rather
 * than queued — two implements truncate one log and may both start a dispatch.
 * The client's in-flight guard lives in one tab and one render; a reload or a
 * second tab walks straight past it.
 */
export async function handleDispatch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: DispatchOptions,
  deps: DispatchDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // The loopback boundary is NOT checked here any more — it is enforced in the
  // router, ahead of every write route, by `write-gate.ts`.
  //
  // This handler checked it itself until 2026-08-19, and the check was correct
  // and insufficient in the same way: correct for this route, and silent about
  // the four beside it. Worse, once the gate grew a named opt-in, a surviving
  // copy here would have honoured a DIFFERENT policy — the opt-in would open
  // /api/claim and be refused at /api/dispatch, so one variable would mean two
  // things depending on which route read it. That is the exact failure
  // `approve.ts` records for capability flags: one answer to two questions is
  // how they diverge without anyone noticing.
  //
  // `dispatchAvailability` itself stays, and is still the source the gate reads
  // — and still answers `/api/board`'s capability flags, which is a different
  // question (will this BUTTON act) asked at a different time.
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

  // ──────────────────────────────────────────────────────────────────────────
  // THE BRIEF GATE: call /plot-implement first and wait for it.
  //
  // A worker without a brief spends its first hour re-deriving what the plan
  // already says. The implement step creates the hand-off brief BEFORE any
  // worker starts, and the brief is what makes a worker effective from minute
  // one.
  //
  // ASKED BEFORE ANYTHING IS WRITTEN. A repo with no `Implement command` cannot
  // produce a brief, so starting a worker is refused — the same shape
  // `/api/implement` uses. This is not a silent skip; it is a refusal that
  // names what is missing so the operator can add it.
  // ──────────────────────────────────────────────────────────────────────────
  const implCommand = usableCommand(readCfg(opts, IMPLEMENT_COMMAND_KEY, ''));
  if (!implCommand) {
    json(409, {
      ok: false,
      slug,
      reason: 'no-implement-command',
      detail: `no \`${IMPLEMENT_COMMAND_KEY}\` in Plot Config — starting work requires a brief, and the brief requires the /plot-implement SKILL; add the key or run /plot-implement yourself first`,
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // THE BRIEF GATE, OFF THE EVENT LOOP.
  //
  // The gate's decision is unchanged: `plot-dispatch.sh` runs only after the
  // implement exits 0. What changed is that the wait no longer happens on this
  // request's stack. The implement runs detached, this handler answers 202, and
  // the dispatch is started from the child's `exit` listener below.
  // ──────────────────────────────────────────────────────────────────────────

  // A SECOND CLICK IS REFUSED, NOT QUEUED. The synchronous route serialised two
  // POSTs for one slug by blocking everything; an async one would run two
  // implements at once, both truncating one log and both able to start a
  // dispatch. The client's in-flight ref does not cover this: it lives in one
  // tab and one render, and a reload or a second tab walks past it.
  //
  // THE LOCK IS THE LIVE CHILD, NOT THE LOG. `implementStatus` reports
  // `running` whenever a log exists with no recorded outcome, which is right
  // for a read-back and wrong for a lock — measured here, a log left by an
  // earlier run with no state file and no process refused every later dispatch
  // of that slug, permanently. `implementRunning` asks about a handle this
  // server holds, so it can only be true while a child is alive.
  if (implementRunning(slug)) {
    const log = implementLogPath(opts.repoRoot, slug);
    json(409, {
      ok: false,
      slug,
      reason: 'implement-running',
      detail: `an implement for \`${slug}\` is already running — watch it at ${log}, or wait for it to finish before dispatching again`,
      log,
    });
    return;
  }

  const implLog = implementLogPath(opts.repoRoot, slug);
  // THE LOG PATH IS CHOSEN HERE AND OPENED IN THE LISTENER. The name is part of
  // the 202's answer, so it must be known now; the descriptor must not be,
  // because a file held open across a five-minute implement is a descriptor
  // leaked for every dispatch the implement then refuses.
  //
  // DECLARED BEFORE THE SPAWN because the listener closes over it. A `const`
  // read by a callback that runs before its declaration is a TDZ
  // `ReferenceError`, not a hoisted `undefined` — and a fast-failing implement
  // stub exits well inside the same tick.
  const log = dispatchLogPath(opts.repoRoot, slug);

  // Everything the exit listener needs, resolved HERE while a request is still
  // on the stack. A failure to open the dispatch log is reportable now and an
  // uncaught exception later — see `startImplement`'s listener contract.
  const started = startImplement(opts, slug, implCommand, (code) => {
    // A non-zero exit means the implement failed — refused by /plot-implement
    // itself (phase wrong, drift detected in unattended mode, no eligible
    // branch), or the runner crashed, or the bound killed it. Either way no
    // brief was created, so no worker starts.
    //
    // THE REFUSAL IS ALREADY RECORDED. `startImplement` wrote the exit code to
    // the state file before calling this, so `GET /api/implement/<slug>` reports
    // `failed` with the log's last lines — which is how the operator learns it,
    // the response having been sent minutes ago.
    if (code !== 0) return;

    // ────────────────────────────────────────────────────────────────────────
    // The implement succeeded — the brief exists. Now spawn the dispatch.
    // ────────────────────────────────────────────────────────────────────────
    // Move any pre-2026-08-30 logs out of the parent directory, once, before the
    // first log is written to the new one. HERE rather than at startup because a
    // dispatch is the act that creates the destination anyway — and because a
    // board that is only ever read should not rearrange an operator's files.
    //
    // The return value is deliberately unused: the migration is convenience, the
    // dispatch is the job, and `migrateAgentLogs` swallows every failure for that
    // reason. A dispatch must not fail for want of tidying an old log.
    migrateAgentLogs(opts.repoRoot);

    // A THROW HERE IS CAUGHT BY `startImplement` and recorded against the slug.
    // This runs in a listener with no request on the stack, so an uncaught
    // `fs.openSync` failure would take the server down, and a dispatch that
    // fails silently after its 202 is the outcome the plan calls worse than one
    // that blocks.
    const out = fs.openSync(log, 'a');
    try {
      // THE RECEIPT, IMMEDIATELY BEFORE THE SPAWN. `plot-controller-gate.sh`
      // refuses `plot-dispatch.sh` invoked with no receipt, and this route is the
      // legitimate caller it must not refuse — a gate that broke the legitimate
      // path is worse than no gate. It moved into this listener WITH the spawn it
      // announces: the two are one act, and a receipt written at request time
      // would announce a dispatch the implement may yet refuse.
      recordActionReceipt(opts.repoRoot, 'dispatch', slug);
      scriptsFor(opts).start(DISPATCH_SCRIPT, ['--max', MAX_PER_CLICK, slug], {
        log: out,
        onError: (err) => console.error('dispatch failed to spawn:', err),
      });
    } finally {
      fs.closeSync(out);
    }
  });
  if ('failure' in started) {
    json(500, { error: started.failure.detail });
    return;
  }

  // Spawn DETACHED and answer immediately. A dispatch creates a worktree and
  // pushes a claim — a network write, strictly slower than the 0.5–1.05 s scan
  // that already forced the fleet cache to exist on this single-threaded
  // server. Awaiting the script would freeze every viewer's board for the
  // duration of someone else's click.
  //
  // So the response CANNOT carry a result: the script's summary line only
  // exists once the run has finished. That is not a gap to paper over — it is
  // the same shape as start_worker's own detached spawn, and it is why the row
  // moving is the answer rather than the reply being one.
  //
  json(202, { slug, log, implementLog: implLog });
}

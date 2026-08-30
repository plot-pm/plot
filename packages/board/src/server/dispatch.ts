import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath, migrateAgentLogs } from './agent-log.js';
import { spawn, spawnSync } from 'node:child_process';
import type { BuildBoardOptions } from './board.js';
import { readConfig } from './board.js';
import { readTail, type LogMissReason } from './worker-log.js';
import {
  IMPLEMENT_COMMAND_KEY,
  implementLogPath,
  composeImplementPrompt,
} from './implement.js';
import { usableCommand } from './idea.js';

/**
 * The board's ONE state-changing route.
 *
 * Everything else this server does is a read. `POST /api/dispatch` is a change
 * in kind rather than degree, which is why the conditions under which it exists
 * are designed rather than added:
 *
 *   - It runs `plot-dispatch.sh`, and DECIDES NOTHING itself. Which branch,
 *     whether the wave is open, whether the phase gate allows it, whether the
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

/** `--max 1`: a button is ONE decision. Fanning out a wave stays with /plot-dispatch. */
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
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — starting work is available only on the machine that owns the worktrees`,
  };
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
 * ## The brief gate — wave 2 of a-dispatch-hands-over-a-brief
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
 * The implement step is SYNCHRONOUS: the 202 is written only after it
 * completes successfully. This is slower than the original fire-and-forget
 * dispatch, and that is the point — a brief that exists is worth more than a
 * worker that starts without one.
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

  // Run the implement command SYNCHRONOUSLY and wait for it to complete.
  // This is the brief gate: the dispatch proceeds only if the implement
  // succeeds. The implement command spawns `/plot-implement <slug>`, which
  // creates the brief at `.plot/briefs/<branch-slug>.md`.
  const implLog = implementLogPath(opts.repoRoot, slug);
  let implFd: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    implFd = fs.openSync(implLog, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${implLog}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Implement command` is a shell FRAGMENT, the same
  // interpretation `Idea command` and `Worker command` get. NOTHING from the
  // request is interpolated into that string: the prompt names the slug, which
  // is `SLUG_RE`-bounded, and travels as ONE argument via `"$@"`.
  const implResult = spawnSync(
    'sh',
    ['-c', `${implCommand} "$@"`, 'plot-implement', composeImplementPrompt(slug)],
    {
      cwd: opts.repoRoot,
      stdio: ['ignore', implFd, implFd],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch. There is nobody at this board to
        // answer `AskUserQuestion`, and under `claude -p` that tool is not
        // even registered — so a skill that improvises exits 0 having written
        // nothing. Setting it makes each skipped question take the shape its
        // author chose and name itself in the log.
        PLOT_UNATTENDED: '1',
        PLOT_PLAN_SLUG: slug,
      },
      // The implement step can take minutes for a large plan. A 5-minute
      // timeout is generous but bounded — a hung implement must not block the
      // board forever.
      timeout: 5 * 60 * 1000,
    },
  );
  fs.closeSync(implFd);

  // A non-zero exit means the implement failed — refused by /plot-implement
  // itself (phase wrong, drift detected in unattended mode, no eligible
  // branch), or the runner crashed. Either way, no brief was created.
  if (implResult.status !== 0) {
    let message = `the implement command exited ${implResult.status ?? 'unknown'}`;
    try {
      const text = fs.readFileSync(implLog, 'utf8');
      const last = text.split('\n').filter(Boolean).slice(-5).join('\n');
      if (last) message = last;
    } catch {
      /* the log is empty or gone; the exit code stands */
    }
    json(409, {
      ok: false,
      slug,
      reason: 'implement-failed',
      detail: message,
      log: implLog,
    });
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // The implement succeeded — the brief exists. Now spawn the dispatch.
  // ──────────────────────────────────────────────────────────────────────────
  // Move any pre-2026-08-30 logs out of the parent directory, once, before the
  // first log is written to the new one. HERE rather than at startup because a
  // dispatch is the act that creates the destination anyway — and because a
  // board that is only ever read should not rearrange an operator's files.
  //
  // The return value is deliberately unused: the migration is convenience, the
  // dispatch is the job, and `migrateAgentLogs` swallows every failure for that
  // reason. A dispatch must not fail for want of tidying an old log.
  migrateAgentLogs(opts.repoRoot);

  const log = dispatchLogPath(opts.repoRoot, slug);
  let out: number;
  try {
    out = fs.openSync(log, 'a');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
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
  const child = spawn(
    'bash',
    [path.join(opts.scriptsDir, 'plot-dispatch.sh'), '--max', MAX_PER_CLICK, slug],
    { cwd: opts.repoRoot, detached: true, stdio: ['ignore', out, out] },
  );
  child.on('error', (err) => console.error('dispatch failed to spawn:', err));
  child.unref();
  fs.closeSync(out);

  json(202, { slug, log, implementLog: implLog });
}

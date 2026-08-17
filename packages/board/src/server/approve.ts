import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import {
  dispatchAvailability,
  isSameOrigin,
  readJsonBody,
  SLUG_RE,
  type DispatchAvailability,
} from './dispatch.js';

/**
 * The board's SECOND state-changing route — and the one that acts on the git
 * host rather than on this disk.
 *
 * It exists because approving is what a reader most obviously wants to do from
 * a Draft card, and because the alternative is worse than it looks: a
 * copy-a-command affordance would put two buttons side by side, one acting and
 * one merely offering text, indistinguishable by looking. A surface with
 * exactly one action vocabulary keeps it.
 *
 * The irreversibility is real — `/plot-approve` under `Review: pr` merges the
 * plan PR, rewrites the phase, writes the `Approved:` record and clears
 * `.plot/hold` — and it is *identical* to the irreversibility of typing the
 * command, which gets typed by rote: eight approvals in one evening, each
 * through the same sequence, with nothing confirming anything. A button is not
 * more dangerous than that; it is the same act with less friction. The
 * confirmation lives in the button (see ApproveButton), which is friction the
 * click needs and the typed command never had.
 *
 * Every guard `/api/dispatch` established applies here unchanged, and is
 * IMPORTED rather than restated: the localhost binding, the same-origin check,
 * the slug validation. A second copy of a security decision is a second place
 * for it to be weakened.
 */

/**
 * How the board runs `/plot-approve`, and why it is not a script.
 *
 * `/api/dispatch` spawns `plot-dispatch.sh`, and the obvious symmetry would be
 * `plot-approve.sh`. There is none, and writing one here would be the mistake
 * the indirection exists to prevent: `/plot-approve` is a SKILL — it reads the
 * plan's declared review channel and branches three ways, asks the two ceremony
 * questions on a pre-Plot-2 plan, weighs a tracer-bullet heuristic, and merges
 * only in the `pr` case. Reimplementing that beside the board would put the
 * approval rules in two places, which is the one thing the plan forbids
 * outright.
 *
 * So the board asks for the skill BY NAME and lets the adopting project say
 * what runs it — exactly as `plot-dispatch.sh` does for `Worker command`, and
 * for the same reason: "how do I run an agent headless" is a per-project answer
 * Plot must not hardcode (Manifesto Principle 5).
 */
export const APPROVE_COMMAND_KEY = 'Approve command';

/** The prompt handed to that command. The slug is the only variable. */
export function approvePrompt(slug: string): string {
  return `/plot-approve ${slug}`;
}

export interface ApproveOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, for the same reason `dispatchAvailability` exists.
 *
 * TWO reasons rather than one, and that is why this is not `dispatchAvailability`
 * under another name. A board on localhost can always dispatch, because
 * `plot-dispatch.sh` ships with Plot; it can approve only where the project has
 * said how to run an agent. One shared flag would be wrong for one of the two
 * whichever way it was set.
 */
export function approveAvailability(
  host: string,
  command: string,
): DispatchAvailability {
  const binding = dispatchAvailability(host);
  if (!binding.available) return binding;
  if (!command.trim()) {
    // Names the key rather than saying "unavailable". Not configured is not a
    // fault — Plot hardcodes no agent tooling — so the sentence is the next
    // step, or a board that has never been configured reads as broken.
    return {
      available: false,
      reason: `no \`${APPROVE_COMMAND_KEY}\` in this project's Plot Config — add one to approve from the board`,
    };
  }
  return { available: true, reason: '' };
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function approveCommand(opts: BuildBoardOptions): string {
  return readConfig(opts, APPROVE_COMMAND_KEY, '').trim();
}

/**
 * Where the command's own words go, keyed by slug and beside the repo — the
 * same shape and the same neighbourhood as `dispatchLogPath`, so a human
 * looking for "what happened when I clicked" finds both in one directory.
 *
 * Named for the ACT, not the tool: `plot-approve-<slug>.log` beside
 * `plot-dispatch-<slug>.log`, and neither can be mistaken for the other.
 */
export function approveLogPath(repoRoot: string, slug: string): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-approve-${slug}.log`);
}

/** Where the outcome is recorded, so a later GET can read it back. */
function approveStatePath(repoRoot: string, slug: string): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-approve-${slug}.state`);
}

/**
 * What a card may say about an approval it asked for.
 *
 * `unknown` is not a degraded `failed`: nothing has been attempted for that
 * plan, and painting a red message on a card whose button was never pressed
 * would be the board asserting something it does not know.
 */
export type ApproveState = 'unknown' | 'running' | 'done' | 'failed';

export interface ApproveStatus {
  state: ApproveState;
  /**
   * The command's own last words — the whole value of the route.
   *
   * `/plot-approve` already explains itself: *"Plan is still a draft. Mark it
   * ready for review first."*, a closed PR, a rejected push. Replacing that with
   * "failed" sends the reader to a terminal, and then the command could have
   * been typed there in the first place. Empty while running and on success,
   * where there is nothing to explain.
   */
  message: string;
  /** Where the full transcript is, for anything the card cannot hold. */
  log: string;
}

/**
 * The tail of the log, as a message for a card.
 *
 * The LAST lines rather than the first: a command that explains itself does so
 * on the way out, and a wrapper's startup banner is not the reason. Bounded,
 * because a card is not a terminal — the log path travels beside this for
 * anything longer.
 */
export function lastLines(text: string, max = 3, maxChars = 400): string {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const tail = lines.slice(-max).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function approveStatus(opts: BuildBoardOptions, slug: string): ApproveStatus {
  const log = approveLogPath(opts.repoRoot, slug);
  const statePath = approveStatePath(opts.repoRoot, slug);
  let recorded = '';
  try {
    recorded = fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    // No state file at all: either nothing was ever started for this slug, or a
    // run is in flight and has not written one yet. The log tells them apart.
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
    // Falls back to naming the exit code rather than to "failed": a number is
    // at least a fact the reader can act on, and it is the honest answer when a
    // command failed silently.
    message: lastLines(text) || `the approve command exited ${recorded}`,
    log,
  };
}

/**
 * Handle `POST /api/approve`. Refuses, or spawns and answers 202 — never both,
 * and never a result.
 *
 * Detached and immediate, for the reason `/api/dispatch` documents: this server
 * is single-threaded and an approval reaches the git host, so awaiting it would
 * freeze every viewer's board for the duration of someone else's click. The
 * outcome therefore cannot ride on this response — it is read back from
 * `GET /api/approve/<slug>` once the command has finished.
 */
export async function handleApprove(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ApproveOptions,
): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const command = approveCommand(opts);
  const availability = approveAvailability(opts.host, command);
  if (!availability.available) {
    json(403, { error: availability.reason });
    return;
  }

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

  const log = approveLogPath(opts.repoRoot, slug);
  const statePath = approveStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended: this route's log is read back AS the answer, and
    // an appended one would show a previous run's error after a later success.
    // (`/api/dispatch` appends because nothing reads its log but a human.)
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // The prompt is passed as ONE argument, never interpolated into the command
  // string. `sh -c "$cmd /plot-approve $slug"` would make a slug a shell
  // injection point; `"$@"` makes it data. The slug is already validated, so
  // this is defence in depth rather than the only barrier — which is precisely
  // when it is worth having.
  const child = spawn(
    'sh',
    ['-c', `${command} "$@"`, 'plot-approve', approvePrompt(slug)],
    { cwd: opts.repoRoot, detached: true, stdio: ['ignore', out, out] },
  );
  // The exit code is written by a listener in THIS process rather than by a
  // shell wrapper around the command, so a command that itself spawns and exits
  // is timed the same way any other is.
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync(statePath, String(signal ? `signal ${signal}` : code ?? 1), 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  });
  child.on('error', (err) => {
    console.error('approve failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // NOT unref'd, unlike the dispatcher's worker. That one must outlive the
  // board — a fleet keeps running when the board is closed. This one is short,
  // and its exit code is what the card is waiting for, so the listener above
  // must still be here to see it.
  fs.closeSync(out);

  json(202, { slug, log });
}

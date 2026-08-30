import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogDir, agentLogPath } from './agent-log.js';
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
 * How the board runs `/plot-approve` when the project has said how — and why
 * that is now an OPTION rather than the price of entry.
 *
 * This key used to be required, on the argument that `/plot-approve` is a SKILL
 * and reimplementing its rules beside the board would put them in two places.
 * The rules half of that is still true and still enforced. What was wrong was
 * the conclusion: `plot-approve.sh` now performs the mechanical half — merge the
 * plan PR, flip the phase, fill `Approved:`, clear the `.plot/hold` entries,
 * update the sprint annotation, push — and refuses, with a reason, everything
 * that needs a reader. So there IS a script to spawn, exactly as
 * `/api/dispatch` spawns `plot-dispatch.sh`.
 *
 * `Worker command` is genuinely per-project because dispatch starts an agent
 * that writes an implementation. Approving writes one line. The asymmetry it
 * was modelled on was never the same asymmetry.
 *
 * DEMOTED, NOT REMOVED. A project that wants the full skill — the ceremony
 * questions, the tracer-bullet heuristic, the `in-session` walkthrough — still
 * declares one, and the board prefers it when present. And the two entrances are
 * not two implementations: the skill calls the script, so the seven mechanical
 * steps go through ONE implementation either way.
 *
 *     no Approve command:    board → plot-approve.sh
 *     with Approve command:  board → agent → SKILL.md → plot-approve.sh
 */
export const APPROVE_COMMAND_KEY = 'Approve command';

/** The script the board falls back to — the one Plot ships. */
export const APPROVE_SCRIPT = 'plot-approve.sh';

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
 * ONE question, and it is the SAME question `Start work` asks: is this a local,
 * same-origin request. It used to ask a second one — is `Approve command`
 * declared — and that second question is what made two controls on one surface
 * disagree about whether the board could act. `plot-approve.sh` ships with Plot,
 * so the answer no longer depends on configuration.
 *
 * Over a non-localhost binding this is unavailable, and that is CORRECT rather
 * than a gap: approving merges a PR and writes to the default branch, and a
 * Tailscale address is deliberately not localhost (see `dispatchAvailability`).
 * The phone that reads the board does not approve from it, and `Start work`
 * behaves identically for the same reason.
 */
export function approveAvailability(host: string): DispatchAvailability {
  return dispatchAvailability(host);
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function approveCommand(opts: BuildBoardOptions): string {
  return readConfig(opts, APPROVE_COMMAND_KEY, '').trim();
}

/**
 * Where the command's own words go, keyed by slug and in {@link agentLogDir} —
 * the same shape and the same neighbourhood as `dispatchLogPath`, so a human
 * looking for "what happened when I clicked" finds both in one directory.
 *
 * The directory is named in one place, not here: prose that spells a path out
 * goes stale silently, and this comment did between 2026-08-30's two slices.
 *
 * Named for the ACT, not the tool: `plot-approve-<slug>.log` beside
 * `plot-dispatch-<slug>.log`, and neither can be mistaken for the other.
 */
export function approveLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'approve', slug, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function approveStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'approve', slug, 'state');
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

  // The loopback boundary is enforced in the router by `write-gate.ts`, not
  // here — see the note in `handleDispatch`. `approveAvailability` still
  // answers the board's capability flag, which is the question the BUTTON asks
  // before it is clicked; this is the question the SERVER answers before it
  // acts, and it now has one implementation covering all five write routes.
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

  // TWO ENTRANCES, ONE IMPLEMENTATION. With `Approve command` declared the
  // board asks for the skill by name and the project says what runs it; without
  // one it runs the script Plot ships. The skill itself calls that same script,
  // so the mechanical steps happen once either way and cannot drift.
  //
  // In the command case the prompt is passed as ONE argument, never
  // interpolated into the command string. `sh -c "$cmd /plot-approve $slug"`
  // would make a slug a shell injection point; `"$@"` makes it data. The slug is
  // already validated, so this is defence in depth rather than the only barrier
  // — which is precisely when it is worth having. The script case never builds a
  // shell string at all.
  const child = command
    ? spawn(
        'sh',
        ['-c', `${command} "$@"`, 'plot-approve', approvePrompt(slug)],
        { cwd: opts.repoRoot, detached: true, stdio: ['ignore', out, out] },
      )
    : spawn('bash', [path.join(opts.scriptsDir, APPROVE_SCRIPT), slug], {
        cwd: opts.repoRoot,
        detached: true,
        stdio: ['ignore', out, out],
      });
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
  // `detached` WITHOUT `unref`, which is deliberate and not the contradiction
  // it looks like — the two flags answer different questions.
  //
  // `detached` puts the command in its own process group, so a Ctrl-C in the
  // board's terminal does not land on it. An approval interrupted midway is the
  // worst outcome available here: it can have merged the PR and not yet written
  // the `Approved:` record, which is a plan whose file disagrees with its host.
  // Finishing is strictly better than stopping.
  //
  // No `unref`, unlike the dispatcher's worker: that one must outlive the board
  // by design (a fleet keeps running when the board is closed), while this one
  // is short and its EXIT CODE is what the card is waiting for. Dropping the
  // handle would drop the listener above with it, and every approval would read
  // as `running` forever.
  fs.closeSync(out);

  json(202, { slug, log });
}

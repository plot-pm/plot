import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { lastLines, usableCommand, type IdeaState } from './idea.js';

/**
 * Preparing an approved plan for implementation — the route behind the board's
 * **Implement** control, and its EIGHTH state-changing route.
 *
 * **It is the entrance a person walks, run from the board.** `/plot-implement`
 * is the preparation that comes before writing code: the staleness preflight,
 * the branch, the hand-off brief, the `Started:` record. Dispatch fans a plan
 * out to detached workers; this prepares ONE wave the way a person picking the
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
 * How the board runs `/plot-implement`. A runner key of its OWN, not a reuse of
 * `Idea command`.
 *
 * The plan asked for this: Implement is "read the way `Idea command` and
 * `Worker command` already are". It is its own capability — a repo may want a
 * different runner for *prepare a plan* than for *create one* — and the repo's
 * standing rule is one capability, one key. `/api/commission` reuses
 * `Idea command` because commissioning IS the idea binding (the same agent that
 * turns an issue into a Draft); preparing an approved plan is a different act,
 * so it gets a different key rather than borrowing one that would then answer
 * for two.
 *
 * OPTIONAL, and an absent key is a REFUSAL that names itself. `/plot-implement`
 * is skill-only and cannot have a script — every step is judgement (is the plan
 * stale? which wave is next? what belongs in the brief?), which is exactly what
 * a script must not decide. So a board with no runner cannot act on this click,
 * and accepting it and doing nothing would be this repo's recurring defect (an
 * unobserved thing reported as observed) wearing a button.
 */
export const IMPLEMENT_COMMAND_KEY = 'Implement command';

/** Where the command's own words go — the neighbourhood `idea` established. */
export function implementLogPath(repoRoot: string, slug: string): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-implement-${slug}.log`);
}

/** Where the outcome is recorded, so a later GET can read it back. */
function implementStatePath(repoRoot: string, slug: string): string {
  return path.join(path.resolve(repoRoot, '..'), `plot-implement-${slug}.state`);
}

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
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — preparing a plan for implementation is available only on the machine that owns the repo`,
  };
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function implementCommand(opts: BuildBoardOptions): string {
  return usableCommand(readConfig(opts, IMPLEMENT_COMMAND_KEY, ''));
}

/**
 * The instruction handed to the runner: run `/plot-implement` on this slug.
 *
 * A natural-language prompt, not a shell command line — the runner is a
 * `claude -p`-style agent (see `Worker command`, `Idea command`), and its
 * `"$@"` argument is the prompt it acts on. The slug is `SLUG_RE`-bounded, so
 * even embedded in the prompt it carries nothing a shell would interpret; and
 * it travels as one argument, never spliced into the command string.
 */
export function composeImplementPrompt(slug: string): string {
  return `Run /plot-implement ${slug} and follow it.`;
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

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function implementStatus(opts: BuildBoardOptions, slug: string): ImplementStatus {
  const log = implementLogPath(opts.repoRoot, slug);
  const statePath = implementStatePath(opts.repoRoot, slug);
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
    message: lastLines(text) || `the implement command exited ${recorded}`,
    log,
  };
}

/** The one fact this route reads from outside itself, injectable for test. */
export interface ImplementDeps {
  /** The configured `Implement command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
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

  const log = implementLogPath(opts.repoRoot, slug);
  const statePath = implementStatePath(opts.repoRoot, slug);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    // The same choice `idea.ts` makes, for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Implement command` is a shell FRAGMENT, the same
  // interpretation `Idea command` and `Worker command` get. NOTHING from the
  // request is interpolated into that string: the prompt names the slug, which
  // is `SLUG_RE`-bounded, and travels as ONE argument via `"$@"`. Already the
  // shape `idea.ts` and `commission.ts` use.
  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-implement', composeImplementPrompt(slug)],
    {
      cwd: opts.repoRoot,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch — the same one `idea.ts` sets. There is
        // nobody at this board to answer `AskUserQuestion`, and under `claude -p`
        // that tool is not even registered — so a skill that improvises here
        // exits 0 having written nothing. Setting it makes each skipped question
        // take the shape its author chose and name itself in the log. This is
        // exactly the case wave 2's SKILL.md change prepared `/plot-implement`
        // step 2 for: on drift it stops and reports rather than asking.
        PLOT_UNATTENDED: '1',
        PLOT_PLAN_SLUG: slug,
      },
    },
  );
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync(statePath, String(signal ? `signal ${signal}` : code ?? 1), 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  });
  child.on('error', (err) => {
    console.error('implement failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // `detached` WITHOUT `unref`, exactly as `idea.ts` is and for its reason:
  // detached keeps a Ctrl-C in the board's terminal off the agent, and keeping
  // the handle keeps the exit listener above alive — dropping it would make
  // every implement read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, slug, log });
}

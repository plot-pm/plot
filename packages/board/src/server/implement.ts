import fs from 'node:fs';
import http from 'node:http';
import { agentLogPath } from './agent-log.js';
import { readConfig, type BuildBoardOptions } from './board.js';
import { markBoardRun, readRunState, startBoardRun, writeState, type BoardConfigReader } from './board-run.js';
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
 * stale? which slice is next? what belongs in the brief?), which is exactly what
 * a script must not decide. So a board with no runner cannot act on this click,
 * and accepting it and doing nothing would be this repo's recurring defect (an
 * unobserved thing reported as observed) wearing a button.
 */
export const IMPLEMENT_COMMAND_KEY = 'Implement command';

/** Where the command's own words go — the neighbourhood `idea` established. */
export function implementLogPath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'implement', slug, 'log');
}

/**
 * Where the outcome is recorded, so a later GET can read it back.
 *
 * EXPORTED since `a-dispatch-does-not-hold-the-loop`, because `/api/dispatch`
 * runs the same command into the same log and now reads its outcome back
 * through {@link implementStatus}. A dispatch that left this file alone would
 * be read through an earlier `/api/implement`'s exit code — or, with no earlier
 * run, as `running` forever, since the log exists and no state file does.
 */
export function implementStatePath(repoRoot: string, slug: string): string {
  return agentLogPath(repoRoot, 'implement', slug, 'state');
}

/**
 * Where the outcome of the run that briefed ONE branch is recorded, beside the
 * plan-keyed {@link implementStatePath}. Written only for a run that was given a
 * branch; it holds `running <pid>` while the run lives and the exit code after.
 */
export const implementBranchStatePath = (repoRoot: string, slug: string, branch: string): string =>
  agentLogPath(repoRoot, 'implement', `${slug}.${branch.split('/').pop() ?? branch}`, 'state');

/**
 * Where the branch the plan-keyed run was given is named. Absent for a run that
 * named no branch, which keeps the per-plan reading.
 */
export const implementBranchRecordPath = (repoRoot: string, slug: string): string =>
  `${implementStatePath(repoRoot, slug)}.branch`;

/**
 * The branch the plan-keyed run was given.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug the run is keyed on.
 * @returns the branch, or `null` where the run named none or nothing is recorded.
 */
export const readImplementBranch = (repoRoot: string, slug: string): string | null => {
  try {
    return fs.readFileSync(implementBranchRecordPath(repoRoot, slug), 'utf8').trim() || null;
  } catch {
    return null;
  }
};

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
 * The instruction handed to the runner: run `/plot-implement` on this slug,
 * in `--brief-only` mode.
 *
 * A natural-language prompt, not a shell command line — the runner is a
 * `claude -p`-style agent (see `Worker command`, `Idea command`), and its
 * `"$@"` argument is the prompt it acts on. The slug is `SLUG_RE`-bounded, so
 * even embedded in the prompt it carries nothing a shell would interpret; and
 * it travels as one argument, never spliced into the command string. The flag
 * rides INSIDE the prompt for the same reason: it is text the skill reads, not
 * an argv entry the shell parses.
 *
 * `--brief-only` writes the hand-off brief and the `Started:` record and stops.
 * It pushes no claim ref and cuts no worktree, because under the registry model
 * nobody works a claim this step pushed: `claimedBranches` reads the ref as
 * claimed, the queue drops the slice, and the agent later handed it reads its
 * own slice as double-assigned. The claim belongs to the agent, which pushes it
 * at take-up (`plot-worker-loop.sh`).
 */
export function composeImplementPrompt(slug: string): string {
  return `Run /plot-implement ${slug} --brief-only and follow it.`;
}

/**
 * How long a `/plot-implement` child may run before it is killed.
 *
 * The bound the synchronous dispatch already carried (`dispatch.ts:375`, *"a
 * hung implement must not block the board forever"*), kept when the wait moved
 * off the event loop. The reason changes and the number does not: nothing is
 * blocked now, but a hung implement still holds a slug's gate closed, so it
 * must end and say so.
 */
export const IMPLEMENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The slugs whose implement child is alive in THIS server, and the lock the
 * dispatch route takes.
 *
 * NOT `implementStatus`, and the difference is a defect this nearly shipped.
 * That function answers *what happened to the implement I started?*, where
 * `running` means *a log exists and no outcome was recorded* — the honest
 * answer for a read-back, and wrong as a lock. Measured while building
 * `a-dispatch-does-not-hold-the-loop`: a log left behind by an earlier run,
 * with no state file and no process, read as `running` forever and refused
 * every later dispatch of that slug. A file cannot tell a live child from an
 * abandoned one; a handle can.
 *
 * Process-local, and that is the honest scope. Two boards on one repository
 * would not see each other's children — but two boards on one repository is a
 * shape `plot-boardctl.sh` already refuses, and the case this guards is a
 * second click on the ONE board, which the client's in-flight ref does not
 * cover because it lives in one tab and one render.
 *
 * Entries are deleted when the run ends, so a failed run frees its slug and a
 * restarted server starts empty rather than inheriting a lie.
 */
const running = new Set<string>();

/** Whether an implement child started by this server is still alive for `slug`. */
export function implementRunning(slug: string): boolean {
  return running.has(slug);
}

/** What {@link startImplement} could not do before the child existed. */
export interface ImplementStartFailure {
  /** The message to report, already suitable for an operator. */
  detail: string;
}

/**
 * Start `/plot-implement <slug>` through the `agentRun` port, and record its
 * outcome where {@link implementStatus} reads it back.
 *
 * ONE START FOR TWO ROUTES. `/api/implement` and `/api/dispatch` run the SAME
 * command through the SAME prompt into the SAME log, so the state file the
 * status route reads is written for both.
 *
 * The log is TRUNCATED and the state file marked `running <board pid>` before
 * the run starts: both are read back as the answer, and a stale one reports a
 * previous attempt's outcome for this one. The run stays in the board's
 * process group, bounded by {@link IMPLEMENT_TIMEOUT_MS}; a run ended on the
 * bound records `124`.
 *
 * @param opts - the board's options, for `repoRoot`.
 * @param slug - the plan slug, already `SLUG_RE`-validated by the caller.
 * @param command - the usable `Implement command` fragment.
 * @param onExit - called with the run's recorded code once it ends, after the
 *   state file is written. Anything it throws is logged and recorded as `1`.
 * @param readCfg - the config reader for every other key; {@link readConfig} where absent.
 * @param branch - the branch the run briefs, chosen by the caller before the spawn;
 *   `null` leaves the run naming none. It is recorded beside the plan-keyed state,
 *   with its own `running <pid>` state, and passed to the run as `PLOT_BRIEF_BRANCH`.
 * @returns the log path, or a failure where the log could not be opened.
 */
export const startImplement = (
  opts: BuildBoardOptions,
  slug: string,
  command: string,
  onExit?: (code: number) => void,
  readCfg: BoardConfigReader = readConfig,
  branch: string | null = null,
): { log: string } | { failure: ImplementStartFailure } => {
  const log = implementLogPath(opts.repoRoot, slug);
  const statePath = implementStatePath(opts.repoRoot, slug);
  const branchStatePath = branch === null ? null : implementBranchStatePath(opts.repoRoot, slug, branch);
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    fs.rmSync(statePath, { force: true });
    fs.rmSync(implementBranchRecordPath(opts.repoRoot, slug), { force: true });
    fs.writeFileSync(log, '', 'utf8');
    markBoardRun(statePath, log);
    if (branch !== null && branchStatePath !== null) {
      fs.writeFileSync(implementBranchRecordPath(opts.repoRoot, slug), branch, 'utf8');
      markBoardRun(branchStatePath, log);
    }
  } catch (err) {
    return { failure: { detail: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` } };
  }

  // NOTHING from the request is interpolated into a shell string: the prompt
  // names the slug, which is `SLUG_RE`-bounded, and travels as ONE argument.
  running.add(slug);
  void startBoardRun(
    opts,
    {
      role: 'implement',
      fragmentKey: IMPLEMENT_COMMAND_KEY,
      // THE CALLER'S FRAGMENT, not a second read of the key: both callers have
      // already refused an unusable one.
      readCfg: (o, key, fallback) => (key === IMPLEMENT_COMMAND_KEY ? command : readCfg(o, key, fallback)),
      tree: opts.repoRoot,
      prompt: composeImplementPrompt(slug),
      env: {
        // THE DECLARATION, not a switch — the same one `idea.ts` sets. On drift
        // `/plot-implement` step 2 stops and reports rather than asking.
        PLOT_UNATTENDED: '1',
        PLOT_PLAN_SLUG: slug,
        ...(branch === null ? {} : { PLOT_BRIEF_BRANCH: branch }),
      },
      logFile: log,
      statePath,
      boundSeconds: IMPLEMENT_TIMEOUT_MS / 1000,
    },
    (record) => {
      // RELEASED FIRST, before anything that can throw. A slug held by a run
      // that has ended is a slug nothing can dispatch again.
      running.delete(slug);
      writeState(branchStatePath, record.code);
      onExit?.(record.code);
    },
  );
  return { log };
};

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

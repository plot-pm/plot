import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath } from './agent-log.js';
import { readConfig, type BuildBoardOptions } from './board.js';
import { markBoardRun, readRunState, startBoardRun, STOPPED_RECORD } from './board-run.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { readPhase } from './transition.js';
import { ideaAvailability, lastLines, usableCommand, type IdeaState } from './idea.js';

/**
 * Interrogating a Draft plan: `POST /api/interrogate` runs the configured
 * `Interrogate command` with a prompt asking for `/challenge-the-plan <plan path>`.
 *
 * The shape is `commission.ts`'s: slug-scoped, Draft-only, a plot agent
 * started through the `agentRun` port and answered 202, and a slug-keyed
 * status read-back. The guards are imported from `dispatch.ts` and `idea.ts`,
 * not copied.
 *
 * The route decides nothing. The skill writes five artifacts: the verdict
 * files, `panel.md`, the plan's `Rounds:` increment, the Open Points section in
 * the plan body, and the `CHALLENGE-THE-PLAN-METADATA` block beside `Rounds:`.
 * This module writes only the prompt, the log and the state file, all outside
 * the repository.
 */

/** The `## Plot Config` key naming the runner. REQUIRED: no script can run a panel. */
export const INTERROGATE_COMMAND_KEY = 'Interrogate command';

/**
 * Whether the route will act, and why not.
 *
 * Two conditions, in order: the localhost binding every agent-spawning route
 * shares (`ideaAvailability`), then a usable `Interrogate command`. An absent
 * key or `none` answers unavailable with a reason that names the key.
 *
 * @param host the interface the server bound to (`HOST`), verbatim
 * @param opts the board options, for reading the config key
 */
export const interrogateAvailability = (
  host: string,
  opts: BuildBoardOptions,
): { available: boolean; reason: string } => {
  const binding = ideaAvailability(host);
  if (!binding.available) return binding;
  if (!usableCommand(readConfig(opts, INTERROGATE_COMMAND_KEY, ''))) {
    return {
      available: false,
      reason: `no \`${INTERROGATE_COMMAND_KEY}\` in Plot Config — interrogating a plan runs /plot-panel, which no script can do; add the key or run /plot-panel yourself`,
    };
  }
  return binding;
};

/** Where the prompt file goes: outside the repo, keyed by slug. */
export const interrogatePromptPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'interrogate', slug, 'prompt');

/** Where the command's output goes. Truncated on every run. */
export const interrogateLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'interrogate', slug, 'log');

/**
 * Where the run's state goes: `running <board pid>` from the start until the
 * run ends, then its code (`0`, `1`, `124` on the bound, or the board's own
 * exit code where the board stopped first).
 */
const interrogateStatePath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'interrogate', slug, 'state');

/** Why interrogating a plan was refused. Each value names a different fix. */
export type InterrogateRefusal =
  /** No usable `Interrogate command` is configured. */
  | 'no-interrogate-command'
  /** The plan could not be found or its phase could not be read. */
  | 'plan-unreadable'
  /** The plan is past Draft. */
  | 'not-a-draft'
  /** A panel for this plan is still running. */
  | 'already-running';

export interface InterrogateOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * The plan file a slug names: the active index first, then the date-prefixed
 * file in the plan directory. The same two candidates, in the same order, as
 * `transition.ts`'s `readPhase`, so the phase read and the prompt name one file.
 */
const resolvePlanBySlug = (opts: BuildBoardOptions, slug: string): string | null => {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const activeDir = readConfig(opts, 'Active index', 'docs/plans/active/');

  const active = path.join(opts.repoRoot, activeDir, `${slug}.md`);
  if (fs.existsSync(active)) return active;

  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(opts.repoRoot, planDir));
  } catch {
    return null;
  }
  const hit = entries.find((e) => e.endsWith(`${slug}.md`));
  return hit ? path.join(opts.repoRoot, planDir, hit) : null;
};

/**
 * The prompt handed to the runner. It names `/challenge-the-plan` and the plan,
 * and nothing else: no lenses, no commitment, no rubric. `/challenge-the-plan`
 * is the Draft-plan caller of `/plot-panel` and supplies all four of its
 * parameters; under `PLOT_UNATTENDED=1` it runs the panel rather than the
 * interview. Naming `/plot-panel` directly supplies only the subject, and an
 * unattended panel refuses when a parameter is missing.
 *
 * @param planPath the plan file, relative to the repository root
 */
export const composeInterrogatePrompt = (planPath: string): string =>
  [
    `/challenge-the-plan ${planPath}`,
    '',
    `Run /challenge-the-plan on the Draft plan at ${planPath}, unattended, and follow`,
    'the skill to its end, including recording the round in the plan. Act on no',
    'verdict: approve nothing, reject nothing, and change no phase.',
    '',
  ].join('\n');

/** What the board may say about an interrogation it started. */
export interface InterrogateStatus {
  state: IdeaState;
  /** The command's last lines on failure; empty while running and on success. */
  message: string;
  /** The full transcript. */
  log: string;
}

/**
 * Read back what an earlier POST started. Never spawns, never blocks.
 *
 * `running` holds only while the board that started the run still holds it. A
 * `running <pid>` state whose board is gone reads `failed`: the board stopped
 * before the command ended, and the command ended with it.
 */
export const interrogateStatus = (opts: BuildBoardOptions, slug: string): InterrogateStatus => {
  const log = interrogateLogPath(opts.repoRoot, slug);
  const { state, recorded } = readRunState(interrogateStatePath(opts.repoRoot, slug), log);
  if (state !== 'failed') return { state, message: '', log };
  if (recorded === STOPPED_RECORD) {
    return {
      state: 'failed',
      message: 'the interrogate command stopped without recording an exit code — see its log',
      log,
    };
  }
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return {
    state: 'failed',
    message: lastLines(text) || `the interrogate command exited ${recorded}`,
    log,
  };
};

/** The facts this route reads from outside itself, injectable for test. */
export interface InterrogateDeps {
  /** Reads a `## Plot Config` key. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The plan's current phase, or null when it cannot be read. */
  phase?: (opts: BuildBoardOptions, slug: string) => string | null;
}

/**
 * Handle `POST /api/interrogate` with body `{ slug }`: refuse, or write the
 * prompt and start the configured command through the `agentRun` port,
 * answering 202.
 *
 * Refusals, each with a `detail` sentence:
 *
 * | status | reason | when |
 * |---|---|---|
 * | 403 | — | the request is cross-origin |
 * | 409 | `no-interrogate-command` | the key is absent or `none` |
 * | 409 | `plan-unreadable` | the plan or its phase cannot be read |
 * | 409 | `not-a-draft` | the plan is past Draft |
 * | 409 | `already-running` | a panel for this slug is still running |
 *
 * The localhost binding is enforced in the router for every write route
 * (`write-gate.ts`); {@link interrogateAvailability} answers it for the button.
 */
export const handleInterrogate = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: InterrogateOptions,
  deps: InterrogateDeps = {},
): Promise<void> => {
  const readCfg = deps.config ?? readConfig;
  const readPh = deps.phase ?? readPhase;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (reason: InterrogateRefusal, slug: string, detail: string) =>
    json(409, { ok: false, slug, reason, detail });

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

  // The slug is the whole request; the plan text comes from disk.
  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    json(400, { error: 'slug must be a plan slug' });
    return;
  }

  const usable = usableCommand(readCfg(opts, INTERROGATE_COMMAND_KEY, ''));
  if (!usable) {
    refuse(
      'no-interrogate-command',
      slug,
      `no \`${INTERROGATE_COMMAND_KEY}\` in Plot Config — interrogating a plan runs /plot-panel, which no script can do; add the key or run /plot-panel yourself`,
    );
    return;
  }

  const phase = readPh(opts, slug);
  if (phase === null) {
    refuse(
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be found or its phase could not be read — refusing rather than interrogating a plan whose state is unknown`,
    );
    return;
  }
  if (phase !== 'draft') {
    refuse(
      'not-a-draft',
      slug,
      `plan \`${slug}\` is ${phase}, not draft — a panel on a plan past Draft changes nothing the lifecycle reads`,
    );
    return;
  }

  // One panel per plan: two panels writing one subject directory interleave
  // their verdict files, and the moderator reads a mixture.
  if (interrogateStatus(opts, slug).state === 'running') {
    refuse(
      'already-running',
      slug,
      `a panel for \`${slug}\` is already running — wait for it to finish; see ${interrogateLogPath(opts.repoRoot, slug)}`,
    );
    return;
  }

  const planFile = resolvePlanBySlug(opts, slug);
  if (!planFile) {
    refuse(
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be resolved to a file — refusing rather than interrogating a plan that is not there`,
    );
    return;
  }

  const prompt = composeInterrogatePrompt(path.relative(opts.repoRoot, planFile));
  const promptPath = interrogatePromptPath(opts.repoRoot, slug);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = interrogateLogPath(opts.repoRoot, slug);
  const statePath = interrogateStatePath(opts.repoRoot, slug);
  try {
    // Truncated, not appended — this log is read back AS the answer. Created
    // and marked BEFORE the 202, so a second POST reads this run as running.
    fs.rmSync(statePath, { force: true });
    fs.writeFileSync(log, '', 'utf8');
    markBoardRun(statePath, log);
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // THROUGH THE `agentRun` PORT, in the board's process group; the run is not
  // awaited before the 202. `Interrogate command` is a shell fragment, and
  // nothing from the request is interpolated into it: the prompt travels as a
  // file, its path as one argument and in the environment.
  await startBoardRun(opts, {
    role: 'interrogate',
    fragmentKey: INTERROGATE_COMMAND_KEY,
    readCfg,
    tree: opts.repoRoot,
    prompt: `Read ${promptPath} and follow it.`,
    env: {
      PLOT_UNATTENDED: '1',
      PLOT_INTERROGATE_PROMPT: promptPath,
      PLOT_PLAN_SLUG: slug,
    },
    logFile: log,
    statePath,
  });

  json(202, { ok: true, slug, prompt: promptPath, log });
};

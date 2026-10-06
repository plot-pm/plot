import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogPath } from './agent-log.js';
import { agentRunFor, readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { readPhase } from './transition.js';
import { ideaAvailability, lastLines, usableCommand, type IdeaState } from './idea.js';
import { writtenPathResolution } from '@plot-pm/domain/rules/written-path';

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
 * Where the run's state goes: absent while running, then `0` or `1` once the
 * `agentRun` port's promise settles.
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
 * The port writes no `running <pid>` state: its promise settles the state
 * file to `0` or `1` only once the run ends. A log with no state file yet is
 * the running case, the same reading {@link ideaStatus} uses.
 */
export const interrogateStatus = (opts: BuildBoardOptions, slug: string): InterrogateStatus => {
  const log = interrogateLogPath(opts.repoRoot, slug);
  let recorded = '';
  try {
    recorded = fs.readFileSync(interrogateStatePath(opts.repoRoot, slug), 'utf8').trim();
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
    fs.rmSync(statePath, { force: true });
  } catch {
    /* no prior state to clear */
  }

  const writeState = (value: string) => {
    try {
      fs.writeFileSync(statePath, value, 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  };
  const appendLog = (message: string) => {
    try {
      fs.appendFileSync(log, `\n${message}\n`, 'utf8');
    } catch {
      /* nothing further to do */
    }
  };

  // ROUTED THROUGH THE `agentRun` PORT, never a raw `spawn` — the same shape
  // `idea.ts` established. STAYS IN THE BOARD'S PROCESS GROUP: no `detached`,
  // and `run(...)`'s promise is deliberately not awaited before the 202
  // answers.
  const choice = await agentRunFor(opts, 'interrogate', INTERROGATE_COMMAND_KEY, readCfg);
  if (choice.runner === 'refused' || choice.agentRun === undefined) {
    appendLog(choice.reason);
    writeState('1');
  } else {
    const agentRun = choice.agentRun;
    void agentRun
      .run({
        worktree: opts.repoRoot,
        prompt: `Read ${promptPath} and follow it.`,
        resumeId: '',
        role: 'interrogate',
        harness: '',
        model: '',
        effort: '',
        maxTurns: 0,
        maxSpendUsd: 0,
        boundSeconds: 0,
        contextWindow: 0,
        capabilities: [],
        env: {
          ...process.env,
          PLOT_UNATTENDED: '1',
          PLOT_INTERROGATE_PROMPT: promptPath,
          PLOT_PLAN_SLUG: slug,
        },
        logFile: log,
      })
      .then((result) => {
        if (!result.ok) {
          appendLog(`interrogate run failed: ${result.why}`);
          writeState('1');
          return;
        }
        const end = result.value.end;
        if (end.answer !== 'ran') {
          appendLog(`interrogate run ended without running: ${end.answer}`);
          writeState('1');
          return;
        }
        const handBack = end.handBack;
        // The `command` runner never parses a hand-back — a `null` answer on
        // exit 0 is the pre-port success case. Only the `sdk` runner's
        // structured protocol makes `null` a failure.
        if (handBack === null) {
          if (choice.runner === 'sdk') {
            appendLog('interrogate run ended with no written hand-back');
            writeState('1');
            return;
          }
          writeState('0');
          return;
        }
        if (!('written' in handBack)) {
          appendLog('interrogate run ended with no written hand-back');
          writeState('1');
          return;
        }
        const resolution = writtenPathResolution(handBack.written, opts.repoRoot);
        if (!resolution.inside) {
          appendLog(`interrogate run's written path was refused: ${resolution.reason}`);
          writeState('1');
          return;
        }
        writeState('0');
      })
      .catch((err) => {
        console.error('interrogate run failed:', err);
        appendLog(err instanceof Error ? err.message : String(err));
        writeState('1');
      });
  }

  json(202, { ok: true, slug, prompt: promptPath, log });
};

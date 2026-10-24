import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { agentLogPath } from './agent-log.js';
import { hostFor, readConfig, treesFor, type BuildBoardOptions } from './board.js';
import { markBoardRun, readRunState, startBoardRun, STOPPED_RECORD } from './board-run.js';
import { isSameOrigin, readJsonBody, SLUG_RE } from './dispatch.js';
import { ideaAvailability, lastLines, usableCommand, type IdeaState } from './idea.js';
import { PlanMetaSchema } from '../contract/schema.js';

/**
 * Interrogating a Draft plan: `POST /api/interrogate` runs the configured
 * `Interrogate command` with a prompt asking for `/challenge-the-plan <plan path>`.
 *
 * The shape is `reslice.ts`'s: slug-scoped, Draft-only, a plot agent started
 * through the `agentRun` port and answered 202, and a slug-keyed status
 * read-back. The guards are imported from `dispatch.ts` and `idea.ts`, not
 * copied.
 *
 * Under `Plan PRs: required` a Draft plan exists only on its `idea/<slug>`
 * branch until that PR merges, so the route asks the `host` port for it
 * first. Found, it runs the command in a worktree of the PR's head; absent —
 * an answered "no open plan PR" — it falls back to `opts.repoRoot` as before.
 * A host that cannot answer refuses `plan-unreadable` naming its reason,
 * never silently falling back. This is the read half only: the worktree and
 * its branch are left behind for a later wave to push the panel's artifacts
 * from, and this module decides nothing about when or whether that happens.
 *
 * The route decides nothing about the plan either. The skill writes five
 * artifacts: the verdict files, `panel.md`, the plan's `Rounds:` increment,
 * the Open Points section in the plan body, and the
 * `CHALLENGE-THE-PLAN-METADATA` block beside `Rounds:`. This module writes
 * only the prompt, the log and the state file, all outside the repository.
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
 * The plan file a slug names under `root`: the active index first, then the
 * date-prefixed file in the plan directory. The same two candidates, in the
 * same order, as `transition.ts`'s `readPhase` — but parameterized by the root
 * to read, which `readPhase` is not. `root` is `opts.repoRoot` on the fallback
 * path and a plan-PR worktree otherwise, so this cannot reuse `readPhase`
 * unmodified without widening it for every other caller, which the brief
 * forbids. The phase check and the prompt below both call this, so they name
 * one file.
 */
const resolvePlanInRoot = (opts: BuildBoardOptions, root: string, slug: string): string | null => {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const activeDir = readConfig(opts, 'Active index', 'docs/plans/active/');

  const active = path.join(root, activeDir, `${slug}.md`);
  if (fs.existsSync(active)) return active;

  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(root, planDir));
  } catch {
    return null;
  }
  const hit = entries.find((e) => e.endsWith(`${slug}.md`));
  return hit ? path.join(root, planDir, hit) : null;
};

/**
 * The plan's phase at `file`, read through `root`'s own `plot-plan-meta.sh` —
 * never `opts.repoRoot`'s, so a plan read from a worktree is parsed by the
 * copy of the parser checked out there. Null where the file cannot be found
 * or parsed.
 */
const readPhaseAt = (opts: BuildBoardOptions, root: string, file: string): string | null => {
  try {
    const answer = scriptsShell({ repoRoot: root, scriptDir: opts.scriptsDir }).planMetaSync([file], {
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!answer.ok) return null;
    const line = answer.value.split('\n').map((l) => l.trim()).find(Boolean);
    if (!line) return null;
    return PlanMetaSchema.parse(JSON.parse(line)).phase || null;
  } catch {
    return null;
  }
};

/** Where the slug's open plan PR was found, or why it was not used. */
export type PlanPrLookup =
  /** An open PR named `idea/<slug>` exists; the route reads its head. */
  | { kind: 'found'; head: string }
  /** The host answered: no open plan PR. Fall back to the main checkout. */
  | { kind: 'none' }
  /** The host could not be asked. Refuse rather than guess. */
  | { kind: 'refused'; detail: string };

/**
 * Asks the host for the slug's plan PR — `idea/<slug>`, open, and nothing
 * else: the Draft-plan case this wave covers never needs the merged-PR trace
 * `planPrOf` in `plan-pr.ts` performs for a plan already on the default
 * branch, because a Draft plan under `Plan PRs: required` has no other
 * candidate. An open PR whose head is not `idea/<slug>` is not a plan PR.
 *
 * Reads `host.lastRefusal()` from the SAME instance that made the call —
 * `hostFor` builds a fresh adapter per call, so a second call would not see
 * the first's refusal.
 */
const resolveInterrogatePlanPr = async (opts: BuildBoardOptions, slug: string): Promise<PlanPrLookup> => {
  const host = hostFor(opts);
  const branch = `idea/${slug}`;
  const lookup = await host.prState(branch);
  if (!lookup.ok) {
    const said = host.lastRefusal()?.said ?? '';
    return {
      kind: 'refused',
      detail: `the host could not be asked for the PR of '${branch}' (plot-host.sh pr-state refused the call).${said ? ` ${said}` : ''}`,
    };
  }
  const pr = lookup.value;
  if (pr !== null && pr.state === 'OPEN') return { kind: 'found', head: branch };
  return { kind: 'none' };
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

/** Where the route found the plan to read and run against. */
interface InterrogateTarget {
  /** The checkout to read the plan from, and to run the command in: `opts.repoRoot`, or a worktree of the plan PR's head. */
  root: string;
  /** The plan PR's head branch, where one was used; empty on the main-checkout fallback. */
  head: string;
}

/**
 * Prepares a worktree of `head`'s remote branch at `path`, fetching first.
 *
 * Left behind on return, uncleaned: wave 2 pushes the panel's artifacts from
 * it, and cleaning it up here would remove what that wave needs to find.
 *
 * @returns the worktree path on success, or null naming no further detail —
 *   the caller refuses `plan-unreadable` either way.
 */
const prepareInterrogateWorktree = async (
  opts: BuildBoardOptions,
  slug: string,
  head: string,
): Promise<string | null> => {
  const trees = treesFor(opts);
  const fetched = await trees.fetch(opts.repoRoot, head);
  if (!fetched.ok) return null;
  const root = deskRoot({ configured: readConfig(opts, 'Worktree root', ''), repoRoot: opts.repoRoot });
  const tree = path.join(root, `.plot-interrogate-${slug}.${process.pid}`);
  const added = await trees.addBranch(tree, head, `origin/${head}`);
  return added.ok ? tree : null;
};

/** The facts this route reads from outside itself, injectable for test. */
export interface InterrogateDeps {
  /** Reads a `## Plot Config` key. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The plan's current phase, or null when it cannot be read. */
  phase?: (opts: BuildBoardOptions, slug: string) => string | null;
  /** The slug's open plan PR, or why none was used. */
  resolvePlanPr?: (opts: BuildBoardOptions, slug: string) => Promise<PlanPrLookup>;
  /** Builds the worktree a found plan PR is read and run from. */
  prepareWorktree?: (opts: BuildBoardOptions, slug: string, head: string) => Promise<string | null>;
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
  const resolvePlanPr = deps.resolvePlanPr ?? resolveInterrogatePlanPr;
  const prepareWorktree = deps.prepareWorktree ?? prepareInterrogateWorktree;
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

  // One panel per plan: two panels writing one subject directory interleave
  // their verdict files, and the moderator reads a mixture. Keyed by slug and
  // `opts.repoRoot` alone — a run resolving to a worktree still shares one
  // log and state path with a run resolving to the main checkout, so a second
  // POST while the first is still choosing its root is still caught.
  if (interrogateStatus(opts, slug).state === 'running') {
    refuse(
      'already-running',
      slug,
      `a panel for \`${slug}\` is already running — wait for it to finish; see ${interrogateLogPath(opts.repoRoot, slug)}`,
    );
    return;
  }

  // THE PLAN PR'S HEAD IS THE SOURCE, NOT THE MAIN CHECKOUT. A Draft plan
  // under `Plan PRs: required` exists only on `idea/<slug>` until that PR
  // merges — the main checkout cannot hold it. Absent is not false: a host
  // that cannot answer refuses here, naming its reason, rather than being
  // read as "no plan PR" and falling back to a stale or missing file.
  const lookup = await resolvePlanPr(opts, slug);
  if (lookup.kind === 'refused') {
    refuse('plan-unreadable', slug, lookup.detail);
    return;
  }
  let target: InterrogateTarget;
  if (lookup.kind === 'found') {
    const tree = await prepareWorktree(opts, slug, lookup.head);
    if (tree === null) {
      refuse(
        'plan-unreadable',
        slug,
        `plan \`${slug}\`'s PR branch '${lookup.head}' could not be checked out into a worktree — refusing rather than interrogating a plan that could not be read from its own branch`,
      );
      return;
    }
    target = { root: tree, head: lookup.head };
  } else {
    target = { root: opts.repoRoot, head: '' };
  }

  // The phase read and the prompt below both resolve the plan through
  // `target.root` — never a mix of the worktree for one and the main checkout
  // for the other. `deps.phase` overrides the whole lookup (file + phase)
  // only on the fallback root, matching its existing test contract.
  const readPh = deps.phase !== undefined && target.head === ''
    ? deps.phase
    : (o: BuildBoardOptions, s: string): string | null => {
      const file = resolvePlanInRoot(o, target.root, s);
      return file === null ? null : readPhaseAt(o, target.root, file);
    };

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

  const planFile = resolvePlanInRoot(opts, target.root, slug);
  if (!planFile) {
    refuse(
      'plan-unreadable',
      slug,
      `plan \`${slug}\` could not be resolved to a file — refusing rather than interrogating a plan that is not there`,
    );
    return;
  }

  const prompt = composeInterrogatePrompt(path.relative(target.root, planFile));
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
  // file, its path as one argument and in the environment. `tree` is the
  // worktree a found plan PR resolved to, or `opts.repoRoot` on the fallback
  // — never the other way around, so `/challenge-the-plan` edits the plan
  // where it was read.
  await startBoardRun(opts, {
    role: 'interrogate',
    fragmentKey: INTERROGATE_COMMAND_KEY,
    readCfg,
    tree: target.root,
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

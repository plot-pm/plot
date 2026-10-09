import fs from 'node:fs';
import { agentLogPath } from './agent-log.js';
import { markBoardRun, startBoardRun, writeState, type BoardConfigReader } from './board-run.js';
import { readConfig, type ConfigReadOptions } from './config-reader.js';

/**
 * Starting `/plot-implement` for a plan and recording how the run ended — the
 * part of a dispatch that is not HTTP. The board's routes and the dispatch
 * command both start it here.
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
 * @param opts - where the repository and its scripts are; `repoRoot` names the log.
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
  opts: ConfigReadOptions,
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

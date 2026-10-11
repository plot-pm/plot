import fs from 'node:fs';
import { agentLogPath } from './agent-log.js';
import { alive, markBoardRun, startBoardRun, writeState, type BoardConfigReader } from './board-run.js';
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
export const implementLogPath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'implement', slug, 'log');

/**
 * Where the outcome is recorded, so a later GET can read it back.
 *
 * EXPORTED since `a-dispatch-does-not-hold-the-loop`, because `/api/dispatch`
 * runs the same command into the same log and now reads its outcome back
 * through the state file. A dispatch that left this file alone would
 * be read through an earlier `/api/implement`'s exit code — or, with no earlier
 * run, as `running` forever, since the log exists and no state file does.
 */
export const implementStatePath = (repoRoot: string, slug: string): string =>
  agentLogPath(repoRoot, 'implement', slug, 'state');

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
export const composeImplementPrompt = (slug: string): string =>
  `Run /plot-implement ${slug} --brief-only and follow it.`;

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
 * Whether an implement run for `slug` is alive, in any process on this machine.
 *
 * Reads the plan-keyed state file {@link startImplement} takes with `O_EXCL`
 * and answers `true` only where it reads `running <pid>` and that pid is
 * alive. A recorded exit code, a missing file and a dead pid all read as not
 * running, so a crashed run does not hold its slug.
 *
 * NOT {@link readRunState}: that answers *what happened to the run I started?*,
 * and reads a log with no state file as `running`. A lock must not.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @returns whether a live process holds the slug's implement lock.
 */
export const implementRunning = (repoRoot: string, slug: string): boolean => {
  let recorded: string;
  try {
    recorded = fs.readFileSync(implementStatePath(repoRoot, slug), 'utf8').trim();
  } catch {
    return false;
  }
  const marker = /^running (\d+)$/.exec(recorded);
  return marker !== null && alive(Number(marker[1]));
};

/** What {@link startImplement} could not do before the child existed. */
export interface ImplementStartFailure {
  /** The message to report, already suitable for an operator. */
  detail: string;
  /** Set where another live run holds the slug's lock, so the caller refuses rather than fails. */
  running?: true;
}

/**
 * Start `/plot-implement <slug>` through the `agentRun` port, and record its
 * outcome where {@link readRunState} reads it back.
 *
 * ONE START FOR TWO ROUTES. `/api/implement` and `/api/dispatch` run the SAME
 * command through the SAME prompt into the SAME log, so the state file the
 * status route reads is written for both.
 *
 * The state file is TAKEN with `O_EXCL` as `running <pid>` first, and the log
 * truncated second: a start that loses the race to a live run fails with
 * `running` set and has destroyed nothing of the winner's. A file left by a
 * finished or dead run is removed before the take. Both files are read back as
 * the answer, and a stale one reports a previous attempt's outcome for this one. The run stays in the board's
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
    if (implementRunning(opts.repoRoot, slug)) throw Object.assign(new Error('running'), { code: 'EEXIST' });
    fs.rmSync(statePath, { force: true });
    markBoardRun(statePath, log, true);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        failure: { detail: `an implement for \`${slug}\` is already running — see ${log}`, running: true },
      };
    }
    return { failure: { detail: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` } };
  }
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later success.
    fs.rmSync(implementBranchRecordPath(opts.repoRoot, slug), { force: true });
    fs.writeFileSync(log, '', 'utf8');
    if (branch !== null && branchStatePath !== null) {
      fs.writeFileSync(implementBranchRecordPath(opts.repoRoot, slug), branch, 'utf8');
      markBoardRun(branchStatePath, log);
    }
  } catch (err) {
    writeState(statePath, 1);
    return { failure: { detail: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` } };
  }

  // NOTHING from the request is interpolated into a shell string: the prompt
  // names the slug, which is `SLUG_RE`-bounded, and travels as ONE argument.
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
      // The plan-keyed state file already records the end, which releases the
      // slug; the branch-keyed one follows before anything that can throw.
      writeState(branchStatePath, record.code);
      onExit?.(record.code);
    },
  );
  return { log };
};

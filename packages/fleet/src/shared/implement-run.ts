import fs from 'node:fs';
import {
  decodeImplementHolder,
  encodeImplementHolder,
  implementLockHeld,
  type ImplementHolder,
  type LockedProcess,
  type ProcessProbe,
  type ProcessSighting,
} from '@plot-pm/domain';
import { processProbeSystem } from '@plot-pm/domain/adapters/process-probe/process-probe-system';
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
 * standing rule is one capability, one key. `/api/reslice` reuses
 * `Idea command` because reslicing IS the idea binding (the same agent that
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
 * `/api/implement`, `/api/dispatch` and the dispatch command write it for every
 * run they start: `running <pid>` while the run lives, its exit code after. The
 * status route and the dispatch command's start wait read it back.
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
 * The longest a lock holds its slug, in milliseconds: the run's own bound and
 * one minute for the start and the record.
 */
export const IMPLEMENT_LOCK_BOUND_MS = IMPLEMENT_TIMEOUT_MS + 60_000;

/** How old a take's guard file must be before another take removes it, in milliseconds. */
const GUARD_STALE_MS = 10_000;

/**
 * Where the implement lock for a plan is, beside its state file. It holds one
 * {@link ImplementHolder} line while a run holds the slug.
 */
export const implementLockPath = (repoRoot: string, slug: string): string =>
  `${implementStatePath(repoRoot, slug)}.lock`;

/** The seams a test replaces in the implement lock. */
export interface ImplementLockDeps {
  /** The process table; {@link processProbeSystem} where absent. */
  probe?: ProcessProbe;
  /** The clock the lock's age is read against; `Date.now` where absent. */
  now?: () => number;
  /**
   * Called inside a take that found a stale lock: `stale-read` after the lock
   * read stale and before the guard is taken, `guarded` after the guard is
   * taken and the lock read stale again, before it is replaced.
   */
  onStep?: (step: 'stale-read' | 'guarded') => void;
}

/** The lock file's text; `null` where there is none. */
const readLock = (lock: string): string | null => {
  try {
    return fs.readFileSync(lock, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

/** Whether the lock text names a run that still holds the slug. A text that is no record holds nothing. */
const lockHolds = (text: string, probe: ProcessProbe, now: number): boolean => {
  const holder = decodeImplementHolder(text);
  if (holder === null) return false;
  const sight = (recorded: LockedProcess): ProcessSighting => {
    const alive = probe.alive(recorded.pid);
    return { alive, startedAt: alive === true ? probe.startedAt(recorded.pid) : null };
  };
  return implementLockHeld(
    holder,
    {
      holder: sight(holder),
      agent: holder.agent === null ? null : sight(holder.agent),
      groupAlive: holder.pgid === null ? false : probe.groupAlive(holder.pgid),
    },
    now,
    IMPLEMENT_LOCK_BOUND_MS,
  );
};

/**
 * Publishes `text` under `lock` where no file has the name: written whole to a
 * scratch file, then linked into place, so a reader never sees a partial record.
 *
 * @returns `true` where the lock is now `text`, `false` where a file had the name.
 */
const publishLock = (lock: string, text: string): boolean => {
  const scratch = `${lock}.${process.pid}.tmp`;
  fs.writeFileSync(scratch, text, 'utf8');
  try {
    fs.linkSync(scratch, lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
};

/**
 * Takes the guard that serialises replacing a stale lock: `guard` created with
 * `O_EXCL`. A guard older than {@link GUARD_STALE_MS} is moved aside and the
 * create tried once more; a guard moved aside that turns out fresh is linked
 * back.
 *
 * @returns `true` where this take holds the guard, `false` where another does.
 */
const takeGuard = (guard: string): boolean => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(guard, '', { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const aside = `${guard}.${process.pid}.stale`;
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs < GUARD_STALE_MS) return false;
      fs.renameSync(guard, aside);
      if (Date.now() - fs.statSync(aside).mtimeMs < GUARD_STALE_MS) {
        fs.linkSync(aside, guard);
        return false;
      }
    } catch {
      /* another take moved or replaced the guard; the create is tried again */
    } finally {
      fs.rmSync(aside, { force: true });
    }
  }
  return false;
};

/**
 * Takes the implement lock for `slug` for this process.
 *
 * A free slug is taken by publishing the record. Where a lock exists and
 * {@link implementLockHeld} reads it as holding, the take answers `null`. A
 * stale lock is replaced only under the guard file, after reading it stale a
 * second time, so two takes that both read it stale cannot both replace it.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @param deps - test seams.
 * @returns this process's record, or `null` where another run holds the slug.
 * @throws where the lock's directory cannot be read or written.
 */
export const takeImplementLock = (
  repoRoot: string,
  slug: string,
  deps: ImplementLockDeps = {},
): ImplementHolder | null => {
  const probe = deps.probe ?? processProbeSystem();
  const now = deps.now ?? Date.now;
  const lock = implementLockPath(repoRoot, slug);
  const self = probe.self();
  const mine: ImplementHolder = {
    pid: self.pid,
    startedAt: self.startedAt,
    pgid: self.leadsGroup ? self.pid : null,
    at: now(),
    agent: null,
  };
  const text = encodeImplementHolder(mine);
  if (publishLock(lock, text)) return mine;
  const seen = readLock(lock);
  if (seen !== null && lockHolds(seen, probe, now())) return null;
  deps.onStep?.('stale-read');
  const guard = `${lock}.guard`;
  if (!takeGuard(guard)) return null;
  try {
    const current = readLock(lock);
    if (current !== null && lockHolds(current, probe, now())) return null;
    deps.onStep?.('guarded');
    fs.rmSync(lock, { force: true });
    return publishLock(lock, text) ? mine : null;
  } finally {
    fs.rmSync(guard, { force: true });
  }
};

/** Whether the lock text is the record `mine` took. */
const isMine = (text: string | null, mine: ImplementHolder): boolean => {
  const holder = text === null ? null : decodeImplementHolder(text);
  return holder !== null && holder.pid === mine.pid && holder.at === mine.at && holder.startedAt === mine.startedAt;
};

/**
 * Adds the run's agent process to the lock `mine` took, so the lock holds while
 * the agent lives even where the holder is gone. A lock that is no longer
 * `mine` is left alone.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @param mine - the record {@link takeImplementLock} returned.
 * @param agent - the agent's pid and start time.
 */
export const recordImplementAgent = (
  repoRoot: string,
  slug: string,
  mine: ImplementHolder,
  agent: LockedProcess,
): void => {
  const lock = implementLockPath(repoRoot, slug);
  const scratch = `${lock}.${process.pid}.agent.tmp`;
  try {
    if (!isMine(readLock(lock), mine)) return;
    fs.writeFileSync(scratch, encodeImplementHolder({ ...mine, agent }), 'utf8');
    fs.renameSync(scratch, lock);
  } catch {
    /* the holder's own record still holds the slug */
  } finally {
    fs.rmSync(scratch, { force: true });
  }
};

/**
 * Removes the lock `mine` took. A lock that is no longer `mine` is left alone.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @param mine - the record {@link takeImplementLock} returned.
 */
export const releaseImplementLock = (repoRoot: string, slug: string, mine: ImplementHolder): void => {
  const lock = implementLockPath(repoRoot, slug);
  try {
    if (isMine(readLock(lock), mine)) fs.rmSync(lock, { force: true });
  } catch {
    /* the lock's age bound frees the slug */
  }
};

/**
 * Whether an implement run for `slug` holds its lock, in any process on this
 * machine.
 *
 * Reads the lock file {@link takeImplementLock} writes and decides through
 * {@link implementLockHeld}. A missing, unreadable or unparseable lock holds
 * nothing.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param slug - the plan slug.
 * @param deps - test seams; `onStep` is not called.
 * @returns whether a run holds the slug's implement lock.
 */
export const implementRunning = (repoRoot: string, slug: string, deps: ImplementLockDeps = {}): boolean => {
  try {
    const text = readLock(implementLockPath(repoRoot, slug));
    return text !== null && lockHolds(text, deps.probe ?? processProbeSystem(), (deps.now ?? Date.now)());
  } catch {
    return false;
  }
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
 * The implement lock is TAKEN first ({@link takeImplementLock}), then the
 * state file reads `running <pid>`, and the log is truncated last: a start that
 * loses the race to a live run fails with `running` set and has destroyed
 * nothing of the winner's. The lock names the agent process once it starts and
 * is removed when the run ends. Both the state file and the log are read back
 * as the answer, and a stale one reports a previous attempt's outcome for this
 * one. The run stays in the caller's process group, bounded by
 * {@link IMPLEMENT_TIMEOUT_MS}; a run ended on the bound records `124`.
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
 * @param lockDeps - the implement lock's test seams.
 * @returns the log path, or a failure where the lock or the log could not be written.
 */
export const startImplement = (
  opts: ConfigReadOptions,
  slug: string,
  command: string,
  onExit?: (code: number) => void,
  readCfg: BoardConfigReader = readConfig,
  branch: string | null = null,
  lockDeps: ImplementLockDeps = {},
): { log: string } | { failure: ImplementStartFailure } => {
  const log = implementLogPath(opts.repoRoot, slug);
  const statePath = implementStatePath(opts.repoRoot, slug);
  const branchStatePath = branch === null ? null : implementBranchStatePath(opts.repoRoot, slug, branch);
  const cannotOpen = (err: unknown): { failure: ImplementStartFailure } => ({
    failure: { detail: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` },
  });
  let mine: ImplementHolder | null;
  try {
    mine = takeImplementLock(opts.repoRoot, slug, lockDeps);
  } catch (err) {
    return cannotOpen(err);
  }
  if (mine === null) {
    return { failure: { detail: `an implement for \`${slug}\` is already running — see ${log}`, running: true } };
  }
  const held = mine;
  const release = (): void => releaseImplementLock(opts.repoRoot, slug, held);
  try {
    markBoardRun(statePath, log);
  } catch (err) {
    release();
    return cannotOpen(err);
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
    release();
    return cannotOpen(err);
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
      onStarted: (pid) => recordImplementAgent(opts.repoRoot, slug, held, { pid, startedAt: Date.now() }),
    },
    (record) => {
      // The plan-keyed state file already records the end; the branch-keyed
      // one and the lock follow before anything that can throw.
      writeState(branchStatePath, record.code);
      release();
      onExit?.(record.code);
    },
  ).then((runner) => {
    // A run this process left to the board calls no end handler.
    if (runner === 'refused') release();
  });
  return { log };
};

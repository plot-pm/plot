import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readConfig } from './config-reader.js';
import { markerIn } from './worker-question.js';
import { deskManifestFor, assignEmptyManifestBranch, writeDeskManifest, writeManifestStamp, writeResumeId } from './manifest-stamp.js';
import { briefPath } from './brief-path.js';
import { deskMonitorsShell, transcriptDirFor, TRANSCRIPT_HOME_ENV } from '@plot-pm/domain/adapters';
import type { DeskMonitors, MonitoredDesk, MonitorPids, ProcessProbe } from '@plot-pm/domain';
import { deskWaitsFree, FREE_WAIT_FILENAME } from '@plot-pm/domain/rules/desk-loop-alive';
import { deskFreeWait, readDeskLoop } from './desk-loop.js';
import { continueTarget } from '@plot-pm/domain/rules/continue-target';
import { readEnding, ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { endingAsksFreshStart } from '@plot-pm/domain/rules/ending-action';
import { readDeskPid, resolveManifestDir } from './registry.js';
import { processProbeSystem } from '@plot-pm/domain/adapters/process-probe/process-probe-system';
import { takeContinueLock, releaseContinueLock } from './continue-lock.js';
import { CONTINUATION_NAME } from './continuation-name.js';
import { runLimitRefusal, DEFAULT_SLICE_MAX_RUNS } from '@plot-pm/domain/rules/run-limit';
import { sliceSpendRefusal } from '@plot-pm/domain/rules/slice-spend-refusal';
import { readSliceSpend } from '@plot-pm/domain/workflows/slice-spend';
import { sliceSpendFile } from '@plot-pm/domain/adapters';
import { MAIN_CHECKOUT_WRITER_ENV } from '@plot-pm/domain/rules/main-checkout-write';

/**
 * Starting a continuation on one desk — the non-HTTP half of `/api/continue`.
 *
 * `continue.ts`'s `handleContinue` is the route; this module is what it calls,
 * and what the registry tick calls for a desk whose ending earns a fresh
 * session. Nothing here imports `node:http`, `dispatch.ts` or `fleet.ts` — the
 * split exists so a non-board entry (`registryd-main.ts`) can hold the engine
 * without holding the route.
 */

/** Where the repository and its scripts directory are, for {@link continueOnDesk}. */
export interface ContinuationOptions {
  repoRoot: string;
  scriptsDir: string;
}

export { CONTINUATION_NAME };

/**
 * The environment variable naming the prompt file, for the `Worker command` to
 * read.
 *
 * Beside `PLOT_BRANCH` and `PLOT_WORKTREE`, which the dispatcher already
 * exports, and it is passed on EVERY continuation and never on a first run —
 * so a worker command can tell the two apart without being told.
 */
export const CONTINUATION_ENV = 'PLOT_CONTINUATION';

/**
 * How much of an answer to accept, in characters.
 *
 * An answer is a person unblocking an agent, not a document: the questions
 * these markers carry are *which adapter*, *is this in scope*, *pick one of
 * three*. 8 KiB is far more than any of those and far less than a paste of
 * something that should have been a brief. It is checked BEFORE the 4 KiB body
 * bound would reject it, so a caller gets *the answer is too long* rather than
 * *body too large* — the first is actionable and the second is a transport
 * error about a field it does not name.
 *
 * The body limit is raised for this route alone to make room for it: 4 KiB is
 * `/api/dispatch`'s bound for a one-word slug, and an answer legitimately needs
 * more. The bound still EXISTS, which is the property that matters — see
 * {@link BODY_LIMIT}.
 */
export const ANSWER_MAX = 8 * 1024;

/**
 * The request body bound for this route.
 *
 * Larger than `/api/dispatch`'s default because the field is larger, and
 * derived from {@link ANSWER_MAX} rather than picked independently so the two
 * cannot drift into a state where the body limit rejects an answer the answer
 * limit would have allowed. The headroom covers the JSON framing and the branch
 * name.
 */
export const BODY_LIMIT = ANSWER_MAX + 4096;
/** Why a continuation was refused — each sends the reader somewhere different. */
export type ContinueRefusal =
  /** The pulse has never mentioned this branch. */
  | 'unknown-branch'
  /** The pulse knows the branch; this machine holds no worktree for it. */
  | 'no-worktree'
  /**
   * The worktree is here and holds no unanswered question.
   *
   * **The one refusal that is about the WORK rather than about this machine**,
   * and the reason it is a refusal at all is in {@link handleContinue}.
   */
  | 'no-question'
  /** No `Worker command` is configured, so nothing can be started. */
  | 'no-worker-command'
  /**
   * No manifest names this desk, or more than one does.
   *
   * **A CONTINUATION NEEDS ONE NAME TO STAMP**, because the new worker's
   * `PLOT_MANIFEST_FILE` is what lets its own wait end honestly if that
   * manifest later vanishes — see `loopRegistration`. `unnamed` is an
   * unregistered desk; `several` is an estate defect, two agents answering for
   * one worktree. Neither is tie-broken: a first match would hide the defect,
   * and the plan's second Open Point keeps this refusal rather than a guess.
   */
  | 'no-manifest'
  /**
   * A live process already holds this desk.
   *
   * **Refuse, never stop.** A stop can land mid-turn and lose work in
   * progress, so this route never signals the old loop — the caller who wants
   * it gone stops it and asks again. The detail names the pid found alive and
   * which of the three sources recorded it, so a person can act on it; a
   * recycled pid (a stale record whose number a new, unrelated process now
   * holds) reads the same way and is accepted, because a wrongly-skipped
   * refusal — a second loop on the desk — is the worse failure.
   */
  | 'loop-alive'
  /**
   * The slice has already started `Slice max runs` runs.
   *
   * **The limit wins over a person's answer, unconditionally.** A continuation
   * is itself a run, so one that would be the run AT the limit is refused
   * before it starts rather than let the slice overrun by one. There is no
   * bypass: a person who wants another run raises the limit and asks again.
   */
  | 'run-limit'
  /**
   * The slice's recorded spend has already reached `Slice max spend`.
   *
   * Refused the same way `run-limit` is, and for the same reason: the limit
   * wins. A project with no `Slice max spend` configured is never refused this
   * way — `sliceSpendRefusal` reads an unconfigured limit as "no limit", not
   * as zero.
   */
  | 'spend-limit';
/** How many commits the prompt names before it says there are more. */
export const COMMIT_MAX = 40;

/**
 * What the previous run left in git, as one line per commit — newest last.
 *
 * **THIS IS THE "what already landed" HALF OF THE PROMPT, and it is read from
 * git rather than carried from the previous run.** That choice is the slice's
 * central one, and the reasoning is worth keeping next to the code: a worker
 * that ran an hour produces a six-figure-token transcript, and handing it over
 * fills the new worker's context before it begins. What the previous run
 * COMMITTED is already in git — durable, current, and re-derivable — and the
 * worker reads it anyway. A copied transcript can go stale; a commit range
 * cannot.
 *
 * Subjects only, never diffs. The new worker has the tree checked out in front
 * of it; naming what landed orients it, and pasting the contents would be the
 * same context-filling mistake one layer down.
 *
 * Bounded at {@link COMMIT_MAX} because a long-running branch can hold many
 * commits and the prompt is a briefing, not a changelog. The count is stated
 * when it truncates — see {@link composeContinuation} — so the worker knows it
 * is seeing the recent end rather than the whole.
 *
 * `""` ON ANY FAILURE, and the caller renders that as *nothing has landed yet*
 * rather than as an error. A continuation whose git read failed is still worth
 * starting: the brief and the answer are the parts that cannot be recovered by
 * looking, and the commits are the part the worker can read for itself.
 */
export function landedCommits(worktree: string, main: string, max = COMMIT_MAX): string[] {
  // `main..HEAD` — what this branch has that the trunk does not, which is
  // exactly "what this run landed" for a freshly dispatched branch. A worktree
  // whose main ref is unknown falls back to the branch's own recent history
  // rather than to nothing: over-reporting a few commits is a smaller error
  // than reporting none, because the worker can see the difference and a silent
  // empty list looks like a clean start.
  const ranges = main ? [`${main}..HEAD`, 'HEAD'] : ['HEAD'];
  for (const range of ranges) {
    try {
      const out = execFileSync(
        'git',
        ['-C', worktree, 'log', '--no-merges', `--max-count=${max}`, '--format=%h %s', range],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const lines = out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      // An empty `main..HEAD` is a REAL answer — the branch has landed nothing —
      // so it is returned rather than falling through to the wider range. Only
      // a git that FAILED (throw) moves on.
      return lines.reverse();
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * The continuation prompt: the brief, the answer, and what already landed.
 *
 * **THIS FUNCTION IS THE DECISION THE INTERROGATION TURNED ON**, and it is pure
 * so that the decision is testable rather than merely documented. Three sources
 * go in and the previous run's transcript is not among them:
 *
 * | part | source | why not the transcript |
 * |---|---|---|
 * | the brief | `.plot/briefs/<slug>.md` | the specification, unchanged by the question |
 * | the answer | the person, just now | the new fact — the only thing that changed |
 * | what landed | `git log main..HEAD` | durable, current, and already in the tree |
 *
 * A transcript would be a fourth source that duplicates the third badly: it
 * describes work in prose that git records exactly, it can be six-figure
 * tokens, and it goes stale the moment anything is rebased. This is the same
 * rule that makes a plan reference a ticket instead of mirroring it.
 *
 * The brief is passed by PATH and by TEXT: the path so the worker can re-read
 * the whole of it, the text because a worker that has to fetch its own
 * specification before it can start is one round-trip from doing nothing.
 */
export function composeContinuation(input: {
  branch: string;
  briefPath: string;
  briefText: string;
  answer: string;
  question: string;
  landed: string[];
  /** True when {@link landedCommits} hit its bound and the list is the tail. */
  truncated?: boolean;
}): string {
  const { branch, briefPath, briefText, answer, question, landed } = input;
  const marker = question !== '';
  const parts: string[] = [];

  if (marker) {
    parts.push(
      `You are continuing work on the branch ${branch} in this worktree.`,
      '',
      // NAMED AS A CONTINUATION TO THE WORKER TOO, not only in the UI. A worker
      // told it is "replying" would look for a conversation to rejoin and find
      // none; told it is continuing, it reads the brief and carries on. The same
      // honesty the control's label owes the reader, the prompt owes the agent.
      'A previous worker on this branch stopped to ask a question. That worker has',
      'exited — you are a NEW run, not a reply to it, and there is no conversation',
      'to resume. The question has been answered below; your job is the work.',
      '',
    );
    parts.push('## The question that stopped the previous run', '', question, '');
  } else {
    parts.push(
      `You are continuing work on the branch ${branch} in this worktree.`,
      '',
      // A FRESH START, NOT A REPLY. There was no marker and no question — the
      // previous worker ran out of turns, spent its corrections, or left work
      // the fleet read as unlanded rather than stopping to ask anything. The
      // answer below is a person's steer for this new run, not a reply to a
      // question that was never written.
      'The previous worker on this branch ended its run without a question — it ran',
      'out of turns, spent its corrections, or left work the fleet could not take up',
      'on its own. You are a NEW run, starting fresh. A person has left guidance',
      'below; your job is the work.',
      '',
    );
  }

  parts.push('## The answer', '', answer.trim(), '');

  parts.push(
    '## What already landed on this branch',
    '',
    ...(landed.length === 0
      ? ['Nothing has been committed on this branch yet.']
      : [
          // The commits are NAMED, never pasted. See landedCommits.
          ...(input.truncated
            ? [`The most recent ${landed.length} commits (there are more before these):`, '']
            : []),
          ...landed.map((c) => `- ${c}`),
          '',
          'Read the tree and `git log` for the detail — it is all in this worktree.',
        ]),
    '',
  );

  parts.push(
    `## Your brief (${briefPath})`,
    '',
    // The brief is the specification and has not changed. It is included WHOLE
    // rather than summarised: summarising it here would be a second, drifting
    // copy of the thing /plot-implement wrote to be authoritative.
    briefText.trim() ||
      `The brief at ${briefPath} could not be read from this worktree — read it before starting.`,
    '',
  );

  if (marker) {
    parts.push(
      '## Before you finish',
      '',
      // THE MARKER IS THE WORKER'S TO CLEAR, and this line is why. See
      // handleContinue for the full reasoning and the alternative that was
      // rejected.
      'The blocked marker that stopped the previous run is still in this tree. It is',
      'yours to delete once you have acted on the answer above — while it stands, the',
      'fleet scan reads this branch as still waiting on a person.',
      '',
      'If you hit something new that a person must answer, write a fresh',
      'PLOT-BLOCKED: line with the question and stop, exactly as before.',
    );
  } else {
    parts.push(
      '## Before you finish',
      '',
      'There is no marker in this tree to clear — the previous run never wrote one.',
      '',
      'If you hit something a person must answer, write a fresh PLOT-BLOCKED: line',
      'with the question and stop.',
    );
  }

  return parts.join('\n');
}

/**
 * Where a branch's brief lives — `briefPath` under this module's own name.
 *
 * Re-exported rather than aliased away because `test/unit/continue.test.ts` and
 * this route both name it, and the composer reads a file where `attention.ts`
 * only reports a path. The computation is one function; the two callers differ
 * in what they do with it, not in what it returns.
 */
export const briefPathFor = briefPath;

/**
 * Read the brief from the WORKTREE, not from the board's own checkout.
 *
 * The worktree is the branch's own tree, so its brief is the one that branch
 * was actually given — which can differ from the board repo's copy when the
 * brief was amended after dispatch. `""` when it will not read; the composer
 * turns that into an instruction to go and read it, never into silence.
 */
export function readBrief(worktree: string, rel: string): string {
  try {
    return fs.readFileSync(path.join(worktree, rel), 'utf8');
  } catch {
    return '';
  }
}
/** What starting a continuation on one desk came to. */
export type DeskContinuation =
  | {
      kind: 'started';
      /** The NEW pid. A caller asserting a new run compares this to the old one. */
      pid: string;
      /** The pid this continuation replaced, so the answer names both. */
      previousPid: string;
      prompt: string;
      log: string;
      /** Set when the loop started but its manifest could not be stamped afterward; the registry row may still name the previous run. */
      warning?: string;
    }
  | { kind: 'refused'; status: number; reason: ContinueRefusal; detail: string }
  | { kind: 'failed'; error: string };

/** What {@link continueOnDesk} needs to start a continuation on a desk. */
export interface DeskContinuationInput {
  opts: ContinuationOptions;
  /** The configured-value reader; defaults to the board's own. */
  readCfg?: (opts: ContinuationOptions, key: string, fallback: string) => string;
  /** The branch the desk holds. */
  branch: string;
  /** The desk, absolute. */
  worktree: string;
  /** The default branch the landed commits are listed against, or `''` where unknown. */
  main: string;
  /** The pid of the run being replaced, or `''`. */
  previousPid: string;
  /** The answer the new run reads. */
  answer: string;
  /**
   * Starts a NEW conversation instead of continuing the manifest's own.
   *
   * The loop resumes the session its manifest's `resumeId` names whenever a
   * transcript exists for it. With `fresh`, the manifest's `resumeId` is
   * replaced by a new id before the start, so the loop finds no transcript and
   * creates a session. Absent or false, the manifest is left as it is.
   *
   * With `fresh`, the desk's ending can stand in for a missing
   * `PLOT-BLOCKED` marker; see {@link continueOnDesk}.
   */
  fresh?: boolean;
  /**
   * Runs after every refusal check has passed and before the first change to
   * the desk or the manifest. Returning false stops the start with a
   * `failed` result. A caller that records the start writes its record here,
   * so a start that throws afterwards cannot be repeated unrecorded.
   */
  beforeStart?: () => Promise<boolean>;
  /** Starts the AgentMonitor; defaults to the shell script under `scriptsDir`. */
  monitors?: DeskMonitors;
  /**
   * Stops a pid and waits for it to be gone; defaults to {@link stopAndAwaitExit}.
   *
   * Injected so a test can stop a real short-lived process without waiting on
   * production's poll interval, and so a test can assert the order — stop
   * completes before the manifest is touched — without a real exit to race.
   */
  stopLoop?: (pid: string) => Promise<LoopStop>;
  /**
   * The process table the wrapper pid is checked against before it is
   * signalled; {@link processProbeSystem} where absent.
   */
  probe?: ProcessProbe;
  /**
   * Called once {@link continueOnDesk} has taken the per-desk continue lock,
   * before any other read or write. A test uses this to force a second call
   * to reach its own lock-take while the first is held, so the race #1357
   * names is exercised deterministically rather than by real concurrency.
   */
  onLocked?: () => Promise<void>;
  /**
   * Spawns the worker command; defaults to `node:child_process`'s `spawn`.
   *
   * Injected so a test can make the spawn itself fail — a stub that emits
   * `'error'` instead of `'exit'`, the way a missing `sh` binary would — and
   * assert {@link continueOnDesk} still settles and releases the lock, rather
   * than needing a real broken `PATH` to provoke the same event.
   */
  spawn?: typeof spawn;
}

/**
 * The monitor pids a manifest records; `[]` when it cannot be read.
 *
 * READS `buildMonitorPid` TOO, though no current schema or type declares it
 * (`ProcessGroupSchema`'s own doc comment: an older wire payload still
 * carries the key). A desk dispatched before #1337 recorded one for a
 * `plot-build-monitor.sh` that no longer exists; its pid may be dead or
 * reused, so it is handed to the same `monitors.stop` the AgentMonitor pid
 * uses rather than signalled separately.
 */
const recordedMonitorPids = (manifestFile: string): string[] => {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
    return [m.agentMonitorPid, m.buildMonitorPid].filter((p): p is string => typeof p === 'string' && p !== '');
  } catch {
    return [];
  }
};

/** The desk's `.plot-worker.ending.json`, read as a value — `readEnding` as `registryd.ts` reads it. */
const deskEnding = (worktree: string): ReturnType<typeof readEnding> => {
  let text: string | null;
  try {
    text = fs.readFileSync(path.join(worktree, ENDING_FILENAME), 'utf8');
  } catch {
    text = null;
  }
  return readEnding(text);
};

/**
 * The newest non-subagent transcript's own handle for this desk, or `''`.
 *
 * A blocked desk's manifest is gone — the whole premise of a `write` verdict
 * — so the conversation to resume cannot be read off it. The runtime still
 * keeps the transcript under `~/.claude/projects/<slug>/<handle>.jsonl`, named
 * by `transcriptDirFor`, and a subagent's own file (`agent-*`) is excluded for
 * the reason `Transcript.quietSeconds` excludes it: it is a true statement
 * about the wrong process. The newest by mtime is the conversation the loop
 * most recently wrote, which is the one a continuation should resume.
 */
const resumeIdFromTranscript = (worktree: string): string => {
  const home = process.env[TRANSCRIPT_HOME_ENV] ?? os.homedir();
  const dir = transcriptDirFor(worktree, home);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return '';
  }
  let newest = '';
  let newestMs = -1;
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name.startsWith('agent-')) continue;
    try {
      const mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs;
      if (mtimeMs > newestMs) {
        newestMs = mtimeMs;
        newest = name.slice(0, -'.jsonl'.length);
      }
    } catch {
      continue;
    }
  }
  return newest;
};

/** What {@link stopAndAwaitExit} answers: the pid is gone, or why it is not. */
export type LoopStop = { ok: true } | { ok: false; why: string };

/** How long {@link stopAndAwaitExit} waits for a signalled loop to exit. */
const STOP_DEADLINE_MS = 10_000;

/**
 * Signals a pid with `SIGTERM` and waits for it to be gone — the stop
 * `continueTarget`'s `stop` instructs.
 *
 * `onStop` in `worker-loop.ts` removes `PLOT_MANIFEST_FILE` on `SIGTERM`, so
 * the caller restores that manifest after this returns.
 *
 * @param pid - the exact pid `deskLoopAlive` named; never any other.
 * @param pollMs - how often to re-check.
 * @param deadlineMs - how long to wait for the exit.
 * @returns `ok` once the pid reads `ESRCH`, including when it was gone before
 *   the signal; otherwise the reason, naming the pid — `EPERM` on the signal,
 *   or no exit within `deadlineMs`.
 */
export const stopAndAwaitExit = async (pid: string, pollMs = 50, deadlineMs = STOP_DEADLINE_MS): Promise<LoopStop> => {
  const n = Number(pid);
  try {
    process.kill(n, 'SIGTERM');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { ok: true };
    return { ok: false, why: `pid ${pid} cannot be signalled from the board (${code ?? String(err)})` };
  }
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      process.kill(n, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return { ok: true };
    }
    if (Date.now() >= deadline) {
      return { ok: false, why: `pid ${pid} did not exit within ${deadlineMs} ms of SIGTERM` };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

/** A manifest's text, or `null` when it cannot be read. */
const manifestText = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The manifest's `sliceRuns` count for `branch`.
 *
 * The same reading `worker-loop.ts`'s `sliceRunsOf` takes off the live
 * manifest, duplicated rather than imported: no module under `shared/` imports
 * an entry module under `server/entry/`.
 *
 * @param text - the manifest's raw text, or `null` when it could not be read.
 * @param branch - the branch whose count is asked for.
 * @returns the runs recorded for `branch`; `0` where the text is absent,
 *   unparsable, or counts a different branch.
 */
const sliceRunsFromManifest = (text: string | null, branch: string): number => {
  if (text === null) return 0;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const sliceRuns = raw.sliceRuns as { branch?: unknown; runs?: unknown } | undefined;
    return sliceRuns?.branch === branch && typeof sliceRuns.runs === 'number' && Number.isInteger(sliceRuns.runs)
      ? sliceRuns.runs
      : 0;
  } catch {
    return 0;
  }
};

/**
 * A config value read as a positive integer, or `fallback` where it is not
 * one — digits only, as `worker-loop.ts`'s `positive`/`count` read `/^\d+$/`.
 * Duplicated for the reason {@link sliceRunsFromManifest} gives: a bare
 * `Number()` would also accept `1e1`, `0x5`, and other numeric-literal forms
 * the loop's regex rejects, so the two readers must share the same grammar or
 * a value the loop falls back on is accepted here as real.
 */
const positiveOr = (raw: string, fallback: number): number => {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : fallback;
};

/**
 * A config value read as a dollar amount: `unset` where the key is absent or
 * blank (no limit), `value` for a positive amount, `unreadable` for anything
 * else present. The same three-way shape as `worker-loop.ts`'s
 * `dollarsOrUnset`, duplicated for the reason {@link sliceRunsFromManifest}
 * gives — a present-but-malformed value (`abc`, `0`, a negative number) must
 * refuse the continuation rather than read as "no limit".
 */
export type DollarsReading = { readonly kind: 'unset' } | { readonly kind: 'value'; readonly amount: number } | { readonly kind: 'unreadable' };

const dollarsOr = (raw: string): DollarsReading => {
  if (raw.trim() === '') return { kind: 'unset' };
  const match = /^\s*\$?\s*(-?\d+(?:\.\d+)?)\s*(?:usd)?\s*$/i.exec(raw);
  const n = match ? Number(match[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? { kind: 'value', amount: n } : { kind: 'unreadable' };
};

/**
 * Writes `text` back to `file` when the file is gone, atomically.
 *
 * @returns true when the file exists afterwards, false when it is gone and
 *   could not be written.
 */
const restoreManifest = (file: string, text: string): boolean => {
  if (fs.existsSync(file)) return true;
  const tmp = `${file}.plot-restore-tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean up */
    }
    return false;
  }
};

/** How many parents {@link descendsFrom} reads before it answers `false`. */
const ANCESTRY_STEPS_MAX = 32;

/**
 * Whether `ancestor` is a parent, or a parent's parent, of `pid`.
 *
 * @param probe - the process table.
 * @param pid - the process to start from.
 * @param ancestor - the process to look for among its ancestors.
 * @returns `true` where a walk of at most {@link ANCESTRY_STEPS_MAX} parents
 *   reaches `ancestor`; `false` where it reaches pid 1 or below, a parent
 *   cannot be read, or the walk runs out of steps.
 */
const descendsFrom = (probe: ProcessProbe, pid: number, ancestor: number): boolean => {
  let current: number | null = pid;
  for (let step = 0; step < ANCESTRY_STEPS_MAX && current !== null && current > 1; step += 1) {
    current = probe.parentPid(current);
    if (current === ancestor) return true;
  }
  return false;
};

/** Appends one line to the desk's log, or to the board's stderr when the log cannot take it. */
const logLine = (log: string, line: string): void => {
  try {
    fs.appendFileSync(log, `plot-continue: ${line}\n`);
  } catch {
    console.error(`continuation: ${line}`);
  }
};

/**
 * Replaces the desk's monitor: stops the one the manifest records, then
 * starts a new one for the new run.
 *
 * The monitor starts only after `.plot-worker.pid` names the new run, because
 * it ends when that pid is gone. The old one would watch the new pid too, so
 * it is stopped first and the desk keeps one (#1255). Every step that does not
 * happen is written to the desk's log.
 *
 * @param input.previous - the monitor pids the manifest recorded before any
 *   stop, since a stopped loop removes its manifest.
 * @returns the new monitor's pid, `''` when it was not started.
 */
const startMonitors = (input: {
  monitors: DeskMonitors;
  desk: MonitoredDesk;
  pidRecorded: boolean;
  previous: string[];
}): MonitorPids => {
  const { monitors, desk, previous } = input;
  const none: MonitorPids = { agentMonitorPid: '' };
  if (previous.length > 0 && !monitors.stop(previous).ok) {
    logLine(desk.log, `could not stop the previous monitors (pids ${previous.join(', ')}); they may still run`);
  }
  if (!input.pidRecorded) {
    logLine(desk.log, `AgentMonitor not started: ${desk.pidFile} could not be written, so it would watch the previous run`);
    return none;
  }
  const result = monitors.start(desk);
  if (!result.ok) {
    logLine(desk.log, `AgentMonitor not started: the start answered ${result.why}`);
    return none;
  }
  for (const [name, pid] of [['AgentMonitor', result.value.agentMonitorPid]]) {
    if (pid === '') logLine(desk.log, `${name} not started: its script is not executable under the scripts directory`);
  }
  return result.value;
};

/**
 * Starts a new worker on a desk, with `answer` in its prompt — on a desk that
 * holds an unanswered `PLOT-BLOCKED` marker, or, with `fresh`, on one whose
 * ending alone earns a new session with no marker in the tree.
 *
 * Both callers share this: `POST /api/continue` after it has found the desk
 * through the pulse, and the registry tick for a desk whose ending earns a
 * fresh session. The refusals are the route's own, in the route's own order:
 * no marker, no `Worker command`, no single manifest naming the desk, then
 * `run-limit` and `spend-limit`. Each refusal happens before the stop of a
 * free-waiting loop and before any write to the desk.
 *
 * With `fresh`, a desk with no marker is accepted where its ending is one
 * `endingAsksFreshStart` names for `branch`: `corrections-spent`,
 * `turn-limit`, or an after-prompt `holding-work`. A marker that is present
 * is still the prompt's question.
 *
 * @param input - the desk, the answer, and how to start.
 * @returns the started run, a refusal with its HTTP status and reason, or a
 *   failure to write the prompt, open the log, or replace the resume id.
 */
export const continueOnDesk = async (input: DeskContinuationInput): Promise<DeskContinuation> => {
  const { opts, branch, worktree, main, answer } = input;
  const readCfg = input.readCfg ?? readConfig;
  const refused = (
    status: number,
    reason: ContinueRefusal,
    detail: string,
  ): DeskContinuation => ({ kind: 'refused', status, reason, detail });

  // Read the question BEFORE spawning, and refuse when there is none. This is
  // both the precondition and the prompt's first section — see the header.
  // A FRESH START TAKES ITS PRECONDITION FROM THE ENDING INSTEAD, because
  // `holding-work` and `turn-limit` write no marker. The non-fresh path still
  // requires the marker.
  const question = await markerIn(worktree);
  const ending = deskEnding(worktree);
  const freshAsked = input.fresh === true && endingAsksFreshStart(ending, branch);
  if (!question && !freshAsked) {
    return refused(
      409,
      'no-question',
      'no unanswered PLOT-BLOCKED marker in that worktree — nothing is waiting on an answer',
    );
  }

  const cmd = readCfg(opts, 'Worker command', '');
  if (cmd === '' || cmd === 'none' || cmd === 'NONE' || cmd === 'None') {
    // The same `none` handling `start_worker` performs, and for the same
    // reason: `none` is a repo answering *we start workers by hand*, and
    // running it would spawn `none: command not found`.
    return refused(
      409,
      'no-worker-command',
      'no `Worker command` in Plot Config — start the continuation yourself in the worktree',
    );
  }

  // THE LOCK, BEFORE THE LIVE-LOOP READ AND EVERY WRITE BELOW IT (#1357). Two
  // callers racing `POST /api/continue` for this worktree can both reach this
  // line before either has spawned; only one takes the lock, and the other is
  // refused the same way a live loop refuses — to a caller the two causes
  // have the same remedy: stop the loop you found, or wait, and ask again.
  const holder = takeContinueLock(worktree);
  if (holder === null) {
    return refused(409, 'loop-alive', `another continuation is already starting in ${worktree}`);
  }
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    releaseContinueLock(worktree, holder);
  };

  try {
    if (input.onLocked !== undefined) await input.onLocked();

    // ASKED BEFORE ANY WRITE, and that is the decision: a refused continuation
    // must leave no `.plot-continuation.md`, no appended log and no removed
    // `.plot-worker.exit`, or a reader finds a trace that looks like a started
    // run. `continueTarget` is the domain rule for all four refusals below —
    // see its own docblock for the order and for why the ending record is a
    // fallback rather than a second registry.
    const manifestAnswer = deskManifestFor(opts.repoRoot, worktree, opts);
    // `readDeskLoop` is the one live-loop reading; `plot-desk-loop.mjs` asks it too.
    const { loop, waitsFree: loopWaitsFree } = readDeskLoop(worktree, manifestAnswer);
    const target = continueTarget({
      branch,
      manifest: manifestAnswer,
      ending,
      // Always true here — the route already refused `no-question` above,
      // before `Worker command` was even read, for a desk with neither a marker
      // nor an ending that asks for a fresh start. `continueTarget` still asks
      // the marker as its own first check (see its docblock), so this reading
      // keeps the rule's own order intact for any other caller.
      question: true,
      loop,
      loopWaitsFree,
    });

    if (target.kind === 'refused') {
      if (target.reason === 'loop-alive') {
        const alive = loop.kind === 'alive' ? loop : undefined;
        return refused(409, 'loop-alive', `pid ${alive?.pid ?? ''} (from ${alive?.source ?? ''}) is already running in this worktree`);
      }
      // `no-manifest` or `several` — `deskManifestFor` answers them apart so the
      // sentence can name which one. `several` is refused rather than
      // tie-broken: a first match would hide an estate defect the plan's second
      // Open Point leaves open. A `blocked` ending for a different branch, or no
      // usable ending at all, reads the same as `unnamed` always did.
      return refused(
        409,
        'no-manifest',
        manifestAnswer.kind === 'several'
          ? `more than one manifest names ${worktree}: ${manifestAnswer.paths.join(', ')}`
          : `no manifest names ${worktree}`,
      );
    }

    if (input.beforeStart !== undefined && !(await input.beforeStart())) {
      return { kind: 'failed', error: 'the caller stopped the start before it began' };
    }

    // READ BEFORE THE STOP. The stopped loop's `SIGTERM` handler removes
    // `PLOT_MANIFEST_FILE`, which is the manifest `continueTarget` found, so its
    // text and the monitor pids it records are taken now and the file is
    // restored after the stop.
    const stampPath = target.manifest === 'stamp' ? target.path : '';
    const manifestBeforeStop = stampPath === '' ? null : manifestText(stampPath);
    const previousMonitors = stampPath === '' ? [] : recordedMonitorPids(stampPath);

    // SAVE-THEN-SIGNAL (#1379): a `stamp` target with no readable manifest
    // refuses `no-manifest` HERE, before the loop is ever signalled. Checking
    // this only after the stop would already have sent `SIGTERM` and removed
    // the freewait record for a manifest this run could never restore — a
    // stop with no way back. The desk is left exactly as found: nothing
    // signalled, nothing removed.
    if (stampPath !== '' && manifestBeforeStop === null) {
      return refused(409, 'no-manifest', `${stampPath} could not be read before the stop; the desk is left running`);
    }

    // THE LIMIT WINS, UNCONDITIONALLY (#1381). A continuation is itself a run,
    // so it is checked against `Slice max runs`/`Slice max spend` before the
    // stop and before the first write: a refusal leaves a free-waiting loop
    // running. A person's answer does not override either limit. The run count
    // comes from the `stamp` target's manifest; a `write` target has no
    // PREVIOUS manifest to read — nothing names the desk yet, which is why this
    // is the `write` path — so it reads `0` here and is refused only once this
    // continuation's own write (below) has seeded the count a later call reads.
    const runs = sliceRunsFromManifest(manifestBeforeStop, branch);
    const runLimit = positiveOr(readCfg(opts, 'Slice max runs', ''), DEFAULT_SLICE_MAX_RUNS);
    if (runLimitRefusal(runs, runLimit)) {
      return refused(409, 'run-limit', `the slice started ${runs} runs, the Slice max runs limit of ${runLimit}`);
    }
    const spendReading = dollarsOr(readCfg(opts, 'Slice max spend', ''));
    if (spendReading.kind === 'unreadable') {
      return refused(
        409,
        'spend-limit',
        'Slice max spend is set but could not be read as a dollar amount; the continuation is refused rather than run unlimited',
      );
    }
    if (spendReading.kind === 'value') {
      const spend = await readSliceSpend(sliceSpendFile({ cwd: worktree }), branch);
      if (sliceSpendRefusal({ costUsd: spend.costUsd }, spendReading.amount)) {
        return refused(409, 'spend-limit', `the slice's recorded cost reached the Slice max spend limit of ${spendReading.amount}`);
      }
    }

    // THE STOP, BEFORE ANYTHING ELSE TOUCHES THE DESK. `continueTarget` carries
    // `stop` only for a loop that reported its own pid waiting free, and only
    // after `beforeStart` ran. The free-wait record is read again here, because
    // `beforeStart` awaits and the loop can take up a turn in that time.
    if (target.stop !== undefined) {
      const { pid } = target.stop;
      if (!deskWaitsFree(deskFreeWait(worktree), pid)) {
        return refused(409, 'loop-alive', `pid ${pid} left its free wait before the stop; it may be working a turn`);
      }
      // THE WRAPPER'S PID, READ BEFORE THE MANIFEST IS OVERWRITTEN (#1379). The
      // dispatcher's wrapper outlives the agent to write `.plot-worker.exit`; a
      // stop that waits only for the loop pid can return while that wrapper is
      // still mid-flight, so the NEW run's start-path removal of
      // `.plot-worker.exit` (above, "A NEW RUN") races the OLD wrapper's write
      // to the same file — the same shape #1377 already fixed on the start
      // path's own spawn. `manifestBeforeStop` is read-only text at this point,
      // never JSON-parsed elsewhere in this function, so reading it here costs
      // nothing new.
      let wrapperPid = (() => {
        try {
          const m = JSON.parse(manifestBeforeStop ?? '{}') as Record<string, unknown>;
          return typeof m.wrapperPid === 'string' ? m.wrapperPid : '';
        } catch {
          return '';
        }
      })();
      // THE WRAPPER PID IS CHECKED BEFORE THE LOOP IS SIGNALLED, so a refusal
      // leaves the desk as found. The dispatcher's wrapper starts the agent as
      // its child, so the live loop descends from it. A live process at the
      // recorded pid that is no ancestor of the loop is a recycled pid and is
      // not signalled. A pid that holds no process needs no stop. The working
      // directory is no test: a hop moves the manifest and the free-wait record
      // to a new worktree, and the wrapper keeps the launch worktree as its cwd.
      if (wrapperPid !== '') {
        const probe = input.probe ?? processProbeSystem();
        if (probe.alive(Number(wrapperPid)) === false) {
          wrapperPid = '';
        } else if (!descendsFrom(probe, Number(pid), Number(wrapperPid))) {
          return refused(
            409,
            'loop-alive',
            `wrapper pid ${wrapperPid} is no ancestor of loop pid ${pid}; it is not signalled, and the desk is left as found`,
          );
        }
      }
      // A STOP THAT FAILS LEAVES NO LOOP BEHIND ITS MANIFEST. The loop's own
      // `SIGTERM` handler removed `PLOT_MANIFEST_FILE` by the time a stop reports
      // failure, so every refusal after the signal puts it back first.
      const stopRefusal = (why: string): DeskContinuation => {
        if (stampPath !== '' && manifestBeforeStop !== null && !restoreManifest(stampPath, manifestBeforeStop)) {
          return { kind: 'failed', error: `pid ${pid} was signalled and ${stampPath} could not be written back; ${why}` };
        }
        return refused(409, 'loop-alive', why);
      };
      const stop = input.stopLoop ?? stopAndAwaitExit;
      const stopped = await stop(pid);
      if (!stopped.ok) return stopRefusal(stopped.why);
      if (wrapperPid !== '') {
        const wrapperStop = input.stopLoop ?? stopAndAwaitExit;
        const wrapperStopped = await wrapperStop(wrapperPid);
        if (!wrapperStopped.ok) return stopRefusal(wrapperStopped.why);
      }
      // THE FREEWAIT RECORD NAMED THE STOPPED PID, so it is stale the moment the
      // new run starts — left in place, `deskWaitsFree` would read the NEW pid's
      // loop as still waiting free for a pid that is gone.
      try {
        fs.rmSync(path.join(worktree, FREE_WAIT_FILENAME), { force: true });
      } catch {
        /* a missing freewait record is the normal case */
      }
      // `manifestBeforeStop` is never null for a `stampPath` here: the refusal
      // above the limit checks returns on that pair before any signal is sent.
      if (stampPath !== '' && !restoreManifest(stampPath, manifestBeforeStop as string)) {
        return { kind: 'failed', error: `pid ${pid} stopped and removed ${stampPath}, which could not be written back` };
      }
    }

    const rel = briefPathFor(branch);
    const landed = landedCommits(worktree, main);
    const prompt = composeContinuation({
      branch,
      briefPath: rel,
      briefText: readBrief(worktree, rel),
      answer,
      question,
      landed,
      truncated: landed.length >= COMMIT_MAX,
    });

    const promptPath = path.join(worktree, CONTINUATION_NAME);
    try {
      fs.writeFileSync(promptPath, prompt, 'utf8');
    } catch (err) {
      return {
        kind: 'failed',
        error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // A FAILED RUN LEAVES NO PROMPT. A later loop on this worktree reads
    // `PLOT_CONTINUATION` and would resume with an answer this run never started;
    // every `failed` return below this line wrote the file itself, so each
    // removes it. The write failure above created none.
    const failed = (error: string): DeskContinuation => {
      try {
        fs.rmSync(promptPath, { force: true });
      } catch {
        /* the failure being reported outranks a prompt that could not be removed */
      }
      return { kind: 'failed', error };
    };

    const log = path.join(worktree, '.plot-worker.log');
    let out: number;
    try {
      // APPEND, never truncate. The previous run's log is the record of the
      // question being asked, and a continuation that erased it would destroy the
      // context a reader needs to judge whether the answer was the right one.
      out = fs.openSync(log, 'a');
    } catch (err) {
      return failed(`cannot open ${log}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // THE MANIFEST THIS RUN USES, FROM HERE ON — either the one `continueTarget`
    // found, stamped in place, or a new one written because the desk's ending
    // record says it is waiting for exactly this answer and none names it yet.
    // `resumeId` is the handle the ending itself recorded (#1788) where one was
    // written; the transcript scan is a fallback for an ending with none, never
    // the first source — see `resumeIdFromTranscript`'s own doc comment for why
    // the newest-by-mtime file is not reliably this conversation's.
    //
    // WRITTEN LAST, AFTER THE PROMPT AND THE LOG (#1373): both of those already
    // succeeded by this point, so a `failed` return from here never leaves a
    // freshly written manifest behind for a loop that is not about to start —
    // the manifest is the one piece of state a reader treats as "a worker is
    // registered here," so it is the last thing created, not the first.
    let manifestPath: string;
    if (target.manifest === 'stamp') {
      manifestPath = target.path;
    } else {
      const recorded = ending.read === 'ended' ? ending.ending.resumeId : '';
      const written = writeDeskManifest(resolveManifestDir(opts.repoRoot, opts), {
        worktree,
        branch,
        command: cmd,
        resumeId: recorded !== '' ? recorded : resumeIdFromTranscript(worktree),
        // THIS CONTINUATION IS RUN 1 — see DeskManifestFields.sliceRuns. With no
        // previous manifest to carry a count forward from, leaving the field
        // absent would read as `0` forever and this path would never count
        // against `Slice max runs`.
        sliceRuns: 1,
      });
      if (written === null) {
        fs.closeSync(out);
        return failed(`cannot write a manifest naming ${worktree}; a start now would run unregistered`);
      }
      manifestPath = written;
    }

    // A FREE LOOP'S MANIFEST NAMES NO BRANCH, and a loop started on it waits
    // free without reading the continuation. The asked branch is written before
    // the start.
    if (target.manifest === 'stamp' && !assignEmptyManifestBranch(manifestPath, branch)) {
      fs.closeSync(out);
      return failed(`cannot write the branch into ${manifestPath}; a start now would wait free`);
    }

    // A FRESH SESSION IS DECIDED BEFORE ANY WRITE TO THE DESK. The loop resumes
    // whatever conversation the manifest's `resumeId` names while a transcript
    // exists for it; a new id has no transcript, so the loop creates a session.
    // A manifest that cannot take the new id would resume the spent session, so
    // the start does not happen.
    if (input.fresh === true && !writeResumeId(manifestPath, randomUUID())) {
      fs.closeSync(out);
      return failed(`cannot replace the resume id in ${manifestPath}; a start now would resume the previous session`);
    }

    // A NEW RUN, and every part of this says so. The previous `.plot-worker.exit`
    // is removed because it belongs to a process that has ended — leaving it
    // would let the scan read a fresh worker's state from its predecessor's exit
    // code. The pid file is OVERWRITTEN below with the new child's pid; the old
    // one is never inherited, which is the assertion the plan asks for.
    try {
      fs.rmSync(path.join(worktree, '.plot-worker.exit'), { force: true });
    } catch {
      /* a missing exit file is the normal case */
    }

    // THE STALE WRAPPER PID, REMOVED BEFORE THE SPAWN. This route starts no
    // wrapper — it spawns the agent directly — so the file can only be the
    // previous dispatch's. `plot_worker_state` reads it as proof a wrapper is
    // watching; left in place, a waiting loop with no agent beneath it reads
    // `finished` rather than `waiting`. `force: true` because the file is only
    // ever stale here, same as the `.plot-worker.exit` removal above. The pid
    // file itself (`.plot-worker.pid`) is NOT removed — it is overwritten below
    // with the new child's pid.
    try {
      fs.rmSync(path.join(worktree, '.plot-worker.wrapper.pid'), { force: true });
    } catch {
      /* a missing wrapper pid file is the normal case */
    }

    // Spawned DETACHED and answered immediately, exactly as `/api/dispatch` is
    // and for the same reason: the run outlives this request by design, and
    // awaiting it would freeze this single-threaded server for the length of an
    // agent's run. The row moving is the answer; the 202 is only the receipt.
    //
    // Through `sh -c` because `Worker command` is a shell FRAGMENT, not an argv
    // vector — the same interpretation `start_worker` gives it, so a command that
    // works under `/plot-dispatch` works here unchanged. Nothing from the request
    // is interpolated into that string: the answer reached the worktree as a
    // file, and its PATH travels in the environment.
    //
    // RE-PARENTED, NOT MERELY DETACHED. `detached: true` alone calls `setsid`
    // and leaves the SPAWNING NODE PROCESS as `ppid` — measured 2026-10-07 on
    // Darwin 24.6 (see the brief) — so `plot-boardctl.sh`'s `tree_pids`, which
    // walks `ppid`, still finds this loop under the board and a `stop` reaches
    // it. A second process level is what escapes that walk: the outer `sh -c`
    // backgrounds the whole `( cmd ); rc=$?; printf ...` sequence as ONE
    // subshell, writes ITS pid (`$!`) to `.plot-worker.pid` itself, and exits —
    // so `init`/pid 1 adopts the backgrounded subshell rather than Node's direct
    // child. The outer parens around that whole sequence are load-bearing: `&`
    // binds to the nearest command list, so without them only `( cmd )` is
    // backgrounded and `rc=$?; printf ...` runs in the OUTER shell's foreground
    // immediately after — reporting `&`'s own exit status, not the real
    // command's, and writing the exit file while the command is still running
    // (measured: a 2s `sleep` left an exit file within 0.3s). `child.pid` below
    // names the OUTER shell, which has exited by the time this function
    // returns; it is never recorded anywhere a reader would mistake it for the
    // loop.
    const exitFile = path.join(worktree, '.plot-worker.exit');
    const pidFile = path.join(worktree, '.plot-worker.pid');
    const spawnFn = input.spawn ?? spawn;
    const spawnResult = await new Promise<{ kind: 'exited' } | { kind: 'error'; err: Error }>((resolve) => {
      const child = spawnFn(
        'sh',
        [
          '-c',
          `( ( ${cmd} ); rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE" ) &` +
            ` printf "%s" "$!" > "$PLOT_PID_FILE"`,
        ],
        {
          cwd: worktree,
          detached: true,
          stdio: ['ignore', out, out],
          env: {
            ...process.env,
            // CLEARED EVEN THOUGH THE PARENT MAY CARRY IT: a continued desk
            // resumes a desk session, not the main-checkout bookkeeping a
            // brief/implement/deliver/reslice/story run does, so it must not
            // inherit that run's writer marker through the `...process.env`
            // spread above.
            [MAIN_CHECKOUT_WRITER_ENV]: '',
            PLOT_BRANCH: branch,
            PLOT_WORKTREE: worktree,
            PLOT_EXIT_FILE: exitFile,
            PLOT_PID_FILE: pidFile,
            // THE MANIFEST THAT NAMES THIS DESK, so the loop's own wait can end
            // honestly if that file later vanishes — `loopRegistration`'s `gone`.
            // Refused above unless `continueTarget` found one to stamp or wrote a
            // new one, so `manifestPath` is never empty here.
            PLOT_MANIFEST_FILE: manifestPath,
            [CONTINUATION_ENV]: promptPath,
          },
        },
      );
      // SETTLES THE PROMISE ON EITHER EVENT, never only logs. A spawn whose `sh`
      // binary is missing (or any other spawn-time failure) fires `error`
      // instead of `exit` — Node promises at most one of the two — so a
      // handler that only logged left this function hanging, and after the
      // lock existed, left it held until the bound (#1357's spawn half).
      child.on('error', (err) => resolve({ kind: 'error', err }));
      child.once('exit', () => resolve({ kind: 'exited' }));
    });
    if (spawnResult.kind === 'error') {
      fs.closeSync(out);
      return failed(`continuation failed to spawn: ${spawnResult.err.message}`);
    }
    // AWAITED, NOT UNREF'D YET. The outer shell only backgrounds the real
    // command and writes a pid file — no `wait` in its own body — so it exits
    // almost immediately, well before the agent it started finishes. Only once
    // it has exited is `.plot-worker.pid` guaranteed written, which is the pid
    // every caller (the 202 reply, the manifest stamp, the monitors) must use.
    fs.closeSync(out);

    const pid = Number(await readDeskPid(worktree)) || 0;
    let warning: string | undefined;
    if (pid > 0) {
      let pidRecorded = true;
      try {
        fs.writeFileSync(path.join(worktree, '.plot-worker.pid'), String(pid), 'utf8');
      } catch (err) {
        // The worker IS running; only the record of it failed. Say so rather than
        // reporting a failure that would invite a second spawn into the same
        // worktree.
        console.error('continuation started but its pid could not be recorded:', err);
        pidRecorded = false;
      }
      const started = startMonitors({
        monitors: input.monitors ?? deskMonitorsShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
        desk: {
          branch,
          worktree,
          manifestFile: manifestPath,
          pidFile: path.join(worktree, '.plot-worker.pid'),
          log,
        },
        pidRecorded,
        previous: previousMonitors,
      });
      // STAMP THE MANIFEST — the path the reported defect came from. This route
      // spawns directly and never runs `plot-dispatch.sh`, so the dispatcher's awk
      // fix does not reach it; the manifest that names this worktree would keep
      // pointing at the process that already exited. `stampManifest` is the same
      // contract the awk implements (parity-tested), so a continued worker and a
      // dispatched one leave an identical manifest. `manifestPath` already names
      // either the manifest `continueTarget` found or the one just written, so
      // it is reused rather than re-reading the registry directory a second time.
      //
      // No wrapper and no WorkerMonitor exist for a continued run, so those two
      // are recorded `''`; omitting them would leave the previous dispatch's
      // pids on the row. The stamp re-emits the whole group on every write.
      const stamped = writeManifestStamp(manifestPath, {
        pid: String(pid),
        startedAt: new Date().toISOString(),
        wrapperPid: '',
        workerMonitorPid: '',
        agentMonitorPid: started.agentMonitorPid,
      });
      // The run is already started, so a failed stamp is reported rather than
      // answered `failed`: a `failed` answer invites a second spawn on this desk.
      if (!stamped) {
        const line = `started pid ${pid}, but ${manifestPath} could not be stamped; the registry still names the previous run`;
        logLine(log, line);
        console.error(`continuation: ${line}`);
        warning = line;
      }
    }
    return { kind: 'started', pid: String(pid), previousPid: input.previousPid, prompt: promptPath, log, warning };
  } finally {
    release();
  }
};

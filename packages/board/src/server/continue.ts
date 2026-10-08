import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { pulseFor } from './fleet.js';
import type { FleetReading } from '../contract/schema.js';
import { branchFromPulse } from './agent-panel.js';
import { markerIn } from './worker-question.js';
import { deskManifestFor, writeDeskManifest, writeManifestStamp, writeResumeId } from './manifest-stamp.js';
import { localCapability } from './controllers/caller.js';
import { briefPath } from './brief-path.js';
import { deskMonitorsShell, transcriptDirFor, TRANSCRIPT_HOME_ENV } from '@plot-pm/domain/adapters';
import type { DeskMonitors, MonitoredDesk, MonitorPids } from '@plot-pm/domain';
import {
  deskLoopAlive,
  deskWaitsFree,
  FREE_WAIT_FILENAME,
  type DeskPidReading,
  type FreeWaitReading,
} from '@plot-pm/domain/rules/desk-loop-alive';
import { continueTarget } from '@plot-pm/domain/rules/continue-target';
import { readEnding, ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { readDeskPid, resolveManifestDir } from './registry.js';

/**
 * Continuing an answered agent — the board's SECOND state-changing route, and
 * deliberately built as a sibling of `/api/dispatch` rather than as a second
 * mechanism.
 *
 * **A CONTINUATION IS NOT A REPLY, and the naming is the design.** `claude -p`
 * is a one-way process: there is no stdin after launch, so the agent that wrote
 * the question is gone by the time anyone reads it. What this route does is
 * start a NEW worker in the same worktree. Calling the control *Reply* would
 * promise a channel that does not exist — the reader would expect the agent
 * they were talking to to hear them, and no such agent is listening. What
 * continues is the WORK, not the conversation.
 *
 * The consequences of that are structural rather than cosmetic:
 *
 *   - the previous pid is never reused. A new process gets a new pid, and the
 *     row must show a new worker — see {@link handleContinue}, which refuses to
 *     inherit `.plot-worker.pid` and overwrites it.
 *   - the prompt is composed fresh from durable sources, never carried over
 *     from the previous run — see {@link composeContinuation}.
 *
 * The guard and the body bound are IMPORTED from `dispatch.ts` rather than
 * rewritten. This is the same class of endpoint — it spawns a process on the
 * machine the board runs on — and the reasons those two exist there apply here
 * unchanged. A second copy is a second place to forget them.
 */

/**
 * Where the composed prompt is written inside the worktree.
 *
 * **The prompt is a FILE, and that is a safety property rather than a
 * convenience.** The configured `Worker command` is a shell FRAGMENT — the
 * dispatcher runs it through `sh -c` (`plot-dispatch.sh:761-763`) — so anything
 * interpolated into it is shell source. An answer is free human text; a single
 * `"; rm -rf ~` in it would execute. Writing the answer to a file and naming
 * that file in the ENVIRONMENT means no part of the answer is ever a shell
 * word, whatever it contains.
 *
 * It sits beside `.plot-worker.log`, `.plot-worker.pid` and `.plot-worker.exit`
 * and shares their prefix on purpose: `plot-worker-state.sh` and
 * `worker-question.ts` both exclude `.plot-worker.*` from their marker search,
 * so a continuation prompt that quotes the worker's own question cannot be
 * mistaken for a new one. Naming it `.plot-continue.md` instead would make
 * every continuation look like a fresh unanswered question — the exact defect
 * this slice was measured against.
 */
export const CONTINUATION_NAME = '.plot-worker.continue.md';

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
  | 'loop-alive';

export interface ContinueOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/**
 * The two facts this route reads from outside itself, injectable.
 *
 * **A seam rather than a mock, and the codebase's own shape**: `agentPanel`
 * takes `{ home? }` for exactly this reason. Reassigning an ES module export in
 * a test does not work — the binding is read-only — and a `vi.mock` factory
 * would put this route's test in a different style from every other test here.
 * Optional parameters defaulting to the real readers keep the production path
 * identical while making the refusals assertable without a live fleet scan.
 */
export interface ContinueDeps {
  /** The cached pulse — where the branch → worktree lookup comes from. */
  pulse?: (opts: BuildBoardOptions) => FleetReading | null;
  /** The configured `Worker command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** Starts the desk's monitor; defaults to the shell script under `scriptsDir`. */
  monitors?: DeskMonitors;
}

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
  const parts: string[] = [];

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

  if (question) {
    parts.push('## The question that stopped the previous run', '', question, '');
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

/**
 * Handle `POST /api/continue` — refuse, or write the prompt and spawn a NEW
 * worker in the branch's existing worktree.
 *
 * ## Why the missing marker is a refusal
 *
 * A branch with no `PLOT-BLOCKED`/`TODO(you)` marker in its tree is not
 * waiting on anybody, and continuing it would start a second worker in a
 * worktree that may already hold a live one. That is the one failure this route
 * can cause that a person cannot easily undo: two agents committing to one
 * branch. The marker is what makes the branch read `waiting`, so requiring it
 * makes the route's precondition exactly the state the UI offered the control
 * for.
 *
 * ## The stale-marker decision, and why it went to the WORKER
 *
 * A marker left in the tree after its answer makes finished work read as
 * blocked — measured on 2026-08-19, a stale marker survived its own answer by
 * 55 minutes. So somebody must clear it, and there are only two candidates.
 *
 * **This route could delete it at spawn time.** Rejected. It would put a WRITE
 * to the branch's tree in an endpoint whose job is to start a process, and it
 * would lie in the window that matters: between the delete and the new worker's
 * first commit the branch reads `finished` — clean tree, no marker — which is
 * the *review it* verdict, aimed at a human, for work that has not been done.
 * The row would go quiet at the exact moment it became busiest. Worse, if the
 * worker fails to start (bad `Worker command`, a full disk) the question is
 * gone with nothing running: the branch reads finished, forever, and the
 * question is only recoverable from git history nobody will think to search.
 *
 * **So the new worker clears it**, and the prompt says so in as many words.
 * The marker therefore stands from the answer until the continuation has read
 * it — which is the honest reading of the state during that window: a person
 * HAS answered, and the work is not yet done. The branch reads `waiting` a
 * little longer than it is strictly true, and that error points at a live
 * worker rather than at absent work. Erring toward *still busy* is the
 * direction this board can afford; erring toward *ready for review* is the one
 * that wasted the 55 minutes.
 *
 * The cost is real and named: a continuation whose worker dies before clearing
 * the marker leaves the branch reading `waiting`, and a person will answer a
 * question that has already been answered. That is recoverable by looking —
 * the log and the panel both show the newer run — and the alternative is
 * unrecoverable by looking, because it shows nothing at all.
 */
export async function handleContinue(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ContinueOptions,
  deps: ContinueDeps = {},
): Promise<void> {
  const readPulse = deps.pulse ?? pulseFor;
  const readCfg = deps.config ?? readConfig;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: ContinueRefusal, branch: string, detail: string) =>
    json(status, { ok: false, branch, reason, detail });

  // The same-origin gate `/api/dispatch` documents, imported rather than
  // reimplemented. The loopback gate that used to sit above it is now enforced
  // in the router for all five write routes at once — see `write-gate.ts`, and
  // the note in `handleDispatch` for why one surviving copy would have made the
  // named opt-in mean two different things on two different routes.
  //
  // `continueAvailability` still answers the board's third capability flag,
  // which is the question the CONTROL asks before it is clicked.
  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, BODY_LIMIT);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const branch = (body as { branch?: unknown })?.branch;
  const answer = (body as { answer?: unknown })?.answer;
  if (typeof branch !== 'string' || branch === '') {
    json(400, { error: 'branch is required' });
    return;
  }
  if (typeof answer !== 'string' || answer.trim() === '') {
    // An EMPTY answer is refused rather than sent. Starting a worker whose new
    // fact is nothing would burn a run to re-read a brief it already has and
    // hit the same question again.
    json(400, { error: 'answer is required' });
    return;
  }
  if (answer.length > ANSWER_MAX) {
    json(400, { error: `answer is longer than ${ANSWER_MAX} characters` });
    return;
  }

  // A LOOKUP, not a check — the same security boundary `worktreeForBranch` and
  // `branchFromPulse` document. The branch names a record the scan already
  // produced; no request text becomes a path segment, so `../../etc` matches
  // nothing and comes back as a refusal rather than as a write.
  const pulse = readPulse(opts);
  const found = branchFromPulse(pulse, branch);
  if (!found) {
    refuse(404, 'unknown-branch', branch, 'no plan on this board names that branch');
    return;
  }
  if (!found.worktree) {
    refuse(404, 'no-worktree', branch, 'this machine holds no worktree for that branch');
    return;
  }

  const started = await continueOnDesk({
    opts,
    readCfg,
    branch,
    worktree: found.worktree,
    main: pulse?.main ?? '',
    previousPid: found.pid,
    answer,
    monitors: deps.monitors,
  });
  if (started.kind === 'refused') {
    refuse(started.status, started.reason, branch, started.detail);
    return;
  }
  if (started.kind === 'failed') {
    json(500, { error: started.error });
    return;
  }
  json(202, {
    ok: true,
    branch,
    /** The NEW pid. A caller asserting a new run compares this to the old one. */
    pid: started.pid,
    /** The pid this continuation replaced, so the answer names both. */
    previousPid: started.previousPid,
    prompt: started.prompt,
    log: started.log,
  });
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
    }
  | { kind: 'refused'; status: number; reason: ContinueRefusal; detail: string }
  | { kind: 'failed'; error: string };

/** What {@link continueOnDesk} needs to start a continuation on a desk. */
export interface DeskContinuationInput {
  opts: BuildBoardOptions;
  /** The configured-value reader; defaults to the board's own. */
  readCfg?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
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
  stopLoop?: (pid: string) => Promise<void>;
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

/**
 * The manifest's `pid` and `wrapperPid`, as {@link DeskPidReading}s; empty
 * strings when the manifest cannot be read, so {@link deskLoopAlive} treats a
 * read failure as nothing to refuse on rather than throwing.
 */
const recordedLoopPids = (manifestFile: string): DeskPidReading[] => {
  let m: Record<string, unknown> = {};
  try {
    m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  } catch {
    /* no manifest to read — both readings fall through as empty */
  }
  const field = (name: string): string => (typeof m[name] === 'string' ? (m[name] as string) : '');
  return [
    { source: 'manifest pid', pid: field('pid') },
    { source: 'manifest wrapperPid', pid: field('wrapperPid') },
  ];
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

/**
 * Whether a pid is alive, reading an unanswerable signal as alive.
 *
 * **The opposite direction from {@link deskPidAlive}.** There, `EPERM` reads
 * as not-alive because an invented worker only ever narrows a budget on no
 * evidence. Here a wrong *not-alive* starts a second loop on a desk that
 * already holds one — the defect {@link deskLoopAlive} exists to refuse — so
 * `EPERM` (alive, not ours to signal) reads as alive and only `ESRCH` (the
 * process is gone) reads as not-alive.
 */
const pidAliveEverywhere = (pid: string): boolean => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The desk's `.plot-worker.freewait` record, read as a value — `''` when it cannot be read. */
const deskFreeWait = (worktree: string): FreeWaitReading => {
  try {
    return { text: fs.readFileSync(path.join(worktree, FREE_WAIT_FILENAME), 'utf8') };
  } catch {
    return { text: null };
  }
};

/**
 * Signals a pid and waits for it to be gone — the stop `continueTarget`'s
 * `stop` instructs, run before the manifest is touched.
 *
 * **ORDER IS THE WHOLE POINT.** `onStop` in `worker-loop.ts` removes
 * `PLOT_MANIFEST_FILE` on `SIGTERM` before it exits, so a stamp or write that
 * ran first would race the old loop's own cleanup and could be deleted by it.
 * Waiting for the pid to actually exit — not merely sending the signal — is
 * what closes that race: by the time this returns, the old loop's cleanup has
 * already run or will never run.
 *
 * A pid already gone by the time this is called is success, not an error —
 * the free wait may have ended on its own between the reading and the stop.
 *
 * @param pid - the exact pid `deskLoopAlive` named; never any other.
 * @param pollMs - how often to re-check; overridable in tests.
 * @returns once the pid no longer answers `kill -0` at all (reads `ESRCH`).
 */
const stopAndAwaitExit = async (pid: string, pollMs = 50): Promise<void> => {
  const n = Number(pid);
  try {
    process.kill(n, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw err;
  }
  for (;;) {
    try {
      process.kill(n, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
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
 * @returns the new monitor's pid, `''` when it was not started.
 */
const startMonitors = (input: { monitors: DeskMonitors; desk: MonitoredDesk; pidRecorded: boolean }): MonitorPids => {
  const { monitors, desk } = input;
  const none: MonitorPids = { agentMonitorPid: '' };
  const previous = recordedMonitorPids(desk.manifestFile);
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
 * Starts a new worker on a desk that holds an unanswered `PLOT-BLOCKED`
 * marker, with `answer` in its prompt.
 *
 * Both callers share this: `POST /api/continue` after it has found the desk
 * through the pulse, and the registry tick for a desk whose correction budget
 * is spent. The refusals are the route's own, in the route's own order: no
 * marker, no `Worker command`, no single manifest naming the desk. Each
 * refusal happens before any write to the desk.
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
  const question = await markerIn(worktree);
  if (!question) {
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

  // ASKED BEFORE ANY WRITE, and that is the decision: a refused continuation
  // must leave no `.plot-continuation.md`, no appended log and no removed
  // `.plot-worker.exit`, or a reader finds a trace that looks like a started
  // run. `continueTarget` is the domain rule for all four refusals below —
  // see its own docblock for the order and for why the ending record is a
  // fallback rather than a second registry.
  const manifestAnswer = deskManifestFor(opts.repoRoot, worktree, opts);
  const loopPids: DeskPidReading[] = [
    { source: '.plot-worker.pid', pid: await readDeskPid(worktree) },
    ...(manifestAnswer.kind === 'named' ? recordedLoopPids(manifestAnswer.path) : []),
  ];
  const loop = deskLoopAlive({ pids: loopPids, alive: pidAliveEverywhere });
  // Asked only when a loop is actually alive — a desk with none holds no
  // pid for the record to name, so `deskWaitsFree` would only ever answer
  // false and the read is wasted.
  const loopWaitsFree = loop.kind === 'alive' && deskWaitsFree(deskFreeWait(worktree), loop.pid);
  const target = continueTarget({
    branch,
    manifest: manifestAnswer,
    ending: deskEnding(worktree),
    // Always true here — the route already refused `no-question` above,
    // before `Worker command` was even read. `continueTarget` still asks the
    // marker as its own first check (see its docblock), so this reading keeps
    // the rule's own order intact for any other caller.
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

  // THE STOP, BEFORE ANYTHING ELSE TOUCHES THE DESK. `continueTarget` carries
  // `stop` only for a loop that reported its own pid waiting free — no turn to
  // lose — and only after `beforeStart` ran, matching every other write below.
  // Waiting for the pid to actually exit (not merely signalling it) is what
  // keeps the old loop's own `SIGTERM` cleanup from deleting the manifest this
  // function is about to stamp or write; see `stopAndAwaitExit`'s own doc.
  if (target.stop !== undefined) {
    const stop = input.stopLoop ?? stopAndAwaitExit;
    await stop(target.stop.pid);
  }

  // THE MANIFEST THIS RUN USES, FROM HERE ON — either the one `continueTarget`
  // found, stamped in place, or a new one written because the desk's ending
  // record says it is waiting for exactly this answer and none names it yet.
  // `resumeId` is recovered from the desk's own transcript directory rather
  // than minted, so the new loop resumes the blocked agent's conversation
  // instead of starting a stranger's.
  let manifestPath: string;
  if (target.manifest === 'stamp') {
    manifestPath = target.path;
  } else {
    const written = writeDeskManifest(resolveManifestDir(opts.repoRoot, opts), {
      worktree,
      branch,
      command: cmd,
      resumeId: resumeIdFromTranscript(worktree),
    });
    if (written === null) {
      return { kind: 'failed', error: `cannot write a manifest naming ${worktree}; a start now would run unregistered` };
    }
    manifestPath = written;
  }

  // A FRESH SESSION IS DECIDED BEFORE ANY WRITE TO THE DESK. The loop resumes
  // whatever conversation the manifest's `resumeId` names while a transcript
  // exists for it; a new id has no transcript, so the loop creates a session.
  // A manifest that cannot take the new id would resume the spent session, so
  // the start does not happen.
  if (input.fresh === true && !writeResumeId(manifestPath, randomUUID())) {
    return {
      kind: 'failed',
      error: `cannot replace the resume id in ${manifestPath}; a start now would resume the previous session`,
    };
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

  const log = path.join(worktree, '.plot-worker.log');
  let out: number;
  try {
    // APPEND, never truncate. The previous run's log is the record of the
    // question being asked, and a continuation that erased it would destroy the
    // context a reader needs to judge whether the answer was the right one.
    out = fs.openSync(log, 'a');
  } catch (err) {
    return {
      kind: 'failed',
      error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}`,
    };
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
  const child = spawn(
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
  child.on('error', (err) => console.error('continuation failed to spawn:', err));
  // AWAITED, NOT UNREF'D YET. The outer shell only backgrounds the real
  // command and writes a pid file — no `wait` in its own body — so it exits
  // almost immediately, well before the agent it started finishes. Only once
  // it has exited is `.plot-worker.pid` guaranteed written, which is the pid
  // every caller (the 202 reply, the manifest stamp, the monitors) must use.
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.unref();
  fs.closeSync(out);

  const pid = Number(await readDeskPid(worktree)) || 0;
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
    writeManifestStamp(manifestPath, {
      pid: String(pid),
      startedAt: new Date().toISOString(),
      wrapperPid: '',
      workerMonitorPid: '',
      agentMonitorPid: started.agentMonitorPid,
    });
  }
  return { kind: 'started', pid: String(pid), previousPid: input.previousPid, prompt: promptPath, log };
};

/**
 * Whether continuing is available at all — the same binding question
 * `/api/dispatch` asks, with the same answer.
 *
 * Its own function rather than a re-export so the client can hold a separate
 * flag, which is the lesson `approve` records: two capabilities behind one flag
 * is how they diverge. Today the answer is identical, and the day one of them
 * grows a condition the other lacks, only this function changes.
 */
export function continueAvailability(host: string): { available: boolean; reason: string } {
  return localCapability(host, 'continuing an agent', 'the worktrees');
}

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { pulseFor } from './fleet.js';
import type { FleetPulse } from '../contract/schema.js';
import { branchFromPulse } from './agent-panel.js';
import { markerIn } from './worker-question.js';
import { manifestForWorktree, writeManifestStamp } from './manifest-stamp.js';
import { localCapability } from './controllers/caller.js';

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
 * this wave was measured against.
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
  | 'no-worker-command';

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
  pulse?: (opts: BuildBoardOptions) => FleetPulse | null;
  /** The configured `Worker command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
}

/** How many commits the prompt names before it says there are more. */
export const COMMIT_MAX = 40;

/**
 * What the previous run left in git, as one line per commit — newest last.
 *
 * **THIS IS THE "what already landed" HALF OF THE PROMPT, and it is read from
 * git rather than carried from the previous run.** That choice is the wave's
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
 * Where a branch's brief lives, by the convention `/plot-implement` writes and
 * every worker prompt reads.
 *
 * The same convention `attention.ts` states, and deliberately a THIRD reader of
 * it rather than an import: that module derives the path to REPORT it to a
 * caller, this one to read a file. Sharing the helper across a server module
 * boundary to save four lines would couple a spawning route to an advisory
 * endpoint for no gain. If the convention ever moves, both fail the same way —
 * loudly, on a missing file — rather than one silently.
 */
export function briefPathFor(branch: string): string {
  const slug = branch.split('/').pop() ?? branch;
  return path.join('.plot/briefs', `${slug}.md`);
}

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

  // Read the question BEFORE spawning, and refuse when there is none. This is
  // both the precondition and the prompt's first section — see the header.
  const question = await markerIn(found.worktree);
  if (!question) {
    refuse(
      409,
      'no-question',
      branch,
      'no unanswered PLOT-BLOCKED marker in that worktree — nothing is waiting on an answer',
    );
    return;
  }

  const cmd = readCfg(opts, 'Worker command', '');
  if (cmd === '' || cmd === 'none' || cmd === 'NONE' || cmd === 'None') {
    // The same `none` handling `start_worker` performs, and for the same
    // reason: `none` is a repo answering *we start workers by hand*, and
    // running it would spawn `none: command not found`.
    refuse(
      409,
      'no-worker-command',
      branch,
      'no `Worker command` in Plot Config — start the continuation yourself in the worktree',
    );
    return;
  }

  const rel = briefPathFor(branch);
  const landed = landedCommits(found.worktree, pulse?.main ?? '');
  const prompt = composeContinuation({
    branch,
    briefPath: rel,
    briefText: readBrief(found.worktree, rel),
    answer,
    question,
    landed,
    truncated: landed.length >= COMMIT_MAX,
  });

  const promptPath = path.join(found.worktree, CONTINUATION_NAME);
  try {
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = path.join(found.worktree, '.plot-worker.log');
  let out: number;
  try {
    // APPEND, never truncate. The previous run's log is the record of the
    // question being asked, and a continuation that erased it would destroy the
    // context a reader needs to judge whether the answer was the right one.
    out = fs.openSync(log, 'a');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // A NEW RUN, and every part of this says so. The previous `.plot-worker.exit`
  // is removed because it belongs to a process that has ended — leaving it
  // would let the scan read a fresh worker's state from its predecessor's exit
  // code. The pid file is OVERWRITTEN below with the new child's pid; the old
  // one is never inherited, which is the assertion the plan asks for.
  try {
    fs.rmSync(path.join(found.worktree, '.plot-worker.exit'), { force: true });
  } catch {
    /* a missing exit file is the normal case */
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
  const exitFile = path.join(found.worktree, '.plot-worker.exit');
  const child = spawn(
    'sh',
    ['-c', `( ${cmd} ); rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"`],
    {
      cwd: found.worktree,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        PLOT_BRANCH: branch,
        PLOT_WORKTREE: found.worktree,
        PLOT_EXIT_FILE: exitFile,
        [CONTINUATION_ENV]: promptPath,
      },
    },
  );
  child.on('error', (err) => console.error('continuation failed to spawn:', err));
  child.unref();
  fs.closeSync(out);

  const pid = child.pid ?? 0;
  if (pid > 0) {
    try {
      fs.writeFileSync(path.join(found.worktree, '.plot-worker.pid'), String(pid), 'utf8');
    } catch (err) {
      // The worker IS running; only the record of it failed. Say so rather than
      // reporting a failure that would invite a second spawn into the same
      // worktree.
      console.error('continuation started but its pid could not be recorded:', err);
    }
    // STAMP THE MANIFEST — the path the reported defect came from. This route
    // spawns directly and never runs `plot-dispatch.sh`, so the dispatcher's awk
    // fix does not reach it; the manifest that names this worktree would keep
    // pointing at the process that already exited. `stampManifest` is the same
    // contract the awk implements (parity-tested), so a continued worker and a
    // dispatched one leave an identical manifest. A missing manifest is not a
    // failure — an older worktree has none, and the worker runs regardless —
    // which is why `writeManifestStamp` is a no-op there rather than a throw.
    //
    // THE GROUP IS RECORDED EMPTY, AND THAT IS THE TRUE ANSWER. This route
    // spawns the agent DIRECTLY — no wrapper, no WorkerMonitor, no AgentMonitor
    // — so there is no process beside it to name. Passing `''` for each member
    // says *nothing else was started*, which is the fact; omitting them would
    // leave the PREVIOUS dispatch's wrapper and monitors on the row, naming
    // processes that belong to a run this one just replaced. The stamp re-emits
    // the group on every write precisely so a stale one cannot survive.
    const manifest = manifestForWorktree(opts.repoRoot, found.worktree, opts);
    if (manifest) {
      writeManifestStamp(manifest, {
        pid: String(pid),
        startedAt: new Date().toISOString(),
        wrapperPid: '',
        workerMonitorPid: '',
        agentMonitorPid: '',
      });
    }
  }
  json(202, {
    ok: true,
    branch,
    /** The NEW pid. A caller asserting a new run compares this to the old one. */
    pid: String(pid),
    /** The pid this continuation replaced, so the answer names both. */
    previousPid: found.pid,
    prompt: promptPath,
    log,
  });
}

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

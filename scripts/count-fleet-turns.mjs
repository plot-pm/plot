#!/usr/bin/env node
/**
 * Whether the Agent SDK costs the fleet less than `command` did, and whether
 * polling disappeared — the two questions `the-sdk-is-the-default-runner`
 * gates its flip on.
 *
 *   node scripts/count-fleet-turns.mjs [report] <sinceISO> <untilISO> [checkout]
 *   node scripts/count-fleet-turns.mjs compare <baselineSince> <baselineUntil> <sdkSince> <sdkUntil> [checkout]
 *
 * `report` prints, per day and per runner, fleet sessions, turns per session,
 * mean peak context and weighted tokens (a cache read counts 1/10), the
 * turns per run, completed and refused polls by shape, and the weighted
 * tokens of every slice sealed in the window. `compare` prints the bar: per
 * size group, the sealed `command` slices of the baseline window against the
 * sealed `sdk` slices of the SDK window, by name.
 *
 * It is READ-ONLY. It reads three sources and writes nothing:
 *
 * - TRANSCRIPTS: the main checkout's Claude Code project directory, where the
 *   board's own roles run, and every desk directory under the checkout's
 *   worktree root (`<checkout>/.worktrees`, or `--worktree-root=<dir>`), where
 *   a dispatched worker runs. A worker runs in its desk, so its transcript is
 *   written under the desk's slug and never under the main checkout's. Only
 *   fleet sessions count: `entrypoint` `sdk-cli` (`claude -p`, the `command`
 *   runner) or `sdk-ts` (the Agent SDK's default, the `sdk` runner). A `cli`
 *   session is an operator's own and never counts.
 * - THE SLICE-SPEND RECORD: `<git-common-dir>/.plot/state/slice-spend.jsonl`,
 *   found the way `slice-spend-file.ts` finds it, or under
 *   `PLOT_SLICE_SPEND_HOME`. A `command` slice is sealed by its seal line; an
 *   `sdk` slice by its run lines.
 * - GIT, for a slice's size: the PR number its plan's `## Slices` line names
 *   (`→ #N`), and the first-parent diff of the commit on the default branch
 *   whose subject names that PR. A slice with no such commit has no size and
 *   is named, not grouped.
 *
 * A SESSION'S RUNNER comes from two readings, the first that answers: its
 * session id on a run line of the record (`sdk`), then its `entrypoint`
 * (`sdk-ts` is `sdk`, `sdk-cli` is `command`).
 *
 * A SLICE ENDS AT A PERSON when one of its sessions wrote `PLOT-BLOCKED.md`,
 * the marker a worker leaves for a person.
 *
 * DUPLICATION, DECLARED: this script re-implements two pieces of domain
 * judgement rather than importing them, because a plain `.mjs` at the repo
 * root has no TypeScript loader for `@plot-pm/domain`:
 *   - `classifyPoll` labels a call's shape for REPORTING only; the refusal
 *     itself is read from the tool result's `plot: poll refused` prefix, which
 *     `packages/domain/src/rules/poll-refusal.ts` writes.
 *   - `sealedSlices`/`sessionIncrease` duplicate `readSpend`'s grouping and
 *     delta logic from `slice-spend-record.ts`, compared against it by
 *     `packages/domain/corpus/fleet-turns-spend.corpus.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Where the runtime keeps a checkout's transcripts — mirrors `transcriptDirFor` in `slice-spend-file.ts`. */
export const transcriptDirFor = (checkout, home) =>
  join(home, '.claude', 'projects', resolve(checkout).replace(/[/.]/g, '-'));

/**
 * Every transcript directory one checkout's fleet writes to: the checkout's
 * own, and each desk's under its worktree root.
 *
 * @param checkout - the main checkout's absolute path.
 * @param home - the transcript home, standing in for `~`.
 * @param worktreeRoot - the desks' parent directory, `<checkout>/.worktrees` by default.
 * @returns the directories that exist, the checkout's own first.
 */
export const fleetTranscriptDirs = (checkout, home, worktreeRoot = join(checkout, '.worktrees')) => {
  const projects = join(home, '.claude', 'projects');
  const deskPrefix = `${transcriptDirFor(worktreeRoot, home).split('/').at(-1)}-`;
  let names = [];
  try {
    names = readdirSync(projects);
  } catch {
    return [];
  }
  const own = transcriptDirFor(checkout, home);
  const desks = names.filter((name) => name.startsWith(deskPrefix)).map((name) => join(projects, name));
  return [...(names.includes(own.split('/').at(-1)) ? [own] : []), ...desks];
};

/** The fixed prefix a refused poll's tool result always opens with (`poll-refusal.ts`'s `POLL_REFUSAL_PREFIX`). */
export const POLL_REFUSAL_PREFIX = 'plot: poll refused';

/** The entrypoints a fleet session records: `claude -p` writes `sdk-cli`; the Agent SDK writes `sdk-ts` unless its parent set one. */
export const FLEET_ENTRYPOINTS = ['sdk-cli', 'sdk-ts'];

/** A command's basename, stripping any leading path. */
const wordBasename = (word) => word.split('/').at(-1) ?? word;

/** The reporting-only shape one Bash segment's words take, or `null` where it is not poll-shaped. */
const bashSegmentShape = (words) => {
  const first = wordBasename(words[0] ?? '');
  const args = words.slice(1);
  if (first === 'true' && args.length === 0) return 'true';
  if (first === 'sleep') return 'sleep';
  if (first === 'cat' || first === 'tail' || first === 'head' || first === 'less') {
    if (args.some((a) => /\/tasks\/[^/]+\.output$/.test(a))) return 'task-output cat';
  }
  if (first === 'ps') return 'ps';
  if (first === 'gh' && args[0] === 'run' && args[1] === 'watch') return 'CI read';
  if (first === 'gh' && args[0] === 'pr' && args[1] === 'checks') return 'CI read';
  return null;
};

/** The reporting-only poll shape a Bash command's FIRST segment takes, or `null`. */
const bashPollShape = (command) => {
  const first = command.split(/\n|&&|\|\||;|\|/)[0] ?? '';
  const words = first.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return null;
  return bashSegmentShape(words);
};

/**
 * The reporting-only poll shape one tool_use block takes, or `null` where the
 * call is not a polling-shaped call at all.
 *
 * Classification here never decides a refusal — it only labels a call for
 * the per-shape tally, after the real transcript already recorded whether
 * the rule refused it.
 */
export const classifyPoll = (block) => {
  if (block?.type !== 'tool_use') return null;
  if (block.name === 'ScheduleWakeup') return 'ScheduleWakeup';
  if (block.name === 'ListAgents') return 'ListAgents';
  if (block.name === 'Bash' && typeof block.input?.command === 'string') {
    return bashPollShape(block.input.command);
  }
  return null;
};

/** A tool_result's content as text. */
const resultText = (block) => (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''));

/** Whether one tool result is a refused poll — the only test; everything else polling-shaped is completed. */
const isRefusedResult = (text) => text.includes(POLL_REFUSAL_PREFIX);

/** Whether one tool_use block writes the `PLOT-BLOCKED.md` marker. */
const writesBlockedMarker = (block) => {
  if (block?.type !== 'tool_use') return false;
  const file = block.input?.file_path;
  if ((block.name === 'Write' || block.name === 'Edit') && typeof file === 'string') return /(^|\/)PLOT-BLOCKED\.md$/.test(file);
  const command = block.input?.command;
  return block.name === 'Bash' && typeof command === 'string' && /(>|\btee\s+(-a\s+)?)\s*\S*PLOT-BLOCKED\.md/.test(command);
};

/** One API response's weighted tokens and context, from its `usage`. */
const turnOf = (usage, model) => ({
  weightedTokens:
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) / 10,
  peakContext:
    (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
  model: model ?? null,
});

/**
 * Parses one transcript into its turns, polls and identity.
 *
 * ONE TURN IS ONE API RESPONSE, NOT ONE LINE. Claude Code writes one line per
 * content block of a response, and every line repeats the response's
 * `message.id` and `usage`. Counting lines counts a response once per block;
 * this keeps one turn per `message.id`, read from its last line, and counts a
 * line without an id as its own turn.
 */
const parseSession = (text) => {
  let entrypoint = null;
  let sessionId = null;
  let gitBranch = null;
  let firstAt = null;
  let blocked = false;
  const responses = new Map(); // message.id -> turn
  const polls = []; // { shape, refused }
  const idToShape = new Map();
  let anonymous = 0;

  for (const line of text.split('\n')) {
    if (line === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (entrypoint === null && typeof parsed.entrypoint === 'string') entrypoint = parsed.entrypoint;
    if (sessionId === null && typeof parsed.sessionId === 'string') sessionId = parsed.sessionId;
    if (gitBranch === null && typeof parsed.gitBranch === 'string' && parsed.gitBranch !== '') gitBranch = parsed.gitBranch;
    if (firstAt === null && typeof parsed.timestamp === 'string') firstAt = parsed.timestamp;

    const message = parsed?.message;
    if (message?.role === 'assistant' && message?.usage) {
      const key = typeof message.id === 'string' ? message.id : `anonymous-${(anonymous += 1)}`;
      responses.set(key, turnOf(message.usage, message.model));
    }

    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (writesBlockedMarker(block)) blocked = true;
      const shape = classifyPoll(block);
      if (shape !== null && typeof block.id === 'string') idToShape.set(block.id, shape);
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const shapeForThis = idToShape.get(block.tool_use_id);
        if (shapeForThis !== undefined) {
          polls.push({ shape: shapeForThis, refused: isRefusedResult(resultText(block)) });
        }
      }
    }
  }

  const turns = [...responses.values()];
  if (entrypoint === null && turns.length === 0 && polls.length === 0) return null;
  return { entrypoint, sessionId, gitBranch, firstAt, blocked, turns, polls };
};

/**
 * Reads one fleet session, or `null` for a session whose entrypoint is not a
 * fleet one (`FLEET_ENTRYPOINTS`) or an unparseable file. The inverse of
 * `count-master-diagnosis.mjs`'s `countSession`, which keeps `cli`.
 */
export const readFleetSession = (text) => {
  const session = parseSession(text);
  if (session === null) return null;
  if (!FLEET_ENTRYPOINTS.includes(session.entrypoint)) return null;
  return session;
};

/**
 * The runner one fleet session ran on, or `null` where neither reading answers.
 *
 * @param session - a session from `readFleetSession`.
 * @param sdkSessionIds - the session ids on the slice-spend record's run lines.
 * @returns `sdk` for a session id on a run line or an `sdk-ts` entrypoint, `command` for `sdk-cli`.
 */
export const sessionRunner = (session, sdkSessionIds) => {
  if (session.sessionId !== null && sdkSessionIds.has(session.sessionId)) return 'sdk';
  if (session.entrypoint === 'sdk-ts') return 'sdk';
  if (session.entrypoint === 'sdk-cli') return 'command';
  return null;
};

/** The largest context one session's turns read; 0 for a session with none. */
const peakContextOf = (turns) => turns.reduce((max, t) => Math.max(max, t.peakContext), 0);

/** Sum of weighted tokens across a session's turns. */
const sumWeighted = (turns) => turns.reduce((s, t) => s + t.weightedTokens, 0);

/**
 * Whether one run line's figures are all zero — a run that did not start.
 * Mirrors `isZeroedRun` in `slice-spend-record.ts`.
 */
const isZeroedRun = (run) =>
  run.costUsd === 0 &&
  Object.values(run.models ?? {}).every((m) => Object.values(m).every((v) => v === 0));

/**
 * What one session's run lines added, read in file order — duplicates
 * `sessionIncrease` in `slice-spend-record.ts`. See the module header for
 * why this is a declared duplicate rather than an import.
 */
const sessionIncrease = (runs) => {
  const models = {};
  let costUsd = 0;
  let previous = null;
  const addTokens = (into, add) => {
    into.inputTokens = (into.inputTokens ?? 0) + (add.inputTokens ?? 0);
    into.outputTokens = (into.outputTokens ?? 0) + (add.outputTokens ?? 0);
    into.cacheCreationTokens = (into.cacheCreationTokens ?? 0) + (add.cacheCreationTokens ?? 0);
    into.cacheReadTokens = (into.cacheReadTokens ?? 0) + (add.cacheReadTokens ?? 0);
  };
  const subtract = (spend, prior) => ({
    inputTokens: Math.max(0, (spend.inputTokens ?? 0) - (prior.inputTokens ?? 0)),
    outputTokens: Math.max(0, (spend.outputTokens ?? 0) - (prior.outputTokens ?? 0)),
    cacheCreationTokens: Math.max(0, (spend.cacheCreationTokens ?? 0) - (prior.cacheCreationTokens ?? 0)),
    cacheReadTokens: Math.max(0, (spend.cacheReadTokens ?? 0) - (prior.cacheReadTokens ?? 0)),
  });
  for (const run of runs) {
    if (isZeroedRun(run)) continue;
    if (previous === null) {
      for (const [model, spend] of Object.entries(run.models ?? {})) {
        models[model] = models[model] ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
        addTokens(models[model], spend);
      }
      costUsd += run.costUsd ?? 0;
      previous = run;
      continue;
    }
    const reset = (run.costUsd ?? 0) < (previous.costUsd ?? 0);
    for (const [model, spend] of Object.entries(run.models ?? {})) {
      const prior = previous.models?.[model];
      const delta = reset || prior === undefined ? spend : subtract(spend, prior);
      models[model] = models[model] ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      addTokens(models[model], delta);
    }
    costUsd += reset ? (run.costUsd ?? 0) : (run.costUsd ?? 0) - (previous.costUsd ?? 0);
    previous = run;
  }
  return { models, costUsd };
};

/** Weighted tokens (cache read at 1/10) summed across a model-keyed token map. */
const weightedFromModels = (models) =>
  Object.values(models).reduce(
    (sum, t) =>
      sum + (t.inputTokens ?? 0) + (t.outputTokens ?? 0) + (t.cacheCreationTokens ?? 0) + (t.cacheReadTokens ?? 0) / 10,
    0,
  );

/**
 * Reads every branch's sealed weighted-token total out of the slice-spend
 * record's raw lines, split by runner. A `command`-run branch is sealed by a
 * seal line (no `kind`); an `sdk`-run branch is sealed by having at least one
 * run line. A branch with BOTH a seal line and run lines straddled the
 * runner switch — it is attributed to the runner of its NEWEST contribution
 * (a run line's `at`, or the seal's `at`, whichever is later), and named as
 * straddling rather than silently split.
 *
 * @param lines - the record's raw lines, in file order.
 * @returns `{ sealed, straddling }` — `sealed` maps branch -> { runner, weightedTokens, turns, runs, at };
 *   `runs` is the run-line session count on `sdk` and `null` on `command`, whose seal names none.
 */
export const sealedSlices = (lines) => {
  const bySession = new Map(); // branch -> sessionId -> run[]
  const seals = new Map(); // branch -> newest seal
  const runAt = new Map(); // branch -> newest run `at`

  for (const line of lines) {
    if (typeof line !== 'string' || line.trim() === '') continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record?.branch !== 'string') continue;
    if (record.kind === 'run') {
      const perBranch = bySession.get(record.branch) ?? new Map();
      const perSession = perBranch.get(record.sessionId) ?? [];
      perSession.push(record);
      perBranch.set(record.sessionId, perSession);
      bySession.set(record.branch, perBranch);
      const prevAt = runAt.get(record.branch);
      if (prevAt === undefined || record.at > prevAt) runAt.set(record.branch, record.at);
    } else {
      const prev = seals.get(record.branch);
      if (prev === undefined || record.at > prev.at) seals.set(record.branch, record);
    }
  }

  const sealed = new Map();
  const straddling = [];
  const branches = new Set([...bySession.keys(), ...seals.keys()]);
  for (const branch of branches) {
    const perSession = bySession.get(branch);
    const seal = seals.get(branch);
    const hasRuns = perSession !== undefined && perSession.size > 0;
    const hasSeal = seal !== undefined;

    if (hasRuns && hasSeal) {
      straddling.push(branch);
      const newestRunAt = runAt.get(branch);
      const runner = newestRunAt !== undefined && newestRunAt > seal.at ? 'sdk' : 'command';
      if (runner === 'sdk') {
        let weightedTokens = 0;
        for (const runs of perSession.values()) weightedTokens += weightedFromModels(sessionIncrease(runs).models);
        sealed.set(branch, { runner: 'sdk', weightedTokens, turns: runTurns(perSession), runs: perSession.size, at: newestRunAt });
      } else {
        sealed.set(branch, sealEntry(seal));
      }
      continue;
    }

    if (hasRuns) {
      let weightedTokens = 0;
      let newestAt = null;
      for (const runs of perSession.values()) {
        weightedTokens += weightedFromModels(sessionIncrease(runs).models);
        for (const run of runs) if (newestAt === null || run.at > newestAt) newestAt = run.at;
      }
      sealed.set(branch, { runner: 'sdk', weightedTokens, turns: runTurns(perSession), runs: perSession.size, at: newestAt });
      continue;
    }

    if (hasSeal) {
      sealed.set(branch, sealEntry(seal));
    }
  }

  return { sealed, straddling };
};

/** Turns summed over every run line of a branch — a run line's `turns` is per run, never cumulative. */
const runTurns = (perSession) => [...perSession.values()].flat().reduce((sum, run) => sum + (run.turns ?? 0), 0);

/** A `command` slice's entry from its newest seal line. */
const sealEntry = (seal) => ({
  runner: 'command',
  weightedTokens: weightedFromModels({ seal: seal.tokens }),
  turns: seal.turns ?? null,
  runs: null,
  at: seal.at,
});

/** Median of a numeric array; `null` for an empty array. */
export const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};


/** The percentile `p` (0..1) of a numeric array, nearest rank; `null` for an empty array. */
const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

/**
 * The slice-spend record's lines, found the way `slice-spend-file.ts` finds
 * them: `PLOT_SLICE_SPEND_HOME` when set, else the checkout's COMMON git dir
 * under `.plot/state/`. A desk's own `.plot/state/` never holds it.
 *
 * @param checkout - any checkout of the repository.
 * @param env - the environment to read the override from.
 * @returns `{ path, lines }`; `lines` is `null` where the file cannot be read.
 */
export const readSpendRecord = (checkout, env = process.env) => {
  const override = env.PLOT_SLICE_SPEND_HOME;
  let dir = null;
  if (override !== undefined && override !== '') {
    dir = override;
  } else {
    try {
      const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: checkout, encoding: 'utf8' }).trim();
      dir = join(resolve(checkout, out), '.plot', 'state');
    } catch {
      return { path: null, lines: null };
    }
  }
  const path = join(dir, 'slice-spend.jsonl');
  try {
    return { path, lines: readFileSync(path, 'utf8').split('\n') };
  } catch {
    return { path, lines: null };
  }
};

/** The session ids on the record's run lines — each one an `sdk` session. */
export const sdkSessionIdsOf = (lines) => {
  const ids = new Set();
  for (const line of lines ?? []) {
    try {
      const record = JSON.parse(line);
      if (record?.kind === 'run' && typeof record.sessionId === 'string') ids.add(record.sessionId);
    } catch {
      // an unreadable line names no session
    }
  }
  return ids;
};

const RUNNERS = ['command', 'sdk', 'unknown'];

const emptyRunnerBucket = () => ({ sessions: 0, turns: 0, weightedTokens: 0, peakContextSum: 0, runTurns: [], polls: {} });

const emptyRunners = () => Object.fromEntries(RUNNERS.map((runner) => [runner, emptyRunnerBucket()]));

/** Adds one session to a runner bucket. */
const addSession = (bucket, session) => {
  bucket.sessions += 1;
  bucket.turns += session.turns.length;
  bucket.runTurns.push(session.turns.length);
  bucket.weightedTokens += sumWeighted(session.turns);
  bucket.peakContextSum += peakContextOf(session.turns);
  for (const poll of session.polls) {
    const shapeBucket = (bucket.polls[poll.shape] ??= { completed: 0, refused: 0 });
    if (poll.refused) shapeBucket.refused += 1;
    else shapeBucket.completed += 1;
  }
};

/**
 * Reads every fleet session that STARTED in one window, split by runner and
 * by day (UTC, from the session's first timestamp).
 *
 * @param transcriptDirs - one directory or several: the checkout's and its desks'.
 * @param since - window start, inclusive.
 * @param until - window end, exclusive.
 * @param runnerOf - `(session) => 'command' | 'sdk' | null`; `null` counts as `unknown`, never on either side.
 * @returns `measured: false` where no fleet session started in the window —
 *   AN EMPTY WINDOW IS UNMEASURED, NEVER ZERO. `sessions` lists each session's
 *   runner, branch, turns and marker, for the slice reading.
 */
export const countWindow = (transcriptDirs, since, until, runnerOf) => {
  const dirs = Array.isArray(transcriptDirs) ? transcriptDirs : [transcriptDirs];
  const byRunner = emptyRunners();
  const byDay = {};
  const sessions = [];

  for (const dir of dirs) {
    let files;
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const path = join(dir, entry.name);
      let text;
      try {
        // A file last written before the window opened cannot hold a session that started in it.
        if (statSync(path).mtime < since) continue;
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const session = readFleetSession(text);
      if (session === null) continue;
      const started = session.firstAt === null ? statSync(path).mtime : new Date(session.firstAt);
      if (started < since || started >= until) continue;

      const runner = runnerOf(session) ?? 'unknown';
      const day = started.toISOString().slice(0, 10);
      addSession(byRunner[runner], session);
      addSession((byDay[day] ??= emptyRunners())[runner], session);
      sessions.push({ runner, branch: session.gitBranch, turns: session.turns.length, blocked: session.blocked });
    }
  }

  if (sessions.length === 0) return { measured: false, byRunner: {}, byDay: {}, sessions: [] };
  return { measured: true, byRunner, byDay, sessions };
};

/** Total completed polls across every shape in a runner bucket. */
export const completedPolls = (bucket) => Object.values(bucket.polls).reduce((s, p) => s + p.completed, 0);

/** Total refused polls across every shape in a runner bucket. */
export const refusedPolls = (bucket) => Object.values(bucket.polls).reduce((s, p) => s + p.refused, 0);

/**
 * The PR number each branch's plan line names, from `→ #N` in `## Slices`.
 *
 * @param planText - the plans' text, concatenated.
 * @returns branch -> PR number; the last line naming a branch wins.
 */
export const prNumbersFromPlans = (planText) => {
  const numbers = new Map();
  for (const match of planText.matchAll(/^\s*-\s*`([^`]+)`[^\n]*?→\s*#(\d+)/gm)) numbers.set(match[1], Number(match[2]));
  return numbers;
};

/**
 * The PR number a commit subject on the default branch names, for both host
 * forms: a squash subject ending `(#N)` and `Merge pull request #N from …`.
 */
export const prNumberOfSubject = (subject) => {
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash) return Number(squash[1]);
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  return merge ? Number(merge[1]) : null;
};

/**
 * Each sealed branch's changed lines: insertions plus deletions of the
 * first-parent diff of the default-branch commit that names its PR.
 *
 * @returns branch -> changed lines; a branch with no PR or no commit is absent.
 */
const changedLinesOf = (checkout, branches, ref) => {
  const git = (args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const sizes = new Map();
  let plans = '';
  let subjects = '';
  try {
    plans = git(['grep', '-h', '-E', '→ #[0-9]+', ref, '--', 'docs/plans']);
  } catch {
    return sizes;
  }
  try {
    subjects = git(['log', ref, '--first-parent', '--format=%H%x09%s']);
  } catch {
    return sizes;
  }
  const prs = prNumbersFromPlans(plans);
  const commitOfPr = new Map();
  for (const row of subjects.split('\n')) {
    const [sha, subject = ''] = row.split('\t');
    const number = prNumberOfSubject(subject);
    if (number !== null && !commitOfPr.has(number)) commitOfPr.set(number, sha);
  }
  for (const branch of branches) {
    const sha = commitOfPr.get(prs.get(branch));
    if (sha === undefined) continue;
    const stat = git(['diff', '--shortstat', `${sha}^1`, sha]);
    const added = Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0);
    const removed = Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0);
    sizes.set(branch, added + removed);
  }
  return sizes;
};

/** The fewest sealed slices each side's window must hold before the bar is read. */
export const MIN_WINDOW_SLICES = 20;

/** The fewest slices each size group must hold on each side. */
export const MIN_GROUP_SLICES = 5;

/**
 * The comparison the bar needs: per size group, sealed-slice counts and
 * median weighted tokens per sealed slice on each runner, the SDK median as
 * a % of baseline's, and the SDK window's completed-poll count.
 *
 * @param baselineSlices - `[{branch, weightedTokens, changedLines, endedAtPerson}]` for the `command` baseline window.
 * @param sdkSlices - the same shape for the `sdk` window; empty where no SDK window exists yet.
 * @param sdkPollsCompleted - completed-poll count measured over the SDK window.
 * @param sdkWindowEmpty - true when the SDK side has zero sealed slices — reported as "no SDK window", never "0 completed polls" as if that were evidence.
 * @returns the per-group figures, each condition's answer (`null` where unmeasured) and `barHolds`.
 */
export const compareBar = (baselineSlices, sdkSlices, sdkPollsCompleted, sdkWindowEmpty) => {
  const groups = [
    { key: 'small', label: '≤200 changed lines', test: (s) => s.changedLines <= 200 },
    { key: 'large', label: '>200 changed lines', test: (s) => s.changedLines > 200 },
  ];

  const byGroup = {};
  for (const group of groups) {
    const base = baselineSlices.filter(group.test);
    const sdk = sdkSlices.filter(group.test);
    const tooFew = base.length < MIN_GROUP_SLICES || sdk.length < MIN_GROUP_SLICES;
    const baseMedian = median(base.map((s) => s.weightedTokens));
    const sdkMedian = median(sdk.map((s) => s.weightedTokens));
    byGroup[group.key] = {
      label: group.label,
      baselineCount: base.length,
      sdkCount: sdk.length,
      baselineBranches: base.map((s) => s.branch),
      sdkBranches: sdk.map((s) => s.branch),
      baselineMedian: baseMedian,
      sdkMedian,
      tooFew,
      sdkPctOfBaseline: tooFew || baseMedian === null || baseMedian === 0 ? null : (sdkMedian / baseMedian) * 100,
      met: tooFew ? null : sdkMedian !== null && baseMedian !== null && baseMedian > 0 && sdkMedian <= baseMedian * 0.85,
    };
  }

  const shareAtPerson = (slices) => (slices.length === 0 ? null : slices.filter((s) => s.endedAtPerson).length / slices.length);
  const baselineShare = shareAtPerson(baselineSlices);
  const sdkShare = shareAtPerson(sdkSlices);
  const baselineEmpty = baselineSlices.length === 0;
  const baselineTooSmall = baselineSlices.length < MIN_WINDOW_SLICES;
  const sdkTooSmall = sdkSlices.length < MIN_WINDOW_SLICES;

  return {
    byGroup,
    baselineEmpty,
    baselineTooSmall,
    sdkWindowEmpty,
    sdkTooSmall,
    sdkPollsCompleted: sdkWindowEmpty ? null : sdkPollsCompleted,
    pollsMet: sdkWindowEmpty ? null : sdkPollsCompleted === 0,
    baselineShareAtPerson: baselineShare,
    sdkShareAtPerson: sdkShare,
    shareMet: sdkWindowEmpty || baselineShare === null || sdkShare === null ? null : sdkShare <= baselineShare,
    barHolds:
      !sdkWindowEmpty &&
      !baselineTooSmall &&
      !sdkTooSmall &&
      groups.every((g) => byGroup[g.key].met === true) &&
      sdkPollsCompleted === 0 &&
      baselineShare !== null &&
      sdkShare !== null &&
      sdkShare <= baselineShare,
  };
};

/**
 * The slices one side of the bar counts: every slice sealed in the window on
 * that runner, with its size and whether it ended at a person.
 *
 * @param sealed - `sealedSlices(lines).sealed`.
 * @param runner - `command` for the baseline, `sdk` for the SDK window.
 * @param since - window start, inclusive.
 * @param until - window end, exclusive.
 * @param sizes - branch -> changed lines.
 * @param sessions - every fleet session read, for the `PLOT-BLOCKED.md` marker.
 * @returns `{ slices, unsized }` — `unsized` names the slices with no size, which no group counts.
 */
export const sideSlices = (sealed, runner, since, until, sizes, sessions) => {
  const slices = [];
  const unsized = [];
  for (const [branch, entry] of sealed) {
    if (entry.runner !== runner) continue;
    const at = new Date(entry.at);
    if (at < since || at >= until) continue;
    if (!sizes.has(branch)) {
      unsized.push(branch);
      continue;
    }
    slices.push({
      branch,
      weightedTokens: entry.weightedTokens,
      changedLines: sizes.get(branch),
      endedAtPerson: sessions.some((s) => s.branch === branch && s.blocked),
    });
  }
  return { slices, unsized };
};

const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);

/** One runner's line of the per-day table, or `null` for a runner with no session. */
const formatRow = (day, runner, bucket) =>
  bucket.sessions === 0
    ? null
    : `| ${day} | ${runner} | ${bucket.sessions} | ${Math.round(bucket.turns / bucket.sessions)} | ${fmtK(bucket.peakContextSum / bucket.sessions)} | ${fmtK(bucket.weightedTokens)} | ${completedPolls(bucket)} | ${refusedPolls(bucket)} |`;

/** The turns-per-run line for one runner. */
const formatRuns = (runner, bucket) =>
  bucket.sessions === 0
    ? `  ${runner}: no runs`
    : `  ${runner}: ${bucket.sessions} runs, median ${median(bucket.runTurns)}, p90 ${percentile(bucket.runTurns, 0.9)}, max ${Math.max(...bucket.runTurns)}, ${bucket.runTurns.filter((t) => t > 150).length} above 150`;

/** The report for one window: the per-day table, turns per run, poll shapes, and its sealed slices. */
export const formatReport = (label, report, sealedInWindow) => {
  if (!report.measured) return `${label}: unmeasured (no fleet session started in this window)`;
  const lines = [
    `${label}:`,
    '| Day | Runner | Fleet sessions | Turns per session | Mean peak context | Weighted tokens | Completed polls | Refused polls |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const day of Object.keys(report.byDay).sort()) {
    for (const runner of RUNNERS) {
      const row = formatRow(day, runner, report.byDay[day][runner]);
      if (row !== null) lines.push(row);
    }
  }
  lines.push('turns per run:');
  for (const runner of RUNNERS) lines.push(formatRuns(runner, report.byRunner[runner]));
  lines.push('poll shapes (completed/refused):');
  for (const runner of RUNNERS) {
    const shapes = Object.entries(report.byRunner[runner].polls).map(([shape, p]) => `${shape} ${p.completed}/${p.refused}`);
    lines.push(`  ${runner}: ${shapes.length === 0 ? 'none' : shapes.join(', ')}`);
  }
  lines.push(`sealed slices: ${sealedInWindow.length}`);
  for (const [branch, entry] of sealedInWindow) {
    lines.push(
      `  ${entry.at} ${entry.runner} ${branch}: ${fmtK(entry.weightedTokens)} weighted, ${entry.turns ?? 'unmeasured'} turns, ${entry.runs ?? 'unmeasured'} runs`,
    );
  }
  return lines.join('\n');
};

/** The bar's comparison as text, naming every slice counted on each side. */
export const formatCompare = (compare, baselineUnsized, sdkUnsized) => {
  const lines = ['bar comparison:'];
  const count = (group) => group.baselineCount + group.sdkCount;
  const base = Object.values(compare.byGroup).reduce((s, g) => s + g.baselineCount, 0);
  const sdk = Object.values(compare.byGroup).reduce((s, g) => s + g.sdkCount, 0);
  lines.push(`  baseline: ${compare.baselineEmpty ? 'no baseline' : `${base} sized slices`}${compare.baselineTooSmall ? ` — too small (fewer than ${MIN_WINDOW_SLICES})` : ''}`);
  lines.push(`  sdk window: ${compare.sdkWindowEmpty ? 'no SDK window' : `${sdk} sized slices`}${!compare.sdkWindowEmpty && compare.sdkTooSmall ? ` — too small (fewer than ${MIN_WINDOW_SLICES})` : ''}`);
  for (const group of Object.values(compare.byGroup)) {
    const names = `baseline ${group.baselineCount} [${group.baselineBranches.join(', ')}], sdk ${group.sdkCount} [${group.sdkBranches.join(', ')}]`;
    if (group.tooFew || count(group) === 0) {
      lines.push(`  ${group.label}: too few (${names})`);
      continue;
    }
    lines.push(
      `  ${group.label}: baseline median ${fmtK(group.baselineMedian)}, sdk median ${fmtK(group.sdkMedian)}, sdk is ${group.sdkPctOfBaseline?.toFixed(1)}% of baseline — ${group.met ? 'met' : 'not met'} (${names})`,
    );
  }
  if (baselineUnsized.length > 0) lines.push(`  baseline slices with no size, not grouped: ${baselineUnsized.join(', ')}`);
  if (sdkUnsized.length > 0) lines.push(`  sdk slices with no size, not grouped: ${sdkUnsized.join(', ')}`);
  lines.push(compare.sdkWindowEmpty ? '  polls: no SDK window' : `  sdk completed polls: ${compare.sdkPollsCompleted} — ${compare.pollsMet ? 'met' : 'not met'}`);
  lines.push(
    `  share ending at a person: baseline ${compare.baselineShareAtPerson ?? 'unmeasured'}, sdk ${compare.sdkShareAtPerson ?? 'unmeasured'} — ${compare.shareMet === null ? 'unmeasured' : compare.shareMet ? 'met' : 'not met'}`,
  );
  lines.push(`  bar holds: ${compare.barHolds}`);
  return lines.join('\n');
};

const USAGE = [
  'usage: node scripts/count-fleet-turns.mjs [report] <sinceISO> <untilISO> [checkout] [--worktree-root=<dir>]',
  '       node scripts/count-fleet-turns.mjs compare <baselineSince> <baselineUntil> <sdkSince> <sdkUntil> [checkout] [--worktree-root=<dir>]',
].join('\n');

/** The sources one run reads: transcript directories, the spend record, and each session's runner. */
const sourcesFor = (checkout, worktreeRoot) => {
  const home = process.env.PLOT_TRANSCRIPT_HOME ?? homedir();
  const dirs = fleetTranscriptDirs(checkout, home, worktreeRoot);
  const record = readSpendRecord(checkout);
  const sdkIds = sdkSessionIdsOf(record.lines);
  return { dirs, record, runnerOf: (session) => sessionRunner(session, sdkIds) };
};

/** The sealed slices whose seal or newest run falls in one window. */
const sealedIn = (sealed, since, until) =>
  [...sealed].filter(([, entry]) => new Date(entry.at) >= since && new Date(entry.at) < until).sort((a, b) => a[1].at.localeCompare(b[1].at));

const main = () => {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));
  const rootFlag = flags.find((f) => f.startsWith('--worktree-root='));
  const mode = positional[0] === 'compare' || positional[0] === 'report' ? positional.shift() : 'report';
  const windowArgs = mode === 'compare' ? 4 : 2;
  if (positional.length < windowArgs) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const checkout = resolve(positional[windowArgs] ?? process.cwd());
  const worktreeRoot = rootFlag === undefined ? join(checkout, '.worktrees') : resolve(checkout, rootFlag.split('=')[1]);
  const { dirs, record, runnerOf } = sourcesFor(checkout, worktreeRoot);
  const { sealed, straddling } = sealedSlices(record.lines ?? []);
  console.log(`transcripts: ${dirs.length} directories; slice-spend record: ${record.path ?? 'not found'}${record.lines === null ? ' (unreadable)' : ''}`);
  if (straddling.length > 0) console.log(`straddling the runner switch, counted once under the newest run: ${straddling.join(', ')}`);

  const windows = [];
  for (let i = 0; i < windowArgs; i += 2) windows.push([positional[i], positional[i + 1]]);
  const reports = windows.map(([a, b]) => {
    const since = new Date(a);
    const until = new Date(b);
    const report = countWindow(dirs, since, until, runnerOf);
    console.log(formatReport(`${a} .. ${b}`, report, sealedIn(sealed, since, until)));
    return { since, until, report };
  });
  if (mode !== 'compare') return;

  const [base, sdk] = reports;
  const sizes = changedLinesOf(checkout, [...sealed.keys()], process.env.PLOT_COMPARE_REF ?? 'origin/main');
  const baseSide = sideSlices(sealed, 'command', base.since, base.until, sizes, base.report.sessions);
  const sdkSide = sideSlices(sealed, 'sdk', sdk.since, sdk.until, sizes, sdk.report.sessions);
  const sdkEmpty = sdkSide.slices.length + sdkSide.unsized.length === 0;
  const sdkPolls = sdk.report.measured ? completedPolls(sdk.report.byRunner.sdk) : 0;
  console.log(formatCompare(compareBar(baseSide.slices, sdkSide.slices, sdkPolls, sdkEmpty), baseSide.unsized, sdkSide.unsized));
};

if (import.meta.url === `file://${process.argv[1]}`) main();

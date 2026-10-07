#!/usr/bin/env node
/**
 * Whether the Agent SDK costs the fleet less than `command` did, and whether
 * polling disappeared — the two questions `the-sdk-is-the-default-runner`
 * gates its flip on.
 *
 *   node scripts/count-fleet-turns.mjs <sinceISO> <untilISO> [checkout]
 *   node scripts/count-fleet-turns.mjs compare <baselineSince> <baselineUntil> <sdkSince> <sdkUntil> <spendLines...>
 *
 * It is READ-ONLY: it opens transcript files and a slice-spend record's
 * lines (handed in by the caller, never read from disk itself) and prints a
 * report. It derives nothing about which slices were "delivered" — a sealed
 * `command` slice has a seal line in the record; a run slice has run lines;
 * "sealed" here means either is present, read with the same grouping and
 * delta logic as `readSpend` (`packages/domain/src/rules/slice-spend-record.ts`).
 *
 * SCOPE: fleet sessions only (`entrypoint: "sdk-cli"`), in the MAIN
 * CHECKOUT's Claude Code project directory — never a worktree's own, and
 * never a `cli` session, which is an operator's own interactive work. This is
 * the exact inverse of `count-master-diagnosis.mjs`'s scope.
 *
 * DUPLICATION, DECLARED: this script re-implements two pieces of domain
 * judgement rather than importing them, because a plain `.mjs` at the repo
 * root has no TypeScript loader for `@plot-pm/domain` (`docs/shell-and-domain.md`'s
 * "once per agent per pass duplicates the rule" case):
 *   - `isPollRefusal`/`classifyPoll` duplicate the SHAPE side of
 *     `packages/domain/src/rules/poll-refusal.ts`'s `pollRefusal` — detecting
 *     the fixed `plot: poll refused` prefix in a tool result is exact, no
 *     judgement; classifying a call's shape (`true`, `sleep`, a task-output
 *     read, `ps`, `ScheduleWakeup`, `ListAgents`, a CI read) for REPORTING
 *     only, never for a refusal decision, is declared here rather than
 *     corpus-tested against the rule, because this script does not decide
 *     whether to refuse — it counts what the rule already refused.
 *   - `sealedSlices`/`sessionIncrease` duplicate `readSpend`'s grouping and
 *     delta logic from `slice-spend-record.ts`, verified against it by
 *     `test/reconcile/count-fleet-turns.test.mjs`'s corpus case: the same
 *     fixture lines read through both this script's reducer and the domain
 *     rule must agree on each branch's sealed/not-sealed state and total
 *     tokens, per `docs/shell-and-domain.md`'s "the test says they agree."
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Where the runtime keeps a checkout's transcripts — mirrors `transcriptDirFor` in `slice-spend-file.ts`. */
export const transcriptDirFor = (checkout, home) =>
  join(home, '.claude', 'projects', resolve(checkout).replace(/[/.]/g, '-'));

/** The fixed prefix a refused poll's tool result always opens with (`poll-refusal.ts`'s `POLL_REFUSAL_PREFIX`). */
export const POLL_REFUSAL_PREFIX = 'plot: poll refused';

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

/** Whether a tool_result's content carries the fixed poll-refusal prefix. */
const resultText = (block) => (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''));

/** Whether one tool result is a refused poll — the only test; everything else polling-shaped is completed. */
const isRefusedResult = (text) => text.startsWith(POLL_REFUSAL_PREFIX) || text.includes(POLL_REFUSAL_PREFIX);

/**
 * Parses one transcript's lines into per-day, per-runner usage and poll
 * tallies. A fleet transcript carries one runner for its whole life — the
 * runner is read once per session from the first usable signal and applied
 * to every line, because the SDK run's own command line is not present in
 * the transcript; the CALLER decides which runner a session belongs to by
 * passing `runnerFor(sessionId)`, derived from the slice-spend record's run
 * lines (a `kind: 'run'` line's `sessionId` is an SDK session; everything
 * else fleet-side is `command`).
 */
const parseSession = (text) => {
  let entrypoint = null;
  let sessionId = null;
  const turns = []; // { weightedTokens, peakContext, model }
  const polls = []; // { shape, refused }
  const idToShape = new Map();

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

    const content = parsed?.message?.content;
    if (!Array.isArray(content)) continue;

    if (parsed.message?.role === 'assistant' && parsed.message?.usage) {
      const usage = parsed.message.usage;
      const weighted =
        (usage.input_tokens ?? 0) +
        (usage.output_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) / 10;
      const peakContext =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      turns.push({ weightedTokens: weighted, peakContext, model: parsed.message.model ?? null });
    }

    for (const block of content) {
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

  if (entrypoint === null && turns.length === 0 && polls.length === 0) return null;
  return { entrypoint, sessionId, turns, polls };
};

/**
 * Reads one fleet session, or `null` for a non-`sdk-cli` session or an
 * unparseable file. The inverse of `count-master-diagnosis.mjs`'s
 * `countSession`, which keeps `cli` and excludes `sdk-cli`.
 */
export const readFleetSession = (text) => {
  const session = parseSession(text);
  if (session === null) return null;
  if (session.entrypoint !== 'sdk-cli') return null;
  return session;
};

/** Mean peak context across a session's turns; 0 for a session with none. */
const meanPeakContext = (turns) => (turns.length === 0 ? 0 : turns.reduce((s, t) => s + t.peakContext, 0) / turns.length);

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
 * @returns `{ sealed, straddling }` — `sealed` maps branch -> { runner, weightedTokens, sessionId, at }.
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
        sealed.set(branch, { runner: 'sdk', weightedTokens, at: newestRunAt });
      } else {
        sealed.set(branch, { runner: 'command', weightedTokens: weightedFromModels({ seal: seal.tokens }), at: seal.at });
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
      sealed.set(branch, { runner: 'sdk', weightedTokens, at: newestAt });
      continue;
    }

    if (hasSeal) {
      sealed.set(branch, { runner: 'command', weightedTokens: weightedFromModels({ seal: seal.tokens }), at: seal.at });
    }
  }

  return { sealed, straddling };
};

/** Median of a numeric array; `null` for an empty array. */
export const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * Reports one window's fleet-turn usage, split by runner, day, and poll
 * outcome.
 *
 * @param transcriptDir - the MAIN checkout's transcript directory.
 * @param since - window start, inclusive.
 * @param until - window end, exclusive.
 * @param runnerForSession - `(sessionId) => 'command' | 'sdk' | null`; `null`
 *   means this script cannot place the session on either runner (no
 *   slice-spend run/seal line matched it) and it is counted as `unknown`,
 *   never silently folded into either side.
 * @returns `measured: false` where the directory holds no fleet session in
 *   range — AN EMPTY WINDOW IS UNMEASURED, NEVER ZERO.
 */
export const countWindow = (transcriptDir, since, until, runnerForSession) => {
  let files;
  try {
    files = readdirSync(transcriptDir, { withFileTypes: true });
  } catch {
    return { measured: false, byRunner: {} };
  }

  const byRunner = { command: emptyRunnerBucket(), sdk: emptyRunnerBucket(), unknown: emptyRunnerBucket() };
  let sessions = 0;

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const path = join(transcriptDir, entry.name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.mtime < since || stat.mtime >= until) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const session = readFleetSession(text);
    if (session === null) continue;
    sessions += 1;

    const runner = session.sessionId === null ? null : runnerForSession(session.sessionId);
    const bucket = byRunner[runner ?? 'unknown'];
    bucket.sessions += 1;
    bucket.turns += session.turns.length;
    bucket.weightedTokens += sumWeighted(session.turns);
    bucket.peakContextSum += meanPeakContext(session.turns);
    for (const poll of session.polls) {
      const shapeBucket = (bucket.polls[poll.shape] ??= { completed: 0, refused: 0 });
      if (poll.refused) shapeBucket.refused += 1;
      else shapeBucket.completed += 1;
    }
  }

  if (sessions === 0) return { measured: false, byRunner: {} };
  return { measured: true, byRunner };
};

const emptyRunnerBucket = () => ({ sessions: 0, turns: 0, weightedTokens: 0, peakContextSum: 0, polls: {} });

/** Total completed polls across every shape in a runner bucket. */
export const completedPolls = (bucket) => Object.values(bucket.polls).reduce((s, p) => s + p.completed, 0);

/** Total refused polls across every shape in a runner bucket. */
export const refusedPolls = (bucket) => Object.values(bucket.polls).reduce((s, p) => s + p.refused, 0);

/**
 * The comparison the bar needs: per size group, sealed-slice counts and
 * median weighted tokens per sealed slice on each runner, the SDK median as
 * a % of baseline's, and the SDK window's completed-poll count.
 *
 * @param baselineSlices - `[{branch, weightedTokens, changedLines, endedAtPerson}]` for the `command` baseline window.
 * @param sdkSlices - the same shape for the `sdk` window; empty where no SDK window exists yet.
 * @param sdkPollsCompleted - completed-poll count measured over the SDK window (0 where the window is empty, but see `sdkWindowEmpty`).
 * @param sdkWindowEmpty - true when the SDK side has zero sealed slices — reported as "no SDK window", never "0 completed polls" as if that were evidence.
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
    const tooFew = base.length < 5 || sdk.length < 5;
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

  return {
    byGroup,
    sdkWindowEmpty,
    sdkPollsCompleted: sdkWindowEmpty ? null : sdkPollsCompleted,
    pollsMet: sdkWindowEmpty ? null : sdkPollsCompleted === 0,
    baselineShareAtPerson: baselineShare,
    sdkShareAtPerson: sdkShare,
    shareMet: sdkWindowEmpty || baselineShare === null || sdkShare === null ? null : sdkShare <= baselineShare,
    barHolds:
      !sdkWindowEmpty &&
      groups.every((g) => byGroup[g.key].met === true) &&
      sdkPollsCompleted === 0 &&
      baselineShare !== null &&
      sdkShare !== null &&
      sdkShare <= baselineShare,
  };
};

const formatBucket = (label, bucket) => {
  if (bucket.sessions === 0) return `  ${label}: 0 sessions`;
  const turnsPerSession = bucket.turns / bucket.sessions;
  const meanPeak = bucket.peakContextSum / bucket.sessions;
  return [
    `  ${label}:`,
    `    sessions: ${bucket.sessions}`,
    `    turns/session: ${turnsPerSession.toFixed(1)}`,
    `    mean peak context: ${Math.round(meanPeak)}`,
    `    weighted tokens: ${Math.round(bucket.weightedTokens)}`,
    `    completed polls: ${completedPolls(bucket)}`,
    `    refused polls: ${refusedPolls(bucket)}`,
    `    poll shapes: ${JSON.stringify(bucket.polls)}`,
  ].join('\n');
};

const formatReport = (label, report) => {
  if (!report.measured) return `${label}: unmeasured (no fleet session found in this window)`;
  return [
    `${label}:`,
    formatBucket('command', report.byRunner.command),
    formatBucket('sdk', report.byRunner.sdk),
    formatBucket('unknown (no matching slice-spend session)', report.byRunner.unknown),
  ].join('\n');
};

const formatCompare = (compare) => {
  const lines = ['bar comparison:'];
  for (const group of Object.values(compare.byGroup)) {
    if (group.tooFew) {
      lines.push(
        `  ${group.label}: too few (baseline ${group.baselineCount} [${group.baselineBranches.join(', ')}], sdk ${group.sdkCount} [${group.sdkBranches.join(', ')}])`,
      );
      continue;
    }
    lines.push(
      `  ${group.label}: baseline median ${group.baselineMedian} (${group.baselineCount} slices: ${group.baselineBranches.join(', ')}), ` +
        `sdk median ${group.sdkMedian} (${group.sdkCount} slices: ${group.sdkBranches.join(', ')}), ` +
        `sdk is ${group.sdkPctOfBaseline?.toFixed(1)}% of baseline — ${group.met ? 'met' : 'not met'}`,
    );
  }
  if (compare.sdkWindowEmpty) {
    lines.push('  polls: no SDK window');
  } else {
    lines.push(`  sdk completed polls: ${compare.sdkPollsCompleted} — ${compare.pollsMet ? 'met' : 'not met'}`);
  }
  lines.push(
    `  share ending at a person: baseline ${compare.baselineShareAtPerson}, sdk ${compare.sdkShareAtPerson} — ${compare.shareMet === null ? 'unmeasured' : compare.shareMet ? 'met' : 'not met'}`,
  );
  lines.push(`  bar holds: ${compare.barHolds}`);
  return lines.join('\n');
};

const main = () => {
  const [sinceArg, untilArg, checkoutArg] = process.argv.slice(2);
  if (!sinceArg || !untilArg) {
    console.error('usage: node scripts/count-fleet-turns.mjs <sinceISO> <untilISO> [checkout]');
    console.error('  runner attribution and the bar comparison are exported for callers to drive with real slice-spend data.');
    process.exitCode = 2;
    return;
  }
  const since = new Date(sinceArg);
  const until = new Date(untilArg);
  const checkout = resolve(checkoutArg ?? process.cwd());
  const dir = transcriptDirFor(checkout, process.env.PLOT_TRANSCRIPT_HOME ?? homedir());
  const report = countWindow(dir, since, until, () => null);
  console.log(formatReport(`${sinceArg} .. ${untilArg}`, report));
};

if (import.meta.url === `file://${process.argv[1]}`) main();

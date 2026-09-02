#!/usr/bin/env node
// The transcript half of `plot-quiet-stretch.sh` — read that file first; it
// holds the argument for what is being measured and why.
//
// This file does one thing: turn a directory of runtime transcripts into a
// distribution of QUIET STRETCHES, where a quiet stretch is the seconds between
// two consecutive lines the runtime wrote. It renders; it decides nothing.
//
// WHY EVERY TIMESTAMPED LINE COUNTS, not only assistant turns. The question is
// "did this session produce output?", and the runtime writes a line for a tool
// result and an attachment as readily as for a model turn — all of them prove
// the session is alive. Restricting to `assistant` would measure something
// narrower (how long between model turns) and report a LONGER quiet than any
// end condition would actually see, which is the error direction that kills
// working agents. Measured on a real dispatched session: assistant-only tops
// out at 33.1 s where the all-line reading is 46.6 s, and the second is what a
// tail-following rule observes.

import fs from 'node:fs';
import path from 'node:path';

const home = process.env.PLOT_QS_HOME || '';
const worktreesRoot = process.env.PLOT_QS_WORKTREES || '';
const asJson = process.env.PLOT_QS_JSON === '1';
const mergedOnly = process.env.PLOT_QS_MERGED_ONLY === '1';
const top = Number.parseInt(process.env.PLOT_QS_TOP || '10', 10) || 10;
const interval = Number.parseFloat(process.env.PLOT_QS_INTERVAL || '30') || 30;

/**
 * The runtime's project-slug derivation, duplicated from the board's
 * `projectSlug` on purpose: this script must run where the board is not built,
 * and importing a TypeScript source from a shell helper would make a
 * measurement depend on a compile step. The rule is one line and pinned by a
 * test on each side.
 */
const projectSlug = (cwd) => cwd.replace(/[/.]/g, '-');

const parseRows = (raw) =>
  (raw || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));

const liveRows = parseRows(process.env.PLOT_QS_LIVE);
const mergedRows = parseRows(process.env.PLOT_QS_MERGED);
const mergedSet = new Set(mergedRows.map((r) => r[0]));

/**
 * Every gap between consecutive timestamped lines in one transcript.
 *
 * **Unparseable lines are skipped, never treated as a break.** A line the
 * runtime wrote in a shape this script does not recognise is still output, so
 * dropping it silently would invent a quiet stretch that spans it. Skipping the
 * line keeps its neighbours adjacent, which understates rather than overstates
 * — the safe direction for a number a threshold will sit above.
 *
 * Sorted by time because a transcript is not guaranteed ordered: concurrent
 * writers append, and an out-of-order pair would otherwise yield a negative gap.
 */
const readGaps = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const times = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const ts = obj.timestamp;
    if (typeof ts !== 'string') continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    times.push({ t, type: typeof obj.type === 'string' ? obj.type : '?' });
  }
  if (times.length < 2) return null;
  times.sort((a, b) => a.t - b.t);
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push({
      seconds: (times[i].t - times[i - 1].t) / 1000,
      from: times[i - 1].type,
      to: times[i].type,
      at: new Date(times[i - 1].t).toISOString(),
    });
  }
  return {
    gaps,
    events: times.length,
    spanSeconds: (times.at(-1).t - times[0].t) / 1000,
    firstAt: new Date(times[0].t).toISOString(),
    lastAt: new Date(times.at(-1).t).toISOString(),
  };
};

/**
 * The transcripts belonging to one worktree.
 *
 * `agent-` prefixed files are skipped for the board's reason: a subagent's
 * transcript is a true statement about the wrong process. This measurement is
 * about the dispatched worker, whose quiet is what the monitor samples.
 */
const sessionsFor = (worktree) => {
  const dir = path.join(home, '.claude', 'projects', projectSlug(worktree));
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.jsonl') && !e.startsWith('agent-'))
    .map((e) => ({ id: e.replace(/\.jsonl$/, ''), file: path.join(dir, e) }));
};

const worktrees = (() => {
  try {
    return fs
      .readdirSync(worktreesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(worktreesRoot, d.name));
  } catch {
    return [];
  }
})();

const sessions = [];
for (const wt of worktrees) {
  if (mergedOnly && !mergedSet.has(wt)) continue;
  for (const s of sessionsFor(wt)) {
    const read = readGaps(s.file);
    if (!read) continue;
    const longest = read.gaps.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    sessions.push({
      worktree: wt,
      branch: path.basename(wt),
      session: s.id,
      events: read.events,
      spanSeconds: Number(read.spanSeconds.toFixed(1)),
      firstAt: read.firstAt,
      lastAt: read.lastAt,
      longestQuietSeconds: Number(longest.seconds.toFixed(1)),
      longestQuietAt: longest.at,
      longestQuietBetween: `${longest.from}->${longest.to}`,
      // How many stretches this session alone spent longer than the monitor's
      // window. Each one is an occasion the rule could have fired on an agent
      // that went on producing output.
      overWindow: read.gaps.filter((g) => g.seconds >= interval).length,
    });
  }
}

const allGaps = [];
for (const wt of worktrees) {
  if (mergedOnly && !mergedSet.has(wt)) continue;
  for (const s of sessionsFor(wt)) {
    const read = readGaps(s.file);
    if (!read) continue;
    for (const g of read.gaps) allGaps.push({ ...g, branch: path.basename(wt), session: s.id });
  }
}
allGaps.sort((a, b) => b.seconds - a.seconds);

/**
 * A percentile over the sorted-descending gap list.
 *
 * Nearest-rank, not interpolated: the number is going to be compared against a
 * threshold in seconds, and an interpolated value is not a stretch any agent
 * actually had. Every figure this reports is an observation.
 */
const percentile = (p) => {
  if (allGaps.length === 0) return null;
  const asc = [...allGaps].sort((a, b) => a.seconds - b.seconds);
  const rank = Math.min(asc.length - 1, Math.max(0, Math.ceil((p / 100) * asc.length) - 1));
  return Number(asc[rank].seconds.toFixed(1));
};

const summary = {
  interval,
  mergedOnly,
  worktreesScanned: worktrees.length,
  sessions: sessions.length,
  gaps: allGaps.length,
  longestQuietSeconds: allGaps.length ? Number(allGaps[0].seconds.toFixed(1)) : null,
  p50: percentile(50),
  p90: percentile(90),
  p99: percentile(99),
  overWindow: allGaps.filter((g) => g.seconds >= interval).length,
  sessionsOverWindow: sessions.filter((s) => s.overWindow > 0).length,
  live: liveRows.map(([worktree, pid, activity]) => ({
    worktree,
    branch: path.basename(worktree || ''),
    pid: Number.parseInt(pid, 10),
    activity,
  })),
};

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      { summary, longest: allGaps.slice(0, top), sessions: sessions.sort((a, b) => b.longestQuietSeconds - a.longestQuietSeconds) },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const out = [];
out.push('== plot-quiet-stretch ==');
out.push('');
out.push(`Monitor window        ${interval}s  (PLOT_MONITOR_INTERVAL)`);
out.push(`Population            ${summary.sessions} sessions across ${summary.worktreesScanned} worktrees${mergedOnly ? ' (merged only)' : ''}`);
out.push(`Quiet stretches       ${summary.gaps}`);
out.push('');
out.push(`Longest quiet         ${summary.longestQuietSeconds ?? 'n/a'}s`);
out.push(`p50 / p90 / p99       ${summary.p50 ?? 'n/a'}s / ${summary.p90 ?? 'n/a'}s / ${summary.p99 ?? 'n/a'}s`);
out.push(`Over the window       ${summary.overWindow} stretches, in ${summary.sessionsOverWindow} of ${summary.sessions} sessions`);
out.push('');

if (summary.live.length) {
  out.push('Live workers, CPU beside the transcript:');
  for (const l of summary.live) out.push(`  ${l.activity.padEnd(8)} pid ${l.pid}  ${l.branch}`);
  out.push('');
}

out.push(`Longest ${Math.min(top, allGaps.length)} stretches:`);
for (const g of allGaps.slice(0, top)) {
  out.push(`  ${g.seconds.toFixed(1).padStart(7)}s  ${g.from}->${g.to}  ${g.at}  ${g.branch}`);
}
out.push('');
out.push('Sessions by longest quiet:');
for (const s of sessions.sort((a, b) => b.longestQuietSeconds - a.longestQuietSeconds).slice(0, top)) {
  out.push(
    `  ${String(s.longestQuietSeconds).padStart(7)}s  ${String(s.overWindow).padStart(3)} over  ${s.branch}`,
  );
}

process.stdout.write(`${out.join('\n')}\n`);

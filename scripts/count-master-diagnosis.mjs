#!/usr/bin/env node
/**
 * How much master-session time went into loop diagnosis, inside one window.
 *
 * The flip from `the-worker-loop-runs-in-js` gates on a fleet measurement, not
 * on merge count, and the plan's open question — does the JS loop cost the
 * operator less diagnosis than the shell loop did? — needs a comparable
 * number from both windows. This is where that number comes from.
 *
 *   node scripts/count-master-diagnosis.mjs <sinceISO> <untilISO> [slices] [checkout]
 *
 * It is READ-ONLY: it opens transcript files and prints a report, and writes
 * nothing anywhere. `slices` is the count of slices delivered in the window,
 * supplied by the caller — this script has no way to derive "delivered" on
 * its own, and does not try to. `checkout` is the MAIN checkout's absolute
 * path, defaulting to `process.cwd()` — pass it explicitly when running from
 * a worktree, since a worktree's own transcript directory is a different,
 * near-empty one, not the main checkout's.
 *
 * SCOPE: interactive master sessions only (`entrypoint: "cli"`), in the MAIN
 * CHECKOUT's Claude Code project directory — never a worker's worktree, and
 * never a `sdk-cli` session, which is how Plot's own `claude -p` runs read.
 * An `sdk-cli` session counted here would charge the operator for the fleet's
 * own unattended work, which is not what "master diagnosis" means.
 *
 * THE PATTERN LIST IS FIXED BY THE BRIEF, not tuned per window — the same six
 * patterns apply whether the window ran on `shell` or on `js`, because the
 * comparison is only honest if both sides were asked the same question.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The patterns the brief fixes, tested against a Bash call's full command
 * text — a master session asking about the loop's own machinery.
 *
 * `\b(ps|pgrep|lsof)\b` is deliberately excluded here: the brief scopes it to
 * the call's COMMAND WORD, not the whole text, so it is tested separately by
 * {@link isProcessCommandWord}. Matching it against the full text would also
 * count a command that merely mentions "ps" in an argument or a path.
 */
export const DIAGNOSIS_PATTERNS = [
  /plot-worker-loop\.sh/,
  /plot-build-monitor\.sh/,
  /plot-worker-state\.sh/,
  /\.plot-worker\./,
  /git worktree list/,
];

/**
 * Where the runtime keeps a checkout's transcripts.
 *
 * Mirrors `transcriptDirFor` in `packages/domain/src/adapters/slice-spend/
 * slice-spend-file.ts` — the slug is the absolute path with `/` and `.` both
 * replaced by `-`. Duplicated rather than imported: this is a standalone
 * diagnostic script, like `measure-tick.mjs`, not a domain adapter, and it
 * never touches the domain's ports.
 *
 * @param checkout - the main checkout's absolute path.
 * @param home - the transcript home, standing in for `~`.
 * @returns the directory the runtime writes that checkout's sessions to.
 */
export const transcriptDirFor = (checkout, home) =>
  join(home, '.claude', 'projects', resolve(checkout).replace(/[/.]/g, '-'));

/** Whether a Bash tool call's command word is one of `ps`, `pgrep` or `lsof`. */
const isProcessCommandWord = (command) => {
  const word = command.trim().split(/\s+/)[0] ?? '';
  return /^(ps|pgrep|lsof)$/.test(word);
};

/** Whether one Bash call's command text counts, by the fixed pattern list. */
const matchesDiagnosis = (command) => {
  if (typeof command !== 'string' || command === '') return false;
  if (isProcessCommandWord(command)) return true;
  return DIAGNOSIS_PATTERNS.some((p) => p.test(command));
};

/**
 * Parses one transcript's lines into `{entrypoint, toolUses, toolResults}`.
 *
 * A line that fails to parse is skipped — a transcript is append-only and an
 * interrupted write can leave a trailing partial line; this script reports
 * what it could read, never refuses the whole file for one bad line.
 *
 * @param text - the transcript file's raw contents.
 * @returns `null` when the file carries no usable line at all.
 */
const parseSession = (text) => {
  let entrypoint = null;
  const toolUses = []; // { id, command }
  const resultChars = new Map(); // tool_use_id -> character count

  for (const line of text.split('\n')) {
    if (line === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (entrypoint === null && typeof parsed.entrypoint === 'string') {
      entrypoint = parsed.entrypoint;
    }
    const content = parsed?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string') {
        toolUses.push({ id: block.id, command: block.input.command });
      }
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
        resultChars.set(block.tool_use_id, text.length);
      }
    }
  }

  if (entrypoint === null && toolUses.length === 0) return null;
  return { entrypoint, toolUses, resultChars };
};

/**
 * Counts one session's matching Bash calls and their result size.
 *
 * @param text - the transcript file's raw contents.
 * @returns `{calls, chars}` for a `cli` session; `null` for anything else
 *   (parse failure, or an excluded `sdk-cli`/unlabelled session).
 */
export const countSession = (text) => {
  const session = parseSession(text);
  if (session === null) return null;
  if (session.entrypoint !== 'cli') return null;

  let calls = 0;
  let chars = 0;
  for (const use of session.toolUses) {
    if (!matchesDiagnosis(use.command)) continue;
    calls += 1;
    chars += session.resultChars.get(use.id) ?? 0;
  }
  return { calls, chars };
};

/**
 * Reports one window's master-diagnosis cost.
 *
 * `since`/`until` bound a session file by its last-modified time — the same
 * signal the operator's own daily baseline reading used, because a session
 * spanning midnight is rare and the brief asks for a comparable number, not
 * an exact one.
 *
 * @param transcriptDir - the main checkout's transcript directory.
 * @param since - window start, inclusive.
 * @param until - window end, exclusive.
 * @param slices - slices delivered in the window, supplied by the caller.
 * @returns the report; `measured: false` when the directory holds no master
 *   session in range — an EMPTY WINDOW IS UNMEASURED, never zero.
 */
export const countWindow = (transcriptDir, since, until, slices) => {
  let files;
  try {
    files = readdirSync(transcriptDir, { withFileTypes: true });
  } catch {
    return { measured: false, calls: 0, chars: 0, tokenEstimate: 0, sessions: 0, slices };
  }

  let calls = 0;
  let chars = 0;
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
    const counted = countSession(text);
    if (counted === null) continue;
    sessions += 1;
    calls += counted.calls;
    chars += counted.chars;
  }

  if (sessions === 0) return { measured: false, calls: 0, chars: 0, tokenEstimate: 0, sessions: 0, slices };
  return { measured: true, calls, chars, tokenEstimate: Math.round(chars / 4), sessions, slices };
};

const formatReport = (label, report) => {
  if (!report.measured) return `${label}: unmeasured (no master session found in this window)`;
  const perSlice = report.slices > 0 ? ` (${(report.calls / report.slices).toFixed(1)} calls/slice)` : '';
  return [
    `${label}:`,
    `  sessions: ${report.sessions}`,
    `  matching Bash calls: ${report.calls}${perSlice}`,
    `  result characters: ${report.chars}`,
    `  token estimate (chars / 4, ESTIMATE ONLY): ${report.tokenEstimate}`,
    `  slices delivered in window: ${report.slices}`,
  ].join('\n');
};

const main = () => {
  const [sinceArg, untilArg, slicesArg, checkoutArg] = process.argv.slice(2);
  if (!sinceArg || !untilArg) {
    console.error('usage: node scripts/count-master-diagnosis.mjs <sinceISO> <untilISO> [slices] [checkout]');
    process.exitCode = 2;
    return;
  }
  const since = new Date(sinceArg);
  const until = new Date(untilArg);
  const slices = Number(slicesArg ?? 0);
  const checkout = resolve(checkoutArg ?? process.cwd());
  const dir = transcriptDirFor(checkout, process.env.PLOT_TRANSCRIPT_HOME ?? homedir());
  const report = countWindow(dir, since, until, slices);
  console.log(formatReport(`${sinceArg} .. ${untilArg}`, report));
};

if (import.meta.url === `file://${process.argv[1]}`) main();

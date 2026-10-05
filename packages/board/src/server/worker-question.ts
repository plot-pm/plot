import fs from 'node:fs';
import path from 'node:path';
import type { FleetReading } from '../contract/schema.js';

/**
 * The prefix of the marker file a stopped-to-ask worker writes into its tree.
 *
 * THE MARKER IS A FILE, matching `plot-worker-state.sh`'s `plot_worker_blocked`
 * exactly: that function decides `waiting` by finding a `PLOT-BLOCKED*` file at
 * the worktree root, and this module reads the same file to say what it asks.
 *
 * NO SHARED PATTERN CONSTANT ANY MORE, which is the point of this change. The
 * module used to carry a SECOND copy of the scan's marker regex and re-grep the
 * worktree for it — its own docstring called the duplication "the honest cost".
 * The cost was worse than duplication: grepping a pristine worktree matched the
 * marker token where a brief or CLAUDE.md merely documented it, so the board
 * surfaced a documentation example as a worker's question. A filename cannot be
 * documented into existence, so there is nothing left to keep in sync: both this
 * module and the scan look for the same file, by name, at the same place.
 */
const MARKER_PREFIX = 'PLOT-BLOCKED';

/**
 * How much of a marker line to carry into a row's note.
 *
 * A note is one line on a board row beside a branch name, so the budget is what
 * fits there rather than what a worker wrote. Workers write questions of every
 * length — the `Worker command` in this repo's own CLAUDE.md asks for
 * `PLOT-BLOCKED:` followed by a question, and an agent weighing three options
 * writes a paragraph.
 *
 * TRUNCATED WITH AN ELLIPSIS RATHER THAN DROPPED. A clipped question still
 * names its subject, which is the whole job of the note: the reader's next move
 * is to open the tree and read the rest, and a note that says *waiting on an
 * answer* without a subject does not get them there any faster than no note.
 */
export const QUESTION_MAX = 120;

/**
 * The first marker line in a worktree, trimmed and bounded — or "" when none
 * could be read.
 *
 * **"" IS A STATED UNKNOWN, NOT AN ABSENCE OF ONE.** This function is only ever
 * asked about a worker the scan has already called `waiting`, so the marker file
 * was there when the scan looked. "" therefore means *the scan saw one and this
 * read did not* — a race with the answering worker deleting it, a permission, a
 * worktree that has since gone — and the caller renders it as *reason
 * unavailable*. It must never be rendered as *not waiting*: the state is the
 * scan's to decide and this text only ever annotates it.
 *
 * A FILE READ, NOT A `git grep`. The marker is a `PLOT-BLOCKED*` file at the
 * worktree root — the same thing `plot_worker_blocked` looks for — so this reads
 * that file and takes its first line. The subprocess this replaced existed only
 * to search file CONTENTS, and searching contents is the defect: it matched the
 * marker token where a doc or brief merely mentioned it, and surfaced that
 * mention as a worker's question. A file read cannot make that mistake, because
 * a document is not a `PLOT-BLOCKED*` file.
 *
 * `.plot-worker.log` IS EXCLUDED FOR FREE now, where the grep had to name it.
 * The log is the one file guaranteed to contain the marker token whenever the
 * worker reported writing one, so the old contents search excluded it by name to
 * keep the log-versus-tree distinction the `waiting` state is built on. A prefix
 * match on `PLOT-BLOCKED*` never sees `.plot-worker.log` at all — the exclusion
 * is now a property of the name, not a flag that could be forgotten.
 *
 * STILL `Promise<string>` though the read is synchronous, because `continue.ts`
 * and {@link workerQuestions} both `await` it. The work is cheap and the return
 * shape is the caller's contract, so it resolves the read rather than blocking.
 * Any failure — no marker file, unreadable, a worktree that has gone — resolves
 * "", the stated unknown, exactly as the killed search did.
 */
export function markerIn(worktree: string): Promise<string> {
  return Promise.resolve(readMarkerFile(worktree));
}

/**
 * The contents of the first `PLOT-BLOCKED*` file at the worktree root, passed
 * through {@link firstMarkerLine} — or "" when none reads.
 *
 * ROOT ONLY, mirroring `plot_worker_blocked`: every observed marker sits at the
 * root, and matching at depth would re-admit the looseness this change removes.
 * The directory is listed and the first entry whose name starts with the prefix
 * is read; a `readdir` that throws (no such worktree) is the stated unknown.
 */
function readMarkerFile(worktree: string): string {
  let names: string[];
  try {
    names = fs.readdirSync(worktree);
  } catch {
    return '';
  }
  for (const name of names) {
    if (!name.startsWith(MARKER_PREFIX)) continue;
    try {
      const full = path.join(worktree, name);
      if (!fs.statSync(full).isFile()) continue;
      return firstMarkerLine(fs.readFileSync(full, 'utf8'));
    } catch {
      // A name that matched the prefix but would not read is the stated
      // unknown, not a reason to look past it: the scan already found a marker
      // here, and a second matching entry is not the one it saw.
      return '';
    }
  }
  return '';
}

/**
 * What a desk's `PLOT-BLOCKED*` marker asks, and when it was written — or
 * `null` where no marker file exists.
 *
 * ONE `stat`, SO THE LINE AND THE AGE DESCRIBE THE SAME FILE. `markerIn` reads
 * the marker's first line without ever asking when it was written; a caller
 * that wanted both by calling `markerIn` and a second `stat` in sequence could
 * have the worker replace the file between the two reads, pairing one
 * marker's words with another marker's timestamp. Reading `mtimeMs` from the
 * same `statSync` this function already uses to find the file closes that gap.
 *
 * `null` MEANS NO MARKER, AND ONLY THAT. A found-but-unreadable marker is
 * `{ firstLine: '', askedAt }` — the stated unknown `markerIn` already
 * returns for its line, paired with the age the directory listing and the
 * `stat` still established. `null` is reserved for the one case neither can
 * discover anything from: no `PLOT-BLOCKED*` entry at the root, or a worktree
 * that has gone.
 */
export function markerReading(worktree: string): Promise<{ firstLine: string; askedAt: string } | null> {
  return Promise.resolve(readMarkerReading(worktree));
}

function readMarkerReading(worktree: string): { firstLine: string; askedAt: string } | null {
  let names: string[];
  try {
    names = fs.readdirSync(worktree);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.startsWith(MARKER_PREFIX)) continue;
    const full = path.join(worktree, name);
    // THE NAME MATCHING THE PREFIX IS WHAT "FOUND A MARKER" MEANS, not the
    // `stat` that follows it — so every failure past this point is the stated
    // unknown `{ firstLine: '', askedAt }`, never `null`. `null` is reserved
    // for "no entry at the root starts with the prefix at all".
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      // The name was listed and then vanished, or turned unreadable, between
      // the `readdir` and this `stat` — the scan still found it.
      return { firstLine: '', askedAt: new Date().toISOString() };
    }
    const askedAt = new Date(stat.mtimeMs).toISOString();
    if (!stat.isFile()) {
      // A directory named like a marker (`PLOT-BLOCKED.d/`) is found but has no
      // line to read — the stated unknown, with the age this `stat` already
      // established rather than the read-time fallback above.
      return { firstLine: '', askedAt };
    }
    try {
      return { firstLine: firstMarkerLine(fs.readFileSync(full, 'utf8')), askedAt };
    } catch {
      // The name matched and the `stat` succeeded, so the age is real even
      // though the content read failed between the two calls — a permission
      // change, a delete racing this read. The stated unknown for the line,
      // paired with the age that was actually observed.
      return { firstLine: '', askedAt };
    }
  }
  return null;
}

/**
 * The first non-empty line of grep output, trimmed and bounded to
 * {@link QUESTION_MAX}.
 *
 * Split out and exported because it is the whole of the formatting judgement,
 * and {@link markerIn} wraps it in a filesystem read — testing the judgement
 * directly is cleaner than staging a marker file for every formatting case.
 *
 * LEADING COMMENT SYNTAX IS STRIPPED. A marker written into a source file
 * arrives as `// PLOT-BLOCKED: which adapter?` or `# PLOT-BLOCKED: ...`, and
 * the punctuation is an artefact of where the worker put it rather than part of
 * what it asked. The TRAILING side is left alone: a block-comment terminator at
 * the end of such a line is rare beside a question, and stripping from both
 * ends invites eating the question mark — which is the one character that makes
 * the note read as a question at all.
 */
export function firstMarkerLine(out: string, max = QUESTION_MAX): string {
  const line = out.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (!line) return '';
  const bare = line.replace(/^(?:\/\/+|#+|\*+|--|<!--)\s*/, '').trim();
  if (!bare) return '';
  return bare.length > max ? `${bare.slice(0, max - 1).trimEnd()}…` : bare;
}

/**
 * Every branch this machine holds a worktree for, paired with its path.
 *
 * NO LONGER GATED ON `worker === 'waiting'`. That condition is the defect
 * `a-question-is-listed-as-waiting-on-you` removes: a worker that has stopped
 * to ask is `waiting`, but a worker that wrote its marker and kept its loop
 * alive beside it — still polling, still `running` — carries the same marker
 * file and was invisible to this search. The marker is the reading; the
 * worker's process state is not a precondition for it existing. See
 * `rules/supervision.ts`'s `supervise`, which made the matching mistake in the
 * other direction and answered `leave` for a live loop before it read anything
 * else.
 *
 * `local_worktree` ALONE is the gate now, for the reason it always was: an
 * empty one is a branch held on ANOTHER machine, where the scan there reads
 * its own marker and this one has nowhere to look. Looking anyway is how a
 * path gets guessed.
 */
export function waitingWorktrees(pulse: FleetReading): Map<string, string> {
  const found = new Map<string, string>();
  for (const plan of pulse.plans) {
    for (const wave of plan.slices) {
      for (const b of wave.branches) {
        if (b.local_worktree) found.set(b.branch, b.local_worktree);
      }
    }
  }
  return found;
}

/**
 * What each desk's marker asks, and when it was written — branch → reading.
 *
 * Run once per scan rather than once per render, and that placement is the
 * point. `classify` is a pure function called for every branch on every poll;
 * putting a subprocess inside it would make the board's sort-and-render path
 * spawn git synchronously, N times, five seconds apart. The scan's own timer is
 * where a filesystem question about this machine belongs — it is already the
 * clock every other local fact on the row was read on.
 *
 * IN PARALLEL, because the searches are independent and the fleet is small.
 *
 * A BRANCH WITH NO ENTRY MEANS NO MARKER FILE — the honest `null`
 * {@link markerReading} returns, and the caller renders no question at all.
 * A found-but-unreadable marker still gets an entry, `{ firstLine: '',
 * askedAt }`: the scan found the file, so the row stays in WAITING ON YOU with
 * "reason unavailable" rather than reading as though nothing were asked.
 */
export async function workerQuestions(
  pulse: FleetReading,
): Promise<Map<string, { firstLine: string; askedAt: string }>> {
  const targets = [...waitingWorktrees(pulse)];
  if (targets.length === 0) return new Map();
  const found = await Promise.all(targets.map(([, wt]) => markerReading(wt)));
  const questions = new Map<string, { firstLine: string; askedAt: string }>();
  targets.forEach(([branch], i) => {
    const reading = found[i];
    if (reading) questions.set(branch, reading);
  });
  return questions;
}

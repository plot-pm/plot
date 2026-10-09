import fs from 'node:fs';
import path from 'node:path';
import type { FleetReading } from '@plot-pm/domain';

/** What a desk's marker asks and when it was written: the first line and an ISO-8601 modification time. */
export interface MarkerReading {
  firstLine: string;
  askedAt: string;
}

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
  return Promise.resolve(readMarkerReading(worktree)?.firstLine ?? '');
}

/**
 * The marker at the worktree root and the time it was written — `null` where no
 * marker exists. Reads the line and the modification time from one `stat`.
 *
 * Only the root is listed. Entries whose name starts with the marker prefix are
 * considered in listing order: the first regular file is read; if every match is
 * a directory, the first directory gives `{ firstLine: '', askedAt }`. A matched
 * file whose content does not read gives `{ firstLine: '', askedAt }`. A matched
 * name whose `stat` fails (deleted after the listing) is skipped, and a `readdir`
 * that throws gives `null`.
 *
 * @param worktree Path of the worktree root.
 */
const readMarkerReading = (worktree: string): MarkerReading | null => {
  let names: string[];
  try {
    names = fs.readdirSync(worktree);
  } catch {
    return null;
  }
  let directory: MarkerReading | null = null;
  for (const name of names) {
    if (!name.startsWith(MARKER_PREFIX)) continue;
    const full = path.join(worktree, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const askedAt = new Date(stat.mtimeMs).toISOString();
    if (!stat.isFile()) {
      directory ??= { firstLine: '', askedAt };
      continue;
    }
    try {
      return { firstLine: firstMarkerLine(fs.readFileSync(full, 'utf8')), askedAt };
    } catch {
      return { firstLine: '', askedAt };
    }
  }
  return directory;
};

/**
 * What a worktree's `PLOT-BLOCKED*` marker asks and when it was written, or
 * `null` where there is no marker. `firstLine` is "" when the content did not
 * read; `askedAt` is the file's modification time as an ISO-8601 string.
 *
 * @param worktree Path of the worktree root.
 */
export const markerReading = (worktree: string): Promise<MarkerReading | null> =>
  Promise.resolve(readMarkerReading(worktree));

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
 * Every branch the pulse reports with a local worktree, paired with the
 * worktree path. A branch with an empty `local_worktree` is held on another
 * machine and is not listed.
 *
 * @param pulse The fleet reading.
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
 * What each desk's marker asks and when it was written — branch → reading, for
 * every branch with a local worktree that holds a marker. A branch with no
 * marker has no entry. A fleet with no local worktree reads nothing.
 *
 * Run once per scan; `classify` receives the result and reads no file.
 *
 * @param pulse The fleet reading.
 */
export const workerQuestions = async (pulse: FleetReading): Promise<Map<string, MarkerReading>> => {
  const targets = [...waitingWorktrees(pulse)];
  if (targets.length === 0) return new Map();
  const found = await Promise.all(targets.map(([, wt]) => markerReading(wt)));
  const questions = new Map<string, MarkerReading>();
  targets.forEach(([branch], i) => {
    const reading = found[i];
    if (reading) questions.set(branch, reading);
  });
  return questions;
};

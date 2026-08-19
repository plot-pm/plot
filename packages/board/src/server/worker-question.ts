import { execFile } from 'node:child_process';
import type { FleetPulse } from '../contract/schema.js';

/**
 * The markers a stopped-to-ask worker leaves in its tree, as an ERE — the same
 * set `plot-worker-state.sh` greps for (`PLOT_BLOCKED_MARKER`), and it must stay
 * the same set.
 *
 * A SECOND COPY OF A PATTERN, and that is the honest cost of this change rather
 * than an oversight. The scan answers *is this worker waiting*; this module
 * answers *what is it waiting on*, and the two run on opposite sides of a JSON
 * boundary that carries the verdict and not the text. The alternative — teaching
 * the scan to emit the marker line as a field — is the better shape and is
 * exactly what this branch was told not to build (`plot-worker-state.sh` and
 * `plot-fleet-scan.sh` are out of scope). So the duplication is deliberate,
 * named, and bounded to one constant.
 *
 * WHAT DRIFT COSTS HERE IS A SENTENCE, NEVER A SECTION. This pattern never
 * decides `waiting` — the scan already did that, and this module is only asked
 * about branches the scan has ALREADY called `waiting`. A marker spelling that
 * the scan recognises and this does not degrades the row to *waiting, reason
 * unavailable*, which is the stated-unknown this module exists to produce
 * anyway. The row stays in WORKING either way. That asymmetry is why the copy
 * is tolerable: the authoritative pattern is still the scan's, and this one can
 * only ever say less.
 */
export const BLOCKED_MARKER = 'PLOT-BLOCKED:|TODO\\((you|human)\\)';

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
 * How long to let the marker search run, per worktree.
 *
 * Short, and bounded on purpose: this rides the 5 s scan timer, and a worktree
 * on a slow or unmounted volume must not hold the refresh open. A timeout is an
 * unreadable marker, which is a case this module already has an honest answer
 * for — see {@link questionFor}.
 */
const GREP_TIMEOUT_MS = 5_000;

/**
 * The first marker line in a worktree, trimmed and bounded — or "" when none
 * could be read.
 *
 * **"" IS A STATED UNKNOWN, NOT AN ABSENCE OF ONE.** This function is only ever
 * asked about a worker the scan has already called `waiting`, so the marker was
 * there when the scan looked. "" therefore means *the scan saw one and this
 * read did not* — a race with the answering human, a permission, a worktree
 * that has since gone — and the caller renders it as *reason unavailable*. It
 * must never be rendered as *not waiting*: the state is the scan's to decide and
 * this text only ever annotates it.
 *
 * `git grep` OVER THE TRACKED TREE PLUS UNTRACKED FILES, never `grep -r`, and
 * the reason is the same one `plot-worker-state.sh` records: a worktree holds
 * `node_modules` and build output, and a recursive grep would walk all of it —
 * every five seconds, once per waiting branch. `--untracked` is included
 * because a marker a worker just wrote and has not committed is the live case,
 * and `--exclude-standard` keeps ignored build output out.
 *
 * PLOT'S OWN RECORDS ARE EXCLUDED BY NAME, mirroring the scan exactly.
 * `.plot-worker.log` is guaranteed to contain the marker whenever the worker
 * reported writing one, so a hit there is the report of a question rather than
 * the question — the log-versus-tree distinction the whole `waiting` state is
 * built on. Excluding it by name rather than trusting `.gitignore` is the bug
 * CI caught in the scan: this repo ignores those files, a fixture repo did not,
 * and the difference was silent.
 *
 * `-I` skips binary files: a marker-shaped byte sequence inside a `.png` is a
 * coincidence, not a question. `-m1` per file and `-h` for no filename prefix —
 * the note wants the question, and the file it lives in is a second errand the
 * panel serves better.
 *
 * EVERY OPTION BEFORE THE PATTERN, and this is not style. `git grep -IE <pat>
 * --untracked` parses `--untracked` as a REVISION and dies "unable to resolve
 * revision" — exit 128, no match, silently. Measured in the scan twice, from
 * two causes; the ordering here is the same defence.
 */
export function markerIn(worktree: string, timeoutMs = GREP_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      [
        '-C', worktree, 'grep', '-hIEm1', '--untracked', '--exclude-standard',
        BLOCKED_MARKER, '--', '.', ':(exclude).plot-worker.*',
      ],
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 20 },
      (err, stdout) => {
        // EVERY FAILURE IS "". `git grep` exits 1 for no match and 128 for a
        // worktree that has gone; a timeout kills it with no output. All three
        // are the same answer to the caller — the marker could not be read —
        // and none of them may be allowed to reject, because this runs inside a
        // scan refresh whose other work must not be lost to it.
        if (err && !stdout) return resolve('');
        resolve(firstMarkerLine(stdout));
      },
    );
  });
}

/**
 * The first non-empty line of grep output, trimmed and bounded to
 * {@link QUESTION_MAX}.
 *
 * Split out and exported because it is the whole of the formatting judgement
 * and the rest of {@link markerIn} is a subprocess — a judgement reachable only
 * through `execFile` is one the suite cannot exercise directly.
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
 * Every branch the pulse reports as `waiting` that this machine has a worktree
 * for, paired with its worktree path.
 *
 * BOTH CONDITIONS, and each drops a different population. `worker !== 'waiting'`
 * is every branch this module has nothing to say about — the search is skipped
 * rather than run and discarded, which is what keeps the cost proportional to
 * the number of waiting agents rather than to the size of the fleet. An empty
 * `local_worktree` is a branch waiting on ANOTHER machine: the scan there read
 * its marker, this one has nowhere to look, and looking anyway is how a path
 * gets guessed.
 */
export function waitingWorktrees(pulse: FleetPulse): Map<string, string> {
  const found = new Map<string, string>();
  for (const plan of pulse.plans) {
    for (const wave of plan.waves) {
      for (const b of wave.branches) {
        if (b.worker === 'waiting' && b.local_worktree) found.set(b.branch, b.local_worktree);
      }
    }
  }
  return found;
}

/**
 * What each waiting worker in the pulse is waiting on — branch → marker line.
 *
 * Run once per scan rather than once per render, and that placement is the
 * point. `classify` is a pure function called for every branch on every poll;
 * putting a subprocess inside it would make the board's sort-and-render path
 * spawn git synchronously, N times, five seconds apart. The scan's own timer is
 * where a filesystem question about this machine belongs — it is already the
 * clock every other local fact on the row was read on.
 *
 * IN PARALLEL, because the searches are independent and the fleet is small: a
 * dispatch runs a handful of workers and only the waiting ones are asked at all.
 *
 * A BRANCH WITH NO ENTRY AND A BRANCH WITH "" MEAN THE SAME THING to the caller
 * — *waiting, reason unavailable* — and that is deliberate rather than sloppy.
 * The two arise differently (no worktree here, versus a worktree whose marker
 * would not read) but the row's sentence is identical, because the reader's move
 * is: go look in the tree. Splitting them would put two spellings of one errand
 * on the board. The panel, which can afford more words, is where that
 * distinction earns its keep.
 */
export async function workerQuestions(pulse: FleetPulse): Promise<Map<string, string>> {
  const targets = [...waitingWorktrees(pulse)];
  if (targets.length === 0) return new Map();
  const found = await Promise.all(targets.map(([, wt]) => markerIn(wt)));
  const questions = new Map<string, string>();
  targets.forEach(([branch], i) => {
    const q = found[i];
    if (q) questions.set(branch, q);
  });
  return questions;
}

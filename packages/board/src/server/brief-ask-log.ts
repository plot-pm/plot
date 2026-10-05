/**
 * When a branch's brief was ASKED for — read from the log the asker leaves.
 *
 * A leaf module beside {@link ./brief-path.js} and for its reason: three callers
 * would otherwise each carry the path convention, and a fourth spelling of where
 * the log lives is how a reading goes blind to half the asks.
 *
 * **THE READING IS AN AGE AND NEVER A VERDICT.** It answers *when was the ask
 * made* and stops. Whether a writer is still running is a question this
 * deliberately does not ask, and the plan that specified it did so because its
 * own author got it wrong: drafting it, he checked
 * `.plot/brief-a-marker-names-its-writer.log` at 25 and at 40 seconds, found 0
 * bytes with no visible process, and concluded the writer had died. It had not.
 * The log reached 2553 bytes and the brief landed on `origin/main`.
 *
 * So an EMPTY log is an ask like any other. A brief writer takes minutes and
 * writes nothing until it is done, which makes size evidence of nothing at all —
 * the mtime is the fact, and it is the only one read here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { implementLogPath, implementRunState } from './implement.js';
import { askForBriefLogPath } from './brief-ask.js';

/**
 * Where `plot-dispatch.sh` writes a branch's ask — a shell string a test
 * cannot import, so this constant is what a test PINS against the script's own
 * line (`skills/plot/scripts/plot-dispatch.sh:805`) rather than trusting the
 * two to agree by inspection.
 *
 * Keyed on the BRANCH slug, unlike the other two askers below, which are keyed
 * on the PLAN slug. The three callers below pass the same slug for both,
 * because on this estate a slice's branch is named for its plan — see
 * `briefReading`'s own docstring for where that stops being construction and
 * becomes convention.
 */
export const DISPATCH_SCRIPT_ASK_LOG = (slug: string): string => path.join('.plot', `brief-${slug}.log`);

/**
 * The three places an ask leaves its log, one per asker.
 *
 *   `plot-dispatch.sh`     `.plot/brief-<branch-slug>.log`              keyed on the BRANCH
 *   `brief-ask.ts`         `.plot-brief-<plan-slug>.log`                keyed on the PLAN
 *   `implement.ts`         `.worktrees/plot-implement-<plan-slug>.log`  keyed on the PLAN
 *
 * The implement route is the asker when the dispatch controller writes a
 * slice's brief with `--brief-only`. Each path comes from the function that
 * writes it — `DISPATCH_SCRIPT_ASK_LOG`, `askForBriefLogPath`,
 * `implementLogPath` — never from a copied string. The branch and plan slugs
 * coincide only by naming convention; the directories always differ.
 *
 * @param repoRoot - absolute path to the repository root, which
 *                   `implementLogPath` needs to compute its path.
 * @param branchSlug - the branch's last path segment.
 * @param planSlug - the plan's slug (its filename without the date prefix and
 *                   `.md`), which the board asker and the implement route are
 *                   keyed on.
 * @returns Repository-relative paths, in the order of the table above.
 */
export const briefAskLogPaths = (repoRoot: string, branchSlug: string, planSlug: string): string[] => [
  DISPATCH_SCRIPT_ASK_LOG(branchSlug),
  path.relative(repoRoot, askForBriefLogPath(repoRoot, planSlug)),
  path.relative(repoRoot, implementLogPath(repoRoot, planSlug)),
];

/** A file's mtime in epoch milliseconds, or null where it cannot be stat'd. */
const mtimeOf = (file: string): number | null => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** What one branch's brief asks say, from one reading of the askers' logs. */
export interface BriefReading {
  /** Epoch milliseconds of the earliest ask that counts, or null. */
  askedAt: number | null;
  /** The implement log's repository-relative path where its run failed and no other asker's log is newer, or null. */
  failed: string | null;
}

/**
 * When this branch's brief was asked for, and whether the implement route's
 * writer failed — one reading per row.
 *
 * The dispatch script's log and the board asker's log count as asks whenever
 * they exist; their mtimes are read, never their size, so an empty log is an
 * ask. The implement route's log counts as an ask while its run is unfinished
 * (a log and no state file), and while it is failed (a non-zero state) and no
 * other asker's log is newer than the state file. A run that recorded `0` is
 * no ask: the log is keyed per PLAN and outlives its run, while a brief is per
 * BRANCH. Because that log is keyed per plan, a run writing one slice's brief
 * also makes every brief-less sibling slice of the same plan read as asked, or
 * as failed.
 *
 * `failed` is read from the recorded exit through `implementRunState`; no
 * process is probed and the log's content is not read. The reading is per
 * machine: an ask made on another machine leaves no log here.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @param planSlug - the plan's slug, which the board asker and the implement
 *                   route are keyed on. See `briefAskLogPaths`.
 * @returns `askedAt` — the earliest counting ask, or null where none counts or
 *          none could be stat'd; `failed` — the implement log's path where the
 *          failure condition above holds, otherwise null.
 */
export const briefReading = (repoRoot: string, branch: string, planSlug: string): BriefReading => {
  const branchSlug = branch.split('/').pop() ?? branch;
  const [dispatchLog, boardLog] = briefAskLogPaths(repoRoot, branchSlug, planSlug);
  const others = [dispatchLog, boardLog]
    .map((rel) => mtimeOf(path.join(repoRoot, rel)))
    .filter((at): at is number => at !== null);
  const run = implementRunState(repoRoot, planSlug);
  let implementAt: number | null = null;
  let failed: string | null = null;
  if (run.state === 'running') {
    implementAt = mtimeOf(run.log);
  } else if (run.state === 'failed') {
    const recordedAt = mtimeOf(run.statePath);
    if (recordedAt !== null && !others.some((at) => at > recordedAt)) {
      implementAt = mtimeOf(run.log);
      failed = path.relative(repoRoot, run.log);
    }
  }
  const times = implementAt === null ? others : [...others, implementAt];
  return { askedAt: times.length === 0 ? null : Math.min(...times), failed };
};

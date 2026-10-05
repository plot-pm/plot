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
import { implementLogPath, implementStatePath, implementStatus } from './implement.js';
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
 * `briefAskedAt`'s own docstring for where that stops being construction and
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

/**
 * The asks this branch's brief has, as one epoch-millisecond time per asker
 * whose log counts.
 *
 * The dispatch script's log and the board asker's log count whenever they
 * exist. The implement route's log counts only while its run is unfinished
 * (`implementStatus` reads `running`) or failed (`failed`): that log is keyed
 * per PLAN and outlives its run, while a brief is per BRANCH, so a run that
 * recorded `0` wrote some branch's brief and is not an ask for a branch whose
 * brief is still missing.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @param planSlug - the plan's slug the implement route is keyed on.
 * @returns `others` — the mtimes of the dispatch script's and the board
 *          asker's logs that exist; `implement` — the implement log's mtime
 *          where it counts, otherwise null.
 */
const briefAsks = (
  repoRoot: string,
  branch: string,
  planSlug: string,
): { others: number[]; implement: number | null } => {
  const branchSlug = branch.split('/').pop() ?? branch;
  const [dispatchLog, boardLog] = briefAskLogPaths(repoRoot, branchSlug, planSlug);
  const others = [dispatchLog, boardLog]
    .map((rel) => mtimeOf(path.join(repoRoot, rel)))
    .filter((at): at is number => at !== null);
  const { state, log } = implementStatus({ repoRoot, scriptsDir: '' }, planSlug);
  const implement = state === 'running' || state === 'failed' ? mtimeOf(log) : null;
  return { others, implement };
};

/**
 * When this branch's brief was asked for, as epoch milliseconds — or null.
 *
 * Reads the mtime of each asker's log and reports the earliest. The implement
 * route's log counts only while its run is unfinished or failed — see
 * `briefAsks`. The mtime is read, never the size: an empty log is an ask.
 *
 * The reading is per machine: an ask made on another machine leaves no log
 * here and reads as null.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @param planSlug - the plan's slug, which the board asker and the implement
 *                   route are keyed on. See `briefAskLogPaths`.
 * @returns Epoch milliseconds of the earliest ask, or null where no log counts
 *          or none could be stat'd.
 */
export const briefAskedAt = (repoRoot: string, branch: string, planSlug: string): number | null => {
  const { others, implement } = briefAsks(repoRoot, branch, planSlug);
  const times = implement === null ? others : [...others, implement];
  return times.length === 0 ? null : Math.min(...times);
};

/**
 * The implement log's path, where the implement route recorded a non-zero exit
 * and no other asker's log is newer than that record — or null.
 *
 * Reads the recorded exit through `implementStatus` and the state file's mtime;
 * it never probes a process. The comparison runs against the LATEST log of the
 * dispatch script and the board asker: a newer log from either means another
 * writer was asked after the failure, so the failure is not reported.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @param planSlug - the plan's slug the implement route is keyed on.
 * @returns the implement log's repository-relative path, or null while the run
 *          is unfinished, after it recorded `0`, with no run at all, when the
 *          state file cannot be stat'd, or when another asker's log is newer.
 */
export const briefFailed = (repoRoot: string, branch: string, planSlug: string): string | null => {
  const { state, log } = implementStatus({ repoRoot, scriptsDir: '' }, planSlug);
  if (state !== 'failed') return null;
  const recordedAt = mtimeOf(implementStatePath(repoRoot, planSlug));
  if (recordedAt === null) return null;
  const { others } = briefAsks(repoRoot, branch, planSlug);
  if (others.some((at) => at > recordedAt)) return null;
  return path.relative(repoRoot, log);
};

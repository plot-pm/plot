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
import { implementLogPath, implementStatePath } from './implement.js';
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
 * The three places an ask leaves its log, because there are three askers.
 *
 * **MEASURED 2026-09-13 AND AGAIN 2026-10-04, and the plan did not anticipate
 * either.** The plan named one path — `.plot/brief-<slug>.log`, which is
 * `plot-dispatch.sh`'s — and that is the population the operator first
 * measured. The board's own asker writes somewhere else entirely:
 * `brief-ask.ts`'s `askForBrief` puts `.plot-brief-<slug>.log` at the
 * repository root. Since `aa1f36296` ("a dispatch names the act it started",
 * 2026-09-29) a THIRD asker exists: the dispatch controller writes a slice's
 * brief through the implement route with `--brief-only`, which logs through
 * `implementLogPath` to `.worktrees/plot-implement-<plan-slug>.log`. A list that
 * named only the first two went blind to every brief a dispatch asked for since
 * that date — the defect this file now closes.
 *
 * Each path comes from the function that WRITES it, not from a copied string:
 * `implementLogPath` from `implement.ts`, `askForBriefLogPath` from
 * `brief-ask.ts`, and `DISPATCH_SCRIPT_ASK_LOG` declared beside this function —
 * a shell string a test cannot import. A fourth spelling of where a log lives
 * is how a reading goes blind to the next ask.
 *
 *   `plot-dispatch.sh`     `.plot/brief-<branch-slug>.log`       keyed on the BRANCH
 *   `brief-ask.ts`         `.plot-brief-<plan-slug>.log`         keyed on the PLAN
 *   `implement.ts`         `.worktrees/plot-implement-<plan-slug>.log`  keyed on the PLAN
 *
 * On this estate the branch and plan slugs usually coincide, because a slice's
 * branch is named for its plan's slug. They are not the same key by
 * construction, and the DIRECTORY differs unconditionally between all three.
 *
 * Reading only a subset would leave some brief the board asked for invisible —
 * which inverts the plan's own closing sentence, *"the board now asks for
 * briefs by itself, so the state this renders is the state it creates."* All
 * three are read, and the EARLIEST is reported: the ask is when somebody first
 * asked, and a second asker arriving later did not restart the wait the reader
 * is judging.
 *
 * @param repoRoot - absolute path to the repository root, which
 *                   `implementLogPath` needs to compute its path.
 * @param branchSlug - the branch's last path segment.
 * @param planSlug - the plan's slug (its filename without the date prefix and
 *                   `.md`), which is what the implement route is keyed on.
 * @returns Repository-relative paths, in no significant order.
 */
export const briefAskLogPaths = (repoRoot: string, branchSlug: string, planSlug: string): string[] => [
  DISPATCH_SCRIPT_ASK_LOG(branchSlug),
  path.relative(repoRoot, askForBriefLogPath(repoRoot, planSlug)),
  path.relative(repoRoot, implementLogPath(repoRoot, planSlug)),
];

/**
 * When this branch's brief was asked for, as epoch milliseconds — or null.
 *
 * **NULL IS *NOBODY ASKED HERE*, AND IT IS ALSO *I COULD NOT LOOK*.** The two
 * collapse on purpose, and that is the one place this differs from
 * `briefState`'s three-valued answer. There, the third state earns its keep
 * because `missing` is a CLAIM that sends a person to write a file. Here the
 * negative asserts nothing and offers nothing: the row falls back to the
 * sentence it has said all along, which is what this machine can truthfully say
 * either way.
 *
 * **PER-MACHINE, AND THAT IS HONEST.** A brief asked for on another machine
 * leaves no log here, so the row says *nobody has asked* — true of this machine,
 * and the only alternative would be inferring an ask from its absence.
 *
 * The mtime rather than the birthtime: the asker opens the log with `'a'` and
 * writes into it as the session talks, so mtime moves while a writer works.
 * Both answer the reader's question *when was this asked* to within the width of
 * the label, and mtime is the one every filesystem here reports.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch name, with or without its prefix.
 * @param planSlug - the plan's slug, beside the branch slug: the implement
 *                   route is keyed on the PLAN, and the two agree only by
 *                   naming convention. See `briefAskLogPaths`.
 * @returns Epoch milliseconds of the earliest ask, or null where none was found.
 */
export const briefAskedAt = (repoRoot: string, branch: string, planSlug: string): number | null => {
  const branchSlug = branch.split('/').pop() ?? branch;
  let earliest: number | null = null;
  for (const rel of briefAskLogPaths(repoRoot, branchSlug, planSlug)) {
    try {
      // `statSync` rather than `existsSync` + `stat`: one call, and the throw is
      // the absence. A log that exists and will not be stat'd lands in the same
      // catch as one that is not there, which is the collapse the docstring
      // above licenses — neither answer makes a claim.
      const at = fs.statSync(path.join(repoRoot, rel)).mtimeMs;
      if (earliest === null || at < earliest) earliest = at;
    } catch {
      // No log at this path. Not a statement about the other one.
    }
  }
  return earliest;
};

/**
 * The implement log's path, where its run recorded a non-zero exit AFTER this
 * row's brief was asked for — or null.
 *
 * **READ FROM THE RECORDED EXIT, NEVER FROM A PROCESS.** `#905` decided against
 * judging liveness — see this file's own header — and a failure reading is the
 * same decision made the other way: an exit code `implementStatePath` holds is
 * a recorded fact, not a guess from whether something is still running. No
 * liveness probe, no size check, no timeout.
 *
 * **NULL FOR AN OLD FAILURE.** A run that failed BEFORE this ask — an earlier
 * attempt at the same plan slug, since the implement log is per PLAN and
 * outlives any one run — must not be read as today's writer failing. The
 * state file's mtime is compared against `askedAt`: a recorded exit that is
 * older than the ask it would explain is not this ask's answer.
 *
 * **A `done` RUN IS NOT A FAILURE**, which `implementStatePath`'s own content
 * already says (`'0'`), so no extra branch is needed for it here.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param planSlug - the plan's slug the implement route is keyed on.
 * @param askedAt - this row's `briefAskedAt`, or null where nothing asked.
 * @returns the implement log's repository-relative path, or null.
 */
export const briefFailed = (repoRoot: string, planSlug: string, askedAt: number | null): string | null => {
  if (askedAt === null) return null;
  const statePath = implementStatePath(repoRoot, planSlug);
  let recorded: string;
  let recordedAt: number;
  try {
    const stat = fs.statSync(statePath);
    recorded = fs.readFileSync(statePath, 'utf8').trim();
    recordedAt = stat.mtimeMs;
  } catch {
    return null; // no recorded exit — running, or never started
  }
  if (recorded === '' || recorded === '0') return null; // done, or unreadable content
  if (recordedAt < askedAt) return null; // an old failure, not this ask's
  return path.relative(repoRoot, implementLogPath(repoRoot, planSlug));
};

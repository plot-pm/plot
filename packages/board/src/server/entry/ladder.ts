// THE COMMIT+PUSH LADDER, SHARED. `plot-deliver.sh`'s mechanical half
// (`deliver.ts`) and `plot-approve.sh`'s (`approve.ts`) both stage a plan
// edit in a booking worktree, commit it attributed to a human, and push to
// the default branch, retrying on rejection. The steps and the receipt
// formats are one implementation; a second copy would be an undeclared
// duplicate of the pair `state-receipt.corpus.test.ts` already keeps in sync
// against the shell.
import { createHash } from 'node:crypto';
import { mkdirSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Scripts, Trees } from '@plot-pm/domain';

/** The ports `commitAndPush` and the receipt writers need from a caller's `Context`. */
export interface LadderContext {
  repoRoot: string;
  scripts: Scripts;
  trees: Trees;
  /** Sleeps between push attempts; the jittered 2 to 10 s wait where absent. */
  retryWait?: () => Promise<void>;
}

/** Prints to stdout, matching the scripts' unprefixed `step:`/`summary:` lines. */
export type Printer = (s: string) => void;

/** The maintainer's number (issue #1737): five attempts in total before `commitAndPush` gives up. */
const DEFAULT_ATTEMPTS = 5;

/** A jittered 2 to 10 second wait between attempts — the real clock `commitAndPush` sleeps by default. */
const defaultWait = async (): Promise<void> => {
  const ms = 2000 + Math.random() * 8000;
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * The local calendar date of `now`, as `date +%Y-%m-%d` prints it.
 *
 * @param now - the instant to read; the current time when omitted.
 * @returns the date in the process's local time zone, `YYYY-MM-DD`.
 */
export const localDate = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * The git blob object name of a string, as `git hash-object --stdin` computes
 * it: `sha1("blob " + byteLength + "\0" + content)`.
 *
 * NOT {@link Refs.hashFilesSync} — that operation is `--stdin-paths`, which
 * hashes the CONTENT OF THE FILE each path names, where the shell's
 * `_receipt_file` hashes the PATH STRING ITSELF (`printf '%s' "$1" |
 * git hash-object --stdin`). The two answer different questions and a
 * corpus comparison against the shell is what caught the substitution.
 *
 * @param content - the bytes to hash, as `git hash-object` would receive them on stdin.
 * @returns the 40-character hex object name.
 */
export const gitBlobOid = (content: string): string => {
  const bytes = Buffer.from(content, 'utf8');
  const hash = createHash('sha1');
  hash.update(`blob ${bytes.length}\0`);
  hash.update(bytes);
  return hash.digest('hex');
};

/**
 * Writes a state receipt the way `plot-state-receipt.sh`'s `record_state_receipt`
 * does: one file per receipt, named by the git blob oid of the repo-relative
 * path, holding `<rel>\t<value>\n`.
 *
 * WRITTEN AGAINST THE MAIN REPOSITORY, not the booking worktree — a receipt is
 * read by `plot-state-gate.sh` in the caller's own checkout, and `.plot/state/`
 * is untracked, so the booking worktree's copy would vanish with it.
 */
export const recordStateReceipt = (repoRoot: string, relPath: string, value: string): void => {
  const oid = gitBlobOid(relPath);
  const dir = path.join(repoRoot, '.plot', 'state', 'state-receipts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, oid), `${relPath}\t${value}\n`);
};

/**
 * Spends the action receipt, the file `plot-controller-gate.sh`'s
 * `spend_action_receipt` deletes on completion.
 *
 * KEYED ON THE ACTION WORD (`approve`/`deliver`/`release`), NOT THE SCRIPT
 * NAME. The shell function takes either spelling and normalises through
 * `_action_of` before touching a path — `spend_action_receipt('plot-deliver.sh')`
 * deletes `.plot/state/action-receipts/deliver`, never a file literally named
 * `plot-deliver.sh`. These entries have no shell left to source that function
 * from, so each writes the already-normalised word directly: the caller
 * passes `'approve'`, `'deliver'` or `'release'`, never a `.sh` name.
 *
 * @param repoRoot - the main repository, where `.plot/state/` lives.
 * @param action - `'approve'`, `'deliver'` or `'release'`.
 */
export const spendActionReceipt = (repoRoot: string, action: 'approve' | 'deliver' | 'release'): void => {
  const file = path.join(repoRoot, '.plot', 'state', 'action-receipts', action);
  try {
    unlinkSync(file);
  } catch {
    // Not present — nothing to spend, and nothing this run should fail on.
  }
};

/** The `push:` outcome word `plot-push-main.sh` printed, or `'unknown'` where none was found. */
export const pushReportOf = (stdout: string): string => {
  for (const line of stdout.split('\n')) {
    const match = line.match(/^push: ([a-z]*)/);
    if (match) return match[1] || 'unknown';
  }
  return 'unknown';
};

/** A refusal carrying the sentence to print on stderr, and the exit code to use. */
export class Refused extends Error {}

/**
 * Runs a booking commit+push: commit whatever the caller already staged
 * (attributed to `who`), push to the default branch, and retry on rejection
 * — the ladder every lifecycle write in `deliver.ts` and `approve.ts` climbs.
 *
 * The staged-change check, the commit and the direct push onto `bookbr` all
 * go through the `trees` port rather than a raw `git` call —
 * {@link LadderContext.trees}'s `hasStagedChanges`/`commitAs`/`push`, so this
 * module adds no new process-reach site.
 *
 * A REJECTED PUSH IS RETRIED, NEVER REPUSHED. The commit that lost the race
 * was cut from a stale base, so retrying it verbatim would still conflict.
 * Each retry fetches the default branch, resets `bookbr` in `tmpwt` to the
 * fresh tip with {@link Trees.resetBranch}, and calls `reapply(tmpwt)`. The
 * caller's `reapply` reads the reset files and runs its transition again on
 * that text, then stages the result. The loop then commits and pushes again.
 * A re-applied write that `main` already holds (`hasStagedChanges` false)
 * reports `nothing-to-commit` rather than a failure, so a re-run is
 * idempotent.
 *
 * Every step that stops a retry prints a `step:` line naming it: a failed
 * fetch, a failed reset, and a `reapply` that throws. A `reapply` error
 * propagates to the caller after its line is printed.
 *
 * @param reapply - redoes the caller's write and staging against the reset
 *   `tmpwt`, from the files it now holds; called before every attempt after
 *   the first.
 * @param attempts - the number of pushes to try in total; five is the
 *   maintainer's number (issue #1737), lowered in a test so it runs in
 *   milliseconds.
 * @param wait - sleeps between attempts; `ctx.retryWait` where given, else a
 *   jittered 2 to 10 s wait.
 * @returns the push outcome word, or `rejected` where every attempt was
 *   refused or a retry step failed.
 */
export const commitAndPush = async (
  ctx: LadderContext,
  tmpwt: string,
  bookbr: string,
  main: string,
  who: string,
  message: string,
  noun: 'approval' | 'delivery' | 'release' | 'verification' | 'design move',
  nothingMessage: string,
  reapply: (tmpwt: string) => Promise<void>,
  write: Printer,
  attempts: number = DEFAULT_ATTEMPTS,
  wait: () => Promise<void> = ctx.retryWait ?? defaultWait,
): Promise<{ pushed: string } | { rejected: true }> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const diff = await ctx.trees.hasStagedChanges(tmpwt);
    if (diff.ok && !diff.value) {
      write(`step: ${nothingMessage}\n`);
      return { pushed: 'nothing-to-commit' };
    }

    const commit = await ctx.trees.commitAs(tmpwt, who, message);
    if (!commit.ok) throw new Refused(`could not commit the ${noun}.\n  See what git refused: git -C ${tmpwt} status\n  Nothing was pushed; re-run this — it is idempotent.`);

    const pushOut = await ctx.scripts.awaited('plot-push-main.sh', [bookbr, main]);
    for (const line of `${pushOut.stdout}${pushOut.stderr}`.split('\n')) {
      if (line.length > 0) write(`  ${line}\n`);
    }
    if (pushOut.code === 0) {
      return { pushed: pushReportOf(pushOut.stdout) };
    }

    if (attempt === attempts) break;
    write(`step: push rejected — retrying (attempt ${attempt} of ${attempts})\n`);
    await wait();
    const fetched = await ctx.trees.fetch(ctx.repoRoot, main);
    if (!fetched.ok) {
      write(`step: retry stopped — git fetch origin ${main} failed in ${ctx.repoRoot}\n`);
      return { rejected: true };
    }
    const reset = await ctx.trees.resetBranch(tmpwt, bookbr, `origin/${main}`);
    if (!reset.ok) {
      write(`step: retry stopped — could not reset '${bookbr}' to origin/${main} in ${tmpwt}\n`);
      return { rejected: true };
    }
    try {
      await reapply(tmpwt);
    } catch (err) {
      write(`step: retry stopped — re-applying the ${noun} to origin/${main} failed\n`);
      throw err;
    }
  }

  write(`step: push rejected after ${attempts} attempts\n`);
  return { rejected: true };
};

/** Resolves a plan path's symlink to the canonical file it names, repository-relative. */
export const realPlanPath = (repoRoot: string, relPath: string): string | null => {
  const abs = path.join(repoRoot, relPath);
  let dir = path.dirname(abs);
  let base = path.basename(abs);
  try {
    const target = readlinkSync(abs);
    const targetAbs = path.isAbsolute(target) ? target : path.join(dir, target);
    dir = path.dirname(targetAbs);
    base = path.basename(targetAbs);
  } catch {
    // Not a symlink — use the path as given.
  }
  const real = path.join(dir, base);
  if (!real.startsWith(`${repoRoot}${path.sep}`) && real !== repoRoot) return null;
  return path.relative(repoRoot, real);
};

/** Removes a scratch file, ignoring an error — it may already be gone. */
export const unlinkSyncSafe = (file: string): void => {
  try {
    unlinkSync(file);
  } catch {
    // Already gone — nothing this run should fail on.
  }
};

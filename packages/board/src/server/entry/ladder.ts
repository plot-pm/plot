// THE COMMIT+PUSH LADDER, SHARED. `plot-deliver.sh`'s mechanical half
// (`deliver.ts`) and `plot-approve.sh`'s (`approve.ts`) both stage a plan
// edit in a booking worktree, commit it attributed to a human, and push to
// the default branch with a micro-PR fallback on rejection. The steps, the
// receipt formats and the fallback are one implementation; a second copy
// would be an undeclared duplicate of the pair `state-receipt.corpus.test.ts`
// already keeps in sync against the shell.
import { createHash } from 'node:crypto';
import { mkdirSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Host, Scripts, Trees } from '@plot-pm/domain';

/** The ports `commitAndPush` and the receipt writers need from a caller's `Context`. */
export interface LadderContext {
  repoRoot: string;
  host: Host;
  scripts: Scripts;
  trees: Trees;
}

/** Prints to stdout, matching the scripts' unprefixed `step:`/`summary:` lines. */
export type Printer = (s: string) => void;

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
 * (attributed to `who`), push to the default branch, and fall back to a
 * micro-PR on rejection — the ladder every lifecycle write in `deliver.ts`
 * and `approve.ts` climbs, once the caller has staged its own paths.
 *
 * The staged-change check, the commit and the direct push onto `bookbr` all
 * go through the `trees` port rather than a raw `git` call —
 * {@link LadderContext.trees}'s `hasStagedChanges`/`commitAs`/`push`, so this
 * module adds no new process-reach site. Staging itself is the caller's
 * step, through the same port's `stage`, because what a caller stages
 * (a plan edit, a moved symlink, a ticked sprint item) is its own concern.
 *
 * @returns the push outcome word, or `rejected` where neither the primary
 *   push nor the micro-PR fallback landed.
 */
export const commitAndPush = async (
  ctx: LadderContext,
  tmpwt: string,
  bookbr: string,
  main: string,
  who: string,
  message: string,
  title: string,
  body: string,
  noun: 'approval' | 'delivery' | 'release',
  nothingMessage: string,
  write: Printer,
): Promise<{ pushed: string } | { rejected: true }> => {
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

  write('step: push rejected — opening a micro-PR instead\n');
  const pushed = await ctx.trees.push(tmpwt, bookbr);
  if (!pushed.ok) return { rejected: true };
  const created = await ctx.host.prCreate({ head: bookbr, title, body, base: main });
  if (!created.ok) return { rejected: true };
  const num = created.value.split('/').pop() ?? '';
  const merged = await ctx.scripts.host(['pr-merge', num, '--delete-branch']);
  if (!merged.ok) return { rejected: true };
  write(`step: ${noun} landed via micro-PR ${created.value}\n`);
  return { pushed: 'micro-pr' };
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

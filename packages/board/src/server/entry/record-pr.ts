// `plot-record-pr.sh`'s mechanical half: append a slice's PR number to its
// line in the plan that names it, and write, commit and push that edit in ONE
// disposable worktree cut from `origin/<default>`. The main checkout is never
// opened, so the bytes on disk and the bytes in the commit are the same bytes.
//
//   node plot-record-pr.mjs <branch> <pr-number>
//
// Exit 0 recorded, 1 refused, 2 usage.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { PlanStore } from '@plot-pm/domain';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import { annotateSlicePr } from '@plot-pm/domain/rules/slice-pr-annotation';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { commitAndPush, Refused, type LadderContext, type Printer } from './ladder.js';
import { findPlanForBranch } from './plan-lookup.js';

const USAGE = 'usage: plot-record-pr.sh <branch> <pr-number>';

/** The ports and paths this entry needs. */
export interface RecordPrContext extends LadderContext {
  /** A plan store rooted at a directory — the booking worktree, once it exists. */
  planStoreAt: (root: string) => PlanStore;
  /** Names the booking worktree apart from a concurrent run's. */
  pid: number;
}

/** The two arguments, validated. */
export interface RecordPrArgs {
  branch: string;
  pr: string;
}

/**
 * Validates `<branch> <pr-number>`.
 *
 * @param argv - the arguments after the script name.
 * @returns the arguments, or the usage sentence to print.
 */
export const parseRecordPrArgs = (argv: readonly string[]): RecordPrArgs | string => {
  const [branch = '', pr = ''] = argv;
  if (branch === '' || pr === '') return USAGE;
  if (!/^[0-9]+$/.test(pr)) return `<pr-number> must be numeric, got '${pr}'`;
  return { branch, pr };
};

/** Reads one config key in `root`, falling back where the read fails or is empty. */
const configured = async (store: PlanStore, key: string, fallback: string): Promise<string> => {
  const read = await store.config(key, fallback);
  const value = read.ok ? read.value.trim() : '';
  return value === '' ? fallback : value;
};

/** The default branch: `Main branch` where configured, then `origin/HEAD`, then `main`. */
const resolveMain = async (ctx: RecordPrContext): Promise<string> => {
  const declared = await configured(ctx.planStoreAt(ctx.repoRoot), 'Main branch', '');
  if (declared !== '') return declared;
  const local = await ctx.trees.originHead(ctx.repoRoot);
  return local.ok && local.value.trim() !== '' ? local.value.trim() : 'main';
};

/** The plan file in `tmpwt` whose slices name `branch`, as `planDir` spells it, or a refusal. */
const findPlan = async (store: PlanStore, planDir: string, branch: string): Promise<string> => {
  const found = await findPlanForBranch(store, planDir, branch);
  if (found === undefined) throw new Refused(`no plan in ${planDir} names branch '${branch}'`);
  return found.file;
};

/** Appends ` → #<pr>` to the branch's bullet in `tmpwt` and stages it, or refuses. */
const annotate = async (store: PlanStore, ctx: RecordPrContext, tmpwt: string, rel: string, args: RecordPrArgs): Promise<void> => {
  const read = await store.readText(rel);
  if (!read.ok || read.value === null) throw new Refused(`could not read ${rel} in ${tmpwt}`);
  const result = annotateSlicePr(read.value, args.branch, args.pr);
  if (result.outcome === 'refused') {
    throw new Refused(
      result.reason === 'already-annotated'
        ? `${rel} already carries a PR annotation on the ${args.branch} line — refusing to add a second`
        : `${rel} does not carry a bulleted line for ${args.branch}`,
    );
  }
  const written = await store.writeText(rel, result.content);
  if (!written.ok) throw new Refused(`could not write ${rel} in ${tmpwt}`);
  const staged = await ctx.trees.stage(tmpwt, [rel]);
  if (!staged.ok) throw new Refused(`could not stage ${rel} in ${tmpwt}`);
};

/**
 * Records `args.pr` on `args.branch`'s line and pushes it to the default branch.
 *
 * @param ctx - the ports, rooted at the caller's repository.
 * @param args - the validated branch and PR number.
 * @param write - where step lines and the push report go.
 * @returns the process exit code; a refusal is thrown as {@link Refused}.
 */
export const recordPr = async (ctx: RecordPrContext, args: RecordPrArgs, write: Printer): Promise<number> => {
  const main = await resolveMain(ctx);
  await ctx.trees.fetch(ctx.repoRoot, main);

  const mainRootRead = await ctx.trees.mainRoot(ctx.repoRoot);
  const mainRoot = mainRootRead.ok ? mainRootRead.value : ctx.repoRoot;
  const deskReading = { configured: await configured(ctx.planStoreAt(mainRoot), 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);

  const slugPart = args.branch.slice(args.branch.lastIndexOf('/') + 1);
  const bookbr = `plot/record-pr-${slugPart}`;
  const tmpwt = path.join(deskRoot(deskReading), `.plot-record-pr-${slugPart}.${ctx.pid}`);

  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) throw new Refused(`could not prepare a booking worktree at ${tmpwt}`);
  try {
    // Read inside the booking worktree, so the search sees origin/<default>'s
    // plan directory and nothing a dirty main checkout holds.
    const store = ctx.planStoreAt(tmpwt);
    const planDir = await configured(store, 'Plan directory', 'docs/plans/');
    const planFile = await findPlan(store, planDir, args.branch);
    const rel = path.relative(tmpwt, path.resolve(tmpwt, planFile));
    const reapply = (wt: string): Promise<void> => annotate(ctx.planStoreAt(wt), ctx, wt, rel, args);
    await reapply(tmpwt);

    const userName = await ctx.trees.userName(ctx.repoRoot);
    const who = userName.ok && userName.value.trim() !== '' ? userName.value.trim() : 'plot';
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: record PR #${args.pr} for ${slugPart}`,
      'PR record',
      `nothing to commit — ${rel} may already carry PR #${args.pr}`,
      reapply,
      write,
    );
    if ('rejected' in landed) throw new Refused(`the PR record for ${args.branch} could not reach ${main}; re-run this once the push works`);
    if (landed.pushed === 'nothing-to-commit') return 1;
    return 0;
  } finally {
    await ctx.trees.removeWithBranch(tmpwt, bookbr);
  }
};

/**
 * Parses argv, builds the ports for the caller's repository, and records the PR.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where step lines go.
 * @param warn - where refusals go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
): Promise<number> => {
  const args = parseRecordPrArgs(argv);
  if (typeof args === 'string') {
    warn(args === USAGE ? `${USAGE}\n` : `plot-record-pr: ${args}\n`);
    return 2;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-record-pr: not a git repository\n');
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: RecordPrContext = {
    repoRoot,
    scripts: scriptsShell(context),
    trees: treesGit(context),
    planStoreAt: (root) => planStoreShell({ repoRoot: root, scriptDir }),
    pid: process.pid,
  };

  try {
    return await recordPr(ctx, args, write);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-record-pr: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

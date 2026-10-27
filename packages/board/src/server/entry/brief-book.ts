// Writes a branch's hand-off brief and its plan's `Started:` record in ONE
// disposable worktree cut from `origin/<default>`, commits, pushes, and
// removes the worktree. The main checkout is never opened, so a
// `--brief-only` implement run leaves it exactly as it found it —
// `git status --porcelain`, `HEAD` and the checked out branch all unchanged.
//
// Called directly with `node`, no `.sh` launcher: the plan this implements
// settles "no new shell" explicitly.
//
//   node plot-brief-book.mjs <slug> <branch> <brief-file>
//
// <brief-file> is a path to the brief's text, written by the caller OUTSIDE
// the repository — a scratch file, not a path under the checkout. Exit 0
// booked (or already booked — nothing to commit is still success), 1
// refused, 2 usage.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { PlanStore } from '@plot-pm/domain';
import { briefPath } from '@plot-pm/domain/rules/brief-path';
import { briefNeedsWrite, insertStartedLine } from '@plot-pm/domain/rules/brief-booking';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { commitAndPush, localDate, Refused, type LadderContext, type Printer } from './ladder.js';
import { findPlanForBranch } from './plan-lookup.js';

const USAGE = 'usage: plot-brief-book.mjs <slug> <branch> <brief-file>';

/** The ports and paths this entry needs. */
export interface BriefBookContext extends LadderContext {
  /** A plan store rooted at a directory — the booking worktree, once it exists. */
  planStoreAt: (root: string) => PlanStore;
  /** Names the booking worktree apart from a concurrent run's. */
  pid: number;
}

/** The three arguments, validated. */
export interface BriefBookArgs {
  slug: string;
  branch: string;
  briefText: string;
}

/**
 * Validates `<slug> <branch> <brief-file>`, reading the brief's text from
 * `<brief-file>`.
 *
 * @param argv - the arguments after the script name.
 * @param readFile - reads a file's text; injected so a test needs no disk.
 * @returns the arguments, or the usage sentence to print.
 */
export const parseBriefBookArgs = (
  argv: readonly string[],
  readFile: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): BriefBookArgs | string => {
  const [slug = '', branch = '', briefFile = ''] = argv;
  if (slug === '' || branch === '' || briefFile === '') return USAGE;
  let briefText: string;
  try {
    briefText = readFile(briefFile);
  } catch {
    return `could not read brief text from ${briefFile}`;
  }
  return { slug, branch, briefText };
};

/** Reads one config key in `root`, falling back where the read fails or is empty. */
const configured = async (store: PlanStore, key: string, fallback: string): Promise<string> => {
  const read = await store.config(key, fallback);
  const value = read.ok ? read.value.trim() : '';
  return value === '' ? fallback : value;
};

/** The default branch: `Main branch` where configured, then `origin/HEAD`, then `main`. */
const resolveMain = async (ctx: BriefBookContext): Promise<string> => {
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

/**
 * Writes the brief where it is missing or stale, and inserts the plan's
 * `Started:` line, staging whichever of the two actually changed.
 *
 * @returns whether either write happened — `false` means both were already
 *   on the ref, so the caller stages and commits nothing.
 */
const bookInto = async (
  store: PlanStore,
  ctx: BriefBookContext,
  tmpwt: string,
  briefRel: string,
  planRel: string,
  args: BriefBookArgs,
  who: string,
  date: string,
): Promise<boolean> => {
  let wrote = false;

  const briefRead = await store.readText(briefRel);
  if (!briefRead.ok) throw new Refused(`could not read ${briefRel} in ${tmpwt}`);
  if (briefNeedsWrite({ briefOnRef: briefRead.value, briefText: args.briefText })) {
    const written = await store.writeText(briefRel, args.briefText);
    if (!written.ok) throw new Refused(`could not write ${briefRel} in ${tmpwt}`);
    const staged = await ctx.trees.stage(tmpwt, [briefRel]);
    if (!staged.ok) throw new Refused(`could not stage ${briefRel} in ${tmpwt}`);
    wrote = true;
  }

  const planRead = await store.readText(planRel);
  if (!planRead.ok || planRead.value === null) throw new Refused(`could not read ${planRel} in ${tmpwt}`);
  const inserted = insertStartedLine(planRead.value, date, who, args.branch);
  if (inserted.outcome === 'refused') {
    throw new Refused(`${planRel} has no '## Status' section — nowhere to record the start of ${args.branch}`);
  }
  if (inserted.outcome === 'inserted') {
    const written = await store.writeText(planRel, inserted.content);
    if (!written.ok) throw new Refused(`could not write ${planRel} in ${tmpwt}`);
    const staged = await ctx.trees.stage(tmpwt, [planRel]);
    if (!staged.ok) throw new Refused(`could not stage ${planRel} in ${tmpwt}`);
    wrote = true;
  }

  return wrote;
};

/**
 * Books `args.branch`'s brief and `Started:` record on the default branch.
 *
 * @param ctx - the ports, rooted at the caller's repository.
 * @param args - the validated slug, branch and brief text.
 * @param write - where step lines and the push report go.
 * @returns the process exit code; a refusal is thrown as {@link Refused}.
 */
export const bookBrief = async (ctx: BriefBookContext, args: BriefBookArgs, write: Printer): Promise<number> => {
  const main = await resolveMain(ctx);
  await ctx.trees.fetch(ctx.repoRoot, main);

  const mainRootRead = await ctx.trees.mainRoot(ctx.repoRoot);
  const mainRoot = mainRootRead.ok ? mainRootRead.value : ctx.repoRoot;
  const deskReading = { configured: await configured(ctx.planStoreAt(mainRoot), 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);

  const bookbr = `plot/brief-book-${args.slug}`;
  const tmpwt = path.join(deskRoot(deskReading), `.plot-brief-book-${args.slug}.${ctx.pid}`);

  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) throw new Refused(`could not prepare a booking worktree at ${tmpwt}`);
  try {
    const store = ctx.planStoreAt(tmpwt);
    const planDir = await configured(store, 'Plan directory', 'docs/plans/');
    const planFile = await findPlan(store, planDir, args.branch);
    const planRel = path.relative(tmpwt, path.resolve(tmpwt, planFile));
    const briefRel = briefPath(args.branch);
    const date = localDate();

    const userName = await ctx.trees.userName(ctx.repoRoot);
    const who = userName.ok && userName.value.trim() !== '' ? userName.value.trim() : 'plot';

    const reapply = async (wt: string): Promise<void> => {
      await bookInto(ctx.planStoreAt(wt), ctx, wt, briefRel, planRel, args, who, date);
    };
    await reapply(tmpwt);

    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: book the brief and plan start for ${args.slug}`,
      'brief booking',
      `nothing to commit — ${briefRel} and the Started: record may already be on origin/${main}`,
      reapply,
      write,
    );
    if ('rejected' in landed) throw new Refused(`the brief booking for ${args.branch} could not reach ${main}; re-run this once the push works`);
    return 0;
  } finally {
    await ctx.trees.removeWithBranch(tmpwt, bookbr);
  }
};

/**
 * Parses argv, builds the ports for the caller's repository, and books the brief.
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
  const args = parseBriefBookArgs(argv);
  if (typeof args === 'string') {
    warn(args === USAGE ? `${USAGE}\n` : `plot-brief-book: ${args}\n`);
    return 2;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-brief-book: not a git repository\n');
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: BriefBookContext = {
    repoRoot,
    scripts: scriptsShell(context),
    trees: treesGit(context),
    planStoreAt: (root) => planStoreShell({ repoRoot: root, scriptDir }),
    pid: process.pid,
  };

  try {
    return await bookBrief(ctx, args, write);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-brief-book: ${err.message}\n`);
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

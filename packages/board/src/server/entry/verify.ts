// THROUGH THE NARROW PATHS, as `deliver.ts` does, so the bundle carries the
// adapters and rules this command uses and no more.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import type { Host, PlanStore, Refs, Scripts, Trees } from '@plot-pm/domain';
import { claimsOf, renderClaims } from '@plot-pm/domain/rules/claims';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { jurorPath, moderationPath, panelDir } from '@plot-pm/domain/rules/panel';
import {
  foldVerification,
  verificationBody,
  verifiedValue,
  type ClaimVerdict,
} from '@plot-pm/domain/rules/verification';
import { withRecord, withSection } from '@plot-pm/domain/workflows/rendering';
import { commitAndPush, localDate, realPlanPath, Refused, type Printer } from './ladder.js';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point of a pinned verification run.
 *
 * ```
 * plot-verify.mjs prepare <slug> [--at <sha>]
 * plot-verify.mjs claims <slug> <sha>
 * plot-verify.mjs fold <slug>
 * plot-verify.mjs record <slug>
 * ```
 *
 * `prepare` builds two detached trees under `.plot/state/verify/<slug>/`:
 * `tools/` at `origin/<main>` and `pin/` at the commit that added the plan's
 * `Delivered:` value, or at the `--at` commit. Every command of the run takes
 * its code from `tools/`: a copy started from anywhere else hands its command
 * over to `tools/`'s `plot-verify.mjs` once that tree exists, and prints its
 * output. `pin/` is a working directory and a source of files. The repository
 * root is the one the git common directory names, so any tree of the
 * repository serves as the working directory. `record` folds the juror files
 * `verify-<lens>.md` into one verdict per claim, books the `Verified:` line and
 * the `## Verification` section through a booking worktree, and removes every
 * tree it made.
 *
 * Exit 0 on success, 1 on a refusal. A refusal writes no record.
 */

/** The verify directory below the repository root. */
const VERIFY_DIR = path.join('.plot', 'state', 'verify');

/** The prefix of this run's juror and moderation files. */
const PREFIX = 'verify-';

/** Ten minutes: the bound on one frozen install. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** The bound on a handed-over command: one install and ten minutes more. */
const HANDOVER_TIMEOUT_MS = INSTALL_TIMEOUT_MS + 10 * 60 * 1000;

/** Set on a handed-over command, so the tools tree's copy hands over no further. */
const HANDOVER_ENV = 'PLOT_VERIFY_HANDED_OVER';

/** The bundle's path below the scripts directory. */
const BUNDLE = path.join('board', 'plot-verify.mjs');

/** What `prepare` leaves for `fold` and `record`. */
interface RunFacts {
  slug: string;
  /** The plan file, relative to the repository root. */
  plan: string;
  /** The commit that added the plan's `Delivered:` value. */
  delivery: string;
  /** The commit the claims are judged at: `--at`, or the delivery commit. */
  judged: string;
  /** The commit the tools tree sits at. */
  tools: string;
  /** The `Delivered:` date the plan carries at the delivery commit. */
  deliveredOn: string;
  /** Every path the plan's merged slice branches changed. */
  files: readonly string[];
}

/** The ports and paths one invocation needs. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  /** `scriptDir` relative to the root of the tree that holds it. */
  scriptsRel: string;
  refs: Refs;
  host: Host;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
}

/** What the command line asked for. */
interface Args {
  command: 'prepare' | 'claims' | 'fold' | 'record';
  slug: string;
  at: string;
  sha: string;
}

/**
 * Parses argv.
 *
 * @param argv - the arguments after the script name.
 * @returns the parsed request, or the reason it cannot be read.
 */
const parseArgs = (argv: readonly string[]): Args | string => {
  const [command, ...rest] = argv;
  if (command !== 'prepare' && command !== 'claims' && command !== 'fold' && command !== 'record') {
    return 'need a subcommand: prepare <slug> [--at <sha>] | claims <slug> <sha> | fold <slug> | record <slug>';
  }
  let at = '';
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--at') {
      at = rest[++i] ?? '';
      if (at === '') return '--at needs a commit';
    } else if (rest[i].startsWith('-')) return `unknown flag '${rest[i]}'`;
    else positional.push(rest[i]);
  }
  const slug = positional[0] ?? '';
  if (slug === '') return `${command} needs a plan slug`;
  if (command === 'claims' && (positional[1] ?? '') === '') return 'claims needs a commit: claims <slug> <sha>';
  if (at !== '' && command !== 'prepare') return `--at belongs to prepare, not ${command}`;
  return { command, slug, at, sha: positional[1] ?? '' };
};

/** The directory holding one run's trees and facts. */
const runDir = (repoRoot: string, slug: string): string => path.join(repoRoot, VERIFY_DIR, slug);

/**
 * Runs `git` in the repository.
 *
 * @param repoRoot - the directory to run in.
 * @param args - git's arguments.
 * @returns the exit code and both streams.
 */
const git = (repoRoot: string, args: readonly string[]) => runProcess('git', ['-C', repoRoot, ...args]);

/**
 * Resolves the default branch: the local `origin/HEAD`, then the host, then `main`.
 *
 * @param ctx - the ports and paths.
 * @returns the branch name.
 */
const resolveMain = async (ctx: Context): Promise<string> => {
  const local = await git(ctx.repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const trimmed = local.stdout.trim().replace(/^origin\//, '');
  if (local.code === 0 && trimmed !== '') return trimmed;
  const hosted = await ctx.scripts.host(['default-branch']);
  const named = hosted.ok ? hosted.value.trim() : '';
  return named !== '' ? named : 'main';
};

/**
 * Finds a plan's file by slug in the plan directory.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @returns the path relative to the repository root, or `''` where none exists.
 */
const findPlanFile = async (ctx: Context, slug: string): Promise<string> => {
  const dirCfg = await ctx.scripts.config('Plan directory', 'docs/plans/');
  const dir = dirCfg.ok ? dirCfg.value.trim() : 'docs/plans/';
  const listed = await ctx.planStore.listDir(dir);
  const hit = (listed.ok ? listed.value : []).find((name) => name.endsWith(`${slug}.md`));
  return hit === undefined ? '' : path.join(dir, hit);
};

/**
 * Reads `run.json`, which `prepare` wrote.
 *
 * @param repoRoot - the repository root.
 * @param slug - the plan's slug.
 * @returns the facts of the prepared run.
 * @throws {Refused} when no run was prepared.
 */
const readFacts = (repoRoot: string, slug: string): RunFacts => {
  const file = path.join(runDir(repoRoot, slug), 'run.json');
  if (!existsSync(file)) throw new Refused(`no prepared run for '${slug}' — run: plot-verify.mjs prepare ${slug}`);
  return JSON.parse(readFileSync(file, 'utf8')) as RunFacts;
};

/**
 * Removes the trees of an earlier or finished run.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 */
const removeRun = async (ctx: Context, slug: string): Promise<void> => {
  const dir = runDir(ctx.repoRoot, slug);
  for (const tree of ['tools', 'pin']) {
    if (existsSync(path.join(dir, tree))) await ctx.trees.removeOnly(path.join(dir, tree));
  }
  rmSync(dir, { recursive: true, force: true });
  await ctx.trees.prune();
};

/**
 * Lists the paths the plan's merged slice branches changed.
 *
 * @param ctx - the ports and paths.
 * @param branches - the branches the plan names.
 * @returns every changed path, once, in the order first met.
 */
const changedFilesOf = async (ctx: Context, branches: readonly string[]): Promise<string[]> => {
  const files = new Set<string>();
  for (const branch of branches) {
    const sha = await ctx.host.prMergeCommit(branch);
    if (!sha.ok || sha.value === '') continue;
    const changed = await ctx.refs.commitFiles(sha.value);
    if (changed.ok) changed.value.forEach((file) => files.add(file));
  }
  return [...files];
};

/** Matches a filled `Delivered:` line and captures its date. */
const DELIVERED_ON = /^[ \t]*[-*][ \t]*\*\*Delivered:\*\*[ \t]*(\d{4}-\d{2}-\d{2})/m;

/** The tools tree's copy of this bundle for one run. */
const toolsBundle = (ctx: Context, slug: string): string =>
  path.join(runDir(ctx.repoRoot, slug), 'tools', ctx.scriptsRel, BUNDLE);

/**
 * Whether this invocation hands its command over to the tools tree's copy.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @returns `true` where the tools tree holds a copy and this process is neither
 *   that copy nor a command already handed over.
 */
const handsOver = (ctx: Context, slug: string): boolean => {
  if (process.env[HANDOVER_ENV] === '1') return false;
  const tools = toolsBundle(ctx, slug);
  if (!existsSync(tools)) return false;
  const own = path.join(ctx.scriptDir, BUNDLE);
  return !existsSync(own) || realpathSync(own) !== realpathSync(tools);
};

/**
 * Runs the command in the tools tree's copy and prints what it printed.
 *
 * The working directory is `pin/` where it exists, and `tools/` before it does.
 * The hand-over is named on stderr, so stdout carries the copy's output alone.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @param argv - the arguments this process received.
 * @param write - where the copy's stdout goes.
 * @param warn - where the copy's stderr goes.
 * @returns the copy's exit code.
 */
const handOver = async (
  ctx: Context,
  slug: string,
  argv: readonly string[],
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const bundle = toolsBundle(ctx, slug);
  const pin = path.join(runDir(ctx.repoRoot, slug), 'pin');
  const cwd = existsSync(pin) ? pin : path.join(runDir(ctx.repoRoot, slug), 'tools');
  warn(`plot-verify: hand over to ${bundle}\n`);
  const ran = await runProcess('node', [bundle, ...argv], {
    cwd,
    env: { [HANDOVER_ENV]: '1' },
    timeoutMs: HANDOVER_TIMEOUT_MS,
  });
  write(ran.stdout);
  warn(ran.stderr);
  return ran.code;
};

/**
 * Builds the tools tree at a freshly fetched `origin/<main>`.
 *
 * @param ctx - the ports and paths.
 * @param slug - the plan's slug.
 * @throws {Refused} on `fetch-failed` and `tools-unavailable`; the run's
 *   directory is removed first.
 */
const prepareTools = async (ctx: Context, slug: string): Promise<void> => {
  const main = await resolveMain(ctx);
  const fetched = await git(ctx.repoRoot, ['fetch', '-q', 'origin', main]);
  if (fetched.code !== 0) {
    throw new Refused(`fetch-failed: git fetch origin ${main} exited ${fetched.code}\n${fetched.stderr.trim()}`);
  }
  const head = await git(ctx.repoRoot, ['rev-parse', '--verify', '--quiet', `origin/${main}^{commit}`]);
  if (head.code !== 0) throw new Refused(`fetch-failed: origin/${main} names no commit after the fetch`);

  await removeRun(ctx, slug);
  const tools = path.join(runDir(ctx.repoRoot, slug), 'tools');
  mkdirSync(path.dirname(tools), { recursive: true });
  try {
    const added = await ctx.trees.add(tools, head.stdout.trim());
    if (!added.ok) throw new Refused(`tools-unavailable: could not add a tree at origin/${main}`);
    for (const needed of ['plot-verify.mjs', 'plot-local-checks.mjs']) {
      const wanted = path.join(tools, ctx.scriptsRel, 'board', needed);
      if (!existsSync(wanted)) throw new Refused(`tools-unavailable: ${wanted}`);
    }
  } catch (err) {
    await removeRun(ctx, slug);
    throw err;
  }
};

/**
 * Builds the pinned tree and the run's facts, beside an existing tools tree.
 *
 * @param ctx - the ports and paths.
 * @param args - the request.
 * @param rel - the plan file, relative to the repository root.
 * @param write - where progress goes.
 * @returns the exit code.
 * @throws {Refused} on `tools-unavailable`, `pin-not-found` and
 *   `install-failed`; the run's directory is removed first.
 */
const preparePin = async (ctx: Context, args: Args, rel: string, write: Printer): Promise<number> => {
  const dir = runDir(ctx.repoRoot, args.slug);
  const tools = path.join(dir, 'tools');
  const pin = path.join(dir, 'pin');
  try {
    const toolsHead = existsSync(tools) ? await git(tools, ['rev-parse', 'HEAD']) : null;
    if (toolsHead === null || toolsHead.code !== 0) throw new Refused(`tools-unavailable: no tools tree at ${tools}`);
    const toolsSha = toolsHead.stdout.trim();

    const found = await ctx.refs.recordCommit(rel, 'Delivered');
    const delivery = found.ok && found.value !== null ? found.value : '';
    if (delivery === '') {
      throw new Refused(`pin-not-found: no commit on the default branch added a filled 'Delivered:' to ${rel}`);
    }
    const wanted = args.at === '' ? delivery : args.at;
    const resolved = await git(ctx.repoRoot, ['rev-parse', '--verify', '--quiet', `${wanted}^{commit}`]);
    if (resolved.code !== 0) throw new Refused(`pin-not-found: ${wanted} names no commit`);
    const judged = resolved.stdout.trim();
    const atDelivery = await ctx.refs.showFile(delivery, rel);
    const deliveredOn = (atDelivery.ok ? DELIVERED_ON.exec(atDelivery.value)?.[1] : undefined) ?? '';

    const pinAdded = await ctx.trees.add(pin, judged);
    if (!pinAdded.ok) throw new Refused(`pin-not-found: could not add a tree at ${judged}`);
    writeFileSync(path.join(pin, '.plot-verify.pid'), `${process.pid}\n`);
    await ctx.trees.excludePath(pin, '.plot-verify.pid');

    const started = Date.now();
    const install = await runProcess('pnpm', ['install', '--frozen-lockfile'], {
      cwd: pin,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    const installMs = Date.now() - started;
    if (install.code !== 0) {
      throw new Refused(`install-failed: pnpm install --frozen-lockfile exited ${install.code} in ${pin}\n${install.stderr.trim()}`);
    }

    const record = await ctx.planStore.readPlan(path.join(pin, rel));
    const branches = record.ok ? record.value.slices.flatMap((s) => s.branches.filter((b) => !b.deferred).map((b) => b.branch)) : [];
    const files = await changedFilesOf(ctx, branches);
    const facts: RunFacts = { slug: args.slug, plan: rel, delivery, judged, tools: toolsSha, deliveredOn, files };
    writeFileSync(path.join(dir, 'run.json'), `${JSON.stringify(facts, null, 2)}\n`);
    writeFileSync(path.join(dir, 'files.txt'), files.map((f) => `${f}\n`).join(''));
    write(`step: pin ${judged.slice(0, 7)} delivery ${delivery.slice(0, 7)} tools ${toolsSha.slice(0, 7)} install ${installMs} ms\n`);
    write(`summary: pin=${judged} delivery=${delivery} tools=${toolsSha} install_ms=${installMs} files=${files.length}\n`);
    return 0;
  } catch (err) {
    await removeRun(ctx, args.slug);
    throw err;
  }
};

/**
 * Builds the pinned run's trees and facts.
 *
 * The tools tree comes first. A copy other than the tools tree's then hands the
 * rest of `prepare` over to that copy, which builds the pinned tree.
 *
 * @param ctx - the ports and paths.
 * @param args - the request.
 * @param argv - the arguments this process received, for the hand-over.
 * @param write - where progress goes.
 * @param warn - where the handed-over copy's refusals go.
 * @returns the exit code.
 * @throws {Refused} on `fetch-failed`, `tools-unavailable`, `pin-not-found`
 *   and `install-failed`.
 */
const prepare = async (
  ctx: Context,
  args: Args,
  argv: readonly string[],
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const planFile = await findPlanFile(ctx, args.slug);
  if (planFile === '') throw new Refused(`no plan found for '${args.slug}'`);
  const rel = realPlanPath(ctx.repoRoot, planFile) ?? planFile;

  if (process.env[HANDOVER_ENV] !== '1') {
    await prepareTools(ctx, args.slug);
    if (handsOver(ctx, args.slug)) return handOver(ctx, args.slug, argv, write, warn);
  }
  return preparePin(ctx, args, rel, write);
};

/**
 * Prints the plan's numbered claims at a commit.
 *
 * @param ctx - the ports and paths.
 * @param args - the request.
 * @param write - where the list goes.
 * @returns the exit code.
 */
const claims = async (ctx: Context, args: Args, write: Printer): Promise<number> => {
  const planFile = await findPlanFile(ctx, args.slug);
  if (planFile === '') throw new Refused(`no plan found for '${args.slug}'`);
  const text = await ctx.refs.showFile(args.sha, realPlanPath(ctx.repoRoot, planFile) ?? planFile);
  if (!text.ok) throw new Refused(`cannot read the plan at ${args.sha}`);
  write(renderClaims(claimsOf(text.value)));
  return 0;
};

/** The juror files of this run: `lens` and the file's text. */
const readJurors = (ctx: Context, slug: string): { lens: string; text: string | null }[] => {
  const dir = path.join(ctx.repoRoot, panelDir(slug));
  if (!existsSync(dir)) return [];
  const moderation = path.basename(moderationPath(slug, PREFIX));
  return readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.md') && name !== moderation)
    .sort()
    .map((name) => {
      const lens = name.slice(PREFIX.length, -'.md'.length);
      const file = path.join(ctx.repoRoot, jurorPath(slug, lens, PREFIX));
      return { lens, text: existsSync(file) ? readFileSync(file, 'utf8') : null };
    });
};

/**
 * Folds the juror files into verdicts.
 *
 * @param ctx - the ports and paths.
 * @param facts - the prepared run.
 * @param warn - where refusals go.
 * @returns the verdicts, or `null` where the fold refused.
 */
const foldRun = async (ctx: Context, facts: RunFacts, warn: Printer): Promise<readonly ClaimVerdict[] | null> => {
  const text = await ctx.refs.showFile(facts.judged, facts.plan);
  if (!text.ok) throw new Refused(`cannot read the plan at ${facts.judged}`);
  const folded = foldVerification(claimsOf(text.value), readJurors(ctx, facts.slug));
  if (folded.fold === 'record') return folded.verdicts;
  for (const r of folded.refusals) warn(`plot-verify: refused ${r.label} by ${r.lens === '' ? '(no juror)' : r.lens}: ${r.why}\n`);
  return null;
};

/**
 * Prints one verdict line per claim, or refuses.
 *
 * @param ctx - the ports and paths.
 * @param args - the request.
 * @param write - where the lines go.
 * @param warn - where refusals go.
 * @returns the exit code.
 */
const fold = async (ctx: Context, args: Args, write: Printer, warn: Printer): Promise<number> => {
  const verdicts = await foldRun(ctx, readFacts(ctx.repoRoot, args.slug), warn);
  if (verdicts === null) return 1;
  write(verificationBody(verdicts));
  return 0;
};

/**
 * Books the record onto the default branch and removes every tree.
 *
 * @param ctx - the ports and paths.
 * @param args - the request.
 * @param write - where progress goes.
 * @param warn - where refusals go.
 * @returns the exit code.
 */
const record = async (ctx: Context, args: Args, write: Printer, warn: Printer): Promise<number> => {
  const facts = readFacts(ctx.repoRoot, args.slug);
  const verdicts = await foldRun(ctx, facts, warn);
  if (verdicts === null) return 1;

  const main = await resolveMain(ctx);
  const who = process.env.PLOT_VERIFY_WHO || (await git(ctx.repoRoot, ['config', 'user.name'])).stdout.trim() || 'plot';
  const fetched = await git(ctx.repoRoot, ['fetch', '-q', 'origin', main]);
  if (fetched.code !== 0) {
    throw new Refused(`fetch-failed: git fetch origin ${main} exited ${fetched.code}\n${fetched.stderr.trim()}\n  Nothing was written.`);
  }

  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  const bookbr = `plot/verify-${args.slug}`;
  const tmpwt = path.join(wtRoot, `.plot-verify-${args.slug}.${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in another worktree.\n  Nothing was written.`);
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  try {
    const target = path.join(tmpwt, facts.plan);
    const present = await ctx.planStore.readText(target);
    if (!present.ok || present.value === null) throw new Refused(`${facts.plan} is not present on origin/${main}`);

    const value = verifiedValue(
      {
        today: localDate(),
        deliveredOn: facts.deliveredOn,
        delivery: facts.delivery,
        judged: facts.judged,
        tools: facts.tools,
      },
      verdicts,
    );
    const recorded = withRecord(present.value, 'Verified', value, 'replace');
    const landed = withSection(recorded.text, 'Verification', verificationBody(verdicts));
    const written = await ctx.planStore.writeText(target, landed);
    if (!written.ok) throw new Refused(`could not write ${facts.plan}.\n  Re-run this — it is idempotent.`);
    await ctx.trees.stage(tmpwt, [facts.plan]);

    const pushed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: verify ${args.slug}`,
      `plot: verify ${args.slug}`,
      `Records the verification of \`${args.slug}\`.`,
      'verification',
      `nothing to commit — the verification is already recorded on ${main}`,
      write,
    );
    if ('rejected' in pushed) {
      warn(`plot-verify: the verification is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
      await ctx.trees.removeOnly(tmpwt);
      write(`summary: push=rejected\n`);
      return 1;
    }
    await cleanup();
    await removeRun(ctx, args.slug);
    write(`summary: push=${pushed.pushed} claims=${verdicts.length} refuted=${verdicts.filter((v) => v.verdict === 'refuted').length}\n`);
    return 0;
  } catch (err) {
    await cleanup();
    throw err;
  }
};

/**
 * Resolves the repository root from the git common directory, so a linked
 * tree such as `pin/` or `tools/` answers the main checkout.
 *
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @returns the root, or `null` outside a repository.
 */
const resolveRepoRoot = async (cwd: string, scriptDir: string): Promise<string | null> => {
  const common = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const dir = common.stdout.trim();
  if (common.code === 0 && path.basename(dir) === '.git') return path.dirname(dir);
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  return probe.ok ? probe.value : null;
};

/**
 * The scripts directory relative to the root of the tree that holds it.
 *
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param repoRoot - the repository root, for a scripts directory in no tree.
 * @returns the relative path.
 */
const scriptsRelOf = async (scriptDir: string, repoRoot: string): Promise<string> => {
  const top = await git(scriptDir, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return path.relative(repoRoot, scriptDir);
  return path.relative(realpathSync(top.stdout.trim()), realpathSync(scriptDir));
};

/**
 * Dispatches one subcommand.
 *
 * A command for a run whose tools tree exists goes to that tree's copy of this
 * bundle, unless this process is that copy.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository or one of its linked trees.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where output goes.
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
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    warn(`plot-verify: ${parsed}\n`);
    return 1;
  }
  const repoRoot = await resolveRepoRoot(cwd, scriptDir);
  if (repoRoot === null) {
    warn("plot-verify: not a git repository — run this from inside the checkout\n");
    return 1;
  }
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    scriptsRel: await scriptsRelOf(scriptDir, repoRoot),
    refs: refsGit(context),
    host: hostShell(context),
    planStore: planStoreShell(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };
  try {
    if (parsed.command !== 'prepare' && handsOver(ctx, parsed.slug)) {
      return await handOver(ctx, parsed.slug, argv, write, warn);
    }
    switch (parsed.command) {
      case 'prepare':
        return await prepare(ctx, parsed, argv, write, warn);
      case 'claims':
        return await claims(ctx, parsed, write);
      case 'fold':
        return await fold(ctx, parsed, write, warn);
      case 'record':
        return await record(ctx, parsed, write, warn);
    }
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-verify: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

// Only when RUN as plot-verify.mjs, never when imported — bundles share
// `import.meta.url`, so the basename tells this one from a bundle that includes it.
if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'plot-verify.mjs' &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { PlanStore, Scripts, Trees } from '@plot-pm/domain';
import { slugOf } from '@plot-pm/domain/rules/state-transition';
import type { SprintFile } from '@plot-pm/domain/rules/sprint-membership';
import {
  addSprintMember,
  deferSprintMember,
  removeSprintMember,
  type SprintMemberContext,
  type SprintMemberResult,
  type SprintMemberTier,
} from '@plot-pm/domain/transitions/sprint-member';
import { localDate, realPlanPath, Refused, type Printer } from './ladder.js';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/** A refusal naming the reason a caller branches on, printed as `<reason>\t<message>`. */
class NamedRefusal extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
  }
}

/**
 * The `node` entry point that writes a plan's sprint membership.
 *
 * ```
 * plot-sprint-member.mjs add <sprint> <slug> --tier must|should|could [--reason "<text>"] [--no-commit]
 * plot-sprint-member.mjs defer <sprint> <slug> [--reason "<text>"] [--no-commit]
 * plot-sprint-member.mjs remove <sprint> <slug> [--reason "<text>"] [--no-commit]
 * ```
 *
 * Writes the sprint's member line, the plan's `- **Sprint:**` field, and — in
 * a Committed or Active sprint — a dated `### Scope Changes` line, through
 * {@link addSprintMember}, {@link deferSprintMember} and
 * {@link removeSprintMember}. Both files are read from, and written to, the
 * caller's own checkout — this writer never resolves a branch or a PR, the
 * way `entry/needs-design.ts`'s `caller-checkout` target does.
 *
 * Stages exactly the plan file and the sprint file and commits the index. The
 * `Trees` port has no pathspec commit, so a commit run refuses
 * `staged-elsewhere` before it writes when the index already holds other
 * staged paths. `--no-commit` stages the two paths without committing, for
 * `/plot-sprint` creation to batch several plans into one skeleton commit.
 *
 * A person makes this move. The entry refuses under `PLOT_UNATTENDED=1`
 * before it reads anything, and no flag lifts that refusal — sprint scope is
 * a person's decision, the same refusal `entry/needs-design.ts:329` carries.
 *
 * Exit 0 on a write or a no-op. Exit 1 on a refusal or a failure, with the
 * reason on stderr, `<reason>\t<message>` naming the slug and the sprint.
 */

/** The usage block `-h` prints. */
const USAGE = [
  '# Plot helper: write a plan into, out of, or around a sprint.',
  '# Usage: plot-sprint-member.mjs add <sprint> <slug> --tier must|should|could [--reason "<text>"] [--no-commit]',
  '#        plot-sprint-member.mjs defer <sprint> <slug> [--reason "<text>"] [--no-commit]',
  '#        plot-sprint-member.mjs remove <sprint> <slug> [--reason "<text>"] [--no-commit]',
  '#   --tier        where add places the member line (required for add)',
  '#   --reason      freeform note appended to the dated Scope Changes line',
  '#   --no-commit   stage the plan and sprint files without committing',
  '# Output: a `wrote:` or `noop:` line, then a machine-countable summary:',
  '#             summary: outcome=write commit=done',
  '#         Exit 0 on a write or a no-op; 1 on a refusal or a failure, with the',
  '#         reason on stderr as `<reason>\\t<message>`.',
  '#',
].join('\n');

/** What the command line asked for. */
interface Args {
  verb: 'add' | 'defer' | 'remove';
  sprint: string;
  slug: string;
  tier: SprintMemberTier | '';
  reason: string;
  commit: boolean;
}

const TIERS: readonly SprintMemberTier[] = ['must', 'should', 'could'];

/** Parses argv; returns the message to refuse with, or `__help__`. */
const parseArgs = (argv: readonly string[]): Args | string => {
  if (argv[0] === '-h' || argv[0] === '--help') return '__help__';
  const verb = argv[0];
  if (verb !== 'add' && verb !== 'defer' && verb !== 'remove') {
    return `expected a verb 'add', 'defer' or 'remove', got '${verb ?? ''}'`;
  }
  const sprint = argv[1] ?? '';
  const slug = argv[2] ?? '';
  if (sprint === '' || sprint.startsWith('-')) return 'need a sprint slug';
  if (slug === '' || slug.startsWith('-')) return 'need a plan slug';

  let tier: SprintMemberTier | '' = '';
  let reason = '';
  let commit = true;
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier') {
      const named = argv[++i] ?? '';
      if (!TIERS.includes(named as SprintMemberTier)) return `--tier takes 'must', 'should' or 'could', not '${named}'`;
      tier = named as SprintMemberTier;
    } else if (arg === '--reason') {
      reason = argv[++i] ?? '';
    } else if (arg === '--no-commit') {
      commit = false;
    } else if (arg === '-h' || arg === '--help') {
      return '__help__';
    } else {
      return `unknown flag '${arg}'`;
    }
  }
  if (verb === 'add' && tier === '') return "add needs --tier must|should|could";
  return { verb, sprint, slug, tier, reason, commit };
};

/** The ports this entry needs. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
}

/** The directories the move reads, as `## Plot Config` names them. */
interface Dirs {
  planDir: string;
  activeDir: string;
  sprintDir: string;
}

/** Reads one config key, falling back where the read fails. */
const configured = async (scripts: Scripts, key: string, fallback: string): Promise<string> => {
  const read = await scripts.config(key, fallback);
  return read.ok ? read.value.trim() : fallback;
};

/** Finds a plan's file by slug: the active index first, then the plan directory. */
const findPlanFile = async (planStore: PlanStore, dirs: Dirs, slug: string): Promise<string> => {
  const active = `${dirs.activeDir}${slug}.md`;
  const held = await planStore.readText(active);
  if (held.ok && held.value !== null) return active;
  const listed = await planStore.listDir(dirs.planDir);
  const hit = (listed.ok ? listed.value : []).filter((name) => name === `${slug}.md` || (/^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(11) === `${slug}.md`)).sort()[0];
  return hit === undefined ? '' : `${dirs.planDir}${hit}`;
};

/** Every dated sprint file under the sprint directory, read whole. */
const readSprintFiles = async (planStore: PlanStore, sprintDir: string): Promise<SprintFile[]> => {
  const listed = await planStore.listDir(sprintDir);
  const names = (listed.ok ? listed.value : []).filter((name) => name.endsWith('.md'));
  const files: SprintFile[] = [];
  for (const name of names) {
    const file = `${sprintDir}${name}`;
    const read = await planStore.readText(file);
    if (read.ok && read.value !== null) files.push({ file, content: read.value });
  }
  return files;
};

/** Finds the target sprint's file among the readings, by its slug. */
const sprintFileFor = (sprint: string, files: readonly SprintFile[]): SprintFile | undefined =>
  files.find((f) => slugOf('sprint', f.file) === sprint);

/**
 * Parses argv, reads the plan and sprint files, and performs the write.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where step and summary lines go.
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
    if (parsed === '__help__') {
      write(`${USAGE}\n`);
      return 0;
    }
    warn(`plot-sprint-member: ${parsed}\n`);
    return 1;
  }

  // Sprint scope is a person's decision — the same refusal `needs-design.ts:329`
  // carries, and no flag lifts it.
  if (process.env.PLOT_UNATTENDED === '1') {
    warn(`unattended\ta person moves a plan into, out of, or around a sprint, and this process runs under PLOT_UNATTENDED=1. Run '${parsed.verb}' from a session or the board.\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-sprint-member: not a git repository — run this from inside the checkout, or 'git init' one here\n");
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    planStore: planStoreShell(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };

  try {
    return await perform(ctx, parsed, write, warn);
  } catch (err) {
    if (err instanceof NamedRefusal) {
      warn(`${err.reason}\t${err.message}\n`);
      return 1;
    }
    if (err instanceof Refused) {
      warn(`plot-sprint-member: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

/** The write itself; a `Refused` thrown here becomes a refusal on stderr. */
const perform = async (ctx: Context, args: Args, write: Printer, _warn: Printer): Promise<number> => {
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
    sprintDir: await configured(ctx.scripts, 'Sprint directory', 'docs/sprints/'),
  };

  const planLink = await findPlanFile(ctx.planStore, dirs, args.slug);
  if (planLink === '') {
    throw new NamedRefusal('plan-not-found', `no plan file for '${args.slug}' in this checkout. This writer never checks out or writes another branch. Nothing was written.`);
  }
  const planFile = realPlanPath(ctx.repoRoot, planLink) ?? planLink;
  const planRead = await ctx.planStore.readText(planFile);
  if (!planRead.ok || planRead.value === null) {
    throw new NamedRefusal('plan-not-found', `${planFile} could not be read. Nothing was written.`);
  }
  const planText = planRead.value;

  const sprintFiles = await readSprintFiles(ctx.planStore, dirs.sprintDir);
  const target = sprintFileFor(args.sprint, sprintFiles);
  if (target === undefined) {
    throw new NamedRefusal('sprint-not-found', `no sprint file for '${args.sprint}' under ${dirs.sprintDir}. Nothing was written.`);
  }
  const otherSprints = sprintFiles.filter((f) => f.file !== target.file);

  const memberCtx: SprintMemberContext = {
    sprint: args.sprint,
    slug: args.slug,
    otherSprints,
    date: localDate(),
    reason: args.reason,
  };

  let result: SprintMemberResult;
  if (args.verb === 'add') {
    result = addSprintMember(target.content, planText, args.tier as SprintMemberTier, memberCtx);
  } else if (args.verb === 'defer') {
    result = deferSprintMember(target.content, planText, memberCtx);
  } else {
    result = removeSprintMember(target.content, planText, memberCtx);
  }

  if (result.outcome === 'refused') {
    throw new NamedRefusal(result.reason, result.detail);
  }
  if (result.outcome === 'noop') {
    write(`noop: '${args.slug}' already matches this ${args.verb} in '${args.sprint}'\n`);
    write('summary: outcome=noop commit=skipped\n');
    return 0;
  }

  // The Trees port has no pathspec commit: `commitStaged` commits the whole
  // index. A commit run therefore refuses before it writes when the index
  // already holds other staged paths, so they never land in this commit.
  if (args.commit) {
    const pending = await ctx.trees.hasStagedChanges(ctx.repoRoot);
    if (!pending.ok || pending.value) {
      throw new NamedRefusal('staged-elsewhere', 'the index already holds staged changes, and this commit would carry them. Commit or unstage them, or re-run with --no-commit. Nothing was written.');
    }
  }

  // No partial write: the plan is written first; on the sprint write's
  // failure the plan is restored from the text it was read with, and the
  // writer refuses — never a commit of only half the change.
  const planWritten = await ctx.planStore.writeText(planFile, result.planText);
  if (!planWritten.ok) {
    throw new NamedRefusal('write-failed', `could not write ${planFile}. Nothing was written. Check the file's permissions, then re-run this.`);
  }
  const sprintWritten = await ctx.planStore.writeText(target.file, result.sprintText);
  if (!sprintWritten.ok) {
    const restored = await ctx.planStore.writeText(planFile, planText);
    const restoredNote = restored.ok ? 'the plan has been restored' : 'the plan could NOT be restored — check it by hand';
    throw new NamedRefusal('write-failed', `could not write ${target.file}. ${restoredNote}. Re-run once the sprint file is writable.`);
  }

  const staged = await ctx.trees.stage(ctx.repoRoot, [planFile, target.file]);
  if (!staged.ok) {
    throw new NamedRefusal('stage-failed', `both files are written but could not be staged. See what git refused: git -C ${ctx.repoRoot} status. Stage them by hand, or restore them with git checkout.`);
  }
  write(`wrote: '${args.slug}' ${args.verb} in '${args.sprint}'\n`);

  if (!args.commit) {
    write('summary: outcome=write commit=skipped\n');
    return 0;
  }

  const preposition = args.verb === 'add' ? 'to' : 'from';
  const message = `plot: ${args.verb} ${args.slug} ${preposition} ${args.sprint}`;
  const committed = await ctx.trees.commitStaged(ctx.repoRoot, message);
  if (!committed.ok) {
    throw new NamedRefusal('commit-failed', `could not commit the ${args.verb}.\n  See what git refused: git -C ${ctx.repoRoot} status. The files are staged; re-run after fixing it, or commit by hand.`);
  }
  write('summary: outcome=write commit=done\n');
  return 0;
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

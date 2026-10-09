// THROUGH THE NARROW PATHS, not the package roots — this bundle is the first
// to assemble a full adapter set (refs, host, plan-store, scripts, trees) and
// act as a CLI in its own right, so pulling in the package root would bundle
// every entity and rule Plot has.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { prIndexFile } from '@plot-pm/domain/adapters/pr-index/pr-index-file';
import type { Host, PlanStore, Refs, Scripts, Trees } from '@plot-pm/domain';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import {
  deliver,
  isRefusal,
  release,
  type TransitionPlan,
} from '@plot-pm/domain/transitions/plan';
import { releaseTag } from '@plot-pm/domain/rules/release-tag';
import { flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { tickSprintItem } from '@plot-pm/domain/rules/sprint-tick';
import { indexSymlinkPlacement } from '@plot-pm/domain/rules/index-symlink';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { deliverabilityOf, type DeliverabilityPorts } from '../controllers/deliverability.js';
import {
  commitAndPush,
  localDate,
  realPlanPath,
  recordStateReceipt,
  Refused,
  spendActionReceipt,
  unlinkSyncSafe,
  type Printer,
} from './ladder.js';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-deliver.sh` now launches, once per plan
 * delivered (or released).
 *
 * ```
 * plot-deliver.mjs [--dry-run] [--who <name>] <slug>
 * plot-deliver.mjs --release <version> <slug>
 * ```
 *
 * **IT PERFORMS WHAT THE SCRIPT USED TO PERFORM**, not a reading for a script
 * to act on — the first entry under this directory to do so. Every prior
 * bundle took readings on stdin and printed a decision; this one creates a
 * booking worktree, writes the plan, commits, pushes, and falls back to a
 * micro-PR, because the layering rule's target is a command an agent runs
 * directly, with shell reduced to a launcher.
 *
 * **ONE IMPLEMENTATION, TWO ENTRANCES**, exactly as the script's own header
 * said: `/plot-deliver` keeps the judgement — the completeness check, the
 * partial-deliverable question — and this performs the writes.
 *
 * **IT IS IDEMPOTENT, because one step cannot be undone.** The push is
 * irreversible; everything before it is local. Re-running is the repair for
 * every interruption, and this asks the SOURCE it would have written — the
 * plan file, the index directories, the sprint file — whether it is already
 * done, never a progress file of its own.
 *
 * **THE RELEASE ARM is a separate path**, taken over before any deliver-only
 * refusal reads `phase`. It shares plan lookup with the deliver arm and
 * nothing past that: releasing moves no symlink and ticks no sprint item.
 */

/** What the command line asked for. */
interface Args {
  dryRun: boolean;
  who: string;
  releaseVersion: string;
  slug: string;
}

/** Parses argv the way the shell's `while [ $# -gt 0 ]` loop did. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let dryRun = false;
  let who = '';
  let releaseVersion = '';
  let slug = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--who') {
      who = argv[++i];
      if (who === undefined) return '--who needs a value';
    } else if (arg === '--release') {
      releaseVersion = argv[++i];
      if (releaseVersion === undefined) return '--release needs a version';
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '') {
    return 'need a plan slug (usage: plot-deliver.mjs [--dry-run] <slug>; or --release <version> <slug>)';
  }
  return { dryRun, who, releaseVersion, slug };
};

/** Where the ports and scripts this entry needs live. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  refs: Refs;
  host: Host;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
  prIndex: PrIndexStore;
}

/**
 * Builds a `TransitionPlan` by asking `plot-plan-meta.sh` — the ONE parser
 * that owns the plan format, which reads `State:` and `Phase:` alike and
 * resolves front matter against a `## Status` block the way #933 settled.
 *
 * NEVER A REGEX OVER THE FILE'S OWN TEXT. A hand-rolled `- **State:**` match
 * reads only that spelling, misses `- **Phase:**` plans written before the
 * 2026-09-07 rename, and cannot see a plan's front matter at all — three
 * divergences from the parser the shell always asked instead.
 *
 * @param slug - the plan's slug, carried onto the result rather than read from the file.
 * @param path - the plan file to parse, absolute or repository-relative to `planStore`'s root.
 * @returns the transition plan, or a failure when the file does not parse.
 */
const transitionPlanOf = async (
  planStore: PlanStore,
  slug: string,
  path: string,
): Promise<TransitionPlan | null> => {
  const read = await planStore.readPlan(path);
  if (!read.ok) return null;
  return {
    slug,
    phase: read.value.phase as TransitionPlan['phase'],
    review: 'pr',
    approvedRecord: read.value.approvedRaw,
    deliveredRecord: read.value.deliveredRaw,
    releasedRecord: read.value.releasedRaw,
  };
};

/**
 * Finds a plan's file by slug, the way the shell's glob did: `<planDir>*<slug>.md`,
 * then `<activeDir><slug>.md`, then `<deliveredDir><slug>.md`.
 *
 * @returns the path relative to the repository root, or `''` where none exist.
 */
const findPlanFile = (
  repoRoot: string,
  planDir: string,
  activeDir: string,
  deliveredDir: string,
  slug: string,
): string => {
  const dir = path.join(repoRoot, planDir);
  if (existsSync(dir)) {
    const hit = readdirSync(dir).find((name) => name.endsWith(`${slug}.md`));
    if (hit !== undefined) return path.join(planDir, hit);
  }
  for (const candidate of [path.join(activeDir, `${slug}.md`), path.join(deliveredDir, `${slug}.md`)]) {
    if (existsSync(path.join(repoRoot, candidate))) return candidate;
  }
  return '';
};

/** `git` run in the repository, discarding nothing from the caller. */
const runGit = async (args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('git', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: (err as { code?: number } | null)?.code ?? (err ? 1 : 0), stdout, stderr });
    });
  });
};

/**
 * Resolves the default branch the way the shell did: the local `origin/HEAD`
 * symbolic ref first, then `plot-host.sh default-branch`, then `'main'`.
 *
 * NOT {@link Refs.defaultBranch} — that port method falls back to
 * `git rev-parse --abbrev-ref HEAD`, which answers the CALLER's current branch
 * rather than the repository's default, a different fallback from the one this
 * script has always used.
 */
const resolveMain = async (repoRoot: string, scripts: Scripts): Promise<string> => {
  const local = await runGit(['-C', repoRoot, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const trimmed = local.stdout.trim().replace(/^origin\//, '');
  if (local.code === 0 && trimmed !== '') return trimmed;
  const hosted = await scripts.host(['default-branch']);
  const hostedTrimmed = hosted.ok ? hosted.value.trim() : '';
  return hostedTrimmed !== '' ? hostedTrimmed : 'main';
};

/**
 * Runs the deliver arm.
 *
 * @returns the process exit code.
 */
const runDeliver = async (
  ctx: Context,
  args: Args,
  planFile: string,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const absPlanFile = path.join(ctx.repoRoot, planFile);
  const plan = await transitionPlanOf(ctx.planStore, args.slug, absPlanFile);
  if (plan === null) {
    throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`);
  }
  const parsedPlan = await ctx.planStore.readPlan(planFile);
  const sprint = parsedPlan.ok ? parsedPlan.value.sprint : '';

  switch (plan.phase) {
    case 'approved':
    case 'delivered':
      break;
    case 'released':
      warn(`plot-deliver: plan '${args.slug}' is already released — nothing to deliver.\n  Nothing to do here; the work shipped.\n`);
      return 1;
    case 'draft':
    case 'design':
      warn(`plot-deliver: plan '${args.slug}' is still '${plan.phase}' — approve it first: /plot-approve ${args.slug}\n`);
      return 1;
    case 'none':
      warn(`plot-deliver: cannot read the phase of '${args.slug}' (${planFile}) — refusing rather than guessing.\n  Its '## Status' section needs a line reading '- **State:** Approved'.\n`);
      return 1;
    default:
      warn(`plot-deliver: plan '${args.slug}' is in phase '${plan.phase}' — only an Approved plan can be delivered.\n  If that phase is wrong, correct the 'State:' line in ${planFile} and push it.\n`);
      return 1;
  }

  const deliverability = await deliverabilityOf(
    {
      planStore: ctx.planStore,
      host: ctx.host,
      refs: ctx.refs,
      prIndex: ctx.prIndex,
    } satisfies DeliverabilityPorts,
    args.slug,
    planFile,
  );
  if (!deliverability.deliverable) {
    warn(`plot-deliver: ${deliverability.refusal}\n`);
    return 1;
  }
  if (deliverability.emptySlices.length > 0) {
    write('note: this plan\'s merged PR carried no implementation on:\n');
    for (const b of deliverability.emptySlices) write(`  - ${b}\n`);
    write('  check whether its work landed under another PR, mark it deferred\n  (<!-- deferred: <reason> -->), or re-open it. Delivery continues.\n');
  }
  const deferredSuffix = deliverability.deferred > 0 ? `, ${deliverability.deferred} deferred` : '';
  if (deliverability.merged === 0 && deliverability.deferred === 0) {
    write('step: no branches found in plan — proceeding (nothing to verify)\n');
  } else {
    write(`step: verified ${deliverability.merged} branch(es) merged${deferredSuffix}\n`);
  }

  const main = await resolveMain(ctx.repoRoot, ctx.scripts);
  const who = args.who || process.env.PLOT_DELIVER_WHO || (await gitUserName(ctx.repoRoot));
  const today = localDate();

  if (args.dryRun) {
    write(`step: would flip Phase → Delivered and fill Delivered: ${today}\n`);
    write('step: would move active/ → delivered/ symlink\n');
    write(`step: would tick the sprint item${sprint !== '' ? ` (sprint: ${sprint})` : ''}\n`);
    write('summary: phase=would record=would index=would sprint=would push=would\n');
    return 0;
  }

  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${ctx.repoRoot}).\n  Move the plan under the plan directory inside this checkout and re-run.`);
  }
  const planBasename = path.basename(rel);

  const [activeDirCfg, deliveredDirCfg, sprintDirCfg] = await Promise.all([
    ctx.scripts.config('Active index', 'docs/plans/active/'),
    ctx.scripts.config('Delivered index', 'docs/plans/delivered/'),
    ctx.scripts.config('Sprint directory', 'docs/sprints/'),
  ]);
  const activeDir = activeDirCfg.ok ? activeDirCfg.value.trim() : 'docs/plans/active/';
  const deliveredDir = deliveredDirCfg.ok ? deliveredDirCfg.value.trim() : 'docs/plans/delivered/';
  const sprintDir = sprintDirCfg.ok ? sprintDirCfg.value.trim() : 'docs/sprints/';

  await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', main]);

  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });

  const bookbr = `plot/deliver-${args.slug}`;
  const tmpwt = path.join(wtRoot, `.plot-deliver-${args.slug}.${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }

  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  try {
    const target = path.join(tmpwt, rel);
    if (!existsSync(target)) {
      warn(`plot-deliver: ${rel} is not present in ${tmpwt}\n`);
      await cleanup();
      return 1;
    }

    const fileContent = readFileSync(target, 'utf8');
    const scratchPlan = await transitionPlanOf(ctx.planStore, args.slug, target);
    if (scratchPlan === null) {
      warn(`plot-deliver: cannot parse ${target} — refusing rather than guessing.\n`);
      await cleanup();
      return 1;
    }
    const decision = deliver(scratchPlan, { on: today });
    if (isRefusal(decision)) {
      warn(`plot-deliver: ${decision.detail}\n`);
      await cleanup();
      return 1;
    }

    let phaseReport: string;
    let recordReport: string;
    if (decision.alreadyRecorded) {
      phaseReport = 'already';
      recordReport = 'already';
    } else {
      const recorded = scratchPlan.deliveredRecord.trim() !== '';
      const flip = flipStatusValue(fileContent, 'approved', 'Delivered');
      let landed: string;
      if (recorded) {
        landed = flip.content;
        recordReport = 'already';
      } else {
        const inserted = insertStatusRecord(flip.content, 'Delivered', decision.record);
        if (!inserted.changed) {
          warn(`plot-deliver: ${rel} has no '## Status' section — nowhere to record the delivery.\n  Nothing was written: the phase is not flipped either, because a phase\n  with no record is invisible to the scan. Fix the section and re-run.\n`);
          await cleanup();
          return 1;
        }
        landed = inserted.content;
        recordReport = 'written';
      }
      // Would the parser read this phase out of the file we are about to land?
      // Written to a scratch path ALONGSIDE the real one and parsed there,
      // never at `target` itself — landing it first and re-reading would be
      // too late: a refusal here must leave the plan byte-identical.
      const scratchPath = `${target}.plot-reread`;
      writeFileSync(scratchPath, landed);
      const reread = await transitionPlanOf(ctx.planStore, args.slug, scratchPath);
      unlinkSyncSafe(scratchPath);
      if (reread === null || reread.phase !== 'delivered') {
        const got = reread === null ? 'none' : reread.phase;
        warn(`plot-deliver: ${rel} — wrote phase 'delivered', but the parser still reads '${got}'.\n  The write landed and the parser reads something else, so the delivery\n  would have reported a success it did not achieve.\n  Nothing was written — the plan is unchanged. Check what the plan says\n  its phase is, and where: a plan stating it in two places reports the\n  '## Status' block, which is the field every lifecycle script writes.\n`);
        await cleanup();
        return 1;
      }
      writeFileSync(target, landed);
      phaseReport = flip.changed ? 'flipped' : 'already';
      recordStateReceipt(ctx.repoRoot, rel, 'Delivered');
    }

    // Move the index symlink.
    const placement = indexSymlinkPlacement({ activeDir, deliveredDir, slug: args.slug, planBasename });
    const deliveredLinkAbs = path.join(tmpwt, placement.deliveredLink);
    mkdirSync(path.dirname(deliveredLinkAbs), { recursive: true });
    let indexReport: string;
    if (existsSync(deliveredLinkAbs) || isSymlinkTo(deliveredLinkAbs)) {
      indexReport = 'already';
      await runGit(['-C', tmpwt, 'rm', '-q', '--ignore-unmatch', placement.activeLink]);
    } else {
      try {
        symlinkSync(placement.target, deliveredLinkAbs);
        await runGit(['-C', tmpwt, 'rm', '-q', '--ignore-unmatch', placement.activeLink]);
        indexReport = 'moved';
      } catch {
        indexReport = 'skipped';
      }
    }

    // Tick the sprint item.
    const sprintReport = await tickSprint(tmpwt, sprintDir, args.slug, sprint);

    for (const p of [rel, activeDir, deliveredDir, ...(sprintReport === 'updated' ? [sprintDir] : [])]) {
      await ctx.trees.stage(tmpwt, [p]);
    }

    // THE BOOKED PLAN, KEPT FOR THE TRACKER. The booking worktree is removed
    // on every exit below, and the caller's working tree may still read
    // 'Approved'; the issue status is decided from the file that reached the
    // default branch.
    const bookedPlan = readFileSync(target, 'utf8');
    const bookedPlanFile = path.join(os.tmpdir(), `plot-deliver-plan-${process.pid}.md`);
    writeFileSync(bookedPlanFile, bookedPlan);

    const pushResult = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: deliver ${args.slug}`,
      `plot: deliver ${args.slug}`,
      `Records the delivery of \`${args.slug}\`.`,
      'delivery',
      `nothing to commit — the delivery is already recorded on ${main}`,
      write,
    );

    if ('rejected' in pushResult) {
      warn(`plot-deliver: the delivery is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
      // The branch STAYS — only the worktree is removed, matching the shell's
      // `git worktree remove --force "$tmpwt"` with no `branch -D` beside it.
      await runGit(['-C', ctx.repoRoot, 'worktree', 'remove', '--force', tmpwt]);
      unlinkSyncSafe(bookedPlanFile);
      write(`summary: phase=${phaseReport} record=${recordReport} index=${indexReport} sprint=${sprintReport} push=rejected tracker=skipped\n`);
      return 1;
    }
    await cleanup();

    const tracker = await ctx.scripts.awaited('plot-issue-status.sh', [bookedPlanFile]);
    for (const line of tracker.stdout.split('\n')) {
      if (line.length > 0 && !line.startsWith('summary: ')) write(`  tracker: ${line}\n`);
    }
    let trackerReport = 'failed';
    for (const line of tracker.stdout.split('\n')) {
      const match = line.match(/^summary: tracker=([a-z-]*)/);
      if (match) trackerReport = match[1];
    }
    unlinkSyncSafe(bookedPlanFile);

    write(`summary: phase=${phaseReport} record=${recordReport} index=${indexReport} sprint=${sprintReport} push=${pushResult.pushed} tracker=${trackerReport}\n`);
    spendActionReceipt(ctx.repoRoot, 'deliver');
    return 0;
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-deliver: ${err.message}\n`);
      await cleanup();
      return 1;
    }
    throw err;
  }
};

/** Whether a path is a symlink, without following it. */
const isSymlinkTo = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Ticks a plan's sprint item by searching the sprint directory for the line naming it. */
const tickSprint = async (root: string, sprintDir: string, slug: string, sprint: string): Promise<string> => {
  // Matches the shell's own first guard: a plan that names no sprint owes no
  // tick, and the directory is never even looked at.
  if (sprint === '') return 'none';
  const dir = path.join(root, sprintDir);
  if (!existsSync(dir)) return 'missing';
  const files = readdirSync(dir).filter((n) => n.endsWith('.md'));
  for (const name of files) {
    const file = path.join(dir, name);
    const content = readFileSync(file, 'utf8');
    if (!content.includes(`[${slug}]`)) continue;
    const result = tickSprintItem(content, slug);
    if (!result.changed) return 'already';
    writeFileSync(file, result.content);
    return 'updated';
  }
  return 'missing';
};

/** `git config user.name`, falling back to `'plot'`. */
const gitUserName = async (repoRoot: string): Promise<string> => {
  const run = await runGit(['-C', repoRoot, 'config', 'user.name']);
  const name = run.stdout.trim();
  return run.code === 0 && name !== '' ? name : 'plot';
};

/**
 * Reads the whole plan tree, the branch and the config, and prints the answer.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where step/summary lines go.
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
    if (parsed === '__help__') return 0;
    warn(`plot-deliver: ${parsed}\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn('plot-deliver: not a git repository — run this from inside the checkout, or \'git init\' one here\n');
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    refs: refsGit(context),
    host: hostShell(context),
    planStore: planStoreShell(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
    prIndex: prIndexFile({ cwd: repoRoot }),
  };

  const [planDirCfg, activeDirCfg, deliveredDirCfg] = await Promise.all([
    ctx.scripts.config('Plan directory', 'docs/plans/'),
    ctx.scripts.config('Active index', 'docs/plans/active/'),
    ctx.scripts.config('Delivered index', 'docs/plans/delivered/'),
  ]);
  const planDir = planDirCfg.ok ? planDirCfg.value.trim() : 'docs/plans/';
  const activeDir = activeDirCfg.ok ? activeDirCfg.value.trim() : 'docs/plans/active/';
  const deliveredDir = deliveredDirCfg.ok ? deliveredDirCfg.value.trim() : 'docs/plans/delivered/';

  const planFile = findPlanFile(repoRoot, planDir, activeDir, deliveredDir, parsed.slug);
  if (planFile === '') {
    warn(`plot-deliver: no plan found for '${parsed.slug}' — looked in ${planDir}, ${activeDir}, ${deliveredDir}.\n  Check the slug: ls ${planDir} | grep -i '${parsed.slug}'\n`);
    return 1;
  }

  try {
    if (parsed.releaseVersion !== '') {
      return await runRelease(ctx, parsed, planFile, write, warn);
    }
    return await runDeliver(ctx, parsed, planFile, write, warn);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-deliver: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

/** Runs the release arm. */
const runRelease = async (
  ctx: Context,
  args: Args,
  planFile: string,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  const absPlanFile = path.join(ctx.repoRoot, planFile);
  const plan = await transitionPlanOf(ctx.planStore, args.slug, absPlanFile);
  if (plan === null) {
    throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`);
  }
  // `.prs[-1]`, read through the ONE parser that owns the plan format — never
  // a regex over the raw text, which cannot tell a branch's `→ #N` annotation
  // from a PR number mentioned in prose elsewhere in the file.
  const parsed = await ctx.planStore.readPlan(planFile);
  const lastPr =
    parsed.ok && parsed.value.prs.length > 0 ? String(parsed.value.prs[parsed.value.prs.length - 1]) : '';

  switch (plan.phase) {
    case 'delivered':
    case 'released':
      break;
    case 'approved':
      warn(`plot-deliver: plan '${args.slug}' is still 'approved' — deliver it first: plot-deliver.sh ${args.slug}\n`);
      return 1;
    case 'draft':
    case 'design':
      warn(`plot-deliver: plan '${args.slug}' is still '${plan.phase}' — deliver it first: plot-deliver.sh ${args.slug}\n`);
      return 1;
    case 'none':
      warn(`plot-deliver: cannot read the phase of '${args.slug}' (${planFile}) — refusing rather than guessing.\n`);
      return 1;
    default:
      warn(`plot-deliver: plan '${args.slug}' is in phase '${plan.phase}' — only a Delivered plan can be released.\n`);
      return 1;
  }

  const main = await resolveMain(ctx.repoRoot, ctx.scripts);

  if (lastPr === '') {
    throw new Refused(`plan '${args.slug}' names no '→ #N' annotation — the version cannot be resolved from a merge commit that does not exist.\n  Nothing was written. Annotate the branch that shipped this plan, then re-run.`);
  }
  const prState = await ctx.host.prState(Number(lastPr));
  const mergeCommit = prState.ok && prState.value !== null ? prState.value.mergeCommit : '';
  if (mergeCommit === '') {
    throw new Refused(`plan '${args.slug}''s last PR (#${lastPr}) carries no mergeCommit — it may not have merged, or the host could not answer.\n  Nothing was written. Verify #${lastPr} merged, then re-run.`);
  }

  const tagsResult = await ctx.refs.tagsContaining(mergeCommit);
  const containingTags = tagsResult.ok ? tagsResult.value : [];
  const resolved = releaseTag({ lastPr, mergeCommit, containingTags, wantedVersion: args.releaseVersion });
  if (resolved.outcome === 'refused') {
    throw new Refused(`plan '${args.slug}' ${resolved.detail}\n  Nothing was written.`);
  }

  const tagDateResult = await ctx.refs.tagDate(resolved.tag);
  if (!tagDateResult.ok) {
    throw new Refused(`could not read the date of tag '${resolved.tag}' — refusing rather than guessing.\n  Nothing was written.`);
  }
  const tagDate = tagDateResult.value;
  const who = args.who || process.env.PLOT_DELIVER_WHO || (await gitUserName(ctx.repoRoot));

  if (args.dryRun) {
    write(`step: plan ${planFile} — phase=${plan.phase} released_raw=${plan.releasedRecord || '<empty>'}\n`);
    write(`step: would flip State → Released and fill Released: ${tagDate}, ${resolved.tag}\n`);
    write('summary: phase=would record=would index=skipped sprint=none push=would tracker=skipped\n');
    return 0;
  }

  write(`step: plan ${planFile} — phase=${plan.phase} PR #${lastPr} merged ${mergeCommit}, shipped in ${resolved.tag} (${tagDate})\n`);

  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${ctx.repoRoot}).\n  Move the plan under the plan directory inside this checkout and re-run.`);
  }

  await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', main]);
  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  const bookbr = `plot/release-${args.slug}`;
  const tmpwt = path.join(wtRoot, `.plot-release-${args.slug}.${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  const target = path.join(tmpwt, rel);
  if (!existsSync(target)) {
    await cleanup();
    throw new Refused(`${rel} is not present in ${tmpwt}`);
  }
  const fileContent = readFileSync(target, 'utf8');
  const scratchPlan = await transitionPlanOf(ctx.planStore, args.slug, target);
  if (scratchPlan === null) {
    warn(`plot-deliver: cannot parse ${target} — refusing rather than guessing.\n`);
    await cleanup();
    return 1;
  }
  const decision = release(scratchPlan, { on: tagDate, version: resolved.tag });
  if (isRefusal(decision)) {
    warn(`plot-deliver: ${decision.detail}\n`);
    await cleanup();
    return 1;
  }

  let phaseReport: string;
  let recordReport: string;
  if (decision.alreadyRecorded) {
    phaseReport = 'already';
    recordReport = 'already';
  } else {
    const recorded = scratchPlan.releasedRecord.trim() !== '';
    const flip = flipStatusValue(fileContent, 'delivered', 'Released');
    let landed: string;
    if (recorded) {
      landed = flip.content;
      recordReport = 'already';
    } else {
      const inserted = insertStatusRecord(flip.content, 'Released', decision.record);
      if (!inserted.changed) {
        warn(`plot-deliver: ${rel} has no '## Status' section — nowhere to record the release.\n  Nothing was written: the phase is not flipped either, because a phase\n  with no record is invisible to the scan. Fix the section and re-run.\n`);
        await cleanup();
        return 1;
      }
      landed = inserted.content;
      recordReport = 'written';
    }
    writeFileSync(target, landed);
    phaseReport = flip.changed ? 'flipped' : 'already';
    recordStateReceipt(ctx.repoRoot, rel, 'Released');
  }

  await ctx.trees.stage(tmpwt, [rel]);

  const pushResult = await commitAndPush(
    ctx,
    tmpwt,
    bookbr,
    main,
    who,
    `plot: release ${args.slug} (${resolved.tag})`,
    `plot: release ${args.slug} (${resolved.tag})`,
    `Records the release of \`${args.slug}\` in ${resolved.tag}.`,
    'release',
    `nothing to commit — the release is already recorded on ${main}`,
    write,
  );
  if ('rejected' in pushResult) {
    warn(`plot-deliver: the release is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
    // The branch STAYS — only the worktree is removed, matching the deliver arm.
    await runGit(['-C', ctx.repoRoot, 'worktree', 'remove', '--force', tmpwt]);
    write(`summary: phase=${phaseReport} record=${recordReport} index=skipped sprint=none push=rejected tracker=skipped\n`);
    return 1;
  }
  await cleanup();

  write(`summary: phase=${phaseReport} record=${recordReport} index=skipped sprint=none push=${pushResult.pushed} tracker=skipped\n`);
  spendActionReceipt(ctx.repoRoot, 'release');
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: `/tmp` is a symlink on macOS.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

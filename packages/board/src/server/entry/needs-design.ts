import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host, PlanStore, Refs, Scripts, Trees } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import {
  planNeedsDesign,
  specOf,
  type NeedsDesignDetail,
  type NeedsDesignReadings,
} from '@plot-pm/domain/workflows/needs-design';
import { withPhase, withRecord, withSection } from '@plot-pm/domain/workflows/rendering';
import type { Write } from '@plot-pm/domain/workflows/decision';
import { isPlanFile, planPrsCarrying, type OpenPr } from '@plot-pm/domain/rules/plan-pr';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import {
  commitAndPush,
  localDate,
  realPlanPath,
  recordStateReceipt,
  Refused,
  unlinkSyncSafe,
  type Printer,
} from './ladder.js';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point that moves a Draft plan to Design.
 *
 * ```
 * plot-needs-design.mjs [--who <name>] [--channel board|cli] <slug>
 * ```
 *
 * Writes `State: Design`, the dated `Design:` record and an empty `## Spec`
 * section, in the checkout the domain's write target names: the open plan PR's
 * head branch, the caller's checkout under `Impl: same branch`, or a booking
 * worktree on `plot/needs-design-<slug>` pushed to the default branch. After the
 * plan write it leaves the state receipt `plot-state-gate.sh` reads.
 *
 * `--channel` names the channel the `Design:` record carries: the board's route
 * passes `board`, and a person's direct run records the default, `cli`.
 *
 * A person makes this move. The entry refuses under `PLOT_UNATTENDED=1` before
 * it reads anything, and no flag lifts that refusal.
 *
 * Exit 0 when the plan is in Design, whether this run wrote it or not. Exit 1 on
 * a refusal or a failure, with the reason on stderr.
 */

/** The usage block `-h` prints. */
const USAGE = [
  '# Plot helper: move a Draft plan to Design.',
  '# Usage: plot-needs-design.mjs [--who <name>] [--channel board|cli] <slug>',
  '#   --who       the name recorded in the `Design:` line (default: git user.name)',
  '#   --channel   the channel recorded in the `Design:` line (default: cli)',
  '#   <slug>      the plan to move',
  '# Output: one `step:` line per step, then a machine-countable summary:',
  '#             summary: target=plan-pr phase=flipped record=written push=clean',
  '#         Exit 0 when the plan is in Design; 1 on a refusal or a failure, with',
  '#         the reason on stderr.',
  '#',
].join('\n');

/** What the command line asked for. */
interface Args {
  who: string;
  slug: string;
  channel: 'board' | 'cli';
}

/** Parses argv; returns the message to refuse with, or `__help__`. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let who = '';
  let slug = '';
  let channel: Args['channel'] = 'cli';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--who') {
      who = argv[++i] ?? '';
      if (who.startsWith('-')) return `--who takes a name, not the flag '${who}'`;
    } else if (arg === '--channel') {
      const named = argv[++i] ?? '';
      if (named !== 'board' && named !== 'cli') return `--channel takes 'board' or 'cli', not '${named}'`;
      channel = named;
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '') return 'need a plan slug (usage: plot-needs-design.mjs [--who <name>] [--channel board|cli] <slug>)';
  return { who, slug, channel };
};

/** The ports and paths this entry needs. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  host: Host;
  planStore: PlanStore;
  refs: Refs;
  scripts: Scripts;
  trees: Trees;
}

/** The directories the move reads, as `## Plot Config` names them. */
interface Dirs {
  planDir: string;
  activeDir: string;
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
  const hit = (listed.ok ? listed.value : []).filter((name) => name.endsWith(`${slug}.md`)).sort()[0];
  return hit === undefined ? '' : `${dirs.planDir}${hit}`;
};

/** The default branch: the local `origin/HEAD`, then the host, then `main`. */
const resolveMain = async (repoRoot: string, trees: Trees, scripts: Scripts): Promise<string> => {
  const local = await trees.originHead(repoRoot);
  if (local.ok && local.value.trim() !== '') return local.value.trim();
  const hosted = await scripts.host(['default-branch']);
  const named = hosted.ok ? hosted.value.trim() : '';
  return named !== '' ? named : 'main';
};

/** A parsed plan with the text it was parsed from. */
interface PlanReading {
  plan: PlanRecord;
  text: string;
}

/** Parses a plan read from a revision, through a private scratch directory. */
const readPlanAt = async (ctx: Context, ref: string, file: string): Promise<PlanReading | undefined> => {
  const shown = await ctx.refs.showFile(ref, file);
  if (!shown.ok) return undefined;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'plot-needs-design-plan-'));
  try {
    const scratch = path.join(dir, path.basename(file));
    const written = await ctx.planStore.writeText(scratch, shown.value);
    if (!written.ok) return undefined;
    const read = await ctx.planStore.readPlan(scratch);
    return read.ok ? { plan: read.value, text: shown.value } : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Whether git holds a commit. */
const holdsCommit = async (ctx: Context, sha: string): Promise<boolean> =>
  sha !== '' && (await ctx.refs.resolve(`${sha}^{commit}`)).ok;

/** The words a host refusal printed, or the adapter's default sentence. */
const hostSaid = (ctx: Context): string => {
  const said = ctx.host.lastRefusal()?.said ?? '';
  return said !== '' ? said : 'The host adapter gave no reason.';
};

/** How many open PRs the lookup lists at most. */
const PRS_LISTED = 100;

/**
 * The open PRs, each with the paths its head changes against its merge base.
 *
 * @throws Refused where the host cannot list its open PRs.
 */
const openPrsOf = async (ctx: Context): Promise<OpenPr[]> => {
  const listed = await ctx.host.prList('open', PRS_LISTED);
  if (!listed.ok) {
    throw new Refused(`the host could not list its open PRs to find the plan PR (plot-host.sh pr-list refused the call).\n  ${hostSaid(ctx)}\n  The plan is unchanged. Re-run once the host answers.`);
  }
  const own = listed.value.filter((pr) => pr.repo === '' && pr.head !== '' && (pr.headSha ?? '') !== '');
  const missing: string[] = [];
  for (const pr of own) {
    if (!(await holdsCommit(ctx, pr.headSha ?? ''))) missing.push(pr.head);
  }
  if (missing.length > 0) await ctx.trees.fetch(ctx.repoRoot, missing);
  const open: OpenPr[] = [];
  for (const pr of own) {
    const headSha = pr.headSha ?? '';
    if (!(await holdsCommit(ctx, headSha))) continue;
    const changed = await ctx.refs.changedFiles(headSha);
    if (!changed.ok) continue;
    open.push({ number: pr.number, head: pr.head, draft: pr.draft, headSha, changed: changed.value });
  }
  return open;
};

/** The plan files directly under the plan directory at one revision. */
const planFilesAt = async (ctx: Context, dirs: Dirs, ref: string): Promise<string[]> => {
  const listed = await ctx.refs.listBlobs(ref, dirs.planDir);
  if (!listed.ok) return [];
  return listed.value
    .filter((blob) => blob.mode !== '120000' && isPlanFile(dirs.planDir, blob.path))
    .map((blob) => blob.path);
};

/** What the host says about the PR carrying the plan. */
interface PlanPr {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED' | 'NONE';
  head: string;
}

/**
 * Finds the plan PR: `idea/<slug>` first, then the first open PR that changes
 * the plan file.
 *
 * @throws Refused where the host cannot answer.
 */
const planPrOf = async (ctx: Context, dirs: Dirs, slug: string, open?: readonly OpenPr[]): Promise<PlanPr> => {
  const branch = `idea/${slug}`;
  const lookup = await ctx.host.prState(branch);
  if (!lookup.ok) {
    throw new Refused(`the host could not be asked for the PR of '${branch}' (plot-host.sh pr-state refused the call).\n  ${hostSaid(ctx)}\n  The plan is unchanged. Re-run once the host answers.`);
  }
  const named = lookup.value;
  if (named !== null && named.state === 'OPEN') return { number: named.number, state: 'OPEN', head: branch };
  const [first] = planPrsCarrying(slug, dirs.planDir, open ?? (await openPrsOf(ctx)));
  if (first !== undefined) return { number: first.pr.number, state: 'OPEN', head: first.pr.head };
  if (named !== null && (named.state === 'CLOSED' || named.state === 'MERGED')) {
    return { number: named.number, state: named.state, head: branch };
  }
  return { number: 0, state: 'NONE', head: '' };
};

/** The decision's plan edits, applied to one text. */
const applyPlanWrites = (text: string, writes: readonly Write[]): { text: string; phase: boolean; record: boolean } => {
  let next = text;
  let phase = false;
  let record = false;
  for (const write of writes) {
    if (write.kind === 'plan-phase') {
      const flipped = withPhase(next, write.phase);
      next = flipped.text;
      phase = flipped.wrote;
    } else if (write.kind === 'plan-record') {
      const filled = withRecord(next, write.field, write.value);
      next = filled.text;
      record = filled.wrote;
    } else if (write.kind === 'plan-section') {
      next = withSection(next, write.heading, write.body);
    }
  }
  return { text: next, phase, record };
};

/**
 * Applies the decision's plan edits to `rel` inside `root`.
 *
 * Both edits run on a copy, the result is parsed at a scratch path, and the
 * plan is replaced only when that parse reads `design`; a refusal leaves the
 * file byte-identical. The state receipt follows the write, in the caller's
 * checkout.
 *
 * @throws Refused where the file is absent, has no `## Status` section, or the
 *   parser does not read the written state.
 */
const writePlan = async (
  ctx: Context,
  root: string,
  rel: string,
  writes: readonly Write[],
): Promise<void> => {
  const target = path.join(root, rel);
  const present = await ctx.planStore.readText(target);
  if (!present.ok || present.value === null) throw new Refused(`${rel} is not present in ${root}`);
  const edited = applyPlanWrites(present.value, writes);
  if (!edited.phase || !edited.record) {
    throw new Refused(`${rel} has no '## Status' section with a State line — nowhere to record the move.\n  Nothing was written. Fix the section and re-run.`);
  }
  const scratchPath = `${target}.plot-reread`;
  const scratched = await ctx.planStore.writeText(scratchPath, edited.text);
  if (!scratched.ok) throw new Refused(`could not write ${scratchPath} to check the parser's reading.\n  Nothing was written to the plan.`);
  const reread = await ctx.planStore.readPlan(scratchPath);
  unlinkSyncSafe(scratchPath);
  const got = reread.ok ? reread.value.phase : 'none';
  if (got !== 'design') {
    throw new Refused(`${rel} — wrote state 'design', but the parser still reads '${got}'.\n  Nothing was written — the plan is unchanged.`);
  }
  const written = await ctx.planStore.writeText(target, edited.text);
  if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Check the file's permissions, then re-run this.`);
  recordStateReceipt(ctx.repoRoot, rel, 'Design');
};

/**
 * Parses argv, reads the plan and its PR, and moves the plan to Design.
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
    warn(`plot-needs-design: ${parsed}\n`);
    return 1;
  }

  // D3 gives this move to a person. `process.env` is the process's own, never a
  // caller's field, and no flag lifts the refusal.
  if (process.env.PLOT_UNATTENDED === '1') {
    warn(`plot-needs-design: a person moves a plan to Design, and this process runs under PLOT_UNATTENDED=1.\n  Refusing: the fleet never decides this. Move '${parsed.slug}' from a session or the board.\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-needs-design: not a git repository — run this from inside the checkout, or 'git init' one here\n");
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    host: hostShell(context),
    planStore: planStoreShell(context),
    refs: refsGit(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };

  try {
    return await perform(ctx, parsed, write, warn);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-needs-design: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

/** The move itself; a `Refused` thrown here becomes a refusal on stderr. */
const perform = async (ctx: Context, args: Args, write: Printer, _warn: Printer): Promise<number> => {
  const { slug } = args;
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
  };
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);

  // A plan on an unmerged plan PR is absent from the default branch's checkout,
  // which is where the board runs this: read it from the default branch as
  // fetched, or from the head of the open PR that changes it.
  let planFile = await findPlanFile(ctx.planStore, dirs, slug);
  let plan: PlanRecord | undefined;
  let planText = '';
  let listedOpen: readonly OpenPr[] | undefined;
  if (planFile !== '') {
    const read = await ctx.planStore.readPlan(planFile);
    plan = read.ok ? read.value : undefined;
    const held = await ctx.planStore.readText(planFile);
    planText = held.ok && held.value !== null ? held.value : '';
  } else {
    await ctx.trees.fetch(ctx.repoRoot, main);
    const onMain = (await planFilesAt(ctx, dirs, `origin/${main}`)).find((file) => file.endsWith(`${slug}.md`));
    if (onMain !== undefined) {
      planFile = onMain;
      const read = await readPlanAt(ctx, `origin/${main}`, onMain);
      plan = read?.plan;
      planText = read?.text ?? '';
      write(`step: plan ${planFile} is not in this checkout — read it from origin/${main}\n`);
    } else {
      listedOpen = await openPrsOf(ctx);
      const [first] = planPrsCarrying(slug, dirs.planDir, listedOpen);
      if (first !== undefined) {
        planFile = first.file;
        const read = await readPlanAt(ctx, first.pr.headSha, first.file);
        plan = read?.plan;
        planText = read?.text ?? '';
        write(`step: plan ${planFile} is not in this checkout — read it from PR #${first.pr.number} (${first.pr.head})\n`);
      }
    }
  }

  const review = plan?.review ?? '';
  const impl = plan?.impl ?? '';
  const asksPr = review === 'pr' || review === 'none' || review === 'NONE' || review === '';
  let pr: PlanPr = { number: 0, state: 'NONE', head: '' };
  if (plan !== undefined && asksPr && impl !== 'same-branch') {
    pr = await planPrOf(ctx, dirs, slug, listedOpen);
  }

  const readings: NeedsDesignReadings = {
    slug,
    file: planFile,
    parsed: plan !== undefined,
    phase: plan?.phase ?? '',
    review: review === 'none' ? 'NONE' : review,
    impl,
    spec: specOf(planText),
    pr,
  };
  const today = localDate();
  const userName = await ctx.trees.userName(ctx.repoRoot);
  const who = args.who.trim() || (userName.ok ? userName.value.trim() : '');
  const verdict = planNeedsDesign(readings, { on: today, who, channel: args.channel });
  if (verdict.outcome === 'refused') {
    throw new Refused(`${verdict.detail}\n  Nothing was written; the plan is unchanged.`);
  }
  const detail: NeedsDesignDetail = verdict.detail;
  write(`step: plan ${planFile} — phase=${readings.phase} review=${review} impl=${impl} target=${detail.target}\n`);

  const rel = realPlanPath(ctx.repoRoot, planFile) ?? planFile;
  const message = `plot: move ${slug} to design`;

  if (detail.target === 'caller-checkout') {
    await writePlan(ctx, ctx.repoRoot, rel, verdict.writes);
    await ctx.trees.stage(ctx.repoRoot, [rel]);
    const committed = await ctx.trees.commitStaged(ctx.repoRoot, message);
    if (!committed.ok) {
      throw new Refused(`could not commit the move.\n  See what git refused: git -C ${ctx.repoRoot} status. Then re-run this.`);
    }
    write('step: recorded in this checkout — push it with the implementation\n');
    write(`summary: target=${detail.target} phase=flipped record=written push=local\n`);
    return 0;
  }

  const mainRootRead = await ctx.trees.mainRoot(ctx.repoRoot);
  const mainRoot = mainRootRead.ok ? mainRootRead.value : ctx.repoRoot;
  const deskReading = { configured: await configured(ctx.scripts, 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);
  const tmpwt = path.join(deskRoot(deskReading), `.plot-needs-design-${slug}.${process.pid}`);

  if (detail.target === 'plan-pr') {
    return bookOnPlanPr(ctx, { tmpwt, rel, head: detail.branch, writes: verdict.writes, who, message }, write);
  }

  await ctx.trees.fetch(ctx.repoRoot, main);
  const added = await ctx.trees.addBranch(tmpwt, detail.branch, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${detail.branch}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  let keepBranch = false;
  try {
    const reapply = async (wt: string): Promise<void> => {
      await writePlan(ctx, wt, rel, verdict.writes);
      await ctx.trees.stage(wt, [rel]);
    };
    await reapply(tmpwt);
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      detail.branch,
      main,
      who,
      message,
      'design move',
      `nothing to commit — ${slug} is already in Design on ${main}`,
      reapply,
      write,
    );
    if ('rejected' in landed) {
      keepBranch = true;
      await ctx.trees.removeOnly(tmpwt);
      throw new Refused(`the move is committed on '${detail.branch}' but could not reach ${main}.\n  Land '${detail.branch}' by hand, or re-run this command once the push works.`);
    }
    write(`summary: target=${detail.target} phase=flipped record=written push=${landed.pushed}\n`);
    return 0;
  } finally {
    if (!keepBranch) await ctx.trees.removeWithBranch(tmpwt, detail.branch);
  }
};

/**
 * Commits the move onto the plan PR's head branch and pushes that branch.
 *
 * A local branch of the head's name is reset onto `origin/<head>` by the
 * worktree add, so one that differs from the remote refuses first: its commits
 * are not this command's to discard.
 */
const bookOnPlanPr = async (
  ctx: Context,
  flow: { tmpwt: string; rel: string; head: string; writes: readonly Write[]; who: string; message: string },
  write: Printer,
): Promise<number> => {
  const { tmpwt, head } = flow;
  await ctx.trees.fetch(ctx.repoRoot, head);
  const remote = await ctx.refs.resolve(`refs/remotes/origin/${head}`);
  if (!remote.ok) throw new Refused(`origin/${head} is not fetched — cannot write onto the plan PR's branch.\n  Nothing was written.`);
  const local = await ctx.refs.resolve(`refs/heads/${head}`);
  const hadLocal = local.ok;
  if (local.ok && local.value !== remote.value) {
    throw new Refused(`the local branch '${head}' differs from origin/${head}.\n  Push or discard its commits first, then re-run; this command does not reset a branch holding work.\n  Nothing was written.`);
  }
  const added = await ctx.trees.addBranch(tmpwt, head, `origin/${head}`);
  if (!added.ok) {
    throw new Refused(`could not check out '${head}' at ${tmpwt}.\n  Most often the branch is checked out in another worktree: git worktree list\n  Nothing has been written; the plan is untouched.`);
  }
  try {
    await writePlan(ctx, tmpwt, flow.rel, flow.writes);
    await ctx.trees.stage(tmpwt, [flow.rel]);
    const staged = await ctx.trees.hasStagedChanges(tmpwt);
    if (staged.ok && !staged.value) {
      write(`step: nothing to commit — ${flow.rel} already records the move\n`);
      write('summary: target=plan-pr phase=already record=already push=nothing-to-commit\n');
      return 0;
    }
    const committed = await ctx.trees.commitAs(tmpwt, flow.who, flow.message);
    if (!committed.ok) {
      throw new Refused(`could not commit the move.\n  See what git refused: git -C ${tmpwt} status\n  Nothing was pushed; re-run this.`);
    }
    const pushed = await ctx.trees.push(tmpwt, head);
    if (!pushed.ok) {
      throw new Refused(`the move is committed on '${head}' but the push was rejected.\n  Pull the branch and re-run once the push works.`);
    }
    write(`step: pushed ${head}\n`);
    write('summary: target=plan-pr phase=flipped record=written push=clean\n');
    return 0;
  } finally {
    if (hadLocal) await ctx.trees.removeOnly(tmpwt);
    else await ctx.trees.removeWithBranch(tmpwt, head);
  }
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

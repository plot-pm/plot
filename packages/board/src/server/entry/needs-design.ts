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
import { isPlanFile, namesPlan, type PlanPrRefusal } from '@plot-pm/domain/rules/plan-pr';
import { choosePlanPr, unreadPrsLine, type UnreadPr } from './open-prs.js';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import {
  commitAndPush, cutBooking,
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
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

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
export interface Args {
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
export interface Context {
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
  const hit = (listed.ok ? listed.value : []).filter((name) => namesPlan(slug, name)).sort()[0];
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

/** The words a host refusal printed, or the adapter's default sentence. */
const hostSaid = (ctx: Context): string => {
  const said = ctx.host.lastRefusal()?.said ?? '';
  return said !== '' ? said : 'The host adapter gave no reason.';
};

/** The refusal this entry throws when `pr-list` cannot list the open PRs. */
const refuseOpenList = (ctx: Context): Refused =>
  new Refused(`the host could not list its open PRs to find the plan PR (plot-host.sh pr-list refused the call).\n  ${hostSaid(ctx)}\n  The plan is unchanged. Re-run once the host answers.`);

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

/** Resolves a plan file's git blob ID at a revision; `''` where git cannot read it. */
const blobAt = async (ctx: Context, sha: string, file: string): Promise<string> => {
  const resolved = await ctx.refs.resolve(`${sha}:${file}`);
  return resolved.ok ? resolved.value : '';
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
export const perform = async (ctx: Context, args: Args, write: Printer, _warn: Printer): Promise<number> => {
  const { slug } = args;
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
  };
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);

  // A plan on an unmerged plan PR is absent from the default branch's checkout,
  // which is where the board runs this: read it from the default branch as
  // fetched, or from the head of the plan PR `choosePlanPr` names.
  let planFile = await findPlanFile(ctx.planStore, dirs, slug);
  const inCheckout = planFile !== '';
  let plan: PlanRecord | undefined;
  let planText = '';
  let unreadOpen: readonly UnreadPr[] = [];
  if (inCheckout) {
    const read = await ctx.planStore.readPlan(planFile);
    plan = read.ok ? read.value : undefined;
    const held = await ctx.planStore.readText(planFile);
    planText = held.ok && held.value !== null ? held.value : '';
  }

  const review = plan?.review ?? '';
  const impl = plan?.impl ?? '';
  const asksPr = review === 'pr' || review === 'none' || review === 'NONE' || review === '';
  let pr: PlanPr = { number: 0, state: 'NONE', head: '' };
  let prRoute: 'named' | 'open' | 'merged' | undefined;
  let prBlob = '';
  let prRivals: readonly { number: number; file: string; blob: string }[] = [];
  let prRefused: PlanPrRefusal['reason'] | undefined;
  let copies: { checkout: string; head: string } | undefined;
  let prHeadSha = '';

  if ((plan === undefined || asksPr) && impl !== 'same-branch') {
    await ctx.trees.fetch(ctx.repoRoot, main);
    const realFile = inCheckout ? realPlanPath(ctx.repoRoot, planFile) ?? planFile : '';
    const onMain = inCheckout
      ? (await planFilesAt(ctx, dirs, `origin/${main}`)).includes(realFile)
      : (await planFilesAt(ctx, dirs, `origin/${main}`)).some((f) => namesPlan(slug, f));
    const found = await choosePlanPr(
      ctx,
      { slug, planDir: dirs.planDir, onMain },
      main,
      realFile,
      (unread) => { unreadOpen = unread; },
      () => refuseOpenList(ctx),
    );
    if (found !== undefined && found.outcome === 'refused') {
      prRefused = found.reason;
      pr = { number: found.number, state: 'OPEN', head: '' };
    } else if (found !== undefined) {
      pr = { number: found.number, state: found.state, head: found.branch };
      prRoute = found.route;
      const readFile = found.read.at === 'head'
        ? found.read.file
        : realFile || (await planFilesAt(ctx, dirs, `origin/${main}`)).find((f) => namesPlan(slug, f)) || '';
      const readSha = found.read.at === 'head' ? found.read.sha : `origin/${main}`;
      if (found.read.at === 'head') prHeadSha = found.read.sha;
      prBlob = await blobAt(ctx, readSha, readFile);
      prRivals = await Promise.all(
        found.rivals.map(async (rival) => ({ number: rival.number, file: rival.file, blob: await blobAt(ctx, rival.sha, rival.file) })),
      );
      if (!inCheckout) {
        const read = await readPlanAt(ctx, readSha, readFile);
        plan = read?.plan;
        planFile = readFile;
        planText = read?.text ?? '';
        write(
          found.read.at === 'head'
            ? `step: plan ${readFile} is not in this checkout — read it from PR #${found.number} (${found.branch})\n`
            : `step: plan ${readFile} is not in this checkout — read it from origin/${main}\n`,
        );
      } else if (found.read.at === 'head') {
        const checkoutText = await ctx.planStore.readText(path.join(ctx.repoRoot, realFile));
        const headShown = await ctx.refs.showFile(readSha, readFile);
        if (checkoutText.ok && checkoutText.value !== null && headShown.ok) {
          copies = { checkout: checkoutText.value, head: headShown.value };
        }
      }
    } else if (!inCheckout && onMain) {
      // No PR carries the plan at all — it reached the default branch by a
      // direct push or a squash merge `planPrOf` cannot trace to a PR. It is
      // still read, from `origin/<main>`, with no PR to write onto.
      const readFile = (await planFilesAt(ctx, dirs, `origin/${main}`)).find((f) => namesPlan(slug, f)) ?? '';
      const read = await readPlanAt(ctx, `origin/${main}`, readFile);
      plan = read?.plan;
      planFile = readFile;
      planText = read?.text ?? '';
      write(`step: plan ${readFile} is not in this checkout — read it from origin/${main}\n`);
    }
  }

  const readings: NeedsDesignReadings = {
    slug,
    file: planFile,
    parsed: plan !== undefined,
    phase: plan?.phase ?? '',
    review: (plan?.review ?? review) === 'none' ? 'NONE' : (plan?.review ?? review),
    impl: plan?.impl ?? impl,
    spec: specOf(planText),
    pr: {
      number: pr.number,
      state: pr.state,
      head: pr.head,
      rivals: prRivals,
      ...(prRoute === undefined ? {} : { route: prRoute }),
      ...(prBlob === '' ? {} : { blob: prBlob }),
      ...(prRefused === undefined ? {} : { refused: prRefused }),
      ...(copies === undefined ? {} : { copies }),
    },
  };
  const today = localDate();
  const userName = await ctx.trees.userName(ctx.repoRoot);
  const who = args.who.trim() || (userName.ok ? userName.value.trim() : '');
  const verdict = planNeedsDesign(readings, { on: today, who, channel: args.channel });
  if (verdict.outcome === 'refused') {
    const unread = verdict.reason === 'plan-not-found' ? unreadPrsLine(unreadOpen) : '';
    const detail = unread === '' ? verdict.detail : `${verdict.detail}\n  ${unread}`;
    throw new Refused(`${detail}\n  Nothing was written; the plan is unchanged.`);
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
    return bookOnPlanPr(ctx, { tmpwt, rel, head: detail.branch, readSha: prHeadSha, writes: verdict.writes, who, message }, write);
  }

  await ctx.trees.fetch(ctx.repoRoot, main);
  const added = await cutBooking(ctx, tmpwt, detail.branch, main, 'add');
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
 * are not this command's to discard. Where the record was read at the PR's own
 * head, a fresh fetch that resolves `origin/<head>` to a different sha means a
 * push landed between that read and this write — the copy judged above may no
 * longer be what the PR carries, so this refuses rather than writing onto it.
 */
const bookOnPlanPr = async (
  ctx: Context,
  flow: { tmpwt: string; rel: string; head: string; readSha: string; writes: readonly Write[]; who: string; message: string },
  write: Printer,
): Promise<number> => {
  const { tmpwt, head } = flow;
  await ctx.trees.fetch(ctx.repoRoot, head);
  const remote = await ctx.refs.resolve(`refs/remotes/origin/${head}`);
  if (!remote.ok) throw new Refused(`origin/${head} is not fetched — cannot write onto the plan PR's branch.\n  Nothing was written.`);
  if (flow.readSha !== '' && remote.value !== flow.readSha) {
    throw new Refused(`origin/${head} moved since the plan was read. Nothing was written; re-run.`);
  }
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
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

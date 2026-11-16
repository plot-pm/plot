// THE SUPERSESSION, SHARED by `plot-supersede.mjs` (`supersede.ts`) and the
// board's `POST /api/supersede` route. It holds no program guard, so the board
// bundle can import it without starting the command.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell, statusField } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { PlanStore, Refs, Scripts, Trees } from '@plot-pm/domain';
import { isRefusal, supersede, type RefusalReason, type TransitionPlan } from '@plot-pm/domain/transitions/plan';
import { successorPreconditions, supersessionRefusalReason, type SuccessorRefusal } from '@plot-pm/domain/rules/supersede-successor';
import { flipFrontMatterPhase, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { withPhase } from '@plot-pm/domain/workflows/rendering';
import { indexSymlinkPlacement } from '@plot-pm/domain/rules/index-symlink';
import { isPlanFile, namesPlan } from '@plot-pm/domain/rules/plan-pr';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import {
  commitAndPush, cutBooking,
  localDate,
  moveIndexLink,
  realPlanPath,
  recordStateReceipt,
  Refused,
  unlinkSyncSafe,
  type PushLock,
  type Printer,
} from './ladder.js';
import path from 'node:path';

/** What a supersession is asked to do. */
export interface SupersedeArgs {
  /** The name the booking commit carries; `''` reads git `user.name`. */
  who: string;
  /** The successor's slug. */
  by: string;
  /** The plan to supersede. */
  slug: string;
}

/** The ports and paths a supersession needs. */
export interface Context {
  repoRoot: string;
  scriptDir: string;
  planStore: PlanStore;
  refs: Refs;
  scripts: Scripts;
  trees: Trees;
  /** Sleeps between push attempts; the ladder's jittered wait where absent. */
  retryWait?: () => Promise<void>;
  /** The default-branch push lock; the ladder's real lock where absent. */
  lock?: PushLock;
}

/**
 * The real adapters for a repository.
 *
 * @param repoRoot - the repository root.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @returns the context `supersedePlan` takes.
 */
export const supersessionContext = (repoRoot: string, scriptDir: string): Context => {
  const context = { repoRoot, scriptDir };
  return {
    repoRoot,
    scriptDir,
    planStore: planStoreShell(context),
    refs: refsGit(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };
};

/**
 * Why a supersession refused: `unattended`, `plan-not-found`,
 * `plan-unreadable`, a successor refusal, a domain refusal from `supersede`,
 * `push-rejected`, or `failed` for a write or booking step that did not complete.
 */
export type SupersedeRefusalReason =
  | 'unattended'
  | 'plan-not-found'
  | 'plan-unreadable'
  | SuccessorRefusal
  | RefusalReason
  | 'push-rejected'
  | 'failed';

/** What a supersession did. */
export type SupersedeOutcome =
  | { outcome: 'superseded'; summary: string }
  | { outcome: 'refused'; reason: SupersedeRefusalReason; detail: string };

/** The directories the move reads, as `## Plot Config` names them. */
interface Dirs {
  planDir: string;
  activeDir: string;
  deliveredDir: string;
}

/** A refusal with its reason, thrown inside {@link supersedePlan}. */
class Refusal extends Refused {
  constructor(readonly reason: SupersedeRefusalReason, message: string) {
    super(message);
  }
}

/** Reads one config key, falling back where the read fails. */
const configured = async (scripts: Scripts, key: string, fallback: string): Promise<string> => {
  const read = await scripts.config(key, fallback);
  return read.ok ? read.value.trim() : fallback;
};

/**
 * Finds a plan's file by slug under `root`: the plan directory, then the
 * active index, then the delivered index.
 *
 * @returns the path relative to `root`, or `''` where none exists.
 */
const findPlanFile = async (planStore: PlanStore, root: string, dirs: Dirs, slug: string): Promise<string> => {
  const listed = await planStore.listDir(path.join(root, dirs.planDir));
  const hit = (listed.ok ? listed.value : []).filter((name) => namesPlan(slug, name)).sort()[0];
  if (hit !== undefined) return path.join(dirs.planDir, hit);
  for (const candidate of [path.join(dirs.activeDir, `${slug}.md`), path.join(dirs.deliveredDir, `${slug}.md`)]) {
    const held = await planStore.readText(path.join(root, candidate));
    if (held.ok && held.value !== null) return candidate;
  }
  return '';
};

/** The plan file carrying `slug` on `origin/<main>`, or `''`. */
const planFileOnMain = async (refs: Refs, main: string, dirs: Dirs, slug: string): Promise<string> => {
  const listed = await refs.listBlobs(`origin/${main}`, dirs.planDir);
  if (!listed.ok) return '';
  return listed.value.find((blob) => blob.mode !== '120000' && isPlanFile(dirs.planDir, blob.path) && namesPlan(slug, blob.path))?.path ?? '';
};

/** The default branch: the local `origin/HEAD`, then the host, then `main`. */
const resolveMain = async (repoRoot: string, trees: Trees, scripts: Scripts): Promise<string> => {
  const local = await trees.originHead(repoRoot);
  if (local.ok && local.value.trim() !== '') return local.value.trim();
  const hosted = await scripts.host(['default-branch']);
  const named = hosted.ok ? hosted.value.trim() : '';
  return named !== '' ? named : 'main';
};

/**
 * Reads a plan into the `TransitionPlan` `supersede` takes, with its
 * `Superseded:` record.
 *
 * @param planStore - the store that parses the file through `plot-plan-meta.sh`.
 * @param slug - the plan's slug, carried onto the result.
 * @param file - the plan file, absolute.
 * @returns the plan and the text it was read from, or `null` where the file is
 *   absent or does not parse.
 */
const supersedablePlanOf = async (
  planStore: PlanStore,
  slug: string,
  file: string,
): Promise<{ plan: TransitionPlan; text: string } | null> => {
  const held = await planStore.readText(file);
  if (!held.ok || held.value === null) return null;
  const read = await planStore.readPlan(file);
  if (!read.ok) return null;
  return {
    text: held.value,
    plan: {
      slug,
      phase: read.value.phase as TransitionPlan['phase'],
      review: read.value.review,
      approvedRecord: read.value.approvedRaw,
      deliveredRecord: read.value.deliveredRaw,
      releasedRecord: read.value.releasedRaw,
      rejectedRecord: read.value.rejectedRaw,
      supersededRecord: statusField(held.value, 'Superseded'),
    },
  };
};

/** What one supersession write did, in the words the summary line prints. */
export interface SupersessionReport {
  phase: 'flipped' | 'already';
  record: 'written' | 'already';
  index: 'moved' | 'already' | 'skipped';
}

/** Where a supersession is written and what it records. */
export interface SupersessionBooking {
  /** The plan file, repository-relative. */
  rel: string;
  slug: string;
  by: string;
  /** The date the `Superseded:` record carries, `YYYY-MM-DD`. */
  today: string;
  dirs: Dirs;
  /** The successor's plan file found outside the booking worktree, or `''`. */
  successorElsewhere: string;
}

/**
 * Decides and writes a supersession inside the booking worktree `wt`, from the
 * plan text `wt` holds now, and stages it.
 *
 * Flips `State:` to Superseded and inserts the `Superseded:` record, parses the
 * result at a scratch path and writes the plan only when the parser reads
 * `superseded`, leaves the state receipt in the main repository, and moves the
 * index link from the active to the delivered index. A plan that already holds
 * the supersession writes nothing to the plan.
 *
 * @param ctx - the plan store, the trees port, and the main repository that
 *   receives the state receipt.
 * @param wt - the booking worktree, absolute.
 * @param booking - the plan, the successor, the date and the configured directories.
 * @returns the report; or `refused` with its reason and the sentence to print,
 *   in which case the plan is unchanged.
 * @throws Refused where a file write fails.
 */
export const bookSupersession = async (
  ctx: Pick<Context, 'repoRoot' | 'planStore' | 'trees'>,
  wt: string,
  booking: SupersessionBooking,
): Promise<SupersessionReport | { refused: string; reason: SupersedeRefusalReason }> => {
  const { rel, slug, by, dirs } = booking;
  const target = path.join(wt, rel);
  const read = await supersedablePlanOf(ctx.planStore, slug, target);
  if (read === null) {
    return { reason: 'plan-unreadable', refused: `${rel} is not present in ${wt}, or does not parse — refusing rather than guessing.` };
  }

  const successorHere = await findPlanFile(ctx.planStore, wt, dirs, by);
  const preconditions = successorPreconditions({ slug, by, successorFile: successorHere || booking.successorElsewhere });
  const decision = supersede(read.plan, { on: booking.today, by, preconditions });
  if (isRefusal(decision)) return { reason: supersessionRefusalReason(decision, preconditions), refused: decision.detail };

  let phase: SupersessionReport['phase'] = 'already';
  let record: SupersessionReport['record'] = 'already';
  if (!decision.alreadyRecorded) {
    const flipped = withPhase(read.text, 'Superseded');
    const frontMatter = flipFrontMatterPhase(flipped.text, read.plan.phase, 'Superseded');
    let landed = frontMatter.content;
    if ((read.plan.supersededRecord ?? '') === '') {
      const inserted = insertStatusRecord(landed, decision.field, decision.record);
      if (!inserted.changed) {
        return {
          reason: 'plan-unreadable',
          refused: `${rel} has no '## Status' section — nowhere to record the supersession.\n  Nothing was written. Fix the section and re-run.`,
        };
      }
      landed = inserted.content;
      record = 'written';
    }
    // Parsed at a scratch path beside the plan, so a refusal leaves the plan byte-identical.
    const scratchPath = `${target}.plot-reread`;
    const scratched = await ctx.planStore.writeText(scratchPath, landed);
    if (!scratched.ok) throw new Refused(`could not write ${scratchPath} to check the parser's reading.\n  Nothing was written to the plan.`);
    const reread = await ctx.planStore.readPlan(scratchPath);
    unlinkSyncSafe(scratchPath);
    const got = reread.ok ? reread.value.phase : 'none';
    if (got !== 'superseded') {
      return {
        reason: 'plan-unreadable',
        refused: `${rel} — wrote state 'superseded', but the parser still reads '${got}'.\n  Nothing was written — the plan is unchanged. Check its '## Status' section for a 'State:' line.`,
      };
    }
    const written = await ctx.planStore.writeText(target, landed);
    if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Re-run this — it is idempotent.`);
    phase = flipped.wrote ? 'flipped' : 'already';
    recordStateReceipt(ctx.repoRoot, rel, 'Superseded');
  }

  const placement = indexSymlinkPlacement({
    activeDir: dirs.activeDir,
    deliveredDir: dirs.deliveredDir,
    slug,
    planBasename: path.basename(rel),
  });
  const index = await moveIndexLink(ctx.trees, wt, placement);
  await ctx.trees.stage(wt, [rel]);
  return { phase, record, index };
};

/**
 * Marks a plan Superseded by its successor and books it on the default branch.
 *
 * Refuses under `PLOT_UNATTENDED=1` before it reads anything. Decides once on
 * the caller's checkout, so a refusal or an already-superseded plan cuts no
 * booking worktree; then decides again inside the booking worktree and pushes.
 *
 * @param ctx - the ports and paths.
 * @param args - the plan, its successor and the committer's name.
 * @param write - where `step:` and `summary:` lines go.
 * @param env - the process environment; only `PLOT_UNATTENDED` is read.
 * @returns `superseded` with the summary line, or `refused` with its reason and detail.
 * @throws an error that is not a refusal, such as a failed process start.
 */
export const supersedePlan = async (
  ctx: Context,
  args: SupersedeArgs,
  write: Printer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupersedeOutcome> => {
  if (env.PLOT_UNATTENDED === '1') {
    return {
      outcome: 'refused',
      reason: 'unattended',
      detail: 'a person marks a plan Superseded, and this process runs under PLOT_UNATTENDED=1.\n  Refusing: the fleet never decides this. Run it from a session.',
    };
  }
  try {
    return await perform(ctx, args, write);
  } catch (err) {
    if (err instanceof Refusal) return { outcome: 'refused', reason: err.reason, detail: err.message };
    if (err instanceof Refused) return { outcome: 'refused', reason: 'failed', detail: err.message };
    throw err;
  }
};

/** The move itself; a `Refused` thrown here becomes a refusal. */
const perform = async (ctx: Context, args: SupersedeArgs, write: Printer): Promise<SupersedeOutcome> => {
  const { slug, by } = args;
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
    deliveredDir: await configured(ctx.scripts, 'Delivered index', 'docs/plans/delivered/'),
  };
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);
  await ctx.trees.fetch(ctx.repoRoot, main);

  const planFile = await findPlanFile(ctx.planStore, ctx.repoRoot, dirs, slug);
  if (planFile === '') {
    throw new Refusal('plan-not-found', `no plan found for '${slug}' — looked in ${dirs.planDir}, ${dirs.activeDir}, ${dirs.deliveredDir}.\n  Check the slug: ls ${dirs.planDir} | grep -i '${slug}'`);
  }
  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) throw new Refusal('plan-not-found', `${planFile} is outside the repository root (${ctx.repoRoot}).`);
  const successorElsewhere =
    (await findPlanFile(ctx.planStore, ctx.repoRoot, dirs, by)) || (await planFileOnMain(ctx.refs, main, dirs, by));

  const read = await supersedablePlanOf(ctx.planStore, slug, path.join(ctx.repoRoot, rel));
  if (read === null) {
    throw new Refusal('plan-unreadable', `cannot parse '${rel}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${rel}`);
  }
  const today = localDate();
  const preconditions = successorPreconditions({ slug, by, successorFile: successorElsewhere });
  const decision = supersede(read.plan, { on: today, by, preconditions });
  if (isRefusal(decision)) {
    throw new Refusal(supersessionRefusalReason(decision, preconditions), `${decision.detail}\n  Nothing was written; the plan is unchanged.`);
  }
  write(`step: plan ${rel} — phase=${read.plan.phase} successor=${by}\n`);
  if (decision.alreadyRecorded) {
    const summary = 'summary: phase=already record=already index=untouched push=none';
    write(`step: nothing to do — ${slug} is already Superseded (${decision.record})\n`);
    write(`${summary}\n`);
    return { outcome: 'superseded', summary };
  }

  const userName = await ctx.trees.userName(ctx.repoRoot);
  const who = args.who.trim() || (userName.ok ? userName.value.trim() : '') || 'plot';
  const mainRootRead = await ctx.trees.mainRoot(ctx.repoRoot);
  const mainRoot = mainRootRead.ok ? mainRootRead.value : ctx.repoRoot;
  const deskReading = { configured: await configured(ctx.scripts, 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);
  const tmpwt = path.join(deskRoot(deskReading), `.plot-supersede-${slug}.${process.pid}`);
  const bookbr = `plot/supersede-${slug}`;

  const added = await cutBooking(ctx, tmpwt, bookbr, main, 'add');
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  let keepBranch = false;
  try {
    const booking: SupersessionBooking = { rel, slug, by, today, dirs, successorElsewhere };
    const first = await bookSupersession(ctx, tmpwt, booking);
    if ('refused' in first) throw new Refusal(first.reason, `${first.refused}\n  Nothing was pushed.`);
    let report: SupersessionReport = first;
    const reapply = async (wt: string): Promise<void> => {
      const again = await bookSupersession(ctx, wt, booking);
      if ('refused' in again) throw new Refusal(again.reason, again.refused);
      report = again;
    };
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: supersede ${slug} by ${by}`,
      'supersession',
      `nothing to commit — ${slug} is already Superseded on ${main}`,
      reapply,
      write,
    );
    if ('rejected' in landed) {
      keepBranch = true;
      await ctx.trees.removeOnly(tmpwt);
      write(`summary: phase=${report.phase} record=${report.record} index=${report.index} push=rejected\n`);
      throw new Refusal('push-rejected', `the supersession is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.`);
    }
    const summary = `summary: phase=${report.phase} record=${report.record} index=${report.index} push=${landed.pushed}`;
    write(`${summary}\n`);
    return { outcome: 'superseded', summary };
  } finally {
    if (!keepBranch) await ctx.trees.removeWithBranch(tmpwt, bookbr);
  }
};

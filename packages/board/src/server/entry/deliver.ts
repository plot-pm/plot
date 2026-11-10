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
import { callerOf, type Caller, type Host, type PlanStore, type Refs, type Scripts, type Trees } from '@plot-pm/domain';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import {
  deliver,
  isRefusal,
  release,
  type TransitionPlan,
} from '@plot-pm/domain/transitions/plan';
import { releasePr, releaseTag, type ReleasePrRow } from '@plot-pm/domain/rules/release-tag';
import { branchClaims, DEFAULT_BRANCH_PREFIXES, parseBranchPrefixes } from '@plot-pm/domain/rules/cross-repo-reference';
import { normalizeVersion } from '@plot-pm/domain/entities/version';
import { flipFrontMatterPhase, flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { tickSprintItem } from '@plot-pm/domain/rules/sprint-tick';
import { sprintOfPlan, type SprintFile } from '@plot-pm/domain/rules/sprint-membership';
import { indexSymlinkPlacement } from '@plot-pm/domain/rules/index-symlink';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import { trackerReportOf } from '@plot-pm/domain/rules/issue-status';
import { deliverabilityOf, type DeliverabilityPorts } from '../controllers/deliverability.js';
import { tellTrackerAbout } from './release-tracker.js';
import {
  commitAndPush, cutBooking,
  localDate,
  realPlanPath,
  recordStateReceipt,
  Refused,
  spendActionReceipt,
  unlinkSyncSafe,
  type Printer,
} from './ladder.js';
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point `plot-deliver.sh` now launches, once per plan
 * delivered (or released).
 *
 * ```
 * plot-deliver.mjs [--dry-run] [--who <name>] [--branch <name>] <slug>
 * plot-deliver.mjs --release <version> <slug>
 * ```
 *
 * **IT PERFORMS WHAT THE SCRIPT USED TO PERFORM**, not a reading for a script
 * to act on — the first entry under this directory to do so. Every prior
 * bundle took readings on stdin and printed a decision; this one creates a
 * booking worktree, writes the plan, commits, pushes, and retries a rejected
 * push, because the layering rule's target is a command an agent runs
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
 *
 * **`--branch <name>`** reads the plan, the indexes and the sprint file from
 * `origin/<name>` and pushes the booking to `<name>` instead of the default
 * branch. The release arm does not take it.
 */

/** What the command line asked for. */
export interface Args {
  dryRun: boolean;
  who: string;
  releaseVersion: string;
  /** The branch the delivery is recorded on; `''` for the default branch. */
  branch: string;
  slug: string;
}

/** Parses argv the way the shell's `while [ $# -gt 0 ]` loop did. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let dryRun = false;
  let who = '';
  let releaseVersion = '';
  let branch = '';
  let slug = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--who') {
      who = argv[++i];
      if (who === undefined) return '--who needs a value';
      if (who.startsWith('-')) return `--who takes a name, not the flag '${who}'`;
    } else if (arg === '--release') {
      releaseVersion = argv[++i];
      if (releaseVersion === undefined) return '--release needs a version';
    } else if (arg === '--branch') {
      branch = argv[++i];
      if (branch === undefined || branch === '') return '--branch needs a branch name';
      if (branch.startsWith('-')) return `--branch takes a branch name, not the flag '${branch}'`;
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '') {
    return 'need a plan slug (usage: plot-deliver.mjs [--dry-run] [--branch <name>] <slug>; or --release <version> <slug>)';
  }
  if (branch !== '' && releaseVersion !== '') {
    return '--branch records a delivery only; a release books on the default branch, so --release does not take --branch';
  }
  return { dryRun, who, releaseVersion, branch, slug };
};

/** Where the ports and scripts this entry needs live. */
export interface Context {
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
const findPlanFile = async (
  planStore: PlanStore,
  planDir: string,
  activeDir: string,
  deliveredDir: string,
  slug: string,
): Promise<string> => {
  const listed = await planStore.listDir(planDir);
  const hit = (listed.ok ? listed.value : []).find((name) => name.endsWith(`${slug}.md`));
  if (hit !== undefined) return path.join(planDir, hit);
  for (const candidate of [path.join(activeDir, `${slug}.md`), path.join(deliveredDir, `${slug}.md`)]) {
    const held = await planStore.readText(candidate);
    if (held.ok && held.value !== null) return candidate;
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

/** The exit code `plot-state-sync.mjs` answers where no `State branch` key is declared. */
const NO_STATE_BRANCH = 4;

/**
 * Where a delivery's booking worktree goes, and the booking branch it holds.
 *
 * @returns `tmpwt`, absolute, under the configured `Worktree root`; and
 *   `bookbr`, `plot/deliver-<slug>`.
 */
const bookingPlace = async (ctx: Context, slug: string): Promise<{ tmpwt: string; bookbr: string }> => {
  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  return {
    tmpwt: path.join(wtRoot, `.plot-deliver-${slug}.${process.pid}`),
    bookbr: `plot/deliver-${slug}`,
  };
};

/**
 * The worktree `--branch` checks out detached at `origin/<target>` before the
 * plan is read, so the plan, the indexes and the sprint file are the branch's
 * copy. The booking branch is created in it only on the write path.
 */
export interface BranchCopy {
  /** The branch the delivery is read from and pushed to. */
  target: string;
  /** The worktree, absolute. */
  tmpwt: string;
  /** The booking branch `runDeliver` creates in `tmpwt` before it writes. */
  bookbr: string;
  /** A plan store rooted at `tmpwt`. */
  planStore: PlanStore;
  /**
   * False while `tmpwt` is detached and `run` removes it alone; true once
   * `runDeliver` has created `bookbr` in it and owns its removal.
   */
  handedOver: boolean;
}

/**
 * Fetches `origin/<target>` and checks it out, detached, in a new worktree.
 * No local branch is created or reset.
 *
 * @param ctx - the main repository and its ports.
 * @param target - the branch named by `--branch`.
 * @param slug - the plan's slug, which names the booking branch.
 * @returns the branch copy; or the refusal sentence where origin does not hold
 *   `target`, cannot be reached, or the worktree cannot be added. Nothing is
 *   written in that case.
 */
const prepareBranchCopy = async (ctx: Context, target: string, slug: string): Promise<BranchCopy | string> => {
  const listed = await runGit(['-C', ctx.repoRoot, 'ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${target}`]);
  if (listed.code === 2) {
    return `branch '${target}' does not exist on origin — nothing was written.\n  Check the name: git ls-remote --heads origin ${target}`;
  }
  if (listed.code !== 0) {
    return `could not ask origin for branch '${target}' — nothing was written.\n  Check the remote: git ls-remote --heads origin ${target}`;
  }
  const fetched = await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', target]);
  if (fetched.code !== 0) {
    return `could not fetch origin/${target} — nothing was written.\n  Check the remote: git fetch origin ${target}`;
  }
  const { tmpwt, bookbr } = await bookingPlace(ctx, slug);
  const added = await ctx.trees.add(tmpwt, `origin/${target}`);
  if (!added.ok) {
    return `could not check out origin/${target} in a worktree at ${tmpwt}.\n  Check: git worktree list\n  Nothing has been written; the plan is untouched.`;
  }
  return {
    target,
    tmpwt,
    bookbr,
    planStore: planStoreShell({ repoRoot: tmpwt, scriptDir: ctx.scriptDir }),
    handedOver: false,
  };
};

/** The ports one booking write needs. */
export interface BookingPorts {
  repoRoot: string;
  planStore: PlanStore;
  trees: Trees;
}

/** Where a delivery is written and what it records. */
export interface DeliveryBooking {
  /** The plan file, repository-relative. */
  rel: string;
  slug: string;
  /** The date the `Delivered:` record carries, `YYYY-MM-DD`. */
  today: string;
  activeDir: string;
  deliveredDir: string;
  sprintDir: string;
  /** The sprint the plan names; empty where it names none. */
  sprint: string;
}

/** What one delivery write did, in the words the summary line prints. */
export interface DeliveryReport {
  phase: string;
  record: string;
  index: string;
  sprint: string;
}

/**
 * Decides and writes a delivery inside the booking worktree `wt`, from the
 * plan text `wt` holds now, and stages it.
 *
 * Reads the plan, asks the domain's `deliver` transition, flips `State:` to
 * Delivered and inserts the `Delivered:` record, moves the index symlink from
 * the active to the delivered index, and ticks the sprint item. A plan that
 * already holds the delivery writes nothing to the plan. The caller runs this
 * once per push attempt, so a retry decides again from the text of the
 * re-fetched default branch rather than from an earlier read.
 *
 * @param ports - the plan store, the trees port, and the main repository
 *   that receives the state receipt.
 * @param wt - the booking worktree, absolute.
 * @param booking - the plan, the date, and the configured directories.
 * @returns the report; or `refused` with the sentence to print where the plan
 *   cannot be delivered from this text, in which case the plan is unchanged.
 * @throws Refused where a file write fails.
 */
export const bookDelivery = async (
  ports: BookingPorts,
  wt: string,
  booking: DeliveryBooking,
): Promise<DeliveryReport | { refused: string }> => {
  const { rel, slug, activeDir, deliveredDir, sprintDir } = booking;
  const target = path.join(wt, rel);
  const present = await ports.planStore.readText(target);
  if (!present.ok || present.value === null) return { refused: `${rel} is not present in ${wt}` };

  const fileContent = present.value;
  const scratchPlan = await transitionPlanOf(ports.planStore, slug, target);
  if (scratchPlan === null) return { refused: `cannot parse ${target} — refusing rather than guessing.` };
  const decision = deliver(scratchPlan, { on: booking.today });
  if (isRefusal(decision)) return { refused: decision.detail };

  let phase: string;
  let record: string;
  if (decision.alreadyRecorded) {
    phase = 'already';
    record = 'already';
  } else {
    const recorded = scratchPlan.deliveredRecord.trim() !== '';
    const flip = flipStatusValue(fileContent, 'approved', 'Delivered');
    const frontMatter = flipFrontMatterPhase(flip.content, 'approved', 'Delivered');
    let landed: string;
    if (recorded) {
      landed = frontMatter.content;
      record = 'already';
    } else {
      const inserted = insertStatusRecord(frontMatter.content, 'Delivered', decision.record);
      if (!inserted.changed) {
        return { refused: `${rel} has no '## Status' section — nowhere to record the delivery.\n  Nothing was written: the phase is not flipped either, because a phase\n  with no record is invisible to the scan. Fix the section and re-run.` };
      }
      landed = inserted.content;
      record = 'written';
    }
    // Would the parser read this phase out of the file we are about to land?
    // Written to a scratch path ALONGSIDE the real one and parsed there,
    // never at `target` itself — landing it first and re-reading would be
    // too late: a refusal here must leave the plan byte-identical.
    const scratchPath = `${target}.plot-reread`;
    const scratched = await ports.planStore.writeText(scratchPath, landed);
    if (!scratched.ok) throw new Refused(`could not write ${scratchPath} to check the parser's reading.\n  Nothing was written to the plan.`);
    const reread = await transitionPlanOf(ports.planStore, slug, scratchPath);
    unlinkSyncSafe(scratchPath);
    if (reread === null || reread.phase !== 'delivered') {
      const got = reread === null ? 'none' : reread.phase;
      return { refused: `${rel} — wrote phase 'delivered', but the parser still reads '${got}'.\n  The write landed and the parser reads something else, so the delivery\n  would have reported a success it did not achieve.\n  Nothing was written — the plan is unchanged. Check what the plan says\n  its phase is, and where: a plan stating it in two places reports the\n  '## Status' block, which is the field every lifecycle script writes.` };
    }
    const written = await ports.planStore.writeText(target, landed);
    if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Re-run this — it is idempotent.`);
    phase = flip.changed ? 'flipped' : 'already';
    recordStateReceipt(ports.repoRoot, rel, 'Delivered');
  }

  // Move the index symlink.
  const placement = indexSymlinkPlacement({ activeDir, deliveredDir, slug, planBasename: path.basename(rel) });
  const deliveredLinkAbs = path.join(wt, placement.deliveredLink);
  mkdirSync(path.dirname(deliveredLinkAbs), { recursive: true });
  let index: string;
  if (existsSync(deliveredLinkAbs) || isSymlinkTo(deliveredLinkAbs)) {
    index = 'already';
    await runGit(['-C', wt, 'rm', '-q', '--ignore-unmatch', placement.activeLink]);
  } else {
    try {
      symlinkSync(placement.target, deliveredLinkAbs);
      await runGit(['-C', wt, 'rm', '-q', '--ignore-unmatch', placement.activeLink]);
      index = 'moved';
    } catch {
      index = 'skipped';
    }
  }

  // Tick the sprint item.
  const ticked = await tickSprint(ports.planStore, wt, sprintDir, slug);

  for (const p of [rel, activeDir, deliveredDir, ...(ticked.file !== '' ? [ticked.file] : [])]) {
    await ports.trees.stage(wt, [p]);
  }
  return { phase, record, index, sprint: ticked.outcome };
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
  copy: BranchCopy | null = null,
): Promise<number> => {
  // With `--branch`, the plan is read from the booking worktree cut from
  // `origin/<target>`; otherwise from the caller's checkout.
  const store = copy?.planStore ?? ctx.planStore;
  const readRoot = copy?.tmpwt ?? ctx.repoRoot;
  const absPlanFile = path.join(readRoot, planFile);
  const plan = await transitionPlanOf(store, args.slug, absPlanFile);
  if (plan === null) {
    throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`);
  }
  const parsedPlan = await store.readPlan(planFile);
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

  // THE GATE READS `origin/<default>` for the commits a slice names, so the
  // remote-tracking ref is refreshed first: a commit pushed a moment ago reads
  // as missing from a stale one. A failed fetch changes nothing here: the gate
  // then answers from the ref it has, and a commit it cannot find keeps the
  // slice open.
  // `main` names the branch the delivery is recorded on: the default branch,
  // or the `--branch` target.
  const main = copy !== null ? copy.target : await resolveMain(ctx.repoRoot, ctx.scripts);
  await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', main]);
  const deliverability = await deliverabilityOf(
    {
      planStore: store,
      host: ctx.host,
      refs: ctx.refs,
      prIndex: ctx.prIndex,
      defaultBranch: main,
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

  const who = args.who || process.env.PLOT_DELIVER_WHO || (await gitUserName(ctx.repoRoot));
  const today = localDate();

  if (args.dryRun) {
    write(`step: would flip Phase → Delivered and fill Delivered: ${today}\n`);
    write('step: would move active/ → delivered/ symlink\n');
    write(`step: would tick the sprint item${sprint !== '' ? ` (sprint: ${sprint})` : ''}\n`);
    if (copy !== null) write(`step: would record the delivery on ${copy.target}\n`);
    write('summary: phase=would record=would index=would sprint=would push=would\n');
    return 0;
  }

  const rel = realPlanPath(readRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${readRoot}).\n  Move the plan under the plan directory inside this checkout and re-run.`);
  }

  const [activeDirCfg, deliveredDirCfg, sprintDirCfg] = await Promise.all([
    ctx.scripts.config('Active index', 'docs/plans/active/'),
    ctx.scripts.config('Delivered index', 'docs/plans/delivered/'),
    ctx.scripts.config('Sprint directory', 'docs/sprints/'),
  ]);
  const activeDir = activeDirCfg.ok ? activeDirCfg.value.trim() : 'docs/plans/active/';
  const deliveredDir = deliveredDirCfg.ok ? deliveredDirCfg.value.trim() : 'docs/plans/delivered/';
  const sprintDir = sprintDirCfg.ok ? sprintDirCfg.value.trim() : 'docs/sprints/';

  await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', main]);

  const { tmpwt, bookbr } = copy ?? (await bookingPlace(ctx, args.slug));
  // With `--branch`, the detached worktree becomes the booking worktree here:
  // `bookbr` is created or reset at `origin/<target>`, as `addBranch` does on
  // the default path.
  const added = copy !== null ? await ctx.trees.resetBranch(tmpwt, bookbr, `origin/${main}`) : await cutBooking(ctx, tmpwt, bookbr, main, 'add');
  if (copy !== null && added.ok) copy.handedOver = true;
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }

  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  try {
    const target = path.join(tmpwt, rel);
    const booking: DeliveryBooking = { rel, slug: args.slug, today, activeDir, deliveredDir, sprintDir, sprint };
    const first = await bookDelivery(ctx, tmpwt, booking);
    if ('refused' in first) {
      warn(`plot-deliver: ${first.refused}\n`);
      await cleanup();
      return 1;
    }
    let report: DeliveryReport = first;

    // A retry after a rejected push: `commitAndPush` has reset `wt` to the
    // re-fetched default branch, so the delivery is decided and written again
    // from the plan text `main` holds now.
    const reapply = async (wt: string): Promise<void> => {
      const again = await bookDelivery(ctx, wt, booking);
      if ('refused' in again) throw new Refused(again.refused);
      report = again;
    };

    const pushResult = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: deliver ${args.slug}`,
      'delivery',
      `nothing to commit — the delivery is already recorded on ${main}`,
      reapply,
      write,
      undefined,
      undefined,
      copy !== null ? 'named' : 'default',
    );

    if ('rejected' in pushResult) {
      warn(`plot-deliver: the delivery is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
      // The branch STAYS — only the worktree is removed, matching the shell's
      // `git worktree remove --force "$tmpwt"` with no `branch -D` beside it.
      await runGit(['-C', ctx.repoRoot, 'worktree', 'remove', '--force', tmpwt]);
      write(`summary: phase=${report.phase} record=${report.record} index=${report.index} sprint=${report.sprint} push=rejected plan-state=skipped tracker=skipped\n`);
      return 1;
    }

    // THE BOOKED PLAN, KEPT FOR THE TRACKER. Read before `cleanup()` removes
    // `tmpwt`, after the push landed, so it holds the text of the attempt that
    // reached `main`.
    const booked = await ctx.planStore.readText(target);
    const bookedPlanFile = path.join(os.tmpdir(), `plot-deliver-plan-${process.pid}.md`);
    if (!booked.ok || booked.value === null || !(await ctx.planStore.writeText(bookedPlanFile, booked.value)).ok) {
      throw new Refused(`could not keep a copy of the booked plan at ${bookedPlanFile} for the tracker.\n  Re-run this — it is idempotent.`);
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

    // A plan's phase, reflected on its issues: the same connector, a different
    // write — see Tracker.planStateWrite. `rel` is the plan's address on `main`
    // now that the push landed, so that is the link this write carries.
    // A failed write is reported and the delivery stands.
    const planState = trackerReportOf(
      await ctx.scripts.awaited('plot-plan-state.sh', [bookedPlanFile, '--phase', 'delivered', '--plan-link', rel]),
    );
    for (const line of planState.lines) write(`  plan-state: ${line}\n`);

    // THE SYNC PR (D13): a Delivered record on the state ref opens or refreshes
    // the PR to the default branch. The entry yields to a live fleet heartbeat,
    // and exit 4 means no key is declared, which prints nothing. A failed or
    // unread pass is reported and the delivery stands.
    const sync = await ctx.scripts.awaited('board/plot-state-sync.mjs', ['--pr', '--caller', 'command']);
    if (sync.code !== NO_STATE_BRANCH) {
      const said = sync.stdout.trim().split('\n').filter((l) => l !== '').pop() ?? '';
      if (sync.code === 0) write(`  state-sync: ${said}\n`);
      else warn(`plot-deliver: state-sync did not complete (exit ${sync.code}): ${said || sync.stderr.trim().split('\n').pop() || 'no output'}\n`);
    }

    unlinkSyncSafe(bookedPlanFile);

    write(`summary: phase=${report.phase} record=${report.record} index=${report.index} sprint=${report.sprint} push=${pushResult.pushed} plan-state=${planState.outcome} tracker=${trackerReport}\n`);
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

/**
 * Ticks a plan's sprint item. Which sprint file is decided by
 * {@link sprintOfPlan} — never by scanning the directory for the first file
 * containing `[slug]`, which can land on a Closed sprint's `### Deferred`
 * line while the plan belongs to a different, open sprint.
 *
 * @returns the outcome, and the sprint file ticked (relative to `root`),
 *   non-empty only when the outcome is `'updated'`.
 */
const tickSprint = async (
  planStore: PlanStore,
  root: string,
  sprintDir: string,
  slug: string,
): Promise<{ outcome: string; file: string }> => {
  const dir = path.join(root, sprintDir);
  const listed = await planStore.listDir(dir);
  const names = (listed.ok ? listed.value : []).filter((n) => n.endsWith('.md'));

  const sprints: SprintFile[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const read = await planStore.readText(file);
    if (read.ok && read.value !== null) sprints.push({ file, content: read.value });
  }

  const membership = sprintOfPlan(slug, sprints);
  if (membership === null) return { outcome: 'none', file: '' };

  const found = sprints.find((s) => s.file === membership.file)!;
  const result = tickSprintItem(found.content, slug);
  if (!result.changed) return { outcome: 'already', file: '' };
  const written = await planStore.writeText(found.file, result.content);
  if (!written.ok) throw new Refused(`could not write ${found.file}.\n  The sprint item is unticked. Re-run this — it is idempotent.`);
  return { outcome: 'updated', file: path.relative(root, found.file) };
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

  let copy: BranchCopy | null = null;
  if (parsed.branch !== '') {
    const prepared = await prepareBranchCopy(ctx, parsed.branch, parsed.slug);
    if (typeof prepared === 'string') {
      warn(`plot-deliver: ${prepared}\n`);
      return 1;
    }
    copy = prepared;
  }

  try {
    const planFile = await findPlanFile(copy?.planStore ?? ctx.planStore, planDir, activeDir, deliveredDir, parsed.slug);
    if (planFile === '') {
      const where = copy !== null ? ` on origin/${copy.target}` : '';
      const list = copy !== null ? `git ls-tree --name-only origin/${copy.target} ${planDir}` : `ls ${planDir}`;
      warn(`plot-deliver: no plan found for '${parsed.slug}'${where} — looked in ${planDir}, ${activeDir}, ${deliveredDir}.\n  Check the slug: ${list} | grep -i '${parsed.slug}'\n`);
      return 1;
    }
    if (parsed.releaseVersion !== '') {
      return await runRelease(ctx, parsed, planFile, write, warn);
    }
    return await runDeliver(ctx, parsed, planFile, write, warn, copy);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-deliver: ${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    if (copy !== null && !copy.handedOver) await ctx.trees.removeOnly(copy.tmpwt);
  }
};

/** Where a release is written and what it records. */
export interface ReleaseBooking {
  /** The plan file, repository-relative. */
  rel: string;
  slug: string;
  /** The tag's date, which the `Released:` record carries. */
  tagDate: string;
  /** The release tag, which the `Released:` record names. */
  tag: string;
  /** Who is asking — `run`'s own caller gate has already refused 'unattended'. */
  caller: Caller;
}

/** What one release write did, in the words the summary line prints. */
export interface ReleaseReport {
  phase: string;
  record: string;
}

/**
 * Decides and writes a release inside the booking worktree `wt`, from the
 * plan text `wt` holds now, and stages it.
 *
 * Reads the plan, asks the domain's `release` transition, flips `State:` to
 * Released and inserts the `Released:` record. A plan that already holds the
 * release writes nothing. The caller runs this once per push attempt, so a
 * retry decides again from the text of the re-fetched default branch.
 *
 * @param ports - the plan store, the trees port, and the main repository
 *   that receives the state receipt.
 * @param wt - the booking worktree, absolute.
 * @param booking - the plan, the tag and the tag's date.
 * @returns the report; or `refused` with the sentence to print where the plan
 *   cannot be released from this text, in which case the plan is unchanged.
 * @throws Refused where the plan write fails.
 */
export const bookRelease = async (
  ports: BookingPorts,
  wt: string,
  booking: ReleaseBooking,
): Promise<ReleaseReport | { refused: string }> => {
  const { rel, slug } = booking;
  const target = path.join(wt, rel);
  const present = await ports.planStore.readText(target);
  if (!present.ok || present.value === null) return { refused: `${rel} is not present in ${wt}` };
  const scratchPlan = await transitionPlanOf(ports.planStore, slug, target);
  if (scratchPlan === null) return { refused: `cannot parse ${target} — refusing rather than guessing.` };
  const decision = release(scratchPlan, { on: booking.tagDate, version: booking.tag, caller: booking.caller });
  if (isRefusal(decision)) return { refused: decision.detail };

  let phase: string;
  let record: string;
  if (decision.alreadyRecorded) {
    phase = 'already';
    record = 'already';
  } else {
    const flip = flipStatusValue(present.value, 'delivered', 'Released');
    const frontMatter = flipFrontMatterPhase(flip.content, 'delivered', 'Released');
    let landed: string;
    if (scratchPlan.releasedRecord.trim() !== '') {
      landed = frontMatter.content;
      record = 'already';
    } else {
      const inserted = insertStatusRecord(frontMatter.content, 'Released', decision.record);
      if (!inserted.changed) {
        return { refused: `${rel} has no '## Status' section — nowhere to record the release.\n  Nothing was written: the phase is not flipped either, because a phase\n  with no record is invisible to the scan. Fix the section and re-run.` };
      }
      landed = inserted.content;
      record = 'written';
    }
    const written = await ports.planStore.writeText(target, landed);
    if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Re-run this — it is idempotent.`);
    phase = flip.changed ? 'flipped' : 'already';
    recordStateReceipt(ports.repoRoot, rel, 'Released');
  }

  await ports.trees.stage(wt, [rel]);
  return { phase, record };
};

/**
 * Runs the release arm.
 *
 * Exported for the real-repo unit test that proves the shared-issue sibling
 * read sees every push that landed before this one in a sweep — `run` builds
 * its own `Context` from real host/tracker adapters that need a configured
 * git host, so that test builds a `Context` of its own instead.
 */
export const runRelease = async (
  ctx: Context,
  args: Args,
  planFile: string,
  write: Printer,
  warn: Printer,
): Promise<number> => {
  // Who is asking, read once at the top of the arm and threaded through every
  // booking below. `PLOT_UNATTENDED=1` maps to 'unattended', never to
  // 'fleetd': this entrance never produces that caller itself. The refusal
  // itself is the domain's — `bookRelease` passes this straight to `release`,
  // which checks it before anything else, including whether a version or a
  // merged PR exists.
  const caller: Caller = callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' });
  if (caller === 'unattended') {
    warn('plot-deliver: unattended: a release needs a person. An unattended caller does not finish one, and fleetd gets no exception here.\n');
    return 1;
  }

  const absPlanFile = path.join(ctx.repoRoot, planFile);
  const plan = await transitionPlanOf(ctx.planStore, args.slug, absPlanFile);
  if (plan === null) {
    throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`);
  }
  // The plan's PR references, repository-qualified and deferral-aware —
  // `branchClaims` reads the `→ #N` / `→ owner/repo#N` annotations with their
  // repository, and `parsed.value.slices` carries each branch's own
  // `deferred` flag, read through the ONE parser that owns the plan format.
  // Joined by branch name rather than parsed twice: `plot-plan-meta.sh` gains
  // no new field for this.
  const parsed = await ctx.planStore.readPlan(planFile);
  const planText = await ctx.planStore.readText(absPlanFile);
  const deferredBranches = new Set(
    parsed.ok ? parsed.value.slices.flatMap((slice) => slice.branches).filter((b) => b.deferred).map((b) => b.branch) : [],
  );
  const prefixRead = await ctx.scripts.config('Branch prefixes', '');
  const configuredPrefixes = prefixRead.ok ? parseBranchPrefixes(prefixRead.value) : [];
  const branchPrefixes = configuredPrefixes.length > 0 ? configuredPrefixes : DEFAULT_BRANCH_PREFIXES;
  const prRows: readonly ReleasePrRow[] =
    planText.ok && planText.value !== null
      ? branchClaims(planText.value, branchPrefixes).map((claim) => ({
          reference: claim.reference,
          deferred: deferredBranches.has(claim.branch),
        }))
      : [];
  const prResult = releasePr(prRows);

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

  let tag: string;
  let tagDate: string;
  if (prResult.outcome === 'none') {
    throw new Refused(`plan '${args.slug}' names no '→ #N' annotation on a slice that was not deferred — the version cannot be resolved from a merge commit that does not exist.\n  Nothing was written. Annotate the branch that shipped this plan, then re-run.`);
  } else if (prResult.outcome === 'all-foreign') {
    // No host call and no tag lookup: every non-deferred PR this plan names
    // lives in another repository, so there is no merge commit of this
    // repository's to find a tag for.
    tag = normalizeVersion(args.releaseVersion);
    tagDate = localDate();
  } else {
    // `prResult.outcome === 'local'` — one `prState` call per local PR
    // number (not just the highest), so the tag can be checked against
    // every one of them rather than just whichever merged last by number.
    const prs = await Promise.all(
      prResult.numbers.map(async (number) => {
        const prState = await ctx.host.prState(number);
        const mergeCommit = prState.ok && prState.value !== null ? prState.value.mergeCommit : '';
        const mergedAt = prState.ok && prState.value !== null ? prState.value.mergedAt ?? '' : '';
        return { number, mergeCommit, mergedAt };
      }),
    );

    const noCommit = prs.find((pr) => pr.mergeCommit === '');
    if (noCommit !== undefined) {
      throw new Refused(`plan '${args.slug}''s last PR (#${noCommit.number}) carries no mergeCommit — it may not have merged, or the host could not answer.\n  Nothing was written. Verify #${noCommit.number} merged, then re-run.`);
    }

    const prRows = await Promise.all(
      prs.map(async (pr) => {
        const tagsResult = await ctx.refs.tagsContaining(pr.mergeCommit);
        const containingTags = tagsResult.ok ? tagsResult.value : [];
        return { ...pr, containingTags };
      }),
    );

    const resolved = releaseTag({ prs: prRows, wantedVersion: args.releaseVersion });
    if (resolved.outcome === 'refused') {
      throw new Refused(`plan '${args.slug}' ${resolved.detail}\n  Nothing was written.`);
    }

    const tagDateResult = await ctx.refs.tagDate(resolved.tag);
    if (!tagDateResult.ok) {
      throw new Refused(`could not read the date of tag '${resolved.tag}' — refusing rather than guessing.\n  Nothing was written.`);
    }
    tag = resolved.tag;
    tagDate = tagDateResult.value;
    const lastPr = prRows.reduce((latest, pr) => (pr.mergedAt > latest.mergedAt ? pr : latest));
    write(`step: plan ${planFile} — phase=${plan.phase} PR #${lastPr.number} merged ${lastPr.mergeCommit}, shipped in ${tag} (${tagDate})\n`);
  }

  const who = args.who || process.env.PLOT_DELIVER_WHO || (await gitUserName(ctx.repoRoot));

  if (args.dryRun) {
    write(`step: plan ${planFile} — phase=${plan.phase} released_raw=${plan.releasedRecord || '<empty>'}\n`);
    if (prResult.outcome === 'all-foreign') {
      write(`step: reason=all-prs-foreign repos=${prResult.repos.join(',')}\n`);
    }
    write(`step: would flip State → Released and fill Released: ${tagDate}, ${tag}\n`);
    write('summary: phase=would record=would index=skipped sprint=none push=would tracker=skipped\n');
    return 0;
  }

  if (prResult.outcome === 'all-foreign') {
    write(`step: plan ${planFile} — phase=${plan.phase} reason=all-prs-foreign repos=${prResult.repos.join(',')}, shipped in ${tag} (${tagDate})\n`);
  }

  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${ctx.repoRoot}).\n  Move the plan under the plan directory inside this checkout and re-run.`);
  }

  await runGit(['-C', ctx.repoRoot, 'fetch', '-q', 'origin', main]);
  const wtRootCfg = await ctx.scripts.config('Worktree root', '');
  const wtRoot = deskRoot({ configured: wtRootCfg.ok ? wtRootCfg.value.trim() : '', repoRoot: ctx.repoRoot });
  const bookbr = `plot/release-${args.slug}`;
  const tmpwt = path.join(wtRoot, `.plot-release-${args.slug}.${process.pid}`);
  const added = await cutBooking(ctx, tmpwt, bookbr, main, 'add');
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  const booking: ReleaseBooking = { rel, slug: args.slug, tagDate, tag, caller };
  const first = await bookRelease(ctx, tmpwt, booking);
  if ('refused' in first) {
    warn(`plot-deliver: ${first.refused}\n`);
    await cleanup();
    return 1;
  }
  let report: ReleaseReport = first;

  // A retry after a rejected push: `commitAndPush` has reset `wt` to the
  // re-fetched default branch, so the release is decided and written again
  // from the plan text `main` holds now.
  const reapply = async (wt: string): Promise<void> => {
    const again = await bookRelease(ctx, wt, booking);
    if ('refused' in again) throw new Refused(again.refused);
    report = again;
  };

  let pushResult: Awaited<ReturnType<typeof commitAndPush>>;
  try {
    pushResult = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: release ${args.slug} (${tag})`,
      'release',
      `nothing to commit — the release is already recorded on ${main}`,
      reapply,
      write,
    );
  } catch (err) {
    await cleanup();
    throw err;
  }
  if ('rejected' in pushResult) {
    warn(`plot-deliver: the release is committed on '${bookbr}' but could not reach ${main}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
    // The branch STAYS — only the worktree is removed, matching the deliver arm.
    await runGit(['-C', ctx.repoRoot, 'worktree', 'remove', '--force', tmpwt]);
    write(`summary: phase=${report.phase} record=${report.record} index=skipped sprint=none push=rejected tracker=skipped\n`);
    return 1;
  }

  // THE TRACKER STEP — read before `cleanup()` removes `tmpwt`, after the
  // push landed. `runRelease` only ever books one plan, so the shared step's
  // one-sibling-read-per-run collapses to the per-plan read it always did.
  const tracker = await tellTrackerAbout(
    tmpwt,
    tag,
    [{ slug: args.slug, file: rel }],
    { scripts: ctx.scripts, planStore: ctx.planStore, scriptDir: ctx.scriptDir },
    write,
  );
  await cleanup();
  const trackerReport = tracker.perPlan[0] ?? 'failed';
  const reasons = Object.entries(tracker.issues.reasons)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(' ');

  write(`summary: phase=${report.phase} record=${report.record} index=skipped sprint=none push=${pushResult.pushed} tracker=${trackerReport}\n`);
  write(`summary: issues closed=${tracker.issues.closed} left-open=${tracker.issues.leftOpen}${reasons === '' ? '' : ` (${reasons})`}\n`);
  spendActionReceipt(ctx.repoRoot, 'release');
  return 0;
};

// Only when RUN, never when imported. `pathToFileURL` over the realpath, for
// the reason `agent-settings.ts` records: `/tmp` is a symlink on macOS.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

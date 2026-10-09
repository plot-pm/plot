import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host, PlanStore, Scripts, Trees } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import { approve, isRefusal, type TransitionPlan } from '@plot-pm/domain/transitions/plan';
import { planStateOf } from '@plot-pm/domain/entities/plan';
import { flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { clearHolds } from '@plot-pm/domain/rules/hold-clear';
import { annotateSprintItem } from '@plot-pm/domain/rules/sprint-annotation';
import { unnamedBranchDetail, unnamedBranches } from '@plot-pm/domain/rules/slice-name';
import { deskRoot } from '@plot-pm/domain/rules/desk-root';
import {
  commitAndPush,
  realPlanPath,
  recordStateReceipt,
  Refused,
  spendActionReceipt,
  unlinkSyncSafe,
  type Printer,
} from './ladder.js';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-approve.sh` launches, once per plan approved.
 *
 * ```
 * plot-approve.mjs [--dry-run] [--who <name>] <slug>
 * ```
 *
 * Performs the mechanical half of approving a plan: reads the ceremony
 * answers and the plan PR, merges the PR, flips the phase and fills the
 * `Approved:` record in one write, clears the `.plot/hold` entries, annotates
 * the sprint item, and pushes. Judgement stays in `/plot-approve`.
 *
 * Idempotent. The merge is the one irreversible step, so every other step asks
 * the source it would have written — the PR state, the plan file, the hold
 * file, the sprint file — whether it is already done, and a re-run is the
 * repair for every interruption.
 *
 * Exit 0 when the plan is Approved on the default branch, whether this run did
 * the work or found it done. Exit 1 on a refusal or a failure, with the reason
 * on stderr.
 */

/** The usage block `-h` prints; lines 2 to 12 of the launcher this entry replaced. */
const USAGE = [
  '# Plot helper: perform the MECHANICAL half of approving a plan.',
  '# Usage: plot-approve.sh [--dry-run] [--who <name>] <slug>',
  '#   --dry-run   say what would happen; merge nothing, write nothing, push nothing',
  '#   --who       the name recorded in the `Approved:` line (default: git user.name)',
  '#   <slug>      the plan to approve',
  '# Output: one `step:` line per step, then a machine-countable summary:',
  '#             summary: merged=yes phase=flipped record=written holds=1 sprint=none push=clean',
  '#         Exit 0 when the plan is Approved on the default branch (whether this',
  '#         run did the work or found it already done); 1 on a refusal or a',
  '#         failure, with the reason on stderr.',
  '#',
].join('\n');

/** What the command line asked for. */
interface Args {
  dryRun: boolean;
  who: string;
  slug: string;
}

/** Parses argv; returns the message to refuse with, or `__help__`. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let dryRun = false;
  let who = '';
  let slug = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--who') who = argv[++i] ?? '';
    else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '') return 'need a plan slug (usage: plot-approve.sh [--dry-run] <slug>)';
  return { dryRun, who, slug };
};

/** The ports and paths this entry needs. */
interface Context {
  repoRoot: string;
  scriptDir: string;
  host: Host;
  planStore: PlanStore;
  scripts: Scripts;
  trees: Trees;
}

/** The directories the approval reads and writes, as `## Plot Config` names them. */
interface Dirs {
  planDir: string;
  activeDir: string;
  sprintDir: string;
}

/** What the local writes reported, in the words the summary line prints. */
interface WriteReport {
  phase: string;
  record: string;
  holds: string;
  sprint: string;
}

/** The three outcomes of asking the host for the plan PR. */
interface PlanPr {
  number: number;
  state: string;
  draft: boolean;
}

/** Reads one config key, falling back where the read fails. */
const configured = async (scripts: Scripts, key: string, fallback: string): Promise<string> => {
  const read = await scripts.config(key, fallback);
  return read.ok ? read.value.trim() : fallback;
};

/**
 * Finds a plan's file by slug: `<activeDir><slug>.md` first, then the first
 * file in `<planDir>` whose name ends in `<slug>.md`, in name order.
 *
 * @returns the path as the configuration spells it, or `''` where none exists.
 */
const findPlanFile = (repoRoot: string, dirs: Dirs, slug: string): string => {
  const active = `${dirs.activeDir}${slug}.md`;
  if (existsSync(path.join(repoRoot, active))) return active;
  const dir = path.join(repoRoot, dirs.planDir);
  if (!existsSync(dir)) return '';
  const hit = readdirSync(dir)
    .filter((name) => name.endsWith(`${slug}.md`))
    .sort()[0];
  return hit === undefined ? '' : `${dirs.planDir}${hit}`;
};

/** The transition plan the domain judges, built from one parse of the file. */
const transitionPlanOf = (slug: string, record: PlanRecord): TransitionPlan => ({
  slug,
  phase: planStateOf(record.phase),
  review: record.review === '' || record.review === 'NONE' ? 'none' : record.review,
  approvedRecord: record.approvedRaw,
  deliveredRecord: record.deliveredRaw,
  releasedRecord: record.releasedRaw,
});

/** The handles `People` declares, lower-cased: the text before each `=`. */
const peopleHandles = (raw: string): readonly string[] =>
  raw
    .split(';')
    .map((entry) => entry.split('=')[0].trim().toLowerCase())
    .filter((handle) => handle !== '');

/**
 * Resolves the default branch: the local `origin/HEAD`, then
 * `plot-host.sh default-branch`, then `main`.
 */
const resolveMain = async (repoRoot: string, trees: Trees, scripts: Scripts): Promise<string> => {
  const local = await trees.originHead(repoRoot);
  if (local.ok && local.value.trim() !== '') return local.value.trim();
  const hosted = await scripts.host(['default-branch']);
  const named = hosted.ok ? hosted.value.trim() : '';
  return named !== '' ? named : 'main';
};

/**
 * The branch the `Impl: same branch` plan lives on: the first
 * `<prefix>/<slug>` that exists locally or on origin, skipping `idea/`, else
 * the bare slug.
 */
const sameBranchOf = async (ctx: Context, slug: string): Promise<string> => {
  const prefixes = (await configured(ctx.scripts, 'Branch prefixes', 'idea/, feature/, bug/, docs/, infra/'))
    .split(',')
    .map((p) => p.trim().replace(/\/$/, ''))
    .filter((p) => p !== '' && p !== 'idea');
  for (const prefix of prefixes) {
    const branch = `${prefix}/${slug}`;
    const local = await ctx.trees.hasRef(ctx.repoRoot, `refs/heads/${branch}`);
    if (local.ok && local.value) return branch;
    const remote = await ctx.trees.hasRef(ctx.repoRoot, `refs/remotes/origin/${branch}`);
    if (remote.ok && remote.value) return branch;
  }
  return slug;
};

/**
 * Asks the host for the plan PR and turns each of its three answers into a
 * refusal or a PR. The merge has not happened yet, so every refusal here
 * leaves the estate as it was found.
 */
const readPlanPr = async (ctx: Context, slug: string, branch: string): Promise<PlanPr> => {
  const lookup = await ctx.host.prState(branch);
  if (!lookup.ok) {
    const said = ctx.host.lastRefusal()?.said ?? '';
    const reason = said !== '' ? said : 'The host adapter gave no reason.';
    if (lookup.why === 'unaskable') {
      throw new Refused(`the host backend has no answer for the PR state of '${branch}' (plot-host.sh pr-state exited 4).\n  ${reason}\n  This backend cannot report a PR's state, so the approval cannot read its gate. The plan was not approved and its phase is unchanged.`);
    }
    throw new Refused(`the host could not be asked for the PR of '${branch}' (plot-host.sh pr-state exited 3).\n  ${reason}\n  The plan was not approved and its phase is unchanged. Wait for the host to answer again, then re-run the approval.`);
  }
  const pr = lookup.value;
  if (pr === null || (pr.state !== 'MERGED' && pr.state !== 'OPEN' && pr.state !== 'CLOSED')) {
    throw new Refused(`no PR found for branch '${branch}'.\n  Push the branch: git push -u origin ${branch}\n  Then open its PR — or run /plot-idea, which does both.`);
  }
  if (pr.state === 'CLOSED') {
    throw new Refused(`the plan PR for '${slug}' (#${pr.number}) is closed.\n  Reopen it on the host, or push '${branch}' again and open a new one.`);
  }
  return { number: pr.number, state: pr.state, draft: pr.draft };
};

/** What one run of the local writes needs to know. */
interface WriteRequest {
  root: string;
  rel: string;
  slug: string;
  who: string;
  today: string;
  channel: string;
  people: readonly string[];
  prNumber: number;
  dirs: Dirs;
}

/**
 * Applies the transition, clears the holds and annotates the sprint inside
 * `request.root`: the booking worktree on the default-branch flow, the
 * caller's checkout on `Impl: same branch`.
 *
 * The phase and the record are one write. Both edits run on copies, the result
 * is parsed at a scratch path, and the plan is replaced only when that parse
 * reads `approved`; a refusal leaves the file byte-identical.
 *
 * @throws Refused where the file is absent, unreadable, refused by the domain,
 *   or has no `## Status` section to take the record.
 */
const applyLocalWrites = async (ctx: Context, request: WriteRequest): Promise<WriteReport> => {
  const { root, rel, slug } = request;
  const target = path.join(root, rel);
  if (!existsSync(target)) throw new Refused(`${rel} is not present in ${root}`);

  const read = await ctx.planStore.readPlan(target);
  if (!read.ok) throw new Refused(`cannot parse ${target} — refusing rather than guessing.`);
  const scratchPlan = transitionPlanOf(slug, read.value);
  const decision = approve(scratchPlan, {
    on: request.today,
    who: request.who,
    channel: request.channel,
    people: request.people,
    slices: read.value.slices,
  });
  if (isRefusal(decision)) throw new Refused(decision.detail);

  let phase: string;
  let record: string;
  if (decision.alreadyRecorded) {
    phase = 'already';
    record = 'already';
  } else {
    const content = readFileSync(target, 'utf8');
    const fromDraft = flipStatusValue(content, 'draft', 'Approved');
    const flip = fromDraft.changed ? fromDraft : flipStatusValue(content, 'design', 'Approved');
    let landed: string;
    if (scratchPlan.approvedRecord.trim() !== '') {
      landed = flip.content;
      record = 'already';
    } else {
      const inserted = insertStatusRecord(flip.content, 'Approved', decision.record);
      if (!inserted.changed) {
        throw new Refused(`${rel} has no '## Status' section — nowhere to record the approval.\n  Nothing was written: the phase is not flipped either, because a phase\n  with no record is invisible to the scan. Fix the section and re-run.`);
      }
      landed = inserted.content;
      record = 'written';
    }
    const scratchPath = `${target}.plot-reread`;
    writeFileSync(scratchPath, landed);
    const reread = await ctx.planStore.readPlan(scratchPath);
    unlinkSyncSafe(scratchPath);
    const got = reread.ok ? reread.value.phase : 'none';
    if (got !== 'approved') {
      throw new Refused(`${rel} — wrote phase 'approved', but the parser still reads '${got}'.\n  Nothing was written — the plan is unchanged. Check what the plan says\n  its phase is, and where: a plan stating it in two places reports the\n  '## Status' block, which is the field every lifecycle script writes.`);
    }
    writeFileSync(target, landed);
    phase = flip.changed ? 'flipped' : 'already';
    recordStateReceipt(ctx.repoRoot, rel, 'Approved');
  }

  const branches = read.value.branches;
  const holdFile = path.join(root, '.plot', 'hold');
  let holds = '0';
  if (existsSync(holdFile)) {
    const cleared = clearHolds(readFileSync(holdFile, 'utf8'), branches);
    if (cleared.removed > 0 && cleared.kept !== undefined) writeFileSync(holdFile, cleared.kept);
    holds = String(cleared.removed);
  }

  const sprint = annotateSprint(root, request, read.value.sprint, branches[0] ?? '');
  return { phase, record, holds, sprint };
};

/** Annotates the sprint item that names the plan; `none` where the plan is in no sprint. */
const annotateSprint = (root: string, request: WriteRequest, sprint: string, branch: string): string => {
  if (sprint === '') return 'none';
  const dir = path.join(root, request.dirs.sprintDir.replace(/^\//, ''));
  if (!existsSync(dir)) return 'missing';
  const needle = `[${request.slug}]`;
  const name = readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .find((n) => readFileSync(path.join(dir, n), 'utf8').includes(needle));
  if (name === undefined) return 'missing';
  const file = path.join(dir, name);
  const annotated = annotateSprintItem(readFileSync(file, 'utf8'), request.slug, request.prNumber, branch);
  if (annotated.outcome === 'updated') writeFileSync(file, annotated.content);
  return annotated.outcome;
};

/** Stages the plan, the hold file and, where it changed, the sprint directory. */
const stageApproval = async (ctx: Context, root: string, rel: string, dirs: Dirs, sprint: string): Promise<void> => {
  await ctx.trees.stage(root, [rel]);
  if (existsSync(path.join(root, '.plot', 'hold'))) await ctx.trees.stage(root, ['.plot/hold']);
  if (sprint === 'updated') await ctx.trees.stage(root, [dirs.sprintDir.replace(/^\//, '')]);
};

/** The main checkout's root, which `.plot/state/` and the desk root hang from. */
const mainRootOf = (ctx: Context): string => {
  const answer = ctx.scripts.sourced('plot-desk-root.sh', '. "$1"; shift; plot_repo_root', []);
  return answer.ok && answer.value.trim() !== '' ? answer.value.trim() : ctx.repoRoot;
};

/**
 * Parses argv, reads the plan and the PR, and performs the approval.
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
    warn(`plot-approve: ${parsed}\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-approve: not a git repository — run this from inside the checkout, or 'git init' one here\n");
    return 1;
  }
  const repoRoot = probe.value;
  const context = { repoRoot, scriptDir };
  const ctx: Context = {
    repoRoot,
    scriptDir,
    host: hostShell(context),
    planStore: planStoreShell(context),
    scripts: scriptsShell(context),
    trees: treesGit(context),
  };

  try {
    return await perform(ctx, parsed, write, warn);
  } catch (err) {
    if (err instanceof Refused) {
      warn(`plot-approve: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
};

/** The approval itself; a `Refused` thrown here becomes a refusal on stderr. */
const perform = async (ctx: Context, args: Args, write: Printer, warn: Printer): Promise<number> => {
  const { slug } = args;
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
    sprintDir: await configured(ctx.scripts, 'Sprint directory', 'docs/sprints/'),
  };

  const planFile = findPlanFile(ctx.repoRoot, dirs, slug);
  if (planFile === '') {
    throw new Refused(`no plan found for '${slug}' — looked in ${dirs.activeDir} and ${dirs.planDir}.\n  Check the slug: ls ${dirs.planDir} | grep -i '${slug}'\n  Or create the plan first: /plot-idea`);
  }
  const read = await ctx.planStore.readPlan(planFile);
  if (!read.ok) {
    throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${ctx.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`);
  }
  const plan = read.value;
  const { phase, review, impl, sprint } = plan;

  // Refusal 1: the phase. `approved` proceeds — it is the idempotent case.
  switch (phase) {
    case 'draft':
    case 'design':
    case 'approved':
      break;
    case 'delivered':
    case 'released':
      throw new Refused(`plan '${slug}' is already ${phase} — nothing to approve.\n  Nothing to do here. To take the work further: /plot-release`);
    case 'NONE':
    case '':
      throw new Refused(`cannot read the phase of '${slug}' (${planFile}) — refusing rather than guessing.\n  Its '## Status' section needs a line reading '- **State:** Draft'.`);
    default:
      throw new Refused(`plan '${slug}' is in phase '${phase}' — only a Draft or Design plan can be approved.\n  If that phase is wrong, correct the 'State:' line in ${planFile} and push it.`);
  }

  // Refusal 2: the review channel.
  let inSession = false;
  switch (review) {
    case 'pr':
    case 'NONE':
    case 'none':
    case '':
      break;
    case 'in-session':
      if (process.env.PLOT_UNATTENDED === '1') {
        throw new Refused(`plan '${slug}' declares 'Review: in-session' — the reviewer is a human in the room.\n  Refusing under PLOT_UNATTENDED=1: there is nobody here to name. Approve it from a session: /plot-approve ${slug}`);
      }
      if (args.who.trim() === '') {
        throw new Refused(`plan '${slug}' declares 'Review: in-session' — name the reviewer with --who.`);
      }
      inSession = true;
      break;
    case 'ballot':
      throw new Refused(`plan '${slug}' declares 'Review: ballot' — the tally is the approval.\n  A script cannot read a ballot. Approve it with /plot-approve ${slug}.`);
    default:
      throw new Refused(`plan '${slug}' records an unrecognised 'Review:' answer ('${review}').\n  Refusing rather than treating it as 'pr' — that would approve a plan nobody discussed.`);
  }

  const people = peopleHandles(await configured(ctx.scripts, 'People', ''));
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);

  // Refusal 3: the PR.
  const sameBranch = !inSession && impl === 'same-branch';
  let pr: PlanPr = { number: 0, state: 'NONE', draft: false };
  if (inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} (in-session, no plan PR)\n`);
  } else {
    const prBranch = sameBranch ? await sameBranchOf(ctx, slug) : `idea/${slug}`;
    pr = await readPlanPr(ctx, slug, prBranch);
  }

  // Refusal 4: a branch under no slice heading. Before the merge, which cannot be undone.
  const unnamed = unnamedBranches(plan.slices);
  if (unnamed.length > 0) {
    throw new Refused(`${unnamedBranchDetail(slug, unnamed)}\n  The plan was not approved, nothing was merged and its phase is unchanged.`);
  }

  if (!inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} pr=#${pr.number}(${pr.state})\n`);
  }

  const who = inSession
    ? args.who
    : args.who || process.env.PLOT_APPROVE_WHO || (await userNameOf(ctx));
  const today = new Date().toISOString().slice(0, 10);
  const branches = plan.branches;

  if (args.dryRun) {
    if (inSession) {
      write(`step: would flip Phase → Approved and fill Approved: ${today}, ${who}, in-session\n`);
    } else {
      if (pr.draft) write(`step: would mark PR #${pr.number} ready for review\n`);
      write(`step: would merge PR #${pr.number}\n`);
      write(`step: would flip Phase → Approved and fill Approved: ${today}, ${who}, plan-PR #${pr.number} merged\n`);
    }
    write(`step: would clear .plot/hold entries for: ${branches.join(' ')}\n`);
    write(`step: would update the sprint annotation${sprint !== '' ? ` in ${dirs.sprintDir} (sprint ${sprint})` : ''}\n`);
    if (inSession) write('step: would append a row to .plot/state/in-session-approvals.tsv\n');
    write(`summary: merged=${inSession ? 'skipped-in-session' : 'would'} phase=would record=would holds=would sprint=would push=would\n`);
    return 0;
  }

  // The one irreversible write.
  let merged = 'already';
  if (inSession) {
    merged = 'skipped-in-session';
  } else if (sameBranch) {
    merged = 'skipped-same-branch';
    write(`step: merge skipped — 'Impl: same branch' keeps PR #${pr.number} open for the implementation\n`);
  } else if (pr.state === 'MERGED') {
    write(`step: PR #${pr.number} is already merged — the approval already happened\n`);
  } else {
    if (pr.draft) {
      const ready = await ctx.scripts.host(['pr-ready', String(pr.number)]);
      if (!ready.ok) {
        throw new Refused(`could not take PR #${pr.number} out of draft. Nothing else was written; mark it ready on the host and re-run.`);
      }
      write(`step: marked PR #${pr.number} ready for review\n`);
    }
    const landed = await ctx.scripts.host(['pr-merge', String(pr.number), '--delete-branch']);
    if (!landed.ok) {
      throw new Refused(`could not merge PR #${pr.number}. Nothing else was written; re-run once the merge works.`);
    }
    merged = 'yes';
    write(`step: merged PR #${pr.number}\n`);
  }

  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${ctx.repoRoot}).\n  Move the plan under ${dirs.planDir} inside this checkout and re-run.`);
  }
  const channel = inSession
    ? 'in-session'
    : sameBranch
      ? `plan-PR #${pr.number} reviewed`
      : `plan-PR #${pr.number} merged`;
  const request = (root: string): WriteRequest => ({
    root,
    rel,
    slug,
    who,
    today,
    channel,
    people,
    prNumber: pr.number,
    dirs,
  });
  const summary = (report: WriteReport, push: string): string =>
    `summary: merged=${merged} phase=${report.phase} record=${report.record} holds=${report.holds} sprint=${report.sprint} push=${push}\n`;

  let report: WriteReport;
  let push: string;
  if (sameBranch) {
    report = await applyLocalWrites(ctx, request(ctx.repoRoot));
    await stageApproval(ctx, ctx.repoRoot, rel, dirs, report.sprint);
    const staged = await ctx.trees.hasStagedChanges(ctx.repoRoot);
    if (staged.ok && !staged.value) {
      push = 'nothing-to-commit';
      write('step: nothing to commit — the approval was already recorded\n');
    } else {
      const committed = await ctx.trees.commitStaged(ctx.repoRoot, `plot: approve ${slug}`);
      if (!committed.ok) {
        throw new Refused(`could not commit the approval.\n  The PR is already merged; the local record is what is missing. See what git refused: git -C ${ctx.repoRoot} status. Then re-run this — it is idempotent.`);
      }
      const branch = await ctx.trees.currentBranch(ctx.repoRoot);
      push = 'local';
      write(`step: recorded on ${branch.ok ? branch.value : ''} — push it with the implementation\n`);
    }
  } else {
    const mainRoot = mainRootOf(ctx);
    const outcome = await bookApproval(ctx, { mainRoot, main, request, args, inSession, prNumber: pr.number, who }, write, warn);
    if (outcome.exit !== undefined) {
      write(summary(outcome.report, 'rejected'));
      return outcome.exit;
    }
    report = outcome.report;
    push = outcome.push;
  }

  if (inSession && push !== 'nothing-to-commit' && push !== 'n/a') {
    const entry = process.env.PLOT_APPROVE_ENTRY === 'board' ? 'board' : 'script';
    const logDir = path.join(mainRootOf(ctx), '.plot', 'state');
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path.join(logDir, 'in-session-approvals.tsv'), `${today}\t${slug}\t${who}\t${entry}\n`);
    } catch {
      // The log counts approvals; a write that fails must not undo one.
    }
  }

  write(summary(report, push));
  spendActionReceipt(ctx.repoRoot, 'approve');
  return 0;
};

/** What the booking worktree flow handed back. */
type Booked = { report: WriteReport; push: string; exit?: undefined } | { report: WriteReport; exit: number };

/**
 * Records the approval on the default branch through a disposable worktree
 * cut from `origin/<main>`, commits it attributed to `who`, and pushes with a
 * micro-PR fallback.
 */
const bookApproval = async (
  ctx: Context,
  flow: {
    mainRoot: string;
    main: string;
    request: (root: string) => WriteRequest;
    args: Args;
    inSession: boolean;
    prNumber: number;
    who: string;
  },
  write: Printer,
  warn: Printer,
): Promise<Booked> => {
  const { mainRoot, main, inSession, prNumber, who } = flow;
  const { slug } = flow.args;
  await ctx.trees.fetch(ctx.repoRoot, main);

  ctx.scripts.sourced('plot-desk-root.sh', '. "$1"; shift; plot_exclude_desk_root "$1"', [mainRoot]);
  const wtRoot = deskRoot({ configured: await configured(ctx.scripts, 'Worktree root', ''), repoRoot: mainRoot });
  const bookbr = `plot/approve-${slug}`;
  const tmpwt = path.join(wtRoot, `.plot-approve-${slug}.${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  const cleanup = () => ctx.trees.removeWithBranch(tmpwt, bookbr);

  try {
    const request = flow.request(tmpwt);
    const report = await applyLocalWrites(ctx, request);
    await stageApproval(ctx, tmpwt, request.rel, request.dirs, report.sprint);

    const body = inSession
      ? `Records the in-session approval of \`${slug}\` by ${who}.`
      : `Records the approval of \`${slug}\` (plan-PR #${prNumber} merged).`;
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      `plot: approve ${slug}`,
      `plot: approve ${slug}`,
      body,
      'approval',
      `nothing to commit — the approval is already recorded on ${main}`,
      write,
    );

    if ('rejected' in landed) {
      const stranded = inSession ? 'the in-session approval IS DECIDED' : `PR #${prNumber} IS MERGED`;
      warn(`plot-approve: the approval is committed on '${bookbr}' but could not reach ${main}.\n  ${stranded} — the plan must not stay at Phase: Draft.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
      await ctx.trees.removeOnly(tmpwt);
      return { report, exit: 1 };
    }
    await cleanup();
    return { report, push: landed.pushed };
  } catch (err) {
    if (err instanceof Refused) {
      await cleanup();
    }
    throw err;
  }
};

/** `git config user.name`, falling back to `plot`. */
const userNameOf = async (ctx: Context): Promise<string> => {
  const name = await ctx.trees.userName(ctx.repoRoot);
  return name.ok && name.value.trim() !== '' ? name.value.trim() : 'plot';
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}

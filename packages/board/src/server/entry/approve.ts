import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host, PlanStore, Scripts, Trees } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import { approve, isRefusal, type TransitionPlan } from '@plot-pm/domain/transitions/plan';
import { approve as approveWorkflow, type ApproveReadings, type ApproveRefusal } from '@plot-pm/domain/workflows/approve';
import { planStateOf } from '@plot-pm/domain/entities/plan';
import { flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { clearHolds } from '@plot-pm/domain/rules/hold-clear';
import { annotateSprintItem } from '@plot-pm/domain/rules/sprint-annotation';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
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
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
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
  /** The sprint file the annotation changed, relative to the root; empty where none changed. */
  sprintFile: string;
}

/** The three outcomes of asking the host for the plan PR. */
interface PlanPr {
  number: number;
  state: string;
  draft: boolean;
  /** The head the host reported; absent where it named none. */
  headSha?: string;
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
const findPlanFile = async (planStore: PlanStore, dirs: Dirs, slug: string): Promise<string> => {
  const active = `${dirs.activeDir}${slug}.md`;
  const held = await planStore.readText(active);
  if (held.ok && held.value !== null) return active;
  const listed = await planStore.listDir(dirs.planDir);
  const hit = (listed.ok ? listed.value : []).filter((name) => name.endsWith(`${slug}.md`)).sort()[0];
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
 * Asks the host for the plan PR. A host that cannot answer is a refusal here;
 * a PR the host does not hold, or holds closed, is a reading the domain judges.
 * The merge has not happened yet, so every refusal leaves the estate as it was
 * found.
 */
const readPlanPr = async (ctx: Context, branch: string): Promise<PlanPr> => {
  const lookup = await ctx.host.prState(branch);
  if (!lookup.ok) {
    const said = ctx.host.lastRefusal()?.said ?? '';
    const reason = said !== '' ? said : 'The host adapter gave no reason.';
    if (lookup.why === 'unaskable') {
      throw new Refused(`the host backend has no answer for the PR state of '${branch}' (plot-host.sh pr-state exited 4).\n  ${reason}\n  This backend cannot report a PR's state, so the approval cannot read its gate. The plan was not approved and its phase is unchanged.`);
    }
    throw new Refused(`the host could not be asked for the PR of '${branch}' (plot-host.sh pr-state refused the call).\n  ${reason}\n  The plan was not approved and its phase is unchanged. Wait for the host to answer again, then re-run the approval.`);
  }
  const pr = lookup.value;
  if (pr === null || (pr.state !== 'MERGED' && pr.state !== 'OPEN' && pr.state !== 'CLOSED')) {
    return { number: 0, state: 'NONE', draft: false };
  }
  return { number: pr.number, state: pr.state, draft: pr.draft, headSha: pr.headSha };
};

/** What the refusal sentences name besides the domain's reason. */
interface RefusalContext {
  slug: string;
  planFile: string;
  scriptDir: string;
  dirs: Dirs;
  phase: string;
  review: string;
  prBranch: string;
  prNumber: number;
}

/**
 * The sentence the entry prints for one of the domain's refusals.
 *
 * The domain names the rule that fired; the repair that follows each rule is
 * the entry's, because it names commands and paths the domain cannot know.
 */
const refusalText = (reason: ApproveRefusal, detail: string, c: RefusalContext): string => {
  const { slug, planFile, phase, review } = c;
  switch (reason) {
    case 'plan-not-found':
      return `no plan found for '${slug}' — looked in ${c.dirs.activeDir} and ${c.dirs.planDir}.\n  Check the slug: ls ${c.dirs.planDir} | grep -i '${slug}'\n  Or create the plan first: /plot-idea`;
    case 'plan-unparseable':
      return `cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${c.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`;
    case 'state-terminal':
      return `plan '${slug}' is already ${phase} — nothing to approve.\n  Nothing to do here. To take the work further: /plot-release`;
    case 'state-unreadable':
      return `cannot read the phase of '${slug}' (${planFile}) — refusing rather than guessing.\n  Its '## Status' section needs a line reading '- **State:** Draft'.`;
    case 'state-wrong':
      return `plan '${slug}' is in phase '${phase}' — only a Draft or Design plan can be approved.\n  If that phase is wrong, correct the 'State:' line in ${planFile} and push it.`;
    case 'slice-unnamed':
      return `${detail}\n  The plan was not approved, nothing was merged and its phase is unchanged.`;
    case 'review-human':
      return review === 'ballot'
        ? `plan '${slug}' declares 'Review: ballot' — the tally is the approval.\n  A script cannot read a ballot. Approve it with /plot-approve ${slug}.`
        : detail;
    case 'reviewer-undeclared':
      return detail;
    case 'review-unrecognised':
      return `plan '${slug}' records an unrecognised 'Review:' answer ('${review}').\n  Refusing rather than treating it as 'pr' — that would approve a plan nobody discussed.`;
    case 'pr-closed':
      return `the plan PR for '${slug}' (#${c.prNumber}) is closed.\n  Reopen it on the host, or push '${c.prBranch}' again and open a new one.`;
    case 'pr-absent':
      return `no PR found for branch '${c.prBranch}'.\n  Push the branch: git push -u origin ${c.prBranch}\n  Then open its PR — or run /plot-idea, which does both.`;
  }
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
  const present = await ctx.planStore.readText(target);
  if (!present.ok || present.value === null) throw new Refused(`${rel} is not present in ${root}`);

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
    const content = present.value;
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
    const scratched = await ctx.planStore.writeText(scratchPath, landed);
    if (!scratched.ok) throw new Refused(`could not write ${scratchPath} to check the parser's reading.\n  Nothing was written to the plan.`);
    const reread = await ctx.planStore.readPlan(scratchPath);
    unlinkSyncSafe(scratchPath);
    const got = reread.ok ? reread.value.phase : 'none';
    if (got !== 'approved') {
      throw new Refused(`${rel} — wrote phase 'approved', but the parser still reads '${got}'.\n  Nothing was written — the plan is unchanged. Check what the plan says\n  its phase is, and where: a plan stating it in two places reports the\n  '## Status' block, which is the field every lifecycle script writes.`);
    }
    const written = await ctx.planStore.writeText(target, landed);
    if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Check the file's permissions, then re-run this — it is idempotent.`);
    phase = flip.changed ? 'flipped' : 'already';
    recordStateReceipt(ctx.repoRoot, rel, 'Approved');
  }

  const branches = read.value.branches;
  const holdFile = path.join(root, '.plot', 'hold');
  let holds = '0';
  const heldHolds = await ctx.planStore.readText(holdFile);
  if (heldHolds.ok && heldHolds.value !== null) {
    const cleared = clearHolds(heldHolds.value, branches);
    if (cleared.removed > 0 && cleared.kept !== undefined) {
      const kept = await ctx.planStore.writeText(holdFile, cleared.kept);
      if (!kept.ok) throw new Refused(`could not write ${holdFile}.\n  The holds are unchanged. Re-run this — it is idempotent.`);
    }
    holds = String(cleared.removed);
  }

  const annotated = await annotateSprint(ctx.planStore, root, request, read.value.sprint, branches[0] ?? '');
  return { phase, record, holds, sprint: annotated.outcome, sprintFile: annotated.file };
};

/**
 * Annotates the sprint item that names the plan. The outcome is `none` where
 * the plan is in no sprint; `file` names the sprint file relative to `root`
 * where the outcome is `updated`, and is empty otherwise.
 */
const annotateSprint = async (
  planStore: PlanStore,
  root: string,
  request: WriteRequest,
  sprint: string,
  branch: string,
): Promise<{ outcome: string; file: string }> => {
  if (sprint === '') return { outcome: 'none', file: '' };
  const dir = path.join(root, request.dirs.sprintDir.replace(/^\//, ''));
  const listed = await planStore.listDir(dir);
  const needle = `[${request.slug}]`;
  for (const name of (listed.ok ? listed.value : []).filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(dir, name);
    const read = await planStore.readText(file);
    if (!read.ok || read.value === null || !read.value.includes(needle)) continue;
    const annotated = annotateSprintItem(read.value, request.slug, request.prNumber, branch);
    if (annotated.outcome === 'updated') {
      const written = await planStore.writeText(file, annotated.content);
      if (!written.ok) throw new Refused(`could not write ${file}.\n  The sprint item is unannotated. Re-run this — it is idempotent.`);
      return { outcome: annotated.outcome, file: path.relative(root, file) };
    }
    return { outcome: annotated.outcome, file: '' };
  }
  return { outcome: 'missing', file: '' };
};

/**
 * Stages the plan, the hold file and the one sprint file the annotation
 * changed. It names files rather than the sprint directory, so a leftover
 * `*.tmp` from an interrupted write or an unrelated sprint edit stays unstaged.
 */
const stageApproval = async (ctx: Context, root: string, rel: string, report: WriteReport): Promise<void> => {
  await ctx.trees.stage(root, [rel]);
  const holdPresent = await ctx.planStore.readText(path.join(root, '.plot', 'hold'));
  if (holdPresent.ok && holdPresent.value !== null) await ctx.trees.stage(root, ['.plot/hold']);
  if (report.sprintFile !== '') await ctx.trees.stage(root, [report.sprintFile]);
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

  const planFile = await findPlanFile(ctx.planStore, dirs, slug);
  const read = planFile === '' ? undefined : await ctx.planStore.readPlan(planFile);
  const plan = read?.ok ? read.value : undefined;
  const phase = plan?.phase ?? '';
  const review = plan?.review ?? '';
  const impl = plan?.impl ?? '';
  const sprint = plan?.sprint ?? '';

  const inSession = review === 'in-session';
  const people = peopleHandles(await configured(ctx.scripts, 'People', ''));
  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);

  // The PR is read only for a plan that carries one. A host that cannot answer
  // is held until the domain has judged the phase and the review channel, so
  // those refusals keep their precedence over it.
  const sameBranch = !inSession && impl === 'same-branch';
  const prBranch = sameBranch ? await sameBranchOf(ctx, slug) : `idea/${slug}`;
  let pr: PlanPr = { number: 0, state: 'NONE', draft: false };
  let hostRefusal: Refused | undefined;
  if (plan !== undefined && !inSession) {
    try {
      pr = await readPlanPr(ctx, prBranch);
    } catch (err) {
      if (!(err instanceof Refused)) throw err;
      hostRefusal = err;
      pr = { number: 0, state: 'OPEN', draft: false };
    }
  }

  const readings: ApproveReadings = {
    slug,
    file: planFile,
    parsed: plan !== undefined,
    phase,
    review: review === 'none' ? 'NONE' : review,
    impl,
    branches: plan?.branches ?? [],
    slices: plan?.slices ?? [],
    sprint,
    sprintFile: '',
    approvedRecord: plan?.approvedRaw ?? '',
    pr: {
      number: pr.number,
      state: pr.state === 'MERGED' || pr.state === 'OPEN' || pr.state === 'CLOSED' ? pr.state : 'NONE',
      draft: pr.draft,
      branch: prBranch,
    },
  };
  const verdict = approveWorkflow(readings, {
    on: localDate(),
    who: args.who,
    channel: 'in-session',
    people,
  });
  // The reviewer is a human in the room, and `process.env` is not the domain's to read.
  if (inSession && process.env.PLOT_UNATTENDED === '1' && (verdict.outcome !== 'refused' || verdict.reason === 'review-human' || verdict.reason === 'reviewer-undeclared')) {
    throw new Refused(`plan '${slug}' declares 'Review: in-session' — the reviewer is a human in the room.\n  Refusing under PLOT_UNATTENDED=1: there is nobody here to name. Approve it from a session: /plot-approve ${slug}`);
  }
  if (verdict.outcome === 'refused') {
    throw new Refused(refusalText(verdict.reason, verdict.detail, {
      slug, planFile, scriptDir: ctx.scriptDir, dirs, phase, review, prBranch, prNumber: pr.number,
    }));
  }
  if (hostRefusal !== undefined) throw hostRefusal;
  if (plan === undefined) throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.`);

  if (inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} (in-session, no plan PR)\n`);
  }

  if (!inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} pr=#${pr.number}(${pr.state})\n`);
  }

  const who = inSession
    ? args.who
    : args.who || process.env.PLOT_APPROVE_WHO || (await userNameOf(ctx));
  const today = localDate();
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
    // The head the gate read is the head that merges: a push between the two
    // fails at the host. A host that named no head merges as it always did.
    const pin = pr.headSha ? ['--match-head', pr.headSha] : [];
    const landed = await ctx.scripts.host(['pr-merge', String(pr.number), ...pin, '--delete-branch']);
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
    await stageApproval(ctx, ctx.repoRoot, rel, report);
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
    const mainRoot = await mainRootOf(ctx);
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
    const logDir = path.join(await mainRootOf(ctx), '.plot', 'state');
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

  const deskReading = { configured: await configured(ctx.scripts, 'Worktree root', ''), repoRoot: mainRoot };
  const placement = deskRootPlacement(deskReading);
  // Cosmetic only: the exclusion keeps the desk root out of `git status`, and a failure must not stop an approval.
  if (placement.excludeLine) await ctx.trees.excludePath(mainRoot, placement.excludeLine);
  const wtRoot = deskRoot(deskReading);
  const bookbr = `plot/approve-${slug}`;
  const tmpwt = path.join(wtRoot, `.plot-approve-${slug}.${process.pid}`);
  const added = await ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`);
  if (!added.ok) {
    throw new Refused(`could not prepare a booking worktree at ${tmpwt}.\n  Most often origin/${main} is not fetched, or '${bookbr}' is checked out in\n  another worktree. Check both: git fetch origin ${main} && git worktree list\n  Nothing has been written locally; the plan is untouched.`);
  }
  // The booking worktree and branch are removed on every way out except a
  // rejected push, which keeps the branch so the committed approval survives.
  let keepBranch = false;

  try {
    const request = flow.request(tmpwt);
    const report = await applyLocalWrites(ctx, request);
    await stageApproval(ctx, tmpwt, request.rel, report);

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
      keepBranch = true;
      await ctx.trees.removeOnly(tmpwt);
      return { report, exit: 1 };
    }
    return { report, push: landed.pushed };
  } finally {
    if (!keepBranch) await ctx.trees.removeWithBranch(tmpwt, bookbr);
  }
};

/** The main checkout's root, which `.plot/state/` and the desk root hang from; the caller's checkout where git cannot say. */
const mainRootOf = async (ctx: Context): Promise<string> => {
  const root = await ctx.trees.mainRoot(ctx.repoRoot);
  return root.ok ? root.value : ctx.repoRoot;
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

import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { canPinMerge } from './host-pin.js';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import type { Host, PlanStore, PortResult, Refs, Scripts, Trees } from '@plot-pm/domain';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import { approve, approveSpike, isRefusal, type Precondition, type TransitionPlan } from '@plot-pm/domain/transitions/plan';
import { approve as approveWorkflow, approveSpike as approveSpikeWorkflow, type ApproveReadings, type ApproveRefusal } from '@plot-pm/domain/workflows/approve';
import { planStateOf } from '@plot-pm/domain/entities/plan';
import { spikeOf } from '@plot-pm/domain/rules/spike';
import { slicesPushedOf } from '@plot-pm/domain/rules/spike-confirm';
import { flipStatusValue, insertStatusRecord } from '@plot-pm/domain/rules/plan-record-edit';
import { SPIKE_APPROVED_FIELD, spikeReceiptKey } from '@plot-pm/domain/rules/state-transition';
import { clearHolds } from '@plot-pm/domain/rules/hold-clear';
import {
  isPlanFile,
  namesPlan,
  planPrOf,
  planPrsCarrying,
  planSlugOf,
  type NamedPr,
  type OpenPr,
  type PlanPrFound,
  type PlanPrReadings,
} from '@plot-pm/domain/rules/plan-pr';
import { approvalArm } from '@plot-pm/domain/rules/approval-arm';
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
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-approve.sh` launches, once per plan approved.
 *
 * ```
 * plot-approve.mjs [--dry-run] [--spike] [--who <name>] <slug>
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

/** The commit-status context `plot-review` writes; this entry writes the same context for the one PR kind it has no writer for. */
export const REVIEW_CONTEXT = 'plot/review';

/**
 * Writes the `plot/review` status a plan-PR merge never otherwise gets: the
 * approval itself is the one review this PR kind has, so the controller
 * records it as `success` on the head the merge is about to pin to.
 *
 * MUST run before the merge call — a write issued after is on a head the
 * merge has already made unreachable, and once the branch rule requires this
 * status, a too-late write would pass "does it write a status" while being
 * useless against the rule it exists for.
 *
 * Silently skips when the PR carries no head (the host named none): there is
 * no sha to pin the status to, and the merge below already falls back to an
 * unpinned merge in that case.
 */
export const writeApprovalStatus = async (host: Host, headSha: string | undefined, who: string): Promise<void> => {
  if (!headSha) return;
  await host.commitStatus({
    sha: headSha,
    state: 'success',
    context: REVIEW_CONTEXT,
    description: `approved by ${who}`,
    targetUrl: '',
  });
};

/** The usage block `-h` prints; lines 2 to 12 of the launcher this entry replaced. */
const USAGE = [
  '# Plot helper: perform the MECHANICAL half of approving a plan.',
  '# Usage: plot-approve.sh [--dry-run] [--spike] [--who <name>] <slug>',
  '#   --dry-run   say what would happen; merge nothing, write nothing, push nothing',
  '#   --spike     approve the plan\'s spike branch alone: record `Spike approved:`, clear its hold, leave the phase',
  '#   --who       the declared handle recorded in the `Approved:` or `Spike approved:` line; required for a',
  '#               spike and for a plan a person approves, otherwise defaults to git user.name',
  '#   <slug>      the plan to approve',
  '# Output: one `step:` line per step, then a machine-countable summary:',
  '#             summary: merged=yes phase=flipped record=written holds=1 sprint=none push=clean',
  '#         Exit 0 when the plan is Approved on the default branch (whether this',
  '#         run did the work or found it already done); 1 on a refusal or a',
  '#         failure, with the reason on stderr.',
  '#',
].join('\n');

/** What the command line asked for. */
export interface Args {
  dryRun: boolean;
  spike: boolean;
  who: string;
  slug: string;
}

/** Parses argv; returns the message to refuse with, or `__help__`. */
const parseArgs = (argv: readonly string[]): Args | string => {
  let dryRun = false;
  let spike = false;
  let who = '';
  let slug = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--spike') spike = true;
    else if (arg === '--who') {
      who = argv[++i] ?? '';
      if (who.startsWith('-')) return `--who takes a name, not the flag '${who}'`;
    }
    else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '') return 'need a plan slug (usage: plot-approve.sh [--dry-run] [--spike] [--who <name>] <slug>)';
  return { dryRun, spike, who, slug };
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
  spikeApprovedRecord: record.spikeApprovedRaw,
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

/** How many open PRs, and how many merged PRs, the plan-PR lookup lists at most. */
const PRS_LISTED = 100;

/**
 * The plan files directly under the plan directory at one revision, without
 * the active and delivered index symlinks.
 *
 * @returns the paths, or `[]` where git cannot list the revision.
 */
const planFilesAt = async (ctx: Context, dirs: Dirs, ref: string): Promise<string[]> => {
  const listed = await ctx.refs.listBlobs(ref, dirs.planDir);
  if (!listed.ok) return [];
  return listed.value
    .filter((blob) => blob.mode !== '120000' && isPlanFile(dirs.planDir, blob.path))
    .map((blob) => blob.path);
};

/**
 * Parses a plan file read from a revision rather than from the checkout. The
 * content is written to a private scratch directory under its own name, parsed,
 * and removed.
 *
 * @returns the parsed plan, or undefined where the revision does not hold the
 *   file or the parser cannot read it.
 */
const readPlanAt = async (ctx: Context, ref: string, file: string): Promise<PlanRecord | undefined> => {
  const shown = await ctx.refs.showFile(ref, file);
  if (!shown.ok) return undefined;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'plot-approve-plan-'));
  try {
    const scratch = path.join(dir, path.basename(file));
    const written = await ctx.planStore.writeText(scratch, shown.value);
    if (!written.ok) return undefined;
    const read = await ctx.planStore.readPlan(scratch);
    return read.ok ? read.value : undefined;
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

/**
 * The open PRs, each with the paths its head changes against its merge base
 * with the default branch.
 *
 * ONE HOST CALL: `pr-list --state open --limit 100`, which names every open
 * PR's head branch and head commit. The heads git does not hold are fetched
 * in ONE `git fetch`. Whether a head changes the plan file is then a git
 * question, which spends no host quota. A PR from a fork, or whose head
 * commit git cannot resolve after the fetch, is skipped: it is never read at
 * `origin/<head>`, which may not be the commit the merge would be pinned to.
 *
 * @throws Refused where the host cannot list its open PRs.
 */
const openPrsOf = async (ctx: Context): Promise<OpenPr[]> => {
  const listed = await ctx.host.prList('open', PRS_LISTED);
  if (!listed.ok) {
    throw new Refused(`the host could not list its open PRs to find the one that changes the plan (plot-host.sh pr-list refused the call).\n  ${hostSaid(ctx)}\n  The plan was not approved and its phase is unchanged. Re-run the approval once the host answers.`);
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

/**
 * Asks `planPrOf` until it answers, reading each reading it names.
 *
 * Host refusals throw, and the caller holds them until the domain has judged
 * the phase and the review channel.
 */
const choosePlanPr = async (
  ctx: Context,
  readings: PlanPrReadings,
  main: string,
  file: string,
): Promise<PlanPrFound | undefined> => {
  let current = readings;
  for (;;) {
    const answer = planPrOf(current);
    if (answer.outcome === 'none') return undefined;
    if (answer.outcome === 'found') return answer;
    switch (answer.ask) {
      case 'named': {
        const pr = await readPlanPr(ctx, `idea/${current.slug}`);
        const state = pr.state;
        const named: NamedPr | null = state === 'MERGED' || state === 'OPEN' || state === 'CLOSED'
          ? { number: pr.number, state, draft: pr.draft, headSha: pr.headSha }
          : null;
        current = { ...current, named };
        break;
      }
      case 'open':
        current = { ...current, open: await openPrsOf(ctx) };
        break;
      case 'addition': {
        const added = await ctx.refs.firstParentAddition(`origin/${main}`, file);
        const sha = added.ok ? added.value : '';
        const second = sha === '' ? undefined : await ctx.refs.resolve(`${sha}^2`);
        current = { ...current, addition: { sha, secondParent: second?.ok ? second.value : '' } };
        break;
      }
      case 'merged': {
        const listed = await ctx.host.prList('merged', PRS_LISTED);
        if (!listed.ok) {
          throw new Refused(`the host could not list its merged PRs to find the one that brought the plan onto the default branch (plot-host.sh pr-list refused the call).\n  ${hostSaid(ctx)}\n  The plan was not approved and its phase is unchanged. Re-run the approval once the host answers.`);
        }
        current = { ...current, merged: listed.value.map((pr) => ({ number: pr.number, headSha: pr.headSha ?? '' })) };
        break;
      }
      case 'confirm': {
        const asked = await ctx.host.prState(answer.number);
        if (!asked.ok) {
          throw new Refused(`the host could not be asked for PR #${answer.number} (plot-host.sh pr-state refused the call).\n  ${hostSaid(ctx)}\n  The plan was not approved and its phase is unchanged. Re-run the approval once the host answers.`);
        }
        current = {
          ...current,
          confirmed: asked.value === null ? null : { state: asked.value.state, mergeCommit: asked.value.mergeCommit },
        };
        break;
      }
    }
  }
};

/** A plan read from a revision, with the open PRs listed to find it. */
interface RemotePlan {
  file: string;
  record: PlanRecord | undefined;
  /** Where it was read: `origin/<main>`, or `PR #N (<head>)`. */
  source: string;
  /** The open PRs listed to find it; absent where the default branch holds it. */
  open?: readonly OpenPr[];
}

/**
 * Finds a plan the checkout does not hold: on `origin/<main>` first, then at
 * the head of the first open PR that changes it.
 *
 * @returns the plan and where it came from, or undefined where neither holds
 *   it.
 */
const remotePlanOf = async (
  ctx: Context,
  dirs: Dirs,
  main: string,
  slug: string,
  mainPlans: readonly string[],
): Promise<RemotePlan | undefined> => {
  const onMain = mainPlans.find((file) => namesPlan(slug, file));
  if (onMain !== undefined) {
    return { file: onMain, record: await readPlanAt(ctx, `origin/${main}`, onMain), source: `origin/${main}` };
  }
  const open = await openPrsOf(ctx);
  const [first] = planPrsCarrying(slug, dirs.planDir, open);
  if (first === undefined) return undefined;
  return {
    file: first.file,
    record: await readPlanAt(ctx, first.pr.headSha, first.file),
    source: `PR #${first.pr.number} (${first.pr.head})`,
    open,
  };
};

/** The readings a Design plan with a spike owes its approval, and the slices they were taken for. */
interface ConfirmTaken {
  /** The slices whose spike the readings name: the default branch's copy where it names one. */
  slices: PlanRecord['slices'];
  spikeMerged: Precondition;
  slicesPushed: Precondition;
}

/**
 * The two readings a Design plan with a spike owes its approval, or undefined
 * where neither the checkout's copy nor the default branch's copy names one
 * spike branch.
 *
 * The spike is read from the copy on `origin/<main>`, which the approval
 * books, and from the checkout's copy where the default branch names none. Its
 * merge is the host's `mergedAt` for its branch and nothing else. The slices
 * reading compares the working tree, `HEAD`, the merge base and `origin/<main>`
 * through `slicesPushedOf`, so a checkout that is only behind is told to pull.
 * A plan read from the default branch or a PR head is that copy by
 * construction. A host that cannot say and a plan outside the repository read
 * as unmet.
 */
const confirmReadingsOf = async (
  ctx: Context,
  plan: PlanRecord,
  planFile: string,
  main: string,
  inCheckout: boolean,
): Promise<ConfirmTaken | undefined> => {
  const rel = inCheckout ? realPlanPath(ctx.repoRoot, planFile) : null;
  let remote: PlanRecord | undefined;
  if (rel !== null) {
    await ctx.trees.fetch(ctx.repoRoot, main);
    remote = await readPlanAt(ctx, `origin/${main}`, rel);
  }
  const slices = remote !== undefined && spikeOf(remote.slices) !== undefined ? remote.slices : plan.slices;
  const spike = spikeOf(slices);
  if (spike === undefined) return undefined;
  const answer = await ctx.host.prMerged(spike.branch);
  const spikeMerged: Precondition = {
    name: spike.branch,
    met: answer.ok && answer.value === 'merged',
    detail: !answer.ok ? 'the host could not be asked' : answer.value === 'merged' ? undefined : answer.value === 'unknown' ? 'the host could not say' : 'the host holds no merged PR for it',
  };
  if (!inCheckout) return { slices, spikeMerged, slicesPushed: { name: planFile, met: true } };
  if (rel === null) {
    return { slices, spikeMerged, slicesPushed: { name: planFile, met: false, detail: 'is outside the repository. Approve it from a checkout of the repository' } };
  }
  const text = (r: PortResult<string | null>): string | undefined => (r.ok && r.value !== null ? r.value : undefined);
  const base = await ctx.refs.mergeBase('HEAD', `origin/${main}`);
  const slicesPushed = slicesPushedOf({
    file: rel,
    main,
    working: text(await ctx.planStore.readText(path.join(ctx.repoRoot, rel))),
    head: text(await ctx.refs.showFile('HEAD', rel)),
    base: base.ok ? text(await ctx.refs.showFile(base.value, rel)) : undefined,
    remote: text(await ctx.refs.showFile(`origin/${main}`, rel)),
  });
  return { slices, spikeMerged, slicesPushed };
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
      return `no plan found for '${slug}' — looked in ${c.dirs.activeDir} and ${c.dirs.planDir}, on the default branch as fetched, and on the heads of the open PRs.\n  Check the slug: ls ${c.dirs.planDir} | grep -i '${slug}'\n  Or create the plan first: /plot-idea`;
    case 'plan-unparseable':
      return `cannot parse '${planFile}' — refusing rather than guessing.\n  See what the parser reads: ${c.scriptDir}/plot-plan-meta.sh ${planFile}\n  A plan needs a '## Status' section with a 'State:' field.`;
    case 'state-terminal':
      return `plan '${slug}' is already ${phase} — nothing to approve.\n  Nothing to do here. To take the work further: /plot-release`;
    case 'state-unreadable':
      return `cannot read the phase of '${slug}' (${planFile}) — refusing rather than guessing.\n  Its '## Status' section needs a line reading '- **State:** Draft'.`;
    case 'state-wrong':
      return `plan '${slug}' is in phase '${phase}' — only a Draft or Design plan can be approved.\n  If that phase is wrong, correct the 'State:' line in ${planFile} and push it.`;
    case 'spike-none':
    case 'spike-not-first':
    case 'spike-approved':
    case 'spike-unmerged':
    case 'slices-unpushed':
      return `${detail}\n  Nothing was merged and nothing was written.`;
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
    case 'pr-ambiguous':
      return `${detail}\n  Close the PR that should not carry the plan, then re-run. Nothing was merged and the phase is unchanged.`;
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
  /** Records `Spike approved:` and clears the spike branch's hold instead of approving the plan. */
  spike?: boolean;
  /** The readings `perform` took for a Design plan with a spike; the domain re-judges them. */
  confirm?: { spikeMerged?: Precondition; slicesPushed?: Precondition };
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
  if (request.spike) return applySpikeWrites(ctx, request, present.value, read.value);
  const scratchPlan = transitionPlanOf(slug, read.value);
  const decision = approve(scratchPlan, {
    on: request.today,
    who: request.who,
    channel: request.channel,
    people: request.people,
    slices: read.value.slices,
    ...request.confirm,
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
 * Records `Spike approved:` and clears the spike branch's hold inside
 * `request.root`. The phase is not flipped and no sprint item is annotated.
 *
 * The record is replaced only when the parser reads it back from a scratch copy;
 * a refusal leaves the file byte-identical. Files the receipt under
 * `<plan path>#Spike approved`, the key the state gate spends for this line.
 *
 * @throws Refused where the domain refuses or the file has no `## Status` section.
 */
const applySpikeWrites = async (
  ctx: Context,
  request: WriteRequest,
  content: string,
  record: PlanRecord,
): Promise<WriteReport> => {
  const { root, rel, slug } = request;
  const target = path.join(root, rel);
  const decision = approveSpike(
    { ...transitionPlanOf(slug, record), spikeApprovedRecord: record.spikeApprovedRaw },
    {
      on: request.today,
      who: request.who,
      channel: request.channel,
      people: request.people,
      slices: record.slices,
    },
  );
  if (decision.outcome === 'refused') throw new Refused(decision.detail);

  const inserted = insertStatusRecord(content, SPIKE_APPROVED_FIELD, decision.record);
  if (!inserted.changed) {
    throw new Refused(`${rel} has no '## Status' section — nowhere to record the spike approval.\n  Nothing was written. Fix the section and re-run.`);
  }
  const scratchPath = `${target}.plot-reread`;
  const scratched = await ctx.planStore.writeText(scratchPath, inserted.content);
  if (!scratched.ok) throw new Refused(`could not write ${scratchPath} to check the parser's reading.\n  Nothing was written to the plan.`);
  const reread = await ctx.planStore.readPlan(scratchPath);
  unlinkSyncSafe(scratchPath);
  if (!reread.ok || reread.value.spikeApprovedRaw.trim() !== decision.record) {
    throw new Refused(`${rel} — wrote the 'Spike approved:' record, but the parser does not read it back.\n  Nothing was written — the plan is unchanged.`);
  }
  const written = await ctx.planStore.writeText(target, inserted.content);
  if (!written.ok) throw new Refused(`could not write ${rel}.\n  The plan is unchanged. Check the file's permissions, then re-run this.`);
  recordStateReceipt(ctx.repoRoot, spikeReceiptKey(rel), decision.record);

  const holdFile = path.join(root, '.plot', 'hold');
  let holds = '0';
  const heldHolds = await ctx.planStore.readText(holdFile);
  if (heldHolds.ok && heldHolds.value !== null) {
    const cleared = clearHolds(heldHolds.value, [decision.branch]);
    if (cleared.removed > 0 && cleared.kept !== undefined) {
      const kept = await ctx.planStore.writeText(holdFile, cleared.kept);
      if (!kept.ok) throw new Refused(`could not write ${holdFile}.\n  The holds are unchanged. Re-run this.`);
    }
    holds = String(cleared.removed);
  }
  return { phase: 'unchanged', record: 'written', holds, sprint: 'none', sprintFile: '' };
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
    refs: refsGit(context),
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

/**
 * The approval itself; a `Refused` thrown here becomes a refusal on stderr.
 *
 * Exported for `approve.test.ts`, which drives it directly against a fixture
 * `Context` to assert the plan-PR merge's commit-status write lands on
 * `pr.headSha` BEFORE the `pr-merge` call — an ordering `run`'s own
 * integration-only surface cannot probe without a real git checkout.
 */
export const perform = async (ctx: Context, args: Args, write: Printer, warn: Printer): Promise<number> => {
  const { slug } = args;
  const dirs: Dirs = {
    planDir: await configured(ctx.scripts, 'Plan directory', 'docs/plans/'),
    activeDir: await configured(ctx.scripts, 'Active index', 'docs/plans/active/'),
    sprintDir: await configured(ctx.scripts, 'Sprint directory', 'docs/sprints/'),
  };

  const main = await resolveMain(ctx.repoRoot, ctx.trees, ctx.scripts);

  // The default branch's plan files, read once and only where a question needs
  // them: a plan this checkout does not hold, or a plan PR not on `idea/<slug>`.
  let mainPlans: string[] | undefined;
  const plansOnMain = async (): Promise<string[]> => {
    if (mainPlans === undefined) {
      await ctx.trees.fetch(ctx.repoRoot, main);
      mainPlans = await planFilesAt(ctx, dirs, `origin/${main}`);
    }
    return mainPlans;
  };

  // A plan on an unmerged plan PR is absent from the default branch's
  // checkout, which is where the board runs this. It is read from the
  // default branch as fetched, or from the head of the open PR that changes it.
  let planFile = await findPlanFile(ctx.planStore, dirs, slug);
  const inCheckout = planFile !== '';
  let plan: PlanRecord | undefined;
  let listedOpen: readonly OpenPr[] | undefined;
  if (planFile !== '') {
    const read = await ctx.planStore.readPlan(planFile);
    plan = read.ok ? read.value : undefined;
  } else {
    const remote = await remotePlanOf(ctx, dirs, main, slug, await plansOnMain());
    if (remote !== undefined) {
      planFile = remote.file;
      plan = remote.record;
      listedOpen = remote.open;
      write(`step: plan ${planFile} is not in this checkout — read it from ${remote.source}\n`);
    }
  }
  const phase = plan?.phase ?? '';
  const review = plan?.review ?? '';
  const impl = plan?.impl ?? '';
  const sprint = plan?.sprint ?? '';

  // Two readings. `inSession` is the channel and decides the PR read, the merge
  // and `sameBranch`; `person` is the arm, which reads the phase too, and
  // decides the named handle, the channel word and the unattended refusal. A
  // Design plan on `Review: pr` is `person` and not `inSession`.
  const inSession = review === 'in-session';
  const person = args.spike || approvalArm({ phase, review }) === 'person';
  const people = peopleHandles(await configured(ctx.scripts, 'People', ''));

  // The PR is read only for a plan that carries one. A host that cannot answer
  // is held until the domain has judged the phase and the review channel, so
  // those refusals keep their precedence over it.
  //
  // The plan PR is the PR that adds or changes the plan file, and `planPrOf`
  // chooses it: `idea/<slug>` first, then the open PRs that change the file
  // against their merge base where the default branch does not hold it, then
  // the merged PR that brought it onto the default branch where it does.
  const sameBranch = !inSession && impl === 'same-branch';
  let prBranch = sameBranch ? await sameBranchOf(ctx, slug) : `idea/${slug}`;
  let pr: PlanPr = { number: 0, state: 'NONE', draft: false };
  let rivals: readonly number[] = [];
  let carried: readonly string[] = [];
  let hostRefusal: Refused | undefined;
  if (plan !== undefined && !inSession) {
    try {
      if (sameBranch) {
        pr = await readPlanPr(ctx, prBranch);
      } else {
        // An active-index symlink names the plan by its real path on the default branch.
        const realFile = realPlanPath(ctx.repoRoot, planFile) ?? planFile;
        const onMain = (await plansOnMain()).includes(realFile);
        const found = await choosePlanPr(
          ctx,
          { slug, planDir: dirs.planDir, onMain, ...(listedOpen === undefined ? {} : { open: listedOpen }) },
          main,
          realFile,
        );
        if (found !== undefined) {
          pr = { number: found.number, state: found.state, draft: found.draft, headSha: found.headSha || undefined };
          if (found.branch !== '') prBranch = found.branch;
          rivals = found.rivals;
          carried = found.carried;
        }
      }
    } catch (err) {
      if (!(err instanceof Refused)) throw err;
      hostRefusal = err;
      pr = { number: 0, state: 'OPEN', draft: false };
    }
  }

  const confirm =
    !args.spike && plan !== undefined && phase === 'design'
      ? await confirmReadingsOf(ctx, plan, planFile, main, inCheckout)
      : undefined;
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
      rivals,
      carried,
    },
  };
  // A spike approval records the channel it rode: the plan PR's merge, or the room.
  const spikeChannel = inSession
    ? 'in-session'
    : sameBranch
      ? `plan-PR #${pr.number} reviewed`
      : `plan-PR #${pr.number} merged`;
  const verdict = (args.spike ? approveSpikeWorkflow : approveWorkflow)(
    {
      ...readings,
      spikeApprovedRecord: plan?.spikeApprovedRaw ?? '',
      ...(confirm === undefined ? {} : { confirmSlices: confirm.slices, spikeMerged: confirm.spikeMerged, slicesPushed: confirm.slicesPushed }),
    },
    { on: localDate(), who: args.who, channel: args.spike ? spikeChannel : 'in-session', people },
  );
  // The reviewer is a human in the room, and `process.env` is not the domain's to read.
  if (person && process.env.PLOT_UNATTENDED === '1' && (verdict.outcome !== 'refused' || verdict.reason === 'review-human' || verdict.reason === 'reviewer-undeclared')) {
    throw new Refused(
      args.spike
        ? `a person approves the spike of '${slug}' on every review channel.\n  Refusing under PLOT_UNATTENDED=1: there is nobody here to name. Approve it from a session: /plot-approve ${slug} --spike --who <handle>`
        : inSession
        ? `plan '${slug}' declares 'Review: in-session' — the reviewer is a human in the room.\n  Refusing under PLOT_UNATTENDED=1: there is nobody here to name. Approve it from a session: /plot-approve ${slug}`
        : `plan '${slug}' is in the Design phase — a person approves it (D10), whatever its 'Review:' channel declares.\n  Refusing under PLOT_UNATTENDED=1: there is nobody here to name. Approve it from a session: /plot-approve ${slug} --who <handle>`,
    );
  }
  if (verdict.outcome === 'refused') {
    if (args.spike && (verdict.reason === 'state-wrong' || verdict.reason === 'review-human' || verdict.reason === 'reviewer-undeclared')) {
      throw new Refused(verdict.reason === 'state-wrong'
        ? `${verdict.detail}\n  Nothing was merged and nothing was written.`
        : `${verdict.detail}\n  Name the reviewer: plot-approve.mjs --spike --who <handle> ${slug}`);
    }
    throw new Refused(refusalText(verdict.reason, verdict.detail, {
      slug, planFile, scriptDir: ctx.scriptDir, dirs, phase, review, prBranch, prNumber: pr.number,
    }));
  }
  if (hostRefusal !== undefined) throw hostRefusal;
  if (plan === undefined) throw new Refused(`cannot parse '${planFile}' — refusing rather than guessing.`);
  const landedDraft = verdict.detail.carried.map(planSlugOf);

  if (inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} (in-session, no plan PR)\n`);
  }

  if (!inSession) {
    write(`step: plan ${planFile} — phase=${phase} review=${review} impl=${impl} pr=#${pr.number}(${pr.state})\n`);
  }

  const who = person
    ? args.who
    : args.who || process.env.PLOT_APPROVE_WHO || (await userNameOf(ctx));
  const today = localDate();
  const branches = plan.branches;

  if (args.dryRun && args.spike) {
    if (!inSession) {
      if (pr.draft) write(`step: would mark PR #${pr.number} ready for review\n`);
      if (pr.state !== 'MERGED' && !sameBranch) write(`step: would merge PR #${pr.number}\n`);
    }
    write(`step: would fill Spike approved: ${today}, ${who}, ${spikeChannel} and leave the phase\n`);
    write(`step: would clear the .plot/hold entry for: ${verdict.detail.spike ?? ''}\n`);
    write('summary: merged=' + (inSession ? 'skipped-in-session' : 'would') + ' phase=unchanged record=would holds=would sprint=none push=would\n');
    return 0;
  }

  if (args.dryRun) {
    if (inSession) {
      write(`step: would flip Phase → Approved and fill Approved: ${today}, ${who}, in-session\n`);
    } else {
      if (pr.draft) write(`step: would mark PR #${pr.number} ready for review\n`);
      write(`step: would merge PR #${pr.number}\n`);
      if (landedDraft.length > 0) write(`step: the merge would also carry, in their own phase: ${landedDraft.join(' ')}\n`);
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
    await writeApprovalStatus(ctx.host, pr.headSha, who);
    // The head the gate read is the head that merges: a push between the two
    // fails at the host. A host that can pin and named no head refuses rather
    // than merging unpinned. A host that cannot pin merges as before.
    const mergeArgs = ['pr-merge', String(pr.number)];
    if (await canPinMerge(ctx.host)) {
      if (!pr.headSha) {
        throw new Refused(`PR #${pr.number} named no head SHA to pin the merge to. Nothing was merged; re-run once the host reports one.`);
      }
      mergeArgs.push('--match-head', pr.headSha);
    }
    mergeArgs.push('--delete-branch');
    const landed = await ctx.scripts.host(mergeArgs);
    if (!landed.ok) {
      throw new Refused(`could not merge PR #${pr.number}. Nothing else was written; re-run once the merge works.`);
    }
    merged = 'yes';
    write(`step: merged PR #${pr.number}\n`);
    if (landedDraft.length > 0) {
      write(`step: PR #${pr.number} also carried ${landedDraft.length} other plan(s), now on ${main} in their own phase: ${landedDraft.join(' ')}\n`);
    }
  }

  const rel = realPlanPath(ctx.repoRoot, planFile);
  if (rel === null) {
    throw new Refused(`${planFile} is outside the repository root (${ctx.repoRoot}).\n  Move the plan under ${dirs.planDir} inside this checkout and re-run.`);
  }
  const channel = args.spike
    ? spikeChannel
    : person
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
    ...(args.spike ? { spike: true } : {}),
    ...(confirm === undefined ? {} : { confirm: { spikeMerged: confirm.spikeMerged, slicesPushed: confirm.slicesPushed } }),
  });
  // A batch PR's merge lands its other plans unapproved; the summary names them
  // so a reader approves each by its own slug.
  const carriedField = merged === 'yes' && landedDraft.length > 0 ? ` carried=${landedDraft.join(',')}` : '';
  const summary = (report: WriteReport, push: string): string =>
    `summary: merged=${merged} phase=${report.phase} record=${report.record} holds=${report.holds} sprint=${report.sprint} push=${push}${carriedField}\n`;

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
      const committed = await ctx.trees.commitStaged(ctx.repoRoot, args.spike ? `plot: approve spike of ${slug}` : `plot: approve ${slug}`);
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

  // A spike approval appends a fifth column, `spike`; a whole-plan row keeps four.
  if (person && push !== 'nothing-to-commit' && push !== 'n/a') {
    const entry = process.env.PLOT_APPROVE_ENTRY === 'board' ? 'board' : 'script';
    const mode = args.spike ? '\tspike' : '';
    const logDir = path.join(await mainRootOf(ctx), '.plot', 'state');
    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(path.join(logDir, 'in-session-approvals.tsv'), `${today}\t${slug}\t${who}\t${entry}${mode}\n`);
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
 * cut from `origin/<main>`, commits it attributed to `who`, and pushes. A
 * rejected push is retried: each retry re-runs the approval on the plan text
 * of the re-fetched default branch.
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
    let report!: WriteReport;
    const reapply = async (wt: string): Promise<void> => {
      const request = flow.request(wt);
      report = await applyLocalWrites(ctx, request);
      await stageApproval(ctx, wt, request.rel, report);
    };
    await reapply(tmpwt);

    const spike = flow.args.spike;
    const subject = spike ? `plot: approve spike of ${slug}` : `plot: approve ${slug}`;
    const landed = await commitAndPush(
      ctx,
      tmpwt,
      bookbr,
      main,
      who,
      subject,
      'approval',
      `nothing to commit — the approval is already recorded on ${main}`,
      reapply,
      write,
    );

    if ('rejected' in landed) {
      const stranded = inSession ? 'the in-session approval IS DECIDED' : `PR #${prNumber} IS MERGED`;
      const unlanded = spike ? `the plan has no 'Spike approved:' record on ${main}, so the spike stays held` : 'the plan must not stay at Phase: Draft';
      warn(`plot-approve: the approval is committed on '${bookbr}' but could not reach ${main}.\n  ${stranded} — ${unlanded}.\n  Land '${bookbr}' by hand, or re-run this command once the push works.\n`);
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

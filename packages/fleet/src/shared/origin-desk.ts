import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Host } from '@plot-pm/domain/ports/host';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { hostShell } from '@plot-pm/domain/adapters';
import { planForBranch, plansMentioning } from '@plot-pm/domain/rules/plan-for-branch';
import { chooseSprintPlans, sliceBaseRef, SPRINT_BRANCH_PREFIX, type BasedPlan } from '@plot-pm/domain/rules/slice-base';
import { deskRoot, deskRootPlacement } from '@plot-pm/domain/rules/desk-root';
import {
  originResume,
  type LocalBranchReading,
  type OriginPlanReading,
  type OriginPrReading,
  type OriginRefReading,
  type OriginResumeReadings,
} from '@plot-pm/domain/rules/origin-resume';
import { answered, failed, type Caller, type PortResult } from '@plot-pm/domain';
import { readConfig } from './config-reader.js';
import { pidAliveEverywhere } from './desk-loop.js';
import { resolveManifestDir } from './registry.js';
import type { ContinuationOptions, ContinueRefusal } from './continuation.js';

/**
 * Cutting a desk for a claimed branch whose work exists only on origin — the
 * reads and the one write behind `restart`'s resume. `originResume` decides;
 * this module reads refs, plans, the host and the registry, and creates the
 * worktree.
 */

/** What {@link deskFromOrigin} came to. */
export type OriginDesk =
  | {
      kind: 'cut';
      /** The new desk, absolute and resolved. */
      worktree: string;
      /** The slice's base branch without `origin/`; `''` for the default branch. */
      base: string;
    }
  | { kind: 'refused'; status: number; reason: ContinueRefusal; detail: string }
  | { kind: 'failed'; error: string };

/** What {@link deskFromOrigin} needs. */
export interface OriginDeskInput {
  opts: ContinuationOptions;
  branch: string;
  caller: Caller;
  /** Whether the caller promised no network; the host is then not asked and the resume refuses. */
  offline: boolean;
  /** Reads `## Plot Config` keys; {@link readConfig} where absent. */
  readCfg?: (opts: ContinuationOptions, key: string, fallback: string) => string;
  /** The host the PR questions go to; the shell adapter where absent. */
  host?: Pick<Host, 'prState' | 'prMerged'>;
}

/** Plan files under `planDir` on `ref` whose slices name `branch`. */
const plansNaming = async (
  refs: Refs,
  context: { repoRoot: string; scriptDir: string },
  ref: string,
  planDir: string,
  branch: string,
): Promise<PortResult<readonly PlanRecord[]>> => {
  const listing = await refs.listBlobs(ref, planDir);
  if (!listing.ok) return failed<readonly PlanRecord[]>();
  const blobs = listing.value.filter((blob) => (blob.mode === '100644' || blob.mode === '100755') && blob.path.endsWith('.md'));
  if (blobs.length === 0) return answered<readonly PlanRecord[]>([]);
  const texts = await refs.readBlobs(blobs.map((blob) => blob.sha));
  if (!texts.ok) return failed<readonly PlanRecord[]>();
  const candidates = plansMentioning(
    blobs.map((blob) => ({ file: blob.path, text: texts.value.get(blob.sha) ?? '' })),
    branch,
  );
  if (candidates.length === 0) return answered<readonly PlanRecord[]>([]);
  const records = await planStoreRef(refs, context, ref, planDir).readPlans(candidates);
  if (!records.ok) return failed<readonly PlanRecord[]>();
  return answered(records.value.filter((record) => record.error === undefined && planForBranch([record], branch) !== undefined));
};

/** The plan reading for a record and its base. */
const namedPlan = (record: PlanRecord, branch: string, base: string): OriginPlanReading => ({
  kind: 'named',
  file: record.file,
  phase: record.phase,
  deferred: record.slices.some((slice) => slice.branches.some((line) => line.branch === branch && line.deferred)),
  base,
});

/**
 * The plan whose slice names `branch`, read on `origin/<default>` first and
 * then on each `origin/sprint/*` tip the default branch does not contain.
 *
 * @param refs - the ref reader.
 * @param context - where the scripts live and which repository to parse in.
 * @param branch - the branch to find.
 * @returns the plan with its base, `none`, or `unreadable` where a listing failed.
 */
export const originPlanFor = async (
  refs: Refs,
  context: { repoRoot: string; scriptDir: string },
  branch: string,
): Promise<OriginPlanReading> => {
  const main = await refs.defaultBranch();
  if (!main.ok || main.value === '') return { kind: 'unreadable' };
  const configured = await planStoreShell(context).config('Plan directory', 'docs/plans/');
  const planDir = configured.ok && configured.value.trim() !== '' ? configured.value.trim() : 'docs/plans/';
  const onMain = await plansNaming(refs, context, `origin/${main.value}`, planDir, branch);
  if (!onMain.ok) return { kind: 'unreadable' };
  if (onMain.value.length > 0) return namedPlan(onMain.value[0]!, branch, '');
  const tips = await refs.branchTips([`refs/remotes/origin/${SPRINT_BRANCH_PREFIX}*`]);
  if (!tips.ok) return { kind: 'unreadable' };
  const candidates: BasedPlan[] = [];
  for (const tip of [...tips.value].sort((a, b) => (a.branch < b.branch ? -1 : 1))) {
    // plot-ancestry: prefilter — a contained tip only SKIPS reading its plans,
    // the rule `sprintPlansOf` applies: every file it holds is in the default
    // branch's history, which was already read; an unknown answer reads it.
    const contained = await refs.contains(tip.sha, `origin/${main.value}`);
    if (contained.ok && contained.value === 'yes') continue;
    const records = await plansNaming(refs, context, `origin/${tip.branch}`, planDir, branch);
    if (!records.ok) return { kind: 'unreadable' };
    for (const record of records.value) candidates.push({ record, base: tip.branch });
  }
  const chosen = chooseSprintPlans(candidates)[0];
  return chosen === undefined ? { kind: 'none' } : namedPlan(chosen.record, branch, chosen.base);
};

/** The sessions of manifests naming `branch` whose `pid` or `wrapperPid` is alive. */
const liveHoldersOf = (dir: string, branch: string): string[] => {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const holders: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Record<string, unknown>;
      if (m.branch !== branch) continue;
      const pids = [m.pid, m.wrapperPid].filter((p): p is string => typeof p === 'string' && /^\d+$/.test(p));
      if (pids.some(pidAliveEverywhere)) holders.push(typeof m.session === 'string' && m.session !== '' ? m.session : name);
    } catch {
      continue;
    }
  }
  return holders;
};

/**
 * Every reading {@link originResume} decides from, for one branch.
 *
 * Fetches `origin/<branch>` first, so the commits are what origin holds now.
 *
 * @param input - the repository, the branch, the caller and the host.
 * @returns the readings.
 */
export const readOriginResume = async (input: OriginDeskInput): Promise<OriginResumeReadings> => {
  const { opts, branch } = input;
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  const refs = refsGit(context);
  const fetched = await refsRemoteGit(context).fetchRemoteHead(branch);
  const plan = await originPlanFor(refs, context, branch);
  const main = await refs.defaultBranch();
  let origin: OriginRefReading;
  if (!fetched.ok || fetched.value === 'unknown') origin = { kind: 'unreadable' };
  else if (fetched.value === 'absent') origin = { kind: 'absent' };
  else {
    const baseRef = sliceBaseRef(plan.kind === 'named' ? plan.base : '', main.ok ? `origin/${main.value}` : '');
    const commits = baseRef === '' ? null : await refs.commitSubjects(`${baseRef}..origin/${branch}`);
    origin = commits === null || !commits.ok ? { kind: 'unreadable' } : { kind: 'present', commits: commits.value };
  }
  let local: LocalBranchReading = { kind: 'absent' };
  const held = await refs.resolve(`refs/heads/${branch}`);
  if (held.ok && held.value !== '') {
    const ahead = refs.countAheadSync(branch);
    local = !ahead.ok ? { kind: 'unreadable' } : ahead.value === 0 ? { kind: 'contained' } : { kind: 'unpushed', count: ahead.value };
  }
  let pr: OriginPrReading = { kind: 'unasked' };
  let merged: OriginResumeReadings['merged'] = 'unknown';
  if (!input.offline) {
    const host = input.host ?? hostShell(context);
    const state = await host.prState(branch);
    pr = !state.ok
      ? { kind: 'unanswerable' }
      : state.value === null
        ? { kind: 'none' }
        : { kind: 'found', number: state.value.number, state: state.value.state, draft: state.value.draft === true };
    const everMerged = await host.prMerged(branch);
    merged = everMerged.ok ? everMerged.value : 'unknown';
  }
  return {
    branch,
    unattended: input.caller === 'unattended',
    plan,
    origin,
    local,
    pr,
    merged,
    liveHolders: liveHoldersOf(resolveManifestDir(opts.repoRoot, opts), branch),
  };
};

/** Whether a `Worker command` value starts anything; `start_worker`'s reading of `none`. */
const startsAWorker = (cmd: string): boolean => cmd !== '' && cmd.toLowerCase() !== 'none';

/**
 * Cuts a desk at `origin/<branch>` for a restart, where `originResume` allows it.
 *
 * Refuses everything `originResume` refuses, and `no-worker-command` before
 * the cut, so a desk is created only where a worker can start on it. The desk
 * is `<Worktree root>/desk-<8 hex>`, checked out on `branch` tracking
 * `origin/<branch>`.
 *
 * @param input - the repository, the branch, the caller and the host.
 * @returns the new desk and the slice's base, a refusal, or a failure to create the desk.
 */
export const deskFromOrigin = async (input: OriginDeskInput): Promise<OriginDesk> => {
  const { opts, branch } = input;
  const readCfg = input.readCfg ?? readConfig;
  const verdict = originResume(await readOriginResume(input));
  if (verdict.kind === 'refused') {
    return { kind: 'refused', status: verdict.reason === 'no-worktree' ? 404 : 409, reason: verdict.reason, detail: verdict.detail };
  }
  if (!startsAWorker(readCfg(opts, 'Worker command', '').trim())) {
    return { kind: 'refused', status: 409, reason: 'no-worker-command', detail: 'no `Worker command` in Plot Config — no desk is cut for a worker that cannot start' };
  }
  const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
  const trees = treesGit(context);
  const main = await trees.mainRoot(opts.repoRoot);
  const mainRoot = main.ok ? main.value : opts.repoRoot;
  const reading = { configured: readCfg(opts, 'Worktree root', ''), repoRoot: mainRoot };
  const root = deskRoot(reading);
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (err) {
    return { kind: 'failed', error: `cannot create ${root}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const placement = deskRootPlacement(reading);
  if (placement.excludeLine !== undefined) await trees.excludePath(mainRoot, placement.excludeLine);
  const worktree = path.join(root, `desk-${randomUUID().slice(0, 8)}`);
  const added = await trees.addTracking(worktree, branch);
  if (!added.ok) return { kind: 'failed', error: `git could not create a worktree for ${branch} at ${worktree} from origin/${branch}` };
  return { kind: 'cut', worktree: fs.realpathSync(worktree), base: verdict.base };
};

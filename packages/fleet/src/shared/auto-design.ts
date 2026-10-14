import fs from 'node:fs';
import path from 'node:path';
import {
  designWork,
  specDeclined,
  specIsEmpty,
  specRow,
  specStart,
  type DesignStore,
  type FleetReading,
  type Headroom,
  type HeldSlice,
  type PortResult,
  type SpecRefusal,
  type SpecRow,
} from '@plot-pm/domain';
import { claimTip, type ClaimAnswer } from '@plot-pm/domain/rules/claim';
import { CLAIM_SUBJECT_PREFIX } from '@plot-pm/domain/rules/empty-claim';
import { planSlugOf } from '@plot-pm/domain/rules/plan-pr';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { refsRemoteGit } from '@plot-pm/domain/adapters/refs/refs-remote-git';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import type { Refs, CommitSubject } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import type { Host, PrLookup } from '@plot-pm/domain/ports/host';
import type { BoardRunRecord } from '@plot-pm/domain/rules/board-run-end';
import { readConfig } from './config-reader.js';
import { usableCommand } from './usable-command.js';
import { designLogPath, designPromptPath } from './agent-log.js';
import type { ActOptions } from './action-log.js';
import { startBoardRun } from './board-run.js';
import { boundSecondsOf as sharedBoundSecondsOf, pidAlive, readRunState, runGoing, updateRunState } from './fleet-run.js';

/** The `## Plot Config` key naming the command that starts a spec run. */
export const DESIGN_COMMAND_KEY = 'Design command';

/** The `## Plot Config` key that switches automatic spec-writing on. */
export const AUTO_DESIGN_KEY = 'Auto-design';

/** `Worker bound` where the key is absent or not a positive whole number of seconds. */
export const DEFAULT_DESIGN_BOUND_SECONDS = 28800;

/** How long a run whose agent pid is not yet recorded counts as going. */
export const DESIGN_START_GRACE_MS = 5 * 60 * 1000;

/** The directory one plan's spec run works in: its own worktree on `idea/<slug>-spec`. */
export const designRunDir = (repoRoot: string, slug: string): string =>
  path.join(repoRoot, '.plot', 'state', 'design', slug);

/** The branch a plan's spec run claims and writes to. */
export const designBranch = (slug: string): string => `idea/${slug}-spec`;

/**
 * The prompt handed to `Design command`.
 *
 * The agent writes the spec and pushes the branch already checked out here;
 * it opens no PR — only the fleet turns a failed `prCreate` into a recorded
 * failure a later pass retries.
 *
 * @param slug - the plan slug.
 * @param planFile - the plan's repository-relative path.
 * @returns the prompt.
 */
export const designPrompt = (slug: string, planFile: string): string =>
  [
    `Write the design spec for the plan ${slug}. This is a fleet spec run, unattended.`,
    `1. Read the plan at ${planFile} and its story.`,
    '2. Write the spec into the plan\'s `## Spec` section.',
    '3. Commit and push your work to the branch already checked out here.',
    '4. Do not change any `State:` line. Approve nothing. Open no pull request — the fleet opens it once your push lands.',
  ].join('\n');

/** One Design plan as the default branch reads it. */
export interface DesignCandidate {
  readonly slug: string;
  readonly state: string;
  readonly text: string;
  readonly planFile: string;
}

/** The Design plans at the default branch, and the plans that could not be read. */
export interface DesignCandidates {
  /** The plans that read `State: Design` at the default branch, by slug. */
  readonly plans: ReadonlyMap<string, DesignCandidate>;
  /** The plans the pass asked about and could not read, with the reason. */
  readonly unread: ReadonlyMap<string, string>;
}

/** The ports {@link readDesignCandidatesWith} reads through. */
export interface DesignCandidatePorts {
  readonly refs: Pick<Refs, 'defaultBranch' | 'showFile'>;
}

/**
 * Reads the Design plans at `origin/<default branch>`, never the working
 * tree — a plan this scan found only on a prefixed branch is unreadable here
 * and gets no run and no failure record.
 *
 * @param ports - the refs port.
 * @param pulse - the pulse the scan just wrote.
 * @returns the plans and the unread ones.
 */
export const readDesignCandidatesWith = async (
  ports: DesignCandidatePorts,
  pulse: FleetReading,
): Promise<DesignCandidates> => {
  const asked = pulse.plans.filter((plan) => plan.phase === 'design');
  const plans = new Map<string, DesignCandidate>();
  const unread = new Map<string, string>();
  if (asked.length === 0) return { plans, unread };
  const main = await ports.refs.defaultBranch();
  if (!main.ok) {
    for (const plan of asked) unread.set(planSlugOf(plan.file), 'the default branch cannot be named');
    return { plans, unread };
  }
  const ref = `origin/${main.value}`;
  for (const plan of asked) {
    const slug = planSlugOf(plan.file);
    const text = await ports.refs.showFile(ref, plan.file);
    if (!text.ok) {
      unread.set(slug, `the plan cannot be read at ${ref}`);
      continue;
    }
    plans.set(slug, { slug, state: plan.phase, text: text.value, planFile: plan.file });
  }
  return { plans, unread };
};

/** {@link readDesignCandidatesWith} over this repository's refs. */
export const readDesignCandidates = (opts: ActOptions, pulse: FleetReading): Promise<DesignCandidates> =>
  readDesignCandidatesWith({ refs: refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }) }, pulse);

/** What the pass reads and does besides the config and the store; each is replaceable in a test. */
export interface DesignPassWorld {
  readonly candidates: (opts: ActOptions, pulse: FleetReading) => Promise<DesignCandidates>;
  readonly alive: (pid: number) => boolean;
  readonly refs: (
    opts: ActOptions,
  ) => Pick<Refs, 'defaultBranch' | 'remoteHead' | 'commitSubjects' | 'fetchRemoteHead' | 'resolve' | 'showFile'>;
  readonly trees: (
    opts: ActOptions,
  ) => Pick<Trees, 'addBranch' | 'commit' | 'push' | 'deleteRemoteBranch' | 'removeWithBranch'>;
  readonly host: (opts: ActOptions) => Pick<Host, 'prState' | 'prCreate' | 'prMerged'>;
}

/** What the daemon reads once per pass and hands the spec pass. */
export interface DesignPassReadings {
  readonly headroom: Headroom;
  readonly machineOverride: boolean;
  /** The slices the queue's last pass held, or `null` where no pass has been read. */
  readonly held: readonly HeldSlice[] | null;
  /** The slugs with a verify run this fleet started that is still going. */
  readonly verifying: ReadonlySet<string>;
}

/** One spec run this fleet started. */
export interface DesignRun {
  /** The agent's pid; `0` until the run has started it. */
  readonly pid: number;
  /** The `Design:` commit the run was started under. */
  readonly commit: string;
  /** Epoch milliseconds of the start. */
  readonly startedAt: number;
  /** The plan's repository-relative path, read on the spec branch when the run settles. */
  readonly planFile?: string;
  /** The exit code, once the run ended in this fleet process. */
  readonly code?: number;
  /** Epoch milliseconds of the end, once the run ended in this fleet process. */
  readonly endedAt?: number;
}

/** `.plot/state/auto-design-in-flight.json`. */
export interface DesignStateFile extends DesignStore {
  /** The runs this fleet started that have not settled. */
  readonly running: Readonly<Record<string, DesignRun>>;
  /** The last refusal per plan, for the fleet status. */
  readonly refusals: Readonly<Record<string, SpecRefusal | 'ask-host'>>;
  /** The *Waiting on you* and *Working* rows of the plans with a spec run. */
  readonly rows: readonly SpecRow[];
}

const EMPTY: DesignStateFile = {
  failures: {},
  failedAt: [],
  lastSuccessAt: 0,
  declined: {},
  answeredPr: {},
  restart: {},
  orphans: {},
  running: {},
  refusals: {},
  rows: [],
};

/** Where the design state lives. */
export const designStatePath = (repoRoot: string): string =>
  path.join(repoRoot, '.plot', 'state', 'auto-design-in-flight.json');

/**
 * Reads the design state.
 *
 * @param repoRoot - the repository the fleet serves.
 * @returns the state; the empty state where no file exists; `null` where a file exists and cannot be read.
 */
export const readDesignState = (repoRoot: string): DesignStateFile | null => {
  const raw = readRunState<Partial<DesignStateFile>>(designStatePath(repoRoot), EMPTY);
  if (raw === null) return null;
  return {
    failures: raw.failures ?? {},
    failedAt: Array.isArray(raw.failedAt) ? raw.failedAt : [],
    lastSuccessAt: typeof raw.lastSuccessAt === 'number' ? raw.lastSuccessAt : 0,
    declined: raw.declined ?? {},
    answeredPr: raw.answeredPr ?? {},
    restart: raw.restart ?? {},
    orphans: raw.orphans ?? {},
    running: raw.running ?? {},
    refusals: raw.refusals ?? {},
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  };
};

/**
 * Reads, changes and writes the design state in one synchronous step, so no
 * other callback of this process writes between the read and the write.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param change - the new state from the current one.
 * @returns the state written, or `null` where the current file cannot be read; nothing is written then.
 */
export const updateDesignState = (
  repoRoot: string,
  change: (current: DesignStateFile) => DesignStateFile,
): DesignStateFile | null => updateRunState(designStatePath(repoRoot), EMPTY, change);

/**
 * Whether a run this fleet started is still going: no end recorded, and its
 * agent alive, or its agent not yet recorded inside {@link DESIGN_START_GRACE_MS}.
 */
export const designRunGoing = (run: DesignRun, alive: (pid: number) => boolean, now: number): boolean =>
  runGoing(run, alive, now, DESIGN_START_GRACE_MS);

/** The spec runs going now: the ones this fleet started that have not ended. */
export const specRunningCount = (
  repoRoot: string,
  alive: (pid: number) => boolean = pidAlive,
  now: number = Date.now(),
): number => {
  const state = readDesignState(repoRoot);
  return state === null ? 0 : Object.values(state.running).filter((run) => designRunGoing(run, alive, now)).length;
};

/**
 * Folds every pending `plot-design.mjs restart` mark into the state, then
 * deletes exactly the files read.
 *
 * A mark is written at `.plot/state/design/restart/<slug>.<epoch-ms>.json`,
 * temp-file-then-rename by its writer; this reads every file in that
 * directory and folds each mark by its `kind`:
 *
 * - `pr-opened`: a success — `lastSuccessAt` moves to `now`; nothing restarts.
 * - `start` (also a mark with no `kind`): `commit` into `restart[slug]`,
 *   `answeredPr` into `answeredPr[slug]` where present, and the plan's
 *   `failures` and `declined` records cleared.
 *
 * It then removes the files it read.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param now - epoch milliseconds, the time a `pr-opened` success is recorded at.
 */
const foldRestartMarks = (repoRoot: string, now: number): void => {
  const dir = path.join(repoRoot, '.plot', 'state', 'design', 'restart');
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const marks: { slug: string; kind: 'start' | 'pr-opened'; commit: string; answeredPr?: number; file: string }[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry);
    const slug = entry.split('.')[0];
    if (slug === undefined || slug === '') continue;
    try {
      const mark = JSON.parse(fs.readFileSync(file, 'utf8')) as { kind?: string; commit?: string; answeredPr?: number };
      if (typeof mark.commit !== 'string') continue;
      const kind = mark.kind === 'pr-opened' ? 'pr-opened' : 'start';
      marks.push({ slug, kind, commit: mark.commit, answeredPr: mark.answeredPr, file });
    } catch {
      continue;
    }
  }
  if (marks.length === 0) return;
  updateDesignState(repoRoot, (current) => {
    const restart = { ...current.restart };
    const answeredPr = { ...current.answeredPr };
    const failures = { ...current.failures };
    const declined = { ...current.declined };
    let lastSuccessAt = current.lastSuccessAt;
    for (const mark of marks) {
      if (mark.kind === 'pr-opened') {
        lastSuccessAt = now;
        continue;
      }
      restart[mark.slug] = mark.commit;
      if (mark.answeredPr !== undefined) answeredPr[mark.slug] = mark.answeredPr;
      delete failures[mark.slug];
      delete declined[mark.slug];
    }
    return { ...current, restart, answeredPr, failures, declined, lastSuccessAt };
  });
  for (const mark of marks) fs.rmSync(mark.file, { force: true });
};

/**
 * Reads a spec branch's claim answer through the refs port: `remoteHead`
 * first, `commitSubjects` only where the ref is `present` — the same
 * short-circuit `queue-reading.ts`'s orphan scan uses, so a branch with no
 * ref costs one call instead of two.
 *
 * @param refs - the refs port.
 * @param defaultBranchName - the default branch's own name, unprefixed.
 * @param branch - the spec branch to ask about.
 * @returns the claim answer, and the commits ahead of the default branch
 *   (empty where they were not read).
 */
const specRefOf = async (
  refs: Pick<Refs, 'remoteHead' | 'commitSubjects'>,
  defaultBranchName: string,
  branch: string,
): Promise<{ claim: ClaimAnswer; commits: readonly CommitSubject[] }> => {
  const ref = await refs.remoteHead(branch);
  const commits: PortResult<readonly CommitSubject[]> =
    ref.ok && ref.value === 'present'
      ? await refs.commitSubjects(`origin/${defaultBranchName}..origin/${branch}`)
      : { ok: false, why: 'unaskable' };
  return { claim: claimTip(ref.ok ? ref.value : 'unknown', commits), commits: commits.ok ? commits.value : [] };
};

/** Why a settled spec run failed, by the settlement table's arms. */
export type SpecFailure = 'pr-not-opened' | 'spec-empty' | 'no-commit' | 'no-branch';

/** How one ended run settles. */
export type DesignSettlement =
  | { readonly outcome: 'unsettled' }
  | { readonly outcome: 'success' }
  | {
      readonly outcome: 'failure';
      readonly reason: SpecFailure;
      /** The tip the arm judged, where the arm deletes the ref; absent where it keeps it. */
      readonly deleteTip?: string;
    };

/**
 * Settles one ended spec run from the spec branch on origin, never from the
 * default branch: fetches `idea/<slug>-spec`, reads its tip once, and judges
 * the claim, the plan's `## Spec` section and the PR at that tip.
 *
 * | ref | also read | outcome |
 * |---|---|---|
 * | `work` | spec written; `prState` finds an open or merged PR | success |
 * | `work` | spec written; no open PR; `prCreate` answers | success |
 * | `work` | spec written; `prState` or `prCreate` fails | failure `pr-not-opened`, ref kept |
 * | `work` | spec empty; `prMerged` reads `not-merged` | failure `spec-empty`, ref deleted |
 * | `work` | spec empty; `prMerged` reads otherwise | failure `spec-empty`, ref kept |
 * | `claim-only` | — | failure `no-commit`, ref deleted |
 * | `absent` | — | failure `no-branch` |
 * | `unknown`, or the tip, commits or plan unreadable | — | unsettled |
 *
 * @param refs - the refs port; `fetchRemoteHead` fetches the branch.
 * @param host - the host port.
 * @param defaultBranchName - the default branch's own name, unprefixed.
 * @param slug - the plan's slug.
 * @param planFile - the plan's repository-relative path, or `''` where unknown.
 * @returns the settlement; a `deleteTip` is the sha every read above was taken at.
 */
export const settleDesignRun = async (
  refs: Pick<Refs, 'fetchRemoteHead' | 'resolve' | 'commitSubjects' | 'showFile'>,
  host: Pick<Host, 'prState' | 'prCreate' | 'prMerged'>,
  defaultBranchName: string,
  slug: string,
  planFile: string,
): Promise<DesignSettlement> => {
  const unsettled: DesignSettlement = { outcome: 'unsettled' };
  const branch = designBranch(slug);
  const fetched = await refs.fetchRemoteHead(branch);
  if (!fetched.ok || fetched.value === 'unknown') return unsettled;
  if (fetched.value === 'absent') return { outcome: 'failure', reason: 'no-branch' };
  if (defaultBranchName === '') return unsettled;
  const tip = await refs.resolve(`origin/${branch}`);
  if (!tip.ok || tip.value === '') return unsettled;
  const claim = claimTip('present', await refs.commitSubjects(`origin/${defaultBranchName}..${tip.value}`));
  if (claim === 'unknown' || claim === 'absent') return unsettled;
  if (claim === 'claim-only') return { outcome: 'failure', reason: 'no-commit', deleteTip: tip.value };
  if (planFile === '') return unsettled;
  const text = await refs.showFile(tip.value, planFile);
  if (!text.ok) return unsettled;
  if (specIsEmpty(text.value)) {
    const merged = await host.prMerged(branch);
    return merged.ok && merged.value === 'not-merged'
      ? { outcome: 'failure', reason: 'spec-empty', deleteTip: tip.value }
      : { outcome: 'failure', reason: 'spec-empty' };
  }
  const pr = await host.prState(branch);
  if (!pr.ok) return { outcome: 'failure', reason: 'pr-not-opened' };
  if (pr.value !== null && pr.value.state !== 'CLOSED') return { outcome: 'success' };
  const created = await host.prCreate({
    head: branch,
    title: `${slug}: spec`,
    body: `Spec for ${slug}, written by the fleet.`,
    draft: true,
  });
  return created.ok ? { outcome: 'success' } : { outcome: 'failure', reason: 'pr-not-opened' };
};

const defaultWorld: DesignPassWorld = {
  candidates: readDesignCandidates,
  alive: pidAlive,
  // `refsGit` answers `fetchRemoteHead` as `unaskable`; `refsRemoteGit` fetches
  // the branch, as `worker-loop.ts` and `registryd-main.ts` compose it — so a
  // settlement reads the tip origin holds now.
  refs: (opts) => ({
    ...refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    fetchRemoteHead: refsRemoteGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }).fetchRemoteHead,
  }),
  trees: (opts) => treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
};

/**
 * The failure records with one more failure of `slug` under `commit` at `now`.
 *
 * @param store - the current failure records.
 * @param slug - the plan's slug.
 * @param commit - the `Design:` commit the failed run was started under.
 * @param now - epoch milliseconds.
 * @returns the new records; a failure under another commit restarts the count at 1.
 */
const withFailure = (
  store: Pick<DesignStore, 'failures' | 'failedAt'>,
  slug: string,
  commit: string,
  now: number,
): { failures: DesignStore['failures']; failedAt: number[] } => {
  const previous = store.failures[slug];
  return {
    failures: {
      ...store.failures,
      [slug]:
        previous !== undefined && previous.reading === commit
          ? { reading: commit, count: previous.count + 1, lastAt: now }
          : { reading: commit, count: 1, lastAt: now },
    },
    failedAt: [...store.failedAt, now],
  };
};

/** `Worker bound` in seconds, or {@link DEFAULT_DESIGN_BOUND_SECONDS}. */
const boundSecondsOf = (opts: ActOptions): number => sharedBoundSecondsOf(opts, DEFAULT_DESIGN_BOUND_SECONDS);

/** The plan's `Design:` commit field, read from its own text. */
const designCommitOf = (text: string): string => /^Design:\s*(\S+)/m.exec(text)?.[1] ?? '';

/**
 * One spec pass: fold restart marks, settle the runs this fleet started that
 * ended through {@link settleDesignRun}, read an orphaned `work` spec ref, then
 * start at most one run that `specStart` allows.
 *
 * Every host read about an unsettled plan comes after `specStart`'s local
 * refusals: only a plan it leaves at `ask-host` reads `prState`, at most once
 * per pass. That one reading answers `specDeclined`, and, for a `work` ref
 * with no run record on this machine whose oldest commit is older than
 * `Worker bound` and whose tip has no orphan reading yet, `orphans[slug]`.
 * With `Auto-design` off and no restart mark, or no `Design command`, every
 * plan refuses `off` and the pass asks the host nothing except to settle the
 * runs this fleet started.
 *
 * A start drops the plan's restart mark in the same state write that records
 * the run, so one restart starts one run. A settled run's worktree and local
 * branch are removed; a deletion of the remote ref is pinned to the tip the
 * settlement judged.
 *
 * @param opts - where the fleet acts.
 * @param pulse - the pulse the scan just wrote.
 * @param readings - the machine, queue and verify readings of this pass.
 * @param now - epoch milliseconds.
 * @param world - what the pass reads and does besides config and store.
 * @returns the slugs whose runs started: none or one.
 */
export const runAutoDesignPass = async (
  opts: ActOptions,
  pulse: FleetReading | null,
  readings: DesignPassReadings,
  now: number = Date.now(),
  world: DesignPassWorld = defaultWorld,
): Promise<string[]> => {
  const command = usableCommand(readConfig(opts, DESIGN_COMMAND_KEY, ''));
  const autoDesign = readConfig(opts, AUTO_DESIGN_KEY, '') === 'true';
  foldRestartMarks(opts.repoRoot, now);

  const before = readDesignState(opts.repoRoot);
  if (before === null) {
    console.log('auto-design: cannot read the design state; starting nothing this pass');
    return [];
  }
  if (pulse === null) return [];
  const candidates = await world.candidates(opts, pulse);

  const refs = world.refs(opts);
  const host = world.host(opts);
  const trees = world.trees(opts);
  const main = await refs.defaultBranch();
  const defaultBranchName = main.ok ? main.value : '';
  const boundMs = boundSecondsOf(opts) * 1000;

  const settled: { slug: string; deleteTip?: string }[] = [];
  const pick: { slug: string | null; planFile: string; start: string } = { slug: null, planFile: '', start: '' };

  const written = await (async () => {
    const current = readDesignState(opts.repoRoot);
    if (current === null) return null;

    const going = new Set<string>();
    const stillRunning: Record<string, DesignRun> = {};
    const endedRuns: { slug: string; run: DesignRun }[] = [];
    for (const [slug, run] of Object.entries(current.running)) {
      if (designRunGoing(run, world.alive, now)) {
        going.add(slug);
        stillRunning[slug] = run;
      } else if (candidates.unread.has(slug)) {
        stillRunning[slug] = run;
      } else {
        endedRuns.push({ slug, run });
      }
    }

    let failures = { ...current.failures };
    let failedAt = [...current.failedAt];
    let lastSuccessAt = current.lastSuccessAt;
    const declined = { ...current.declined };
    const answeredPr = { ...current.answeredPr };
    const restart = { ...current.restart };
    const orphans = { ...current.orphans };
    const refusals: Record<string, SpecRefusal | 'ask-host'> = {};

    const recordFailure = (slug: string, commit: string): void => {
      ({ failures, failedAt } = withFailure({ failures, failedAt }, slug, commit, now));
    };
    const recordSuccess = (): void => {
      lastSuccessAt = now;
    };

    for (const { slug, run } of endedRuns) {
      const planFile = candidates.plans.get(slug)?.planFile ?? run.planFile ?? '';
      const settlement = await settleDesignRun(refs, host, defaultBranchName, slug, planFile);
      if (settlement.outcome === 'unsettled') {
        stillRunning[slug] = run;
        continue;
      }
      settled.push({ slug, deleteTip: settlement.outcome === 'failure' ? settlement.deleteTip : undefined });
      if (settlement.outcome === 'success') recordSuccess();
      else recordFailure(slug, run.commit);
    }
    const ours = new Set([...Object.keys(stillRunning), ...settled.map((s) => s.slug)]);
    for (const slug of Object.keys(orphans)) {
      if (ours.has(slug) || (!candidates.plans.has(slug) && !candidates.unread.has(slug))) delete orphans[slug];
    }

    const prReadings = new Map<string, PortResult<PrLookup>>();
    const prOf = async (branch: string): Promise<PortResult<PrLookup>> => {
      const known = prReadings.get(branch);
      if (known !== undefined) return known;
      const read = await host.prState(branch);
      prReadings.set(branch, read);
      return read;
    };

    for (const plan of candidates.plans.values()) {
      if (ours.has(plan.slug) || defaultBranchName === '') continue;
      const branch = designBranch(plan.slug);
      const specRef = await specRefOf(refs, defaultBranchName, branch);
      if (specRef.claim === 'absent' || specRef.claim === 'claim-only') delete orphans[plan.slug];

      const designCommit = designCommitOf(plan.text);
      const prRetry = failures[plan.slug]?.reading === designCommit;
      const answer = designWork({ state: plan.state, text: plan.text, specRef: specRef.claim, prRetry });
      const store: DesignStore = { failures, failedAt, lastSuccessAt, declined, answeredPr, restart, orphans };
      const startAnswer = specStart({
        autoDesign,
        command: command !== '',
        slug: plan.slug,
        designCommit,
        going: new Set([...going, ...readings.verifying]),
        store,
        held: readings.held,
        headroom: readings.headroom,
        machineOverride: readings.machineOverride,
        now,
      });
      if (startAnswer.start) continue; // unreachable per specStart's own contract; kept so the branch is exhaustive
      const askHost = startAnswer.reason === 'ask-host';

      if (specRef.claim === 'work' && askHost && specRef.commits.length > 0) {
        const claimAt = Math.min(...specRef.commits.map((c) => c.at));
        if (now - claimAt > boundMs) {
          const tip = await refs.resolve(`origin/${branch}`);
          if (tip.ok && orphans[plan.slug]?.tip !== tip.value) {
            const pr = await prOf(branch);
            if (pr.ok) orphans[plan.slug] = { tip: tip.value, hasPr: pr.value !== null };
          }
        }
      }

      if (answer === 'none') continue;
      if (startAnswer.reason !== 'ask-host') {
        refusals[plan.slug] = startAnswer.reason;
        continue;
      }
      const pr = await prOf(branch);
      const declinedAnswer = specDeclined(pr.ok ? pr.value : 'unknown', answeredPr[plan.slug] ?? 0);
      if (declinedAnswer === 'host-unknown') {
        refusals[plan.slug] = 'ask-host';
      } else if (declinedAnswer === 'declined') {
        declined[plan.slug] = { commit: designCommit, pr: pr.ok && pr.value !== null ? pr.value.number : 0 };
        refusals[plan.slug] = 'declined';
      } else if (declinedAnswer === 'pr-open') {
        refusals[plan.slug] = 'ask-host';
      } else if (pick.slug === null) {
        pick.slug = plan.slug;
        pick.planFile = plan.planFile;
        pick.start = answer === 'open-pr' ? `origin/${branch}` : `origin/${defaultBranchName}`;
        going.add(plan.slug);
        stillRunning[plan.slug] = { pid: 0, commit: designCommit, startedAt: now, planFile: plan.planFile };
        delete restart[plan.slug];
      }
    }

    const finalStore: DesignStore = { failures, failedAt, lastSuccessAt, declined, answeredPr, restart, orphans };
    const rows = [...candidates.plans.values()].flatMap((plan) => {
      const row = specRow(
        plan.slug,
        designCommitOf(plan.text),
        finalStore,
        designLogPath(opts.repoRoot, plan.slug),
        going.has(plan.slug),
        now,
      );
      return row === null ? [] : [row];
    });

    return { ...finalStore, running: stillRunning, refusals, rows } satisfies DesignStateFile;
  })();

  if (written === null) {
    console.log('auto-design: cannot read the design state; starting nothing this pass');
    return [];
  }
  updateDesignState(opts.repoRoot, () => written);
  for (const { slug, deleteTip } of settled) {
    const branch = designBranch(slug);
    await trees.removeWithBranch(designRunDir(opts.repoRoot, slug), branch);
    if (deleteTip !== undefined) await trees.deleteRemoteBranch(branch, deleteTip);
  }
  if (pick.slug === null) return [];
  await startDesignRun(opts, pick.slug, pick.planFile, pick.start, world, now);
  return [pick.slug];
};

/**
 * Starts the run of one plan, in its own worktree on the spec branch created
 * from `start`, and records its pid and its end in the state.
 *
 * @param opts - where the fleet acts.
 * @param slug - the plan's slug.
 * @param planFile - the plan's repository-relative path.
 * @param start - the revision the spec branch starts from: `origin/<main>`
 *   for a new spec, `origin/idea/<slug>-spec` for an `open-pr` retry.
 * A start that fails before its claim reaches origin drops its run record,
 * so no later pass settles `idea/<slug>-spec` as this machine's run, and
 * removes the local worktree and branch. A failed `addBranch` or `commit` is
 * this machine's failure and is recorded under the run's `Design:` commit. A
 * rejected push means another machine holds the run: nothing is recorded.
 * The restart mark the start consumed stays consumed.
 *
 * @param world - the ports.
 * @param now - epoch milliseconds of the pass, recorded on a failure.
 */
const startDesignRun = async (
  opts: ActOptions,
  slug: string,
  planFile: string,
  start: string,
  world: DesignPassWorld,
  now: number,
): Promise<void> => {
  const patch = (fields: Partial<DesignRun>): void => {
    updateDesignState(opts.repoRoot, (current) => {
      const run = current.running[slug];
      return run === undefined ? current : { ...current, running: { ...current.running, [slug]: { ...run, ...fields } } };
    });
  };
  const branch = designBranch(slug);
  const dir = designRunDir(opts.repoRoot, slug);
  const trees = world.trees(opts);
  const abandon = async (failed: boolean): Promise<void> => {
    updateDesignState(opts.repoRoot, (current) => {
      const run = current.running[slug];
      if (run === undefined) return current;
      const { [slug]: _dropped, ...running } = current.running;
      return failed ? { ...current, ...withFailure(current, slug, run.commit, now), running } : { ...current, running };
    });
    await trees.removeWithBranch(dir, branch);
  };
  const added = await trees.addBranch(dir, branch, start);
  if (!added.ok) {
    console.error(`auto-design: ${slug} could not create its worktree`);
    await abandon(true);
    return;
  }
  const committed = await trees.commit(dir, `${CLAIM_SUBJECT_PREFIX}${branch}`);
  if (!committed.ok) {
    console.error(`auto-design: ${slug} could not commit its claim`);
    await abandon(true);
    return;
  }
  const pushed = await trees.push(dir, branch);
  if (!pushed.ok) {
    console.error(`auto-design: ${slug} claim push was rejected; another run holds the branch`);
    await abandon(false);
    return;
  }
  const promptPath = designPromptPath(opts.repoRoot, slug);
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, designPrompt(slug, planFile), 'utf8');

  await startBoardRun(
    opts,
    {
      role: 'design',
      fragmentKey: DESIGN_COMMAND_KEY,
      tree: dir,
      prompt: `Read ${promptPath} and follow it.`,
      env: { PLOT_UNATTENDED: '1', PLOT_PLAN_SLUG: slug },
      logFile: designLogPath(opts.repoRoot, slug),
      statePath: null,
      boundSeconds: boundSecondsOf(opts),
      onStarted: (pid) => patch({ pid }),
    },
    (record: BoardRunRecord) => patch({ code: record.code, endedAt: Date.now() }),
  ).catch((err: unknown) => {
    console.error(`auto-design: ${slug} failed to start:`, err);
    patch({ code: 1, endedAt: Date.now() });
  });
};

/** What the fleet's status says about spec runs. */
export interface DesignStatus {
  readonly halted: boolean;
  readonly running: readonly string[];
  readonly refusals: Readonly<Record<string, SpecRefusal | 'ask-host'>>;
  readonly rows: readonly SpecRow[];
}

/**
 * The fleet's spec-run status, read from the state the pass wrote.
 *
 * @param repoRoot - the repository the fleet serves.
 * @returns the status; `null` where the state file cannot be read.
 */
export const readDesignStatus = (repoRoot: string): DesignStatus | null => {
  const state = readDesignState(repoRoot);
  if (state === null) return null;
  const halted = state.failedAt.filter((at) => at > state.lastSuccessAt).length >= 3;
  return { halted, running: Object.keys(state.running), refusals: state.refusals, rows: state.rows };
};

/**
 * The spec-run block of `/plot-fleet --status`.
 *
 * @param status - the status, or `null` where the state file cannot be read.
 * @returns the lines, each ending in a newline; empty where nothing was recorded.
 */
export const designStatusLines = (status: DesignStatus | null): string => {
  if (status === null) return 'spec runs: the state file cannot be read\n';
  const refused = Object.entries(status.refusals);
  if (!status.halted && status.running.length === 0 && refused.length === 0 && status.rows.length === 0) return '';
  const out = [
    `spec runs: ${status.halted ? 'halted' : 'not halted'}, ${status.running.length} running, ${refused.length} refused`,
  ];
  for (const slug of status.running) out.push(`  ${slug}  running`);
  for (const [slug, reason] of refused) out.push(`  ${slug}  refused: ${reason}`);
  for (const row of status.rows) {
    if (row.reason !== '') out.push(`  ${row.plan}  waiting on you: ${row.reason} — ${row.restart} (log ${row.log})`);
  }
  return `${out.join('\n')}\n`;
};

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
import type { Host } from '@plot-pm/domain/ports/host';
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
  readonly refs: (opts: ActOptions) => Pick<Refs, 'defaultBranch' | 'remoteHead' | 'commitSubjects' | 'remoteSha'>;
  readonly trees: (opts: ActOptions) => Pick<Trees, 'addBranch' | 'commit' | 'push' | 'deleteRemoteBranch'>;
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
 * directory, folds `commit` into `restart[slug]` and, where present,
 * `answeredPr` into `answeredPr[slug]`, then removes the files it read.
 *
 * @param repoRoot - the repository the fleet serves.
 */
const foldRestartMarks = (repoRoot: string): void => {
  const dir = path.join(repoRoot, '.plot', 'state', 'design', 'restart');
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const marks: { slug: string; commit: string; answeredPr?: number; file: string }[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry);
    const slug = entry.split('.')[0];
    if (slug === undefined || slug === '') continue;
    try {
      const mark = JSON.parse(fs.readFileSync(file, 'utf8')) as { commit?: string; answeredPr?: number };
      if (typeof mark.commit !== 'string') continue;
      marks.push({ slug, commit: mark.commit, answeredPr: mark.answeredPr, file });
    } catch {
      continue;
    }
  }
  if (marks.length === 0) return;
  updateDesignState(repoRoot, (current) => {
    const restart = { ...current.restart };
    const answeredPr = { ...current.answeredPr };
    for (const mark of marks) {
      restart[mark.slug] = mark.commit;
      if (mark.answeredPr !== undefined) answeredPr[mark.slug] = mark.answeredPr;
    }
    return { ...current, restart, answeredPr };
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
 * @returns the claim answer.
 */
const specRefOf = async (
  refs: Pick<Refs, 'remoteHead' | 'commitSubjects'>,
  defaultBranchName: string,
  branch: string,
): Promise<ClaimAnswer> => {
  const ref = await refs.remoteHead(branch);
  const commits: PortResult<readonly CommitSubject[]> =
    ref.ok && ref.value === 'present'
      ? await refs.commitSubjects(`origin/${defaultBranchName}..origin/${branch}`)
      : { ok: false, why: 'unaskable' };
  return claimTip(ref.ok ? ref.value : 'unknown', commits);
};

const defaultWorld: DesignPassWorld = {
  candidates: readDesignCandidates,
  alive: pidAlive,
  // `refsGit` answers `remoteSha` as `unaskable`; `refsRemoteGit` reads it over
  // `git ls-remote`, as `worker-loop.ts` and `registryd-main.ts` compose it —
  // the real tip is what `deleteRemoteBranch`'s force-with-lease pins against.
  refs: (opts) => ({
    ...refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
    remoteSha: refsRemoteGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }).remoteSha,
  }),
  trees: (opts) => treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
};

/** `Worker bound` in seconds, or {@link DEFAULT_DESIGN_BOUND_SECONDS}. */
const boundSecondsOf = (opts: ActOptions): number => sharedBoundSecondsOf(opts, DEFAULT_DESIGN_BOUND_SECONDS);

/** The plan's `Design:` commit field, read from its own text. */
const designCommitOf = (text: string): string => /^Design:\s*(\S+)/m.exec(text)?.[1] ?? '';

/**
 * One spec pass: fold restart marks, settle the runs this fleet started that
 * ended — opening the PR itself on a written spec, deleting the branch on an
 * empty one — then start at most one run that `specStart` allows.
 *
 * `specStart` refuses from local readings only; only a plan it leaves at
 * `ask-host` costs one `prState` call, through `specDeclined`. With
 * `Auto-design` off or no `Design command`, every candidate refuses `off` and
 * the pass asks the host nothing.
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
  foldRestartMarks(opts.repoRoot);

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

  const ended: string[] = [];
  const toDeletePlans: string[] = [];
  const pick: { slug: string | null; planFile: string } = { slug: null, planFile: '' };

  const written = await (async () => {
    const current = readDesignState(opts.repoRoot);
    if (current === null) return null;

    const going = new Set<string>();
    const stillRunning: Record<string, DesignRun> = {};
    const endedRuns: { slug: string; commit: string }[] = [];
    for (const [slug, run] of Object.entries(current.running)) {
      if (designRunGoing(run, world.alive, now)) {
        going.add(slug);
        stillRunning[slug] = run;
      } else if (candidates.unread.has(slug)) {
        stillRunning[slug] = run;
      } else {
        endedRuns.push({ slug, commit: run.commit });
      }
    }

    let failures = { ...current.failures };
    let failedAt = [...current.failedAt];
    let lastSuccessAt = current.lastSuccessAt;
    const declined = { ...current.declined };
    const answeredPr = { ...current.answeredPr };
    const orphans = { ...current.orphans };
    const refusals: Record<string, SpecRefusal | 'ask-host'> = {};

    const recordFailure = (slug: string, commit: string): void => {
      const previous = failures[slug];
      failures = {
        ...failures,
        [slug]:
          previous !== undefined && previous.reading === commit
            ? { reading: commit, count: previous.count + 1, lastAt: now }
            : { reading: commit, count: 1, lastAt: now },
      };
      failedAt = [...failedAt, now];
    };
    const recordSuccess = (): void => {
      lastSuccessAt = now;
    };

    for (const { slug, commit } of endedRuns) {
      const plan = candidates.plans.get(slug);
      const branch = designBranch(slug);
      if (plan === undefined || specIsEmpty(plan.text)) {
        const merged = await host.prMerged(branch);
        if (merged.ok && merged.value === 'not-merged') toDeletePlans.push(slug);
        recordFailure(slug, commit);
        continue;
      }
      const prState = await host.prState(branch);
      if (!prState.ok) {
        recordFailure(slug, commit);
        continue;
      }
      if (prState.value !== null) {
        recordSuccess();
        continue;
      }
      const created = await host.prCreate({
        head: branch,
        title: `${slug}: spec`,
        body: `Spec for ${slug}, written by the fleet.`,
        draft: true,
      });
      if (created.ok) recordSuccess();
      else recordFailure(slug, commit);
    }
    ended.push(...endedRuns.map((r) => r.slug));
    const ours = new Set([...Object.keys(stillRunning), ...ended]);

    for (const plan of candidates.plans.values()) {
      if (ours.has(plan.slug)) continue;
      const branch = designBranch(plan.slug);
      const specRef = await specRefOf(refs, defaultBranchName, branch);

      const designCommit = designCommitOf(plan.text);
      if (specRef === 'work') {
        const prState = await host.prState(branch);
        if (prState.ok) {
          orphans[plan.slug] = { tip: designCommit, hasPr: prState.value !== null && prState.value.state === 'OPEN' };
        }
      }

      const prRetry = failures[plan.slug]?.reading === designCommit;
      const answer = designWork({ state: plan.state, text: plan.text, specRef, prRetry });
      if (answer === 'none') continue;

      const store: DesignStore = { failures, failedAt, lastSuccessAt, declined, answeredPr, restart: current.restart, orphans };
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
      if (startAnswer.reason !== 'ask-host') {
        refusals[plan.slug] = startAnswer.reason;
        continue;
      }
      const pr = await host.prState(branch);
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
        going.add(plan.slug);
        stillRunning[plan.slug] = { pid: 0, commit: designCommit, startedAt: now };
      }
    }

    const finalStore: DesignStore = { failures, failedAt, lastSuccessAt, declined, answeredPr, restart: current.restart, orphans };
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
  for (const slug of toDeletePlans) {
    const branch = designBranch(slug);
    const tip = await refs.remoteSha(branch);
    await trees.deleteRemoteBranch(branch, tip.ok && tip.value !== 'unknown' ? tip.value.sha : '');
  }
  if (pick.slug === null) return [];
  await startDesignRun(opts, pick.slug, pick.planFile, world);
  return [pick.slug];
};

/**
 * Starts the run of one plan, in its own worktree checked out on the spec
 * branch, and records its pid and its end in the state.
 */
const startDesignRun = async (
  opts: ActOptions,
  slug: string,
  planFile: string,
  world: DesignPassWorld,
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
  const added = await trees.addBranch(dir, branch, `origin/${branch}`);
  if (!added.ok) {
    console.error(`auto-design: ${slug} could not create its worktree`);
    return;
  }
  const committed = await trees.commit(dir, `${CLAIM_SUBJECT_PREFIX}${branch}`);
  if (!committed.ok) {
    console.error(`auto-design: ${slug} could not commit its claim`);
    return;
  }
  const pushed = await trees.push(dir, branch);
  if (!pushed.ok) {
    console.error(`auto-design: ${slug} claim push was rejected; another run holds the branch`);
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

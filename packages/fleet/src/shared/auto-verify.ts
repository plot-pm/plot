import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  autoVerify,
  settleVerifyRuns,
  verificationRow,
  verifyHalted,
  verifyStart,
  type FleetReading,
  type Headroom,
  type HeldSlice,
  type VerificationRow,
  type VerifyPlanReading,
  type VerifyRefusal,
  type VerifySettlement,
  type VerifyStore,
} from '@plot-pm/domain';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { planSlugOf } from '@plot-pm/domain/rules/plan-pr';
import { verificationOf } from '@plot-pm/domain/rules/verification-record';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { BoardRunRecord } from '@plot-pm/domain/rules/board-run-end';
import { readConfig } from './config-reader.js';
import { usableCommand } from './usable-command.js';
import { scriptsOf, verifyLogPath, type ActOptions } from './action-log.js';
import { startBoardRun } from './board-run.js';
import { boundSecondsOf as sharedBoundSecondsOf, pidAlive, readRunState, runGoing, updateRunState } from './fleet-run.js';

/** The `## Plot Config` key naming the command that starts a verify run. */
export const VERIFY_COMMAND_KEY = 'Verify command';

/** The `## Plot Config` key that switches automatic verification on. */
export const AUTO_VERIFY_KEY = 'Auto-verify';

export { WORKER_BOUND_KEY } from './fleet-run.js';

/** `Worker bound` where the key is absent or not a positive whole number of seconds. */
export const DEFAULT_VERIFY_BOUND_SECONDS = 28800;

/** How long a run whose agent pid is not yet recorded counts as going. */
export const VERIFY_START_GRACE_MS = 5 * 60 * 1000;

/** The directory that holds one plan's verification trees and facts. */
export const verifyRunDir = (repoRoot: string, slug: string): string =>
  path.join(repoRoot, '.plot', 'state', 'verify', slug);

/**
 * The prompt handed to `Verify command`.
 *
 * The agent runs `prepare` first, because the tools tree it builds holds the
 * skill text the rest of the run follows. Every skill file the prompt names is
 * the tools tree's copy, by absolute path, never an installed skill.
 *
 * @param slug - the plan slug.
 * @param repoRoot - the repository the fleet serves, absolute.
 * @param scriptsDir - the directory that holds `board/plot-verify.mjs`, absolute.
 * @returns the prompt.
 */
export const verifyPrompt = (slug: string, repoRoot: string, scriptsDir: string): string => {
  const tools = path.join(verifyRunDir(repoRoot, slug), 'tools');
  const deliver = path.join(tools, 'skills', 'plot-deliver', 'SKILL.md');
  const panel = path.join(tools, 'skills', 'plot-panel', 'SKILL.md');
  return [
    `Verify the Delivered plan ${slug}. This is /plot-deliver --verify ${slug}, run unattended by the fleet.`,
    `1. Run: node ${path.join(scriptsDir, 'board', 'plot-verify.mjs')} prepare ${slug}`,
    '   If it exits non-zero, stop and report the refusal it printed.',
    `2. Read ${deliver}, section "Verify mode". Follow V4 to V6 of that file. The fleet checked V1 and V2, and step 1 is V3.`,
    `3. In V5, run the panel as ${panel} says.`,
    'Do not use an installed /plot-deliver or /plot-panel skill. If a file named above does not exist, stop and name it.',
  ].join('\n');
};

/** One Delivered plan as the default branch reads it. */
export interface VerifyCandidate extends VerifyPlanReading {
  readonly slug: string;
  readonly tracer: boolean;
}

/** The Delivered plans at the default branch, and the plans that could not be read. */
export interface VerifyCandidates {
  /** The plans that read `State: Delivered` at the default branch, by slug. */
  readonly plans: ReadonlyMap<string, VerifyCandidate>;
  /** The plans the pass asked about and could not read, with the reason. */
  readonly unread: ReadonlyMap<string, string>;
}

/** What the pass reads and does besides the config and the store; each is replaceable in a test. */
export interface VerifyPassWorld {
  /** The Delivered plans at the default branch, among the pulse's Delivered plans and the slugs asked for. */
  readonly candidates: (opts: ActOptions, pulse: FleetReading, wanted: ReadonlySet<string>) => Promise<VerifyCandidates>;
  /** Whether a process with this pid is alive. */
  readonly alive: (pid: number) => boolean;
  /** Removes one plan's verification trees through the trees port. */
  readonly removeTrees: (opts: ActOptions, slug: string) => Promise<void>;
}

/** What the daemon reads once per pass and hands the verify pass. */
export interface VerifyPassReadings {
  readonly headroom: Headroom;
  readonly machineOverride: boolean;
  /** The slices the queue's last pass held, or `null` where no pass has been read. */
  readonly held: readonly HeldSlice[] | null;
}

/** One verify run this fleet started. */
export interface VerifyRun {
  /** The agent's pid; `0` until the run has started it. */
  readonly pid: number;
  /** The delivery commit the run judges. */
  readonly commit: string;
  /** Epoch milliseconds of the start. */
  readonly startedAt: number;
  /** The exit code, once the run ended in this fleet process. */
  readonly code?: number;
  /** Epoch milliseconds of the end, once the run ended in this fleet process. */
  readonly endedAt?: number;
}

/** How one finished run settled, for the fleet status. */
export interface VerifyOutcome {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly settlement: VerifySettlement;
}

/** `.plot/state/auto-verify-in-flight.json`. Separate from the delivery store by design. */
export interface VerifyStateFile extends VerifyStore {
  /** The runs this fleet started that have not settled. */
  readonly running: Readonly<Record<string, VerifyRun>>;
  /** The last refusal per plan, for the fleet status. */
  readonly refusals: Readonly<Record<string, VerifyRefusal>>;
  /** The *Waiting on you* rows of the plans whose verification needs a person. */
  readonly rows: readonly VerificationRow[];
  /** The last settled run per plan. */
  readonly last: Readonly<Record<string, VerifyOutcome>>;
}

const EMPTY: VerifyStateFile = {
  failures: {},
  failedAt: [],
  lastSuccessAt: 0,
  running: {},
  refusals: {},
  rows: [],
  last: {},
};

/** Where the verify state lives. */
export const verifyStatePath = (repoRoot: string): string =>
  path.join(repoRoot, '.plot', 'state', 'auto-verify-in-flight.json');

/**
 * Reads the verify state.
 *
 * @param repoRoot - the repository the fleet serves.
 * @returns the state; the empty state where no file exists; `null` where a file exists and cannot be read.
 */
export const readVerifyState = (repoRoot: string): VerifyStateFile | null => {
  const raw = readRunState<Partial<VerifyStateFile>>(verifyStatePath(repoRoot), EMPTY);
  if (raw === null) return null;
  return {
    failures: raw.failures ?? {},
    failedAt: Array.isArray(raw.failedAt) ? raw.failedAt : [],
    lastSuccessAt: typeof raw.lastSuccessAt === 'number' ? raw.lastSuccessAt : 0,
    running: raw.running ?? {},
    refusals: raw.refusals ?? {},
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    last: raw.last ?? {},
  };
};

/**
 * Reads, changes and writes the verify state in one synchronous step, so no
 * other callback of this process writes between the read and the write.
 *
 * @param repoRoot - the repository the fleet serves.
 * @param change - the new state from the current one.
 * @returns the state written, or `null` where the current file cannot be read; nothing is written then.
 */
export const updateVerifyState = (
  repoRoot: string,
  change: (current: VerifyStateFile) => VerifyStateFile,
): VerifyStateFile | null => updateRunState(verifyStatePath(repoRoot), EMPTY, change);

/**
 * Whether a run this fleet started is still going: no end recorded, and its
 * agent alive, or its agent not yet recorded inside {@link VERIFY_START_GRACE_MS}.
 *
 * @param run - the run.
 * @param alive - whether a pid is alive.
 * @param now - epoch milliseconds.
 * @returns `true` while the run is going.
 */
export const verifyRunGoing = (run: VerifyRun, alive: (pid: number) => boolean, now: number): boolean =>
  runGoing(run, alive, now, VERIFY_START_GRACE_MS);

/** The verify runs going now: the ones this fleet started that have not ended. */
export const verifyingCount = (
  repoRoot: string,
  alive: (pid: number) => boolean = pidAlive,
  now: number = Date.now(),
): number => {
  const state = readVerifyState(repoRoot);
  return state === null ? 0 : Object.values(state.running).filter((run) => verifyRunGoing(run, alive, now)).length;
};

/** The fields of one `plot-plan-meta.sh` line the pass reads. */
interface MetaLine {
  readonly file: string;
  readonly phase: string;
  readonly tracer: boolean;
  readonly deliveredRaw: string;
  readonly verifiedRaw: string;
}

const metaLines = (stdout: string): MetaLine[] =>
  stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
        return [
          {
            file: text('file'),
            phase: text('phase'),
            tracer: raw.tracer === true,
            deliveredRaw: text('delivered_raw'),
            verifiedRaw: text('verified_raw'),
          },
        ];
      } catch {
        return [];
      }
    });

/** The ports {@link readVerifyCandidatesWith} reads through. */
export interface VerifyCandidatePorts {
  readonly refs: Pick<Refs, 'defaultBranch' | 'showFile' | 'recordCommit'>;
  readonly scripts: Pick<Scripts, 'planMeta'>;
}

/**
 * Reads the Delivered plans at `origin/<default branch>`, the ref the record
 * is pushed to, never the working tree.
 *
 * It asks about the pulse's Delivered plans and every plan whose slug is in
 * `wanted`. Each plan's text is read at the ref and parsed by
 * `plot-plan-meta.sh`, which gives the phase, the tracer field and the
 * `Delivered:` and `Verified:` values. A plan that no longer reads Delivered
 * there is left out. A plan whose text, fields or delivery commit cannot be
 * read is listed in `unread` with the reason: an error is not a reading.
 *
 * @param ports - the refs and scripts ports.
 * @param pulse - the pulse the scan just wrote.
 * @param wanted - the slugs to read whatever phase the pulse gives them.
 * @returns the plans and the unread ones.
 */
export const readVerifyCandidatesWith = async (
  ports: VerifyCandidatePorts,
  pulse: FleetReading,
  wanted: ReadonlySet<string>,
): Promise<VerifyCandidates> => {
  const asked = pulse.plans.filter((plan) => plan.phase === 'delivered' || wanted.has(planSlugOf(plan.file)));
  const plans = new Map<string, VerifyCandidate>();
  const unread = new Map<string, string>();
  if (asked.length === 0) return { plans, unread };
  const main = await ports.refs.defaultBranch();
  if (!main.ok) {
    for (const plan of asked) unread.set(planSlugOf(plan.file), 'the default branch cannot be named');
    return { plans, unread };
  }
  const ref = `origin/${main.value}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-verify-meta-'));
  try {
    const texts = new Map<string, { file: string; text: string }>();
    for (const plan of asked) {
      const slug = planSlugOf(plan.file);
      const text = await ports.refs.showFile(ref, plan.file);
      if (!text.ok) {
        unread.set(slug, `the plan cannot be read at ${ref}`);
        continue;
      }
      const copy = path.join(dir, path.basename(plan.file));
      fs.writeFileSync(copy, text.value, 'utf8');
      texts.set(copy, { file: plan.file, text: text.value });
    }
    if (texts.size === 0) return { plans, unread };
    const meta = await ports.scripts.planMeta([...texts.keys()]);
    const lines = meta.ok ? metaLines(meta.value) : [];
    const byCopy = new Map(lines.map((line) => [line.file, line]));
    for (const [copy, { file, text }] of texts) {
      const slug = planSlugOf(file);
      const line = byCopy.get(copy);
      if (line === undefined) {
        unread.set(slug, `plot-plan-meta.sh gave no reading of the plan at ${ref}`);
        continue;
      }
      if (line.phase !== 'delivered') continue;
      const found = await ports.refs.recordCommit(file, 'Delivered');
      if (!found.ok || found.value === null) {
        unread.set(slug, 'the delivery commit cannot be read');
        continue;
      }
      const state = verificationOf(
        { text, tracer: line.tracer, deliveredRaw: line.deliveredRaw, verifiedRaw: line.verifiedRaw },
        found.value,
      );
      plans.set(slug, {
        slug,
        tracer: line.tracer,
        deliveryCommit: found.value,
        verified: state === 'supported' || state === 'refuted',
      });
    }
    return { plans, unread };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** {@link readVerifyCandidatesWith} over this repository's refs and scripts. */
export const readVerifyCandidates = (
  opts: ActOptions,
  pulse: FleetReading,
  wanted: ReadonlySet<string>,
): Promise<VerifyCandidates> =>
  readVerifyCandidatesWith(
    { refs: refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }), scripts: scriptsOf(opts) },
    pulse,
    wanted,
  );

/**
 * Removes one plan's verification trees through the trees port, then the
 * directory that held them and their facts.
 *
 * @param opts - where the fleet acts.
 * @param slug - the plan slug.
 */
export const removeVerifyTrees = async (opts: ActOptions, slug: string): Promise<void> => {
  const dir = verifyRunDir(opts.repoRoot, slug);
  if (!fs.existsSync(dir)) return;
  const trees = treesGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
  for (const tree of ['tools', 'pin']) {
    if (fs.existsSync(path.join(dir, tree))) await trees.removeOnly(path.join(dir, tree));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  await trees.prune();
};

const defaultWorld: VerifyPassWorld = {
  candidates: readVerifyCandidates,
  alive: pidAlive,
  removeTrees: removeVerifyTrees,
};

/** `Worker bound` in seconds, or {@link DEFAULT_VERIFY_BOUND_SECONDS}. */
const boundSecondsOf = (opts: ActOptions): number => sharedBoundSecondsOf(opts, DEFAULT_VERIFY_BOUND_SECONDS);

/**
 * One verification pass: settle the runs this fleet started that ended,
 * remove their trees, then start at most one run that `verifyStart` allows.
 *
 * With `Auto-verify` off, the pass records `off` for every Delivered plan and
 * does nothing else: it settles nothing and removes no tree. It removes only
 * the trees of runs it started; a tree a person's `/plot-deliver --verify`
 * holds is never removed, and its plan is refused as `hand-run`.
 *
 * The decision is one synchronous state update, so a run's start and end
 * callbacks never write between its read and its write.
 *
 * @param opts - where the fleet acts.
 * @param pulse - the pulse the scan just wrote.
 * @param readings - the machine and queue readings of this pass.
 * @param now - epoch milliseconds.
 * @param world - what the pass reads and does besides config and store.
 * @returns the slugs whose runs started: none or one.
 */
export const runAutoVerifyPass = async (
  opts: ActOptions,
  pulse: FleetReading | null,
  readings: VerifyPassReadings,
  now: number = Date.now(),
  world: VerifyPassWorld = defaultWorld,
): Promise<string[]> => {
  const verifyCommand = usableCommand(readConfig(opts, VERIFY_COMMAND_KEY, ''));
  const on = autoVerify({ autoVerify: readConfig(opts, AUTO_VERIFY_KEY, '') === 'true', verifyCommand });
  const before = readVerifyState(opts.repoRoot);
  if (before === null) {
    console.log('auto-verify: cannot read the verify state; starting nothing this pass');
    return [];
  }
  if (pulse === null) return [];
  const candidates = await world.candidates(opts, pulse, new Set(Object.keys(before.running)));

  if (!on) {
    updateVerifyState(opts.repoRoot, (current) => ({
      ...current,
      refusals: Object.fromEntries([...candidates.plans.keys()].map((slug) => [slug, 'off' as const])),
    }));
    return [];
  }

  const pick: { slug: string | null } = { slug: null };
  const ended: string[] = [];
  const written = updateVerifyState(opts.repoRoot, (current) => {
    const going = new Set<string>();
    const endedRuns: { slug: string; commit: string; code: number | null; run: VerifyRun }[] = [];
    const running: Record<string, VerifyRun> = {};
    for (const [slug, run] of Object.entries(current.running)) {
      if (verifyRunGoing(run, world.alive, now)) {
        going.add(slug);
        running[slug] = run;
      } else if (candidates.unread.has(slug)) {
        // AN UNREAD PLAN IS NOT A GONE ONE: the run settles on a later pass.
        running[slug] = run;
      } else {
        endedRuns.push({ slug, commit: run.commit, code: run.code ?? null, run });
      }
    }
    const settled = settleVerifyRuns(current, endedRuns, candidates.plans, going, now);
    const last = { ...current.last };
    for (const { slug, settlement } of settled.settled) {
      const run = endedRuns.find((r) => r.slug === slug)?.run;
      if (run !== undefined) last[slug] = { startedAt: run.startedAt, endedAt: run.endedAt ?? now, settlement };
    }
    ended.push(...endedRuns.map((r) => r.slug));
    const ours = new Set([...Object.keys(running), ...ended]);

    const refusals: Record<string, VerifyRefusal> = {};
    for (const plan of candidates.plans.values()) {
      if (plan.verified) continue;
      const answer = verifyStart({
        on,
        slug: plan.slug,
        tracer: plan.tracer,
        deliveryCommit: plan.deliveryCommit,
        headroom: readings.headroom,
        machineOverride: readings.machineOverride,
        held: readings.held,
        going,
        handRun: !ours.has(plan.slug) && fs.existsSync(verifyRunDir(opts.repoRoot, plan.slug)),
        store: settled.store,
        now,
      });
      if (!answer.start) {
        refusals[plan.slug] = answer.reason;
        continue;
      }
      // ONE START PER PASS: the started run is going, so every later plan reads `running`.
      pick.slug = plan.slug;
      going.add(plan.slug);
      running[plan.slug] = { pid: 0, commit: plan.deliveryCommit, startedAt: now };
    }
    const rows = [...candidates.plans.values()].flatMap((plan) => {
      const row = verificationRow(plan.slug, plan.deliveryCommit, settled.store, verifyLogPath(opts.repoRoot, plan.slug), now);
      return row === null ? [] : [row];
    });
    return { ...settled.store, running, refusals, rows, last };
  });
  if (written === null) {
    console.log('auto-verify: cannot read the verify state; starting nothing this pass');
    return [];
  }
  for (const slug of ended) await world.removeTrees(opts, slug);
  if (verifyHalted(written)) {
    console.log('auto-verify: halted — 3 failed runs since the last success; run /plot-deliver --verify <slug> by hand');
  }
  if (pick.slug === null) return [];
  await startVerifyRun(opts, pick.slug);
  return [pick.slug];
};

/**
 * Starts the run of one plan whose placeholder the pass has written, and
 * records its pid and its end in the state.
 *
 * @param opts - where the fleet acts.
 * @param slug - the plan slug.
 */
const startVerifyRun = async (opts: ActOptions, slug: string): Promise<void> => {
  const patch = (fields: Partial<VerifyRun>): void => {
    updateVerifyState(opts.repoRoot, (current) => {
      const run = current.running[slug];
      return run === undefined ? current : { ...current, running: { ...current.running, [slug]: { ...run, ...fields } } };
    });
  };
  await startBoardRun(
    opts,
    {
      role: 'verify',
      fragmentKey: VERIFY_COMMAND_KEY,
      tree: opts.repoRoot,
      prompt: verifyPrompt(slug, opts.repoRoot, opts.scriptsDir),
      env: { PLOT_UNATTENDED: '1', PLOT_PLAN_SLUG: slug },
      logFile: verifyLogPath(opts.repoRoot, slug),
      statePath: null,
      boundSeconds: boundSecondsOf(opts),
      onStarted: (pid) => patch({ pid }),
    },
    (record: BoardRunRecord) => patch({ code: record.code, endedAt: Date.now() }),
  ).catch((err: unknown) => {
    console.error(`auto-verify: ${slug} failed to start:`, err);
    patch({ code: 1, endedAt: Date.now() });
  });
};

/** What the fleet's status says about verification. */
export interface VerifyStatus {
  /** Whether the fleet starts no verify run of any plan. */
  readonly halted: boolean;
  /** The plans with a run this fleet started that has not settled. */
  readonly running: readonly string[];
  /** The last refusal per plan. */
  readonly refusals: Readonly<Record<string, VerifyRefusal>>;
  /** The *Waiting on you* rows. */
  readonly rows: readonly VerificationRow[];
  /** The last settled run per plan. */
  readonly last: Readonly<Record<string, VerifyOutcome>>;
}

/**
 * The fleet's verification status, read from the state the pass wrote.
 *
 * @param repoRoot - the repository the fleet serves.
 * @returns the status; `null` where the state file cannot be read.
 */
export const readVerifyStatus = (repoRoot: string): VerifyStatus | null => {
  const state = readVerifyState(repoRoot);
  if (state === null) return null;
  return {
    halted: verifyHalted(state),
    running: Object.keys(state.running),
    refusals: state.refusals,
    rows: state.rows,
    last: state.last,
  };
};

/**
 * The verification block of `/plot-fleet --status`.
 *
 * @param status - the status, or `null` where the state file cannot be read.
 * @returns the lines, each ending in a newline; empty where nothing was recorded.
 */
export const verifyStatusLines = (status: VerifyStatus | null): string => {
  if (status === null) return 'verification: the state file cannot be read\n';
  const refused = Object.entries(status.refusals);
  if (!status.halted && status.running.length === 0 && refused.length === 0 && status.rows.length === 0) return '';
  const out = [`verification: ${status.halted ? 'halted' : 'not halted'}, ${status.running.length} running, ${refused.length} refused`];
  for (const slug of status.running) out.push(`  ${slug}  running`);
  for (const [slug, reason] of refused) out.push(`  ${slug}  refused: ${reason}`);
  for (const row of status.rows) out.push(`  ${row.slug}  waiting on you: ${row.reason} — ${row.restart} (log ${row.log})`);
  return `${out.join('\n')}\n`;
};

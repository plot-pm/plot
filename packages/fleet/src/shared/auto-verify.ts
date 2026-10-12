import fs from 'node:fs';
import path from 'node:path';
import {
  autoVerify,
  recordVerifyFailure,
  verifyHalted,
  verifyStart,
  type FleetReading,
  type Headroom,
  type HeldSlice,
  type VerifyRefusal,
  type VerifyStore,
} from '@plot-pm/domain';
import { refsGit } from '@plot-pm/domain/adapters';
import { verificationOf } from '@plot-pm/domain/rules/verification-record';
import { readConfig } from './config-reader.js';
import { usableCommand } from './usable-command.js';
import { verifyLogPath, type ActOptions } from './action-log.js';
import { startBoardRun } from './board-run.js';

/** The `## Plot Config` key naming the command that starts a verify run. */
export const VERIFY_COMMAND_KEY = 'Verify command';

/** The `## Plot Config` key that switches automatic verification on. */
export const AUTO_VERIFY_KEY = 'Auto-verify';

/** The prompt handed to `Verify command`. The slug is the only variable. */
export const verifyPrompt = (slug: string): string => `/plot-deliver --verify ${slug}`;

/** One Delivered plan the pass may verify. */
export interface VerifyCandidate {
  readonly slug: string;
  readonly tracer: boolean;
  /** `recordCommit(file, 'Delivered')`, or `''` where it cannot be read. */
  readonly deliveryCommit: string;
  /** Whether the plan holds a current verification record: `supported` or `refuted`. */
  readonly verified: boolean;
}

/** What the pass reads besides the config and the store; each is replaceable in a test. */
export interface VerifyPassWorld {
  /** The Delivered plans of the pulse, with the readings the pulse lacks. */
  readonly candidates: (opts: ActOptions, pulse: FleetReading) => Promise<readonly VerifyCandidate[]>;
  /** Whether a process with this pid is alive. */
  readonly alive: (pid: number) => boolean;
}

/** What the daemon reads once per pass and hands the verify pass. */
export interface VerifyPassReadings {
  readonly headroom: Headroom;
  readonly machineOverride: boolean;
  readonly held: readonly HeldSlice[];
}

/** One verify run this machine started. */
export interface VerifyRun {
  readonly pid: number;
  readonly commit: string;
  readonly startedAt: number;
}

/** `.plot/state/auto-verify-in-flight.json`. Separate from the delivery store by design. */
export interface VerifyStateFile extends VerifyStore {
  readonly running: Readonly<Record<string, VerifyRun>>;
  /** The last refusal per plan, for the fleet status. */
  readonly refusals: Readonly<Record<string, VerifyRefusal>>;
}

const EMPTY: VerifyStateFile = { failures: {}, failedAt: [], lastSuccessAt: 0, running: {}, refusals: {} };

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
  let text: string;
  try {
    text = fs.readFileSync(verifyStatePath(repoRoot), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? EMPTY : null;
  }
  try {
    const raw = JSON.parse(text) as Partial<VerifyStateFile>;
    return {
      failures: raw.failures ?? {},
      failedAt: Array.isArray(raw.failedAt) ? raw.failedAt : [],
      lastSuccessAt: typeof raw.lastSuccessAt === 'number' ? raw.lastSuccessAt : 0,
      running: raw.running ?? {},
      refusals: raw.refusals ?? {},
    };
  } catch {
    return null;
  }
};

const writeVerifyState = (repoRoot: string, state: VerifyStateFile): void => {
  const file = verifyStatePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
  fs.renameSync(tmp, file);
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const FIELD = /^[-*\s]*\**(Delivered|Verified):?\**:?\s*(.*)$/gim;

/** The `Delivered:` and `Verified:` values of a plan's text, `''` for an absent one. */
const recordFields = (text: string): { delivered: string; verified: string } => {
  const found = { delivered: '', verified: '' };
  for (const m of text.matchAll(FIELD)) {
    const key = m[1]!.toLowerCase() === 'delivered' ? 'delivered' : 'verified';
    if (found[key] === '') found[key] = m[2]!.replace(/\*+$/, '').trim();
  }
  return found;
};

/**
 * The Delivered plans of a pulse, read from the plan files and the delivery
 * commit. A plan whose text or delivery commit cannot be read is left out: an
 * error is not a reading, and starting a run on one would judge an unknown commit.
 */
export const readVerifyCandidates = async (
  opts: ActOptions,
  pulse: FleetReading,
): Promise<readonly VerifyCandidate[]> => {
  const refs = refsGit({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir });
  const out: VerifyCandidate[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase !== 'delivered') continue;
    let text: string;
    try {
      text = fs.readFileSync(path.resolve(opts.repoRoot, plan.file), 'utf8');
    } catch {
      continue;
    }
    const found = await refs.recordCommit(plan.file, 'Delivered');
    if (!found.ok || !found.value) continue;
    const fields = recordFields(text);
    const state = verificationOf(
      { text, tracer: plan.tracer, deliveredRaw: fields.delivered, verifiedRaw: fields.verified },
      found.value,
    );
    out.push({
      slug: path.basename(plan.file, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
      tracer: plan.tracer,
      deliveryCommit: found.value,
      verified: state === 'supported' || state === 'refuted',
    });
  }
  return out;
};

const defaultWorld: VerifyPassWorld = { candidates: readVerifyCandidates, alive: pidAlive };

/** The verify runs going now: the ones this state holds under a live pid. */
export const verifyingCount = (repoRoot: string, alive: (pid: number) => boolean = pidAlive): number => {
  const state = readVerifyState(repoRoot);
  return state === null ? 0 : Object.values(state.running).filter((run) => alive(run.pid)).length;
};

/**
 * Removes the verification trees whose preparer is dead and that hold no live run.
 *
 * `prepare` writes `.plot-verify.pid` into `pin/` and exits; a tree under a
 * dead pid with no running entry in the state is what a killed run leaves.
 *
 * @returns the slugs whose trees were removed.
 */
export const sweepVerifyTrees = (
  repoRoot: string,
  running: Readonly<Record<string, VerifyRun>>,
  alive: (pid: number) => boolean = pidAlive,
): string[] => {
  const root = path.join(repoRoot, '.plot', 'state', 'verify');
  let slugs: string[];
  try {
    slugs = fs.readdirSync(root);
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const slug of slugs) {
    const held = running[slug];
    if (held !== undefined && alive(held.pid)) continue;
    let pid: number;
    try {
      pid = Number(fs.readFileSync(path.join(root, slug, 'pin', '.plot-verify.pid'), 'utf8').trim());
    } catch {
      continue;
    }
    if (Number.isFinite(pid) && alive(pid)) continue;
    try {
      fs.rmSync(path.join(root, slug), { recursive: true, force: true });
      swept.push(slug);
    } catch {
      /* the next pass tries again */
    }
  }
  return swept;
};

/**
 * One verification pass: sweep dead trees, settle ended runs, then start what
 * `verifyStart` allows.
 *
 * Refusals are persisted per plan in the state file so the fleet status can
 * name them. A run counts as failed when its process ended and the plan still
 * holds no current record for the delivery commit; it counts as a success
 * when it does.
 *
 * @param opts - where the fleet acts.
 * @param pulse - the pulse the scan just wrote.
 * @param readings - the machine and queue readings of this pass.
 * @param now - epoch milliseconds.
 * @param world - what the pass reads besides config and store.
 * @returns the slugs whose runs started.
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
  const state = readVerifyState(opts.repoRoot);
  if (state === null) {
    console.log('auto-verify: cannot read the verify state; starting nothing this pass');
    return [];
  }
  const swept = sweepVerifyTrees(opts.repoRoot, state.running, world.alive);
  if (swept.length > 0) console.log(`auto-verify: removed dead verification trees: ${swept.join(', ')}`);
  if (pulse === null) return [];

  const candidates = await world.candidates(opts, pulse);
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));

  // SETTLE ENDED RUNS. A run that ended and left a current record succeeded;
  // one that ended without it failed under the commit it judged.
  let { failures, failedAt, lastSuccessAt } = state;
  const running: Record<string, VerifyRun> = {};
  for (const [slug, run] of Object.entries(state.running)) {
    if (world.alive(run.pid)) {
      running[slug] = run;
      continue;
    }
    const plan = bySlug.get(slug);
    if (plan?.verified) {
      lastSuccessAt = now;
      failures = Object.fromEntries(Object.entries(failures).filter(([key]) => key !== slug));
    } else {
      failures = { ...failures, [slug]: recordVerifyFailure(failures[slug], run.commit, now) };
      failedAt = [...failedAt, now];
    }
  }
  const store: VerifyStore = { failures, failedAt, lastSuccessAt };

  const refusals: Record<string, VerifyRefusal> = {};
  const started: string[] = [];
  const going = new Set(Object.keys(running));
  for (const plan of candidates) {
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
      store: { failures, failedAt, lastSuccessAt },
      now,
    });
    if (!answer.start) {
      refusals[plan.slug] = answer.reason;
      continue;
    }
    const log = verifyLogPath(opts.repoRoot, plan.slug);
    let pid = 0;
    void startBoardRun(
      opts,
      {
        role: 'verify',
        fragmentKey: VERIFY_COMMAND_KEY,
        tree: opts.repoRoot,
        prompt: verifyPrompt(plan.slug),
        env: { PLOT_UNATTENDED: '1', PLOT_PLAN_SLUG: plan.slug },
        logFile: log,
        statePath: null,
        onStarted: (agentPid) => {
          pid = agentPid;
          const current = readVerifyState(opts.repoRoot) ?? EMPTY;
          writeVerifyState(opts.repoRoot, {
            ...current,
            running: { ...current.running, [plan.slug]: { pid, commit: plan.deliveryCommit, startedAt: Date.now() } },
          });
        },
      },
    ).catch((err: unknown) => console.error(`auto-verify: ${plan.slug} failed to start:`, err));
    going.add(plan.slug);
    started.push(plan.slug);
  }

  writeVerifyState(opts.repoRoot, { ...store, running, refusals });
  if (verifyHalted(store)) {
    console.log('auto-verify: halted — 3 failed runs since the last success; run /plot-deliver --verify <slug> by hand');
  }
  return started;
};

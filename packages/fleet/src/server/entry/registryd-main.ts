import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hostShell,
  performerShell,
  processesShell,
  refsGit,
  refsRemoteGit,
  buildShell,
  defaultBranchFile,
  repairRecordFile,
  scriptsShell,
  treesGit,
  machineSystem,
  planStoreShell,
  planStoreRef,
  scriptPath,
  prIndexFile,
  readerLockFile,
  issueIndexFile,
  issueWriteSpoolOver,
  supervisionReportFile,
  tempSweepShell,
  notifierCommand,
  notifierNone,
  freshAgentRecordFile,
  endingAskRecordFile,
  refusedSlicesFile,
  runLogFile,
  deskFs,
  agentsFs,
  fleetStateFile,
  clockSystem,
  startChannel,
  fleetdStartFile,
  writeProbeShell,
  type RunningChannel,
} from '@plot-pm/domain/adapters';
import { FLEETD_START_VERSION, type FleetdStart } from '@plot-pm/domain/entities/fleetd-start';
import { SPAWN_CONTRACT } from '@plot-pm/domain/rules/spawn-contract';
import type { WriteProbe } from '@plot-pm/domain/ports/write-probe';
import { writeProbeNeeded, writeProbeOutcome } from '@plot-pm/domain/rules/write-probe';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import type { Clock } from '@plot-pm/domain/ports/clock';
import type { SliceRefusal, RefusedSliceRecord } from '@plot-pm/domain/ports/refused-slices';
import type { NotifyWrite, IdleNotifyWrite } from '@plot-pm/domain/workflows/decision';
import {
  parseQuestionEscalation,
  DEFAULT_QUESTION_ESCALATION,
} from '@plot-pm/domain/rules/question-escalation';
import { parseSliceIdleAfter, DEFAULT_SLICE_IDLE_AFTER, idleEpisodeKey } from '@plot-pm/domain/rules/slice-idle';
import type { SliceIdleReading } from '@plot-pm/domain/rules/slice-idle';
import type { TempSweep } from '@plot-pm/domain/ports/temp-sweep';
import { tempSweepDue } from '@plot-pm/domain/rules/temp-sweep';
import { headroomFor } from '@plot-pm/domain/entities/machine';
import type { FleetCap } from '@plot-pm/domain/workflows/assign';
import type { Performer } from '@plot-pm/domain/ports/performer';
import type { Host, MergedAnswer } from '@plot-pm/domain/ports/host';
import type { HeldSlice, PortResult } from '@plot-pm/domain';
import { answered, failed } from '@plot-pm/domain';
import { deskDead, type DeskDeadAnswer } from '@plot-pm/domain/rules/desk-dead';
import { landed, type LandedAnswer } from '@plot-pm/domain/rules/landed';
import { indexMergedHeads, mergedSetWindowFor, viewLanded } from '@plot-pm/domain/rules/known-pr';
import { checkNamesOf, checksWaitMsOf, defaultBranchRed, mainRepairBoundMsOf } from '@plot-pm/domain/rules/default-branch';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { PlanRecord, PlanStore } from '@plot-pm/domain/ports/plan-store';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import type { EndingAskRecordStore } from '@plot-pm/domain/ports/ending-ask-record';
import type { RunLog } from '@plot-pm/domain/ports/run-log';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import { answerRecordFile } from '@plot-pm/domain/adapters/answer-record/answer-record-file';
import { mergeSubjectForms } from '@plot-pm/domain/adapters/host/merge-subjects';
import { mergedBySubject } from '@plot-pm/domain/rules/merge-subject';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';
import type { DeskMergeReading, PlanBranchLine } from '@plot-pm/domain/rules/gates';

import { parseManifest, AGENT_MANIFEST_DIR, AGENT_MANIFEST_DIR_KEY, type AgentEntry } from '../../shared/registry.js';
import { fleetPrs, fleetScan, startFleetClock } from '../../shared/fleet-clock.js';
import { fleetAutoWrites } from '../../shared/auto-writes.js';
import { verifyingCount } from '../../shared/auto-verify.js';
import { specRunningCount } from '../../shared/auto-design.js';
import { boundSecondsOfKey, pidAlive } from '../../shared/fleet-run.js';
import { readAutoReview } from '../../shared/auto-review.js';
import { releaseTick } from '../../shared/release-tick.js';
import { repairStartWorldOf } from '../../shared/repair-start-world.js';
import { repairStartTick } from '../../shared/repair-start.js';
import { repairRevertTick } from '../../shared/revert-start.js';
import { revertWorldOf } from '../../shared/revert-start-world.js';
import { releasePortsFor } from '../../shared/release-world.js';
import { detachedNode } from '@plot-pm/domain/adapters/detached/detached-node';
import { runDeskRelay } from '../../shared/desk-relay.js';
import { runIndexMonitor, sliceBranchesOf } from '../../shared/index-monitor.js';
import { fleetIssues, fleetIssueWrites, freshIssueState, issueGateOf } from '../../shared/issue-refresh.js';
import { freshPrState, withHostSlot } from '../../shared/pr-refresh.js';
import { refreshDefaultBranch } from '../../shared/default-branch-refresh.js';
import { freshScanState, planDirectory } from '../../shared/fleet-scan.js';
import { readFleetSettings } from '../../shared/fleet-settings-store.js';
import { readConfigAsync } from '../../shared/config-reader.js';
import { markerReading } from '../../shared/worker-question.js';
import {
  appendEscalation,
  escalationMemory,
  escalationsPath,
  readEscalations,
  recordedRungsFor,
  rememberEscalation,
  type EscalationMemory,
} from '../../shared/escalations.js';
import {
  fileOrNull,
  worldFrom,
  type SupervisorWorld,
  type TreeReading,
} from '../../shared/supervisor.js';
import type { QueueWorld, HandOverWorld, MergedListing } from '../../shared/queue-reading.js';
import {
  tick,
  tickLine,
  unclaimedLines,
  freshAgentCandidateTrees,
  killedWorkerEndings,
  type KilledWorkerReads,
  readFreshAgentCandidates,
  freshAgentDecisions,
  applyFreshAgentDecisions,
  freshAgentLines,
  nothingDoneCandidateTrees,
  readNothingDoneCandidates,
  nothingDoneDecisions,
  prOpenReading,
  prMergedReading,
  applyNothingDoneDecisions,
  nothingDoneLines,
  type FreshAgentPorts,
  type FreshAgentAskReads,
  type FreshAgentApplied,
  type NothingDoneApplied,
  TICK_INTERVAL_MS,
  type TickReport,
  type TickSpend,
  type EscalationWorld,
  type SliceIdleReader,
} from './registryd.js';
import { gatherReadingsAndRelease } from '../../shared/release-claim-reader.js';
import type { CommitReading } from '@plot-pm/domain/rules/sample';
import type { PrOpenReading } from '@plot-pm/domain/rules/ending-action';
import { loopSpendPerHour, type LoopSpend } from '@plot-pm/domain/rules/cadence';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import {
  QUEUE_HOLDS,
  handOverCheck,
  HAND_OVER_MAX_AGE_MS,
  type QueueHold,
} from '@plot-pm/domain/rules/queue';
import {
  SUPERVISION_REPORT_VERSION,
  type SupervisionReport,
} from '@plot-pm/domain/entities/supervision-report';
import type { SupervisionReportStore } from '@plot-pm/domain/ports/supervision-report';
import { logDir, processLog, truncateInherited } from '../../shared/process-log.js';
import { readConfig } from '../../shared/config-reader.js';
import { continueOnDesk, type DeskContinuation, type DeskContinuationInput } from '../../shared/continuation.js';
import { readDeskLoop } from '../../shared/desk-loop.js';
import type { Desk } from '@plot-pm/domain/ports/desk';
import { randomUUID } from 'node:crypto';
import type { Agents } from '@plot-pm/domain/ports/agents';

/**
 * `plot-fleetd` — the supervisor, one per repository.
 *
 * ```
 * node skills/plot/scripts/board/plot-fleetd.mjs           # loop
 * node skills/plot/scripts/board/plot-fleetd.mjs --once    # one tick
 * node skills/plot/scripts/board/plot-fleetd.mjs --dry-run # decide, write nothing
 * node skills/plot/scripts/board/plot-fleetd.mjs --start-agents  # and start them
 * node skills/plot/scripts/board/plot-fleetd.mjs --sweep-temp    # and sweep temp paths hourly
 * ```
 *
 * **A FIFTH artifact rather than a flag on the board's.** `index.ts` binds a
 * port at import time, so a daemon flag on it would mean a supervisor that also
 * serves a web page — and the two have different lifetimes, different failure
 * modes and different owners. `launchd`/`systemd` keeps this one alive; nothing
 * keeps the board alive.
 *
 * **It supervises the agents THIS repository registered, and only those.**
 * Settled in the plan: a daemon can act only on desks it can reach, because a
 * local `kill` reaches a local pid and reaping a worktree requires the worktree.
 * An agent dispatched from another machine dies unsupervised by this daemon, and
 * that cost is stated rather than hidden. Where several checkouts share one
 * `Agent registry` directory, sharing widens what is SEEN and never what can be
 * DONE.
 *
 * **DECIDING IS THE DEFAULT AND PERFORMING IS OPT-IN.** The tick names every
 * write and makes none; applying them is the performer's job, and this artifact
 * owns exactly one of them. `--start-agents` lets it start free agents for a
 * queue nothing can take — the last link in *dispatch queues, registry matches,
 * an agent takes it*, which had no starter at all until 2026-09-05. Every other
 * write the tick names is still decided and not performed, and a run without the
 * flag changes nothing on the machine.
 *
 * ```
 * node skills/plot/scripts/board/plot-fleetd.mjs --once --start-agents
 * ```
 */

/**
 * How many forks the headroom reading times.
 *
 * The same five `machine-reading.ts` takes. The board and the daemon ask one
 * machine on overlapping cadences, and two sample counts would let them reach
 * different verdicts about it in the same second.
 */
const MACHINE_SAMPLES = 5;

/**
 * The absolute path of the artifact this process runs: `plot-fleetd.mjs` in the
 * directory the entry point resolved as its own. A plugin-installed repository
 * holds no `skills/plot/`, so a path relative to the repository root names no
 * file there.
 *
 * @param here - the directory of the running artifact.
 * @returns the artifact's absolute path.
 */
export const fleetdBundlePath = (here: string): string => join(here, 'plot-fleetd.mjs');

/**
 * The record {@link run} writes to `fleetd-start.json` at its own start, or null
 * where the running artifact cannot be hashed.
 *
 * @param repoRoot - the checkout supervised; `git` runs there.
 * @param here - the directory of the running artifact.
 * @param scriptsDir - where the plot helper scripts sit.
 * @param pid - this process's id.
 * @param now - the start time, epoch milliseconds.
 * @returns the start record, or null when `git hash-object` fails on the artifact.
 */
export const fleetdStartRecord = (
  repoRoot: string,
  here: string,
  scriptsDir: string,
  pid: number,
  now: number,
): FleetdStart | null => {
  const bundlePath = fleetdBundlePath(here);
  const hashed = refsGit({ repoRoot, scriptDir: scriptsDir }).hashFilesSync([bundlePath]);
  const bundleHash = hashed.ok ? hashed.value.get(bundlePath) ?? null : null;
  return bundleHash === null
    ? null
    : { v: FLEETD_START_VERSION, pid, startedAt: now, spawnContract: SPAWN_CONTRACT, bundlePath, bundleHash };
};

/** Where the plot helper scripts sit, relative to this artifact. */
const scriptsDirFor = (here: string): string =>
  process.env.PLOT_SCRIPTS_DIR ?? join(here, '..');

/** What this process was asked to do. */
export interface DaemonArgs {
  /** Run one tick and exit, rather than looping. */
  once: boolean;
  /** How many agents one tick may act on; 0 for no bound. */
  max: number;
  /** How long to wait between ticks. */
  intervalMs: number;
  /**
   * Whether this daemon may START agents, rather than only deciding to.
   *
   * **OFF BY DEFAULT, AND THAT IS THE WHOLE FLAG.** Every other write this tick
   * names is still the performer's to apply and this artifact applies none; this
   * one starts detached processes that outlive the daemon, so it is the first
   * thing here that changes a machine. Making it opt-in keeps the documented
   * property — *the tick decides and performs nothing* — true of every run that
   * did not ask for the exception, including a `--once` an operator types to see
   * what the supervisor thinks.
   */
  startAgents: boolean;
  /**
   * Whether this daemon may run the temp sweep, at most once an hour.
   *
   * Off by default, like `startAgents`: it removes files, so a run that did
   * not ask for it still decides and performs nothing.
   */
  sweepTemp: boolean;
}

/**
 * Parses the daemon's arguments.
 *
 * `--dry-run` is ACCEPTED AND IGNORED rather than rejected: the tick performs
 * nothing, so a dry run is what every run already is. Refusing the flag would
 * make an operator think it changed something; refusing to name it would make
 * them think it was not considered.
 *
 * **IT STAYS ACCEPTED-AND-IGNORED NOW THAT `--start-agents` EXISTS**, because
 * the two are not opposites: `--dry-run` describes a run that writes nothing,
 * which is still what a run without `--start-agents` is. Making it refuse the
 * pair would be a third state to reason about for no behaviour nobody can
 * already express by leaving the other flag off.
 *
 * @param argv - the arguments after the script name.
 * @returns what to do, or null when an argument is not one this takes.
 */
export const argsFrom = (argv: readonly string[]): DaemonArgs | null => {
  const args: DaemonArgs = {
    once: false,
    max: 0,
    intervalMs: TICK_INTERVAL_MS,
    startAgents: false,
    sweepTemp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') args.once = true;
    else if (arg === '--start-agents') args.startAgents = true;
    else if (arg === '--sweep-temp') args.sweepTemp = true;
    else if (arg === '--dry-run') continue;
    else if (arg === '--max') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) return null;
      args.max = value;
    } else if (arg === '--interval') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return null;
      args.intervalMs = value * 1000;
    } else return null;
  }
  return args;
};

/**
 * Where this repository's registry is.
 *
 * Read from the `Agent registry` config key rather than assumed, because the key
 * exists precisely so several checkouts may share one directory — and on this
 * estate they do. A daemon reading `.plot/agents` inside a worktree finds it
 * empty while every manifest sits in the configured one, which would make a
 * supervisor that supervises nothing look like a supervisor with nothing to do.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @returns the registry directory, absolute.
 */
export const registryDirFor = (repoRoot: string, scriptsDir: string): string => {
  const answer = scriptsShell({ repoRoot, scriptDir: scriptsDir }).configSync(
    AGENT_MANIFEST_DIR_KEY,
    AGENT_MANIFEST_DIR,
  );
  const configured = (answer.ok ? answer.value : AGENT_MANIFEST_DIR).trim() || AGENT_MANIFEST_DIR;
  return isAbsolute(configured) ? configured : join(repoRoot, configured);
};

/**
 * How many unparseable manifests a looping tick names before it counts the
 * rest.
 *
 * **THIS EMITTER IS PROPORTIONAL TO THE REGISTRY, NOT THE ESTATE**, and it
 * wrote zero bytes of the 69 MB log that prompted the cap — no manifest was
 * unparseable. It was found by enumerating every emitter rather than by
 * measuring output, and one malformed file in the registry makes it a
 * permanent per-tick line for as long as the file sits there.
 */
const NAMED_BAD_MANIFESTS = 3;

/**
 * Reads every manifest in the registry.
 *
 * A manifest that does not parse is SKIPPED rather than refusing the tick: one
 * unreadable file must not stop a supervisor from picking up every other agent,
 * and the file is reported so it is not silently ignored.
 *
 * **A LOOPING TICK CAPS THE REPORT RATHER THAN DROPPING IT.** The held and
 * unclaimed blocks may go quiet on the loop because their counts survive on the
 * summary line; this line has no count anywhere else, and a broken manifest
 * that reports nothing is the silent skip the paragraph above refuses. So the
 * loop names three files and counts the rest, which follows the registry no
 * further however many break.
 *
 * @param dir - the registry directory.
 * @param warn - where to report a manifest that did not parse.
 * @param looping - whether this is the looping daemon rather than `--once`.
 *   Defaults to `--once`'s full report, so a caller that says nothing gets
 *   every name.
 * @returns the agents the registry declares, in directory order.
 */
export const readRegistry = async (
  dir: string,
  warn: (s: string) => void = (s) => process.stderr.write(s),
  looping = false,
): Promise<readonly AgentEntry[]> => {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    // NO REGISTRY IS NOT AN ERROR. A repository that has dispatched nothing has
    // no directory, and a supervisor over no agents is a supervisor with
    // nothing to do rather than a broken one.
    return [];
  }
  const entries: AgentEntry[] = [];
  let skipped = 0;
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => null);
    const entry = text === null ? null : parseManifest(text);
    if (entry === null) {
      skipped += 1;
      if (!looping || skipped <= NAMED_BAD_MANIFESTS) {
        warn(`plot-fleetd: ${name} is not a manifest this parse understands — skipped\n`);
      }
      continue;
    }
    entries.push(entry);
  }
  const unnamed = skipped - NAMED_BAD_MANIFESTS;
  if (looping && unnamed > 0) {
    warn(`plot-fleetd: … and ${unnamed} more manifests this parse does not understand\n`);
  }
  return entries;
};

/**
 * How many host calls the current tick has made.
 *
 * The two worlds, the fresh-agent step's ports and the nothing-done step's
 * `prOpen` port each add one per host call, including a release either step
 * triggers through `releaseClaimOf`. The loop reads it for `spendForTick`
 * directly after that reading, then zeroes it — NOT at the top of the tick,
 * because the fresh-agent and nothing-done steps run after the spend reading
 * and would otherwise add calls a reset-at-top wipes before the next tick's
 * own reading sees them. A tick whose `runTick` throws resets it in the
 * catch instead, so its partial calls do not carry into the tick that
 * follows. It carries nothing into the next tick and no decision reads it:
 * it exists to put this tick's own spend on the tick line.
 */
export interface HostTally {
  calls: number;
}

/**
 * The account's observed request rate, read from the budget record.
 *
 * Asked of `plot-host.sh spend-rate` through the scripts adapter. That op
 * reads a file every spender appends to and asks no host, so reading it
 * costs no request.
 *
 * @param scripts - the adapter that runs `plot-host.sh`.
 * @returns requests per hour, or null for no evidence: a failed or unaskable
 *   call, unparseable output, or a record with no span to divide by.
 */
export const accountRate = async (scripts: Pick<Scripts, 'hostSaid'>): Promise<number | null> => {
  try {
    const said = await scripts.hostSaid(['spend-rate']);
    if (said.answer !== 'answered') return null;
    const parsed: unknown = JSON.parse(said.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const perHour = (parsed as { perHour?: unknown }).perHour;
    return typeof perHour === 'number' && Number.isFinite(perHour) ? perHour : null;
  } catch {
    return null;
  }
};

/**
 * What the account spends beside what each fleetd loop spent, for the tick line.
 *
 * @param scripts - the adapter that runs `plot-host.sh`.
 * @param loops - each loop's own call count and interval — the tick, the
 *   scan, the PR reader, and the issue reader, each on its own cadence.
 * @returns the account's rate and each loop's own rate at its own calls.
 */
export const spendForTick = async (
  scripts: Pick<Scripts, 'hostSaid'>,
  loops: readonly LoopSpend[],
): Promise<TickSpend> => ({
  accountPerHour: await accountRate(scripts),
  perLoop: loopSpendPerHour(loops),
});

/**
 * The host's merge answer for a branch, asked at most once per tick.
 *
 * The supervisor world and the queue world ask the same question about the
 * same branch: `merge` for every registered agent, and `sliceHasMerged` for
 * every agent with a branch. Both read through one memo, so a busy agent costs
 * one host call per tick rather than two.
 */
export interface MergeMemo {
  /**
   * The raw port answer for `branch`. The first call in a tick asks the host;
   * every later call in the same tick shares that call's Promise.
   */
  ask(branch: string): Promise<PortResult<MergedAnswer>>;
  /** Forgets every answer, so the next tick asks again. */
  clear(): void;
}

/**
 * Builds a {@link MergeMemo} over a host.
 *
 * The memo holds the PROMISE, so two concurrent readers share one call, and the
 * RAW `PortResult`, so each consumer still derives its own word from a failed
 * call. A memo of booleans would read a host outage as *not merged*.
 *
 * @param host - the host to ask.
 * @returns a memo that is empty until its first `ask`.
 */
export const mergeMemoOver = (host: Pick<Host, 'prMerged'>): MergeMemo => {
  let asked = new Map<string, Promise<PortResult<MergedAnswer>>>();
  return {
    ask: (branch) => {
      const known = asked.get(branch);
      if (known !== undefined) return known;
      const answer = host.prMerged(branch);
      asked.set(branch, answer);
      return answer;
    },
    clear: () => {
      asked = new Map();
    },
  };
};

/**
 * Builds the world this daemon reads the estate through.
 *
 * Every reading goes through a port-backed adapter, and the adapters are the
 * only things here that reach the machine. A wrong answer in this function is a
 * wrong JOIN rather than a second implementation of a reading — which is the
 * property that lets `supervisor.ts` be tested with no repository at all.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param merges - the per-tick merge memo; `beginTick` clears it. Pass the
 *   same memo to {@link queueWorldForRepo} so both worlds share one answer.
 * @returns the world the tick reads through.
 */
export const worldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  tally: HostTally = { calls: 0 },
  merges: MergeMemo = mergeMemoOver(hostShell({ repoRoot, scriptDir: scriptsDir })),
): SupervisorWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const processes = processesShell(context);
  const trees = treesGit(context);
  const machine = machineSystem(context);
  const refs = refsGit(context);
  const plans = fleetPlanStore(context, refs);

  // THE MEMO'S LIFETIME IS ONE TICK, and `readTick` is what ends it: the world
  // is built once and `beginTick` clears the memo at the top of each pass, so a
  // branch asked about twice in one tick costs one walk and a branch asked
  // about next tick costs a fresh one.
  let memo: Promise<ReadonlyMap<string, PlanBranchLine & { plan: string }>> | null = null;
  const planLinesThisTick = () => (memo ??= planLinesFor(plans));

  return worldFrom({
    repoRoot,
    beginTick: () => {
      memo = null;
      merges.clear();
    },
    isAlive: async (pid) => {
      const answer = await processes.isAlive(pid);
      // AN UNANSWERABLE LIVENESS QUESTION READS AS ALIVE. Every other verdict
      // acts on the desk, and acting on a desk whose worker may be running is
      // the one mistake this daemon must never make.
      return answer.ok ? answer.value : true;
    },
    prMerged: async (branch): Promise<DeskMergeReading> => {
      // A FREE AGENT HOLDS NO BRANCH: there is no question to ask, so none is
      // spent. Guarded before the call, as `queue-reading.ts` guards.
      if (branch === '') return 'not-asked';
      tally.calls += 1;
      const answer = await merges.ask(branch);
      if (!answer.ok) return 'unreachable';
      return answer.value === 'merged'
        ? 'merged'
        : answer.value === 'not-merged'
          ? 'not-merged'
          : 'unreachable';
    },
    dirtyPaths: async (worktree) => {
      const answer = await trees.dirtyPaths(worktree);
      return answer.ok ? answer.value : [];
    },
    markers: async (worktree, prefix) => {
      const answer = await trees.markers(worktree, prefix);
      return answer.ok ? answer.value : [];
    },
    // ONE WALK PER TICK, HELD FOR THE LENGTH OF THAT TICK ONLY. The daemon
    // holds nothing between ticks by construction, so this cache is created and
    // dropped inside `readTick`'s pass — a `deferred:` annotation added while
    // the daemon runs reaches the next tick, not the next restart.
    planLine: async (branch) => (await planLinesThisTick()).get(branch) ?? null,
    workspacePackages: async () => workspacePackagesIn(repoRoot),
    madeProgress: async (worktree) => {
      // COMMITS THE BRANCH HOLDS THAT THE DEFAULT BRANCH DOES NOT — the whole
      // of them, pushed or not. The bound separates *ran out of time* from *was
      // never going to finish*, and the three workers this plan came from had
      // all committed AND pushed: a reading of unpushed commits would have
      // called every one of them no-progress and refused them a second chance.
      //
      // AN UNREADABLE ANSWER IS NO PROGRESS. It defers rather than stops, so a
      // git that could not be asked costs a tick and never a relaunch nobody
      // has evidence for.
      const base = await refs.defaultBranch();
      if (!base.ok) return false;
      const commits = refs.commitsSync(worktree, `${base.value}..HEAD`, 1);
      return commits.ok && commits.value.length > 0;
    },
    spawnCostMs: async () => {
      // FIVE SAMPLES, the number `machine-reading.ts` already uses. A second
      // sample count would make the board and the daemon disagree about the
      // same machine at the same moment.
      const answer = await machine.measure(MACHINE_SAMPLES);
      return answer.ok ? answer.value.spawnCostMs : null;
    },
    recordedPid: (worktree) => {
      const text = fileOrNull(join(worktree, '.plot-worker.pid'));
      if (text === null) return null;
      const pid = Number(text.trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    },
    worktrees: async () => {
      const listed = await trees.list();
      // AN UNREADABLE LIST REPORTS NOTHING, never an empty estate. Every other
      // reading here fails toward the answer that acts least, and this one's
      // least action is to name no leftover — a git that could not be asked
      // must not produce a report telling a person to remove directories.
      if (!listed.ok) return [];
      const lines = await planLinesThisTick();
      // AN EMPTY PLAN MAP REPORTS NOTHING, and this is the one caller that
      // needs the guard. `planLinesFor` returns an empty map both for *the
      // plans could not be read* and for *no plan names a branch*, and the
      // supervision gate reads the pair harmlessly — a missing line drops one
      // gate. Here the same emptiness would make EVERY tree read `planNamed:
      // false`, so a plan store that failed to answer would print a list of
      // removal commands for the whole estate.
      if (lines.size === 0) return [];
      const readings: TreeReading[] = [];
      for (const tree of listed.value) {
        // THE DIRT IS ASKED OF A TREE THAT IS THERE. A prunable entry has no
        // directory to read, so `git status` in it answers about whatever the
        // path now holds — and its disposition is `prune` whatever the count.
        const dirty = await dirtyCountOf(trees, tree.path, tree.prunable);
        readings.push({
          path: tree.path,
          branch: tree.branch,
          isMain: tree.isMain,
          prunable: tree.prunable,
          // A DETACHED TREE NAMES NO BRANCH, so no plan can name it. The empty
          // string is the reading rather than a lookup that would match the
          // plan line of whatever branch sorts first.
          planNamed: tree.branch !== '' && lines.has(tree.branch),
          plan: lines.get(tree.branch)?.plan ?? '',
          dirtyCount: dirty,
        });
      }
      return readings;
    },
  });
};

/**
 * How many merges the subject walk reads — the fleet scan's own cap.
 */
export const MERGE_WALK_LIMIT = 20000;

/**
 * The refless branches a merge subject proves landed, per plan.
 *
 * The same readings the fleet scan takes: the commit that first added each
 * plan file and the merges on `origin/<main>`, both read once, and one
 * ancestry test per pair the rule matched. A plan absent from the additions
 * gets no subjects. A branch is proven when any of its merges is NOT contained
 * in the plan's adding commit; `yes` and `unknown` prove nothing.
 *
 * @param refs - the refs port.
 * @param backend - the host's backend word, which selects the subject forms.
 * @param plans - the plans to answer for.
 * @param claimed - branch names to leave out.
 * @returns each plan's file to its proven branches, or `null` where a walk failed.
 */
export const subjectProvenOf = async (
  refs: Refs,
  backend: string,
  plans: readonly PlanRecord[],
  claimed: ReadonlySet<string>,
): Promise<ReadonlyMap<string, ReadonlySet<string>> | null> => {
  const forms = mergeSubjectForms(backend);
  if (forms.length === 0) return new Map();
  const base = await refs.defaultBranch();
  if (!base.ok) return null;
  const ref = `origin/${base.value}`;
  const dirs = [...new Set(plans.map((plan) => dirname(plan.file)))];
  const [merges, url, ...walks] = await Promise.all([
    refs.mergeSubjects(ref, MERGE_WALK_LIMIT),
    refs.remoteUrl('origin'),
    ...dirs.map((dir) => refs.planAdditions(ref, dir)),
  ]);
  if (!merges.ok) return null;
  const additions = new Map<string, string>();
  for (const walk of walks) {
    if (!walk.ok) return null;
    for (const [path, sha] of walk.value) additions.set(path, sha);
  }
  // A local-path origin, or none read, names no owner, and any owner counts.
  const owner = url.ok ? ownerOfRemote(url.value) : null;
  const proven = new Map<string, ReadonlySet<string>>();
  for (const plan of plans) {
    const added = additions.get(plan.file);
    if (added === undefined) continue;
    const branches = plan.slices
      .flatMap((slice) => slice.branches)
      .filter((line) => !line.deferred && !claimed.has(line.branch))
      .map((line) => line.branch);
    if (branches.length === 0) continue;
    const found = new Set<string>();
    for (const match of mergedBySubject({ subjects: merges.value, branches, forms, owner })) {
      if (found.has(match.branch)) continue;
      const contained = await refs.contains(match.sha, added);
      if (contained.ok && contained.value === 'no') found.add(match.branch);
    }
    if (found.size > 0) proven.set(plan.file, found);
  }
  return proven;
};

/**
 * Whether the host merged any PR for a QUEUED branch — the join
 * {@link QueueWorld.queuedHasLanded} and the hand-over check both need.
 *
 * **EXTRACTED SO THE HAND-OVER CHECK ASKS THE SAME QUESTION QUEUING DOES.** A
 * second copy of the `LookupReading` mapping is exactly the drift the comment
 * below used to warn about alone; this function is now the one place that
 * turns `askMerged`'s answer into the domain's {@link LandedAnswer}.
 *
 * @param askMerged - asks the host (or a tick's memo) whether a branch merged.
 * @param tally - the host-call counter this pass increments.
 * @param branch - the branch to ask about.
 * @returns the domain's landed answer, never a re-tested `=== 'merged'`.
 */
const queuedHasLandedOf = async (
  askMerged: (branch: string) => ReturnType<Host['prMerged']>,
  tally: HostTally,
  branch: string,
): Promise<LandedAnswer> => {
  tally.calls += 1;
  const answer = await askMerged(branch);
  // THE DOMAIN DECIDES THE WORD, from a `LookupReading` this join takes.
  // `landed` is the ONE answer to *did this land* — it reads the merge
  // timestamp, never a PR's `state` and never ancestry — and consuming it
  // here rather than re-testing `=== 'merged'` is what keeps the queue and
  // the reaper from drifting to two answers about one branch.
  //
  // SILENCE REACHES THE RULE AS SILENCE. The subject here is work nobody
  // holds, so an unreachable host must not be collapsed into *not merged* —
  // that would offer every finished branch to a free agent the moment the
  // host went quiet.
  return landed({
    merged:
      !answer.ok || answer.value === 'unknown'
        ? 'unaskable'
        : answer.value === 'merged'
          ? 'found'
          : 'none',
    // NOT READ BY `landed`, and named rather than guessed. `PrReadings`
    // carries both questions because `mayRemove` couples them; this caller
    // asks only whether the work landed, so the open lookup was never run.
    open: 'unaskable',
  });
};

/**
 * Builds the world the QUEUE is read through.
 *
 * A SECOND WORLD RATHER THAN MORE MEMBERS ON THE SUPERVISOR'S, because the two
 * ask about different things: the supervisor reads what each registered agent
 * left behind, and the queue reads what the plans have waiting. A tick that
 * cannot reach the plans still supervises every desk.
 *
 * Every reading is a thin join over a port, the same property `worldForRepo`
 * has and for the same reason: a wrong answer here is a wrong join rather than
 * a second implementation of a reading.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param merges - the per-tick merge memo {@link worldForRepo} clears; when
 *   absent, every merge question goes to the host.
 * @param index - the PR index this world reads; the repository's own store
 *   when absent. It is read and never written.
 * @param checksWaitMs - resolves `Checks wait`, in milliseconds. One
 *   `readConfigAsync` call per tick, shared with {@link run}'s own
 *   `defaultBranchWorld`, when the caller passes a cached thunk; a fresh read
 *   every call when absent.
 * @returns the world the queue is read through.
 */
export const queueWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  tally: HostTally = { calls: 0 },
  merges?: MergeMemo,
  index: PrIndexStore = prIndexFile({ cwd: repoRoot }),
  refusedSlices: RefusedSliceRecord = refusedSlicesFile({ cwd: repoRoot }),
  checksWaitMs: () => Promise<number> = async () =>
    checksWaitMsOf(await readConfigAsync({ repoRoot, scriptsDir }, 'Checks wait', '3600')),
): QueueWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const refs = refsGit(context);
  const plans = fleetPlanStore(context, refs);
  const host = hostShell(context);
  // NO MEMO GIVEN, NO MEMO BUILT. This world has no `beginTick`, so a memo it
  // built for itself would never be cleared and would freeze every merge answer
  // for the life of the daemon. Without one, each question goes to the host.
  const askMerged = (branch: string) =>
    merges === undefined ? host.prMerged(branch) : merges.ask(branch);
  const processes = processesShell(context);
  const trees = treesGit(context);

  return {
    plans: async () => {
      const files = await plans.listPlans();
      if (!files.ok) return [];
      const records = await plans.readPlans(files.value);
      return records.ok ? records.value : [];
    },
    claimedBranches: async () => {
      const answer = await refs.listBranches(true);
      // AN UNREADABLE REF LIST QUEUES NOTHING, and that direction is the safe
      // one. Reading it as *no branch is claimed* would put every branch on the
      // estate into the queue at once, and the first free agent would be handed
      // a slice somebody is already working.
      if (!answer.ok) return new Set(['*']);
      return new Set(answer.value.map((name) => name.replace(/^origin\//, '')));
    },
    briefPresent: async (branch) => {
      const base = await refs.defaultBranch();
      if (!base.ok) return false;
      // THE SAME PATH AND THE SAME REF `plot-dispatch.sh`'s `brief_present`
      // reads, because writer and reader must not disagree about where a brief
      // lives. This is the weaker half of that check — it asks whether the blob
      // exists, not whether it is non-empty — and the shell's gate at the
      // hand-over is what refuses a zero-byte brief.
      const suffix = branch.split('/').pop() ?? branch;
      const answer = refs.fileExistsSync(`origin/${base.value}`, `.plot/briefs/${suffix}.md`);
      return answer.ok && answer.value;
    },
    mergedBranches: async () => {
      // ONE CALL, JOINED BY HEAD BRANCH. `prList` bundles what `prMerged`
      // answers per branch, and the queue needs the whole set rather than one
      // answer — asked per branch it took a tick from 25 s to 357 s.
      // THE LIMIT IS EXPLICIT AND LARGE ON GITHUB, because the join is
      // against the WHOLE history rather than the recent page. `pr-list`
      // defaults to 30 and warns that "a join against this page may read
      // older branches as 'no PR'" — measured 2026-09-06, #707 and #710 are
      // hundreds of merges back and a default page missed both, leaving
      // their plans blocked exactly as before.
      //
      // CHOSEN BY BACKEND, FOR THE SAME REASON NARROWER ON BITBUCKET. GitHub
      // keeps the 500 the #707/#710 fix needed. Bitbucket now pages up to its
      // own limit (`bb_state_listing`'s row-limit mode), so asking 500 there
      // would cost 10 requests per tick; 50 keeps this call at the same
      // 3-request budget `PR_REQUESTS_PER_REFRESH.bitbucket` already assumes.
      const backend = await host.backend();
      const limit = backend.ok && backend.value === 'bitbucket' ? 50 : 500;
      const full = async (): Promise<MergedListing> => {
        tally.calls += 1;
        const answer = await host.prList('merged', limit);
        // A FAILED LISTING NAMES ITS OWN REFUSAL. `whole: false` says the set is
        // incomplete and cannot say why; the tick line prints the kind, so an
        // operator reads `unaskable(throttled)` rather than inferring a rate
        // limit from a count of held slices (#1094).
        if (!answer.ok)
          return {
            merged: new Set<string>(),
            whole: false,
            kind: host.lastRefusal()?.kind ?? 'failed',
            failed: true,
          };
        // A PARTIAL ANSWER KEEPS ITS ROWS AND IS NOT WHOLE. `prList` answers
        // the rows that arrived and leaves a refusal behind, so a branch
        // missing from them may still have merged.
        const refusal = host.lastRefusal();
        const whole = refusal === null;
        // `state`, NOT `mergedAt`, AND ONLY BECAUSE THE HOST ALREADY FILTERED.
        // The repo's rule is that `mergedAt` decides *did this land* — a merged
        // PR reports CLOSED when asked about one PR. Here `--state merged` made
        // that distinction host-side, and `pr-list` does not carry `mergedAt` at
        // all (`host-shell.ts:94` fills it from a field the shell never emits),
        // so filtering on it would reject every row. Ask `prMerged` for a single
        // branch; this is the bundle.
        return {
          merged: new Set(answer.value.filter((pr) => pr.state === 'MERGED').map((pr) => pr.head)),
          whole,
          kind: refusal?.kind ?? null,
          failed: false,
        };
      };
      // A DELTA NARROWS THE CALL; IT NEVER REPLACES THE STORE'S OWN ANSWER.
      // `mergedSetWindowFor` reads the SAME store `prIndexRows` already
      // exposes, by the same backend word, so a store this tick's earlier
      // `prIndexRows()` read as empty (missing/incomplete/wrong-version) also
      // decides `full` here — the two readings cannot disagree.
      if (!backend.ok) return full();
      const held = await index.read(backend.value);
      const store = held.ok ? held.value : null;
      const window = mergedSetWindowFor(store);
      if (window.kind === 'full') return full();
      tally.calls += 1;
      const answer = await host.prList('merged', limit, window.since);
      const refusal = host.lastRefusal();
      // ANY DELTA TROUBLE FALLS THROUGH TO THE FULL CALL IN THE SAME TICK.
      // A failed call, a left-behind refusal, or exactly `limit` rows (the
      // page may have been truncated) are each a reason not to trust this
      // answer — none of them are unioned with the stored rows.
      if (!answer.ok || refusal !== null || answer.value.length === limit) return full();
      const deltaHeads = answer.value.filter((pr) => pr.state === 'MERGED').map((pr) => pr.head);
      const merged = new Set([...deltaHeads, ...indexMergedHeads(store?.rows ?? [])]);
      return { merged, whole: true, kind: 'delta', failed: false };
    },
    // A GOING VERIFY RUN HOLDS AN AGENT SLOT, so `scaleUp` counts it.
    verifying: () => verifyingCount(repoRoot),
    // A GOING SPEC RUN HOLDS AN AGENT SLOT TOO.
    specRunning: () => specRunningCount(repoRoot),
    // HOW LONG A JUST-LAUNCHED AGENT WITH NO RECORDED PID STILL COUNTS AS
    // RUNNING (#2409) — a short grace against the wrapper's own fork-and-stamp
    // delay, never `Worker bound`'s working day (#2486).
    launchGraceMs: () => 30 * 1000,
    // HOW LONG A LAUNCH WITH A STAMPED, LIVE PID STILL COUNTS AS RUNNING
    // (#2486) — its own `Launched pid bound` key, not `Worker bound`: that key
    // bounds a hung agent's own run, this one bounds how long a stale pid may
    // age in a manifest nobody cleared.
    pidLivenessBoundMs: () => boundSecondsOfKey({ repoRoot, scriptsDir }, 'Launched pid bound', 28800) * 1000,
    alive: (pid) => pidAlive(Number(pid)),
    // READS THE FILE FLEETD WRITES AND NEVER THE HOST. A missing, unparseable
    // or other-version file is no reading, and no reading holds nothing.
    defaultBranchRed: async () => {
      const held = await defaultBranchFile(repoRoot).read();
      if (!held.ok) return false;
      return defaultBranchRed(held.value, Date.now(), await checksWaitMs());
    },
    prIndexRows: async () => {
      // THE STORE IS KEYED BY THE BACKEND WORD, as the board writes it. Reading
      // it costs a file read and no host request.
      const backend = await host.backend();
      if (!backend.ok) return [];
      const held = await index.read(backend.value);
      return held.ok && held.value !== null ? held.value.rows : [];
    },
    viewLanded: async (number) => {
      tally.calls += 1;
      const answer = await host.prState(number);
      return viewLanded(answer.ok ? answer.value : 'unanswered');
    },
    sliceHasMerged: async (branch) => {
      tally.calls += 1;
      const answer = await askMerged(branch);
      // SILENCE IS NOT LANDED. An unreachable host answers *not merged*, so an
      // agent stays holding its branch rather than being handed a second one.
      return answer.ok && answer.value === 'merged';
    },
    queuedHasLanded: (branch) => queuedHasLandedOf(askMerged, tally, branch),
    subjectProven: async (planList, claimed) => {
      // The backend word is a local read and costs no host request.
      const backend = await host.backend();
      if (!backend.ok) return null;
      return subjectProvenOf(refs, backend.value, planList, claimed);
    },
    workerAlive: async (worktree) => {
      const text = fileOrNull(join(worktree, '.plot-worker.pid'));
      if (text === null) return false;
      const pid = Number(text.trim());
      if (!Number.isInteger(pid) || pid <= 0) return false;
      const answer = await processes.isAlive(pid);
      // AN UNANSWERABLE LIVENESS QUESTION READS AS ALIVE, the reading
      // `worldForRepo` takes — but here it WITHHOLDS work rather than
      // authorising a write, because an agent that may be running is an agent
      // that may already hold a slice.
      return answer.ok ? answer.value : true;
    },
    blocked: async (worktree) => {
      const answer = await trees.markers(worktree, 'PLOT-BLOCKED');
      // AN UNREADABLE DESK READS AS BLOCKED. It withholds work from one agent
      // for one tick, which is the cheap direction; the other hands a slice to
      // an agent waiting on a person who has not answered.
      return !answer.ok || answer.value.length > 0;
    },
    refused: async (branch) => {
      // AN UNREADABLE RECORD READS AS NOTHING REFUSED, as a missing one does:
      // the hold ends when the line is gone, and nothing ages it out.
      const answer = await refusedSlices.has(branch);
      return answer.ok && answer.value;
    },
    refusal: async (branch) => {
      // UNREADABLE READS AS NO DETAIL: the hold itself comes from `refused`.
      const answer = await refusedSlices.refusal(branch);
      return answer.ok ? answer.value : null;
    },
    remoteHead: async (branch) => {
      const answer = await refs.remoteHead(branch);
      return answer.ok ? answer.value : 'unknown';
    },
    commitSubjects: (range) => refs.commitSubjects(range),
    now: () => Date.now(),
    defaultBranch: async () => {
      const answer = await refs.defaultBranch();
      return answer.ok ? answer.value : 'main';
    },
  };
};

/**
 * Builds the world a hand-over is checked against, immediately before it is
 * made.
 *
 * **ASKS THE HOST DIRECTLY, NEVER THROUGH THE TICK'S MEMO.** `queueWorldForRepo`
 * reads `queuedHasLanded` once per queued branch while the tick derives the
 * queue, and that answer is what `mergeMemoOver` caches for the rest of the
 * pass. A hand-over's whole point is a SECOND, fresher reading of the same
 * branch — sharing the memo would hand this check back the tick-start answer
 * it exists to outdate. Only the `LookupReading` → {@link LandedAnswer}
 * mapping is shared, through {@link queuedHasLandedOf}; the host call itself
 * is not.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param tally - the host-call counter this pass increments.
 * @returns the world {@link startAgents} checks a hand-over against.
 */
export const handOverWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  tally: HostTally = { calls: 0 },
): HandOverWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const refs = refsGit(context);
  const host = hostShell(context);

  return {
    remoteHead: async (branch) => {
      const answer = await refs.remoteHead(branch);
      return answer.ok ? answer.value : 'unknown';
    },
    queuedHasLanded: (branch) => queuedHasLandedOf((b) => host.prMerged(b), tally, branch),
    now: () => Date.now(),
  };
};

/** The `## Plot Config` key naming the comma-separated escalation ages. */
export const QUESTION_ESCALATION_KEY = 'Question escalation';
/** The `## Plot Config` key naming the command a `notify` write runs. */
export const NOTIFY_COMMAND_KEY = 'Notify command';
/** The `## Plot Config` key naming the idle-slice bound. */
export const SLICE_IDLE_AFTER_KEY = 'Slice idle after';

/**
 * The `Notifier` a repository's `Notify command` configures — {@link notifierNone}
 * for an absent or empty value, same as a tracker nobody declared.
 *
 * @param configured - the `Notify command` value, as `plot-config.sh` hands it back.
 * @returns the notifier to send through.
 */
export const notifierFor = (configured: string): Notifier => {
  const trimmed = configured.trim();
  return trimmed === '' ? notifierNone() : notifierCommand(trimmed);
};

/**
 * What the tick reads to decide a desk's question escalation: the marker, the
 * configured ages, the rungs already recorded for the desk and its marker's
 * modification time (in `.plot/state/escalations.tsv` or in this daemon's
 * {@link EscalationMemory}), the answer record's own latest outcome for that
 * key (`.plot/state/answers.tsv`, via `answerRecordFile`), and whether the
 * desk's branch merged.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param memory - the rungs this daemon process applied.
 * @param askMerged - asks the host whether a branch merged; defaults to
 *   asking with no memo, so a caller that wants the tick's own memoized
 *   answer passes `(branch) => merges.ask(branch)` — the same function
 *   {@link freshAgentDeskReads} is given, so the two share one call per
 *   branch per tick rather than each buying its own.
 * @param tally - the host-call counter this pass increments; a no-op tally
 *   where the caller does not track one.
 * @returns the world the tick's escalation pass reads through.
 */
export const escalationWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  memory: EscalationMemory = escalationMemory(),
  askMerged: (branch: string) => ReturnType<Host['prMerged']> = (branch) =>
    hostShell({ repoRoot, scriptDir: scriptsDir }).prMerged(branch),
  tally: HostTally = { calls: 0 },
): EscalationWorld => ({
  marker: (worktree) => markerReading(worktree),
  // `plot-config.sh` answers the fallback for an empty value; `none` turns
  // notification off (`parseQuestionEscalation`).
  ages: async () =>
    parseQuestionEscalation(
      await readConfigAsync({ repoRoot, scriptsDir }, QUESTION_ESCALATION_KEY, DEFAULT_QUESTION_ESCALATION),
    ),
  recordedRungs: async (worktree, askedAt) =>
    recordedRungsFor([...readEscalations(repoRoot), ...memory.records], worktree, askedAt),
  recordedOutcome: async (worktree, askedAt) => {
    const rows = await answerRecordFile({ cwd: repoRoot }).rowsFor(worktree, askedAt);
    return rows.ok && rows.value.length > 0 ? rows.value[rows.value.length - 1].outcome : null;
  },
  merged: async (branch) => {
    // A FREE AGENT HOLDS NO BRANCH: there is no question to ask, so none is
    // spent — the same guard `prMerged` above takes.
    if (branch === '') return false;
    tally.calls += 1;
    return prMergedReading(await askMerged(branch)) === 'merged';
  },
});

/**
 * What the tick reads to decide which slices have gone idle: every desk
 * {@link escalationDesks} would name with a non-empty branch and no merged
 * PR, its run-log lines, its `PLOT-BLOCKED` marker state, fleetd's own
 * start, and the configured bound.
 *
 * **`SlicePr.createdAt` IS ALWAYS `''` HERE, AND THAT IS A NAMED GAP RATHER
 * THAN AN OVERSIGHT.** No port this estate owns reads a PR's creation time:
 * `Pr` (`entities/pr.ts`) carries no `createdAt` field, `Host.prState`
 * answers a `PrLookup` typed from it, and neither `gh pr-list`'s `--rich`
 * fields nor Bitbucket's REST object (`plot-host.sh`) include one. Adding it
 * would touch the `Host` port, its shell adapter and `plot-host.sh` — a
 * larger change than this slice's write kind and rule. `sliceIdle`'s own
 * `clockStartMs` already treats an unparseable `createdAt` as absent from the
 * `max(...)`, so the clock still starts at `max(fleetdStartedAt, last moved
 * line)` — safe, if slightly more conservative than the design intent for a
 * brand-new slice with no run-log line yet, which now floors at fleetd's own
 * start rather than at the moment its PR opened.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param fleetdStartedAt - when the current fleetd process started, epoch milliseconds.
 * @param desksNow - every desk to judge this tick; read fresh on every call,
 *   like {@link escalationDesks} is re-derived every tick rather than held.
 * @param askMerged - asks the host whether a branch merged; defaults to
 *   asking with no memo, matching {@link escalationWorldForRepo}'s own default.
 * @param tally - the host-call counter this pass increments.
 * @returns the reader the tick's idle pass reads through.
 */
export const idleWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  fleetdStartedAt: number,
  desksNow: () => Promise<readonly { worktree: string; branch: string }[]>,
  askMerged: (branch: string) => ReturnType<Host['prMerged']> = (branch) =>
    hostShell({ repoRoot, scriptDir: scriptsDir }).prMerged(branch),
  tally: HostTally = { calls: 0 },
): SliceIdleReader => ({
  readings: async (): Promise<readonly SliceIdleReading[]> => {
    const desks = await desksNow();
    const lines = await runLogFile({ cwd: repoRoot }).read();
    const allLines = lines.ok ? lines.value : [];
    const open: SliceIdleReading[] = [];
    for (const desk of desks) {
      if (desk.branch === '') continue;
      tally.calls += 1;
      if (prMergedReading(await askMerged(desk.branch)) === 'merged') continue;
      const marker = await markerReading(desk.worktree);
      open.push({
        pr: { branch: desk.branch, createdAt: '' },
        lines: allLines
          .filter((line) => line.branch === desk.branch)
          .map((line) => ({ branch: line.branch, step: line.step, outcome: line.outcome, at: line.at })),
        blocked: marker !== null,
      });
    }
    return open;
  },
  fleetdStartedAt: async () => fleetdStartedAt,
  boundMs: async () =>
    parseSliceIdleAfter(await readConfigAsync({ repoRoot, scriptsDir }, SLICE_IDLE_AFTER_KEY, DEFAULT_SLICE_IDLE_AFTER)),
  recordedEpisodes: async () => {
    const lines = await runLogFile({ cwd: repoRoot }).read();
    if (!lines.ok) return new Set();
    return new Set(
      lines.value
        .filter((line) => line.step === 'notified')
        .map((line) => idleEpisodeKey(line.branch, line.at)),
    );
  },
});

/**
 * How many desks one tick is willing to cut.
 *
 * **THREE.** A tick's whole job is to keep the fleet moving, and a tick that
 * cut ten desks would spend minutes of `git worktree add` inside a pass measured
 * at 3.5 s — and would do it again 60 seconds later if the queue had not
 * drained. Three per tick reaches a cap of nine in three minutes, which is
 * faster than any queue this daemon has been measured against drains.
 *
 * It is a rate limit on the tick and NOT the fleet's size: the size is the
 * operator's `Parallel agents`, and `fleetSize` is what applies it.
 */
const DESKS_PER_TICK = 3;

/**
 * The cap, the machine reading, and the desks this tick offers.
 *
 * **THE CAP IS THE BOARD'S OWN `Parallel agents` CONTROL**, read fresh every
 * tick from the same file the board writes. A second number for *how many
 * agents may run at once* is exactly the drift the control exists to prevent —
 * an operator lowering the stepper and watching the daemon start a fourth agent
 * would be reading two answers to one question.
 *
 * **THE DESK PATHS ARE NAMED HERE BECAUSE THE DOMAIN MUST NOT INVENT ONE.**
 * Where a worktree goes depends on the `Worktree root` config key, which is an
 * adapter's reading; the decision takes the paths and starts at most that many.
 *
 * **THE MACHINE IS SAMPLED, AND AN UNSAMPLED ONE IS NOT A STARVED ONE.** A
 * measurement that fails answers `unmeasured`, which `fleetSize` treats as
 * clear: an absent veto is not a refusal.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @returns what the fleet may grow to this tick.
 */
export const fleetCapForRepo = async (
  repoRoot: string,
  scriptsDir: string,
): Promise<FleetCap> => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const settings = await readFleetSettings({ repoRoot, scriptsDir });
  const reading = await machineSystem(context).measure(MACHINE_SAMPLES);
  const spawnCostMs = reading.ok ? reading.value.spawnCostMs : null;

  // THE NAMING IS THE SCRIPT'S AND THE PATHS ARE EMPTY, deliberately.
  //
  // `plot-dispatch.sh --start` already names a desk from its own `Worktree
  // root` and a fresh session id, and that convention is the one every other
  // desk on the estate follows. A daemon that rebuilt the path here would be
  // this file's own second naming convention — precisely what
  // `resolve_wt_root`'s comment refuses, since a second convention gives
  // path-guessing a second way to be wrong.
  //
  // So the LIST'S LENGTH is what the decision reads — it is this tick's rate
  // limit, and it is the only thing the domain needs to bound a start — while
  // its contents are the performer's `PLOT_START_DESK`, which the script reads
  // as *name it yourself* when empty. The port still takes a desk, because a
  // caller that HAS one must be able to say so; this caller does not.
  return {
    size: settings.parallelAgents,
    headroom: headroomFor(spawnCostMs),
    spawnCostMs,
    desks: Array.from({ length: DESKS_PER_TICK }, () => ''),
  };
};

/**
 * How many uncommitted paths one worktree carries.
 *
 * **UNREADABLE DIRT COUNTS AS DIRT.** A tree that could not be measured may
 * hold work, and the finding for that tree is *a person reads it* rather than
 * *here is the removal command* — so a refused reading answers one, not zero.
 *
 * **A PRUNABLE ENTRY IS NOT ASKED AND CARRIES NO DIRT.** There is nothing at
 * the path to read, and `git status` there would answer about whatever now
 * occupies it. Zero is honest of a directory that is gone; the disposition is
 * `prune` whatever this returns, so the number is only ever what the report
 * prints.
 *
 * @param trees - the trees port.
 * @param path - the worktree's absolute path.
 * @param prunable - git's own view that the directory is gone.
 * @returns the count, or 1 where the reading was refused.
 */
const dirtyCountOf = async (
  trees: ReturnType<typeof treesGit>,
  path: string,
  prunable: boolean,
): Promise<number> => {
  if (prunable) return 0;
  const answer = await trees.dirtyPaths(path);
  return answer.ok ? answer.value.length : 1;
};

/**
 * The queue, supervisor and index monitor's own plan store: `origin/<default>`,
 * never the checkout's working tree.
 *
 * A plan approved on the host moves `origin/<default>` and nothing else — the
 * daemon's checkout is not fast-forwarded by anything but an operator's own
 * `git fetch` + merge, so a store reading the working tree could stay behind a
 * host-side approval indefinitely (measured 2026-10-26: a 17-minute gap between
 * approval and the queue noticing). `refs.defaultBranch()` is asked fresh on
 * every call rather than once at construction, so a ref that starts resolvable
 * and later is not (a detached fixture, a deleted remote) answers the empty
 * list the brief requires instead of the ref this function resolved at
 * start-up.
 *
 * Every OTHER `PlanStore` operation on the adapters this function builds
 * (`config`, `listDir`, `readText`, `writeText`) still reads the working
 * tree — unrelated callers (`approve.ts`, `deliver.ts`, …) read the checkout
 * they are about to act on, and this function's callers only ever reach
 * `listPlans`/`readPlans`.
 *
 * @param context - where the scripts live and which repository to parse in.
 * @param refs - the ref reader, already constructed by the caller.
 * @returns a `PlanStore` whose `listPlans`/`readPlans` read `origin/<default>`.
 */
const fleetPlanStore = (context: { repoRoot: string; scriptDir: string }, refs: Refs): PlanStore => {
  const scripts = scriptsShell(context);
  const storeFor = async (): Promise<Pick<PlanStore, 'listPlans' | 'readPlans' | 'readPlansAt'> | null> => {
    const base = await refs.defaultBranch();
    if (!base.ok) return null;
    const planDir = await planDirectory(scripts);
    return planStoreRef(refs, context, `origin/${base.value}`, planDir);
  };
  const shell = planStoreShell(context);
  return {
    listPlans: async () => {
      const store = await storeFor();
      return store === null ? answered([]) : store.listPlans();
    },
    readPlans: async (files) => {
      const store = await storeFor();
      return store === null ? answered([]) : store.readPlans(files);
    },
    readPlansAt: async (blobs, prefixes) => {
      const store = await storeFor();
      return store === null ? failed<readonly PlanRecord[]>() : store.readPlansAt(blobs, prefixes);
    },
    readPlan: shell.readPlan,
    config: shell.config,
    listDir: shell.listDir,
    readText: shell.readText,
    writeText: shell.writeText,
  };
};

/**
 * The plan store auto-deliver reads a candidate's `Rejected:` record from: the
 * source the pulse read its plans from.
 *
 * `plot-fleet-scan.sh` reads plans from `origin/<default>` when that ref
 * resolves to a commit, and from the working tree when it does not. This store
 * applies the same rule on every call, so a plan the pulse names is read from
 * the tree the pulse read it in — never from a checkout that lags the ref.
 *
 * @param context - where the scripts live and which repository to read.
 * @param refs - the ref reader, already constructed by the caller.
 * @returns a `PlanStore` whose `listPlans`, `readPlans` and `readPlan` read the
 *   pulse's plan source; every other operation reads the working tree.
 */
export const pulsePlanStore = (context: { repoRoot: string; scriptDir: string }, refs: Refs): PlanStore => {
  const scripts = scriptsShell(context);
  const shell = planStoreShell(context);
  const storeFor = async (): Promise<PlanStore> => {
    const base = await refs.defaultBranch();
    if (!base.ok) return shell;
    const ref = `origin/${base.value}`;
    const resolved = await refs.resolve(`${ref}^{commit}`);
    if (!resolved.ok) return shell;
    return planStoreRef(refs, context, ref, await planDirectory(scripts));
  };
  return {
    ...shell,
    listPlans: async () => (await storeFor()).listPlans(),
    readPlans: async (files) => (await storeFor()).readPlans(files),
    readPlan: async (file) => (await storeFor()).readPlan(file),
  };
};

/**
 * Every plan line the estate holds, keyed by branch.
 *
 * **READ ONCE PER TICK, NOT ONCE PER AGENT, and the difference was measured.**
 * The first working daemon asked the plan store per agent and a tick over three
 * agents cost 10.0-11.5 s — against 976 ms for the same three agents without
 * it. `listPlans` + `readPlans` walks every plan file in the repository (172 on
 * this estate), so asking it per agent multiplies one full walk by the fleet.
 *
 * Read once, the walk is paid once however many agents the registry holds, and
 * the tick's cost stops growing with the estate on its most expensive term.
 *
 * @param plans - the plan store.
 * @returns branch to its plan line; empty where the plans cannot be read.
 */
const planLinesFor = async (
  plans: Pick<PlanStore, 'listPlans' | 'readPlans'>,
): Promise<ReadonlyMap<string, PlanBranchLine & { plan: string }>> => {
  const lines = new Map<string, PlanBranchLine & { plan: string }>();
  const files = await plans.listPlans();
  if (!files.ok) return lines;
  const records = await plans.readPlans(files.value);
  if (!records.ok) return lines;
  for (const record of records.value) {
    for (const slice of record.slices) {
      for (const line of slice.branches) {
        // FIRST PLAN WINS, and a branch two plans name is the estate's own
        // `double_claims=` finding rather than this function's to resolve.
        if (lines.has(line.branch)) continue;
        lines.set(line.branch, {
          // THE PLAN'S FILE NAME WITHOUT `.md`, which keys the fresh-agent record.
          plan: basename(record.file, '.md'),
          // NOT the plan's `prs`: that array is every PR the plan annotates
          // anywhere, and attributing it to one line would report a branch as
          // annotated because a sibling was. `PlanRecordBranch` carries no
          // per-line PR numbers, so `gatesFor` drops the annotation gate — a
          // gate run on a reading nobody took fails every correct branch.
          prs: [],
          deferred: line.deferred,
          deferredReason: line.deferredReason,
        });
      }
    }
  }
  return lines;
};

/**
 * The workspace's package names, for the changeset gate.
 *
 * Read from `pnpm-workspace.yaml`'s packages by way of each `package.json`,
 * because that is what `check-changeset-packages.sh` reads and a second source
 * would let the gate and the script disagree about what a valid package is.
 *
 * @param repoRoot - the repository root.
 * @returns the package names; empty when they cannot be read.
 */
const workspacePackagesIn = async (repoRoot: string): Promise<readonly string[]> => {
  const names: string[] = [];
  const root = fileOrNull(join(repoRoot, 'package.json'));
  if (root !== null) {
    try {
      const parsed = JSON.parse(root) as { name?: string };
      if (typeof parsed.name === 'string') names.push(parsed.name);
    } catch {
      // A root package.json that does not parse leaves the list shorter rather
      // than refusing: the gate reports an unknown package, which is legible.
    }
  }
  const dirs = await readdir(join(repoRoot, 'packages')).catch(() => [] as string[]);
  for (const dir of dirs) {
    const text = fileOrNull(join(repoRoot, 'packages', dir, 'package.json'));
    if (text === null) continue;
    try {
      const parsed = JSON.parse(text) as { name?: string };
      if (typeof parsed.name === 'string') names.push(parsed.name);
    } catch {
      continue;
    }
  }
  return names;
};

/**
 * Proves the configured `Worker command` can write before `startAgents` hands
 * any `worker-start` write over to it.
 *
 * **ONE PROMPT FILE GOVERNS EVERY AGENT**, so the probe asks the command
 * string itself rather than branching on it — the same reason
 * `plot-fleetctl.sh`'s `--start` probes ahead of `launchctl bootstrap`. A
 * refused write here means a dispatched agent would meet the same refusal, so
 * nothing in this tick's `worker-start` writes is handed over.
 *
 * **A TICK WITH NOTHING TO START SPENDS NOTHING.** `report.handOver?.writes`
 * is read before `Worker command` is, so a tick whose queue is empty, or
 * whose free agents are all already assigned, never reaches the probe — the
 * same reasoning that keeps `--once` free when no agent needs starting.
 *
 * **ABSENT IS NOT FALSE.** An empty, unconfigured or `none` `Worker command`
 * is not probed (`writeProbeNeeded`) and is left to `startFreeAgent`'s own
 * answer; this only refuses an OBSERVED failure to write. A stale print
 * proceeds and reports its fix (`writeProbeOutcome`).
 *
 * @param report - what the tick decided.
 * @param probe - what runs the configured command once, in a scratch desk.
 * @param readWorkerCommand - reads the configured `Worker command`.
 * @param warn - where a refusal is reported.
 * @returns `true` to let `startAgents` proceed, `false` to skip it entirely.
 */
export const probeBeforeStarting = async (
  report: TickReport,
  probe: WriteProbe,
  readWorkerCommand: () => Promise<string>,
  warn: (s: string) => void,
): Promise<boolean> => {
  const hasWorkerStart = (report.handOver?.writes ?? []).some((item) => item.kind === 'worker-start');
  if (!hasWorkerStart) return true;

  const command = await readWorkerCommand();
  if (!writeProbeNeeded(command)) return true;

  const outcome = writeProbeOutcome(await probe.check(command));
  if (outcome.message !== undefined) warn(`plot-fleetd: ${outcome.message}\n`);
  return outcome.answer === 'proceed';
};

/**
 * Applies the tick's `agent-assign` and `worker-start` writes — what this
 * daemon performs.
 *
 * **IT APPLIES TWO KINDS AND SKIPS EVERY OTHER.** The tick names reaps, blocked
 * markers and corrections too, and none of them is performed here, so a write
 * it does not own is left for whoever does. Naming the kind rather than falling
 * through a default is `perform-fs.ts`'s discipline — *skipped on purpose* and
 * *a kind the author forgot* look identical from inside a loop.
 *
 * **`agent-assign` WAS THE SECOND KIND AND IT WAS MISSING.** Measured
 * 2026-09-06: a tick reported `handed=8` while all eight agents stayed
 * `branch: ""`, because this loop filtered to `worker-start` alone. Six were
 * written into their manifests by hand, twice in one day. A summary naming a
 * write nobody makes is worse than no summary.
 *
 * **THE ASSIGNMENT GOES FIRST**, so an agent started by this same pass is not
 * handed a slice in the pass that created it. `matchQueue` read the fleet as it
 * was; a new desk was not in that reading and must wait for the next one.
 *
 * **A START THAT FAILS COSTS ONE TICK.** The next tick re-derives the queue and
 * the fleet from disk and reaches the same decision if the shortage is still
 * there, which is the same recovery a `kill -9` gets. So a failure is reported
 * and the loop continues; there is nothing to retry and nothing to remember.
 *
 * **A HAND-OVER IS CHECKED AGAIN, IMMEDIATELY BEFORE IT IS MADE.** #1149
 * measured a 78-minute-old tick reading that handed a merged, refless branch
 * to an agent. `handOverCheck` reads the reading's age plus a fresh
 * `remoteHead` and `queuedHasLanded`, asked only for a branch about to be
 * handed over — at most this tick's free agents. Every answer but
 * `hand-over` withholds the write and reports why; nothing is retried or
 * remembered, the same recovery a failed `assignSlice` call already gets.
 *
 * @param report - what the tick decided.
 * @param performer - what starts an agent on this machine.
 * @param world - what a hand-over is checked against, asked fresh per branch.
 * @param write - where the started agents are reported.
 * @param warn - where a start that could not be made is reported.
 * @returns how many agents were actually started.
 */
export const startAgents = async (
  report: TickReport,
  performer: Performer,
  world: HandOverWorld,
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<number> => {
  let started = 0;
  const startedAt = report.startedAt;

  for (const item of report.handOver?.writes ?? []) {
    if (item.kind !== 'agent-assign') continue;

    // THE AGE IS TESTED BEFORE EITHER FRESH READING IS ASKED FOR. A stale
    // reading withholds the hand-over whatever `remoteHead` and
    // `queuedHasLanded` would answer, so a stale tick spends neither a git
    // call nor a host call on a branch it is about to withhold anyway.
    const ageMs = world.now() - startedAt;
    if (ageMs > HAND_OVER_MAX_AGE_MS) {
      write(`  ${item.branch}: not handed — stale\n`);
      continue;
    }

    const [refNow, landedNow] = await Promise.all([
      world.remoteHead(item.branch),
      world.queuedHasLanded(item.branch),
    ]);
    const check = handOverCheck({ ageMs, refNow, landedNow });
    if (check !== 'hand-over') {
      write(`  ${item.branch}: not handed — ${check}\n`);
      continue;
    }

    const answer = await performer.assignSlice(item.session, item.branch, item.slug);
    if (!answer.ok) {
      warn(
        `plot-fleetd: ${item.branch} could not be handed over; the next tick re-derives the queue\n`,
      );
      continue;
    }
    // A REFUSAL IS REPORTED, NOT SWALLOWED. `false` means the agent had taken
    // other work between the tick's reading and this write — nothing is wrong,
    // but a hand-over the summary counted did not happen, and a reader
    // comparing `handed=` against the fleet must be able to see why.
    write(
      answer.value
        ? `  ${item.branch}: handed to ${item.session}\n`
        : `  ${item.branch}: not handed — ${item.session} had already taken work\n`,
    );
  }

  for (const item of report.handOver?.writes ?? []) {
    if (item.kind !== 'worker-start') continue;
    const answer = await performer.startFreeAgent(item.worktree);
    if (!answer.ok) {
      // `unaskable` IS A FIRST-CLASS ANSWER AND NOT A FAILURE. It means the
      // repository has no `Worker command`, or `none` — asked, and answered
      // *we start them by hand* — or a command that does not run
      // `plot-worker-loop.sh`, which a free agent needs to wait (#1124). The
      // line says what to configure rather than reading as an error to chase
      // every sixty seconds.
      warn(
        answer.why === 'unaskable'
          ? 'plot-fleetd: nothing starts free agents in this repository — set `Worker command` in Plot Config to `PLOT_UNATTENDED=1 plot-worker-loop.sh`; `/plot-fleet --start 1` names what is configured now\n'
          : 'plot-fleetd: an agent could not be started; the next tick re-derives the queue and tries again\n',
      );
      continue;
    }
    started += answer.value;
  }
  if (started > 0) write(`  started ${started} free agent(s) for the queue\n`);
  return started;
};

/**
 * Applies the tick's `notify` writes. Each message is sent through the
 * `Notifier`, all of them concurrently, so the slowest command bounds the
 * pass. Each rung is then appended to `.plot/state/escalations.tsv` and held
 * in `memory`, with the status `sent`, `unaskable` or `failed <code>`.
 *
 * The notifier is asked for only where the tick holds at least one `notify`
 * write. A failed append is reported on `warn` once per memory.
 *
 * @param report - what the tick decided.
 * @param repoRoot - the repository root the TSV lives under.
 * @param notifier - answers the `Notifier` to send through.
 * @param memory - the rungs this daemon process applied; each applied rung is added.
 * @param write - where a sent notification is reported.
 * @param warn - where a failed append is reported.
 */
export const notifyEscalations = async (
  report: TickReport,
  repoRoot: string,
  notifier: () => Promise<Notifier>,
  memory: EscalationMemory,
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<void> => {
  const items = report.decision.writes.filter((item): item is NotifyWrite => item.kind === 'notify');
  if (items.length === 0) return;
  const sender = await notifier();
  const results = await Promise.all(items.map((item) => sender.notify(item.message)));
  items.forEach((item, i) => {
    const result = results[i];
    const status = result.ok ? 'sent' : result.why === 'unaskable' ? 'unaskable' : `failed ${result.code}`;
    const record = {
      worktree: item.worktree,
      askedAt: item.askedAt,
      rung: item.rung,
      at: new Date().toISOString(),
      status,
    };
    rememberEscalation(memory, record);
    if (!appendEscalation(repoRoot, record) && !memory.appendFailureReported) {
      memory.appendFailureReported = true;
      warn(
        `plot-fleetd: could not append to ${escalationsPath(repoRoot)}; ` +
          'escalated rungs are held in memory until the daemon restarts\n',
      );
    }
    if (result.ok) write(`  ${item.worktree}: notified at ${item.rung}\n`);
  });
};

/**
 * Applies the tick's `idle-notify` writes. Each message is sent through the
 * `Notifier`, all of them concurrently, so the slowest command bounds the
 * pass; each result then appends one `notified` run-log line, status `sent`,
 * `unaskable` or `failed <code>`.
 *
 * **THE LINE'S `at` IS THE EPISODE'S CLOCK START, NOT THE SEND TIME.** The
 * idle rule's episode key is `(branch, clockStart)`
 * ({@link import('@plot-pm/domain/rules/slice-idle').idleEpisodeKey}), and
 * the `notified` lines already in the run log ARE the recorded set — no
 * second ledger. Stamping `at` with the real send time would make every
 * later tick's `recordedEpisodes()` read a key this line can never match,
 * so the same stall would notify again every tick rather than once.
 *
 * **DELIVERY IS AT LEAST ONCE.** A crash between the send and the append
 * repeats the message after a restart — the plan's stated, accepted trade.
 *
 * @param report - what the tick decided.
 * @param repoRoot - the repository root the run log lives under.
 * @param notifier - answers the `Notifier` to send through.
 * @param planOf - the plan file name (without `.md`) naming a branch; `''` where none does.
 * @param write - where a sent notification is reported.
 * @param warn - where a failed append is reported.
 */
export const notifyIdleSlices = async (
  report: TickReport,
  repoRoot: string,
  notifier: () => Promise<Notifier>,
  planOf: (branch: string) => Promise<string>,
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<void> => {
  const items = report.decision.writes.filter((item): item is IdleNotifyWrite => item.kind === 'idle-notify');
  if (items.length === 0) return;
  const sender = await notifier();
  const results = await Promise.all(items.map((item) => sender.notify(item.message)));
  const log = runLogFile({ cwd: repoRoot });
  for (const [i, item] of items.entries()) {
    const result = results[i];
    const status = result.ok ? 'sent' : result.why === 'unaskable' ? 'unaskable' : `failed ${result.code}`;
    // THE DECODER DROPS A LINE WITH NO PLAN, so an empty one would never read
    // back as a recorded episode and the stall would notify every tick. A branch
    // no plan names falls back to the branch itself.
    const plan = (await planOf(item.branch)) || item.branch;
    const appended = await log.append({
      plan,
      branch: item.branch,
      pr: '',
      head: '',
      step: 'notified',
      outcome: status,
      at: item.clockStart,
    });
    if (!appended.ok) warn(`plot-fleetd: could not append to the run log for ${item.branch}\n`);
    if (result.ok) write(`  ${item.branch}: idle notification sent\n`);
  }
};

/**
 * Runs the daemon.
 *
 * **THE INTERVAL IS WAITED AFTER A TICK, NOT BETWEEN STARTS.** A slow tick
 * delays the next one rather than overlapping it, so two ticks never run at
 * once on one registry — which is the cheapest answer to the plan's open
 * question about whether the daemon needs a lock.
 *
 * **A TICK THAT CANNOT COMPLETE DOES NOT END THE LOOP.** `tick` reports the
 * reason rather than throwing, so a git that would not fork or a registry
 * removed mid-pass costs one tick's readings and nothing else. The reason goes
 * to {@link warn} and the loop takes its next tick, which re-reads everything
 * from disk. That is the same recovery a restart performs, which is why the
 * daemon needs no journal and the OS supervisor needs no help.
 *
 * @param argv - the arguments after the script name.
 * @param here - the directory this artifact sits in.
 * @param write - where the tick lines go.
 * @param sleep - how to wait; a test supplies its own.
 * @param stop - asked before each tick; true ends the loop.
 * @param warn - where an incomplete tick and an unparsable manifest are reported.
 * @returns the process exit code.
 */
/**
 * This tick's judgement of every desk, as the report holds it.
 *
 * **A PROJECTION, NEVER A SECOND COMPUTATION.** Every field is read off the
 * report the tick already produced — no gate is re-run and `supervise()` is not
 * called again. That is the whole constraint of the plan this implements: the
 * cause exists and carrying it is the work.
 *
 * **EVERY JUDGED DESK, INCLUDING THE LIVE ONES.** `reportTick` drops
 * `verdict === 'leave'` before printing, because a log of a quiet estate should
 * be quiet. A reader asking *what does this desk owe* needs the opposite: an
 * absent row must mean only *the tick did not judge this desk*, and filtering
 * the live ones out here would give that absence a second meaning.
 *
 * **AN INCOMPLETE TICK JUDGED NOTHING, AND THE ROWS SAY SO.** Such a tick
 * carries an empty decision by contract, so this writes an empty `rows` with a
 * current `at` — which reads as *the supervisor ran and placed no desk*, not as
 * a stale report. The alternative, leaving the previous tick's file in place,
 * would let a report the estate has moved past keep answering.
 *
 * @param report - what the tick decided.
 * @returns the report to write.
 */
const reportFor = (report: TickReport): SupervisionReport => ({
  v: SUPERVISION_REPORT_VERSION,
  at: report.startedAt,
  rows: report.decision.detail.agents.map((row) => ({
    branch: row.branch,
    worktree: row.worktree,
    verdict: row.supervision.verdict,
    cause: row.supervision.cause,
  })),
});

/**
 * Writes this tick's report, and says nothing when it cannot.
 *
 * **IT IS NOT GUARDED BY `--dry-run`, AND THAT IS THE POINT.** `--dry-run`
 * suppresses the writes that change what an agent DOES — corrections, markers,
 * reaps. This changes no desk: it is the tick's observation, the same kind of
 * output as the stdout line a dry run already prints. Suppressing it would leave
 * the board showing a cause the estate has moved past, which is the failure this
 * whole channel removes.
 *
 * **A FAILED WRITE COSTS A FIELD, NEVER A TICK.** The daemon's job is to
 * supervise. A read-only filesystem, a full disk or a missing git dir leaves the
 * board with no cause — which it already renders as *the tick did not judge this
 * desk* — and the warning goes to stderr, where an incomplete tick's line goes,
 * because it is the stream a person reads when the supervisor is misbehaving.
 *
 * @param report - what the tick decided.
 * @param store - where the report goes.
 * @param warn - where a failed write is named.
 */
export const writeSupervisionReport = async (
  report: TickReport,
  store: SupervisionReportStore,
  warn: (s: string) => void,
): Promise<void> => {
  try {
    const written = await store.write(reportFor(report));
    if (!written.ok) warn('plot-fleetd: could not write the supervision report\n');
  } catch (err) {
    // A THROWN WRITE IS THE SAME FACT AS A FAILED ONE: the board gets no cause.
    // Caught here rather than at the loop, so a filesystem that rejects cannot
    // take the tick's own recovery path with it.
    warn(
      `plot-fleetd: could not write the supervision report: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
};

/**
 * Starts the fresh session for a spent desk: registers a new agent for it, then
 * continues the desk.
 *
 * **THE DESK HAS NO MANIFEST, SO ONE IS WRITTEN FIRST.** The loop's exit trap
 * removed the spent agent's manifest, and `continueOnDesk` refuses a desk no
 * manifest names. The fresh agent is a new agent: a new session id, which is
 * also its `resumeId`, so the loop finds no transcript and creates a session.
 *
 * **THE ORDER IS REGISTER, THEN CONTINUE'S CHECKS, THEN `beforeStart`, THEN THE
 * SPAWN.** The caller's record row is written in `beforeStart`, after continue
 * accepted the desk and before it spawned, so a crash never starts two
 * sessions. A crash between the registration and the row leaves a manifest and
 * no process, which the next tick's supervision reads as a dead agent.
 *
 * **A MANIFEST THAT STARTED NOTHING IS REMOVED.** A refusal, a failure or a
 * throw after the registration deregisters the agent, so no ghost registration
 * stays.
 *
 * @param input - the desk, the answer, and the caller's `beforeStart`.
 * @param deps - the registry port, the `Worker command`, an id source, and the
 *   continue workflow.
 * @returns what continue answered, or `failed` where the registration failed.
 */
export const startFreshSession = async (
  input: {
    branch: string;
    worktree: string;
    answer: string;
    main: string;
    beforeStart: () => Promise<boolean>;
  },
  deps: {
    agents: Pick<Agents, 'register' | 'deregister'>;
    command: string;
    newSession: () => string;
    continueDesk: (input: DeskContinuationInput) => Promise<DeskContinuation>;
    opts: DeskContinuationInput['opts'];
  },
): Promise<DeskContinuation> => {
  const session = deps.newSession();
  const registered = await deps.agents.register({
    session,
    branch: input.branch,
    worktree: input.worktree,
    command: deps.command,
  });
  if (!registered.ok) {
    return { kind: 'failed', error: 'the fresh agent could not be registered' };
  }
  try {
    const result = await deps.continueDesk({
      opts: deps.opts,
      // registryd is the master agent's own in-process recovery daemon — not a
      // person, and not `PLOT_UNATTENDED` either, since nothing here reads it.
      caller: 'fleetd',
      branch: input.branch,
      worktree: input.worktree,
      main: input.main,
      previousPid: '',
      answer: input.answer,
      fresh: true,
      beforeStart: input.beforeStart,
    });
    if (result.kind !== 'started') await deps.agents.deregister(session);
    return result;
  } catch (error) {
    await deps.agents.deregister(session);
    throw error;
  }
};

/**
 * The desk reads {@link startFreshAgents} takes in production.
 *
 * `asks.asked` is memoized for the lifetime of this call — one call per
 * tick, per {@link startFreshAgents}'s production call site — keyed by
 * plan, branch and ending time, so a tick with several candidates on the
 * same branch and ending reads `.plot/state/ending-asks.tsv` once rather
 * than once per candidate.
 *
 * @param context - the repository and its scripts directory.
 * @param asks - the `.plot/state/ending-asks.tsv` store.
 * @param askMerged - asks the host (or a tick's memo) whether a PR for a
 *   branch merged.
 * @param tally - the host-call counter this step adds to, one per question
 *   actually asked — a memo hit still counts, as {@link worldForRepo}'s own
 *   `prMerged` counts a shared `merges` answer.
 * @returns the desk-file, held-files, marker and ask reads.
 */
export const freshAgentDeskReads = (
  context: { repoRoot: string; scriptDir: string },
  asks: Pick<EndingAskRecordStore, 'asked'>,
  askMerged: (branch: string) => ReturnType<Host['prMerged']>,
  tally: HostTally = { calls: 0 },
): {
  deskFile: (worktree: string, name: string) => string | null;
  loopAlive: (worktree: string) => boolean;
  heldFiles: (worktree: string) => Promise<readonly string[] | null>;
  hasMarker: (worktree: string) => Promise<boolean>;
  asks: FreshAgentAskReads;
} => {
  const askedMemo = new Map<string, ReturnType<EndingAskRecordStore['asked']>>();
  const askedOnce: Pick<EndingAskRecordStore, 'asked'> = {
    asked: (plan, branch, endingAt) => {
      const key = `${plan}\t${branch}\t${endingAt}`;
      const cached = askedMemo.get(key);
      if (cached !== undefined) return cached;
      const result = asks.asked(plan, branch, endingAt);
      askedMemo.set(key, result);
      return result;
    },
  };
  return {
    deskFile: (worktree, name) => fileOrNull(join(worktree, name)),
    // A CANDIDATE HAS NO MANIFEST, so the desk's `.plot-worker.pid` is the one
    // pid source `deskLoopAlive` reads here.
    loopAlive: (worktree) => readDeskLoop(worktree, { kind: 'unnamed' }).loop.kind === 'alive',
    // A DEDICATED READ, NOT `world`'s `dirtyPaths` OR `dirtyCountOf`. Both
    // collapse a failed read into a lossy value (`[]` or a count of `1`) for
    // their own consumers; `holdingWorkAnswer` needs `null` preserved so it can
    // say the files could not be listed rather than claiming none are held.
    heldFiles: async (worktree) => {
      const answer = await treesGit(context).dirtyPaths(worktree);
      return answer.ok ? answer.value : null;
    },
    // A MARKER, NOT A DECLARATION: a marker written on a prior tick stops a
    // second write, whatever the declaration file holds.
    hasMarker: async (worktree) => (await markerReading(worktree)) !== null,
    asks: {
      endingAt: async (worktree) => {
        try {
          return (await stat(join(worktree, ENDING_FILENAME))).mtime.toISOString();
        } catch {
          return null;
        }
      },
      record: askedOnce,
      prMerged: async (branch) => {
        tally.calls += 1;
        return prMergedReading(await askMerged(branch));
      },
      // THE SAME READ `startNothingDoneReleases` MAKES OF THE SAME PORT — one
      // implementation of `Trees.commitBeyondClaim`/`hostShell(...).prState`
      // asked from two pipelines, matching `nothingDoneDecisions`'s own doc
      // comment on the duplicate `commitBeyondClaim` call.
      commitBeyondClaim: async (worktree) => {
        const commits = await treesGit(context).commitBeyondClaim(worktree);
        return commits.ok ? commits.value : 'unanswerable';
      },
      prOpen: async (branch) => {
        tally.calls += 1;
        return prOpenReading(await hostShell(context).prState(branch));
      },
    },
  };
};

/**
 * The dead-desk, git and host asks {@link killedWorkerEndings} takes in production.
 *
 * `deskDead` reads the desk's own files: the launch record's pid through
 * `readDeskLoop` for liveness, and the `PLOT-BLOCKED*` marker. The desk is on
 * this machine, since the candidate list holds only local trees.
 *
 * @param context - the repository and its scripts directory.
 * @param hasPr - launches the host already answered with a pull request; the caller keeps it across ticks.
 * @param tally - the host-call counter this step adds to, one per `prState` asked.
 * @returns the asks.
 */
export const killedWorkerReads = (
  context: { repoRoot: string; scriptDir: string },
  hasPr: Set<string>,
  tally: HostTally = { calls: 0 },
): KilledWorkerReads => ({
  deskDead: async (worktree): Promise<DeskDeadAnswer> => {
    const pid = Number((fileOrNull(join(worktree, '.plot-worker.pid')) ?? '').trim());
    return deskDead({
      read: 'desk',
      worktreeHere: true,
      pidRecorded: Number.isInteger(pid) && pid > 0,
      liveness: readDeskLoop(worktree, { kind: 'unnamed' }).loop.kind === 'alive' ? 'live' : 'dead',
      exit: fileOrNull(join(worktree, '.plot-worker.exit')),
      task: { hasPr: false, blocked: (await markerReading(worktree)) !== null, dirty: false, unpushed: null },
    });
  },
  commitBeyondClaim: async (worktree) => {
    const commits = await treesGit(context).commitBeyondClaim(worktree);
    return commits.ok ? commits.value : 'unanswerable';
  },
  prState: async (branch) => {
    tally.calls += 1;
    return hostShell(context).prState(branch);
  },
  hasPr,
});

/**
 * Reads, decides and applies the fresh-agent step for one completed tick.
 *
 * First, a desk whose worker exited non-zero, wrote no ending and holds no
 * live loop gets an `unreadable` ending from {@link killedWorkerEndings},
 * written to the desk; a failed write is reported and the desk is read as it
 * stands. Then desks whose worker ended `corrections-spent`, `turn-limit`,
 * `bound`, `unreadable`, `quiet`, or an after-prompt `holding-work` with no
 * manifest left get one fresh session through the continue workflow, or a
 * claim release where a `bound`/`unreadable`/`quiet` branch holds nothing
 * beyond its claim. A second such ending for the same slice, and a
 * `blocked`, `spend-limit`, `unstarted`, `run-limit` or `checks-unanswered`
 * ending, gets a `PLOT-BLOCKED.md` marker and one row in
 * `.plot/state/ending-asks.tsv`, once per ending. A failure anywhere in the
 * step is reported on stderr and never ends the daemon: the next tick reads
 * the same desks and the records again.
 *
 * @param report - the completed tick, whose `trees` name the candidates.
 * @param deps - how to read a desk file and its live loop, how to write an
 *   ending, the record, a desk's held files and marker, the ask reads, the
 *   ports to act through, and the repository's `Correction budget`.
 * @param write - where a started session or an escalation is reported.
 * @param warn - where a refusal or a failure is reported.
 * @returns what was applied, in desk order.
 */
export const startFreshAgents = async (
  report: TickReport,
  deps: {
    deskFile: (worktree: string, name: string) => string | null;
    loopAlive: (worktree: string) => boolean;
    killedReads: KilledWorkerReads;
    writeEnding: Desk['writeEnding'];
    record: Pick<FreshAgentRecordStore, 'rowsFor'>;
    heldFiles: (worktree: string) => Promise<readonly string[] | null>;
    hasMarker: (worktree: string) => Promise<boolean>;
    asks: FreshAgentAskReads;
    ports: FreshAgentPorts;
    budget: number;
  },
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<readonly FreshAgentApplied[]> => {
  try {
    const candidates = freshAgentCandidateTrees(report.trees ?? []);
    if (candidates.length === 0) return [];
    for (const { worktree, ending } of await killedWorkerEndings(candidates, deps.deskFile, deps.loopAlive, deps.killedReads)) {
      const written = await deps.writeEnding(worktree, ending);
      if (written.ok) {
        write(`plot-fleetd fresh-agent ${ending.branch}: recorded — ${ending.detail}; wrote an unreadable ending\n`);
      } else {
        warn(`plot-fleetd fresh-agent ${ending.branch}: unrecorded — ${ending.detail}; the ending could not be written\n`);
      }
    }
    const readings = await readFreshAgentCandidates(
      candidates,
      deps.deskFile,
      deps.record,
      deps.heldFiles,
      deps.hasMarker,
      deps.asks,
    );
    const applied = await applyFreshAgentDecisions(
      freshAgentDecisions(readings, deps.budget),
      deps.ports,
    );
    for (const { line, error } of freshAgentLines(applied)) (error ? warn : write)(`${line}\n`);
    return applied;
  } catch (err) {
    warn(`plot-fleetd: the fresh-agent step failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
};

/**
 * Builds the {@link FreshAgentPorts} {@link startFreshAgents} acts through in
 * production.
 *
 * Extracted from `run()` so the `args.startAgents && report.incomplete === ''`
 * gate can be tested by asserting this factory is never called, rather than
 * by asserting on the daemon's whole process wiring.
 *
 * @param deps.repoRoot - the repository root.
 * @param deps.scriptsDir - where the helper scripts are.
 * @param deps.registryDir - where agent manifests live.
 * @param deps.boardOpts - `{ repoRoot, scriptsDir }`, read for `Worker command`.
 * @param deps.record - the `.plot/state/fresh-agents.tsv` store.
 * @param deps.asks - the `.plot/state/ending-asks.tsv` store.
 * @param deps.desk - writes the `PLOT-BLOCKED.md` marker.
 * @param deps.release - decides and, where releasable, releases a branch's claim.
 * @param deps.runLog - the run log, appended once per fresh session actually started.
 * @returns the ports {@link applyFreshAgentDecisions} acts through.
 */
export const freshAgentPortsFor = (deps: {
  repoRoot: string;
  scriptsDir: string;
  registryDir: string;
  boardOpts: { repoRoot: string; scriptsDir: string };
  record: Pick<FreshAgentRecordStore, 'append'>;
  asks: Pick<EndingAskRecordStore, 'append'>;
  desk: Pick<Desk, 'writeBlockedMarker'>;
  release: (branch: string) => Promise<{ released: boolean; detail: string }>;
  runLog: Pick<RunLog, 'append'>;
}): FreshAgentPorts => ({
  record: deps.record,
  asks: deps.asks,
  desk: deps.desk,
  runLog: deps.runLog,
  now: () => new Date(),
  start: async ({ branch, worktree, answer, beforeStart }) => {
    const base = await refsGit({ repoRoot: deps.repoRoot, scriptDir: deps.scriptsDir }).defaultBranch();
    return startFreshSession(
      { branch, worktree, answer, main: base.ok ? base.value : '', beforeStart },
      {
        agents: agentsFs(
          { repoRoot: deps.repoRoot, scriptDir: deps.scriptsDir },
          { manifestDir: deps.registryDir },
        ),
        command: readConfig(deps.boardOpts, 'Worker command', ''),
        newSession: () => randomUUID(),
        continueDesk: continueOnDesk,
        opts: deps.boardOpts,
      },
    );
  },
  release: deps.release,
});

/**
 * Builds the {@link NothingDoneReleasePorts} {@link startNothingDoneReleases}
 * acts through in production.
 *
 * Extracted from `run()` so the tick's host spend is counted the same way
 * {@link freshAgentDeskReads} already counts its own `prOpen`/`prMerged`
 * calls: one `tally`, shared across both steps.
 *
 * @param context - the repository and its scripts directory.
 * @param record - the `.plot/state/fresh-agents.tsv` store, read for
 *   `priorFreshSessions` — the same store {@link freshAgentDeskReads} reads.
 * @param release - decides and, where releasable, releases a branch's claim.
 * @param tally - the host-call counter this step's `prOpen` port adds to, one
 *   per call actually made.
 * @returns the ports {@link applyNothingDoneDecisions} acts through.
 */
export const nothingDonePortsFor = (
  context: { repoRoot: string; scriptDir: string },
  record: Pick<FreshAgentRecordStore, 'rowsFor'>,
  release: (branch: string, localEvidence?: true) => Promise<{ released: boolean; detail: string }>,
  tally: HostTally = { calls: 0 },
): NothingDoneReleasePorts => ({
  commitBeyondClaim: async (worktree) => {
    const commits = await treesGit(context).commitBeyondClaim(worktree);
    return commits.ok ? commits.value : 'unanswerable';
  },
  prOpen: async (branch) => {
    tally.calls += 1;
    return prOpenReading(await hostShell(context).prState(branch));
  },
  // THE SAME STORE `startFreshAgents` READS, so a slice's one fresh session
  // is shared regardless of which pipeline asks about it first.
  priorFreshSessions: async (plan, branch) => {
    const rows = await record.rowsFor(plan, branch);
    return rows.ok ? rows.value.length : 0;
  },
  release,
});

/** The reads and the one write {@link startNothingDoneReleases} performs, injected so a test needs no git or host. */
export interface NothingDoneReleasePorts {
  /** Reads whether a desk's branch holds a commit beyond its claim, through `Trees.commitBeyondClaim`. */
  commitBeyondClaim: (worktree: string) => Promise<CommitReading>;
  /** Reads whether an open PR still carries the branch; `'unanswerable'` where the host could not be asked. */
  prOpen: (branch: string) => Promise<PrOpenReading>;
  /**
   * How many fresh sessions this slice already had, keyed by plan and branch
   * — the same store {@link startFreshAgents} reads, so the allowance is
   * shared whichever pipeline asks first.
   */
  priorFreshSessions: (plan: string, branch: string) => Promise<number>;
  /** Decides and, where releasable, releases the branch's claim; `localEvidence` licenses it where the host cannot answer. */
  release: (branch: string, localEvidence?: true) => Promise<{ released: boolean; detail: string }>;
}

/**
 * Releases the claim on every desk this tick decided `release-claim` for.
 *
 * Mirrors {@link startFreshAgents}'s shape: a pure filter and a pure decision
 * from `registryd.js`, an apply step that reaches a port, and one warn/write
 * line per outcome. {@link NothingDoneReleasePorts.release} is expected to be
 * backed by {@link gatherReadingsAndRelease} — the same
 * readings-gather-then-decide-then-release sequence the board's own release
 * route uses — so this tick and a person releasing a claim by hand reach one
 * decision about releasability rather than two.
 *
 * @param report - this tick's report; `report.trees` names every registered
 *   desk.
 * @param deps.deskFile - reads one file from a desk, or null where absent.
 * @param deps.ports - the reads and the release write.
 * @param write - the normal log sink.
 * @param warn - the error log sink.
 * @returns what was applied, in decision order.
 */
export const startNothingDoneReleases = async (
  report: TickReport,
  deps: {
    deskFile: (worktree: string, name: string) => string | null;
    ports: NothingDoneReleasePorts;
  },
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<readonly NothingDoneApplied[]> => {
  try {
    const candidates = nothingDoneCandidateTrees(report.trees ?? []);
    if (candidates.length === 0) return [];
    const readings = readNothingDoneCandidates(candidates, deps.deskFile);
    const decisions = await nothingDoneDecisions(
      readings,
      deps.ports.commitBeyondClaim,
      deps.ports.prOpen,
      deps.ports.priorFreshSessions,
    );
    const applied = await applyNothingDoneDecisions(decisions, deps.ports.release);
    for (const { line, error } of nothingDoneLines(applied)) (error ? warn : write)(`${line}\n`);
    return applied;
  } catch (err) {
    warn(`plot-fleetd: the nothing-done step failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
};

/** The channel's socket, beside the other per-checkout state under `.plot/`. */
export const CHANNEL_SOCKET = '.plot/fleet.sock';

/**
 * Opens the channel on `.plot/fleet.sock`, or reports why it did not.
 *
 * A start that rejects costs the channel and nothing else: the daemon warns
 * once and runs without it. `startChannel` rejects when a live process holds
 * the path, which it leaves to that process, and when the bind fails, such as
 * for a socket path past the platform's limit.
 *
 * @param repoRoot - the checkout the socket lives in.
 * @param warn - where the failure is reported.
 * @param start - opens the channel; the real transport unless a test gives one.
 * @returns the running channel, or `null` where it could not be opened.
 */
export const startFleetChannel = async (
  repoRoot: string,
  warn: (s: string) => void,
  start: typeof startChannel = startChannel,
): Promise<RunningChannel | null> => {
  try {
    return await start({ address: join(repoRoot, CHANNEL_SOCKET) });
  } catch (err) {
    warn(
      `plot-fleetd: the channel could not start, running without it: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
};

/** The channel and the two runs built over it; all `null` while no channel is bound. */
export interface ChannelSlot {
  channel: RunningChannel | null;
  indexMonitor: (() => Promise<void>) | null;
  deskRelay: (() => Promise<void>) | null;
}

/**
 * Binds the slot to a channel and builds the runs over it.
 *
 * Where `stopped` reads true once `open` resolves, the bind is discarded
 * rather than written: the slot's own stop path has already run by then and
 * will never see this channel, so writing it would leave it running past the
 * point the daemon meant to have stopped everything. The channel this call
 * opened is stopped immediately instead.
 *
 * @param slot - the slot to fill; left untouched where it already holds a channel.
 * @param open - one attempt to open the channel.
 * @param over - builds the monitor and the relay over an opened channel.
 * @param onBound - called once the slot newly holds a channel; not called where it already did or where discarded.
 * @param stopped - reads true where a stop was read while `open` was in flight; discards the bind. Defaults to never.
 * @returns true where the slot holds a channel after the call.
 */
export const bindChannelSlot = async (
  slot: ChannelSlot,
  open: () => Promise<RunningChannel | null>,
  over: (channel: RunningChannel) => Pick<ChannelSlot, 'indexMonitor' | 'deskRelay'>,
  onBound?: () => void,
  stopped: () => boolean = () => false,
): Promise<boolean> => {
  if (slot.channel !== null) return true;
  const channel = await open();
  if (channel === null) return false;
  if (stopped()) {
    await channel.stop();
    return false;
  }
  Object.assign(slot, { channel }, over(channel));
  onBound?.();
  return true;
};

/**
 * Builds the `prs` beat: the PR read, the default-branch read, a bind retry
 * where the slot has no channel, then the IndexMonitor.
 *
 * The order is load-bearing: the monitor reads the default-branch file that
 * `readDefaultBranch` has just refreshed. The monitor and the retry are read
 * from the slot on each beat, so a channel bound by the retry serves the same
 * beat.
 *
 * @param reads - the two reads that precede the monitor.
 * @param slot - the channel and its runs.
 * @param retry - one more bind attempt; absent where the daemon opens no channel.
 * @returns the function to hand to `startFleetClock` as `prs`.
 */
export const prsBeat = (
  reads: { readPrs: () => Promise<void>; readDefaultBranch: () => Promise<void> },
  slot: ChannelSlot,
  retry?: () => Promise<unknown>,
): (() => Promise<void>) => async () => {
  await reads.readPrs();
  await reads.readDefaultBranch();
  if (slot.channel === null) await retry?.();
  await slot.indexMonitor?.();
};

/**
 * Runs the desk relay once, outside the tick's own failure path.
 *
 * @param slot - the channel and its runs; no relay runs where it has none.
 * @param warn - receives the reason where the relay throws.
 */
export const relayBeat = async (slot: Pick<ChannelSlot, 'deskRelay'>, warn: (s: string) => void): Promise<void> => {
  try {
    await slot.deskRelay?.();
  } catch (e) {
    warn(`plot-fleetd: desk relay failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
};

/**
 * A stop flag `run` asks at the top of each loop pass, with an optional
 * promise that settles when the stop is requested.
 *
 * `run` races its wait between ticks against `requested`, so a stop that
 * arrives during the wait ends the wait at once. A flag with no `requested`
 * is read only between waits.
 */
export type StopFlag = (() => boolean) & { readonly requested?: Promise<void> };

/** The exit code for a second signal: 128 plus the signal's number. */
const SIGNAL_EXIT: Record<'SIGTERM' | 'SIGINT', number> = { SIGTERM: 143, SIGINT: 130 };

/**
 * Makes a stop flag that SIGTERM and SIGINT set.
 *
 * The first signal sets the flag and settles `requested`, so `run` ends its
 * wait, stops the clock and the channel, and returns. A second signal exits
 * the process at once with 128 plus the signal's number.
 *
 * @param proc - the signal source and the exit; `process` unless a test gives one.
 * @returns the flag to hand to `run` as `stop`.
 */
export const stopOnSignals = (proc: Pick<NodeJS.Process, 'on' | 'exit'> = process): StopFlag => {
  let stopped = false;
  let settle: () => void = () => undefined;
  const requested = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const on = (signal: 'SIGTERM' | 'SIGINT') => (): void => {
    if (stopped) proc.exit(SIGNAL_EXIT[signal]);
    stopped = true;
    settle();
  };
  proc.on('SIGTERM', on('SIGTERM'));
  proc.on('SIGINT', on('SIGINT'));
  return Object.assign(() => stopped, { requested });
};

/**
 * What `run` builds for itself unless a caller gives it: the seams a test
 * replaces to drive the loop without a host, a scan or a socket.
 */
export interface RunSeams {
  /** One supervision tick; `tick` by default. */
  tick?: typeof tick;
  /** The fleet clock's beat source; the system clock by default. */
  clock?: Clock;
  /** Opens the channel transport; `startChannel` by default. */
  openChannel?: typeof startChannel;
  /** Builds the monitor and the relay over an opened channel. */
  overChannel?: (channel: RunningChannel) => Pick<ChannelSlot, 'indexMonitor' | 'deskRelay'>;
  /** The scan the clock runs on every beat. */
  scan?: () => Promise<void>;
  /** The PR read on the PR beat. */
  readPrs?: () => Promise<void>;
  /** The default-branch read on the PR beat. */
  readDefaultBranch?: () => Promise<void>;
  /** The issue read on the issue beat. */
  readIssues?: () => Promise<void>;
  /** Replaces the drain of the tracker writes Plot made; tests only. */
  readIssueWrites?: () => Promise<void>;
  /** The escalation `Notifier`; the configured `Notify command` by default. Tests only. */
  notifier?: () => Promise<Notifier>;
}

/**
 * Builds the IndexMonitor's run over the files fleetd writes and the plans it
 * reads.
 *
 * Reads the stored PR index and the default-branch file, never the host. The
 * slice branches are the branches every plan names, read from the plan store
 * the queue reads: an empty set where no plan names a branch, and `null` where
 * the plan store cannot be listed or read.
 *
 * @param context - the checkout and its scripts directory.
 * @param channel - the channel to publish on.
 * @param write - receives one log line per publish and per clear.
 * @returns one run of the monitor.
 */
export const indexMonitorOver = (
  context: { repoRoot: string; scriptDir: string },
  channel: Pick<RunningChannel, 'findings' | 'publish' | 'seen'>,
  write: (s: string) => void,
): (() => Promise<void>) => {
  const host = hostShell(context);
  const refs = refsGit(context);
  const plans = fleetPlanStore(context, refs);
  const index = prIndexFile({ cwd: context.repoRoot });
  const defaultBranch = defaultBranchFile(context.repoRoot);
  return () =>
    runIndexMonitor({
      index: async () => {
        const backend = await host.backend();
        if (!backend.ok) return null;
        const held = await index.read(backend.value);
        return held.ok ? held.value : null;
      },
      defaultBranch: async () => {
        const held = await defaultBranch.read();
        return held.ok ? held.value : null;
      },
      sliceBranches: () => sliceBranchesOf(plans),
      channel,
      now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      log: write,
    });
};

/**
 * Builds the desk relay's run over the trees and the desks' monitor logs.
 *
 * @param context - the checkout and its scripts directory.
 * @param channel - the channel to publish on.
 * @param write - receives one log line per publish and per clear.
 * @returns one run of the relay.
 */
export const deskRelayOver = (
  context: { repoRoot: string; scriptDir: string },
  channel: Pick<RunningChannel, 'findings' | 'relay'>,
  write: (s: string) => void,
): (() => Promise<void>) => {
  const trees = treesGit(context);
  return () =>
    runDeskRelay({
      trees,
      desk: deskFs(trees),
      channel,
      now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      log: write,
    });
};

/**
 * Runs the temp sweep when an hour has passed since the last one.
 *
 * A failed sweep is reported on stderr and never ends the daemon: the sweep is
 * a backstop for temp paths a SIGKILL left, and the next hour asks again.
 *
 * @param sweep - the temp sweep port.
 * @param now - the current time, in epoch ms.
 * @param write - where the summary line goes.
 * @param warn - where a failure goes.
 * @returns true when a sweep ran.
 */
export const sweepTempIfDue = async (
  sweep: TempSweep,
  now: number,
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<boolean> => {
  if (!tempSweepDue(await sweep.lastAt(), now)) return false;
  const result = await sweep.sweep();
  if (result.ok) write(`plot-fleetd: ${result.value}\n`);
  else warn('plot-fleetd: the temp sweep did not run (plot-reap.sh --sweep-temp)\n');
  return true;
};

/**
 * Runs the supervisor: one tick under `--once`, otherwise the loop with its
 * scan clock and its channel on `<repoRoot>/.plot/fleet.sock`.
 *
 * @param argv - the command-line arguments.
 * @param here - the directory of the running bundle; the scripts resolve from it.
 * @param write - where the report lines go.
 * @param sleep - waits between ticks.
 * @param stop - asked at the top of each loop pass; true ends the loop.
 * @param warn - where failures go.
 * @param repoRoot - the checkout supervised; `PLOT_REPO_ROOT`, else the working directory.
 * @param seams - replacements for what `run` builds itself; see {@link RunSeams}.
 * @returns the exit code: 0 for a stopped loop, 2 for a bad argument.
 */
export const run = async (
  argv: readonly string[],
  here: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  stop: StopFlag = () => false,
  warn: (s: string) => void = (s) => process.stderr.write(s),
  repoRoot: string = process.env.PLOT_REPO_ROOT ?? process.cwd(),
  seams: RunSeams = {},
): Promise<number> => {
  const args = argsFrom(argv);
  if (args === null) {
    process.stderr.write(
      'usage: plot-fleetd.mjs [--once] [--dry-run] [--start-agents] [--sweep-temp] [--max N] [--interval SECONDS]\n',
    );
    return 2;
  }

  const scriptsDir = scriptsDirFor(here);
  const registryDir = registryDirFor(repoRoot, scriptsDir);

  // WRITTEN ONCE, HERE, AT THE TOP OF THIS PROCESS'S LIFE — never again this
  // run, and never read back by the daemon itself (#2728, `docs/plans/
  // 2026-10-26-a-board-or-fleetd-older-than.md`). `plot-fleetctl.sh --status`,
  // through `plot-ask.mjs spawner`, is the reader; `registryd-main.ts`'s
  // `run()` is the ONLY writer, the same one-writer contract
  // `one-issue-index-writer.test.ts` holds for `issues.json`. A failed write
  // is reported and never stops the daemon from starting — report only.
  const fleetdStartedAt = Date.now();
  const record = fleetdStartRecord(repoRoot, here, scriptsDir, process.pid, fleetdStartedAt);
  if (record !== null) {
    const written = await fleetdStartFile({ cwd: repoRoot }).write(record);
    if (!written.ok) warn(`plot-fleetd: could not write fleetd-start.json — spawner status will read unknown\n`);
  } else {
    warn(`plot-fleetd: could not hash ${fleetdBundlePath(here)} — spawner status will read unknown\n`);
  }

  const tally: HostTally = { calls: 0 };
  // ONE `Checks wait` READ PER TICK, SHARED BY BOTH CONSUMERS. `queue`'s own
  // `defaultBranchRed` and `defaultBranchWorld` below each used to call
  // `readConfigAsync` independently — two `plot-config.sh` spawns for one
  // value. `checksWaitCache` is cleared at the top of each tick (beside
  // `tally.calls`), so the first read of a tick spawns once and the second
  // reuses it; a config edit still takes effect on the NEXT tick.
  let checksWaitCache: Promise<number> | null = null;
  const checksWaitMs = (): Promise<number> => {
    checksWaitCache ??= (async () =>
      checksWaitMsOf(await readConfigAsync({ repoRoot, scriptsDir }, 'Checks wait', '3600')))();
    return checksWaitCache;
  };
  // ONE MEMO FOR BOTH WORLDS. `tick` reads the supervisor world first, and its
  // `beginTick` clears the memo, so the queue read that follows shares the
  // tick's answers and the next tick asks again.
  const merges = mergeMemoOver(hostShell({ repoRoot, scriptDir: scriptsDir }));
  const world = worldForRepo(repoRoot, scriptsDir, tally, merges);
  const queue = queueWorldForRepo(repoRoot, scriptsDir, tally, merges, undefined, undefined, checksWaitMs);
  // SHARES `tally` WITH `queue` ABOVE so a hand-over's fresh `queuedHasLanded`
  // call still counts toward the tick's host tally — but NOT `merges`: a
  // hand-over asks the host again on purpose, and the tick's memo would hand
  // back the very reading this check exists to outdate.
  const handOverWorld = handOverWorldForRepo(repoRoot, scriptsDir, tally);
  const scripts = scriptsShell({ repoRoot, scriptDir: scriptsDir });
  // BUILT WHETHER OR NOT IT IS USED, because building it reaches nothing: the
  // adapter is a closure over two paths and spawns only when it is called.
  const performer = performerShell({ repoRoot, scriptDir: scriptsDir });
  // SAME REASON: the probe cuts and removes its own scratch desk only when
  // `startAgents` below actually calls it, ahead of the first `worker-start`.
  const probe = writeProbeShell({ repoRoot, scriptDir: scriptsDir });
  // ONE STORE FOR THE DAEMON'S WHOLE LIFE, so the `--git-common-dir` lookup is
  // forked once rather than every tick — the adapter caches it per instance, and
  // a store rebuilt per tick would throw that away 1,440 times a day.
  //
  // THE DAEMON IS THE ONLY WRITER. The board reads this file and never writes
  // it; the `rename` is atomic but the decide-then-write sequence around it is
  // not, so a second writer would race.
  const reportStore = supervisionReportFile({ cwd: repoRoot });
  const tempSweep = tempSweepShell({ repoRoot, scriptDir: scriptsDir });
  const escalated = escalationMemory();
  // SHARES `merges` AND `tally` WITH `worldForRepo` ABOVE, so a branch this
  // pass and the supervisor's own `prMerged` both ask about in the same tick
  // costs one host call, memoized by `beginTick`'s clear — not two.
  const escalation = escalationWorldForRepo(repoRoot, scriptsDir, escalated, (branch) => merges.ask(branch), tally);
  // `--once` BUILDS NO IDLE READER, so a one-shot tick appends no run-log
  // line and sends no notification for this pass — matching `freshAgentRunLog`
  // above. `trees.list()` is this reader's own desk source, deliberately not
  // `escalationDesks`' reading of `supervised.detail.agents` (`registryd.ts`'s
  // own comment on `idleNotifyWrites`'s call site says why): the idle pass
  // judges open slice PRs, a population the registry does not enumerate.
  const idleTrees = treesGit({ repoRoot, scriptDir: scriptsDir });
  const idle = args.once
    ? undefined
    : idleWorldForRepo(repoRoot, scriptsDir, fleetdStartedAt, async () => {
        const listed = await idleTrees.list();
        if (!listed.ok) return [];
        return listed.value
          .filter((tree) => !tree.isMain && tree.branch !== '')
          .map((tree) => ({ worktree: tree.path, branch: tree.branch }));
      });
  // READ WHEN A TICK HOLDS A `notify` WRITE, so a `Notify command` added
  // while the daemon runs takes effect at the next escalation.
  const notifier =
    seams.notifier ??
    (async (): Promise<Notifier> =>
      notifierFor(await readConfigAsync({ repoRoot, scriptsDir }, NOTIFY_COMMAND_KEY, '')));
  // THE DAEMON IS THE ONLY WRITER OF THE FRESH-AGENT RECORD, for the reason
  // `reportStore` above gives, and the store lives for the daemon's whole life
  // so the `--git-common-dir` lookup is forked once.
  const freshAgentRecord = freshAgentRecordFile({ cwd: repoRoot });
  const boardOpts = { repoRoot, scriptsDir };
  // THE DAEMON IS THE ONLY WRITER OF THE ASK RECORD, for the same reason.
  const endingAsks = endingAskRecordFile({ cwd: repoRoot });
  // Launches the host answered with a pull request; emptied by a fleetd restart.
  const launchesWithPr = new Set<string>();
  // ONE RELEASE PATH FOR BOTH STEPS: the fresh-agent step releases a
  // `bound`/`unreadable`/`quiet` desk, the nothing-done step every other
  // `release-claim`. SHARES `tally` with both steps, so a release either one
  // triggers counts toward the tick's own host spend.
  const releaseContext = { repoRoot, scriptDir: scriptsDir };
  const releaseClaimOf = async (branch: string, localEvidence?: true) => {
    const { result } = await gatherReadingsAndRelease(
      branch,
      releaseContext,
      tally,
      localEvidence ? 'claim-only' : 'unknown',
    );
    return { released: result.released, detail: result.detail };
  };
  const freshAgentDesk = deskFs(treesGit({ repoRoot, scriptDir: scriptsDir }));
  // `--once` APPENDS NO RUN-LOG LINE, EVEN IF `--start-agents` WERE EVER PASSED
  // WITH IT. No known caller combines the two flags today, but a fresh-agent
  // start is gated by `args.startAgents` alone (`:2807`), not by `!args.once` —
  // so the one-shot contract is held HERE, at the port, rather than assumed
  // from how the CLI happens to be invoked.
  const freshAgentRunLog = args.once ? { append: async () => answered(undefined) } : runLogFile({ cwd: repoRoot });
  const freshAgentPorts: FreshAgentPorts = freshAgentPortsFor({
    repoRoot,
    scriptsDir,
    registryDir,
    boardOpts,
    record: freshAgentRecord,
    asks: endingAsks,
    desk: freshAgentDesk,
    release: releaseClaimOf,
    runLog: freshAgentRunLog,
  });

  // THE SCAN HAS ITS OWN CLOCK, apart from `tick`: a scan runs up to 90 s and
  // must neither delay a supervision tick nor start a second scan. `--once`
  // runs one tick and no scan.
  //
  // HELD IN ITS OWN VARIABLE, like `prState`/`issueState` below, so the tick
  // can read `scanState.calls` for the tick line — not constructed inline as
  // `fleetScan`'s argument, which would leave no reference to read back.
  const scanState = freshScanState();
  const prState = freshPrState();
  // THE ISSUE GATE RUNS ON ITS OWN BEAT, every `ISSUE_REFRESH_MS`
  // (`fleet-clock.ts`). It reads the PR state's backoff and never writes it;
  // the PR pass reads the issue gate's cadence fields from `issues.json`
  // through `issueGateOf` and never writes that file.
  const issueState = freshIssueState();
  const issueStore = issueIndexFile({ cwd: repoRoot });
  const issueWorld = {
    context: { repoRoot, scriptDir: scriptsDir },
    declaredTracker: await readConfigAsync({ repoRoot, scriptsDir }, 'Tracker', ''),
    gitHost: await (async () => {
      const answer = await hostShell({ repoRoot, scriptDir: scriptsDir }).backend();
      if (answer.ok) return answer.value;
      const reason = answer.why === 'unaskable' && answer.reason !== undefined ? answer.reason : answer.why;
      warn(`plot-fleetd: the git host probe did not answer (${reason}) — assuming github\n`);
      return 'github';
    })(),
    issueStore,
    issueWrites: issueWriteSpoolOver(issueStore),
    prBackoff: () => ({
      connector: prState.backend,
      account: prState.prAccount,
      until: prState.prNextIsBackoff ? prState.prNextAt : null,
    }),
  };
  const readIssues = fleetIssues(
    issueWorld,
    issueState,
    warn,
  );
  const prReaderLock = readerLockFile({ cwd: repoRoot });
  const readPrs = fleetPrs(
    {
      scripts,
      host: hostShell({ repoRoot, scriptDir: scriptsDir }),
      store: prIndexFile({ cwd: repoRoot }),
      issueGate: issueGateOf(issueStore),
    },
    prState,
    { lock: prReaderLock },
    warn,
  );
  // FLEETD COMPOSES THE LOCAL AND THE REMOTE REFS READER, as `worker-loop.ts`
  // does: `refsGit` answers `remoteSha` as `unaskable`, `refsRemoteGit` reads
  // `git ls-remote`. It rides the PR reader's beat, so the head is read once per
  // beat and the runs only when the SHA moved or the re-ask rule is due.
  const ci = await buildShell({ repoRoot, scriptDir: scriptsDir });
  const defaultBranchWorld = args.once
    ? null
    : {
        // SHARES THE TICK LOOP'S CACHE (`checksWaitMs` ABOVE), rather than
        // spawning its own `plot-config.sh` read for the same key — this
        // object is built once, before the first tick, so without the share
        // its read and the tick's were the two independent calls #1456/#1508
        // named.
        branch: async () => {
          const base = await refsGit({ repoRoot, scriptDir: scriptsDir }).defaultBranch();
          return base.ok ? base.value : null;
        },
        refs: {
          remoteSha: refsRemoteGit({ repoRoot, scriptDir: scriptsDir }).remoteSha,
          firstParentLine: refsGit({ repoRoot, scriptDir: scriptsDir }).firstParentLine,
        },
        build: ci,
        store: defaultBranchFile(repoRoot),
        repair: repairRecordFile(repoRoot),
        // The host-slot bound is GitHub's account budget; other systems call direct.
        slot: <T,>(call: () => Promise<T>): Promise<T> =>
          ci.system() === 'github-actions'
            ? withHostSlot(prState, call)
            : call(),
        now: () => Date.now(),
        checksWaitMs: await checksWaitMs(),
        checks: checkNamesOf(await readConfigAsync({ repoRoot, scriptsDir }, 'Default branch checks', '')),
      };
  // WARNS ONCE PER CAUSE: `refreshDefaultBranch` is asked every tick, and a
  // lasting read failure would otherwise repeat the same line every tick
  // forever. `lastDefaultBranchWarning` holds the last line passed through;
  // an identical line is dropped, a changed one (a new cause, or the
  // reading recovering to no warning at all) passes and replaces it.
  let lastDefaultBranchWarning: string | null = null;
  const warnDefaultBranchOnce = (line: string): void => {
    if (line === lastDefaultBranchWarning) return;
    lastDefaultBranchWarning = line;
    warn(line);
  };
  const readDefaultBranch = seams.readDefaultBranch ?? (async (): Promise<void> => {
    if (defaultBranchWorld === null) return;
    try {
      await refreshDefaultBranch(defaultBranchWorld, warnDefaultBranchOnce);
    } catch (e) {
      warn(`plot-fleetd: default-branch read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  // THE CHANNEL IS THE LOOP'S ALONE: `--once` opens no socket, which would
  // leave a stale file behind. A bind that fails at start is one warning; the
  // daemon runs without the channel until a later PR beat binds it. The PR
  // index and the default-branch file are written whether or not anyone
  // listens.
  const slot: ChannelSlot = { channel: null, indexMonitor: null, deskRelay: null };
  const overChannel =
    seams.overChannel ??
    ((channel: RunningChannel) => ({
      indexMonitor: indexMonitorOver({ repoRoot, scriptDir: scriptsDir }, channel, write),
      deskRelay: deskRelayOver({ repoRoot, scriptDir: scriptsDir }, channel, write),
    }));
  const openChannel = seams.openChannel ?? startChannel;
  if (!args.once) await bindChannelSlot(slot, () => startFleetChannel(repoRoot, warn, openChannel), overChannel);
  // A LATER BEAT RETRIES A FAILED BIND, silently: the start warned once, and a
  // live process holding the path would otherwise warn on every beat.
  // THE QUEUE'S LAST HOLDS, for the verify pass on the scan clock. `null`
  // until a tick completes, and after one that did not: no reading holds nothing back.
  const queueHolds: { held: readonly HeldSlice[] | null } = { held: null };
  const retryBind = args.once
    ? undefined
    : () =>
        bindChannelSlot(
          slot,
          () => startFleetChannel(repoRoot, () => undefined, openChannel),
          overChannel,
          () => warn('plot-fleetd: channel bound\n'),
          stop,
        );
  const scanClock = args.once
    ? null
    : startFleetClock(seams.clock ?? clockSystem(), {
        scan: seams.scan ?? fleetScan(
          {
            repoRoot,
            scripts,
            refs: refsGit({ repoRoot, scriptDir: scriptsDir }),
            backend: async () => {
              const answer = await hostShell({ repoRoot, scriptDir: scriptsDir }).backend();
              return answer.ok ? answer.value : 'github';
            },
            walk: {
              host: hostShell({ repoRoot, scriptDir: scriptsDir }),
              plans: (ref, planDir) => planStoreRef(refsGit({ repoRoot, scriptDir: scriptsDir }), { repoRoot, scriptDir: scriptsDir }, ref, planDir),
              worktree: planStoreShell({ repoRoot, scriptDir: scriptsDir }),
              trees: treesGit({ repoRoot, scriptDir: scriptsDir }),
              agents: agentsFs({ repoRoot, scriptDir: scriptsDir }),
              processes: processesShell({ repoRoot, scriptDir: scriptsDir }),
              parser: scriptPath({ repoRoot, scriptDir: scriptsDir }, 'plot-plan-meta.sh'),
            },
          },
          fleetStateFile({ repoRoot }),
          scanState,
          () => Date.now(),
          warn,
          // THE PR READER'S LAST FAILURE still rides the bridge beside the
          // pulse, for a board reading `elect` with no other reader to
          // publish a reader-lock state yet. A board reading `follow`
          // reads `ReaderLock.readerState` instead, since fleetd is no
          // longer the only process that can hold this lock
          // (`the-boards-share-one-pr-reader`).
          () => prState.prError,
          // THE AUTOMATIC WRITES RUN HERE, on the pulse this scan just wrote
          // and never inside `tick`: a scan that failed calls nothing.
          fleetAutoWrites(
            {
              repoRoot,
              scriptsDir,
              scripts,
              // THE PULSE'S PLAN SOURCE, so the rejection hold reads the plan
              // the pulse named rather than the daemon's lagging checkout.
              planStore: pulsePlanStore(
                { repoRoot, scriptDir: scriptsDir },
                refsGit({ repoRoot, scriptDir: scriptsDir }),
              ),
            },
            warn,
            () => queueHolds.held,
            stop,
          ),
        ),
        prs: prsBeat({ readPrs: seams.readPrs ?? readPrs, readDefaultBranch }, slot, retryBind),
        issues: seams.readIssues ?? readIssues,
        issueWrites: seams.readIssueWrites ?? fleetIssueWrites(issueWorld, issueState, warn),
      }, warn);
  const runTick = seams.tick ?? tick;
  // THE WAIT BETWEEN TICKS ENDS ON A STOP. A stop read before the wait skips
  // it; one that arrives during it settles `stop.requested` and ends it, so a
  // SIGTERM ends the daemon within the current tick rather than after the
  // interval.
  const requested = stop.requested ?? new Promise<void>(() => undefined);
  const pause = async (): Promise<void> => {
    if (stop()) return;
    await Promise.race([sleep(args.intervalMs), requested]);
  };

  write(`plot-fleetd: supervising ${registryDir}\n`);

  let lastReadAt = Date.now();
  for (;;) {
    if (stop()) {
      // THE CLOCK'S RUNS END BEFORE THE DAEMON DOES. `stop()` cancels the next
      // beat only; a scan already started still runs its automatic writes, and
      // they write `.plot/state/` after `run` returned.
      scanClock?.stop();
      await scanClock?.idle();
      await slot.channel?.stop();
      // A released claim reads as no holder, so a board elects at once rather
      // than following a lock this stopped daemon no longer refreshes.
      if (prState.backend !== null) await prReaderLock.release(prState.backend, process.pid);
      return 0;
    }
    // A THROWN TICK IS A REPORTED TICK, NOT A DEAD DAEMON.
    //
    // The paragraph below — *the loop continues whatever the tick reported* —
    // was written about a tick that REPORTS a failure, and there was nothing
    // here to catch one that THROWS. `tick` reaches git, the host and the
    // filesystem through the world; any of them can reject, and an unhandled
    // rejection ends the process before the recovery below is reached.
    //
    // WHAT THIS CLOSES, CORRECTED 2026-09-23 after a delivery panel refuted
    // the original claim. `tick` CARRIES ITS OWN CATCH — `entry/registryd.ts`
    // — so the class this guard closes is a throw that escapes that catch, or
    // one raised by this loop's own code around it. On today's production
    // path that class is empty, and this guard is defence in depth rather
    // than a fix for an observed death.
    //
    // THE SUPERVISOR'S DEATHS ON 2026-09-22 WERE NOT THIS. `fleetctl.test.mjs`
    // was unloading the production launchd label; `a-test-must-not-stop-the-fleet`
    // measured and fixed it. The `runs = 1` reading cited in the original plan
    // was re-measured as `38 -> 39 -> 40` in forty seconds — `KeepAlive` was
    // restarting it, and the label was being taken away underneath.
    //
    // THE CATCH IS INSIDE THE LOOP, which is what makes the recovery the one
    // the contract already promises: the next iteration re-reads the registry
    // and the desks from disk, exactly as it does after a restart.
    let report: TickReport;
    // CLEARED HERE, AT THE TOP OF THE TICK: a tick reads `Checks wait` at most
    // once (`checksWaitMs` above), and a config edit on `main` takes effect
    // on the NEXT tick rather than never. `tally.calls` is reset separately,
    // after the spend reading below — see the comment there.
    checksWaitCache = null;
    try {
      // THE REGISTRY IS RE-READ HERE, at the top of every tick. That is the
      // whole of the daemon's state: there is nothing else to lose, so
      // `kill -9` costs one tick.
      report = await runTick({
        registry: () => readRegistry(registryDir, warn, !args.once),
        world,
        queue,
        // THE CAP IS ASKED ONLY WHERE THE DAEMON MAY ACT ON IT. A tick that
        // read the cap and started nothing would print `started=0` beside a
        // queue it was never allowed to serve, which reads as *the fleet is
        // the right size* rather than as *nobody asked me to grow it*.
        fleet: args.startAgents ? () => fleetCapForRepo(repoRoot, scriptsDir) : undefined,
        max: args.max,
        // ESCALATION RUNS EVERY TICK, REGARDLESS OF `--start-agents`. It is not
        // an agent-starting decision — a desk's question ages whether or not
        // this daemon is allowed to grow the fleet.
        escalation,
        // ABSENT UNDER `--once` (see where `idle` is built above), so a
        // one-shot tick decides nothing about idle slices either.
        idle,
      });
    } catch (err) {
      // STDERR, AND THE ERROR'S OWN TEXT. `registryd.err` being empty on both
      // measured deaths is why this cannot go to the tick log: a failure
      // written where the ticks go is as invisible as the crash was.
      warn(`plot-fleetd tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
      // `--once` IS A GATE AND MUST STILL FAIL. An operator installing a
      // supervisor runs it to learn whether the daemon works; swallowing the
      // failure would report a healthy daemon and hand them a crash loop with
      // a restart policy.
      if (args.once) return 1;
      // NOTHING IS REPORTED FOR THIS TICK, and that is deliberate: a tick that
      // threw halfway decided nothing, and the contract says the decision is
      // empty rather than truncated. The interval is still waited, so a
      // failure that repeats cannot spin.
      //
      // THE RELAY RUNS ON THIS PATH TOO: reading the desks' monitor logs needs
      // no host call, so a failing tick does not stop desk findings reaching
      // the channel.
      await relayBeat(slot, warn);
      // RESET HERE, NOT ONLY AFTER THE SPEND READING BELOW: this `continue`
      // skips that reading entirely, and the NEXT tick's own spend reading
      // must not inherit whatever calls this tick made before it threw. The
      // other three loops run on their own clocks and are read (and reset)
      // only at the completion path below, so a throw here leaves them alone.
      tally.calls = 0;
      await pause();
      continue;
    }

    // `!args.once` IS THE LOOP, and this is the only place that knows. The
    // `if (args.once) return code` below is what separates them, so until that
    // line both paths run here and the distinction is passed rather than
    // inferred downstream.
    // THE SPEND IS READ ONLY FOR A TICK THAT COMPLETED. An incomplete tick
    // keeps its own line, and a spend reading that fails leaves `account=unread`
    // on a complete one: neither reading can change which kind of tick it was.
    // Reported, never acted on — `args.intervalMs` below does not read it.
    // THE BACKGROUND LOOPS ACCRUE BETWEEN READINGS, so each one's count is
    // priced over the time since the last reading, not over its own cadence:
    // the scan makes about twelve calls in one 60 s tick, and twelve calls
    // over a 5 s cadence would print 8,640/hr for a loop spending 720.
    const backgroundWindowMs = Math.max(1, Date.now() - lastReadAt);
    if (report.incomplete === '') {
      report = {
        ...report,
        spend: await spendForTick(scripts, [
          { name: 'tick', calls: tally.calls, intervalMs: args.intervalMs },
          { name: 'scan', calls: scanState.calls, intervalMs: backgroundWindowMs },
          { name: 'pr-reader', calls: prState.calls, intervalMs: backgroundWindowMs },
          { name: 'issue-reader', calls: issueState.calls, intervalMs: backgroundWindowMs },
        ]),
      };
      lastReadAt = Date.now();
    }
    // RESET HERE, NOT AT THE TOP OF THE TICK: the fresh-agent and nothing-done
    // steps below run AFTER this reading and add to `tally.calls` themselves
    // — a reset at the top cleared their calls before `spendForTick` next
    // read them, so a tick's own host spend from those two steps was never
    // reported. A tick that throws (the `continue` above) or is incomplete
    // takes no spend reading, so it carries no calls forward either way; the
    // next tick's own reset still runs here, once that tick completes. The
    // scan, PR reader and issue reader tallies are reset the same way and for
    // the same reason — each runs on its own clock and keeps accruing calls
    // between ticks, so only the reading that just printed them may zero them.
    tally.calls = 0;
    scanState.calls = 0;
    prState.calls = 0;
    issueState.calls = 0;
    queueHolds.held = report.incomplete === '' && report.handOver !== null ? report.handOver.detail.held : null;
    const code = reportTick(report, write, warn, !args.once);
    // THE ONE CHANNEL TO THE BOARD, written beside the log and for the same
    // reason: the tick's judgement is worth nothing to an operator that cannot
    // read it. Until this, the cause reached stdout and stopped there, and a
    // board asking for it would have had to run `supervise()` itself — doubling
    // the per-agent host call this tick already made.
    //
    // AFTER `reportTick`, so a tick whose report cannot be written still logs.
    await writeSupervisionReport(report, reportStore, warn);
    if (
      args.startAgents &&
      (await probeBeforeStarting(
        report,
        probe,
        () => readConfigAsync({ repoRoot, scriptsDir }, 'Worker command', ''),
        warn,
      ))
    ) {
      await startAgents(report, performer, handOverWorld, write, warn);
    }
    // UNGATED BY `args.startAgents`, the same reasoning the tick's own
    // `escalation` world follows: a question ages whether or not this daemon
    // may grow the fleet.
    //
    // GUARDED LIKE `relayBeat` BELOW: this runs after `runTick`'s own
    // try/catch (`:2252-2292`) has already closed, so a rejection here — a
    // notifier whose command throws rather than resolving `{ok: false}` —
    // would otherwise be an unhandled rejection the loop-level guard cannot
    // catch, because it already ran and returned.
    try {
      await notifyEscalations(report, repoRoot, notifier, escalated, write, warn);
    } catch (e) {
      warn(`plot-fleetd: escalation notify failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    // SAME GUARD, BESIDE THE ESCALATION NOTIFY ABOVE: a notifier that throws
    // must not end the tick's loop pass.
    try {
      // LAZY: the plan walk is paid only by a tick that holds an idle-notify write.
      const context = { repoRoot, scriptDir: scriptsDir };
      let planLines: ReturnType<typeof planLinesFor> | null = null;
      const planOf = async (branch: string): Promise<string> =>
        (await (planLines ??= planLinesFor(fleetPlanStore(context, refsGit(context))))).get(branch)?.plan ?? '';
      await notifyIdleSlices(report, repoRoot, notifier, planOf, write, warn);
    } catch (e) {
      warn(`plot-fleetd: idle notify failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    // THE RELEASE ARM, beside the idle notify and guarded the same way. A
    // `--once` pass reads and acts on nothing; a review start also needs
    // `Auto-review: true`, so a repository that never switched review on gets
    // the notice and no agent.
    if (!args.once) {
      try {
        const context = { repoRoot, scriptDir: scriptsDir };
        const refs = refsGit(context);
        const reviewOn = readAutoReview(boardOpts).autoReview;
        const defaultBranch = await refs.defaultBranch();
        const checksWait = checksWaitMsOf(await readConfigAsync(boardOpts, 'Checks wait', '3600'));
        const outcome = await releaseTick(
          releasePortsFor({
            refs,
            scripts,
            plans: fleetPlanStore(context, refs),
            host: hostShell(context),
            index: prIndexFile({ cwd: repoRoot }),
            build: ci,
            log: runLogFile({ cwd: repoRoot }),
            notifier: await notifier(),
            ref: `origin/${defaultBranch.ok ? defaultBranch.value : 'main'}`,
          }),
          {
            requiredWorkflow: checkNamesOf(await readConfigAsync(boardOpts, 'Default branch checks', ''))[0] ?? 'CI',
            reviewBoundMs: checksWait,
            startBudget: 0,
          },
          {
            repoRoot,
            script: join(scriptsDir, 'board', 'plot-review.mjs'),
            cwd: repoRoot,
            logFile: join(repoRoot, '.plot', 'state', 'release-review.log'),
            detached: detachedNode(),
            pidAlive: (pid) => pidAlive(pid),
            limit: 1,
          },
          Date.now(),
          reviewOn,
        );
        if (outcome.step.step !== 'none') write(`plot-fleetd: release ${outcome.stage}: ${outcome.step.step}\n`);
      } catch (e) {
        warn(`plot-fleetd: release tick failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    // THE REPAIR-START ARM drives the red-main re-run, claim and role start, and
    // records the fix PR; the auto-review pass reviews the PR the record names. It starts an agent, so `--start-agents` gates it as it gates
    // every other start; a `--once` pass acts on nothing.
    if (args.startAgents && !args.once) {
      try {
        const outcome = await repairStartTick(
          repairStartWorldOf({
            repoRoot,
            scriptsDir,
            build: ci,
            slot: <T,>(call: () => Promise<T>): Promise<T> =>
              ci.system() === 'github-actions' ? withHostSlot(prState, call) : call(),
            worktreeRoot: readConfig(boardOpts, 'Worktree root', ''),
            checksWaitMs: checksWaitMsOf(await readConfigAsync(boardOpts, 'Checks wait', '3600')),
            mainRepairBoundMs: mainRepairBoundMsOf(await readConfigAsync(boardOpts, 'Main repair bound', '3600')),
            checks: checkNamesOf(await readConfigAsync(boardOpts, 'Default branch checks', '')),
            warn,
          }),
          warn,
        );
        if (outcome !== 'none') write(`plot-fleetd: repair ${outcome}\n`);
      } catch (e) {
        warn(`plot-fleetd: repair start failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    // THE REVERT ARM takes the half of the repair arc the repair-start arm
    // leaves: the last green re-run, the revert PR, and closing the episode's
    // PRs. Gated as the repair-start arm is.
    if (args.startAgents && !args.once) {
      try {
        const outcome = await repairRevertTick(
          revertWorldOf({
            repoRoot,
            scriptsDir,
            build: ci,
            slot: <T,>(call: () => Promise<T>): Promise<T> =>
              ci.system() === 'github-actions' ? withHostSlot(prState, call) : call(),
            notify: async (message) => {
              await (await notifier()).notify(message);
            },
            worktreeRoot: readConfig(boardOpts, 'Worktree root', ''),
            checksWaitMs: checksWaitMsOf(await readConfigAsync(boardOpts, 'Checks wait', '3600')),
            mainRepairBoundMs: mainRepairBoundMsOf(await readConfigAsync(boardOpts, 'Main repair bound', '3600')),
            checks: checkNamesOf(await readConfigAsync(boardOpts, 'Default branch checks', '')),
          }),
          warn,
        );
        if (outcome !== 'none') write(`plot-fleetd: revert ${outcome}\n`);
      } catch (e) {
        warn(`plot-fleetd: revert tick failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
    await relayBeat(slot, warn);
    // A FRESH SESSION IS A START, so it is gated by `--start-agents` like the
    // starts above. A tick that was not allowed to start reports and acts on
    // nothing.
    if (args.startAgents && report.incomplete === '') {
      const budget = Number(readConfig(boardOpts, 'Correction budget', '2'));
      await startFreshAgents(
        report,
        {
          ...freshAgentDeskReads({ repoRoot, scriptDir: scriptsDir }, endingAsks, (branch) => merges.ask(branch), tally),
          killedReads: killedWorkerReads({ repoRoot, scriptDir: scriptsDir }, launchesWithPr, tally),
          writeEnding: freshAgentDesk.writeEnding,
          record: freshAgentRecord,
          ports: freshAgentPorts,
          budget: Number.isInteger(budget) && budget >= 0 ? budget : 2,
        },
        write,
        warn,
      );
      // GATED THE SAME WAY: A TICK THAT MAY NOT START AN AGENT MAY NOT RELEASE
      // A CLAIM EITHER, and an incomplete tick's `report.trees` cannot be
      // trusted to name every desk.
      const nothingDoneContext = { repoRoot, scriptDir: scriptsDir };
      await startNothingDoneReleases(
        report,
        {
          deskFile: (worktree, name) => fileOrNull(join(worktree, name)),
          ports: nothingDonePortsFor(nothingDoneContext, freshAgentRecord, releaseClaimOf, tally),
        },
        write,
        warn,
      );
    }
    if (args.sweepTemp) await sweepTempIfDue(tempSweep, Date.now(), write, warn);

    // THE LOOP CONTINUES WHATEVER THE TICK REPORTED, and that is the recovery.
    // There is nothing to resume: the next tick re-reads the registry and the
    // desks from disk, exactly as it does after a restart, so an incomplete
    // tick costs one interval and no state. Exiting instead would hand the OS
    // supervisor a restart it does not need for a reading that will be taken
    // again in a minute.
    if (args.once) return code;
    await pause();
  }
};

/**
 * What a hold is proportional to, which is what decides whether a looping
 * daemon may name its branches.
 *
 * **A HOLD OVER THE ESTATE GROWS WITH THE BACKLOG; A HOLD OVER THE QUEUE DOES
 * NOT.** `not-claimable` is every branch no plan makes claimable — 165 on this
 * estate, re-enumerated 7,333 times in seven days, and the bulk of a 69 MB
 * log. Every other hold is a refusal about a slice that was actually queued:
 * small, churning, and what a debugger reads at 3am.
 *
 * **IT IS A TOTAL RECORD RATHER THAN A STRING TEST**, because a hold added
 * later must not default into silence. `hold === 'not-claimable'` compiles forever
 * and re-opens this hole the day an estate-wide hold is added; a missing key
 * here fails the build.
 */
const HOLD_SCOPE: Record<QueueHold, 'estate' | 'queue'> = {
  'already-merged': 'queue',
  'merge-unknown': 'queue',
  // QUEUE-SCOPED BECAUSE IT IS PASS-LEVEL: it fires at most once per queued
  // slice and is counted every pass, never over the estate's backlog.
  'default-branch-red': 'queue',
  // QUEUE-SCOPED FOR THE SAME REASON AS `slice-unnamed` AND `refused`: it only
  // ever fires on a slice a live manifest actually names, never on the
  // estate's backlog.
  'assigned': 'queue',
  waits: 'queue',
  // QUEUE-SCOPED BECAUSE THE HOLD IS ONLY EVER ASKED OF A CLAIMABLE SLICE. It
  // is proportional to the plans an operator is actually waiting on a branch
  // for, never to the backlog, and the branch is the whole of the repair: the
  // reader needs its name to write the heading.
  'slice-unnamed': 'queue',
  // QUEUE-SCOPED FOR THE SAME REASON AS `slice-unnamed`: it only ever fires on
  // a slice an agent was actually handed, never on the estate's backlog.
  'refused': 'queue',
  'no-brief': 'queue',
  // QUEUE-SCOPED, SO A LOOPING TICK NAMES ITS BRANCHES. It is proportional to
  // the slices one outage left unanswered rather than to the backlog, and it is
  // the hold an operator is waiting on a branch for — the case `not-claimable`
  // below made invisible by being a count only (#1094).
  'prior-unknown': 'queue',
  'not-claimable': 'estate',
  'no-free-agent': 'queue',
};

/**
 * How many branches a kept hold names on a looping tick before it counts the
 * rest.
 *
 * **A KEPT CLASS IS CAPPED, NOT EXEMPTED.** `whyNotReady` tests
 * `merge-unknown` second, before the claimable split, and `landed` answers
 * `unknown` for every slice when the host cannot be asked — so ONE host outage
 * moves the entire queue into a class this file preserves. Measured peak here:
 * 574 slices. Twelve names say which branches and that there are many more; 574
 * names are the volume this file exists to remove, arriving by another door.
 */
const KEPT_HOLD_NAMES = 12;

/**
 * The tail of a `refused` hold's line: who refused, why and when.
 *
 * @param refusal - the record's detail, absent where it names none.
 * @returns `''` where no field is set, else ` — refused by <session>: <reason> (<at>)` with only the set fields.
 */
export const refusalText = (refusal: SliceRefusal | undefined): string => {
  if (refusal === undefined) return '';
  const who = refusal.session !== '' ? ` by ${refusal.session}` : '';
  const why = refusal.reason !== '' ? `: ${refusal.reason}` : '';
  const when = refusal.at !== '' ? ` (${refusal.at})` : '';
  return who + why + when === '' ? '' : ` — refused${who}${why}${when}`;
};

/**
 * Writes one tick's report, and says what a one-shot run would exit with.
 *
 * **AN INCOMPLETE TICK GOES TO STDERR, A COMPLETED ONE TO STDOUT.** Both units
 * route the two streams separately, so watching the error stream alone shows
 * exactly the ticks that could not be taken — which is what a person looks at
 * when the supervisor is not supervising.
 *
 * The exit code is for `--once` only. An operator and a `systemd`
 * `Type=oneshot` unit read it; the looping daemon's failure signal is the log,
 * and it never exits on a tick it could not take.
 *
 * **THE TWO CALLERS PRINT DIFFERENT AMOUNTS, AND THE CALLER SAYS WHICH.** A
 * person runs `--once` and reads the tick they asked for; the loop writes to a
 * file nobody is watching at the time, 1,440 times a day. `looping` is a
 * parameter rather than module state because every test calls this function
 * directly, and a distinction the tests cannot set is one they cannot pin.
 *
 * @param report - what the tick decided, or why it could not.
 * @param write - where a completed tick's lines go.
 * @param warn - where an incomplete tick's line goes.
 * @param looping - whether this is the looping daemon rather than `--once`.
 *   Defaults to `--once`'s full output, so a caller that says nothing gets
 *   everything.
 * @returns 0 when the tick completed, 1 when it could not.
 */
export const reportTick = (
  report: TickReport,
  write: (s: string) => void,
  warn: (s: string) => void,
  looping = false,
): number => {
  if (report.incomplete !== '') {
    warn(`${tickLine(report)}\n`);
    return 1;
  }
  write(`${tickLine(report)}\n`);
  for (const row of report.decision.detail.agents) {
    if (row.supervision.verdict === 'leave') continue;
    write(`  ${row.branch}: ${row.supervision.verdict} (${row.supervision.cause})\n`);
  }
  // NAMED ON `--once` AND COUNTED ON THE LOOP, like the held slices below.
  //
  // This comment used to justify naming them on every tick — *"the unclaimed
  // trees were twelve at their worst … so a looping daemon can name each one
  // without ever writing a line nobody wants."* **Measured 2026-09-15, that
  // was false by 7.1 MB**: this block was 38,174 lines and 10.26% of the log,
  // with `/private/tmp/plot-baseline` named 2,539 times and one worktree path
  // 6,413 times. The count is on the summary line, where it costs one field.
  if (!looping) for (const line of unclaimedLines(report)) write(`${line}\n`);
  // THE HAND-OVER IS NAMED PER SLICE, where supervision is named per agent.
  // A tick that handed nothing over prints its counts and no rows, the same
  // way a quiet estate prints `left=3` and nothing else.
  //
  // IT IS NOT GATED: an assignment is an EVENT, not a re-emission. It is
  // bounded by the free agents a tick had, it says something that happened
  // once, and a log of what the fleet actually did is what this file is for.
  for (const assignment of report.handOver?.detail?.assignments ?? []) {
    write(`  ${assignment.branch}: hand over to ${assignment.session}\n`);
  }
  // THE HELD SLICES ARE NAMED HERE AND NOWHERE ELSE. `--once` is the
  // operator's inspection path; the looping daemon prints the counts on its
  // summary line and stops there, because a tick every 60 s must not write 480
  // branch names to a log nobody is reading at the time.
  //
  // GROUPED BY HOLD RATHER THAN LISTED PER SLICE, so a reader sees the shape
  // of the refusal before its extent — 480 slices under one hold is a
  // different problem from 480 spread over five.
  if (report.handOver !== null) {
    const held = report.handOver.detail.held;
    for (const hold of QUEUE_HOLDS) {
      const branches = held.filter((slice) => slice.hold === hold);
      if (branches.length === 0) continue;
      write(`  held on ${hold} (${branches.length}):\n`);
      // ON THE LOOP, THE ESTATE-WIDE CLASS IS COUNTED AND THE QUEUE'S ARE
      // CAPPED. The header above already carries the count for both, so a
      // reader of either learns how many were held and why.
      if (looping && HOLD_SCOPE[hold] === 'estate') continue;
      const named = looping ? branches.slice(0, KEPT_HOLD_NAMES) : branches;
      // THE `waits` HOLD NAMES EVERY STILL-UNMERGED PREREQUISITE, IN THIS EXACT
      // FORM — IT IS GREPPED. Every other hold but `refused` prints the branch
      // alone; `waits` carries the facts a reader needs to act, which are not
      // the branch itself. ONE `waitHeld` WORD FOR THE WHOLE LIST:
      // `prerequisiteAnswer` answers `unmerged` or `unreachable` from the single
      // flag `listingWhole`, so it reads the same for every prerequisite this
      // branch still holds on. THE `refused` HOLD PRINTS ITS REASON TOO, through
      // `refusalText` — who refused, why and when, where the record names them.
      for (const slice of named) {
        write(
          hold === 'waits'
            ? `    ${slice.branch} — waits on ${slice.waitsOn.join(', ')} (${slice.waitHeld})\n`
            : hold === 'assigned'
              ? `    ${slice.branch}: assigned to ${slice.assignedTo}\n`
              : hold === 'refused'
                ? `    ${slice.branch}${refusalText(slice.refusal)}\n`
                : `    ${slice.branch}\n`,
        );
      }
      const rest = branches.length - named.length;
      if (rest > 0) write(`    … and ${rest} more\n`);
    }
  }
  // AN ORPHANED CLAIM IS NAMED ON EVERY TICK, NOT CAPPED LIKE THE HELD SLICES
  // ABOVE. It answers a DIFFERENT question — a branch nobody is working, not a
  // slice waiting its turn — and the population it is proportional to is
  // whatever a dead agent or a lost push left behind, which this file exists to
  // surface rather than to drain.
  //
  // IT NAMES, AND NEVER RELEASES: the command is the repair a PERSON runs.
  //
  // `deadClaims` IS NOT PRINTED: it names the same branches as `orphanedClaims`
  // on the same readings, so this one line per branch is the whole report.
  for (const branch of report.handOver?.detail?.orphanedClaims ?? []) {
    write(`  ${branch}: claim with no agent — plot-dispatch.sh --release ${branch}\n`);
  }
  return 0;
};

/**
 * Runs the daemon for a process: its arguments, its repo root, and a stop on
 * SIGTERM and SIGINT.
 *
 * @param proc - the process whose arguments, environment and signals are read.
 * @param here - the directory of the running bundle; the scripts resolve from it.
 * @param out - where the report lines go.
 * @param err - where failures go.
 * @param seams - replacements for what `run` builds itself; see {@link RunSeams}.
 * @returns what `run` returns.
 */
export const startDaemon = (
  proc: Pick<NodeJS.Process, 'argv' | 'env' | 'cwd' | 'on' | 'exit'>,
  here: string,
  out: (s: string) => void,
  err: (s: string) => void,
  seams: RunSeams = {},
): Promise<number> =>
  run(
    proc.argv.slice(2),
    here,
    out,
    undefined,
    stopOnSignals(proc),
    err,
    proc.env.PLOT_REPO_ROOT ?? proc.cwd(),
    seams,
  );

/** The pair of writers the daemon's report lines reach. */
export interface DaemonWriters {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/**
 * Chooses where the report lines go. `--once` is an operator's command, so its
 * tick reaches the terminal: stdout and stderr. The looping daemon opens its own
 * rotating log pair, because only the opener can rotate it.
 *
 * @param argv - the arguments after the script name.
 * @param logs - the directory the looping daemon's log pair lives in.
 * @param stdio - the terminal streams `--once` writes to.
 * @param open - opens a rotating log at a path.
 * @returns the writer pair for these arguments.
 */
export const writersFor = (
  argv: readonly string[],
  logs: string,
  stdio: { readonly stdout: { write: (text: string) => unknown }; readonly stderr: { write: (text: string) => unknown } } = process,
  open: (path: string) => { write: (text: string) => unknown } = processLog,
): DaemonWriters => {
  if (argsFrom(argv)?.once) {
    return { out: (text) => void stdio.stdout.write(text), err: (text) => void stdio.stderr.write(text) };
  }
  const out = open(join(logs, 'fleetd.log'));
  const err = open(join(logs, 'fleetd.err'));
  return { out: (text) => void out.write(text), err: (text) => void err.write(text) };
};

/**
 * Settles the process after the daemon's own run, through `endEntry` so a
 * write still in flight on a `--once` pipe drains before the process ends.
 *
 * The failure path reports and ends with code 1: it covers what throws
 * before the loop is reached — an unreadable argument, a missing registry
 * directory — and is itself the second half of error reporting, not a
 * substitute for the loop's own `catch`. Without it such a failure is an
 * unhandled rejection, which ends the process with an empty error log.
 *
 * @param daemon - the daemon's own run, resolving to its exit code.
 * @param end - ends the process; `endEntry` unless a test gives one.
 * @param err - where a start failure is reported.
 */
export const settleOnce = async (
  daemon: Promise<number>,
  end: (code: number) => Promise<never>,
  err: (s: string) => void,
): Promise<void> => {
  try {
    const code = await daemon;
    void end(code);
  } catch (e: unknown) {
    err(`plot-fleetd failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    void end(1);
  }
};

// Only when RUN, never when imported — a test importing `run` must not have the
// process loop under it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // THE DAEMON OPENS ITS OWN LOG, because only the opener can rotate it. launchd
  // opens `fleetd.log` through the unit's `StandardOutPath`, and a writer that
  // inherited that descriptor follows the inode across a rename and never
  // creates the new name — so external rotation cannot work, which is how
  // `registryd.log` reached 131 MB in 13 days.
  //
  // THE INHERITED PAIR IS TRUNCATED AT START where it has passed the bound. It
  // still catches what is printed before this line and any crash trace, so the
  // unit keeps both paths; what it must not do is grow without one.
  truncateInherited(1);
  truncateInherited(2);
  const logs = logDir(process.env.PLOT_REPO_ROOT ?? process.cwd());
  const writers = writersFor(process.argv.slice(2), logs);
  void settleOnce(
    startDaemon(process, dirname(fileURLToPath(import.meta.url)), writers.out, writers.err),
    endEntry,
    (s) => process.stderr.write(s),
  );
}

import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hostShell,
  performerShell,
  processesShell,
  refsGit,
  scriptsShell,
  treesGit,
  machineSystem,
  planStoreShell,
  prIndexFile,
  supervisionReportFile,
  tempSweepShell,
  notifierCommand,
  notifierNone,
  freshAgentRecordFile,
  refusedSlicesFile,
  deskFs,
  agentsFs,
} from '@plot-pm/domain/adapters';
import type { Notifier } from '@plot-pm/domain/ports/notifier';
import type { RefusedSliceRecord } from '@plot-pm/domain/ports/refused-slices';
import type { NotifyWrite } from '@plot-pm/domain/workflows/decision';
import {
  parseQuestionEscalation,
  DEFAULT_QUESTION_ESCALATION,
} from '@plot-pm/domain/rules/question-escalation';
import type { TempSweep } from '@plot-pm/domain/ports/temp-sweep';
import { tempSweepDue } from '@plot-pm/domain/rules/temp-sweep';
import { headroomFor } from '@plot-pm/domain/entities/machine';
import type { FleetCap } from '@plot-pm/domain/workflows/assign';
import type { Performer } from '@plot-pm/domain/ports/performer';
import type { Host, MergedAnswer } from '@plot-pm/domain/ports/host';
import type { PortResult } from '@plot-pm/domain';
import { landed, type LandedAnswer } from '@plot-pm/domain/rules/landed';
import { viewLanded } from '@plot-pm/domain/rules/known-pr';
import type { PrIndexStore } from '@plot-pm/domain/ports/pr-index';
import type { Refs } from '@plot-pm/domain/ports/refs';
import type { PlanRecord } from '@plot-pm/domain/ports/plan-store';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import { mergeSubjectForms } from '@plot-pm/domain/adapters/host/merge-subjects';
import { mergedBySubject } from '@plot-pm/domain/rules/merge-subject';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';
import type { DeskMergeReading, PlanBranchLine } from '@plot-pm/domain/rules/gates';

import { parseManifest, AGENT_MANIFEST_DIR, AGENT_MANIFEST_DIR_KEY, type AgentEntry } from '../registry.js';
import { readFleetSettings } from '../fleet-settings.js';
import { readConfigAsync } from '../board.js';
import { markerReading } from '../worker-question.js';
import {
  appendEscalation,
  escalationMemory,
  escalationsPath,
  readEscalations,
  recordedRungsFor,
  type EscalationMemory,
} from '../escalations.js';
import {
  fileOrNull,
  worldFrom,
  type SupervisorWorld,
  type TreeReading,
} from '../supervisor.js';
import type { QueueWorld, HandOverWorld } from '../queue-reading.js';
import {
  tick,
  tickLine,
  unclaimedLines,
  freshAgentCandidateTrees,
  readFreshAgentCandidates,
  freshAgentDecisions,
  applyFreshAgentDecisions,
  freshAgentLines,
  type FreshAgentPorts,
  type FreshAgentApplied,
  TICK_INTERVAL_MS,
  type TickReport,
  type TickSpend,
  type EscalationWorld,
} from './registryd.js';
import { boardSharePerHour } from '@plot-pm/domain/rules/cadence';
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
import { logDir, processLog, truncateInherited } from '../process-log.js';
import { readConfig } from '../board.js';
import { continueOnDesk, type DeskContinuation, type DeskContinuationInput } from '../continue.js';
import { randomUUID } from 'node:crypto';
import type { Agents } from '@plot-pm/domain/ports/agents';

/**
 * `plot-registryd` — the supervisor, one per repository.
 *
 * ```
 * node skills/plot/scripts/board/plot-registryd.mjs           # loop
 * node skills/plot/scripts/board/plot-registryd.mjs --once    # one tick
 * node skills/plot/scripts/board/plot-registryd.mjs --dry-run # decide, write nothing
 * node skills/plot/scripts/board/plot-registryd.mjs --start-agents  # and start them
 * node skills/plot/scripts/board/plot-registryd.mjs --sweep-temp    # and sweep temp paths hourly
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
 * node skills/plot/scripts/board/plot-registryd.mjs --once --start-agents
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
        warn(`plot-registryd: ${name} is not a manifest this parse understands — skipped\n`);
      }
      continue;
    }
    entries.push(entry);
  }
  const unnamed = skipped - NAMED_BAD_MANIFESTS;
  if (looping && unnamed > 0) {
    warn(`plot-registryd: … and ${unnamed} more manifests this parse does not understand\n`);
  }
  return entries;
};

/**
 * How many host calls the current tick has made.
 *
 * The two worlds add one per host call, and the loop sets it to zero at the top
 * of every tick. It carries nothing into the next tick and no decision reads
 * it: it exists to put this tick's own spend on the tick line.
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
 * What the account spends beside what this tick spent, for the tick line.
 *
 * @param scripts - the adapter that runs `plot-host.sh`.
 * @param calls - the host calls this tick made.
 * @param intervalMs - the wait between ticks.
 * @returns the account's rate and this supervisor's rate at this tick's calls.
 */
export const spendForTick = async (
  scripts: Pick<Scripts, 'hostSaid'>,
  calls: number,
  intervalMs: number,
): Promise<TickSpend> => ({
  accountPerHour: await accountRate(scripts),
  minePerHour: boardSharePerHour(intervalMs, calls),
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
  const plans = planStoreShell(context);
  const refs = refsGit(context);

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
export const MERGE_WALK_LIMIT = 2000;

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
 * @returns the world the queue is read through.
 */
export const queueWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  tally: HostTally = { calls: 0 },
  merges?: MergeMemo,
  index: PrIndexStore = prIndexFile({ cwd: repoRoot }),
  refusedSlices: RefusedSliceRecord = refusedSlicesFile({ cwd: repoRoot }),
): QueueWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const plans = planStoreShell(context);
  const refs = refsGit(context);
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
      // THE LIMIT IS EXPLICIT AND LARGE, because the join is against the WHOLE
      // history rather than the recent page. `pr-list` defaults to 30 and warns
      // that "a join against this page may read older branches as 'no PR'" —
      // measured 2026-09-06, #707 and #710 are hundreds of merges back and a
      // default page missed both, leaving their plans blocked exactly as
      // before.
      tally.calls += 1;
      const answer = await host.prList('merged', 500);
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
      // A PARTIAL ANSWER KEEPS ITS ROWS AND IS NOT WHOLE. `prList` answers the
      // rows that arrived and leaves a refusal behind, so a branch missing from
      // them may still have merged.
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
 * configured ages, and the rungs already recorded for the desk and its
 * marker's modification time, in `.plot/state/escalations.tsv` or in this
 * daemon's {@link EscalationMemory}.
 *
 * @param repoRoot - the repository root.
 * @param scriptsDir - where the helper scripts are.
 * @param memory - the rungs this daemon process applied.
 * @returns the world the tick's escalation pass reads through.
 */
export const escalationWorldForRepo = (
  repoRoot: string,
  scriptsDir: string,
  memory: EscalationMemory = escalationMemory(),
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
  plans: ReturnType<typeof planStoreShell>,
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
        `plot-registryd: ${item.branch} could not be handed over; the next tick re-derives the queue\n`,
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
          ? 'plot-registryd: nothing starts free agents in this repository — set `Worker command` in Plot Config to `PLOT_UNATTENDED=1 plot-worker-loop.sh`; `/plot-fleet --start 1` names what is configured now\n'
          : 'plot-registryd: an agent could not be started; the next tick re-derives the queue and tries again\n',
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
    memory.records.push(record);
    if (!appendEscalation(repoRoot, record) && !memory.appendFailureReported) {
      memory.appendFailureReported = true;
      warn(
        `plot-registryd: could not append to ${escalationsPath(repoRoot)}; ` +
          'escalated rungs are held in memory until the daemon restarts\n',
      );
    }
    if (result.ok) write(`  ${item.worktree}: notified at ${item.rung}\n`);
  });
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
    if (!written.ok) warn('plot-registryd: could not write the supervision report\n');
  } catch (err) {
    // A THROWN WRITE IS THE SAME FACT AS A FAILED ONE: the board gets no cause.
    // Caught here rather than at the loop, so a filesystem that rejects cannot
    // take the tick's own recovery path with it.
    warn(
      `plot-registryd: could not write the supervision report: ${err instanceof Error ? err.message : String(err)}\n`,
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
 * Reads, decides and applies the fresh-agent step for one completed tick.
 *
 * Desks whose worker ended `corrections-spent` with no manifest left get one
 * fresh session through the continue workflow; a second spent budget for the
 * same slice is declared `blocked`. A failure anywhere in the step is reported
 * on stderr and never ends the daemon: the next tick reads the same desks and
 * the record again.
 *
 * @param report - the completed tick, whose `trees` name the candidates.
 * @param deps - how to read a desk file, the record, the ports to act through,
 *   and the repository's `Correction budget`.
 * @param write - where a started session or an escalation is reported.
 * @param warn - where a refusal or a failure is reported.
 * @returns what was applied, in desk order.
 */
export const startFreshAgents = async (
  report: TickReport,
  deps: {
    deskFile: (worktree: string, name: string) => string | null;
    record: Pick<FreshAgentRecordStore, 'rowsFor'>;
    ports: FreshAgentPorts;
    budget: number;
  },
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<readonly FreshAgentApplied[]> => {
  try {
    const candidates = freshAgentCandidateTrees(report.trees ?? []);
    if (candidates.length === 0) return [];
    const readings = await readFreshAgentCandidates(candidates, deps.deskFile, deps.record);
    const applied = await applyFreshAgentDecisions(
      freshAgentDecisions(readings, deps.budget),
      deps.ports,
    );
    for (const { line, error } of freshAgentLines(applied)) (error ? warn : write)(`${line}\n`);
    return applied;
  } catch (err) {
    warn(`plot-registryd: the fresh-agent step failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return [];
  }
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
  if (result.ok) write(`plot-registryd: ${result.value}\n`);
  else warn('plot-registryd: the temp sweep did not run (plot-reap.sh --sweep-temp)\n');
  return true;
};

export const run = async (
  argv: readonly string[],
  here: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  stop: () => boolean = () => false,
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const args = argsFrom(argv);
  if (args === null) {
    process.stderr.write(
      'usage: plot-registryd.mjs [--once] [--dry-run] [--start-agents] [--sweep-temp] [--max N] [--interval SECONDS]\n',
    );
    return 2;
  }

  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const scriptsDir = scriptsDirFor(here);
  const registryDir = registryDirFor(repoRoot, scriptsDir);
  const tally: HostTally = { calls: 0 };
  // ONE MEMO FOR BOTH WORLDS. `tick` reads the supervisor world first, and its
  // `beginTick` clears the memo, so the queue read that follows shares the
  // tick's answers and the next tick asks again.
  const merges = mergeMemoOver(hostShell({ repoRoot, scriptDir: scriptsDir }));
  const world = worldForRepo(repoRoot, scriptsDir, tally, merges);
  const queue = queueWorldForRepo(repoRoot, scriptsDir, tally, merges);
  // SHARES `tally` WITH `queue` ABOVE so a hand-over's fresh `queuedHasLanded`
  // call still counts toward the tick's host tally — but NOT `merges`: a
  // hand-over asks the host again on purpose, and the tick's memo would hand
  // back the very reading this check exists to outdate.
  const handOverWorld = handOverWorldForRepo(repoRoot, scriptsDir, tally);
  const scripts = scriptsShell({ repoRoot, scriptDir: scriptsDir });
  // BUILT WHETHER OR NOT IT IS USED, because building it reaches nothing: the
  // adapter is a closure over two paths and spawns only when it is called.
  const performer = performerShell({ repoRoot, scriptDir: scriptsDir });
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
  const escalation = escalationWorldForRepo(repoRoot, scriptsDir, escalated);
  // READ WHEN A TICK HOLDS A `notify` WRITE, so a `Notify command` added
  // while the daemon runs takes effect at the next escalation.
  const notifier = async (): Promise<Notifier> =>
    notifierFor(await readConfigAsync({ repoRoot, scriptsDir }, NOTIFY_COMMAND_KEY, ''));
  // THE DAEMON IS THE ONLY WRITER OF THE FRESH-AGENT RECORD, for the reason
  // `reportStore` above gives, and the store lives for the daemon's whole life
  // so the `--git-common-dir` lookup is forked once.
  const freshAgentRecord = freshAgentRecordFile({ cwd: repoRoot });
  const boardOpts = { repoRoot, scriptsDir };
  const freshAgentPorts: FreshAgentPorts = {
    record: freshAgentRecord,
    desk: deskFs(treesGit({ repoRoot, scriptDir: scriptsDir })),
    now: () => new Date(),
    start: async ({ branch, worktree, answer, beforeStart }) => {
      const base = await refsGit({ repoRoot, scriptDir: scriptsDir }).defaultBranch();
      return startFreshSession(
        { branch, worktree, answer, main: base.ok ? base.value : '', beforeStart },
        {
          agents: agentsFs({ repoRoot, scriptDir: scriptsDir }, { manifestDir: registryDir }),
          command: readConfig(boardOpts, 'Worker command', ''),
          newSession: () => randomUUID(),
          continueDesk: continueOnDesk,
          opts: boardOpts,
        },
      );
    },
  };

  write(`plot-registryd: supervising ${registryDir}\n`);

  for (;;) {
    if (stop()) return 0;
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
    tally.calls = 0;
    try {
      // THE REGISTRY IS RE-READ HERE, at the top of every tick. That is the
      // whole of the daemon's state: there is nothing else to lose, so
      // `kill -9` costs one tick.
      report = await tick({
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
      });
    } catch (err) {
      // STDERR, AND THE ERROR'S OWN TEXT. `registryd.err` being empty on both
      // measured deaths is why this cannot go to the tick log: a failure
      // written where the ticks go is as invisible as the crash was.
      warn(`plot-registryd tick failed: ${err instanceof Error ? err.message : String(err)}\n`);
      // `--once` IS A GATE AND MUST STILL FAIL. An operator installing a
      // supervisor runs it to learn whether the daemon works; swallowing the
      // failure would report a healthy daemon and hand them a crash loop with
      // a restart policy.
      if (args.once) return 1;
      // NOTHING IS REPORTED FOR THIS TICK, and that is deliberate: a tick that
      // threw halfway decided nothing, and the contract says the decision is
      // empty rather than truncated. The interval is still waited, so a
      // failure that repeats cannot spin.
      await sleep(args.intervalMs);
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
    if (report.incomplete === '') {
      report = { ...report, spend: await spendForTick(scripts, tally.calls, args.intervalMs) };
    }
    const code = reportTick(report, write, warn, !args.once);
    // THE ONE CHANNEL TO THE BOARD, written beside the log and for the same
    // reason: the tick's judgement is worth nothing to an operator that cannot
    // read it. Until this, the cause reached stdout and stopped there, and a
    // board asking for it would have had to run `supervise()` itself — doubling
    // the per-agent host call this tick already made.
    //
    // AFTER `reportTick`, so a tick whose report cannot be written still logs.
    await writeSupervisionReport(report, reportStore, warn);
    if (args.startAgents) await startAgents(report, performer, handOverWorld, write, warn);
    // UNGATED BY `args.startAgents`, the same reasoning the tick's own
    // `escalation` world follows: a question ages whether or not this daemon
    // may grow the fleet.
    await notifyEscalations(report, repoRoot, notifier, escalated, write, warn);
    // A FRESH SESSION IS A START, so it is gated by `--start-agents` like the
    // starts above. A tick that was not allowed to start reports and acts on
    // nothing.
    if (args.startAgents && report.incomplete === '') {
      const budget = Number(readConfig(boardOpts, 'Correction budget', '2'));
      await startFreshAgents(
        report,
        {
          deskFile: (worktree, name) => fileOrNull(join(worktree, name)),
          record: freshAgentRecord,
          ports: freshAgentPorts,
          budget: Number.isInteger(budget) && budget >= 0 ? budget : 2,
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
    await sleep(args.intervalMs);
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
      // FORM — IT IS GREPPED. Every other hold prints the branch alone; this one
      // carries the facts a reader needs to act, which are not the branch
      // itself. ONE `waitHeld` WORD FOR THE WHOLE LIST: `prerequisiteAnswer`
      // answers `unmerged` or `unreachable` from the single flag `listingWhole`,
      // so it reads the same for every prerequisite this branch still holds on.
      for (const slice of named) {
        write(
          hold === 'waits'
            ? `    ${slice.branch} — waits on ${slice.waitsOn.join(', ')} (${slice.waitHeld})\n`
            : hold === 'assigned'
              ? `    ${slice.branch}: assigned to ${slice.assignedTo}\n`
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
  for (const branch of report.handOver?.detail?.orphanedClaims ?? []) {
    write(`  ${branch}: claim with no agent — plot-dispatch.sh --release ${branch}\n`);
  }
  return 0;
};

// Only when RUN, never when imported — a test importing `run` must not have the
// process loop under it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // THE DAEMON OPENS ITS OWN LOG, because only the opener can rotate it. launchd
  // opens `registryd.log` through the unit's `StandardOutPath`, and a writer that
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
  const out = processLog(join(logs, 'registryd.log'));
  const err = processLog(join(logs, 'registryd.err'));
  void run(
    process.argv.slice(2),
    dirname(fileURLToPath(import.meta.url)),
    (text) => out.write(text),
    undefined,
    undefined,
    (text) => err.write(text),
  )
    .then((code) => process.exit(code))
    // THE SECOND HALF, AND NOT A SUBSTITUTE FOR THE FIRST. The loop's `catch`
    // covers a failing tick; this covers what throws before the loop is
    // reached — an unreadable argument, a missing registry directory. Without
    // it such a failure is an unhandled rejection, which ends the process with
    // the same empty `registryd.err` that made the tick deaths invisible.
    .catch((err: unknown) => {
      process.stderr.write(
        `plot-registryd failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}

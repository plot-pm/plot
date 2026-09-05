import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
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
} from '@plot-pm/domain/adapters';
import { headroomFor } from '@plot-pm/domain/entities/machine';
import type { FleetCap } from '@plot-pm/domain/workflows/assign';
import type { Performer } from '@plot-pm/domain/ports/performer';
import { landed } from '@plot-pm/domain/rules/landed';
import type { MergeReading } from '@plot-pm/domain/rules/reapable';
import type { PlanBranchLine } from '@plot-pm/domain/rules/gates';

import { parseManifest, AGENT_MANIFEST_DIR, AGENT_MANIFEST_DIR_KEY, type AgentEntry } from '../registry.js';
import { readFleetSettings } from '../fleet-settings.js';
import { fileOrNull, worldFrom, type SupervisorWorld } from '../supervisor.js';
import type { QueueWorld } from '../queue-reading.js';
import { tick, tickLine, TICK_INTERVAL_MS, type TickReport } from './registryd.js';

/**
 * `plot-registryd` — the supervisor, one per repository.
 *
 * ```
 * node skills/plot/scripts/board/plot-registryd.mjs           # loop
 * node skills/plot/scripts/board/plot-registryd.mjs --once    # one tick
 * node skills/plot/scripts/board/plot-registryd.mjs --dry-run # decide, write nothing
 * node skills/plot/scripts/board/plot-registryd.mjs --start-agents  # and start them
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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') args.once = true;
    else if (arg === '--start-agents') args.startAgents = true;
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
 * Reads every manifest in the registry.
 *
 * A manifest that does not parse is SKIPPED rather than refusing the tick: one
 * unreadable file must not stop a supervisor from picking up every other agent,
 * and the file is reported so it is not silently ignored.
 *
 * @param dir - the registry directory.
 * @param warn - where to report a manifest that did not parse.
 * @returns the agents the registry declares, in directory order.
 */
export const readRegistry = async (
  dir: string,
  warn: (s: string) => void = (s) => process.stderr.write(s),
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
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => null);
    const entry = text === null ? null : parseManifest(text);
    if (entry === null) {
      warn(`plot-registryd: ${name} is not a manifest this parse understands — skipped\n`);
      continue;
    }
    entries.push(entry);
  }
  return entries;
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
 * @returns the world the tick reads through.
 */
export const worldForRepo = (repoRoot: string, scriptsDir: string): SupervisorWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const processes = processesShell(context);
  const trees = treesGit(context);
  const host = hostShell(context);
  const machine = machineSystem(context);
  const plans = planStoreShell(context);
  const refs = refsGit(context);

  // THE MEMO'S LIFETIME IS ONE TICK, and `readTick` is what ends it: the world
  // is built once and `beginTick` clears the memo at the top of each pass, so a
  // branch asked about twice in one tick costs one walk and a branch asked
  // about next tick costs a fresh one.
  let memo: Promise<ReadonlyMap<string, PlanBranchLine>> | null = null;
  const planLinesThisTick = () => (memo ??= planLinesFor(plans));

  return worldFrom({
    repoRoot,
    beginTick: () => {
      memo = null;
    },
    isAlive: async (pid) => {
      const answer = await processes.isAlive(pid);
      // AN UNANSWERABLE LIVENESS QUESTION READS AS ALIVE. Every other verdict
      // acts on the desk, and acting on a desk whose worker may be running is
      // the one mistake this daemon must never make.
      return answer.ok ? answer.value : true;
    },
    prMerged: async (branch): Promise<MergeReading> => {
      const answer = await host.prMerged(branch);
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
 * @returns the world the queue is read through.
 */
export const queueWorldForRepo = (repoRoot: string, scriptsDir: string): QueueWorld => {
  const context = { repoRoot, scriptDir: scriptsDir };
  const plans = planStoreShell(context);
  const refs = refsGit(context);
  const host = hostShell(context);
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
    sliceHasMerged: async (branch) => {
      const answer = await host.prMerged(branch);
      // SILENCE IS NOT LANDED. An unreachable host answers *not merged*, so an
      // agent stays holding its branch rather than being handed a second one.
      return answer.ok && answer.value === 'merged';
    },
    queuedHasLanded: async (branch) => {
      const answer = await host.prMerged(branch);
      // THE DOMAIN DECIDES THE WORD, from a `LookupReading` this join takes.
      // `landed` is the ONE answer to *did this land* — it reads the merge
      // timestamp, never a PR's `state` and never ancestry — and consuming it
      // here rather than re-testing `=== 'merged'` is what keeps the queue and
      // the reaper from drifting to two answers about one branch.
      //
      // SILENCE REACHES THE RULE AS SILENCE. Above, `sliceHasMerged` collapses
      // an unreachable host into *not merged* because the subject is an agent
      // already holding its branch; here the subject is work nobody holds, and
      // the same collapse would offer every finished branch to a free agent the
      // moment the host went quiet.
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
  };
};

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
): Promise<ReadonlyMap<string, PlanBranchLine>> => {
  const lines = new Map<string, PlanBranchLine>();
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
 * Applies the tick's `worker-start` writes — the one thing this daemon performs.
 *
 * **IT APPLIES ONE KIND AND SKIPS EVERY OTHER.** The tick names reaps, blocked
 * markers, corrections and assignments too, and none of them is performed here:
 * this slice owns starting an agent and nothing else, so a write it does not
 * own is left for whoever does. Naming the kind rather than falling through a
 * default is `perform-fs.ts`'s discipline — *skipped on purpose* and *a kind
 * the author forgot* look identical from inside a loop.
 *
 * **A START THAT FAILS COSTS ONE TICK.** The next tick re-derives the queue and
 * the fleet from disk and reaches the same decision if the shortage is still
 * there, which is the same recovery a `kill -9` gets. So a failure is reported
 * and the loop continues; there is nothing to retry and nothing to remember.
 *
 * @param report - what the tick decided.
 * @param performer - what starts an agent on this machine.
 * @param write - where the started agents are reported.
 * @param warn - where a start that could not be made is reported.
 * @returns how many agents were actually started.
 */
export const startAgents = async (
  report: TickReport,
  performer: Performer,
  write: (s: string) => void,
  warn: (s: string) => void,
): Promise<number> => {
  let started = 0;
  for (const item of report.handOver?.writes ?? []) {
    if (item.kind !== 'worker-start') continue;
    const answer = await performer.startFreeAgent(item.worktree);
    if (!answer.ok) {
      // `unaskable` IS A FIRST-CLASS ANSWER AND NOT A FAILURE. It means the
      // repository has no `Worker command` — asked, and answered *we start them
      // by hand* — so the line says what to configure rather than reading as an
      // error to chase every sixty seconds.
      warn(
        answer.why === 'unaskable'
          ? 'plot-registryd: nothing starts agents in this repository — set a `Worker command` in Plot Config, or start them with `plot-dispatch.sh --start`\n'
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
      'usage: plot-registryd.mjs [--once] [--dry-run] [--start-agents] [--max N] [--interval SECONDS]\n',
    );
    return 2;
  }

  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const scriptsDir = scriptsDirFor(here);
  const registryDir = registryDirFor(repoRoot, scriptsDir);
  const world = worldForRepo(repoRoot, scriptsDir);
  const queue = queueWorldForRepo(repoRoot, scriptsDir);
  // BUILT WHETHER OR NOT IT IS USED, because building it reaches nothing: the
  // adapter is a closure over two paths and spawns only when it is called.
  const performer = performerShell({ repoRoot, scriptDir: scriptsDir });

  write(`plot-registryd: supervising ${registryDir}\n`);

  for (;;) {
    if (stop()) return 0;
    // THE REGISTRY IS RE-READ HERE, at the top of every tick. That is the whole
    // of the daemon's state: there is nothing else to lose, so `kill -9` costs
    // one tick.
    const report = await tick({
      registry: () => readRegistry(registryDir, warn),
      world,
      queue,
      // THE CAP IS ASKED ONLY WHERE THE DAEMON MAY ACT ON IT. A tick that read
      // the cap and started nothing would print `started=0` beside a queue it
      // was never allowed to serve, which reads as *the fleet is the right
      // size* rather than as *nobody asked me to grow it*.
      fleet: args.startAgents ? () => fleetCapForRepo(repoRoot, scriptsDir) : undefined,
      max: args.max,
    });

    const code = reportTick(report, write, warn);
    if (args.startAgents) await startAgents(report, performer, write, warn);

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
 * @param report - what the tick decided, or why it could not.
 * @param write - where a completed tick's lines go.
 * @param warn - where an incomplete tick's line goes.
 * @returns 0 when the tick completed, 1 when it could not.
 */
export const reportTick = (
  report: TickReport,
  write: (s: string) => void,
  warn: (s: string) => void,
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
  // THE HAND-OVER IS NAMED PER SLICE, where supervision is named per agent.
  // A tick that handed nothing over prints its counts and no rows, the same
  // way a quiet estate prints `left=3` and nothing else.
  for (const assignment of report.handOver?.detail?.assignments ?? []) {
    write(`  ${assignment.branch}: hand over to ${assignment.session}\n`);
  }
  return 0;
};

// Only when RUN, never when imported — a test importing `run` must not have the
// process loop under it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void run(process.argv.slice(2), dirname(fileURLToPath(import.meta.url))).then((code) =>
    process.exit(code),
  );
}

import { supervise, type SuperviseDetail } from '@plot-pm/domain/workflows/supervise';
import { assign, type AssignDetail, type FleetCap } from '@plot-pm/domain/workflows/assign';
import type { Decision, NotifyWrite } from '@plot-pm/domain/workflows/decision';
import { holdCounts, QUEUE_HOLDS } from '@plot-pm/domain/rules/queue';
import { unclaimedNotice } from '@plot-pm/domain/rules/unclaimed';
import { questionEscalation, type Rung } from '@plot-pm/domain/rules/question-escalation';
import type { RegisteredTreeReadings } from '@plot-pm/domain/rules/unclaimed';
import { freshAgentAnswer } from '@plot-pm/domain/rules/fresh-agent';
import { freshAgentTurnLimitAnswer } from '@plot-pm/domain/rules/fresh-agent-turn-limit';
import { readEnding, ENDING_FILENAME, type EndingReason } from '@plot-pm/domain/entities/ending';
import {
  endingAction,
  endingReleaseBranch,
  holdingWorkAnswer,
  boundAnswer,
  needsPersonMarker,
  endingAsksPersonOutright,
  type EndingActionVerdict,
  type PrOpenReading,
  type PrMergedReading,
} from '@plot-pm/domain/rules/ending-action';
import type { CommitReading } from '@plot-pm/domain/rules/sample';
import type { PortResult, Pr } from '@plot-pm/domain';
import type { MergedAnswer } from '@plot-pm/domain/ports/host';
import type { FreshAgentRecordStore } from '@plot-pm/domain/ports/fresh-agent-record';
import type { EndingAskRecordStore } from '@plot-pm/domain/ports/ending-ask-record';
import type { Desk } from '@plot-pm/domain/ports/desk';

import { readTick, type SupervisorWorld } from '../../shared/supervisor.js';
import { readQueue, type QueueWorld } from '../../shared/queue-reading.js';
import type { AgentEntry } from '../../shared/registry.js';
import type { MarkerReading } from '../../shared/worker-question.js';
import type { DeskContinuation } from '../../shared/continuation.js';

/**
 * How long the daemon waits between ticks, in milliseconds.
 *
 * **MEASURED FIRST, THEN CHOSEN. 60 seconds.** The plan's open question asks for
 * the tick's own cost before the interval; {@link TICK_COST_MS} is that cost,
 * taken by running the daemon rather than by estimating it.
 *
 * The interval sits among three cadences already measured on this machine:
 *
 * | cadence | who | cost |
 * |---|---|---|
 * | 5 s | the board's poll | serves in ~250 ms |
 * | 18.3 s | the fleet scan | 12.7 s of it is git |
 * | **60 s** | **this tick** | **3.5 s for 3 agents at load 38** |
 * | 8 h | the `Worker bound` | the thing being watched |
 *
 * **A tick is 6% of its own interval, so the daemon is idle 94% of the time.**
 * That headroom is the argument for 60 s rather than a smaller number: the tick
 * is 3.5 s at three agents and its per-agent term grows with the fleet, so an
 * interval close to the measured cost would make a busier estate's ticks
 * overlap. At 60 s this estate could hold roughly ten times the agents before
 * that happens.
 *
 * **It does not compete with the board's 5 s poll.** A tick runs in eleven of
 * every twelve board intervals' worth of silence, and the scan's 18.3 s is the
 * cadence it must not approach — 60 s is over three times it.
 *
 * **Why not shorter.** The tick asks the git host once per agent, and the host
 * is the only reading with an account and a rate limit behind it. At 60 s and
 * three agents that is 180 host calls an hour; at 10 s it would be 1,080, buying
 * a stranded desk found 50 seconds sooner.
 *
 * **Why not longer.** The failure this daemon exists for is a worker that died
 * with work committed and no PR; three sat unnoticed for hours on 2026-08-31.
 * An hour-long interval would make the supervisor's own latency comparable to
 * the latency it was built to remove.
 *
 * **It is waited AFTER a tick rather than between starts.** A slow tick delays
 * the next one instead of overlapping it, so two ticks never run at once on one
 * registry — the cheapest answer to the plan's open question about a lock.
 */
export const TICK_INTERVAL_MS = 60_000;

/**
 * What one tick cost when it was measured, end to end, in milliseconds.
 *
 * **Measured 2026-09-04 by RUNNING THE DAEMON — `plot-registryd.mjs --once`
 * against this repository's three registered agents, host reachable, machine at
 * load ~38.** Five runs: 2662, 3568, 2831, 4581, 3839 ms. **Mean 3496 ms.**
 *
 * **The first number recorded here was 976 ms and it was wrong, which is why
 * this one comes from the daemon rather than from a simulation of it.**
 * `scripts/measure-tick.mjs` timed the host call, the git calls and the disk
 * reads — every reading the plan named — and omitted the plan-store walk the
 * annotation gate needs. Run for real, that walk made a tick cost **10.0-11.5 s**,
 * because `readPlans` reads 172 files and the first daemon asked it once per
 * agent. Reading it once per tick is what brought the tick to the figure above.
 *
 * The lesson is the plan's own: a number nobody ran is a claim. The script is
 * kept because its BREAKDOWN is still the useful part — host 56-62%, git the
 * rest, disk 20 ms of it — but the total belongs to the daemon.
 *
 * **What it costs per agent is not the whole story.** One term is per tick (the
 * plan walk, the machine sample) and one is per agent (the host call, the git
 * reads). At three agents the two are comparable; on a larger fleet the
 * per-agent term dominates, and {@link TICK_INTERVAL_MS} is argued from it.
 */
export const TICK_COST_MS = 3_496;

/** What one tick of the daemon reported. */
export interface TickReport {
  /** When the tick started, epoch milliseconds. */
  startedAt: number;
  /** What it cost, in milliseconds. */
  costMs: number;
  /** How many agents the registry held. */
  agents: number;
  /** What it decided about the agents it supervises. */
  decision: Decision<SuperviseDetail>;
  /**
   * What stopped this tick before it could decide, or `''` when it finished.
   *
   * A tick that could not complete carries the reason here and an EMPTY
   * decision — no writes, no verdicts, nothing half-decided. The next tick
   * re-reads from disk and continues; see {@link tick}.
   */
  incomplete: string;
  /**
   * What it decided about the queue, or null where no queue world was given.
   *
   * **NULL IS *NOBODY ASKED*, NOT *THE QUEUE WAS EMPTY*.** A caller running the
   * supervision half alone gets null; an empty queue gets a decision with no
   * writes. Collapsing them would make a daemon that cannot read the plans
   * indistinguishable from one reading an estate with nothing to hand over.
   */
  handOver: Decision<AssignDetail> | null;
  /**
   * Every registered worktree this tick read, with whether a manifest names it.
   *
   * Absent where the world reads no worktrees or the tick did not complete.
   * The fresh-agent step reads its candidates from here rather than listing
   * the worktrees a second time.
   */
  trees?: readonly RegisteredTreeReadings[];
  /**
   * What the account spent and what this tick spent, or null/absent where
   * nobody read the spend record. Filled by the looping daemon after a tick
   * completes; {@link tick} itself leaves it unset.
   */
  spend?: TickSpend | null;
}

/**
 * What the host account is spending, beside what this supervisor spends.
 *
 * Reported and never acted on: the tick interval does not read it.
 */
export interface TickSpend {
  /**
   * The account's observed rate from the budget record (`plot-host.sh
   * spend-rate`), requests per hour. Null when the record gave no rate: an
   * unreadable record, a missing script, or a window with no span. Null is no
   * evidence, and it never prints as zero.
   */
  accountPerHour: number | null;
  /**
   * This supervisor's rate at this tick's host calls: the calls the tick made,
   * repeated once per interval for an hour.
   */
  minePerHour: number;
}

/**
 * What the tick needs to decide a desk's question escalation — every reading
 * `questionEscalation` takes, supplied as values rather than read inside the
 * domain, matching every other rule in this package.
 */
export interface EscalationWorld {
  /** The desk's marker, or `null` where it holds none. */
  marker(worktree: string): Promise<MarkerReading | null>;
  /** The configured escalation ages, in milliseconds, ascending. */
  ages(): Promise<readonly number[]>;
  /** The rungs already recorded for this desk path and this marker's modification time. */
  recordedRungs(worktree: string, askedAt: string): Promise<ReadonlySet<Rung>>;
  /** The clock, for the age computation; `Date.now` when omitted. */
  now?(): number;
}

/** What a daemon needs to run one tick. */
export interface TickOptions {
  /** The registry's manifests, re-read at the start of every tick. */
  registry(): Promise<readonly AgentEntry[]>;
  /** What to read the estate through. */
  world: SupervisorWorld;
  /**
   * What to read the QUEUE through, or absent to run supervision alone.
   *
   * A second world rather than more members on the first, because the two ask
   * about different things: the supervisor reads what each registered agent
   * LEFT BEHIND, and the queue reads what the plans have WAITING. A tick that
   * cannot reach the plans still supervises every desk.
   */
  queue?: QueueWorld;
  /** How many agents one tick may act on; 0 for no bound. */
  max?: number;
  /**
   * How large the fleet may grow, what the machine says, and the desks this
   * tick is willing to cut — or absent to decide nothing about the fleet's size.
   *
   * **READ ONCE PER TICK, LIKE EVERY OTHER READING.** A cap that changed
   * between the queue read and the decision would let one tick match against a
   * fleet it then sized differently.
   *
   * **ASKED, NOT HELD.** It is a function rather than a value so a tick reads
   * the operator's current cap and the machine's current load; a value captured
   * at daemon start would make a control the board writes take effect only on
   * restart.
   */
  fleet?(): Promise<FleetCap>;
  /**
   * What to read a desk's question escalation through, or absent to decide
   * nothing about it.
   *
   * **A THIRD WORLD, FOR THE SAME REASON `queue` IS A SECOND ONE.** The
   * supervisor reads what each agent LEFT BEHIND and the queue reads what the
   * plans have WAITING; this reads what a desk's MARKER says and how old it
   * is — a third question, about a population `supervise` does not decide
   * from (`left` included).
   */
  escalation?: EscalationWorld;
  /** The clock, so a test can hold one. */
  now?(): number;
}

/**
 * Runs ONE tick: re-read the registry, decide, and report.
 *
 * **IT PERFORMS NOTHING.** The decision it returns names every write and makes
 * none, which is the same property every other workflow in this repo has and is
 * what lets a daemon be dry-run against the live estate with no risk at all.
 * The caller applies the writes.
 *
 * **It holds nothing between calls, and that was measured rather than argued.**
 * The registry is re-read at the top of every tick and the previous tick's
 * decision is not consulted. Verified 2026-09-04 against this estate: a looping
 * daemon was `kill -9`ed two seconds into a 3.4 s tick — its log shows the tick
 * never finished — and the next whole tick reached the identical decision,
 * `agents=3 left=3 reap=0 correct=0 person=0 defer=0`. No state file was
 * written, because none is needed.
 *
 * **A TICK THAT CANNOT COMPLETE REPORTS AND DOES NOT THROW.** Every reading is
 * a call to a machine that can refuse — a registry directory removed mid-pass,
 * a git that will not fork, a host adapter that rejects rather than answering
 * `!ok`. Before this, any one of them escaped `tick` and ended the loop in
 * `run`, so the OS supervisor's restart was the ONLY recovery from a reading
 * that would have succeeded a minute later.
 *
 * So the failure becomes a value: {@link TickReport.incomplete} names what
 * stopped it, the decision is empty, and the loop takes its next tick. There is
 * **no journal, no lock file and no resume path**, because there is nothing to
 * resume — the next tick re-reads the registry and the desks from disk, which
 * is what it does after a `kill -9` too. Recovery and normal operation are the
 * same code path, and that is the whole reason the statelessness is worth
 * keeping.
 *
 * @param options - what to read, and the bound.
 * @returns what this tick read and what it decided, or why it could not.
 */
export const tick = async (options: TickOptions): Promise<TickReport> => {
  const now = options.now ?? Date.now;
  const startedAt = now();
  try {
    const entries = await options.registry();
    const readings = await readTick(entries, options.world);
    const supervised = supervise(readings, { max: options.max ?? 0 });

    // THE ESCALATION PASS RUNS AFTER `supervise`, FOR EVERY DESK IT READ —
    // `left` included. THE MARKER IS THE READING, NOT THE LOOP: a live free
    // loop, a dead loop and an ended loop all reach this pass the same way,
    // because `supervise`'s own verdict says nothing about a question's age.
    // Placing this inside the `needs-a-person` arm would miss exactly the
    // 2026-10-05 case — a live loop that went free after asking.
    const decision =
      options.escalation === undefined
        ? supervised
        : { ...supervised, writes: [...supervised.writes, ...(await escalationWrites(
            escalationDesks(supervised.detail.agents, readings.trees ?? []),
            options.escalation,
          ))] };

    // THE HAND-OVER RUNS AFTER SUPERVISION, WITHIN ONE TICK, and the order is
    // load-bearing: supervision is what frees an agent, by reaping a finished
    // desk or by marking a spent one for a person. Matching first would hand
    // work against a fleet reading taken before this tick's own corrections.
    //
    // BOTH HALVES READ THE SAME REGISTRY LIST. A second read between them would
    // let one tick supervise one set of agents and hand work to another.
    //
    // THE FLEET CAP IS ASKED HERE AND NOWHERE ELSE IN THE TICK, so the size
    // decision reads the same estate the match did. A tick with no `fleet`
    // starts nothing and reports `scaling: null` — *nobody asked*, which is
    // what an operator running the supervision half alone gets.
    const handOver =
      options.queue === undefined
        ? null
        : assign(await readQueue(entries, options.queue), {
            max: options.max ?? 0,
            fleet: options.fleet === undefined ? undefined : await options.fleet(),
          });

    return {
      startedAt,
      costMs: now() - startedAt,
      agents: entries.length,
      decision,
      handOver,
      ...(readings.trees === undefined ? {} : { trees: readings.trees }),
      incomplete: '',
    };
  } catch (error) {
    // THE AGENT COUNT IS ZERO RATHER THAN A GUESS. A tick that failed reading
    // the registry never learnt the count, and one that failed after it would
    // report a number no verdict was reached about — which reads like a tick
    // that decided to leave every agent alone.
    //
    // AND `handOver` IS NULL, WHICH ITS OWN CONTRACT ALREADY SPELLS: null is
    // *nobody asked*. A tick that threw never reached the queue, so it did not
    // ask — an empty decision here would claim it looked and found nothing.
    return {
      startedAt,
      costMs: now() - startedAt,
      agents: 0,
      decision: emptyDecision(),
      handOver: null,
      incomplete: reasonFor(error),
    };
  }
};

/** A desk the escalation pass reads a marker from. */
interface EscalationDesk {
  worktree: string;
  branch: string;
}

/**
 * Every desk the escalation pass reads: each desk `supervise` read, then
 * each manifest-less desk {@link freshAgentCandidateTrees} names that no
 * registry entry already covers.
 *
 * The second group is where the fresh-agent step writes its
 * `PLOT-BLOCKED.md` markers; without it `Notify command` never fires for them.
 *
 * @param agents - every desk `supervise` decided about, in registry order.
 * @param trees - every worktree this tick read.
 * @returns the desks, registry desks first, each worktree once.
 */
export const escalationDesks = (
  agents: readonly EscalationDesk[],
  trees: readonly RegisteredTreeReadings[],
): readonly EscalationDesk[] => {
  const seen = new Set(agents.map((agent) => agent.worktree));
  const unregistered = freshAgentCandidateTrees(trees)
    .filter((tree) => !seen.has(tree.path))
    .map((tree) => ({ worktree: tree.path, branch: tree.branch }));
  return [...agents, ...unregistered];
};

/**
 * One `notify` write per desk whose question reached a new rung, for every
 * desk {@link escalationDesks} names.
 *
 * **THE DOMAIN TAKES READINGS AS VALUES.** This is where the marker, the
 * config and the TSV are read; `questionEscalation` itself imports no port and
 * awaits nothing. A `listed` rung produces no write: that rung is the board's
 * own, and the `Notifier` port is never reached for it.
 *
 * @param agents - every desk to read, from {@link escalationDesks}.
 * @param world - what to read the marker, the config and the record through.
 * @returns one `notify` write per desk whose rung is new.
 */
const escalationWrites = async (
  agents: readonly EscalationDesk[],
  world: EscalationWorld,
): Promise<readonly NotifyWrite[]> => {
  const now = world.now ?? Date.now;
  const ages = await world.ages();
  const writes: NotifyWrite[] = [];
  for (const agent of agents) {
    const marker = await world.marker(agent.worktree);
    if (marker === null) continue;
    const recordedRungs = await world.recordedRungs(agent.worktree, marker.askedAt);
    const ageMs = now() - new Date(marker.askedAt).getTime();
    const result = questionEscalation({ marker, ageMs, ages, recordedRungs });
    if (!result.isNew || result.rung === null || result.rung === 'listed') continue;
    writes.push({
      kind: 'notify',
      worktree: agent.worktree,
      askedAt: marker.askedAt,
      rung: result.rung,
      message: escalationMessage(agent.branch, marker.firstLine, result.rung, ageMs),
    });
  }
  return writes;
};

/**
 * The message a `notify` write sends — the branch, the question and how long
 * it has waited, one line a person can act on without opening the board.
 *
 * @param branch - the branch the desk holds.
 * @param question - the marker's first line.
 * @param rung - the rung reached.
 * @param ageMs - how old the marker is.
 * @returns the message text.
 */
const escalationMessage = (branch: string, question: string, rung: Rung, ageMs: number): string => {
  const minutes = Math.round(ageMs / 60_000);
  return `plot: ${branch} has been waiting on you for ${minutes}m (${rung}) — ${question}`;
};

/**
 * The decision an incomplete tick carries: no writes, no verdicts.
 *
 * Built here rather than taken from a partial `supervise` run, because a
 * partial run's verdicts were reached on readings the tick could not finish
 * taking. An empty decision says *nothing was decided*, which is true; a
 * truncated one would say *these agents were judged*, which is not.
 *
 * @returns a decision naming no write and no agent.
 */
const emptyDecision = (): Decision<SuperviseDetail> => ({
  outcome: 'decided',
  workflow: 'supervise',
  writes: [],
  detail: {
    agents: [],
    left: [],
    reaping: [],
    correcting: [],
    needingAPerson: [],
    deferred: [],
    unclaimed: [],
  },
});

/**
 * What to call the thing that stopped a tick.
 *
 * One line, because it goes into a log a person scans rather than a report they
 * open. A thrown non-Error is stringified rather than dropped: a rejection with
 * a string in it is still the reason.
 *
 * @param error - whatever was thrown.
 * @returns the reason, on one line and never empty.
 */
const reasonFor = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split('\n')[0]?.trim() ?? '';
  return line === '' ? 'the reading failed and said nothing' : line;
};

/**
 * One line of report per tick, for a log a person reads.
 *
 * Written as counts rather than as a list: a tick over a quiet estate is the
 * common case and a line naming five zeros is what makes an unquiet one
 * visible. The branches themselves are in the decision.
 *
 * **An incomplete tick gets a DIFFERENT line, not a line of zeros.** The counts
 * of a tick that decided nothing and the counts of a tick that could not decide
 * are identical, and they mean opposite things: one is a quiet estate, the
 * other is a supervisor that is not supervising. The word `incomplete` and the
 * reason are what a person greps for, and what says the next tick is the
 * recovery.
 *
 * @param report - what the tick decided, or why it could not.
 * @returns the line, without its newline.
 */
export const tickLine = (report: TickReport): string => {
  if (report.incomplete !== '') {
    return [
      'plot-fleetd tick incomplete',
      `reason=${JSON.stringify(report.incomplete)}`,
      `cost=${report.costMs}ms`,
      'next=re-reads',
    ].join(' ');
  }
  const detail = report.decision.detail;
  const fields = [
    `plot-fleetd tick agents=${report.agents}`,
    `left=${detail.left.length}`,
    `reap=${detail.reaping.length}`,
    `correct=${detail.correcting.length}`,
    `person=${detail.needingAPerson.length}`,
    `defer=${detail.deferred.length}`,
  ];

  // THE QUEUE'S FIELDS ARE OMITTED WHEN NOBODY ASKED, rather than printed as
  // zeros. `held=0 handed=0` on a tick that never read the plans says the
  // estate has nothing waiting, which is a claim this tick did not measure.
  if (report.handOver !== null) {
    const queue = report.handOver.detail;
    fields.push(
      `handed=${queue.assignments.length}`,
      // `held=`, NOT `queued=`. It counts slices that were REFUSED, each with
      // a reason; a reader of `queued=480` concludes 480 slices are waiting
      // their turn, when it means 480 nothing would take. That misreading cost
      // an afternoon on 2026-09-06, and every slice dispatched that day was
      // assigned by hand because of it.
      `held=${queue.held.length}`,
      `idle=${queue.idle.length}`,
    );
    // THE HOLDS ARE COUNTED ON THE SUMMARY LINE, because this line is what a
    // person reads on a running daemon and what the log carries. EVERY key
    // prints every time a queue was read, so a zero is a measurement — the
    // difference between *nothing was ready* and *something is wrong*, which
    // `handed=0` alone could never say. The keys are `QUEUE_HOLDS`' own, so a
    // hold added there prints here without being named twice.
    const counts = holdCounts(queue.held);
    for (const hold of QUEUE_HOLDS) fields.push(`${hold}=${counts[hold]}`);
    // HOW FULLY THE HOST ANSWERED *WHICH BRANCHES MERGED*, which is the cause
    // behind every `merge-unknown=` and `prior-unknown=` above it. Under HTTP
    // 429 the supervisor held 36 slices and this line named no refusal, so the
    // rate limit was found by reading a Bitbucket dashboard (#1094).
    //
    // IT IS CONSTANT WHERE A QUEUE WAS READ, `whole` included, so a missing key
    // is a version difference rather than a silence — the rule the hold counts
    // follow. `unaskable` is a listing that failed and `partial` one that
    // answered and left a refusal behind: a partial set's rows may be
    // incomplete, an unaskable set has none.
    //
    // TESTED LOOSELY, BECAUSE RENDERING MUST BE TOTAL. The field is declared
    // non-optional, and a report assembled by hand can still omit it — a log
    // writer that throws takes down the tick that was reporting the problem.
    if (queue.mergedSet != null) {
      const { state, kind } = queue.mergedSet;
      fields.push(`merged-set=${kind === null ? state : `${state}(${kind})`}`);
    }
    // `started=` IS OMITTED WHEN NOBODY ASKED TO SCALE, the same rule the three
    // fields above follow: `started=0` on a tick that never read a cap claims
    // the fleet was already the size it should be, which is a claim this tick
    // did not measure.
    if (queue.scaling !== null) fields.push(`started=${queue.scaling.start}`);
    // `orphaned-claims=` IS OMITTED WHEN NOBODY ASKED, the same rule every
    // queue field above follows: it answers a DIFFERENT question from every
    // hold above it — those are about branches still IN the queue, and a claim
    // ref is a branch `planQueue`'s own `claimed.has` test already took OUT of
    // it. Zero is a measurement once asked.
    //
    // TESTED LOOSELY, LIKE `mergedSet` ABOVE: the field is declared
    // non-optional, and a report assembled by hand can still omit it.
    if (queue.orphanedClaims != null) fields.push(`orphaned-claims=${queue.orphanedClaims.length}`);
  }

  // `unclaimed=` IS OMITTED AT ZERO, and it is the one field here that is. The
  // others print a zero because a zero is a measurement about agents the tick
  // supervised; this counts a population that SHOULD be empty, so on a healthy
  // estate the honest line is silence. A daemon printing `unclaimed=0` sixty
  // times an hour is a field a person stops reading, and the finding exists to
  // be noticed the once it is not zero.
  if (detail.unclaimed.length > 0) fields.push(`unclaimed=${detail.unclaimed.length}`);

  fields.push(`cost=${report.costMs}ms`);

  // THE SPEND FIELDS COME AFTER `cost=`, so every field an earlier tick printed
  // keeps its place and a log stays comparable across the change. They are
  // omitted where nobody read the spend record, the rule the queue fields
  // follow. `account=unread` is not `account=0/hr`: an unreadable record says
  // nothing about the account, and a zero would claim it is idle.
  //
  // `account=` is a different fact from `merge-unknown=`. The hold says the host
  // did not answer this tick; the rate says how much the account is spending.
  if (report.spend) {
    const { accountPerHour, minePerHour } = report.spend;
    fields.push(
      accountPerHour === null ? 'account=unread' : `account=${Math.round(accountPerHour)}/hr`,
      `mine=${Math.round(minePerHour)}/hr`,
    );
  }
  return fields.join(' ');
};

/**
 * The unclaimed worktrees, named one per line for a person to act on.
 *
 * **SEPARATE FROM {@link tickLine} BECAUSE IT IS A DIFFERENT KIND OF OUTPUT.**
 * That line is one row per tick, counts only, written every minute; this is a
 * list a person reads once and then does something about. Folding paths into
 * the summary line would put twelve absolute paths into a log row nobody can
 * scan.
 *
 * **NOTHING IS PRINTED WHEN NOTHING IS CARRIED**, which is the plan's own
 * done-when: an estate where every worktree is dispatched reports zero, and the
 * shape a quiet estate takes here is no output at all.
 *
 * **EVERY LINE IS A SENTENCE OR A COMMAND, NEVER AN ACTION.** The clean ones
 * carry the `git worktree remove` a person types; the dirty ones carry no
 * command at all, and that absence is the finding — the supervisor cannot know
 * why a directory holds uncommitted work, so it says what it measured and
 * stops. It is the reaper's own refusal, applied to a population the reaper
 * never sees.
 *
 * @param report - what the tick decided.
 * @returns the report's lines, without their newlines; empty when nothing is
 *   unclaimed.
 */
export const unclaimedLines = (report: TickReport): string[] => {
  const findings = report.decision.detail.unclaimed;
  if (findings.length === 0) return [];
  return [
    `plot-registryd ${unclaimedNotice(findings)}`,
    ...findings.map((finding) => {
      const held = finding.branch === '' ? 'detached' : finding.branch;
      const dirt =
        finding.disposition === 'read-it'
          ? ` — ${finding.dirtyCount} uncommitted, read it before removing it`
          : '';
      const command = finding.command === '' ? '' : ` — ${finding.command}`;
      return `  ${finding.path} (${held})${dirt}${command}`;
    }),
  ];
};

/**
 * A desk whose worker ended, no manifest names it, and some plan claims its
 * branch — the ONE population {@link endingAction} can answer about for a
 * fresh-session ending, and the one neither `supervise` nor {@link unclaimedTrees} sees.
 *
 * **WHY NEITHER EXISTING READING NAMES THIS DESK.** `supervise` reads the
 * REGISTRY, and the exit trap that runs on every ending already removed this
 * desk's manifest — so it is not in the registry's list at all. `isUnclaimedTree`
 * reads every registered worktree and excludes any whose branch a plan names,
 * precisely because a plan-named branch is somebody's work even with no
 * manifest — which is exactly this desk's shape. Both readings are right for
 * the population they describe; this is a third population neither one was
 * built to see.
 *
 * **THE JOIN IS: unregistered, plan-named, not the main checkout.** That is
 * `RegisteredTreeReadings` itself, minus `isUnclaimedTree`'s own filter —
 * `!registered && !isMain && planNamed` rather than `!planNamed`.
 */
export const freshAgentCandidateTrees = (
  trees: readonly RegisteredTreeReadings[],
): readonly RegisteredTreeReadings[] =>
  trees.filter((tree) => !tree.isMain && !tree.registered && tree.planNamed);

/** What one tick read of one fresh-agent candidate desk, before deciding. */
export interface FreshAgentCandidateReadings {
  /** The plan that names the branch, as its file name without `.md`; `''` where unread. */
  plan: string;
  /** The branch the desk holds. */
  branch: string;
  /** The desk, absolute. */
  worktree: string;
  /** The desk's own ending reason, or `null` where none was written or it could not be read. */
  ending: EndingReason | null;
  /**
   * The assignment a take-up refused because the desk held unlanded work, as
   * the ending recorded it; `''` for every other ending, and for an
   * after-prompt `holding-work` ending.
   */
  refusedAssignment: string;
  /** `PLOT-CORRECTION.md`'s text, verbatim; `''` where it could not be read. */
  correctionsText: string;
  /** The failing run's URL and conclusion, parsed from the ending's own `detail`. */
  runUrl: string;
  conclusion: string;
  /** The ending's own `detail`, verbatim — what {@link needsPersonMarker} reads for `checks-unanswered`. */
  detail: string;
  /** How many fresh sessions this slice already had. */
  priorFreshSessions: number;
  /**
   * Whether the desk already carries a `PLOT-BLOCKED*` marker.
   *
   * **THE MARKER, NOT THE DECLARATION.** `questionEscalation` reads the
   * marker file, and the marker file is what a repeat write must not
   * overwrite — a declaration saying `blocked` answers a different question
   * (`supervise`'s own `isBlocked`, for a desk a manifest still names) and a
   * desk here has none. Reading the declaration for this field would miss a
   * marker written with no declaration, and the no-overwrite guard this
   * reading feeds would then double-write it.
   */
  escalated: boolean;
  /** When the ending file was written, ISO-8601; `''` where it could not be read. */
  endingAt: string;
  /**
   * Whether `.plot/state/ending-asks.tsv` already holds this plan, branch and
   * `endingAt`; `false` where the record or the ending time could not be read.
   */
  endingAsked: boolean;
  /**
   * Whether the host merged a PR for the branch. Asked only for an ending in
   * `NEEDS_PERSON_ENDINGS` that no ask names yet; `'unanswerable'` for every
   * other desk and wherever the host gave no answer.
   */
  prMerged: PrMergedReading;
  /**
   * Every dirty path `Trees.dirtyPaths` read for this desk, or `null` where
   * the read failed. Read for every candidate, though only an after-prompt
   * `holding-work` decision's composed answer uses it — the same way every
   * other field here is a reading taken once per candidate rather than only
   * where the verdict is known to need it.
   */
  heldFiles: readonly string[] | null;
  /**
   * Whether the branch holds a commit beyond its claim. Asked only for a
   * `bound`/`unreadable` ending no person was asked about, which is the one
   * case in this population {@link endingAction} reads it for;
   * `'unanswerable'` for every other desk.
   */
  commitBeyondClaim: CommitReading;
  /**
   * Whether an open PR still carries the branch. Asked only for a
   * `bound`/`unreadable` ending no person was asked about, the same reasoning as
   * {@link FreshAgentCandidateReadings.commitBeyondClaim}; `'unanswerable'`
   * for every other desk.
   */
  prOpen: PrOpenReading;
}

/** `PLOT-CORRECTION.md`'s filename — the desk's own account of every attempt. */
const CORRECTION_FILENAME = 'PLOT-CORRECTION.md';

/**
 * Pulls the failing run's URL and conclusion out of an ending's `detail`.
 *
 * The shell writes the detail for a spent budget as "the build failed on each
 * of N corrections; the last was: <the monitor's evidence>", and the monitor's
 * evidence is "the run at <url> for <sha> concluded <conclusion>"
 * (`build_says_failed`, `plot-worker-loop.sh:1693`). This parses that sentence.
 * A change to the monitor's wording makes it answer empty strings.
 *
 * @param detail - the ending's `detail` field, verbatim.
 * @returns the run's URL and what it concluded, or `''` for either where the
 *   sentence does not hold them.
 */
export const runFromEndingDetail = (detail: string): { runUrl: string; conclusion: string } => {
  const url = /the run at (\S+) for/.exec(detail)?.[1] ?? '';
  const conclusion = /concluded (.+)$/.exec(detail)?.[1]?.trim() ?? '';
  return { runUrl: url, conclusion };
};

/**
 * Whether an ending is `bound` or `unreadable` — the two reasons a time-out
 * leaves, and {@link endingAction}'s own `release-claim`/`start-fresh` split.
 *
 * @param ending - the desk's ending reason, or `null` where none was read.
 * @returns true for `bound` and `unreadable`; false otherwise.
 */
export const isBoundEnding = (ending: EndingReason | null): boolean =>
  ending === 'bound' || ending === 'unreadable';

/**
 * Whether `Trees.dirtyPaths`' own reading shows a dirty tree.
 *
 * `null` (the read failed) takes the same arm as a populated list — the
 * destructive answer, `release-claim`, must never follow a failed read.
 *
 * @param heldFiles - every dirty path read for the desk, or `null` where the
 *   read failed.
 * @returns `'yes'` for a populated list or a failed read, `'no'` for an empty one.
 */
export const dirtyTreeReading = (heldFiles: readonly string[] | null): CommitReading =>
  heldFiles === null || heldFiles.length > 0 ? 'yes' : 'no';

/** The reads {@link readFreshAgentCandidates} takes to decide whether an ending was already put to a person. */
export interface FreshAgentAskReads {
  /** The ending file's modification time, ISO-8601, or `null` where it could not be read. */
  endingAt: (worktree: string) => Promise<string | null>;
  /** The `.plot/state/ending-asks.tsv` store. */
  record: Pick<EndingAskRecordStore, 'asked'>;
  /** Whether the host merged a PR for the branch; `'unanswerable'` where it gave no answer. */
  prMerged: (branch: string) => Promise<PrMergedReading>;
  /** Whether a branch holds a commit beyond its claim; keyed by worktree. */
  commitBeyondClaim: (worktree: string) => Promise<CommitReading>;
  /** Whether an open PR still carries a branch; `'unanswerable'` where the host could not be asked. */
  prOpen: (branch: string) => Promise<PrOpenReading>;
}

/**
 * Reads what one tick needs about every fresh-agent candidate desk.
 *
 * Takes one read of the ending and the correction file from each desk, one
 * read of the record per candidate, and one marker read. For a desk with an
 * ending it also reads the ending file's time and the ask record, and for an
 * outright `needs-a-person` ending no ask names yet, the host's merge answer.
 * The candidate list holds only desks whose worker ended with its manifest
 * gone.
 *
 * @param candidates - the desks {@link freshAgentCandidateTrees} named.
 * @param deskFile - reads one file from a desk, or null where it is not there.
 * @param freshAgents - the `.plot/state/fresh-agents.tsv` store.
 * @param heldFiles - reads a desk's dirty paths, or null where the read failed.
 * @param hasMarker - whether the desk already carries a `PLOT-BLOCKED*` marker.
 * @param asks - the ending's time, the ask record, and the host's merge answer.
 * @returns one reading per candidate, in the order given.
 */
export const readFreshAgentCandidates = async (
  candidates: readonly RegisteredTreeReadings[],
  deskFile: (worktree: string, name: string) => string | null,
  freshAgents: Pick<FreshAgentRecordStore, 'rowsFor'>,
  heldFiles: (worktree: string) => Promise<readonly string[] | null>,
  hasMarker: (worktree: string) => Promise<boolean>,
  asks: FreshAgentAskReads,
): Promise<readonly FreshAgentCandidateReadings[]> => {
  const out: FreshAgentCandidateReadings[] = [];
  for (const tree of candidates) {
    const endingReading = readEnding(deskFile(tree.path, ENDING_FILENAME));
    const ending = endingReading.read === 'ended' ? endingReading.ending.reason : null;
    const detail = endingReading.read === 'ended' ? endingReading.ending.detail : '';
    const { runUrl, conclusion } = runFromEndingDetail(detail);
    const plan = tree.plan ?? '';
    const rows = await freshAgents.rowsFor(plan, tree.branch);
    const endingAt = ending === null ? null : await asks.endingAt(tree.path);
    const asked = endingAt === null ? null : await asks.record.asked(plan, tree.branch, endingAt);
    // AN UNREADABLE RECORD IS "NOT ASKED": a repeat ask is a no-overwrite
    // marker write, and a missed one leaves a stopped slice with nobody told.
    const endingAsked = asked !== null && asked.ok && asked.value;
    out.push({
      plan,
      branch: tree.branch,
      worktree: tree.path,
      ending,
      refusedAssignment: endingReading.read === 'ended' ? endingReading.ending.refusedAssignment : '',
      correctionsText: deskFile(tree.path, CORRECTION_FILENAME) ?? '',
      runUrl,
      conclusion,
      detail,
      // An unanswerable store reads as zero rows: absence can start one
      // session too many and never strands a slice at a person.
      priorFreshSessions: rows.ok ? rows.value.length : 0,
      escalated: await hasMarker(tree.path),
      endingAt: endingAt ?? '',
      endingAsked,
      // THE HOST IS ASKED ONLY WHERE ITS ANSWER CAN CHANGE THE VERDICT.
      // `endingAction` reads `prMerged` for the five outright reasons and for
      // `bound`/`unreadable`; an ending already asked about answers `leave`
      // whatever the host says.
      prMerged:
        (endingAsksPersonOutright(ending) || isBoundEnding(ending)) && !endingAsked
          ? await asks.prMerged(tree.branch)
          : 'unanswerable',
      heldFiles: await heldFiles(tree.path),
      // `endingAction` reads these two for `bound`/`unreadable` only. Every
      // other ending, and an ending already asked about, reads
      // `'unanswerable'` without a git or host call.
      commitBeyondClaim:
        isBoundEnding(ending) && !endingAsked ? await asks.commitBeyondClaim(tree.path) : 'unanswerable',
      prOpen: isBoundEnding(ending) && !endingAsked ? await asks.prOpen(tree.branch) : 'unanswerable',
    });
  }
  return out;
};

/** What this tick decided about one fresh-agent candidate. */
export interface FreshAgentDecision {
  plan: string;
  branch: string;
  worktree: string;
  verdict: EndingActionVerdict;
  /** The fresh session's composed answer; `''` where the verdict is not `start-fresh`. */
  answer: string;
  /** The failing run's URL, for the record; `''` where none was read. */
  runUrl: string;
  /**
   * Whether this tick writes the desk's `PLOT-BLOCKED.md` marker.
   *
   * True for `needs-a-person` where the desk does not already carry one, so
   * the next tick does not repeat the write.
   */
  escalate: boolean;
  /**
   * The marker's text for a `needs-a-person` verdict, from `needsPersonMarker`;
   * `''` for every other verdict, and where the composer threw.
   */
  markerText: string;
  /** The ending file's time, ISO-8601, for the ask record; `''` where unread. */
  endingAt: string;
  /**
   * The branch whose claim this tick releases through
   * {@link FreshAgentPorts.release}: the desk's own branch for a
   * `bound`/`unreadable` `release-claim`, `''` for every other decision. A
   * take-up `holding-work` `release-claim` carries `''` here, because
   * {@link applyNothingDoneDecisions} releases that one.
   */
  releaseBranch: string;
}

/**
 * The marker text for one desk, or `''` where the composer throws.
 *
 * Per desk, so one ending with no wording does not stop the decisions for
 * every other desk in the tick.
 */
export const markerTextFor = (reading: FreshAgentCandidateReadings): string => {
  if (reading.ending === null) return '';
  try {
    return needsPersonMarker(reading.ending, reading.branch, reading.detail);
  } catch {
    return '';
  }
};

/**
 * Decides every fresh-agent candidate this tick read.
 *
 * Takes readings and returns a verdict per desk. It touches no file and no
 * process; {@link applyFreshAgentDecisions} applies the verdicts.
 *
 * **ONE RULE, ONE SHARED COUNT, AT MOST ONE ANSWER.** `endingAction` answers
 * `start-fresh` or `needs-a-person` for `corrections-spent`, `turn-limit`,
 * `bound`/`unreadable`, and an after-prompt `holding-work` ending alike,
 * reading the same `priorFreshSessions` count for all of them — so a slice
 * that already spent its one fresh session on one ending gets
 * `needs-a-person` from another rather than a second fresh session. A
 * candidate is `!registered` by construction (see
 * {@link freshAgentCandidateTrees}), so every reading carries
 * `hasManifest: false`; `commitBeyondClaim`/`prOpen` are filler
 * (`'unanswerable'`, per {@link readFreshAgentCandidates}) for every ending
 * but `bound`/`unreadable`, since none of the others reads the branch's work
 * — and `'unanswerable'` there is harmless because only the `bound`/
 * `unreadable` row reads either field at all. For `bound`/`unreadable`
 * themselves all three readings — `commitBeyondClaim`, `prOpen`, and
 * `dirtyTree` (via {@link dirtyTreeReading} of `heldFiles`) — are real, never
 * filler, because that row can answer `release-claim` on "nothing beyond the
 * claim" and a desk full of unlanded work must never be read as empty here.
 *
 * **THIS STEP RELEASES A TIMED-OUT DESK'S CLAIM.** A `bound`/`unreadable`
 * `release-claim` carries the desk's branch as
 * {@link FreshAgentDecision.releaseBranch}, because only this step reads the
 * real `dirtyTree`; {@link nothingDoneDecisions} answers `leave` for the same
 * desk.
 *
 * @param candidates - what {@link readFreshAgentCandidates} read.
 * @param budget - the repository's `Correction budget`, for the composed answer.
 * @returns one decision per candidate, in the order given.
 */
export const freshAgentDecisions = (
  candidates: readonly FreshAgentCandidateReadings[],
  budget: number,
): readonly FreshAgentDecision[] =>
  candidates.map((reading) => {
    const bound = isBoundEnding(reading.ending);
    const verdict = endingAction({
      ending: reading.ending,
      branch: reading.branch,
      refusedAssignment: reading.refusedAssignment,
      hasManifest: false,
      priorFreshSessions: reading.priorFreshSessions,
      commitBeyondClaim: bound ? reading.commitBeyondClaim : 'no',
      prOpen: bound ? reading.prOpen : false,
      dirtyTree: bound ? dirtyTreeReading(reading.heldFiles) : 'no',
      prMerged: reading.prMerged,
      endingAsked: reading.endingAsked,
    });
    // THE COMPOSED ANSWER FOLLOWS WHICH ENDING FIRED, NOT JUST THE VERDICT.
    // `freshAgentAnswer`'s whole text is about a spent correction budget,
    // `holdingWorkAnswer`'s is about uncommitted work from a refused prompt,
    // and `boundAnswer`'s is about a timed-out session — reusing one for an
    // ending that never had that problem would misdescribe the session.
    const answer =
      verdict !== 'start-fresh'
        ? ''
        : bound
          ? boundAnswer(reading.branch, reading.heldFiles)
          : reading.ending === 'turn-limit'
            ? freshAgentTurnLimitAnswer(reading.branch)
            : reading.ending === 'holding-work'
              ? holdingWorkAnswer(reading.branch, reading.heldFiles)
              : freshAgentAnswer({
                  branch: reading.branch,
                  budget,
                  correctionsText: reading.correctionsText,
                  runUrl: reading.runUrl,
                  conclusion: reading.conclusion,
                });
    const markerText = verdict === 'needs-a-person' ? markerTextFor(reading) : '';
    return {
      plan: reading.plan,
      branch: reading.branch,
      worktree: reading.worktree,
      verdict,
      answer,
      runUrl: reading.runUrl,
      escalate: verdict === 'needs-a-person' && !reading.escalated,
      markerText,
      endingAt: reading.endingAt,
      releaseBranch: bound && verdict === 'release-claim' ? reading.branch : '',
    };
  });

/** What the fresh-agent step applied for one desk. */
export interface FreshAgentApplied {
  branch: string;
  outcome:
    | 'started'
    | 'refused'
    | 'start-failed'
    | 'threw'
    | 'escalated'
    | 'escalation-failed'
    | 'released';
  /** One line saying why, or what started. */
  detail: string;
}

/** What {@link applyFreshAgentDecisions} acts through. */
export interface FreshAgentPorts {
  /** The `.plot/state/fresh-agents.tsv` store. */
  record: Pick<FreshAgentRecordStore, 'append'>;
  /** Writes the `PLOT-BLOCKED.md` marker. */
  desk: Pick<Desk, 'writeBlockedMarker'>;
  /** The `.plot/state/ending-asks.tsv` store, appended once per ending put to a person. */
  asks: Pick<EndingAskRecordStore, 'append'>;
  /**
   * Starts the fresh session through the continue workflow.
   *
   * `beforeStart` runs after the workflow accepts the desk and before it
   * changes anything; returning false stops the start.
   */
  start: (input: {
    branch: string;
    worktree: string;
    answer: string;
    beforeStart: () => Promise<boolean>;
  }) => Promise<DeskContinuation>;
  /** The clock, for the record's timestamp. */
  now: () => Date;
  /**
   * Decides and, where releasable, releases one branch's claim — the same
   * {@link ClaimRelease} path {@link applyNothingDoneDecisions} reaches.
   */
  release: (branch: string) => Promise<{ released: boolean; detail: string }>;
}

/**
 * Applies the fresh-agent decisions of one tick.
 *
 * **`start-fresh` WRITES THE RECORD ROW, THEN STARTS.** The row is appended
 * after the continue workflow accepted the desk and before it spawned, so a
 * tick that throws after the write has one row and the next tick reads
 * `needs-a-person` instead of starting a second session. A refusal by the
 * workflow (for example `no-manifest`) happens before the row is written, so
 * a refused desk records nothing.
 *
 * **`needs-a-person` WRITES A `PLOT-BLOCKED.md` MARKER ONCE, AND RECORDS THE
 * ASK.** The decision carries `escalate: false` once the marker exists. The
 * ask row is appended where the marker was written or already existed, so
 * the next tick answers `leave` for this ending after a person's answer
 * removes the marker. A marker that could not be written records no ask.
 *
 * **`release-claim` RELEASES ONLY A NAMED {@link FreshAgentDecision.releaseBranch}.**
 * The release reports `released`, or `refused` with the release's own
 * detail; a refusal is not retried.
 *
 * **ONE DESK THROWING DOES NOT STOP THE OTHERS.** The throw is reported as
 * `threw`.
 *
 * @param decisions - what {@link freshAgentDecisions} decided.
 * @param ports - what each decision acts through.
 * @returns one entry per desk acted on or refused, in decision order; desks
 *   with nothing to do have no entry.
 */
export const applyFreshAgentDecisions = async (
  decisions: readonly FreshAgentDecision[],
  ports: FreshAgentPorts,
): Promise<readonly FreshAgentApplied[]> => {
  const out: FreshAgentApplied[] = [];
  for (const decision of decisions) {
    try {
      if (decision.verdict === 'start-fresh') {
        const started = await ports.start({
          branch: decision.branch,
          worktree: decision.worktree,
          answer: decision.answer,
          beforeStart: async () =>
            (
              await ports.record.append({
                plan: decision.plan,
                branch: decision.branch,
                worktree: decision.worktree,
                at: ports.now().toISOString(),
                runUrl: decision.runUrl,
              })
            ).ok,
        });
        if (started.kind === 'started') {
          out.push({
            branch: decision.branch,
            outcome: 'started',
            detail: `fresh session started, pid ${started.pid}`,
          });
        } else if (started.kind === 'refused') {
          out.push({
            branch: decision.branch,
            outcome: 'refused',
            detail: `continue refused (${started.reason}): ${started.detail}`,
          });
        } else {
          out.push({ branch: decision.branch, outcome: 'start-failed', detail: started.error });
        }
      } else if (decision.verdict === 'needs-a-person') {
        const applied = await askAPerson(decision, ports);
        if (applied !== null) out.push(applied);
      } else if (decision.verdict === 'release-claim' && decision.releaseBranch !== '') {
        const result = await ports.release(decision.releaseBranch);
        out.push({
          branch: decision.releaseBranch,
          outcome: result.released ? 'released' : 'refused',
          detail: result.detail,
        });
      }
    } catch (error) {
      out.push({
        branch: decision.branch,
        outcome: 'threw',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
};

/**
 * Writes the marker for one `needs-a-person` decision where none exists, then
 * records the ask.
 *
 * @param decision - a decision whose verdict is `needs-a-person`.
 * @param ports - the desk and the ask record.
 * @returns the outcome to report, or `null` where the marker already existed
 *   and the ask was recorded.
 */
const askAPerson = async (
  decision: FreshAgentDecision,
  ports: Pick<FreshAgentPorts, 'desk' | 'asks' | 'now'>,
): Promise<FreshAgentApplied | null> => {
  const failure = (detail: string): FreshAgentApplied => ({ branch: decision.branch, outcome: 'escalation-failed', detail });
  let wrote = false;
  if (decision.escalate) {
    if (decision.markerText === '') return failure('no marker text composes for this ending');
    if (!(await ports.desk.writeBlockedMarker(decision.worktree, decision.markerText)).ok) {
      return failure('the PLOT-BLOCKED.md marker could not be written');
    }
    wrote = true;
  }
  if (decision.endingAt !== '') {
    const recorded = await ports.asks.append({
      plan: decision.plan,
      branch: decision.branch,
      endingAt: decision.endingAt,
      at: ports.now().toISOString(),
    });
    if (!recorded.ok) return failure('the ask could not be recorded in ending-asks.tsv; the next tick asks again');
  }
  return wrote
    ? { branch: decision.branch, outcome: 'escalated', detail: 'wrote a PLOT-BLOCKED.md marker asking a person to decide' }
    : null;
};

/**
 * One log line per applied fresh-agent outcome.
 *
 * @param applied - what {@link applyFreshAgentDecisions} returned.
 * @returns the lines without newlines, each saying whether it belongs on the
 *   error stream.
 */
export const freshAgentLines = (
  applied: readonly FreshAgentApplied[],
): readonly { line: string; error: boolean }[] =>
  applied.map((entry) => ({
    line: `plot-registryd fresh-agent ${entry.branch}: ${entry.outcome} — ${entry.detail}`,
    error: entry.outcome !== 'started' && entry.outcome !== 'escalated' && entry.outcome !== 'released',
  }));

/**
 * A desk whose worker ended with no manifest left — the population
 * {@link endingAction} answers about. The same join {@link freshAgentCandidateTrees}
 * already takes, because a `nothing-done` ending and a `corrections-spent` one
 * are both found on a desk no manifest names and some plan still claims.
 *
 * **NOT NARROWED TO `nothing-done` HERE.** The filter stays the population —
 * unregistered, plan-named, not the main checkout — and {@link endingAction}
 * is what reads the ending and answers `leave` for every other reason. Narrowing
 * here would duplicate that answer in two places.
 *
 * @param trees - every registered tree this tick read.
 * @returns the candidates, in the order given.
 */
export const nothingDoneCandidateTrees = (
  trees: readonly RegisteredTreeReadings[],
): readonly RegisteredTreeReadings[] =>
  trees.filter((tree) => !tree.isMain && !tree.registered && tree.planNamed);

/** What one tick read of one `nothing-done` candidate desk, before deciding. */
export interface NothingDoneCandidateReadings {
  /** The plan that names the branch, as its file name without `.md`; `''` where unread. */
  plan: string;
  /** The branch the desk holds. */
  branch: string;
  /** The desk, absolute. */
  worktree: string;
  /** The desk's own ending reason, or `null` where none was written or it could not be read. */
  ending: EndingReason | null;
  /** The assignment a take-up refused, as the ending recorded it; `''` where it recorded none. */
  refusedAssignment: string;
}

/**
 * Reads what one tick needs about every `nothing-done` candidate desk.
 *
 * Takes one read of the ending from each desk — the same shape
 * {@link readFreshAgentCandidates} takes, narrowed to the one field
 * {@link endingAction} reads that {@link readFreshAgentCandidates} does not
 * already carry under another name.
 *
 * @param candidates - the desks {@link nothingDoneCandidateTrees} named.
 * @param deskFile - reads one file from a desk, or null where it is not there.
 * @returns one reading per candidate, in the order given.
 */
export const readNothingDoneCandidates = (
  candidates: readonly RegisteredTreeReadings[],
  deskFile: (worktree: string, name: string) => string | null,
): readonly NothingDoneCandidateReadings[] =>
  candidates.map((tree) => {
    const endingReading = readEnding(deskFile(tree.path, ENDING_FILENAME));
    return {
      plan: tree.plan ?? '',
      branch: tree.branch,
      worktree: tree.path,
      ending: endingReading.read === 'ended' ? endingReading.ending.reason : null,
      refusedAssignment: endingReading.read === 'ended' ? endingReading.ending.refusedAssignment : '',
    };
  });

/**
 * Whether an open PR carries a branch, read from the host's answer.
 *
 * @param state - the host's PR state for the branch: `null` where no PR
 *   exists, or a failed answer where the host could not be asked.
 * @returns `true` for an open PR, `false` where the host answered with no
 *   open PR, and `'unanswerable'` where it gave no answer — a failed read is
 *   never "no PR open".
 */
export const prOpenReading = (state: PortResult<Pr | null>): PrOpenReading =>
  state.ok ? state.value !== null && state.value.state === 'OPEN' : 'unanswerable';

/**
 * Whether the host merged a PR for a branch, read from its answer.
 *
 * @param answer - the host's `prMerged` answer for the branch.
 * @returns `'merged'` or `'not-merged'` where the host said so, and
 *   `'unanswerable'` for a failed call or an `unknown` answer — a failed read
 *   is never "merged".
 */
export const prMergedReading = (answer: PortResult<MergedAnswer>): PrMergedReading =>
  !answer.ok || answer.value === 'unknown' ? 'unanswerable' : answer.value;

/** What this tick decided about one `nothing-done` candidate. */
export interface NothingDoneDecision {
  /**
   * The branch a `release-claim` verdict releases — {@link endingReleaseBranch}'s
   * answer, which for a take-up `holding-work` is the refused assignment and
   * not the desk's own branch.
   */
  branch: string;
  worktree: string;
  verdict: ReturnType<typeof endingAction>;
}

/**
 * Decides every `nothing-done` candidate this tick read.
 *
 * Takes readings and returns a verdict per desk. It touches no file and no
 * process; {@link applyNothingDoneDecisions} applies the verdicts.
 *
 * **A SECOND, INDEPENDENT `Trees.commitBeyondClaim` CALL, NOT THE LOOP'S
 * OWN READING.** The loop's reading lives inside the worker process that
 * already exited; this tick reads the same desk again from the registry
 * daemon, after that process is gone. Both ask through
 * `Trees.commitBeyondClaim`, so the two readings are one implementation asked
 * twice.
 *
 * **`bound`/`unreadable` NEVER REACH `endingAction` HERE.** This step and
 * {@link freshAgentDecisions} read the same desk population
 * (`nothingDoneCandidateTrees`/`freshAgentCandidateTrees` share one filter),
 * and `endingAction`'s `bound`/`unreadable` row can answer `release-claim` on
 * "nothing beyond the claim" — a verdict this step could only reach with a
 * filler `dirtyTree`, never the real one. The fresh-agent step owns the real
 * `dirtyTree` reading (from `heldFiles`) and releases the claim itself, and
 * this step's own verdict for a `bound`/`unreadable` candidate is always
 * `leave`, so one desk still gets one verdict this tick: the fresh-agent
 * step's.
 *
 * @param candidates - what {@link readNothingDoneCandidates} read.
 * @param commitBeyondClaim - reads whether a desk's branch holds a commit
 *   beyond its claim, keyed by worktree.
 * @param prOpen - reads whether an open PR still carries a branch, keyed by
 *   branch; `'unanswerable'` where the host could not be asked.
 * @param priorFreshSessions - how many fresh sessions this slice already had,
 *   keyed by plan and branch — the same store {@link readFreshAgentCandidates}
 *   reads, so the allowance is shared whichever pipeline asks first.
 * @returns one decision per candidate, in the order given.
 */
export const nothingDoneDecisions = async (
  candidates: readonly NothingDoneCandidateReadings[],
  commitBeyondClaim: (worktree: string) => Promise<CommitReading>,
  prOpen: (branch: string) => Promise<PrOpenReading>,
  priorFreshSessions: (plan: string, branch: string) => Promise<number>,
): Promise<readonly NothingDoneDecision[]> => {
  const out: NothingDoneDecision[] = [];
  for (const reading of candidates) {
    if (isBoundEnding(reading.ending)) {
      out.push({ branch: reading.branch, worktree: reading.worktree, verdict: 'leave' });
      continue;
    }
    const readings = {
      ending: reading.ending,
      branch: reading.branch,
      refusedAssignment: reading.refusedAssignment,
      // A CANDIDATE IS `!registered` BY CONSTRUCTION (see
      // `nothingDoneCandidateTrees`), so every reading carries
      // `hasManifest: false` — the same reasoning `freshAgentDecisions` already
      // states for its own candidates.
      hasManifest: false,
      priorFreshSessions: await priorFreshSessions(reading.plan, reading.branch),
      commitBeyondClaim: await commitBeyondClaim(reading.worktree),
      prOpen: await prOpen(reading.branch),
      // NOT READ HERE: both feed only a `needs-a-person` answer, and this step
      // applies `release-claim` alone. The fresh-agent step reads them.
      prMerged: 'unanswerable' as const,
      // `bound`/`unreadable` are filtered out above, so `dirtyTree` is never
      // read by the remaining endings — filler, matching `commitBeyondClaim`
      // and `prOpen`'s own filler pattern for endings that don't need them.
      dirtyTree: 'no' as const,
      endingAsked: false,
    };
    out.push({ branch: endingReleaseBranch(readings), worktree: reading.worktree, verdict: endingAction(readings) });
  }
  return out;
};

/** What the `nothing-done` step applied for one desk. */
export interface NothingDoneApplied {
  branch: string;
  outcome: 'released' | 'refused' | 'release-failed' | 'threw';
  /** One line saying why, or what happened. */
  detail: string;
}

/**
 * Releases the claim for every decision that answered `release-claim`.
 *
 * **THE SUPERVISOR RELEASES THE CLAIM; THE LOOP NAMES ONLY WHAT TO DO.** This
 * is the one caller in this file that reaches a port rather than deciding —
 * `release` is {@link ClaimRelease.release}, reached through
 * {@link gatherReadingsAndRelease}'s own readings-gather-then-decide sequence
 * so this tick and the board's `/api/release-claim` route reach one decision
 * about releasability rather than two.
 *
 * **A REFUSAL IS NEVER RETRIED OR BYPASSED.** `releaseClaim` (the domain
 * decision `release` wraps) refuses for four shell-enforced reasons — a live
 * worker pid, a file-changing remote commit, unpushed or dirty desk work, a
 * `PLOT-BLOCKED` marker — and a refusal here is reported exactly like every
 * other refusal this tick already leaves for a person or the next pass; it is
 * not acted around.
 *
 * **ONE DESK THROWING DOES NOT STOP THE OTHERS**, the same property
 * {@link applyFreshAgentDecisions} has.
 *
 * @param decisions - what {@link nothingDoneDecisions} decided.
 * @param release - releases one branch's claim; `gatherReadingsAndRelease`'s
 *   shape, narrowed to what this step calls.
 * @returns one entry per desk whose decision was `release-claim`, in decision
 *   order; desks decided `leave` have no entry.
 */
export const applyNothingDoneDecisions = async (
  decisions: readonly NothingDoneDecision[],
  release: (branch: string) => Promise<{ released: boolean; detail: string }>,
): Promise<readonly NothingDoneApplied[]> => {
  const out: NothingDoneApplied[] = [];
  for (const decision of decisions) {
    if (decision.verdict !== 'release-claim') continue;
    try {
      const result = await release(decision.branch);
      out.push({
        branch: decision.branch,
        outcome: result.released ? 'released' : 'refused',
        detail: result.detail,
      });
    } catch (error) {
      out.push({
        branch: decision.branch,
        outcome: 'threw',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
};

/**
 * One log line per applied `nothing-done` outcome.
 *
 * @param applied - what {@link applyNothingDoneDecisions} returned.
 * @returns the lines without newlines, each saying whether it belongs on the
 *   error stream.
 */
export const nothingDoneLines = (
  applied: readonly NothingDoneApplied[],
): readonly { line: string; error: boolean }[] =>
  applied.map((entry) => ({
    line: `plot-registryd nothing-done ${entry.branch}: ${entry.outcome} — ${entry.detail}`,
    error: entry.outcome !== 'released',
  }));

import type { WorkerState } from '../entities/fleet.js';
import type { Finding } from '../entities/finding.js';
import type { PortResult } from '../port-result.js';
import type { Agents } from '../ports/agents.js';
import type { Desk } from '../ports/desk.js';
import type { Host } from '../ports/host.js';
import type { Refs } from '../ports/refs.js';
import type { Trees } from '../ports/trees.js';
import {
  agentFinding,
  agentFindingLine,
  changesetReading,
  finalPassDue,
  lookupPrAnswer,
  needsPrAnswer,
  passPrAnswer,
  type AgentFindingReadings,
  type PrAnswer,
} from '../rules/agent-finding.js';
import { realCommits } from '../rules/empty-claim.js';
import { CHANGED_PATHS_CAP, type BranchStageReadings } from './plan-walk-branches.js';
import type { DeskStageReadings } from './plan-walk-desks.js';

/** The ports a findings pass writes and asks through. */
export interface AgentFindingPorts {
  readonly desk: Desk;
  readonly host: Host;
}

/** One desk's finding pass: its subject and its readings. */
interface DeskPass {
  readonly branch: string;
  readonly worktree: string;
  readonly readings: AgentFindingReadings;
}

/** The PR answer of one host lookup, and the desk log line for a refusal. */
const askHost = async (
  ports: AgentFindingPorts,
  branch: string,
  worktree: string,
  who: string,
): Promise<PrAnswer> => {
  const answer = await ports.host.prState(branch);
  const pr = lookupPrAnswer(answer);
  if (!answer.ok) {
    const why = answer.why === 'unaskable' && answer.reason !== undefined ? `unaskable: ${answer.reason}` : answer.why;
    await ports.desk.appendLog(worktree, `${who}: final pass for ${branch}: pr-state did not answer (${why}); no owes a review is written`);
  }
  return pr;
};

/** Writes the line {@link agentFindingLine} gives against the desk's held AgentMonitor finding. */
const writeLine = async (ports: AgentFindingPorts, pass: DeskPass, at: string): Promise<Finding | null> => {
  const findings = await ports.desk.readFindings(pass.worktree);
  if (!findings.ok) return null;
  const held = findings.value.find((f) => f.monitor === 'AgentMonitor' && f.branch === pass.branch) ?? null;
  const line = agentFindingLine({ held, next: agentFinding(pass.readings), branch: pass.branch, worktree: pass.worktree, at });
  if (line === null) return null;
  const written = await ports.desk.publishAgentFinding(pass.worktree, line);
  return written.ok ? line : null;
};

/**
 * Writes the AgentMonitor's findings for every desk a fleet pass read.
 *
 * Reads the finding from the pass's own readings: the desk's markers, dirt and
 * unpushed commits, and the branch stage's commit count, changed paths and PR
 * answer. A desk whose worker ended since the last pass, or that is first
 * read ended, takes its PR answer from one host `pr-state` instead where the
 * finding depends on it; a refused
 * lookup writes a desk log line. Appends a line only when the finding changes.
 *
 * @param ports - the desk files and the host.
 * @param states - the worker state each desk read on the previous pass, by
 *   worktree; updated in place, and desks the pass did not read are dropped.
 * @param branches - the pass's branch stage.
 * @param desks - the pass's desk stage.
 * @param at - the reading's time, as `monitorTime` prints it.
 * @returns the lines written.
 */
export const writeAgentFindings = async (
  ports: AgentFindingPorts,
  states: Map<string, WorkerState>,
  branches: BranchStageReadings,
  desks: DeskStageReadings,
  at: string,
): Promise<readonly Finding[]> => {
  const byBranch = new Map(branches.branches.map((entry) => [entry.branch, entry] as const));
  const read = new Set<string>();
  const written: Finding[] = [];
  for (const desk of desks.desks) {
    read.add(desk.worktree);
    const previous = states.get(desk.worktree);
    states.set(desk.worktree, desk.process.state);
    const entry = byBranch.get(desk.branch);
    if (entry === undefined) continue;
    const readings = {
      worktree: desk.worktree,
      markers: desk.desk.markers,
      dirty: desk.dirty,
      unpushed: desk.unpushed,
      commitsAhead: entry.readings.realCommitsAhead,
      changeset: changesetReading(entry.changedPaths, CHANGED_PATHS_CAP),
    };
    const pr =
      finalPassDue(previous, desk.process.state) && needsPrAnswer(readings)
        ? await askHost(ports, desk.branch, desk.worktree, 'plot-fleetd')
        : passPrAnswer(entry.readings.pr);
    const line = await writeLine(ports, { branch: desk.branch, worktree: desk.worktree, readings: { ...readings, pr } }, at);
    if (line !== null) written.push(line);
  }
  for (const worktree of [...states.keys()]) if (!read.has(worktree)) states.delete(worktree);
  return written;
};

/** The ports the worker wrapper's final pass reads, writes and asks through. */
export interface FinalPassPorts extends AgentFindingPorts {
  readonly agents: Agents;
  readonly trees: Trees;
  readonly refs: Refs;
}

/** What one final pass is about. */
export interface FinalPassInput {
  /** The branch the agent held. */
  readonly branch: string;
  /** The desk, absolute. */
  readonly worktree: string;
  /** The reading's time, as `monitorTime` prints it. */
  readonly at: string;
  /** The writer the desk log line names. */
  readonly who: string;
}

/** A port answer's value, or `'unknown'`. */
const orUnknown = <T>(result: PortResult<T>): T | 'unknown' => (result.ok ? result.value : 'unknown');

/**
 * Runs one final pass over a desk whose agent ended: reads the desk's marker,
 * dirt, unpushed commits, the commits and changed paths of its `HEAD` against
 * the default branch, and one host `pr-state` where the finding depends on
 * it, and appends the AgentMonitor line where the finding changed.
 *
 * @param ports - the desk files, the worktrees, the refs and the host.
 * @param input - the branch, the desk, the time and the writer.
 * @returns the line written, or `null` where none was; `null` without a host
 *   call where the desk cannot be read.
 */
export const finalAgentFinding = async (ports: FinalPassPorts, input: FinalPassInput): Promise<Finding | null> => {
  const { branch, worktree, at, who } = input;
  const [desk, dirty, unpushed, main] = await Promise.all([
    ports.agents.desk(worktree),
    ports.trees.dirtyPaths(worktree),
    ports.trees.unpushedCommits(worktree, []),
    ports.refs.defaultBranch(),
  ]);
  const [ahead, changed] = main.ok
    ? await Promise.all([ports.refs.commitSubjects(`origin/${main.value}..HEAD`), ports.refs.changedFiles('HEAD', main.value)])
    : [null, null];
  if (!desk.ok) return null;
  const readings = {
    worktree,
    markers: desk.value.markers,
    dirty: orUnknown(dirty),
    unpushed: orUnknown(unpushed),
    commitsAhead: ahead !== null && ahead.ok ? realCommits(ahead.value) : ('unknown' as const),
    changeset: changed !== null && changed.ok ? changesetReading(changed.value, Number.POSITIVE_INFINITY) : ('unknown' as const),
  };
  const pr = needsPrAnswer(readings) ? await askHost(ports, branch, worktree, who) : 'unaskable';
  return writeLine(ports, { branch, worktree, readings: { ...readings, pr } }, at);
};

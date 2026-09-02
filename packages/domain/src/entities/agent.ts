import { z } from 'zod';
import type { Headroom } from './machine.js';
import { isAgentFree } from '../rules/free.js';

/**
 * What the worker process is doing.
 *
 * Six about the process, plus `waiting` and `stalled` about the task: every
 * worker exits 0, so the exit code cannot say whether the work is done.
 */
export const AgentStateSchema = z.enum([
  'running',
  'waiting',
  'stalled',
  'finished',
  'failed',
  'ended',
  'none',
  'elsewhere',
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Whether the agent's identity was declared or inferred.
 *
 * `synthesized` is an Agent whose identity was never written — an entry built
 * from a worktree that has no manifest.
 */
export const AgentIdentitySchema = z.enum(['manifest', 'synthesized']);
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/**
 * A cue on a `running` agent, never a ninth state.
 *
 * Read from the child's CPU rather than the shell's: the loop shell waits on
 * its child and burns near-zero CPU in every case.
 */
export const AgentActivitySchema = z.enum(['working', 'idle', '']);
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

/**
 * The states in which an agent holds a machine slot.
 *
 * Occupancy, not availability: a `waiting` agent is live and blocked on a
 * person, so it occupies a slot and can take nothing.
 */
export const LIVE_STATES: readonly AgentState[] = ['running', 'waiting'];

/**
 * A process working a branch on behalf of a person.
 *
 * Identity: minted — the session id the dispatcher assigns, which fails by
 * nobody minting it. State: derived, so it is re-run rather than stored.
 *
 * Not the branch, the worktree or the pid: each changes while the agent
 * persists.
 */
export interface Agent {
  /** The session id the dispatcher minted — the identity, and the transcript's name. */
  session: string;
  /** Whether a manifest declared this agent, or it was inferred from a worktree. */
  identity: AgentIdentity;
  /** The branch it works; `''` between slices is a real value, not a gap. */
  branch: string;
  /** The path of its desk. */
  worktree: string;
  /** The worker command as launched, verbatim. */
  command: string;
  /** When it launched, ISO-8601. */
  startedAt: string;
  /** The pid recorded at launch — a launch fact, never alone meaning running. */
  pid: string;
  /** The pid this run displaced; `''` on a first dispatch. */
  previousPid: string;
  /** How often this desk's worker was relaunched. */
  relaunches: number;
  /** What the process is doing. */
  state: AgentState;
  /** A cue on `running` only. */
  activity: AgentActivity;
  /** The recorded exit code; null when none was recorded, never inferred. */
  exitCode: number | null;
  /** What a stalled agent left behind in its worktree. */
  dirtyPaths: readonly string[];
  /** The machine's headroom when this agent exited. */
  machineAtDeath: Headroom;
  /** The model, from the transcript; absent when unreadable, never guessed. */
  model?: string;
  /** The context size, from the transcript; absent when unreadable. */
  contextTokens?: number;
  /** The last activity time, from the transcript; absent when unreadable. */
  lastActivity?: string;
}

/**
 * Whether an agent holds a machine slot.
 *
 * The right denominator for the concurrency cap, and the wrong answer to who
 * can take a slice.
 *
 * @param agent - the agent to test.
 * @returns true when the agent is `running` or `waiting`.
 */
export const isLive = (agent: Agent): boolean => LIVE_STATES.includes(agent.state);

/**
 * Whether an agent can take the next unit of work.
 *
 * Derived rather than stored, from the state plus its slice: an agent is free
 * when it is live and either holds no branch or the branch it holds has landed.
 *
 * `running` is not busy — an agent between units, asking for its next slice, is
 * running with no branch and is available. `waiting` is not free — it is live
 * and blocked on a person, so it occupies a slot and can take nothing.
 *
 * **The derivation lives in `rules/free.ts`** and this delegates to it. The rule
 * is what the board's registry reader asks, and every rendered state is a domain
 * property — two implementations of *is this agent free?* is how the entity's
 * answer and the board's would drift on the one word the fleet dispatches on.
 * This signature stays because `auto-dispatch.ts` reads it.
 *
 * Takes the two fields it reads rather than a whole {@link Agent}, so a caller
 * holding a narrower record of the same facts can ask without inventing the
 * rest. The board's registry entry is exactly that: it carries `state` and
 * `branch` with these meanings and its own state vocabulary, which overlaps
 * this one on `running` — the only value this rule tests — but is not equal to
 * it. Widening the parameter lets that caller ask honestly; a cast would have
 * asserted an equality between the two vocabularies that does not hold.
 *
 * @param agent - the agent to test; its state and the branch it holds.
 * @param sliceHasMerged - whether the branch it holds has landed; ignored when
 *   it holds none.
 * @returns true when the agent can be given a slice.
 */
export const isFree = (
  agent: Pick<Agent, 'branch'> & { state: string },
  sliceHasMerged: boolean,
): boolean => isAgentFree({ state: agent.state, branch: agent.branch, sliceHasMerged });

/**
 * Whether a reader can trust this row to say who the agent is.
 *
 * Measured 2026-08-28: 0 manifests against 13 dispatch worktrees, so every
 * agent row this estate renders is synthesized. A row cannot today distinguish
 * *I know who this is* from *I inferred that someone is here*.
 *
 * @param agent - the agent to test.
 * @returns true when a manifest declared this agent.
 */
export const identityWasDeclared = (agent: Agent): boolean => agent.identity === 'manifest';

/**
 * Whether an agent's work needs a person before anything else can proceed.
 *
 * @param agent - the agent to test.
 * @returns true when the agent stopped to ask a question.
 */
export const owesAnAnswer = (agent: Agent): boolean => agent.state === 'waiting';

/**
 * Whether the agent left work behind that has not landed.
 *
 * `finished` is refined by the tree and `failed`, `ended` and `none` are
 * deliberately not: a recorded non-zero exit is a fact the tree cannot soften.
 *
 * @param agent - the agent to test.
 * @returns true when the agent stalled with work in its tree.
 */
export const leftWorkBehind = (agent: Agent): boolean =>
  agent.state === 'stalled' && agent.dirtyPaths.length > 0;

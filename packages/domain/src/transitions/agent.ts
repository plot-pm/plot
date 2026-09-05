import type { AgentState } from '../entities/agent.js';
import { AgentStateSchema } from '../entities/agent.js';
import type { EndingActor } from '../entities/ending.js';

/*
 * AN AGENT'S STATE IS OBSERVED, NOT STATED — so a transition here is a VERDICT
 * on a change that already happened, and carries nothing to write.
 *
 * `DESIGN-plan.md:810`: *"Plan and Story are the only two entities whose state
 * is a stated fact rather than a derived relation."* A plan's transition decides
 * a `## Status` line; a story's decides a frontmatter key. Nothing anywhere
 * writes an `AgentState`: it is re-derived from the process table and the desk
 * on every scan, which is why `Decision` below carries a `from`, a `to` and the
 * source that read it, and no field a caller could persist.
 *
 * The REFUSALS are the shared half, and they keep `transitions/plan.ts`'s
 * shapes: `Precondition`, `RefusalReason`, `Refusal`, `isDecision`,
 * `isRefusal`. A caller that reads one reads them all.
 */

/**
 * Which component's reading produced a state.
 *
 * `DESIGN-agent.md:366` tabulates this per state and CLAUDE.md restates it: the
 * enum carries two kinds of answer and the SOURCE decides which. A state
 * answering *what is the process doing?* is read from the process table; one
 * answering *what does this agent still hold?* is read from the desk.
 *
 * - `worker` — read from the process: the pid answers, or an exit was recorded.
 * - `desk` — read from the tree: a `PLOT-BLOCKED` marker, or unlanded work.
 * - `machine` — read from this machine's worktree list.
 */
export type StateSource = 'worker' | 'desk' | 'machine';

/**
 * Which component reads each of the eight.
 *
 * Transcribed from `DESIGN-agent.md:366`. `finished` is a process fact the desk
 * REFINES — exited 0 **and** the desk is clear — and it is sourced `worker`
 * here because the exit is what makes it reachable at all; the desk only
 * narrows it away from `stalled`.
 */
export const STATE_SOURCE: Readonly<Record<AgentState, StateSource>> = {
  running: 'worker',
  failed: 'worker',
  ended: 'worker',
  none: 'worker',
  finished: 'worker',
  waiting: 'desk',
  stalled: 'desk',
  elsewhere: 'machine',
};

/**
 * Which states each state may become.
 *
 * Transcribed from `diagrams/agent-lifecycle.mmd`, the source of
 * `DESIGN-agent.md` §4's diagram. A state not listed here is not reachable from
 * the key, and {@link observeAgentState} refuses it.
 *
 * `elsewhere` leads nowhere and is reached from nowhere: it is a Machine
 * answer, entered at `[*]` and left only by asking a different machine. The
 * agent it names does not move between states from here — nothing on this
 * machine can see it do so.
 */
const NEXT: Readonly<Record<AgentState, readonly AgentState[]>> = {
  none: ['running'],
  running: ['waiting', 'stalled', 'finished', 'failed', 'ended'],
  waiting: ['running'],
  stalled: ['running'],
  finished: ['none'],
  failed: ['running'],
  ended: [],
  elsewhere: [],
};

/**
 * Who may end a worker.
 *
 * **THE `actor: 'agent'` QUESTION, DECIDED — AND THEN RE-OPENED BY A WRITER.**
 * `entities/ending.ts` admitted three actors and documented the third as *"the
 * agent stopped itself"*, and no caller had ever written it: `write_ending` was
 * called three times in `plot-worker-loop.sh` and passed `monitor` and `bound`
 * only. So `agent` was removed here on 2026-09-04, on the reading the loop's
 * own comment states — *"The actor is the bound either way"*. An agent does not
 * decide to stop; something measures it and stops it, and the ending records
 * that party.
 *
 * **THAT READING HOLDS FOR EVERY ENDING A WATCHER PRODUCED, AND THE FOURTH
 * WRITER IS NOT ONE.** `a-second-slice-needs-its-own-session` added an ending
 * for a prompt whose command exited non-zero WITHOUT RUNNING — measured
 * 2026-09-05, three agents refused `Session ID … is already in use`, each
 * sub-second exit read as a completed slice. No watcher fired: the floor did
 * not expire and the monitor published nothing. The party that acted is the
 * agent's own process, which launched the command and received the refusal, and
 * naming `bound` or `monitor` would claim a measurement neither made.
 *
 * So the premise this removal rested on — *nothing writes it* — is what the
 * fourth `write_ending` call changed, and `agent` is back in
 * `EndingReasonSchema`'s company for that one reason. The narrowing argument
 * survives intact for the other four, which is why this list is three rather
 * than open: {@link endingIsAttributable} still refuses anything else, and a
 * fifth actor still needs a writer before it is admitted.
 *
 * The refusal stays meaningful whatever the enum holds, because a manifest or
 * an ending file read off disk carries a string before it carries a type.
 */
export const ENDING_ACTORS: readonly EndingActor[] = ['bound', 'monitor', 'agent'];

/**
 * A fact a transition needs but cannot measure — supplied by a caller.
 *
 * The same shape `transitions/plan.ts` and `transitions/story.ts` use, and for
 * the same reason: an agent's state lives in the process table and on a desk,
 * and the domain reaches neither.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why an agent transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-unrecognised'
  | 'state-terminal'
  | 'state-unreachable'
  | 'state-unchanged'
  | 'source-mismatch'
  | 'ending-self-attributed'
  | 'ending-actor-unrecognised'
  | 'manifest-not-registry-written'
  | 'elsewhere-has-a-worktree'
  | 'elsewhere-not-observable'
  | 'precondition-unmet';

/**
 * A refused transition, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The agent the refusal is about, by session id. */
  readonly session: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that holds: the state observed, and which component read it.
 *
 * **Carries nothing to write**, unlike `transitions/plan.ts`'s decision. An
 * agent's state is derived on every scan, so a decision that named a field to
 * persist would invent a record no component keeps.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The agent the verdict is about, by session id. */
  readonly session: string;
  /** The state it held. */
  readonly from: AgentState;
  /** The state it now holds. */
  readonly to: AgentState;
  /** Which component's reading produced `to`. */
  readonly source: StateSource;
}

/** What an agent transition answers: the verdict, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a held transition.
 *
 * @param result - the result to test.
 * @returns true when the transition holds.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the transition.
 */
export const isRefusal = (result: TransitionResult): result is Refusal =>
  result.outcome === 'refused';

const refuse = (session: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  session,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param session - the agent the readings are about.
 * @param preconditions - the readings a caller supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (session: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    session,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

const known = (state: string): state is AgentState =>
  (AgentStateSchema.options as readonly string[]).includes(state);

/** What `observeAgentState` needs beyond the agent's current state. */
export interface ObserveStateInput {
  /** The state now observed. */
  to: string;
  /** Which component read it. */
  source: StateSource;
  /** Readings a caller measured, such as whether the desk was reachable. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether an agent may be observed to move to a given state.
 *
 * Callable alone, because a board must know whether a row's move is legal
 * before rendering it. It is not a permission: {@link observeAgentState}
 * re-checks, because a caller that asked is indistinguishable from one that did
 * not.
 *
 * @param session - the agent's session id.
 * @param from - the state it holds.
 * @param to - the state it would be observed in.
 * @param source - which component read `to`.
 * @returns true when the mechanical gates would pass.
 */
export const agentStateObservable = (
  session: string,
  from: AgentState,
  to: string,
  source: StateSource,
): boolean => !isRefusal(observeAgentState(session, from, { to, source }));

/**
 * Judges a change of agent state that a component has already observed.
 *
 * The legal moves are `diagrams/agent-lifecycle.mmd`, transcribed into
 * {@link NEXT}. Anything else refuses — including a move whose SOURCE does not
 * own the state it reports.
 *
 * **The source gate is the process/desk split, enforced.** CLAUDE.md states
 * that `waiting` and `stalled` are Agent facts read from the desk and that the
 * two kinds sharing one enum *"is not a licence to add a workflow state to the
 * process side"*. `plot-worker-state.sh:46` decides both from the TREE, never
 * from the process — an exited process is a precondition for reading them, not
 * the reason they hold. So a caller reporting `stalled` from the process table
 * is refused, not believed.
 *
 * @param session - the agent's session id.
 * @param from - the state it held.
 * @param input - the state now observed, which component read it, plus any readings.
 * @returns a decision carrying the move and its source, or a refusal naming the
 *   gate that fired: `state-unrecognised`, `state-unchanged`, `state-terminal`,
 *   `state-unreachable`, `source-mismatch` or `precondition-unmet`.
 */
export const observeAgentState = (
  session: string,
  from: AgentState,
  input: ObserveStateInput,
): TransitionResult => {
  if (!known(input.to)) {
    return refuse(
      session,
      'state-unrecognised',
      `'${input.to}' is not an agent state — the eight are ${AgentStateSchema.options.join(', ')}.`,
    );
  }
  const to: AgentState = input.to;

  if (from === to) {
    return refuse(
      session,
      'state-unchanged',
      `agent '${session}' is already '${to}' — nothing moved.`,
    );
  }

  if (NEXT[from].length === 0) {
    return refuse(
      session,
      'state-terminal',
      from === 'elsewhere'
        ? `agent '${session}' is 'elsewhere' — it has no worktree on this machine, so nothing here can observe it move.`
        : `agent '${session}' is 'ended' — nothing is recorded about how it stopped, and a machine that cannot say why cannot say what comes next.`,
    );
  }

  if (!NEXT[from].includes(to)) {
    return refuse(
      session,
      'state-unreachable',
      `agent '${session}' cannot go '${from}' -> '${to}' — from '${from}' it may become ${NEXT[from].join(' or ')}.`,
    );
  }

  if (STATE_SOURCE[to] !== input.source) {
    return refuse(
      session,
      'source-mismatch',
      `'${to}' is read by the ${STATE_SOURCE[to]}, not the ${input.source} — a ${STATE_SOURCE[to] === 'desk' ? 'desk fact is not a process event' : 'process fact is not a reading of the desk'}.`,
    );
  }

  const blocked = unmet(session, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', session, from, to, source: input.source };
};

/** What `endingIsAttributable` needs beyond the agent. */
export interface EndingAttributionInput {
  /** The actor the ending record names, as read — a string, because a file supplies it. */
  actor: string;
  /**
   * The reason the ending record names, as read — a string, for the same reason
   * {@link actor} is one.
   *
   * **THE ACTOR ALONE CANNOT DECIDE THIS.** `agent` is attributable for exactly
   * one reason and self-attributed for every other, so a rule reading only the
   * actor either refuses a legitimate ending or admits an agent claiming it
   * decided its own stop. Absent — an older caller, or a record that named no
   * reason — reads as *not `unstarted`*, which keeps the refusal that was there
   * before this field existed.
   */
  reason?: string;
}

/**
 * Judges whether an ending names a party that may have produced it.
 *
 * **THE NARROW ASSERTION, AND IT NAMES ONE EXIT.** The plan asked for *"an
 * agent cannot end itself on a bound"* and warned that the general claim would
 * refuse nothing. Verified 2026-09-05: four self-exits exist in
 * `plot-worker-loop.sh` and only ONE is this one. `:1296` is `exit 124` reached
 * from the floor and the monitor, and it is the only self-exit that writes an
 * ending at all — `:1179`, `:1402` and `:1404` are a FREE agent's wait budget
 * expiring, where no prompt was running and nothing was cut short.
 *
 * The exit at `:1296` is legal, and this rule says why: the ending it writes
 * attributes itself to the `bound` or the `monitor`, never to the agent. An
 * ending naming `agent` there would be an agent claiming it decided its own
 * stop, and neither watcher's finding is the agent's to claim.
 *
 * **`unstarted` IS THE ONE READING WHERE `agent` IS THE HONEST ANSWER, AND THE
 * REASON IS WHAT SEPARATES THEM.** A prompt whose command exited non-zero
 * without running was ended by no watcher: the floor did not expire and the
 * monitor published nothing. The agent's own process launched the command and
 * received the refusal, so `bound` would claim a clock expired and `monitor`
 * that a finding was published, and both would be false. This is still not an
 * agent DECIDING to stop — it is an agent reporting what its command did — and
 * that is why the pair is checked rather than the actor alone.
 *
 * The check survives every enum change because it reads STRINGS: an ending file
 * on a desk is bytes until something validates them, and a worker of an older
 * vintage may have written a value no type admits.
 *
 * @param session - the agent's session id.
 * @param input - the actor and reason the ending names, plus any readings.
 * @returns a decision that the ending is attributable, or a refusal naming the
 *   gate: `ending-self-attributed`, `ending-actor-unrecognised` or
 *   `precondition-unmet`.
 */
export const endingIsAttributable = (
  session: string,
  input: EndingAttributionInput,
): TransitionResult => {
  if (input.actor === 'agent' && input.reason !== 'unstarted') {
    return refuse(
      session,
      'ending-self-attributed',
      `agent '${session}' recorded itself as the actor that ended it — the party that acts is the bound or the monitor, and the agent's process only runs the exit. Only an 'unstarted' ending names the agent, because no watcher produces that one.`,
    );
  }

  if (!(ENDING_ACTORS as readonly string[]).includes(input.actor)) {
    return refuse(
      session,
      'ending-actor-unrecognised',
      `'${input.actor}' is not an ending actor — the three are ${ENDING_ACTORS.join(', ')}.`,
    );
  }

  const blocked = unmet(session, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', session, from: 'running', to: 'ended', source: 'worker' };
};

/** Which component wrote a manifest, as the caller measured it. */
export type ManifestWriter = 'registry' | 'agent' | 'unknown';

/** What `manifestIsRegistryWritten` needs beyond the agent. */
export interface ManifestWriterInput {
  /** Which component wrote it. */
  writer: ManifestWriter;
  /** Readings a caller measured, such as whether the registry directory was reachable. */
  preconditions?: readonly Precondition[];
}

/**
 * Judges whether a manifest was written by the component that owns it.
 *
 * `DESIGN-agent.md:220` gives the manifest to the Registry and the worktree to
 * the agent — *"identity and desk"*, two halves with two owners and two
 * lifetimes. An agent that wrote its own manifest would be declaring itself,
 * which is the one thing a registry exists to do.
 *
 * The two writers that exist are both the registry's:
 * `plot-dispatch.sh:346`'s `write_agent_manifest` and
 * `packages/board/src/server/manifest-stamp.ts`, whose docstring requires the
 * two stay byte-identical.
 *
 * `unknown` refuses rather than passing. A manifest whose writer nobody
 * measured is not a manifest the registry can vouch for, and *cannot answer* is
 * not *yes*.
 *
 * @param session - the agent's session id.
 * @param input - which component wrote the manifest, plus any readings.
 * @returns a decision that the manifest is the registry's, or a refusal:
 *   `manifest-not-registry-written` or `precondition-unmet`.
 */
export const manifestIsRegistryWritten = (
  session: string,
  input: ManifestWriterInput,
): TransitionResult => {
  if (input.writer !== 'registry') {
    return refuse(
      session,
      'manifest-not-registry-written',
      input.writer === 'agent'
        ? `agent '${session}' wrote its own manifest — the manifest belongs to the Registry and the desk belongs to the agent.`
        : `nobody measured who wrote agent '${session}'s manifest — the Registry cannot vouch for a declaration it cannot place.`,
    );
  }

  const blocked = unmet(session, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', session, from: 'none', to: 'none', source: 'worker' };
};

/** What `elsewhereIsHonest` needs beyond the agent. */
export interface ElsewhereInput {
  /** Whether this machine holds a worktree for the agent. */
  hasWorktreeHere: boolean;
  /** Whether this machine's worktree list could be read at all. */
  worktreesReadable: boolean;
  /** Readings a caller measured. */
  preconditions?: readonly Precondition[];
}

/**
 * Judges whether calling an agent `elsewhere` is honest.
 *
 * `elsewhere` means *no worktree on this machine* — CLAUDE.md calls it the proof
 * that the process is the LINK between an Agent and a Machine rather than a
 * view of either: *"a view of an agent cannot be somewhere the agent is not."*
 *
 * Two refusals, and they fail in opposite directions. An agent WITH a desk here
 * is answerable here, so `elsewhere` would hide a row a reader can act on. An
 * agent whose worktrees could not be listed at all is `unknown` — the
 * registry's ninth — and reporting it `elsewhere` would claim a machine was
 * asked and said no, when nobody looked.
 *
 * @param session - the agent's session id.
 * @param input - what this machine's worktree list said, plus any readings.
 * @returns a decision that `elsewhere` holds, or a refusal:
 *   `elsewhere-has-a-worktree`, `elsewhere-not-observable` or
 *   `precondition-unmet`.
 */
export const elsewhereIsHonest = (
  session: string,
  input: ElsewhereInput,
): TransitionResult => {
  if (!input.worktreesReadable) {
    return refuse(
      session,
      'elsewhere-not-observable',
      `this machine's worktrees could not be listed, so agent '${session}' is unknown rather than elsewhere — nobody looked.`,
    );
  }

  if (input.hasWorktreeHere) {
    return refuse(
      session,
      'elsewhere-has-a-worktree',
      `agent '${session}' has a desk on this machine — 'elsewhere' means no worktree here, and a row that can be answered here must be.`,
    );
  }

  const blocked = unmet(session, input.preconditions ?? []);
  if (blocked) return blocked;

  return { outcome: 'decided', session, from: 'none', to: 'elsewhere', source: 'machine' };
};

/**
 * What a reader measured of one agent when it asked which branch the registry
 * handed it.
 *
 * THREE FACTS, ALL ALREADY HELD. `session` is the id the registry wrote the
 * manifest under, `state` is the process reading the pulse refreshes, and
 * `branch` is the manifest field the worker loop writes. Nothing is fetched for
 * this question: the whole rule is that the hand-over was already observable
 * and no row had read it.
 *
 * `state` IS A PLAIN STRING, the choice {@link AgentReading} makes for the same
 * reason. Two vocabularies spell this fact — the domain's eight process states
 * and the board registry's — and they are not equal, so a caller holding either
 * answers honestly and neither is cast into the other's enum.
 */
export interface HandedReading {
  /** The agent's registry session, as its manifest names it. */
  readonly session: string;
  /** The process reading — `running` or `waiting` while a worker is live. */
  readonly state: string;
  /** The branch its manifest names, or `''` while it holds none. */
  readonly branch: string;
}

/**
 * The two states in which a worker is live.
 *
 * NAMED HERE RATHER THAN IMPORTED, because the board's `LIVE_STATES`
 * (`packages/board/src/contract/schema.ts`) is the same pair and the domain may
 * not import the board — the layering rule points inward. The agreement between
 * the two lists is held by a test rather than by a type, which is the contract
 * this package already states for every duplicated rule.
 */
const LIVE = ['running', 'waiting'];

/**
 * The sessions of the live agents the registry handed `branch` to, sorted.
 *
 * **`running` and `waiting`, because those are the two the board puts in
 * WORKING.** `workingAgentRows` shows exactly those agents, whether or not the
 * desk holds the branch, so a row derived from this rule agrees with the
 * section its agent appears in. Every other state means no worker is on the
 * branch now: `failed`, `ended` and `finished` each stopped, and `stalled`
 * holds unlanded work with no process behind it.
 *
 * **The empty branch joins to nothing.** A free agent names `''`, and so does
 * every row with no branch, so a plain equality test would hand every free
 * agent to every branchless row. `''` is a real value here, not a gap, and the
 * rule refuses it the way `workingAgentRows` does.
 *
 * **Sorted, and the order is the contract.** Two agents handed one branch is a
 * fault a person reads, so the pair must print the same way twice; the registry
 * directory's order is the filesystem's and is not one.
 *
 * DERIVED, NEVER STORED. A hand-over flag written beside the manifest would
 * need clearing by whoever takes the branch up, and an agent that died between
 * the two would read as holding work nothing is doing.
 *
 * @param branch - the branch a reader is asking about.
 * @param agents - what was measured of every agent in the registry.
 * @returns the matching sessions, sorted; `[]` when none match.
 */
export const handedTo = (branch: string, agents: readonly HandedReading[]): readonly string[] => {
  if (branch === '') return [];
  return agents
    .filter((agent) => LIVE.includes(agent.state) && agent.branch === branch)
    .map((agent) => agent.session)
    .sort();
};

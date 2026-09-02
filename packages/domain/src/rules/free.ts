/**
 * What a reader measured of one agent when it asked whether it can take work.
 *
 * TWO FACTS, BOTH ALREADY HELD. `state` is the process reading the registry
 * refreshes every pulse; `branch` is the manifest field the worker loop writes.
 * Neither is fetched for this question and neither is a judgement — the whole
 * rule is that availability was already observable and nobody had derived it.
 *
 * `state` IS A PLAIN STRING, not either package's `AgentState`. Two vocabularies
 * spell this fact: the domain's eight process states and the board registry's
 * five. They overlap on `running` — the only value this rule tests — and are
 * not equal, so a caller holding either answers honestly and neither is cast
 * into the other's enum.
 */
export interface AgentReading {
  /** The process reading — `running` where the pid still answers. */
  state: string;
  /** The branch it holds, or `''` while it holds none. */
  branch: string;
  /**
   * Whether the branch it holds has landed; meaningless when it holds none.
   *
   * TAKEN AS A VALUE, never fetched here. The caller already knows: the board
   * reads it off the pulse the scan published, which paid the host round trip
   * once for the whole fleet rather than once per agent.
   *
   * Silence is not landed. A branch nothing reports as merged reads `false`, so
   * an agent on it is treated as still holding it.
   */
  sliceHasMerged: boolean;
}

/**
 * Whether an agent can take the next unit of work.
 *
 * **Availability is a second question, and the process states do not answer
 * it.** `DESIGN-agent.md:483` names the gap the eight states leave; the two
 * words a reader reaches for are both wrong on their own:
 *
 * - **`running` is not busy.** An agent between slices is running with no
 *   branch and is available. It is also occupied — it holds a machine slot —
 *   so *occupied* and *free* are true of the same agent at once and neither
 *   answer is redundant.
 * - **`finished` is not free.** Its worker exited. Nothing is there to hand
 *   work to, and nothing marks the transition back.
 * - **`waiting` is not free either.** It is live and blocked on a person, so it
 *   holds a slot and can take nothing. The block is the person, not the branch,
 *   which is why a merged slice does not release it.
 *
 * So: **alive, and holding no slice.** A landed slice counts as holding none —
 * the work is on main and the agent has nothing left to do with the branch —
 * which is what lets a fleet reuse an agent before its loop notices.
 *
 * DERIVED, NEVER STORED, AND NEVER READ FROM THE DESK. A `free` flag written
 * somewhere would need clearing by whoever hands over the work, and an agent
 * that crashed between finishing and writing it would be free without saying
 * so. The desk cannot answer either: a clean tree says the agent left nothing
 * behind, not that it has been handed the next brief — and under
 * `an-agent-holds-one-desk` the desk outlives the slice, so it says even less.
 *
 * @param reading - what was measured of the agent.
 * @returns true when the agent can be given a slice.
 */
export const isAgentFree = (reading: AgentReading): boolean => {
  if (reading.state !== 'running') return false;
  return reading.branch === '' || reading.sliceHasMerged;
};

/**
 * Why this agent is not free, in a sentence a log or a row can print — or `''`
 * when it is.
 *
 * **IT ASKS {@link isAgentFree} FIRST** rather than re-deriving the negative,
 * so the word and its explanation cannot describe different agents.
 * `freeAgentLabels` already learned that lesson for the count; this is it for
 * the single agent. Restating the conditions was tried and was wrong within
 * one test: a running agent whose slice has LANDED is free and still names a
 * branch, so a `branch !== ''` arm read *holds feature/x* about an agent the
 * rule had just called available.
 *
 * @param reading - what was measured of the agent.
 * @returns the reason, or `''` when the agent is free.
 */
export const whyNotFree = (reading: AgentReading): string => {
  if (isAgentFree(reading)) return '';
  if (reading.state === 'waiting') return 'blocked on a person';
  if (reading.state !== 'running') return `not running — ${reading.state}`;
  return `holds ${reading.branch}`;
};

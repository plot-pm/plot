/**
 * `@plot-pm/fleet` — the supervisor tick and the agent loop, the two clocks
 * that spawn processes the domain only reads.
 *
 * Every current caller imports a subpath (`@plot-pm/fleet/shared/*`,
 * `@plot-pm/fleet/server/entry/*`) rather than this barrel, so it stays
 * narrow: re-exporting the one shape the board's contract re-exports in turn,
 * `AgentStateSchema`/`AgentIdentitySchema` and their inferred types.
 */
export { AgentStateSchema, AgentIdentitySchema } from './shared/agent-wire.js';
export type { AgentState, AgentIdentity } from './shared/agent-wire.js';

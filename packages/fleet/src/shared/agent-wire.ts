import { z } from 'zod';
import { AgentStateSchema as DomainAgentStateSchema } from '@plot-pm/domain';

/**
 * How the registry answers *is this agent still running?* — one fact per pulse.
 *
 * The domain's eight, plus `unknown`. Six describe the PROCESS — `running`,
 * `finished`, `failed`, `ended`, `none`, `elsewhere` — and two the TASK:
 * `waiting` where a `PLOT-BLOCKED:` marker sits in the tree, `stalled` where
 * uncommitted or unpushed work is on the floor with no PR. Every worker exits 0,
 * so the exit code cannot say whether the work is done and the tree refines
 * `finished`.
 *
 * BUILT FROM {@link DomainAgentStateSchema} rather than restated, so the two
 * cannot drift. This enum carried five members until 2026-09-04 and collapsed
 * `failed`, `ended`, `none` and `elsewhere` into `unknown` — answers
 * `plot-worker-state.sh` already gave and `bashLiveness` already received. The
 * four name different next moves: a recorded non-zero exit is a worker to look
 * at, an absent record is a worker that never ran, and one worktree away is a
 * question this machine cannot answer at all.
 *
 * `unknown` is the registry's OWN state and not a ninth shell answer. It means
 * the board could not ask: the resolver threw, the answer count did not match
 * its batch, or the entry names no worktree to look in. Three absences sit side
 * by side and none may be read as another — `none` is *a record says no
 * worker*, `elsewhere` is *no worktree on this machine*, `unknown` is *nobody
 * looked*. Absent is not a guess, which is why a stale record can never
 * masquerade as a live one.
 *
 * DEFINED IN THE FLEET, NOT THE BOARD'S CONTRACT. `registry.ts` is the only
 * caller, and the contract re-exports this so the board's 53 importers of
 * `AgentState`/`AgentStateSchema` need no change.
 */
export const AgentStateSchema = z.enum([
  ...DomainAgentStateSchema.options,
  'unknown',
]);
export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Whether an agent's identity was declared or inferred — the fleet's copy of
 * the domain's `AgentIdentitySchema`.
 *
 * A COPY BECAUSE THE CONTRACT PACKAGE IMPORTS NO DOMAIN, the same reason every
 * other entity on the board's wire restates its shape. The two are one enum in
 * two places and the values are the domain's; `identityWasDeclared` is the rule
 * and lives there.
 *
 * DEFINED IN THE FLEET, NOT THE BOARD'S CONTRACT. `registry.ts` is the only
 * caller here, and the contract re-exports this so the board's importers of
 * `AgentIdentity`/`AgentIdentitySchema` need no change.
 */
export const AgentIdentitySchema = z.enum(['manifest', 'synthesized']);
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

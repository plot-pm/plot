import { type AgentEntry, type AgentRow } from '../../../contract/schema.js';

/**
 * One WORKING row per registry entry, joined to a branch row where one exists.
 *
 * WORKING RENDERS FROM THE REGISTRY, not from the branch rows —
 * `the-working-section-shows-every-worker`, wave 1 (Shown). A worker in a
 * worktree is a fact about the FLEET; its branch's state is a fact about the
 * WORK. The section used to derive the first from the second — a worker
 * appeared only where the pulse produced a row for its branch AND `classify`
 * put that row in WORKING — and both fail routinely for reasons that have
 * nothing to do with the worker: a scratch branch the estate does not name, the
 * branch the board is served from, a branch that merged into DONE. So 23 agents
 * could exist while the section rendered none.
 *
 * This iterates the REGISTRY and joins BACK: every entry becomes a row, and
 * where a branch row carries the same branch the entry carries what that row
 * knows — plan, wave, PR, git state. Where none does the row is null, and the
 * caller states only what the registry knows: branch, worktree, state. **Absent
 * is not false** — a null row says nothing about a plan the entry cannot name
 * rather than inventing an empty one.
 *
 * The join NEVER rewrites the row. A merged branch keeps its own row in DONE —
 * a true statement about the work — while the worker row it joins to sits in
 * WORKING — a true statement about the fleet. Both hold at once; this returns
 * the pairing and moves nothing.
 *
 * `rowByBranch` is passed in rather than built here because the caller already
 * holds every row of every section and builds the map once per pulse; a `find`
 * per agent would re-scan the fleet for each of the twenty-odd entries.
 */
export function workingAgentRows(
  agents: AgentEntry[],
  rowByBranch: Map<string, AgentRow>,
): { agent: AgentEntry; row: AgentRow | null }[] {
  return agents.map((agent) => ({
    agent,
    // The EMPTY BRANCH joins to nothing. An agent between branches carries
    // `branch: ''`, and a release or idea row can carry `branch: ''` too — a
    // join on the empty string would attach an unrelated row's plan and PR to a
    // worker that holds neither. Empty is a real value the map must not resolve.
    row: agent.branch ? rowByBranch.get(agent.branch) ?? null : null,
  }));
}

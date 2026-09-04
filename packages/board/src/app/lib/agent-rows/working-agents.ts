import { isLiveState, isBrokenState, type AgentEntry, type AgentRow } from '../../../contract/schema.js';

/**
 * One WORKING row per LIVE registry entry, joined to a branch row where one
 * exists.
 *
 * WORKING RENDERS THE WORKERS THAT ARE WORKING — `working-lists-the-live-agents`.
 * A worker in a worktree is a fact about the FLEET; its branch's state is a fact
 * about the WORK. `the-working-section-shows-every-worker` inverted an older,
 * branch-derived section so a live worker was never hidden by its branch's row
 * being absent, scratch, or merged. But it kept EVERY registry entry, and a
 * registry entry for a session that has ENDED is not a worker: `stalled`,
 * `finished` and `unknown` entries appeared in a section whose subject is *who
 * is working*, so a reader was told sixteen agents were working when four were.
 *
 * So this filters to {@link isLiveState} FIRST — `running` and `waiting`, the
 * dispatcher's own {@link LIVE_STATES} — then iterates the survivors and joins
 * BACK: each becomes a row, and where a branch row carries the same branch the
 * entry carries what that row knows — plan, slice, PR, git state. Where none does
 * the row is null, and the caller states only what the registry knows: branch,
 * worktree, state. **Absent is not false** — a null row says nothing about a
 * plan the entry cannot name rather than inventing an empty one.
 *
 * The filter is a DENYLIST via `isLiveState`, not an allowlist: an unrecognised
 * tenth state — an older board reading a newer registry — renders rather than
 * vanishes, because a worker nobody can see is the worse failure and the one
 * this change exists to fix. A `stalled`, `failed` or `unknown` entry is not
 * lost; it reaches WAITING ON YOU as a problem report, where its subject —
 * *needs a person* — belongs.
 *
 * The join NEVER rewrites the row. A merged branch keeps its own row in DONE —
 * a true statement about the work — while a live worker row it joins to sits in
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
  return agents
    .filter((agent) => isLiveState(agent.state))
    .map((agent) => ({
      agent,
      // The EMPTY BRANCH joins to nothing. An agent between branches carries
      // `branch: ''`, and a release or idea row can carry `branch: ''` too — a
      // join on the empty string would attach an unrelated row's plan and PR to
      // a worker that holds neither. Empty is a real value the map must not
      // resolve.
      row: agent.branch ? rowByBranch.get(agent.branch) ?? null : null,
    }));
}

/**
 * One WAITING ON YOU row per BROKEN registry entry — a problem report for an
 * agent that stopped and needs a person.
 *
 * A PROBLEM REPORT, NOT A WORKER. `stalled` is work on the floor with no PR,
 * `failed` is a recorded non-zero exit, and `unknown` is a question the board
 * cannot answer. All three say *go look at this* — exactly what WAITING ON YOU
 * exists to say. `finished` is not included: the work reached review, and the PR
 * carries it. Neither are `ended`, `none` and `elsewhere`: each says no worker is
 * here, and an agent with no process is not a problem report.
 *
 * THE COMPANION TO {@link workingAgentRows}, and the split is `isBrokenState`.
 * An entry reaches WORKING iff `isLiveState` is true, and WAITING ON YOU iff
 * `isBrokenState` is true. Four states are neither — `finished`, `ended`, `none`
 * and `elsewhere` — so they appear in neither section. That is correct: a
 * finished entry drains through reconciliation and needs no row of its own while
 * its PR still does, and the other three say only that no worker is here.
 *
 * Joined to a branch row by the same rule as `workingAgentRows`: where a branch
 * row carries the same branch the entry holds, the row's facts (plan, slice, PR,
 * git state) travel with it. Where none does, the row is null and the caller
 * states only what the registry knows. The empty branch joins to nothing.
 */
export function brokenAgentRows(
  agents: AgentEntry[],
  rowByBranch: Map<string, AgentRow>,
): { agent: AgentEntry; row: AgentRow | null }[] {
  return agents
    .filter((agent) => isBrokenState(agent.state))
    .map((agent) => ({
      agent,
      row: agent.branch ? rowByBranch.get(agent.branch) ?? null : null,
    }));
}

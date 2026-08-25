import { isLiveState, type AgentEntry, type AgentRow } from '../../../contract/schema.js';

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
 * entry carries what that row knows — plan, wave, PR, git state. Where none does
 * the row is null, and the caller states only what the registry knows: branch,
 * worktree, state. **Absent is not false** — a null row says nothing about a
 * plan the entry cannot name rather than inventing an empty one.
 *
 * The filter is a DENYLIST via `isLiveState`, not an allowlist: an unrecognised
 * sixth state — an older board reading a newer registry — renders rather than
 * vanishes, because a worker nobody can see is the worse failure and the one
 * this change exists to fix. A `stalled` or `unknown` entry is not lost; it
 * reaches WAITING ON YOU as a problem report (a separate wave), where its
 * subject — *needs a person* — belongs.
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

# Juror: the operator reading the board

Looked at: both plans on `origin/main` (`5da3e923`), #1150, `fleet.ts`, `rows.tsx`, `working-agents.ts`, `AgentList.tsx`, `sections.ts`, `schema.ts`, `plot-fleet-scan.sh`, one `/api/fleet` read (three free agents, nothing handed).

Position: amend

## Claims checked

- `fleet.ts:4096` `function classifyGroup(` — true.
- `fleet.ts:4787` `if (verdict === 'eligible') return { group: 'not-started', note: ELIGIBLE_NOTE };` — true.
- `fleet.ts:5054` `return { group: 'not-started', note: unstarted };`, `unstarted` being `'claimed elsewhere'` for `elsewhere` (`:5036`) — true.
- `plot-fleet-scan.sh:1936` `worker_of()` answers `elsewhere` with no worktree — true.
- `rows.tsx:1092` — **false.** `soleRow ? soleNote : (… || 'approved — nobody has taken it')`: a sole row renders its own note. The observed text is `ELIGIBLE_NOTE` (`schema.ts:1563`) plus NOT STARTED's section hint (`sections.ts:43`).

## What the operator sees after the change

WORKING renders registry agents, not branch rows (`AgentList.tsx:1028-1034`, `1413-1433`; `working-agents.ts:40-55`). The moved row is never drawn itself. It leaves NOT STARTED, and its note appears under the agent's `RegistryRow` (`rows.tsx:2450`). So the agent appears once. But the note `handed to agent 334b3492 — not taken up yet` sits beside a link labelled `334b3492` (`rows.tsx:2383`), on that agent's own row. Today that agent row already reads `eligible — nobody has taken it` inside WORKING. The plan never mentions this.

## Required changes

1. Correct the Motivation (`rows.tsx:1092`), and name the render path: the note appears through `RegistryRow`. Drop the session from the note (`handed over — not taken up yet`).
2. Scope the browser test. The session prefix already renders in WORKING, so that assertion passes today. Assert on the `[data-agent-row]` note cell, and assert that NOT STARTED holds no row for the branch. A page-wide `not.toContain('nobody has taken it')` fails whenever NOT STARTED's hint renders.
3. Cover the time after the quiet window. After 30 min (`fleet.ts:102`), a held empty claim with no visible worker becomes a WAITING ON YOU orphan (`:5059-5089`). `withHandOver` skips that group. The branch then appears as orphaned in WAITING ON YOU while its agent is in WORKING. That shows the slice twice and misses #1150's "whether or not the branch carries a commit". Lift that row too, or state the bound and the reason.
4. Specify the dead agent. The row falls back to `claimed elsewhere` or the orphan. A `failed`/`stalled` entry also adds a `brokenAgentRows` row in WAITING ON YOU, so the operator sees two rows. State which rows are expected, and add a unit case: agent `failed` → row unchanged.
5. Double hand-out: `''` makes NOT STARTED say nobody took a slice that two agents in WORKING hold. The operator needs this case most. Give it its own WAITING ON YOU note, or record it as a known gap against #1039/#1152.
6. `LIVE_STATES` (`schema.ts:3407`) puts a `waiting` agent in WORKING. If its desk does not hold the branch, the contradiction remains. Include `waiting`, or justify excluding it.

#1161 does not conflict: a Draft slice leaves `not-started` before `withHandOver` reads it.

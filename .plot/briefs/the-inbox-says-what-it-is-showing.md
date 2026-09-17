## Implementation brief — the-inbox-says-what-it-is-showing (wave: The inbox says what it is showing)

- **Plan (canonical):** `docs/plans/2026-09-17-the-inbox-says-what-it-is-showing.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `docs/the-inbox-says-what-it-is-showing` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

Two changes to `skills/plot-board-setup/SKILL.md`, and **no behaviour change at
all**.

**1 — a step stating what the inbox shows.** The default JQL
(`plot-host.sh:3376`) narrows by **assignee** and by **project**, and adoption
explains neither. Measured on a real repository: the project query returns 10+
open tickets and the default returns 0, with credentials verified. Say both
narrowings, name `PLOT_JIRA_JQL` and what it overrides, and state that an empty
inbox beside open project tickets is the expected reading.

The step is **unconditional** — an operator seeing three tickets deserves to
know it is not the project's whole backlog.

**2 — correct the stale paragraph at `:393-401`.** It says a `Tracker: jira` is
*"recorded but unread"* and *"the inbox will be empty"*. `plot-host.sh` carries
39 Jira references and its header reads *"JIRA ANSWERS when `Tracker: jira` is
declared"*. That sentence gives an adopter a FALSE explanation for an empty
inbox — this plan's own failure, one step earlier.

### Do not

**Do not touch the query.** The default stays byte-for-byte as `#850` left it,
and the plan's one hard gate asserts exactly that. The assignee clause is
deliberate: an inbox is a person's queue.

**Do not add a config key.** `PLOT_JIRA_JQL` exists and already wins.

**Do not add a hint to the board.** The answered-but-empty case renders `none`
and `HOST_ANSWER_HINT`'s type excludes `'answered'` by construction — changing
that is a `feature` plan, named in the Design and filed separately.

### Repo gates

`pnpm test` — the skill sweep requires a `PLOT-UNASKED` line from every skill.

## Implementation brief — a-desk-says-who-owes-it

- **Plan (canonical):** `docs/plans/2026-09-27-a-desk-says-who-owes-it.md` on `main`
- **Approved:** 2026-09-27, jwloka, in-session (round 1 amended; panel at `.plot/panels/2026-09-27-a-desk-says-who-owes-it/`)
- **Branch:** `bug/a-desk-says-who-owes-it` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; CI is the authority
- **Issue:** #1030

One slice, one wave. Nothing waits on it and it waits on nothing. Siblings #1027, #1015 and #1024 share the theme and are out of scope.

### What to build

The supervisor judges every desk each tick and computes a `SupervisionCause` (`packages/domain/src/rules/supervision.ts:130`, nine values). The only consumer is one `write()` to stdout at `packages/board/src/server/entry/registryd-main.ts:960`. `/api/fleet` measured 31,240 bytes, 22 rows, three agents, and no `cause` field anywhere. So an operator cannot tell a desk the fleet will serve (deferred on `no-headroom`, restarted after `no-progress`) from one that needs a person (`budget-spent`). On 2026-09-27 an operator intervened on two such desks: the fleet had already restarted one and correctly deferred the other.

Build the transport: tick → board process → fleet payload → row, and add the owes-a-person mapping as a domain rule. The value already exists; carrying it is the work. The plan is canonical, and this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Shape (2): a sibling field, forwarded like `quietKind`.** The plan names three shapes: a sixth `quietKind` value, a sibling field, or an input to `isBrokenState`. Build (2). `quietKind` (`packages/board/src/contract/schema.ts:3082`) is the precedent: `nullable().default(null)`, and its docstring states the rule to cite: *"FORWARDED, NEVER RE-DERIVED"*. Null means *the tick did not judge this desk*. Null is not a cause. Do not collapse it into `worker-alive` or into "fine".

**No placement change.** Shape (3) is the only shape that moves rows, and the plan gates it on a payload reading that does not exist. The evidence lens measured the group distribution `{"waiting-on-you":1,"done":21}`, and the one WAITING ON YOU row is `changeset-release/main`. A `no-headroom` desk cannot reach WAITING ON YOU in today's code: placement reads `AgentState`, and only `stalled` routes there. Leave `isBrokenState` (`schema.ts:3405`) and `brokenAgentRows` / `workingAgentRows` (`app/lib/agent-rows/working-agents.ts`) unchanged, and cite them in the PR, as the Done-when list requires. **The plan's Changelog line promises *"only the third appears in WAITING ON YOU"*. The Design and Done-when lists overrule it.** Write the changeset to describe what ships: the row names its cause. Do not write that a section changed.

**The mapping is fixed. Put it in the domain as a rule.** The nine-row table in the plan's *The mapping* section is the specification. Write it as a total record over `SupervisionCause`, as an arrow export in `packages/domain/src/rules/`. A total record makes the compiler refuse a tenth cause with no answer, and `registryd-main.ts:895` uses the same pattern for holds. Keep the type at nine values. Only three have ever fired (`no-progress` 1200, `no-headroom` 1122, `budget-spent` 498), but a narrowed type would refuse a cause the supervisor can legitimately produce. **`no-progress` maps to "no, until the budget is spent"**, and a test names that entry explicitly. It accounts for 60% of all emissions, so this one row decides most rows. If you think the argument is wrong, stop and report. Do not change the entry silently.

**No second computation.** The board must not call `supervise()` or `readTick()` on its own refresh. That is the defect reproduced, and it doubles the per-agent host call the tick already makes (`registryd.ts` TICK comment: 180 host calls an hour at three agents). The daemon produces the cause, and everything downstream forwards it.

### The one mechanism the plan does not settle: crossing the process boundary

The plan writes *"tick → registry → fleet payload → row"*, but `plot-registryd` and the board are separate processes, and today nothing crosses between them. `readSupervisor` (`server/supervisor-reading.ts`) asks only whether the daemon is loaded. The daemon writes no file per tick (`registryd-main.ts` has no `writeFile`), and CLAUDE.md records a `kill -9` test that shows it holds nothing between ticks. Four constraints apply to any channel:

- **The agent manifest is not the channel.** A manifest has one writer (`start_worker`), and the tick "decides and performs nothing" apart from `--start-agents`.
- **`fleet.ts:2175` refuses a persisted verdict**: *"A persisted verdict would be a cache git cannot reach."* A supervision cause is a verdict. A record the daemon writes and the board only reads must therefore carry its tick time, and the board must show the cause's age or drop a stale one. It must never present a stale record as current.
- **One writer.** Only the daemon writes the record. The board reads it and never writes it.
- **Machine-local.** Put it under `.plot/state/`, for the reason receipts live there (`plot-boardctl.sh:83`). A record that travels in a commit is wrong on every other checkout.

The likely shape is a per-tick report that the daemon replaces atomically (`rename`), keyed by branch or desk, plus a board adapter that reads it on refresh beside `readSupervisor`. **Before you write it, check that this does not contradict the `fleet.ts:2175` rule.** If you conclude that it does, stop and write `PLOT-BLOCKED` with the reading. Do not invent a different channel. Whichever channel you choose, the PR states it and names the four constraints above.

### Carried-over rules this repo keeps re-learning

- **Absent is not false.** A missing report, an unparseable one, or a desk the report does not name all produce `null`. None of them produces a cause.
- **The board client casts the fleet and never parses it.** Zod defaults do not apply on the client, so a new `AgentRow` field is `undefined` in the renderer unless the server emits it on every row. The server must emit `null` explicitly.
- **Every rendered state is a domain property.** The row's cause text comes from the domain mapping and is asserted in a unit test. A browser test only proves that the text shows.
- **Domain style:** arrow functions and factual TSDoc in `packages/domain/**`. The reasoning goes in the commit message, not in a 4:1 comment block.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **A test with one producer.** Assert that the cause on a row is the value the tick emitted: use a fake report the board reads, with no `supervise` call on the board side. A test that re-runs `supervise` in the board and compares passes against the defect.
- **An unjudged desk reads `null`.** A desk on another machine (`worker: elsewhere`), or a missing report, gives `null` and not `worker-alive`. This catches "default to fine".
- **A stale report is not current.** A report older than its bound is either shown with its age or dropped. This catches the persisted-verdict failure.
- **`no-progress` has a named test** that asserts it does not owe a person, and that `budget-spent` does.
- **No section changes.** An existing placement test, or a new one, shows that a `no-headroom` desk lands in the same section as before. This catches shape (3) slipping in.

Plus the repo gates: `nvm use` (Node 24; use `corepack pnpm` if the Homebrew pnpm crashes), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds `skills/plot/scripts/board/*.mjs`, so commit the rebuilt artifacts), and `pnpm run typecheck`. Do not run `test:e2e` locally. Add a changeset with the description first and any `bumps:` block last: `'@plot-pm/board': patch`, plus `'plot'` only if a shipped skill file changes. A new `/api/*` write route is not expected. If you add one, it must join `write-gate.test.mjs`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, change the plan's heading to `### A desk says who owes it (Branch: bug/a-desk-says-who-owes-it, PR: #N)`. This plan uses the waves heading form, so a trailing `→ #N` parses as `prs=[]`. Make that edit on `main` from a detached scratch worktree.

### Scope guard

This branch owns:

- `packages/domain/src/rules/` (the new mapping rule and its test; `supervision.ts` only if the cause export needs a touch)
- `packages/board/src/server/entry/registryd-main.ts` and `registryd.ts` (emit the report)
- a new board-side reading beside `server/supervisor-reading.ts`, and its join in `server/fleet.ts`
- `packages/board/src/contract/schema.ts` (one `AgentRow` field)
- the row renderer that shows the cause
- the rebuilt `skills/plot/scripts/board/*.mjs`

It does not touch `isBrokenState`, `working-agents.ts` placement, the reaper, `plot-dispatch.sh`, or any controller verb.

Other branches in flight, verified 2026-09-27 against `origin/main` at `e99fcf0a`: the only open PR is #978 (`changeset-release/main`). The only unmerged remote branch that touches these files is `feature/one-monitor-watches-the-slice` (`schema.ts`, `registry.ts`). Its last commit is from 2026-09-06 and it has no PR, so a collision is unlikely but possible if it is revived.

If you find something the plan did not anticipate, report it. Do not improvise outside scope.

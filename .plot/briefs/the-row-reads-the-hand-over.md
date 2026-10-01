## Implementation brief — a-handed-slice-reads-as-taken

- **Plan (canonical):** `docs/plans/2026-10-01-a-handed-slice-reads-as-taken.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-row-reads-the-hand-over` (base: `main`)
- **Ends as:** one PR to `main`. Open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- **Review of the code:** a person reviews the PR. Issue #1150.

The plan has one slice. Nothing waits on this branch, and it waits on nothing.

### What to build

Issue #1150, measured 2026-10-01 on `localhost:7777`: WORKING listed agent `334b3492` on `bug/the-rule-names-a-usage-limit` from its manifest. The same slice's row in NOT STARTED read `eligible · approved — nobody has taken it · 0m`, with the agent's activity dot beside it. `bug/a-closed-sprint-stops-filtering` and `bug/the-merge-subject-is-one-rule` showed the same contradiction. A free agent reads its manifest once every 60 s (`plot-worker-loop.sh`). Until it does, no worktree holds the branch, so `worker_of` (`plot-fleet-scan.sh:1936`) answers `elsewhere`. Then `classifyGroup` (`fleet.ts:4096`) answers one of three:

- `open` → NOT STARTED with `ELIGIBLE_NOTE` (`fleet.ts:4787`).
- `claimed` inside the 30-minute quiet window → NOT STARTED `claimed elsewhere` (`fleet.ts:5053-5054`).
- `claimed` past the window → WAITING ON YOU as an orphaned claim (`fleet.ts:5059-5096`). The round-1 skeptic reproduced this one at 45 minutes.

Two new pieces close the gap:

1. **`handedTo(branch, agents)`** in `packages/domain/src/rules/handed-to.ts`. It returns the sorted sessions of the agents whose `state` is `running` or `waiting` and whose `branch` equals `branch`. It returns `[]` for an empty branch. Export it from `packages/domain/src/index.ts` beside the other `rules/*` lines. Write it as an arrow function: the domain package requires arrows.
2. **`withHandOver(rows, agents)`** in `packages/board/src/server/fleet.ts` beside `rowsFromPulse`. It is applied to the result at the one call site (`fleet.ts:7790`), where `entry.agents` is in scope (`:3214` fills it; `:7854` and `:7942` read it). Write it as an arrow, because new board code follows the diff rule.

The plan's Design section has the candidate conditions and the three-row result table. That section is the specification, and this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Do not touch `classifyGroup`.** It reads the scan's readings for one branch, and the registry is not one of them. Its parameter list has 30 positional arguments, and its own comments record six tests broken by one insertion (`fleet.ts:4196-4202`). The rewrite runs after it, at the place where the agents already exist. `rowsFromPulse`'s signature stays unchanged too.

**The orphaned claim moves, not only `not-started`.** All three round-1 jurors required this. A candidate is a row whose `worker` is not `running`/`waiting`, whose `verdict` is not `unapproved`, and which is either `group === 'not-started'`, or the orphaned claim: `state === 'claimed'`, `group === 'waiting-on-you'` and `pr === null`. A `not-started`-only rule leaves the 45-minute case wrong.

**`waiting` counts as live.** `LIVE_STATES` (`schema.ts:3407`) is `running` and `waiting`. `workingAgentRows` (`working-agents.ts:40-55`) puts exactly those agents in WORKING, whether or not the desk holds the branch. The row must agree with the section its agent appears in. Reuse `LIVE_STATES`/`isLiveState` semantics. Do not invent a third list. The domain rule cannot import the board's schema, so it compares the two literal words, and the unit cases hold the agreement.

**Two live agents is a fault for a person, not a no-op.** In that case the row goes to WAITING ON YOU with `handed to <n> agents at once`. The cause of the double hand-out is #1039/#1152, and this slice only reports it.

**The note names no session.** WORKING renders registry agents through `RegistryRow` (`AgentList.tsx:1460`, `rows.tsx:2450`), not branch rows. The note therefore appears beside a link that already shows the session (`rows.tsx:2383`). The exact string is `handed over — not taken up yet`, with an em dash. It is new: `handed to agent` and `not taken up` occur nowhere in `packages/board/src` today.

**Every moved row carries `startability: 'someone-is-on-it'`.** Without it, an `open` row keeps `start-work` from `startabilityVerdict`, and a menu offers to start a slice an agent holds.

**A Draft plan's row never moves.** `withHandOver` skips `verdict === 'unapproved'` (`eligible.ts:107`) whatever the group. #1161's Draft rule (`plan not approved yet — still in review`) wins, because a live agent on a Draft slice is a fault in its own right.

**Leave "Open worker log" alone.** `showsWorkerLog` reads the group only (`menus.tsx:68`), so a handed row offers it. `/api/worker-log` answers `no-worktree` (`worker-log.ts:64`), which is true until the agent checks the branch out.

**No payload field, no schema change.** The client casts the fleet and does not parse it, so a new field would arrive `undefined`. The plan avoids this case: the change uses `group`, `note` and `startability`, which already exist.

Rules carried over unchanged: absence is not falsehood. A row with no matching live agent keeps `classifyGroup`'s answer, so #1090's orphan reading survives every case where the registry says nothing. The empty branch joins to nothing. `workingAgentRows` refuses `''` for the same reason.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **The #1090 locks.** A `not-started` row with no agent on its branch, an orphaned-claim row with no agent on its branch, and a `not-started` row whose agent is `failed` or `finished` all stay unchanged. Without these locks, a `withHandOver` that moves every candidate whatever the registry says passes every positive case.
- **The 45-minute orphan case**, with `ageMinutes: 45` against a 30-minute window. This test catches a rule that moves only `not-started`.
- **The `waiting` agent case.** This test catches a rule that checks `running` only.
- **`verdict: 'unapproved'` with a running agent stays unchanged.** This test catches the collision with #1161.
- **`done`, `quiet`, a claimed WAITING ON YOU row *with* a PR, and a row whose `worker` is `running` all stay unchanged.** These tests catch a rule that moves too much.
- **`handedTo` unit cases** in `packages/domain/test/handed-to.test.ts`, as the plan lists them, including `failed`/`stalled`/`finished`/`ended` → `[]` and two sessions returned sorted. Domain branch coverage is 100% for `src/!(adapters)/**` (`packages/domain/vitest.config.ts:71`). An unreached branch fails `test:coverage`.
- **One browser test, for rendering only.** It stubs a payload whose row already carries `group: 'working'` and the note, plus an `agents` entry with state `running` that names the branch. It asserts that the agent's `[data-agent-row]` note cell reads the note and that NOT STARTED holds no row for the branch. This test cannot catch a server-rule bug, and the unit test exists for that reason. Do not assert on the session prefix: it renders in WORKING already, so that assertion passes today. Bump `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts:628` to *the value at your rebase + 1*. It is 538 at `385d6d7d` and is still 538 on today's `main`.

Plus the repo gates: `nvm use` (Node 24) first. Then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds the artifact) and `pnpm run typecheck`. Do not run `pnpm run test:e2e`, because that gate is CI's. Run `pnpm build:board` before the browser test: browser tests load the built artifact. Add a `.changeset/*.md` with `'@plot-pm/board': patch`, the description first. No `bumps:` block is needed.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. The PR title comes from the slice heading.
- When the PR exists, append `→ #<number>` inside this branch's heading in the plan's `## Slices`, as `(Branch: bug/the-row-reads-the-hand-over, PR: #N)`. A trailing arrow does not parse on a wave heading.
- Do not edit the plan's `State:` line. `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns:

- `packages/domain/src/rules/handed-to.ts`, `packages/domain/test/handed-to.test.ts`, and one export line in `packages/domain/src/index.ts`
- `withHandOver` and its one call in `packages/board/src/server/fleet.ts`
- one board unit test under `packages/board/test/unit/`, one browser test, and the `EXPECTED_TESTS` line
- the rebuilt `skills/plot/scripts/board/board-server.mjs`
- the changeset

It does not touch `classifyGroup`, the menus, the scan, any script or the schema.

The other branches in flight, checked against `origin/main` `b4f6a491` on 2026-10-02:

- `bug/the-merge-subject-is-one-rule` touches `packages/domain/src/entities/fleet.ts`, `plot-fleet-scan.sh` and the board artifact, but none of this branch's board source files. Its artifact conflict resolves by rebuild: take either side, then run `pnpm build:board`.
- `bug/the-draft-rule-reads-every-state` (#1161) has not been claimed yet. It edits `classifyGroup`'s Draft arm. Whichever of the two merges second rebases onto the other and re-runs `pnpm run test:board`.

If you find something the plan did not anticipate, report it. Do not improvise outside scope. One gap is known: no juror ran `withHandOver` through a real `buildBoard` with a stubbed registry. If that path behaves differently from the unit test, write the difference down and do not widen the slice.

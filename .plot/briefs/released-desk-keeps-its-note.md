## Implementation brief — the-ready-line-waits-for-every (wave: Released desk)

- **Plan (canonical):** `docs/plans/2026-10-17-the-ready-line-waits-for-every.md` on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1953 merged
- **Branch:** `bug/released-desk-keeps-its-note` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`plot-review`, required on main)

The sibling slice `bug/ready-line-after-every-bind` already merged as PR #1964 — this branch is independent of it and touches disjoint files (ready line: `packages/board/src/server/index.ts`; this slice: `packages/domain/src/rules/ended-desk.ts`, `packages/board/src/server/ended-desks.ts`, `packages/board/src/server/fleet.ts`).

### What to build

A released free desk's note currently renders nowhere. After a desk's free wait runs out (exit `124`, supervisor's `unreadable` ending, merged slice, clean tree, nothing unlanded, no `PLOT-BLOCKED` question), `endedDeskPlacement` already answers `owesPerson: false` with a note — but `brokenAgentRows` (`packages/board/src/app/lib/agent-rows/working-agents.ts:85`) filters exactly those entries OUT of *Waiting on you*, and nothing puts them anywhere else. The existing browser test (`row-placement-quiet-and-ended-desk.browser.test.ts`) proves only the removal, never a landing. This slice gives the note a landing: a row in *Quiet*.

Three changes, all named by the plan's Design section:

1. **The bound.** `buildFleet` (`packages/board/src/server/fleet.ts:6932`) must read the raw `Worker bound` config key through `readConfigAsync` and pass it through to `withEndedDesks` as `boundSeconds`, replacing the current hardcoded `null` at `packages/board/src/server/ended-desks.ts:51`. Read it ONLY when at least one entry's ending reads `freeWaitEnded` — a fleet with no such desk must spawn no extra config read. Do not use `boundSecondsOf` (`packages/fleet/src/shared/fleet-run.ts:69`): it substitutes `28800` for a `0` value, and the plan's decision is that `0`, an absent key, and anything that isn't a positive integer all pass `null` (note reads "at the wait bound", not "after 0 h").

2. **The section.** `EndedDeskPlacement` (`packages/domain/src/rules/ended-desk.ts`) gains a `section: 'waiting-on-you' | 'quiet'` field, using the literal keys from `packages/board/src/app/lib/agent-rows/sections.ts`. `owesPerson` must be DERIVED from `section` (`section === 'waiting-on-you'`) inside the domain, not set independently — the plan requires the two can never disagree. A released desk's placement answers `section: 'quiet'`.

3. **The row.** Build a new row helper (arrow function, domain package style does not apply here since this is `packages/board`, but any NEW helper you write is still an arrow per the repo-wide convention) that places a registry-sourced agent row in *Quiet* for a desk whose placement reads `section: 'quiet'`, carrying the note. Model it on how `brokenAgentRows` builds *Waiting on you* rows (same file, `packages/board/src/app/lib/agent-rows/working-agents.ts:80-90`) — same join-to-branch-row discipline, same "join never rewrites a row" rule. The row is derived fresh on every build from the desk's files, never persisted, and disappears when the reaper removes the desk — do not cache or store it.

### The decisions the plan settles — do not re-derive them

**Section: Quiet, not Done.** Settled by a 4-juror panel (`.plot/panels/the-ready-line-waits-for-every/panel.md`), 3 of 4 — "estate" argued for placing the note on the slice's merged branch row in *Done*, citing `fleet.ts:4061-4064` ("Merged work is DONE, not quiet"), but lost: a free desk can carry `branch: ''` and join no branch row, so a note placed on a branch row can render nowhere again (the exact defect #1916 reports). The desk is an Agent fact, not a branch fact, and *Done* means the plan transitioned to Delivered — which this desk's ending has nothing to do with. **The operator may still overturn this** — #1916 explicitly left it open — but do not re-litigate it inside this slice; if you think it's wrong, stop and ask rather than silently building *Done* instead.

**`Worker bound` of 0 is `null`, not a literal zero hours.** ROW 2 in `agent-loop.ts:478` only fires the free-wait path for a bound ABOVE 0, so "ended after 0 h" would be a false statement the config can never actually produce through this path — hence the `null`-for-non-positive rule in decision 3 of the plan.

**Absent `Worker bound` is `null`, not the loop's 28800 default.** One juror ("deliverable") argued for defaulting to 28800 since that's the loop's own default; three (estate, contradiction, cost) overruled: the board cannot see the desk's EFFECTIVE bound (a worker can override via `PLOT_WORKER_BOUND`, invisible to the board — see the plan's "Known limitation" paragraph), so presenting a specific number it did not observe would be a fabricated reading. `null` → "at the wait bound" is the honest answer.

**No new board-server test, and no hand-built `ended` fixture.** The plan's done-when requires the catalogue browser test to build its `ended` entry by calling `withEndedDesks` over desk-file fixtures (the same pattern the existing domain and board unit tests already use — see `freeWaitDesk()` helpers in `packages/domain/test/ended-desk.test.ts` and `packages/board/test/unit/ended-desks.test.ts`), NOT by hand-constructing `{ ended: { owesPerson: false, note: '...' } }` the way the CURRENT browser test does at line 90. Hand-setting `ended` only proves the row disappears from *Waiting on you*; it says nothing about whether `buildFleet`'s real wiring (config read → `withEndedDesks` → row placement) actually produces that object. This was flagged as a panel blind spot: "no juror ran the code" — you are the first one to actually exercise the wiring end to end, so if the real wiring doesn't produce what the hand-built fixture assumed, trust the real wiring and fix the row helper, not the test.

### Done when

The plan's `## Done when` for this slice is the specification:

- A domain unit test on `endedDeskPlacement` asserts `section` for each reading, plus the "after 8 h" wording for a bound of `28800` and the "at the wait bound" wording for both `0` and `null`.
- A `withEndedDesks` unit test in `test/unit/ended-desks.test.ts` with the fake `read` proves the bound actually arrives at the placement (not just that `buildFleet` calls something — that the number flows through).
- The catalogue browser test builds its `ended` entry by calling `withEndedDesks` over desk-file fixtures (see above), and asserts the note renders under *Quiet*.
- No new board-server test is added.

Plus, lift these assertions because a naive implementation passes without them:

- A test proving the config read is SKIPPED when no entry reads `freeWaitEnded` (the cost-conscious reason the plan gates the read on that condition — each read is an uncached subprocess, 0.12–0.94 s measured, and `/api/fleet` is polled every 4 s per viewer).
- A test proving `owesPerson` and `section` cannot disagree (e.g. assert `owesPerson === (section === 'waiting-on-you')` holds for every placement the rule can return) — this is what makes the derive-don't-duplicate requirement real rather than aspirational.

Plus the repo's gates: no new board-server test per the plan (keep that scope). The build artifact under `packages/board` (if touched by your changes to `fleet.ts` or `ended-desks.ts`) must not be committed — restore any generated bundle before pushing if a rebuild happened locally. Run the changeset flow only if this needs its own version bump beyond the plan's `plot` version (check whether the plan's own changeset already covers this — ask if unclear rather than guessing).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related unit tests and typecheck for `packages/domain` and `packages/board` plus the gate scripts. The suites named under `CI suites` in the Plot Config run in CI on every PR; do not run them locally as a matter of course.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh`'s shell-growth ratchet does not apply.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, real PR
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (under "Released desk").

### Scope guard

This branch owns:
- `packages/domain/src/rules/ended-desk.ts` (and its test, `packages/domain/test/ended-desk.test.ts`)
- `packages/board/src/server/ended-desks.ts` (and `packages/board/test/unit/ended-desks.test.ts`)
- `packages/board/src/server/fleet.ts` — only the `Worker bound` read and the `withEndedDesks` call site (~line 7153); do not touch unrelated code in this large file
- `packages/board/src/app/lib/agent-rows/working-agents.ts` — the new Quiet-row helper, added beside `brokenAgentRows`
- `packages/board/test/integration/row-placement-quiet-and-ended-desk.browser.test.ts`

The sibling slice `bug/ready-line-after-every-bind` is already merged (PR #1964) and touched only `packages/board/src/server/index.ts` and its test — no overlap with this branch's files. If you find any other in-flight branch touching the files above, report it rather than improvising around it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

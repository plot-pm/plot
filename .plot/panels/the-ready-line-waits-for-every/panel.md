# Panel: the-ready-line-waits-for-every

- **Subject:** `docs/plans/2026-10-17-the-ready-line-waits-for-every.md` (Draft, plan PR #1953, answers #1951 = #1900 + #1916)
- **Lenses:** estate, contradiction, deliverable, cost
- **Commitment:** `Position: proceed | amend | reject`
- **Gate:** all four verdicts committed on the first run (`plot-panel.mjs check`, exit 0)
- **Reconcile:** `unanimous amend estate,contradiction,deliverable,cost`

## Positions

| Lens | Position | Reason |
|------|----------|--------|
| estate | amend | The diagnosis holds; the ready-line test contradicts the deliberate IPv4-failure contract in `port.test.mjs:211-245`, and the existing `boundSecondsOf` maps `0` to 28800. |
| contradiction | amend | The Board-impact comment says "packages/board only" while the Design changes the domain; a new `section` beside `owesPerson` gives two fields for one fact; slice 1's test passes on today's code. |
| deliverable | amend | Slice 1's test passes on the unfixed code by luck; slice 2 has no done-when until its section is chosen. |
| cost | amend | Slice 2 adds one uncached `bash plot-config.sh` spawn per `/api/fleet` poll (4 s per viewer); "a fleet reading" in the browser test reads as a new full board server. |

## What each juror looked at

All four read the plan, the issues and the code, and cited file:line evidence. None ran a test suite or a server. The cost juror measured `plot-config.sh get "Worker bound"` at 0.12 to 0.94 s. Every Motivation claim was confirmed by all four: `index.ts:1089` prints before `bindNext` at `:1092`; `ended-desks.ts:35` attaches `ended` to broken entries only; `working-agents.ts:85` drops `owesPerson: false`; `ended-desks.ts:47` passes `boundSeconds: null`; the browser test hand-sets `ended` at `:88-91`.

## Amendments the panel supports

Uncontested (named by at least one juror, contradicted by none) or majority:

1. **Board-impact comment** (4 of 4): slice 2 also changes `packages/domain/src/rules/ended-desk.ts`.
2. **Changelog note text** (4 of 4): quote the domain's note in full, including "— reaped on the next pass" (`ended-desk.ts:93`).
3. **Slice 1 test** (4 of 4 that the planned test is wrong): "connect over 127.0.0.1 and expect success" passes on unfixed code almost always (`port.test.mjs:247-259` already does it) and fails a runner that cannot bind IPv4, which the board tolerates by design (measured 2026-09-13). Done-when becomes a test that fails on the current code; see disagreement B for the technique.
4. **Slice 1 `tailscale:` comment** (contradiction, estate, cost; uncontested): the comment at `index.ts:1093-1099` says the loopback line "prints first either way"; the slice keeps the ready line before the `tailscale:` line and updates the comment.
5. **Config read** (estate, contradiction, cost; uncontested): read the raw `Worker bound` key with the board's `readConfigAsync`, never `boundSecondsOf` (`fleet-run.ts:69`), which substitutes 28800 for `0`.
6. **Read only when needed** (cost; uncontested): `buildFleet` reads `Worker bound` only when some desk reads `freeWaitEnded`, so a fleet with no such desk spawns no extra `plot-config.sh`.
7. **One field, not two** (contradiction; uncontested, deliverable and estate both name a placement field): `EndedDeskPlacement` gains the section, and `owesPerson` is derived from it in the domain so the two cannot disagree.
8. **Domain unit test** (4 of 4): the section and the "after 8 h" wording are asserted on `endedDeskPlacement`; a `withEndedDesks` unit test with the fake `read` (`ended-desks.ts:31`) proves the bound arrives.
9. **Q2 closed** (4 of 4): the note lasts for the desk's lifetime, derived on every build and never persisted; the reaper removes desk and note in one pass.
10. **Q3 closed** (4 of 4): `0` passes `null`, keeping "at the wait bound"; ROW 2 fires only for a bound above 0 (`agent-loop.ts:478`).
11. **`PLOT_WORKER_BOUND` limitation** (estate, deliverable, cost; uncontested): the loop lets the env var override the config (`worker-loop.ts:2269`); the board names the repository's configured bound, which can differ. State it; do not fix it here.

## Disagreements

**A. Which section holds a released desk (Q1).** Quiet: contradiction, deliverable, cost. Done: estate.

- Estate's case: `fleet.ts:4061-4064` says merged work is Done, not quiet, and a released desk's slice row already sits in `done`; put the note on that row.
- The majority's case: the subject is the desk (an agent row, like `brokenAgentRows`), not the slice's branch row. A free desk can carry `branch: ''` and join no row (`working-agents.ts:89`), so a note on a branch row can render nowhere again, which is the #1916 defect. A note on a branch row also puts an Agent fact on a branch row. Done's hint is "delivered", a plan transition the desk has not made.
- The fleet.ts comment is about a merged BRANCH row prompting "go check whether it died"; an agent row whose note says "reaped on the next pass" answers that prompt rather than raising it.
- **Recommendation: Quiet**, as an agent row built from the registry entry. Estate's objection goes in Notes for the operator.

**B. How slice 1's test is made deterministic.** Seam: deliverable and contradiction (extract the bind chain with an injected listen, release callbacks by hand, assert the ready line follows the last bind). Occupied port: cost (hold `127.0.0.1:<P>` with a `net` server, assert the `could not also bind` warning precedes `Plot board:`). Estate asks only that the test sit in `port.test.mjs` and expect every family not warned about to answer.

- Both techniques fail on today's code. The seam starts no server; the occupied port starts one and exercises the failure path, not the race.
- **Recommendation: the seam unit test as the done-when**, plus the contract estate states for `port.test.mjs` with no new server. The occupied-port test is an acceptable addition, not required.

**C. Absent `Worker bound` key.** `null`: estate, contradiction, cost. 28800 (the loop's default): deliverable.

- An absent key leaves the loop on its default, so 28800 is likely true; but the board cannot see `PLOT_WORKER_BOUND` and a guessed default states a number nobody configured.
- **Recommendation: `null`** for absent, `0` and unparseable values.

**D. Slice 2's browser test.** Catalogue fixture showing the note in Quiet, no new board server: cost, estate. A fleet-fixture-built desk: deliverable; `ended` produced by `withEndedDesks`: contradiction.

- Amendment 8 already proves the reading in unit tests. The browser test is where the result is seen (*Every rendered state is a domain property*).
- **Recommendation:** the catalogue browser test asserts the note in Quiet, with the catalogue's `ended` produced by calling `withEndedDesks` over desk-file fixtures rather than written by hand. No new board-server test.

## What the lenses had in common

All four read code and none executed it. Every claim about the race rests on reading `index.ts` and the issue's container measurement; no juror reproduced `ECONNREFUSED 127.0.0.1` or showed that the seam test goes red on main. The implementing slice owes that run: revert the print move and see the new test fail.

All four also accepted the note's existence as the goal. None asked whether a desk that owes nobody and is reaped on the next pass needs a row at all, or whether the reaper's cadence makes the row visible long enough to matter. #1916 names the brief's requirement, so the panel did not reopen it; the operator can.

## Verdict

**Amend**, unanimous. Apply amendments 1 to 11 and the recommendations under A to D. The plan stays Draft.

# Panel: planning-tab-reads-a-fleet-payload, round 1

- **Subject:** `docs/plans/2026-10-29-planning-tab-reads-a-fleet-payload.md` on `idea/planning-tab-reads-a-fleet-payload` (head `origin/idea/planning-tab-reads-a-fleet-payload`, 2026-10-29)
- **Jurors:** layering, operator, server, testability
- **Commitment:** `Position: proceed | amend | reject`
- **Gate:** all four files committed on the first check; no send-back
- **Reconcile:** `unanimous amend` (layering, operator, server, testability)

## Evidence each juror used

| Juror | Read | Ran |
|---|---|---|
| layering | `App.tsx`, `board.ts`, `fleet.ts`, `PlanSourceLine.tsx`, `discovery-lanes.ts` | `plan-level-row.test.ts` (16/16); an esbuild probe that replays the sprint-modal click handler with the real `planFileFromFleet` and `planFileForSlug` |
| operator | `App.tsx`, `board.ts`, `fleet.ts`, `plot-fleet-scan.sh`, `AgentList.tsx` | a read of the live `.plot/state/last-pulse.json`; a git count of sprint members against plan files; a timeline model on the code's constants |
| server | `index.ts`, `board.ts`, `fleet.ts`, `schema.ts` | a vitest probe of a fresh cache (`at: null` gives `ageSeconds: 0` and `readRefAge: null`); a git count of sprint members against plan files |
| testability | `fleet-state.ts`, `board.ts`, `App.tsx`, the board browser tests | `plan-level-row`, `sprint-members` and `board-grid` (38/38); a probe of `PlanSourceLine` and the catalogue `generatedAt` (2/2) |

No juror ran a browser test or a live board; the brief forbids both. The server juror ran one `git fetch -q origin` in the shared repository, which moved remote-tracking refs only.

## Agreement

**1. Neither answer to Open Question 1 is right (all four).** `/api/board` builds a new board on every request (`fleet-state.ts:196-240`), sets `generatedAt` to the request time (`board.ts:2659`) and re-reads the plan sources each time (`board.ts:2192-2202`). Both options therefore show the time since the last poll, 0 to 30 s. The plans are as fresh as the last `git fetch` of the ref, and only the fleet scan runs that fetch (`plot-fleet-scan.sh:371-385`). `PlanSourceLine.tsx:53-58` already says the line uses the scan age for this reason. The plan's claim that the fleet age "dates a different read" is wrong. The defect is the transport: the scan age reaches Planning only through the Delivery-only poll, and nothing ticks it.

**Fix (all four):** `/api/board` carries one optional field with the scan's ref age in seconds, computed on the server from the `ensureCache` entry's `at`, and `null` before the first scan. The Planning path already warms that entry (`index.ts:493` → `ticketLaneData` → `ensureCache`, `fleet.ts:1703`), the route `#2833` used (`discovery-lanes.ts:81`). The value is filled in `index.ts`, not in `buildBoard`. The page ticks it the way the Delivery footer does (`AgentList.tsx:577-601`): elapsed page time added to a server-sent age, never `Date.now() - <server timestamp>`, which breaks on clock skew for a remote viewer. The age arithmetic is a domain function that takes `nowMs` as a value; the timer stays in the component.

**2. A third cause: a frozen `0s ago` (layering, operator, server).** `buildFleet` returns `ageSeconds: 0` while no scan has finished (`fleet.ts:7506`), and `App.tsx:1524` and `:1537` pass it through. A Delivery visit during a cold server's first scan leaves Planning on `0s ago` for the session. The null rule already exists as `readRefAge` (`schema.ts:4317`, `fleet.ts:7658`).

**3. The sprint-modal fallback is removed, not replaced (all four).** The fallback runs only after the card lookup has failed (`App.tsx:1586`, `:1141`), so a second lookup over the board's cards always returns `''` (testability probe). The board's cards already include plans from the ref, the working tree and branches (`board.ts:2250-2287`), which is everything `fleet.draftPlans` reads. The server already marks a sprint member with no card `known: false` (`board.ts:1645-1654`, `:2652`). Measured over every sprint file on `origin/main`: 16 members name no plan file on the ref or any branch, 0 name a branch-only plan, and the active sprint has none; the fleet fallback finds nothing for all 16. So `planFileFromFleet` leaves the sprint modal. The destination of a sprint item becomes a domain decision with a unit test (layering, operator), and a `known: false` member renders as text with its `?` badge instead of a button that does nothing.

**4. Scope the plan missed (layering, testability).** The sprint modal also opens from the Discovery tab (`App.tsx:1373`, `:1578`), and the fix covers that path. Three doc comments state the fleet source and change in the same slice: `PlanSourceLine.tsx:53-58`, `Board.tsx:151-158`, `App.tsx:1592-1603`.

**5. Open Question 3 is answered (layering).** No other Planning-tab read uses `fleet`.

**6. Citation.** `App.tsx:772` is the visibility handler; the Planning poll is `App.tsx:527-532` (all four).

## Tests the panel names

- **Domain unit:** the age rule (`null` in, `null` out; server age plus elapsed page time; no negative value) and the sprint-item destination rule (card, `known: false`, unknown slug).
- **Board unit:** the new `/api/board` field is `null` on a cold cache and a number after a scan; an absent field parses (older server).
- **Browser:** `page.clock` installed at a fixed time, as `page-hears-channel.browser.test.ts:35-41` does; assert exact strings (`10s ago`, then `15s ago`). Stub `/api/fleet` with an `ageSeconds` the new rule cannot produce (for example 999) and assert it never shows, on a fresh page and after a Delivery visit. A sprint test asserts the destination by name, with a fleet stub that names the slug, so it fails before the fix. `plan-source.browser.test.ts` has nine cases and none checks the age.
- No existing test pins the fleet-sourced age or the fleet fallback, so none has to change.

## Disagreement

None on the position. Two jurors leave one behaviour open and do not agree on it, and the plan does not say it: **what the age does while the board server is unreachable.** The Delivery footer stops its clock in that state (`AgentList.tsx:578-600`, operator). Testability names the gap without proposing an answer.

## What the four lenses shared

All four read the code and none watched a live board, so every timing claim (0-30 s poll age, the frozen `0s ago`) is derived from constants and probes, not observed. All four also assume the Planning path keeps the `ensureCache` entry warm. The server juror traced the call (`index.ts:493`), but no juror checked what that entry holds while a separate `fleetd` process runs the scan and the board only reads its carried pulse. The amended plan should state which process's scan the age dates in that case.

## Raised outside the plan

`entry.at` moves even when the scan's `git fetch` fails (`fleet.ts:2879`). The scan reports `fetch_failed`, the live pulse file drops it, and nothing in `packages/board/src` or `packages/domain/src` reads it. Any age built from `entry.at`, today's included, can report a fresh read that did not happen (operator, server). This is a separate defect and not this plan's scope.

# Juror verdict: layering (rendered state is a domain property; the layering rule)

Position: amend

Evidence: Read the plan, issue #2836 (`gh -R plot-pm/plot issue view 2836`), the #2833 panel's `layering.md`, `packages/board/src/app/App.tsx:526-546, 766-775, 1064-1114, 1141, 1195-1224, 1360-1385, 1517-1541, 1581-1606`, `components/PlanSourceLine.tsx:1-175`, `components/AgentList.tsx:595-600, 875-903, 2734`, `components/Board.tsx:151-172`, `lib/agent-rows/plan-level-row.tsx:92-117`, `contract/schema.ts:1297-1301, 1467-1473, 4282-4330`, `server/board.ts:901-934, 960-995, 2192-2205, 2659, 2823-2950`, `server/fleet.ts:2982-3019, 7494-7506, 7643-7658`, `server/discovery-lanes.ts:32, 81`, `server/controllers/fleet-state.ts:196-255`, `skills/plot/scripts/plot-fleet-scan.sh:380-395`. Ran: `pnpm install --frozen-lockfile` in the worktree; `vitest run --project parallel test/unit/plan-level-row.test.ts` (16/16 pass); a scratch probe (`scratchpad/juror-2836-layering/probe.ts`, bundled with esbuild) that imports the real `planFileFromFleet`/`planFileForSlug` and replays the `App.tsx:1585-1603` chain; `git reflog refs/remotes/origin/main` and `ls -la .git/FETCH_HEAD` on this machine. The probe printed `fresh page (fleet null): stay`, `after Delivery visit: /plan/2026-10-29-x.md`, `board-only lookup: ""`, and `cold fleet.ageSeconds ?? null -> 0`. The reflog shows the scan's `fetch -q --prune origin main +refs/heads/*:refs/remotes/origin/*` entry, and `FETCH_HEAD` had the current minute's mtime.

## (a) Problem statement

- The cited lines are correct at the worktree tree: the guard is `App.tsx:542`, the visibility guard is `:772`, the two `planAgeSeconds={fleet?.ageSeconds ?? null}` props are `:1524` and `:1537`, the fallback is `:1597`, and the age is printed at `PlanSourceLine.tsx:145`. The probe reproduces the two-outcome click at function level.
- One citation is wrong. Approach says the Planning tab "already fetches `/api/board` on its own poll (`load`, `App.tsx:772`)". Line 772 is the visibility handler. The poll is `App.tsx:528-532`.
- One claim inverts the documented design. Motivation says `ageSeconds` "dates a different read from the one the sentence describes". `PlanSourceLine.tsx:53-55` states the opposite: "the scan and this read see the same refs, and the scan is what fetches them, so its age dates this too". The board reads `origin/<default>` with no network (`board.ts:907`, `:997-1000` "resolved WITHOUT the network"). The fleet scan is the fetcher (`plot-fleet-scan.sh:385`), and the reflog on this machine confirms it. So the scan's age is the age of the ref's content; the board's parse is not. The defect is the transport (a Delivery-only poll), not the source of the number.
- A cause is missing. Before the first scan, `buildFleet` sets `ageSeconds` to `0` (`fleet.ts:7506`), so `fleet?.ageSeconds ?? null` prints `0s ago` on a cold cache. `PlanSourceLine.tsx:57-58` forbids exactly that. The fleet payload already carries the null-honest field for this line, `readRefAge` (`schema.ts:4308-4317`, `fleet.ts:7658`), whose doc says it exists so "a consumer reading `readRef` must not have to know that a field named for the tab happens to date it". The current code reads the wrong field as well as the wrong payload.
- The sprint modal is not a Planning-tab component only. `onOpenSprint` is passed to `StoriesTab` (`App.tsx:1373`) and to `StoryModal` (`:1578`), so the same fallback runs from the Discovery tab. The changelog line is still right; the title and Motivation should say "the page" for this half.

## (b) Approach

**Plan age: the plan's two candidate events are one event, and neither is the right one.**

- `generatedAt` is `new Date()` at build time (`board.ts:2659`), and `/api/board` builds on every request (`fleet-state.ts:217-237`; only concurrent calls share a build). The plan sources are also "read fresh this call" (`board.ts:2202`). So "board `generatedAt`" and "when the server last read the plan sources" differ by milliseconds. Both stay under the 30 s board poll whatever the state of the ref.
- With either value, the line says "Plans read from `origin/main` · 12s ago" while the last successful fetch is an hour old. That is the 2026-08-27 drift that `PlanSourceLine.tsx:7-19` exists to expose. The change would remove the line's one job.
- The right event is the scan that fetched the ref, which the server already holds in the cache entry (`entry.at`). `/api/board` already reads that cache: `discoveryLanes` calls `ensureCache(opts)` (`discovery-lanes.ts:81`), and `ensureCache` starts the scan clock (`fleet.ts:3018-3019`). The #2833 fix used the same path. So carry `readRefAge` (or `entry.at`) onto `/api/board`, preferably inside `planSource`, as an optional field that is null before the first scan. No new server read is needed.

**The ticking clock: the arithmetic belongs in the domain; the timer does not.**

- CLAUDE.md "A note on shape" says that the domain "takes readings as values". `setInterval` is a side effect and stays in the page or a hook. The age is a pure function of values and is a domain property: `planSourceAge(serverAgeSeconds: number | null, receivedAtMs: number, nowMs: number): number | null`. It returns null when the server sent null or nothing, and `serverAgeSeconds + floor((now − receivedAt)/1000)` otherwise. A domain unit test asserts "grows with the clock" by passing two `nowMs` values.
- Send an age, not an absolute timestamp. The plan's "a board timestamp and its own ticking clock" subtracts a server time from a browser time. That is correct only when both clocks agree, and a board served beyond localhost (`ideaAvailability(HOST)`, cited in the #2833 panel) need not share one. The Delivery tab already uses age-plus-tick (`AgentList.tsx:595-600`, `:2734` `fleet.ageSeconds + tick`), and `AgentList.tsx:875-880` records what mixing clocks cost there ("next in 0s" permanently).
- Name the frozen case. When `/api/board` stops answering, the age keeps growing from receipt. That is honest (the silence grows). The plan should say so, or say why the line freezes, as `AgentList.tsx:2734` marks `(frozen)`.
- The unit assertion "never reads a fleet payload" is vacuous for a pure function. Its signature carries the guarantee. Only the browser test with a frozen `/api/fleet` stub, or a grep gate, proves that `App.tsx` stops passing `fleet` to the Planning views.

**Sprint modal destination: the plan leaves the decision in the component.**

- The destination (card, file, or stay) is decided inline in the JSX callback at `App.tsx:1585-1603`, and the plan tests it only in a browser (Tests, bullet 3). That is the case that CLAUDE.md "Every rendered state is a domain property" rules out: "a view state that cannot be asserted without a browser is a domain property that has not been extracted yet". Extract `sprintItemDestination(slug, cards) → { kind: 'card', card } | { kind: 'stay' }` (or with a `file` arm if one survives) and assert it in a unit test. The browser test then only proves that the click follows the answer.
- The fallback is most likely dead code once it reads a Planning source. `fleet.draftPlans` comes from `readPlanEstate`, which reads the same `collectPlanSources(origin/<default>)` as the board's cards (`board.ts:2853-2854` against `:2192`). The board additionally reads branch-only plans (`board.ts:960-995`). A branch row's `planFile` names a plan that has a card. So `cards ⊇` every file that the fleet names, apart from poll skew. I read this; I did not measure it against a live estate. If it holds, the smallest fix is to delete the `planFileFromFleet` branch and the `location.assign`, with no new board field. Open Question 2 then closes.
- A slug with no card exists when a sprint file names a plan that is absent, renamed or archived (`App.tsx:1078-1080` handles the sprint-side twin). In that case the fleet knows nothing either. A silent click that does nothing is itself a rendered state. Let the domain answer carry a reason that the modal can show ("no plan named `<slug>` on `<ref>`").

**Layering.** The server change (one optional field) goes in `board.ts`'s `planSource` assembly or beside `discoveryLanes`, through `ensureCache`, like #2833. No controller spawns, and the domain gets two pure functions with no port. "A Decision Reads The Index" is not touched, because neither read is a lifecycle decision and no host is asked.

## (c) Slices

- One branch is acceptable. If the fallback is deleted, the two halves share nothing except the file `App.tsx`. Two small slices (age and destination) would each merge on their own, but splitting is optional.
- Order inside the branch: domain functions with tests, then the optional `/api/board` field, then the `App.tsx` wiring.
- Nothing needs to ship separately first. The `ageSeconds`-is-0-on-a-cold-cache defect closes when the line moves to a null-honest field, so it belongs in this slice.

## (d) Open questions

- **OQ1 (which event):** Neither listed option. Use the scan's fetch age (`readRefAge` / `entry.at`), carried on `/api/board`. `generatedAt` and "last read of plan sources" are the same instant (`board.ts:2659`, `:2202`), and both hide a stale ref.
- **OQ2 (fallback source):** The board's own cards (`planFileForSlug`, `plan-level-row.tsx:92-98`). A new `draftPlans` field on `/api/board` duplicates cards that the board already has (`board.ts:2853-2854`). The only no-card case is a sprint naming a plan that no source holds.
- **OQ3 (other fleet reads):** None. I checked every `fleet` reference in `App.tsx`. `:560`, `:571`, `:801` and `:1215-1224` are gated on `tab === 'delivery'`. `:1264`, `:1416`, `:1449` and `:1456` are comments, and `:1385-1391` is the Delivery branch. `Swimlanes.tsx`, `Board.tsx`, `StoriesTab.tsx` and `SprintModal.tsx` take no `fleet` prop. Only the doc comment at `Board.tsx:151` names "the fleet pulse", and it needs rewording.
- **New questions:** (1) Does the line's age measure the scan's completion or the last successful fetch? A failed fetch (`plot-fleet-scan.sh:385-391`) still completes a scan, so `readRefAge` can be fresh over a stale ref. The board could add a "fetch failed" clause in place of a misleading age. (2) Should `PlanSourceLine.tsx:53-58` and `Board.tsx:151-156` be rewritten in the same slice? Their text says "from the fleet pulse" and becomes wrong.

## (e) Tests

- **Domain unit** (`packages/domain`): `planSourceAge` returns null for null and undefined input, `base + elapsed` for two `nowMs` values, and never a negative value. `sprintItemDestination` returns `card` for a slug with a card and `stay` with a reason for a slug with none, whatever any other input holds.
- **Board unit** (`test/unit`): a `PlanSourceLine` render with `ageSeconds: null` prints no `· …s ago`. No test of this component exists today; `grep -rl PlanSourceLine packages/board/test` finds nothing.
- **Server unit:** `/api/board`'s `planSource` carries null before the first scan and a number after one (with `ensureCache` seeded or stubbed), never `0` on a cold entry.
- **Browser** (`test/integration`): Planning opened with Delivery never visited shows a growing age while a stub serves `/api/fleet` with a frozen `ageSeconds: 999`. Assert that `999` never appears, and that the assertion fails before the fix. One browser test proves that a sprint-item click follows the domain answer.

## Amendments

1. Replace OQ1's two options with the scan's ref age (`readRefAge` or `entry.at`), carried on `/api/board` through `ensureCache` as #2833 did. Delete the Motivation claim that `ageSeconds` "dates a different read", and cite `PlanSourceLine.tsx:53-55`.
2. Name the cold-cache `0s ago` (`fleet.ts:7506` against `PlanSourceLine.tsx:57-58`) as a second cause in Motivation.
3. Specify the age as server-age plus client-elapsed (the `AgentList.tsx:2734` pattern), with no absolute timestamp, through a pure domain function that takes `nowMs` as a value. The timer stays in the page.
4. Extract the sprint-item destination into a domain function and give it a unit test. Answer OQ2 with the board's cards, and delete the `planFileFromFleet` fallback unless a measured estate shows a fleet-named file with no card.
5. State that the sprint modal opens from Discovery too (`App.tsx:1373`, `:1578`). Fix the `:772` poll citation to `:528-532`.
6. Drop the "never reads a fleet payload" unit assertion. Add a server-unit test for the new field and a board-unit test for `PlanSourceLine` with a null age.
7. Rewrite the doc comments at `PlanSourceLine.tsx:53-58` and `Board.tsx:151-156` in the same slice.

# Operator lens: board-api-starts-nothing

Position: amend

Lens: what a person sees on the board when the snapshot is stale, mismatched or missing a field, and whether that person can tell which source the board rendered from.

## Open Questions

1. **S3 or a new row S7.** Add S7 and keep S3 unchanged. S3 is a green `strict` row (story line 148, census S3 reads 0). A changed window breaks the merge-base comparison, and S7 states the page's poll as its own claim. The operator sees no difference either way.
2. **One identity for fleetd and the board.** Read it in fleetd, as recommended, but the plan must name two more consumers. First, `waitingOf` (`packages/board/src/server/fleet.ts:2200-2201`) builds the *Waiting on you* rows from `heldIdentity`, and `heldIdentity` asks only where nothing is held yet (`server-info.ts:216-220` doc). Today `/api/board`'s `serverInfo` refreshes that held value every 60 s (`IDENTITY_TTL_MS`, `server-info.ts:190`). When slice 2 moves `serverInfo` to the snapshot, `identity()` is no longer called on `snapshot`, so `heldIdentity` freezes at its first answer. After a `gh auth switch`, the «Mine» filter (from the snapshot) and the *Waiting on you* rows (from the frozen value) then filter by two different people on one page. Second, an `identity` reading that is `unread` or `failed` must fall back to the board's own TTL read. It must not serve `''`, because `''` turns «Mine» into the "no identity configured" hint (`mine-filter.ts:183-186`) with no error.
3. **The census slice waits for `refs-from-files`.** Agreed for slice 3. The recommendation "merge slices 1 and 2 in either order" is wrong: slice 2's `boardInputsFrom` reads `branchPlans`, `identity` and the new `PlanEntry` fields that slice 1 adds. Merged first, slice 2 does not typecheck, or it answers `unknown` on every request. Set the order to slice 1, then slice 2, then slice 3 after `feature/refs-from-files-adapters`.

## Leftovers

- **S3 poll or S7.** Handled as an Open Question. Close it as S7.
- **One identity read in fleetd for both.** Handled for `serverInfo` only. Add `heldIdentity` (the *Waiting on you* reader) to slice 2's scope, and add a Done-when row: on `snapshot`, after the snapshot's `identity` changes, `/api/fleet`'s waiting rows and `/api/board`'s `server.hostUser` name the same person.
- **Census slice waits for `refs-from-files`.** Handled for slice 3. Correct the slice 1/2 order as above.

## What the plan gets wrong or leaves out

**1. The operator cannot tell which source rendered `/api/board`.** The plan keeps the payload shape. `viewSource` and `snapshotChannel` exist on `/api/fleet` only (`packages/board/src/contract/schema.ts:4696`, `:4878-4885`), and the page renders neither: `grep viewSource packages/board/src/app` returns nothing, and the schema doc says "The board renders nothing from it yet". `generatedAt` (`board.ts:3028`) is the time of the request, so a board on a snapshot that is minutes old shows a fresh time. The board already states where plans came from in `planSource` (`board.ts:3033-3038`, rendered by `Board.tsx:346` and `Swimlanes.tsx:268`) and gives the reason: "a fact a reader needs stated rather than inferred". Change: add to `/api/board` a `servedFrom` value (`snapshot` with `generation` and the `plans` reading's `readAt`, or `own` with the reason for the fallback: `mismatch`, a named `unread` reading, no heartbeat). Render it in the existing plan-source line. Hold it with one parity exception and one test per fallback reason.

**2. Working-tree plans go stale on `snapshot` for the reason the plan gives for `currentBranch`.** `collectPlanSources` (`board.ts:1077-1110`) adds plans from `workingTreePlans(repoRoot, planDir)`, which marks a card `notPushed` (`board.ts:2965`). That read is a file-system read and starts no process, so the spawn inventory does not see it. The plan moves `localOnly` into fleetd's `PlansValue`. A plan written in the checkout makes no ref event, so fleetd has no trigger, and the unpushed card is missing until the next safety-net pass (10 minutes, story line 81). The card the 2026-08-27 measurement added ("five plans were each invisible") disappears again. `behind` (`measureBehind`, `board.ts:1032-1049`, `refs.countBehind`) is also a fact about the checkout. Change: keep `workingTreePlans` and `behind` as board reads on `snapshot` (the plan's own `currentBranch` argument), state which of them starts a process, and name a local-only plan's `plot-plan-meta.sh` parse as a start the S7 fixture must not hold. Add a parity row with one unpushed plan.

**3. The source can flip between requests, and the payloads then differ.** `boardSourceOf` (`packages/domain/src/rules/board-watch.ts:138`) answers per request from the heartbeat, the link and the attached clients. The parity test runs over a fixture where both paths read the same ref. In operation the `own` path reads the ref at the request time and the `snapshot` path reads fleetd's last walk, so a card can change phase backwards and forwards while the heartbeat ages near its bound. Change: add a Done-when row that a `snapshot` → `own` → `snapshot` sequence never shows an older `generation` of the plans than the page has already shown, or state that it can and show finding 1's value so the person sees why.

**4. A failed reading must not render as "no issues" or "no author".** The plan answers `unknown` on `unread` or `failed` for the readings `boardInputsFrom` needs. It does not say that `authors` and `delivered` are among them. A card with `author: ''` (`board.ts:3314` pattern) drops out of «Mine» with no note. Change: list every added field in `boardInputsFrom`'s `unknown` set, and add a test that a `failed` `authors` reading falls back rather than renders empty authors.

**5. `mismatch` is handled and visible only in logs.** On a raised `SNAPSHOT_PROTOCOL`, the board falls back to `own` (the Changelog says so). That is correct and fails closed. With finding 1, the person sees "own: fleetd speaks protocol 2, this board 3" instead of a board that quietly starts processes again.

## The change that matters most

Add a served-from value to `/api/board` and render it in the existing plan-source line (finding 1). Without it, every other failure above (a stale snapshot, a fallback after `mismatch`, a missing reading) reaches the operator as a board that looks current and says nothing about where its cards came from.

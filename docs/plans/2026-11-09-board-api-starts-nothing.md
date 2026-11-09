# The board API starts nothing

> While the board serves fleetd's snapshot, `GET /api/board` renders from the snapshot and starts no process. fleetd fills the readings the board still reads alone (plan issues, design and verification records, challenge rounds, parse errors, parsed idea plans, delivered plan text, plan authors, and the reader's identity), `SNAPSHOT_PROTOCOL` rises with recorded fixtures, and a census row holds the page's 30-second poll at zero.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches

## Changelog

- With fleetd running and a page attached, `GET /api/board` answers from fleetd's snapshot and starts no `git`, `bash` or `plot-plan-meta.sh` process. Without fleetd, the board reads for itself as today.
- fleetd's snapshot carries what the board's plan cards read: each plan's issues, design and verification records, challenge rounds and parse error, the parsed idea plans, the text of delivered plans with their delivery commit, the plan authors and the reader's identity.

Board impact: no change to the plan format, the template, the helper scripts or the `docs/plans` layout. The `/api/board` payload keeps its shape. A board and a fleetd of different builds meet a raised `SNAPSHOT_PROTOCOL`, so the board falls back to its own reads (`mismatch`) until both run the same build.

## Motivation

`board-reads-the-channel` (delivered 2026-11-09) moved the board's pulse onto fleetd's snapshot: `refresh` installs `fleetViewFrom` when `boardSourceOf` answers `snapshot` (`packages/board/src/server/fleet.ts:2991-2999`, `:3010-3044`), and census S3 reads 0 `execve` per minute. Its Serve slice also named `GET /api/board`, but the route still builds the board from the ref on every source:

- `index.ts:489-501` calls `boardAnswer`, which calls `boardState` (`packages/board/src/server/controllers/board-answer.ts:61`).
- `boardState` reads `refsToken` for its in-flight key (`packages/board/src/server/controllers/fleet-state.ts:139-143`, a `refState('both')`) and then calls `buildBoard` (`:196-241`).
- `buildBoard` lists the refs again through `heldRefsFor` (`packages/board/src/server/board.ts:328-341`, `readRefSnapshot`), resolves the default branch (`:1193-1203`, `:2509`), reads the plan files from `origin/<default>` and resolves `origin/<default>^{commit}` (`:1093`, `:2518`), reads the sprint files from the ref (`:1920`), resolves the default tip for the idea-plan cache key (`:1337`), and parses every new blob with one `plot-plan-meta.sh` (`:2655`).
- `serverInfo` reads the checkout's branch on a 5-second TTL (`packages/board/src/server/server-info.ts:73`) and the identity on a 60-second TTL (`:191`, `:200-214`): `plot-host.sh account` and `git config user.email`.

On the sprint head this is about 5 `git` processes per request: two `for-each-ref`, the `rev-parse origin/main^{commit}`, and two more, plus the identity read once per 60 s. The page polls `/api/board` every 30 s (`POLL_MS`, `packages/board/src/app/App.tsx:53`), and every channel event makes it refetch (`packages/board/src/server/channel-events.ts:13-14`).

`board-reads-the-channel` left this open in its Open Question 2: the S3 window attaches an SSE client and sends no `GET /api/board` (`packages/fleet/test/census/board.census.test.ts:137-175`), so "a zero in S3 therefore does not prove that `/api/board` starts nothing", and "a person decides whether S3's definition changes".

The route cannot render from the snapshot today because the snapshot lacks what the cards read. `PlanEntrySchema` (`packages/domain/src/entities/snapshot.ts:108-132`) holds the `PlanRecord` fields, and `buildBoard` also reads from `plot-plan-meta.sh`'s output:

| The board reads | Where | In the snapshot |
|---|---|---|
| `issues` | `board.ts:2822`, `:3171` | no |
| `design_raw` | `board.ts:1579`, `:2970` | no |
| `verified_raw` | `board.ts:2860` | no |
| `rounds` | `board.ts:2877`, `:3175` | no |
| a plan file that does not parse (`error`) | the error card | no: `plan-store-shell.ts:242` drops the row |
| parsed idea plans | `readBranchPlans`, `board.ts:1245`, cached at `:1315-1351` | raw text only (`ideaPlans`, `fleet-scan.ts:976-977`) |
| a delivered plan's text and delivery commit | `board.ts:2652-2670`, `refs.recordCommit` at `:2667` | no |
| plan authors | `refs.planAuthors`, `board.ts:2754-2755` | no |
| the plan source report (`resolved`, `behind`, `localOnly`) | `collectPlanSources`, `board.ts:1077-1110` | the ref only (`PlansValueSchema`, `snapshot.ts:136-141`) |
| the reader's identity | `server-info.ts:200-214` | no |

## Design

This plan depends on `board-reads-the-channel` (delivered) and on `the-snapshot-entity` (delivered). It works with three plans of this batch, and none of them blocks it:

- **`refs-from-files`** answers `refState`, `defaultBranch`, `resolve` for a plain name and `currentBranch` from the files git keeps. If it lands first, the two `for-each-ref`, the default-branch read and the checkout-branch read on this route start no process, but the board still reads the refs a second time beside fleetd. This plan removes the reads on `snapshot`, not only their processes. The `currentBranch` read in `serverInfo` stays on the board and takes the file reader: the checkout's branch can change with no ref event, so fleetd has no trigger for it. The census slice therefore needs `refs-from-files` merged first (Open Question 3).
- **`one-cat-file-batch`** moves the plan and sprint blob reads and the `^{commit}` type check onto one long-lived `git cat-file --batch-command`. On `own` the route then starts no process for them; on `snapshot` it no longer asks.
- **`github-reads-in-process`** moves fleetd's PR, issue and run reads off `plot-host.sh`. It does not move `Host.account()`. This plan reads the identity in fleetd through the same port, so the identity read follows whatever transport that plan gives the host connector.

All four plans touch census counts and may touch `packages/fleet/test/census/`. The second to merge rebases its fixture change and states its own measured delta.

### Approach

**One read, in fleetd.** Each missing value comes from a read fleetd already makes, or the read moves from the board to fleetd. No value is read twice. The board keeps its own reads only for `own`, where no fleetd serves.

**Slice 1: the readings.**

- **The inventory first.** A board test with a stub channel and a `live` heartbeat sends one `GET /api/board` with a spawn spy over `Scripts`, `Refs`, `Trees`, `Host`, `Processes` and `child_process`, and records every start with its argv. The test is written as `it.fails` with an expected count of 0, and the slice states the list it prints in the PR. Each start maps to a row of the table above or to a read that `refs-from-files` or `one-cat-file-batch` removes; a start that maps to neither is a finding the slice names.
- **`PlanEntrySchema` gains** `issues` (strings), `designRaw`, `verifiedRaw`, `rounds` (optional number) and `error` (optional string). `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) gains the same fields, and `plan-store-shell.ts` maps them from `plot-plan-meta.sh`'s `issues`, `design_raw`, `verified_raw`, `rounds` and `error`. A row with `error` stays in the reading with its `file` and `error`; every rule that reads `plans` skips it as `plan-store-shell.ts:242` skips it today, through one `parsedPlans(records)` arrow in the domain.
- **`PlansValueSchema` gains** `source` (`resolved`, `behind`, `localOnly`), `authors` (path to author, from `refs.planAuthors`, which `plan-walk-cache.ts:369-371` already caches per object id) and `delivered` (path to `{ text, deliveryCommit }` for each Delivered plan, from the bytes fleetd already read and `refs.recordCommit`). fleetd fills them in the walk that records `plans` (`packages/fleet/src/shared/fleet-scan.ts:734-768`).
- **A new reading `branchPlans`** holds the parsed records of the idea plans, keyed by branch. fleetd parses the `ideaPlans` text it already reads (`fleet-scan.ts:976-977`) through the same `PlanStore` and the same blob-keyed cache as the default-branch plans (`fleet-scan.ts:747`). `ideaPlans` stays for `fleetViewFrom`.
- **A new reading `identity`** holds `hostUser` and `gitEmail`, read by fleetd through `Host.account()` and `Trees.userEmail` at start and again when a trigger changes the config stamp. fleetd and the board run as one user on one machine against one repository, so one reading answers both; Open Question 2 asks a person to confirm.
- **The protocol.** `SNAPSHOT_PROTOCOL` (`packages/domain/src/entities/subscription.ts:13`) rises from 2 to 3. The slice records `protocol-3.ndjson` and `protocol-3.shape.json` under `packages/domain/test/fixtures/snapshot-protocol/`, and `snapshot-protocol.test.ts` holds them, as that test requires for any change to `RepoSnapshotSchema`. `recordReading` compares readings by content, so a plan whose `issues` or `rounds` change marks `plans` changed and raises `generation`.
- **No change on the board's path yet.** `fleetViewFrom` ignores the new fields, and every board test passes unchanged.

**Slice 2: the route serves from the snapshot.**

- **The view is a domain workflow.** `packages/domain/src/workflows/board-inputs.ts` exports `boardInputsFrom(snapshot)`, an arrow function that returns what `buildBoardOver` reads after its config reads: the default branch, the plan source report, the parsed plan, sprint and story records, the idea-plan records, the authors, the delivered readings, and the PR links. It answers `unknown` when a reading it needs is `unread` or `failed`, and names the reading.
- **`buildBoardOver` takes inputs.** The board's own path builds the same `BoardInputs` from its ports, as it does today, and both paths hand them to one assembly. A card is then the same function of the same inputs whichever path read them, which is what *Every rendered state is a domain property* asks of a rendered value.
- **`boardState` asks the source first.** When `snapshotToServe` (`fleet.ts:2991-2999`) returns a held snapshot and `boardInputsFrom` answers, `boardState` keys its in-flight build by the snapshot's `generation` instead of `refsToken`, and builds from the inputs: no `refState`, no `heldRefsFor`, no blob read, no `plot-plan-meta.sh`. On `unknown`, or with no held snapshot, it runs today's path.
- **`serverInfo` reads the identity from the snapshot** on `snapshot` and keeps its 60-second TTL read on `own`. The config reads (`board.ts:2498-2505`, `readConfigAsync`) are stamp-cached already and start a process only when `CLAUDE.md` changes.
- **Parity.** A corpus test renders `/api/board` over the census fixtures (GitHub and Bitbucket, 0 and 3 desks) by both paths and compares the payloads field by field, without `server` and the read times. A disagreement names the field, the card and both answers.
- **Actions keep their reads.** `dispatch`, `approve`, `deliver` and the other action endpoints re-read their evidence before they act (story, *Re-ask before acting*). This slice changes no action.

**Slice 3: the census holds the poll at zero.**

- The census measures the route under a row this plan adds or under a changed S3, as Open Question 1 decides. The recommended row S7 reads: "an idle board with one visible page that polls `GET /api/board` every 30 s, and fleetd running, starts nothing", in `execve` per minute, `target: 'zero'`, `greenBy: { plan: 'board-api-starts-nothing', slice: 'Census zero' }`. Its window is S3's window (`WINDOW_MS`, 60 s by default, `board.census.test.ts:23`) with one SSE client attached and one `GET /api/board` at its start and every 30 s through `BoardRun.read` (`packages/fleet/test/census/board-driver.ts:19-20`).
- The row starts as `it.fails` in slice 1's PR, with the count it reads then, and this slice turns it to `it` with `green: true` in `census-rows.ts`.
- The census jobs on Linux CI verify it on the sprint PR; a local macOS run skips the census.

### Open Questions

- [ ] **S3 or a new row S7.** S3 is green, `strict` and required since `board-reads-the-channel`. Adding a `GET /api/board` every 30 s to S3's window turns a green row red until this plan's last slice lands, and the gate's comparison with the merge base then compares two different windows. A new row S7 starts as `it.fails`, leaves S3's history comparable, and states the page's poll as its own claim. Recommendation: add S7 and keep S3 unchanged. A person decides.
- [ ] **One identity for fleetd and the board.** The plan reads `hostUser` and `gitEmail` in fleetd and serves them to the board. Both run as the same user in the same repository, so `gh`'s `hosts.yml` and the repository's `user.email` answer both the same. A `gh auth switch` reaches the board when fleetd next reads the identity, not within the board's 60-second TTL. Recommendation: read it in fleetd at start and on a change of `gh`'s `hosts.yml` stamp, beside the config stamp. A person confirms.
- [ ] **The census slice waits for `refs-from-files`.** `serverInfo`'s checkout branch stays a board read, because no ref event marks a `git checkout` in the main worktree. With `refs-from-files` merged, `Trees.currentBranch` reads `HEAD` from a file; without it, the read starts one `git` per request (its TTL is 5 s against a 30 s poll). Recommendation: merge slices 1 and 2 in either order, and slice 3 after `refs-from-files`'s adapters slice. A person decides.

## Done when

| Claim | Check | Slice |
|---|---|---|
| Every start on the route is named | the inventory test prints each start of one `GET /api/board` on `snapshot` with its argv; the PR maps each to a reading or to a plan of this batch | Readings |
| The snapshot holds every value the cards read | a snapshot row per added field: `issues`, `designRaw`, `verifiedRaw`, `rounds`, `error`, `source`, `authors`, `delivered`, `branchPlans` and `identity` round-trip through `RepoSnapshotSchema` | Readings |
| A plan that does not parse is kept and skipped | a `plan-store-shell.ts` row keeps a record with `error`; `parsedPlans` drops it, and the walk rules read the same plans as before | Readings |
| No read is made twice | fleetd's walk with a spawn spy over the census fixture starts no more `plot-plan-meta.sh` and no more `git log` per pass than on the merge base after its first pass | Readings |
| The protocol rose with its fixtures | `snapshot-protocol.test.ts` holds `protocol-3` fixtures and fails on a copy of the schema that moves without raising `SNAPSHOT_PROTOCOL` | Readings |
| Both paths render the same board | the parity corpus test over the census fixtures: every `/api/board` field except `server` and the read times agrees, and a disagreement names the field, the card and both answers | Serve |
| The route starts nothing on `snapshot` | the inventory test turns from `it.fails` to `it`: 10 requests on `snapshot` start 0 processes | Serve |
| An unread reading falls back | with `branchPlans` `unread`, `boardState` runs today's path and the payload matches the parity fixture | Serve |
| `own` is unchanged | every existing `/api/board` and `plan-read-shape.test.mjs` row passes unchanged with no channel | Serve |
| The page's poll starts nothing | census S7 (or S3, as Open Question 1 decides) reads 0 `execve` per minute on Linux CI on the sprint PR, with `green: true` and `greenBy` this plan's *Census zero* slice | Census zero |

## Slices

### Readings

- `feature/board-api-starts-nothing-readings` — the route's spawn inventory test, the added `PlanEntry`, `PlansValue`, `branchPlans` and `identity` readings filled by fleetd from reads it makes or takes over, `parsedPlans`, `SNAPSHOT_PROTOCOL` 3 with recorded fixtures, and the census row as `it.fails` <!-- builds: the board's plan-card readings in RepoSnapshot, SNAPSHOT_PROTOCOL 3 -->

### Serve

- `feature/board-api-starts-nothing-serve` — `boardInputsFrom` in `packages/domain/src/workflows/board-inputs.ts`, `buildBoardOver` over `BoardInputs`, `boardState` keyed by generation on `snapshot`, `serverInfo`'s identity from the snapshot, the parity corpus test, and a changeset for `@plot-pm/board` <!-- builds: a GET /api/board that renders from fleetd's snapshot -->

### Census zero

- `feature/board-api-starts-nothing-census` — the census row for the page's 30-second poll set to `it` with `green: true` in `census-rows.ts` and `board.census.test.ts`; merges after `feature/refs-from-files-adapters` <!-- builds: a census row that holds GET /api/board at zero while fleetd serves -->

## Notes

- Phase 4 follow-up of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), left open by `board-reads-the-channel`'s Open Question 2 and its Serve slice.
- The figure of about 5 `git` processes per request comes from the sprint `the-board-reads-the-channel` on 2026-11-09. The slice 1 inventory test replaces it with an exact list.
- Line numbers checked in the worktree of `idea/batch-refs-from-files` (cut from `origin/sprint/the-board-reads-the-channel` at `11a270538`) on 2026-11-09. `board.ts` holds 3,717 lines and `fleet.ts` 8,685.
- Deliverable search (`plot-deliverable-search.sh`) for "board api starts nothing", "api/board snapshot", "PlanEntry issues" and "SNAPSHOT_PROTOCOL" found no existing deliverable. The hits are `PlanEntrySchema` and `fleetViewFrom` (`board-view.ts`), which this plan extends, the board's own `PlanEntry` for working-tree files (`board.ts:939`), and the channel's protocol checks.
- Definition of Done: docs/definition-of-done.md.

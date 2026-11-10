# The board API starts nothing

> While the board serves fleetd's snapshot, `GET /api/board` renders from the snapshot and starts no process. fleetd fills the readings the board still reads alone (plan issues, design and verification records, challenge rounds, parse errors, parsed branch plans, delivered-plan verification inputs, plan authors, sprints and stories), `SNAPSHOT_PROTOCOL` rises to 3 with recorded fixtures, the reader's identity stays on the board behind a file-stamp check, and a new census row S7 holds the page's 30-second poll at zero.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** desk-probes-and-liveness
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged
- **Delivered:** 2026-11-10

## Changelog

- With fleetd running and a page attached, `GET /api/board` answers from fleetd's snapshot and starts no `git`, `bash` or `plot-plan-meta.sh` process. Without fleetd, the board reads for itself as today.
- fleetd's snapshot carries what the board's plan cards read: each plan's issues, design and verification records, challenge rounds and parse error, the parsed plans on prefixed branches, the verification inputs of Delivered plans with their delivery commit, the plan authors, and the parsed sprints and stories.
- The board reads the reader's identity once per process and again only when `gh`'s or `bb`'s config, `.git/config` or `~/.gitconfig` changes, instead of every 60 s.

Board impact: no change to the plan format, the template, the helper scripts or the `docs/plans` layout. The `/api/board` payload keeps its shape. A board and a fleetd of different builds meet a raised `SNAPSHOT_PROTOCOL`, so the board falls back to its own reads (`mismatch`) until both run the same build.

## Motivation

`board-reads-the-channel` (delivered 2026-11-09) moved the board's pulse onto fleetd's snapshot: `refresh` installs `fleetViewFrom` when `boardSourceOf` answers `snapshot` (`packages/board/src/server/fleet.ts:2991-2999`, `:3010-3044`), and census S3 reads 0 `execve` per minute. Its Serve slice also named `GET /api/board`, but the route still builds the board from the ref on every source:

- `index.ts:489-501` calls `boardAnswer`, which calls `boardState` (`packages/board/src/server/controllers/board-answer.ts:61`).
- `boardState` reads `refsToken` for its in-flight key (`packages/board/src/server/controllers/fleet-state.ts:139-143`, a `refState('both')`) and then calls `buildBoard` (`:196-241`).
- `buildBoard` lists the refs again through `heldRefsFor` (`packages/board/src/server/board.ts:328-341`, `readRefSnapshot`), resolves the default branch (`:1193-1203`, `:2509`), reads the plan files from `origin/<default>` and resolves `origin/<default>^{commit}` (`:1093`, `:2518`), reads the sprint files from the ref (`:1920`), resolves the default tip for the idea-plan cache key (`:1337`), and parses every new blob with one `plot-plan-meta.sh` (`:2655`).
- `serverInfo` reads the checkout's branch on a 5-second TTL (`packages/board/src/server/server-info.ts:73`) and the identity on a 60-second TTL (`:191`, `:200-214`): `plot-host.sh account` and `git config user.email`.

- `boardAnswer` also calls `ticketLaneData(opts)` outside `boardState` (`controllers/board-answer.ts:68`). While fleetd serves `issues.json`, `entry.issueSets` is set (`fleet.ts:2539`), and `ticketLaneData` calls `ticketPlansOf(opts, entry)` with no `refEntries` (`fleet.ts:1959`), which calls `planMetasAtDefault` (`fleet.ts:1809`) and `heldRefsFor(opts, undefined)` (`fleet.ts:1687`): a third `for-each-ref`, exactly in the mode this plan targets. `planMetasAtDefault` parses the default-branch plans and the draft plans in `entry.ideaPlans` whose branch has an open PR (`draftPlanFiles`, `fleet.ts:1888-1906`).

On the sprint head this is about 5 `git` processes per request: three `for-each-ref`, the `rev-parse origin/main^{commit}` and the checkout-branch read, plus the identity read once per 60 s. The page polls `/api/board` every 30 s (`POLL_MS`, `packages/board/src/app/App.tsx:53`), and every channel event makes it refetch (`packages/board/src/server/channel-events.ts:13-14`).

`board-reads-the-channel` left this open in its Open Question 2: the S3 window attaches an SSE client and sends no `GET /api/board` (`packages/fleet/test/census/board.census.test.ts:137-175`), so "a zero in S3 therefore does not prove that `/api/board` starts nothing", and "a person decides whether S3's definition changes".

The route cannot render from the snapshot today because the snapshot lacks what the cards read. `PlanEntrySchema` (`packages/domain/src/entities/snapshot.ts:108-132`) holds the `PlanRecord` fields, and `buildBoard` also reads from `plot-plan-meta.sh`'s output:

| The board reads | Where | In the snapshot |
|---|---|---|
| `issues` | `board.ts:2822`, `:3171` | no |
| `design_raw` | `board.ts:1579`, `:2970` | no |
| `verified_raw` | `board.ts:2860` | no |
| `rounds` | `board.ts:2877`, `:3175` | no |
| a plan file that does not parse (`error`) | the error card | no: `packages/domain/src/adapters/plan-store/plan-store-shell.ts:243` drops the row |
| parsed branch plans: every `Branch prefixes` entry, merged branches skipped, de-duplicated by path | `readBranchPlans`, `board.ts:1245`, cached at `:1315-1351` | no: `ideaPlans` holds branch to file basename, for `refs/remotes/origin/idea/*` only, where the basename ends in the branch slug (`readIdeaPlans`, `fleet-scan.ts:391-411`) |
| a Delivered plan's text and delivery commit | `board.ts:2652-2670`, `refs.recordCommit` at `:2667`; only `verificationOf` and `refutedClaims` read the text (`:2854-2864`) | no |
| plan authors | `refs.planAuthors`, `board.ts:2754-2755` | no |
| the plan source report (`resolved`, `behind`, `localOnly`) | `collectPlanSources`, `board.ts:1077-1110` | the ref only (`PlansValueSchema`, `snapshot.ts:136-141`); fleetd records `ref: 'worktree'` on its fallback (`fleet-scan.ts:768`), which `collectPlanSources` never promotes |
| working-tree plans and sprints | `workingTreePlans`, `board.ts:946`, `:1097-1104`; `workingTreeSprints`, `:1928-1930` | no; they change with no ref event |
| sprint records | `parseSprintContent`, `board.ts:1920-1930` | no: `READING_KEYS` (`snapshot.ts:18-35`) has no sprint key |
| story records, archived stories, design-document lists | `parseStoryContent`, `board.ts:2111-2166`, `:2231-2262`; `listDesignDocs`, `:2054` | no: no story key |
| the plans a ticket lane links | `ticketPlansOf` → `planMetasAtDefault`, `fleet.ts:1682-1809` | no: needs `issues` per plan and per open-PR draft |
| the reader's identity | `server-info.ts:200-214` | no |

## Design

This plan depends on `board-reads-the-channel` (delivered) and on `the-snapshot-entity` (delivered). It works with three plans of this batch, and none of them blocks it:

- **`refs-from-files`** answers `refState`, `defaultBranch`, `resolve` for a plain name and `currentBranch` from the files git keeps. If it lands first, the two `for-each-ref`, the default-branch read and the checkout-branch read on this route start no process, but the board still reads the refs a second time beside fleetd. This plan removes the reads on `snapshot`, not only their processes. The `currentBranch` read in `serverInfo` stays on the board and takes the file reader: the checkout's branch can change with no ref event, so fleetd has no trigger for it. The census slice therefore merges after `feature/refs-from-files-adapters`.
- **`one-cat-file-batch`** moves the plan and sprint blob reads and the `^{commit}` type check onto one long-lived `git cat-file --batch-command`. On `own` the route then starts no process for them; on `snapshot` it no longer asks.
- **`github-reads-in-process`** moves fleetd's PR, issue and run reads off `plot-host.sh`. It does not move `Host.account()`, and this plan keeps the identity read on the board, so the two plans share no read.

All four plans touch census counts and may touch `packages/fleet/test/census/`. The second to merge rebases its fixture change and states its own measured delta.

### Approach

**One read, in fleetd.** Each missing value comes from a read fleetd already makes, or the read moves from the board to fleetd. No value is read twice. The board keeps its own reads only for `own`, where no fleetd serves.

**Slice 1: the readings.**

- **The inventory first.** A board test with a stub channel and a `live` heartbeat sends one `GET /api/board` with a spawn spy over `Scripts`, `Refs`, `Trees`, `Host`, `Processes` and `child_process`, and records every start with its argv. The test is written as `it.fails` with an expected count of 0, and the slice states the list it prints in the PR. Each start maps to a row of the table above or to a read that `refs-from-files` or `one-cat-file-batch` removes; a start that maps to neither is a finding the slice names.
- **`PlanEntrySchema` gains** `issues` (strings), `designRaw`, `verifiedRaw`, `rounds` (optional number) and `error` (optional string). `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) gains the same fields, and `plan-store-shell.ts` maps them from `plot-plan-meta.sh`'s `issues`, `design_raw`, `verified_raw`, `rounds` and `error`. A row with `error` stays in the reading with its `file` and `error`; every rule that reads `plans` skips it as `plan-store-shell.ts:242` skips it today, through one `parsedPlans(records)` arrow in the domain.
- **`PlansValueSchema` gains** `resolved` (the default tip fleetd read), `authors` (path to author, from `refs.planAuthors`, which `plan-walk-cache.ts:369-371` already caches per object id) and `delivered` (path to the inputs `verificationOf` and `refutedClaims` read for each plan in phase `delivered`, with its `deliveryCommit` from `refs.recordCommit`; not the whole text). fleetd fills them in the walk that records `plans` (`packages/fleet/src/shared/fleet-scan.ts:734-768`). `behind` and `localOnly` are facts about the checkout and stay board reads (see *Working-tree reads stay on the board*). On 2026-11-09, 22 plans carry `State: Delivered`, and their text is 265,884 bytes.
- **A new reading `branchPlans`** holds the parsed records of the plans on prefixed branches, keyed by branch and path. It is a new fleetd read, not one fleetd already makes: `ideaPlans` holds basenames of `idea/*` plans only. fleetd selects the set through one domain rule that the board's `readBranchPlans` also calls (every `Branch prefixes` entry, branches the default branch contains skipped, de-duplicated by path, the state ref honoured), and parses the blobs through the same `PlanStore` and the same blob-keyed cache as the default-branch plans (`fleet-scan.ts:747`). The reading also serves the ticket lane's open-PR drafts (`draftPlanFiles`, `fleet.ts:1888-1906`), so both consumers read one set. `ideaPlans` stays for `fleetViewFrom`.
- **Working-tree reads stay on the board.** `workingTreePlans`, `workingTreeSprints` and `behind` (`measureBehind`, `board.ts:1032-1049`) change with no ref event, the argument this plan applies to `currentBranch`. The board reads them on both paths. The working-tree scan is an `fs` read and its parse is cached by blob id, so it starts no process at idle; `behind` takes the file reader of `refs-from-files` or names its start in the inventory.
- **New readings `sprints` and `stories`** hold the parsed sprint records (`parseSprintContent`, `board.ts:1920-1930`) and the parsed story records, the archived stories and the design-document lists (`parseStoryContent`, `board.ts:2111-2166`, `:2231-2262`; `listDesignDocs`, `:2054`), read by fleetd from the default branch in the walk that records `plans`. `READING_KEYS` (`snapshot.ts:18-35`) gains both keys inside `SNAPSHOT_PROTOCOL` 3. Without them the board reads sprints and stories itself on `snapshot`, and S7 cannot reach 0. `workingTreeSprints` stays a board read (see *Working-tree reads stay on the board*).
- **The identity stays on the board.** fleetd runs under `systemd-run --user` or launchd, and `plot-host.sh account` reads `GH_CONFIG_DIR`, `GH_TOKEN` and `PLOT_BUDGET_ACCOUNT` from its caller's environment, so fleetd's answer can differ from the board's. The snapshot gains no `identity` reading.
- **The protocol.** `SNAPSHOT_PROTOCOL` (`packages/domain/src/entities/subscription.ts:13`) rises from 2 to 3. The slice records `protocol-3.ndjson` and `protocol-3.shape.json` under `packages/domain/test/fixtures/snapshot-protocol/`, and `snapshot-protocol.test.ts` holds them, as that test requires for any change to `RepoSnapshotSchema`. `recordReading` compares readings by content, so a plan whose `issues` or `rounds` change marks `plans` changed and raises `generation`.
- **No change on the board's path yet.** `fleetViewFrom` ignores the new fields, and every board test passes unchanged.

**Slice 2: the route serves from the snapshot.**

- **The view is a domain workflow.** `packages/domain/src/workflows/board-inputs.ts` exports `boardInputsFrom(snapshot)`, an arrow function that returns what `buildBoardOver` reads after its config reads: the default branch, the plan source report, the parsed plan records, the `sprints` and `stories` readings, the branch-plan records, the authors, the delivered readings, and the PR links. It answers `unknown` when any reading it reads is `unread` or `failed` (each added field among them, `authors` and `delivered` included), and when `plans.ref` is `worktree`, and names the reading. A `failed` `authors` reading therefore falls back to today's path and never renders empty authors.
- **`buildBoardOver` takes inputs.** The board's own path builds the same `BoardInputs` from its ports, as it does today, and both paths hand them to one assembly. A card is then the same function of the same inputs whichever path read them, which is what *Every rendered state is a domain property* asks of a rendered value.
- **`boardState` asks the source first.** When `snapshotToServe` (`fleet.ts:2991-2999`) returns a held snapshot and `boardInputsFrom` answers, `boardState` keys its in-flight build by the snapshot's `generation` instead of `refsToken`, and builds from the inputs: no `refState`, no `heldRefsFor`, no blob read, no `plot-plan-meta.sh`. On `unknown`, or with no held snapshot, it runs today's path.
- **The ticket lane reads the snapshot.** On `snapshot`, `ticketLaneData` hands `ticketPlansOf` the `issues` of the snapshot's plan entries and of the `branchPlans` drafts whose branch has an open PR, and does not call `planMetasAtDefault`. Without this, `boardAnswer` starts one `for-each-ref` per request whenever fleetd serves `issues.json`.
- **`serverInfo` reads the identity behind a file stamp** on both paths. It reads `hostUser` and `gitEmail` once per process, and again only when the `fs.stat` stamp (size and mtime) of `gh`'s `hosts.yml` (or the `bb` config), `.git/config` or `~/.gitconfig` changes, in place of the 60-second TTL (`server-info.ts:191`, `:200-214`). An idle poll reads 3 stamps and starts no process. `heldIdentity` (`fleet.ts:2200-2201`) keeps reading `identity()`, so the *Waiting on you* reader does not change.
- **`/api/board` keeps its payload shape.** It gains no `servedFrom` value; `/api/fleet` reports the source (`viewSource`), and a person who asks where the board came from reads it there. The config reads (`board.ts:2498-2505`, `readConfigAsync`) are stamp-cached already and start a process only when `CLAUDE.md` changes.
- **Parity.** A corpus test renders `/api/board` over the census fixtures (GitHub and Bitbucket, 0 and 3 desks) and over a parity fixture by both paths, and compares the payloads field by field, without `server` and the read times. The census sandbox writes one plan (`packages/fleet/test/census/sandbox.ts:238`), so the parity fixture holds one card of each kind: a Draft plan on a `feature/` branch, a plan whose basename differs from its branch slug, an open-PR draft linked to a ticket, a sprint with items, a story with a design document, an archived story, a Delivered plan with a verification record, a plan file that does not parse, a working-tree-only plan, and a plan with `issues` and `rounds`. A disagreement names the field, the card and both answers.
- **Actions keep their reads.** `dispatch`, `approve`, `deliver` and the other action endpoints re-read their evidence before they act (story, *Re-ask before acting*). This slice changes no action.

**Slice 3: the census holds the poll at zero.**

- The census measures the route under a new row S7, and S3 stays unchanged, so S3's history against the merge base stays comparable. S7 reads: "an idle board with one visible page that polls `GET /api/board` every 30 s, and fleetd running, starts nothing", in `execve` per minute, `target: 'zero'`, `greenBy: { plan: 'board-api-starts-nothing', slice: 'Census zero' }`. Its window is S3's window (`WINDOW_MS`, 60 s by default, `board.census.test.ts:23`) with one SSE client attached and one `GET /api/board` at its start and every 30 s through `BoardRun.read` (`packages/fleet/test/census/board-driver.ts:19-20`). The row asserts that every in-window read answers 200, so a failed request cannot read as zero starts.
- The row starts as `it.fails` in slice 1's PR, with the count it reads then, and this slice turns it to `it` with `green: true` in `census-rows.ts`.
- The census jobs on Linux CI verify it on the sprint PR; a local macOS run skips the census.

### Open Questions

- [x] **S3 or a new row S7.** S3 is green, `strict` and required since `board-reads-the-channel`. Adding a `GET /api/board` every 30 s to S3's window turns a green row red until this plan's last slice lands, and the gate's comparison with the merge base then compares two different windows. A new row S7 starts as `it.fails`, leaves S3's history comparable, and states the page's poll as its own claim. Recommendation: add S7 and keep S3 unchanged. A person decides. **Decided 2026-11-09, jwloka: add S7; S3 stays unchanged.**
- [x] **One identity for fleetd and the board.** The plan reads `hostUser` and `gitEmail` in fleetd and serves them to the board. Both run as the same user in the same repository, so `gh`'s `hosts.yml` and the repository's `user.email` answer both the same. A `gh auth switch` reaches the board when fleetd next reads the identity, not within the board's 60-second TTL. The panel of 2026-11-09 split on this. Correctness and cost: keep the identity on the board, cached for the process and re-read only when an `fs.stat` stamp of `gh`'s `hosts.yml` (or the `bb` config), `.git/config` and `~/.gitconfig` changes, and drop the `identity` reading; fleetd runs under `systemd-run --user` or launchd, and `plot-host.sh account` reads `GH_CONFIG_DIR`, `GH_TOKEN` and `PLOT_BUDGET_ACCOUNT` from its caller's environment, so one user does not prove one answer. Operator: read it in fleetd, and then also move `heldIdentity` (the *Waiting on you* reader, `fleet.ts:2200-2201`, which freezes once `serverInfo` stops calling `identity()`) to the snapshot, and fall back to the board's TTL read on an `unread` or `failed` reading instead of serving `''`. A person decides. **Decided 2026-11-09, jwloka: the identity stays on the board behind a file-stamp check; the snapshot gets no `identity` reading.**
- [x] **The census slice waits for `refs-from-files`.** `serverInfo`'s checkout branch stays a board read, because no ref event marks a `git checkout` in the main worktree. With `refs-from-files` merged, `Trees.currentBranch` reads `HEAD` from a file; without it, the read starts one `git` per request (its TTL is 5 s against a 30 s poll). Readings merges before Serve, because Serve reads the fields Readings adds. Recommendation: merge Census zero after `refs-from-files`'s adapters slice. A person decides. **Decided 2026-11-09, jwloka: Census zero merges after `feature/refs-from-files-adapters`.**
- [x] **Sprints and stories on `snapshot`.** The snapshot has no sprint or story reading. Options: add `sprints` and `stories` readings (parsed records, archived stories, design-document lists) to Readings inside the same `SNAPSHOT_PROTOCOL` 3, or keep the board's own sprint and story read on `snapshot` and state its process cost in S7. A person decides. **Decided 2026-11-09, jwloka: option (a). Readings adds `sprints` and `stories` inside `SNAPSHOT_PROTOCOL` 3, so S7 can reach 0.**
- [x] **Where `/api/board` was served from.** `viewSource` exists on `/api/fleet` only and the page renders none of it; `generatedAt` is the request time. Options: add a `servedFrom` value (`snapshot` with `generation` and the `plans` reading's `readAt`, or `own` with the fallback reason) rendered in the plan-source line, with a row that a `snapshot` → `own` → `snapshot` sequence never shows an older `generation` of the plans; or keep the payload shape as the Changelog states. A person decides. **Decided 2026-11-09, jwloka: no `servedFrom` on `/api/board`; `/api/fleet` reports the source.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| Every start on the route is named | the inventory test prints each start of one `GET /api/board` on `snapshot` with its argv; the PR maps each to a reading or to a plan of this batch | Readings |
| The snapshot holds every value the cards read | a snapshot row per added field: `issues`, `designRaw`, `verifiedRaw`, `rounds`, `error`, `resolved`, `authors`, `delivered`, `branchPlans`, `sprints` and `stories` round-trip through `RepoSnapshotSchema`; the schema holds no `identity` key | Readings |
| A plan that does not parse is kept and skipped | a `plan-store-shell.ts` row keeps a record with `error`; `parsedPlans` drops it, and the walk rules read the same plans as before | Readings |
| No read is made twice | with a spawn spy, a fleetd pass after one default-branch move plus one board request starts no more `plot-plan-meta.sh` and no more `git log` than the merge base's fleetd pass plus board build over the same move; the PR states the per-move `git log` count (`recordCommit` per Delivered plan, `planAuthors` per tip) and the reads `branchPlans` adds | Readings |
| The branch-plan set is one rule | fleetd's `branchPlans` and the board's `readBranchPlans` call one domain rule; a row holds a Draft plan on a `feature/` branch and a plan whose basename differs from its branch slug | Readings |
| `delivered` carries inputs, not text | a row asserts `delivered` holds no plan text, and the PR states the reading's size on this repository | Readings |
| The protocol rose with its fixtures | `snapshot-protocol.test.ts` holds `protocol-3` fixtures and fails on a copy of the schema that moves without raising `SNAPSHOT_PROTOCOL` | Readings |
| Both paths render the same board | the parity corpus test over the census fixtures and the parity fixture (one card of each kind, a working-tree-only plan among them): every `/api/board` field except `server` and the read times agrees, and a disagreement names the field, the card and both answers | Serve |
| The ticket lane reads the snapshot | with `issueSets` set and a spawn spy, one `GET /api/board` on `snapshot` makes no `planMetasAtDefault` call, and the ticket lanes match the parity fixture | Serve |
| A failed reading falls back | with `authors` `failed`, and with `plans.ref` `worktree`, `boardState` runs today's path and renders no empty author | Serve |
| The route starts nothing on `snapshot` | the inventory test turns from `it.fails` to `it`: 10 requests on `snapshot` start 0 processes | Serve |
| An unread reading falls back | with `branchPlans` `unread`, `boardState` runs today's path and the payload matches the parity fixture | Serve |
| The identity is read on a stamp change only | a `serverInfo` row: 10 reads with no stamp change start no process; a changed `hosts.yml` mtime makes the next read ask `Host.account()` once | Serve |
| The payload names no source | `/api/board` holds no `servedFrom` field; `/api/fleet` reports `viewSource` | Serve |
| `own` is unchanged | every existing `/api/board` and `plan-read-shape.test.mjs` row passes unchanged with no channel | Serve |
| The page's poll starts nothing | census S7 reads 0 `execve` per minute on Linux CI on the sprint PR, every in-window read answers 200, with `green: true` and `greenBy` this plan's *Census zero* slice | Census zero |
| S3 is unchanged | `board.census.test.ts`: S3's window sends no `GET /api/board`, and its row in `census-rows.ts` is unchanged | Census zero |

## Slices

### Readings

- `feature/board-api-starts-nothing-readings` — the route's spawn inventory test, the added `PlanEntry`, `PlansValue`, `branchPlans`, `sprints` and `stories` readings filled by fleetd from reads it makes or takes over, the branch-plan rule both paths call, `parsedPlans`, `SNAPSHOT_PROTOCOL` 3 with recorded fixtures, and the census row as `it.fails` <!-- builds: the board's plan-card readings in RepoSnapshot, SNAPSHOT_PROTOCOL 3 -->

### Serve

- `feature/board-api-starts-nothing-serve` — `boardInputsFrom` in `packages/domain/src/workflows/board-inputs.ts`, `buildBoardOver` over `BoardInputs`, `boardState` keyed by generation on `snapshot`, `serverInfo`'s identity behind a file stamp, `ticketLaneData` over the snapshot, the parity corpus test with its fixture, and a changeset for `@plot-pm/board`; merges after `feature/board-api-starts-nothing-readings` <!-- builds: a GET /api/board that renders from fleetd's snapshot -->

### Census zero

- `feature/board-api-starts-nothing-census` — census row S7 for the page's 30-second poll, S3 unchanged, set to `it` with `green: true` in `census-rows.ts` and `board.census.test.ts`; merges after `feature/refs-from-files-adapters` <!-- builds: a census row that holds GET /api/board at zero while fleetd serves -->

## Notes

- Phase 4 follow-up of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), left open by `board-reads-the-channel`'s Open Question 2 and its Serve slice.
- The figure of about 5 `git` processes per request comes from the sprint `the-board-reads-the-channel` on 2026-11-09. The slice 1 inventory test replaces it with an exact list.
- Line numbers checked in the worktree of `idea/batch-refs-from-files` (cut from `origin/sprint/the-board-reads-the-channel` at `11a270538`) on 2026-11-09. `board.ts` holds 3,717 lines and `fleet.ts` 8,685.
- Deliverable search (`plot-deliverable-search.sh`) for "board api starts nothing", "api/board snapshot", "PlanEntry issues" and "SNAPSHOT_PROTOCOL" found no existing deliverable. The hits are `PlanEntrySchema` and `fleetViewFrom` (`board-view.ts`), which this plan extends, the board's own `PlanEntry` for working-tree files (`board.ts:939`), and the channel's protocol checks.
- Definition of Done: docs/definition-of-done.md.

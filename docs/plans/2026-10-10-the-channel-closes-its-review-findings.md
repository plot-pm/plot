# The channel closes its review findings

> Seven slices fix the review findings that the eight `the-fleet-reports-what-changed-on-the-host` PRs left open, grouped by the code each fix touches.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-gates-and-the-review-findings
- **Issue:** #1437, #1463, #1465, #1467, #1470, #1476, #1481
- **Review:** pr
- **Impl:** own branches

## Changelog

- A default-branch reading older than its bound holds no slice, and a Jenkins rebuild that goes green lifts the hold.
- On Bitbucket, a comment on a merged PR no longer publishes `pr merged` again.
- The board page refetches after the last event in a throttle window, so the last change no longer waits for the 30 s poll.
- Several board tabs share one event stream instead of one HTTP/1.1 connection each.
- The `writing brief` note shows how long the writer has worked.
- The plot-follow mod keeps following after a reload, drops a line that a `clear` retracted, and keeps its turn gate per repository.

<!-- Board impact: board code changes in slices 4, 5 and 6 (row note, board build wiring, event stream). No change to the plan format, the plan template, the helper-script contract or the docs/plans layout. -->

## Motivation

The plan `the-fleet-reports-what-changed-on-the-host` shipped in eight PRs between 2026-10-09 and 2026-10-10. Each review fixed its HIGH findings on the PR and filed the rest as an issue: #1437 (from #1430), #1463 (#1460), #1465 (#1464), #1467 (#1466), #1470 (#1469), #1476 (#1475) and #1481 (#1480). These seven issues hold 42 findings. A read of `origin/main` at `eb4bda159` on 2026-10-10 finds 40 still open.

The open findings fall into four kinds:

- **A hold that can stick.** A stale `.plot/state/default-branch.json` holds every slice under `--once`, because nothing reads the reading's age (#1463 M1). A Jenkins rebuild of a red commit keeps the hold (#1463 M3).
- **Wiring that no test covers.** Three reviews measured the same gap in `registryd-main.ts`: the default-branch hold, the IndexMonitor beat and the desk relay can each be deleted with every fleet test green (#1463 M2, #1465 M1, #1467 M1). The board's `buildBoard` wiring of the new readings has the same gap (#1476 M1).
- **Events that arrive late or twice.** Both throttles drop an event instead of delaying it (#1470 M1). On Bitbucket a merged PR publishes `pr merged` again days later (#1465 M3). A fleetd restart produces a mod turn about unchanged findings (#1481 L1).
- **A rendered decision outside the domain.** `briefNote` decides `failed` and `asked` from older fields instead of the rule's answer, and drops the writer's age (#1437 M2, M3).

## Design

### Approach

The slices follow the code, not the issues. One file never appears in two slices that could run at the same time. `## Slices` writes one `###` heading per slice, so the slices run in the order written. The order puts each slice after every earlier slice that touches the same file.

Two rules from `CLAUDE.md` bind every slice:

- **Every rendered state is a domain property.** The brief-writer note (slice 4) moves its decision into `packages/domain/src/rules/brief-writer.ts`. The trailing-refetch decision (slice 6) goes into `packages/domain/src/rules/event-window.ts`. The `checksShaSuffix` wording (slice 5) is already a domain rule.
- **The browser-test count is gated.** `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts:671` is 557 on `eb4bda159`. A slice that adds an `it(` in a file that drives a page moves it by one per test, in the same commit, with a dated history line, re-derived on the slice's own base. Slice 6 adds at least one browser test. Slices 4 and 5 change existing browser tests only and leave the count.

#### Slice 1 — Default-branch reading age

Files: `packages/domain/src/rules/default-branch.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `skills/plot/scripts/plot-host.sh` or `packages/domain/src/adapters/build/build-jenkins.ts`, `packages/fleet/src/server/entry/registryd-main.ts:805-811` only, `CLAUDE.md` and `AGENTS.md`, and their tests.

- **#1463 M1.** `defaultBranchRed` (`rules/default-branch.ts:104-105`) reads only `reading?.settled?.state === 'red'` and never the reading's `at`. `queueWorldForRepo.defaultBranchRed` (`registryd-main.ts:807-810`) reads the file in every mode, and `defaultBranchWorld` is `null` under `--once` (`:1879`), so `--once` never refreshes it. `default-branch-refresh.ts:86` returns `unreadable` and carries `settled` forward. Since #1475 the loop re-asks a red head (`default-branch-refresh.ts:77-82`), which covers the loop after its first `prs` beat but not `--once`, the first tick, or a refresh that keeps answering `unreadable`. The fix: `defaultBranchRed` takes `now` and a bound, and a reading older than the bound holds nothing. `readingAge` (`packages/domain/src/entities/identity.ts:102`) exists and the slice reuses it if the reading's shape fits.
- **#1463 M3.** `jenkins_sha_runs` (`plot-host.sh:1737-1744`) returns every build of a SHA, and the fold tests red first (`rules/default-branch.ts:58-59`). Build #41 `FAILURE` and rebuild #42 `SUCCESS` fold to red. The fix keeps the newest build per SHA on Jenkins. GitHub keeps one run id per re-run and needs no change.
- **#1463 L1.** The `unaskable` arm at `default-branch-refresh.ts:86` has no test; `grep unaskable` in `packages/fleet/test/unit/default-branch-refresh.test.ts` finds none. The slice adds one.
- **#1463 L2.** `PENDING_CONCLUSIONS` (`rules/default-branch.ts:10`) holds `queued`, `in_progress` and `action_required`. GitHub's `waiting`, `requested` and `pending` read `unknown`. The slice adds them with a test.
- **#1463 L4.** The file stores the fold's output (`head`, `settled`, `failingRuns`), not the host's runs. `CLAUDE.md:485` describes the hold's reversibility, and `:487` says "Answers, never verdicts". The slice states in `CLAUDE.md` that this file holds a verdict and why the exception is safe, then runs `./scripts/check-agents-md.sh --write`.

#### Slice 2 — Channel heartbeat and inputs

Files: `packages/domain/src/adapters/channel/channel-socket.ts` (test only), `packages/fleet/src/shared/index-monitor.ts`, `packages/fleet/src/shared/pr-refresh.ts`, `packages/fleet/test/unit/desk-relay.test.ts`, `packages/board/src/server/findings.ts`, and their tests.

- **#1465 M2.** `publish` stamps `lastSeen` with `now()` (`channel-socket.ts:201-205`). The heartbeat test (`packages/domain/test/channel-socket.test.ts:200-220`) calls `seen()` after the publish, so a revert to `measuredAt` passes. The slice adds a test that publishes a finding with an old `measuredAt` and reads the heartbeat with no later `seen()`.
- **#1465 M3.** On Bitbucket, `mergedAt` is `.updated_on` (`plot-host.sh:4361`, `:4373`), and `storeRow` overwrites it (`pr-refresh.ts:1092`). A comment on a PR merged three days ago moves `mergedAt` to now, and `indexFindings` publishes `pr merged` again (`packages/domain/src/rules/index-findings.ts:58-62`, `:104`). A `MERGED` row is terminal, so the fix keeps the predecessor's `mergedAt` once set.
- **#1465 L2.** `index-monitor.ts:61` calls `seen('IndexMonitor')` only when `sliceBranches` is not null, and `registryd-main.ts:1700-1706` returns null for an empty set. A repo with no slice branches reads the monitor as gone. The fix calls `seen` when the fold read the index, whatever the slice set holds.
- **#1467 M2.** `desk-relay.ts:66` keeps the newest `measuredAt`. The fixture (`desk-relay.test.ts:200-210`) lists the newer desk first, so a first-desk-wins mutant passes. The slice lists the older desk first.
- **#1467 L1.** `findingsInLog` (`packages/board/src/server/findings.ts:42-62`) keeps a synchronous tail read beside `logTail` (`packages/domain/src/adapters/desk/desk-fs.ts:59`). Both call `findingsInText`, and `packages/board/test/unit/findings-parity.test.ts` holds their parity. The slice replaces the read with `logTail` where the caller can await it, or states in the PR why the synchronous read stays.

#### Slice 3 — Fleetd wiring tests

Files: `packages/fleet/src/server/entry/registryd-main.ts`, `packages/fleet/src/shared/fleet-clock.ts`, `packages/fleet/test/unit/registryd-main.test.ts` or a new `packages/fleet/test/unit/registryd-wiring.test.ts`. Runs after slices 1 and 2, which change `registryd-main.ts:805-811` and `index-monitor.ts`.

- **#1463 M2, #1465 M1, #1467 M1 — one gap.** No test reads `queueWorldForRepo(...).defaultBranchRed` (`registryd-main.ts:807-810`), `indexMonitorOver` (`:1679`), `deskRelayOver` (`:1721`), the `prs` beat (`:1939-1943`) or the relay call (`:2042-2046`). The `run` tests in `registryd-main.test.ts` (from about `:1031`) pass `stop = () => true`, so the `prs` beat never fires. The fix extracts the `prs` beat and the relay call into an exported function that takes its world, then tests: a settled-red file holds and a missing file does not; the beat calls `readDefaultBranch` then the monitor; a `channel === null` tick still runs; a relay throw only warns. Each test is mutation-checked by removing the line it guards.
- **#1465 L1.** `run`'s `stop` defaults to `() => false` (`:1781`) and fleetd registers no signal handler, so `channel?.stop()` (`:1951`) runs only in tests and `.plot/fleet.sock` stays after a stop. The fix adds a SIGTERM and SIGINT handler that sets `stop`.
- **#1465 L3.** `startFleetChannel` (`:1650-1663`) warns once and returns null for the daemon's life, and `fleet-clock.ts:56` swallows a monitor throw with no warning. The fix retries the bind on a later beat and warns on a swallowed throw.
- **#1467 L2.** The tick's `catch` (`:1998-2013`) ends in `continue` before `deskRelay?.()` (`:2043`), so failing ticks stop the relay. The relay moves out of the tick path, onto the `prs` beat or before the `catch`.

#### Slice 4 — Brief-writer row

Files: `packages/domain/src/rules/brief-writer.ts`, `packages/board/src/contract/schema.ts`, `packages/board/src/app/lib/agent-rows/row-identity.ts`, `packages/board/src/server/fleet.ts`, `packages/fleet/src/shared/board-run.ts`, and the tests `packages/board/test/unit/brief-failed.test.ts`, `packages/domain/test/brief-writer.test.ts`, `packages/board/test/unit/board-run.test.ts`, `packages/board/test/integration/agents-tab.browser.test.ts`.

- **#1437 M2, M3 — the note is a domain property.** `briefNote` (`row-identity.ts:310-321`) returns the fixed text "the brief writer is working now" and decides `failed` and `asked` again from `briefFailed` and `briefAskedAt`. The fix: a domain function returns the note's kind and age from the rule's state and `askedAt`, and `briefNote` switches on the row's state and only formats. The `writing` note carries the ask's age with the existing `briefAskedNote` formatting.
- **#1437 M1.** The test at `brief-failed.test.ts:201-206` calls `rowsFromPulse` and never `AgentRowSchema.parse`, and no test in `packages/board/test` parses the field through the schema. The slice parses a row without the field and asserts `'none'`.
- **#1437 M4.** The TSDoc at `brief-writer.ts:4-6` and `:27-31` carries the #1417 story and says "Wave" for a slice. The slice states what each field means and what the function returns.
- **#1437 L1.** The field `briefWriting` (`schema.ts:2901`) and the boolean helper `briefWriting` (`row-identity.ts:279`) share a name. The field becomes `briefWriter`.
- **#1437 L2.** `BriefWriterStateSchema` (`schema.ts:1744`) repeats the domain's `BriefWriterState` (`brief-writer.ts:8`). The schema derives from the domain's list, or a type-equality test ties them.
- **#1437 L3.** `fleet.ts:5573-5578` maps the reading to a run state outside the domain. The rule takes the `BriefReading` fields instead.
- **#1437 L4.** `readRunState` (`packages/fleet/src/shared/board-run.ts:298-313`) checks a `running <pid>` file with `process.kill(pid, 0)` only (`:274-281`), so a reused pid reads `writing`. The fix records the process start time beside the pid and compares it.

The browser test at `agents-tab.browser.test.ts` changes its assertions for the renamed field and the aged note. It adds no `it(`, so `EXPECTED_TESTS` stays.

#### Slice 5 — Board readings wiring

Files: `packages/board/src/server/board.ts` (test only), `packages/board/src/server/estate.ts`, `packages/domain/src/rules/checks-reading.ts`, and the tests `packages/domain/test/checks-reading.test.ts`, a board unit test, `packages/board/test/integration/agents-tab.browser.test.ts`. Runs after slice 4, which changes the same browser test file.

- **#1476 M1.** No board unit test builds a board with a `defaultBranchStore` or a PR record carrying `checksSha`, so removing `board.ts:2143-2144` or `:2352` passes every test. The slice adds a unit test through the existing `opts.defaultBranchStore` seam (`board.ts:217-218`).
- **#1476 L1.** `Estate.defaultBranch` (`estate.ts:54`, `:87`, `:126`) is never read, and the `mockEstate` comment says a mock board gets a fixture store. The slice wires the field into `buildBoard` or removes it and corrects the comment.
- **#1476 L2.** `checksShaSuffix` (`checks-reading.ts:134-137`) tests only `undefined`, so `''` renders `" @"`. The adapters drop an empty SHA today (`host-shell.ts:95`, `pr-refresh.ts:1091`). The rule also tells a GitHub row with no recorded commit "These checks are not bound to a commit", where the board only did not record it. The slice guards `''` and words the absent case as a missing record.
- **#1476 L3.** `checks-reading.test.ts:157-160` asserts `toContain('a048b6f')`, which passes without `.slice(0, 7)`. The slice asserts the exact suffix.
- **#1476 L4.** The green-branch browser test (`agents-tab.browser.test.ts:4052-4066`) waits on "Waiting on you", a fleet-payload signal, so its count of 0 can pass before the board payload lands. The slice waits on a board-payload signal first. No `it(` is added.

#### Slice 6 — Page event throttle

Files: `packages/domain/src/rules/event-window.ts`, `packages/board/src/server/channel-events.ts`, `packages/board/src/app/lib/event-listener.ts`, `packages/board/src/app/App.tsx`, and the tests `packages/domain/test/event-window.test.ts`, `packages/board/test/integration/channel-events.test.ts`, `packages/board/test/unit/event-listener.test.ts`, `packages/board/test/integration/page-hears-channel.browser.test.ts`, `stubbed-tests-start-no-board.test.ts`.

- **#1470 M1.** `ruleEventWindow` (`event-window.ts:30-34`) admits the first event in a window and drops the rest, with no trailing send. The server uses a 1000 ms window (`channel-events.ts:88-95`) and the page a 2000 ms one (`event-listener.ts:35-39`). A finding at 1.3 s passes the server and is dropped by the page until the 30 s poll. The fix: the ruling says when a window dropped an event, and the window's end sends or refetches once. The existing drop test (`page-hears-channel.browser.test.ts:52-59`) changes to expect the trailing request.
- **#1470 M2.** Each tab opens one `EventSource` (`event-listener.ts:34`, from `App.tsx:343`), and the server is HTTP/1.1 only (`packages/board/src/server/index.ts:939`, `:1040`). Six tabs take every connection a browser allows per host, and a seventh never loads. The fix shares one stream between the tabs of one browser: one tab holds the `EventSource` and relays its events over a `BroadcastChannel`, and another tab takes over when it closes. A browser test with several pages proves that the second page opens no stream; it adds an `it(`, so `EXPECTED_TESTS` moves from the base's value by one.
- **#1470 L1.** `channel-events.test.ts:136`, `:151`, `:164-165` and `:175` wait a fixed 50–120 ms to assert an absence, and `:135` waits for the channel, not the hub. The slice waits on the hub's receipt.
- **#1470 L2.** `page-hears-channel.browser.test.ts:54-56` asserts the request count right after `emit`. The slice waits past the page's window before it asserts.
- **#1470 L3.** `attach` sends `welcome` to each new client (`channel-events.ts:142`), and the page refetches on it right after its own first `load()` (`App.tsx:334-343`). Each open builds `/api/board` twice. The fix: the first `welcome` after a page's own load triggers no refetch, decided in the domain rule.
- **#1470 L4.** `let window` shadows the global in browser code (`event-listener.ts:33`) and repeats at `channel-events.ts:59`. The slice renames it.

#### Slice 7 — Mod reload and gate

Files: `mods/plot-follow/hooks/follow.tsx`, `packages/domain/src/rules/follow-channel.ts` and its byte-identical copy `mods/plot-follow/hooks/follow-channel.ts`, and the tests `mods/plot-follow/hooks/follow.test.ts`, `packages/domain/test/follow-channel.test.ts`. `packages/domain/corpus/follow-channel.corpus.test.ts` fails when the two copies differ.

- **#1481 M1.** The connect loop and the retry timer start only in `session.start` (`follow.tsx:92-114`), while `held` lives in `$.state` (`:24`). A `userConfig` change or `/reload-plugins` reloads the module, drops the timers and keeps the old findings on the pane. The fix starts the loop on module load as well, per the `plugin-authoring` reference, and marks the pane stale until the channel answers.
- **#1481 M2.** `turnGate` returns early for a name not in `listed` (`follow-channel.ts:86`), and `clear` is never listed, so a held line stays after its `clear`. The fix removes the held line for the branch a `clear` names. Whether a new day keeps the held lines (`:89`, asserted at `follow-channel.test.ts:81-99`) stays as written unless review decides otherwise.
- **#1481 M3.** `GATE_KEY` (`follow.tsx:20`) is one key for every repo and session, and `readGate` → `turnGate` → `store.set` (`:33-45`) is a read-modify-write without `ifVersion`. The fix keys the gate by repository and writes it with `ifVersion`.
- **#1481 L1.** A fleetd restart republishes every finding after `welcome` (`follow.tsx:69-73`), and the gate reads them as new. The fix compares a republished finding with the held line and starts no turn for an unchanged one.
- **#1481 L2.** The read loop (`follow.tsx:51-83`) calls `lines.return()` only on the `ended` path (`:80`). A throw from `JSON.parse` or `arrive` leaves the follower running, and the next 30 s tick starts a second one. The fix calls `return()` in a `finally`.

### Findings Fixed on Main

- **#1463 L3** (the fold counts the `Release` workflow): fixed by `795adacd4` (#1475). `declaredRuns` (`packages/domain/src/rules/default-branch.ts:39`) filters the runs to the `Default branch checks` names, and `refreshDefaultBranch` applies it.
- **#1481 L3** (`marketplace.json` escapes the em dash): fixed by `63f47da14` (release 2.25.0, #1411). `.claude-plugin/marketplace.json:3` holds the literal character, and the file holds no escape.

### Open Questions

- [ ] **Slice 1:** which bound ends a default-branch reading's hold — `Checks wait` (3600 s in this repo's config), or a multiple of the `prs` beat? The bound must exceed the loop's re-ask interval, or a live red reading expires between asks.
- [ ] **Slice 1:** does the Jenkins newest-build fix belong in `plot-host.sh`'s `jenkins_sha_runs`, or in `build-jenkins.ts`? The adapter keeps the shell smaller, which `check-shell-lines.sh` rewards.
- [ ] **Slice 2 (#1465 L2):** the second half of the finding — a `default branch red` publish in a fold with an unreadable index moves `lastSeen` — conflicts with #1465 M2, which keeps `publish` stamping `now()`. Does the IndexMonitor's liveness come from `seen` only, with `publish` no longer stamping?
- [ ] **Slice 4 (#1437 L4):** is the process start time readable on both macOS and Linux without a shell call per row, or does the fix belong to a later slice?
- [ ] **Slice 6 (#1470 M2):** share one stream between tabs, or document the six-tab limit? Sharing needs leader hand-over when a tab closes; a note costs nothing and leaves a seventh tab unable to load.
- [ ] **Slice 7 (#1481 M2):** should a new day drop yesterday's held lines? The existing test asserts that they carry over.

## Slices

### Default-branch reading age

- `bug/a-stale-default-branch-reading-holds-nothing` — `defaultBranchRed` ignores a reading older than its bound, Jenkins keeps the newest build per SHA, `PENDING_CONCLUSIONS` gains GitHub's three waiting statuses, the `unaskable` arm gets a test, and `CLAUDE.md` names the file's verdict (#1463 M1, M3, L1, L2, L4) <!-- builds: an age bound on defaultBranchRed -->

### Channel heartbeat and inputs

- `bug/the-channel-stamps-what-it-hears` — a test pins `publish`'s `lastSeen` stamp, a merged row keeps its first `mergedAt`, the IndexMonitor reports itself with no slice branches, the relay test puts the older desk first, and the board's findings read uses `logTail` (#1465 M2, M3, L2; #1467 M2, L1) <!-- builds: a terminal mergedAt in storeRow -->

### Fleetd wiring tests

- `bug/the-fleetd-wiring-has-tests` — the `prs` beat and the desk relay become one exported function with tests for the hold, the beat order, a null channel and a relay throw; fleetd stops on SIGTERM, retries a failed bind, warns on a swallowed monitor throw, and relays while ticks fail (#1463 M2; #1465 M1, L1, L3; #1467 M1, L2) <!-- builds: an exported prs beat for registryd-main -->

### Brief-writer row

- `bug/the-brief-writer-row-reads-the-rule` — a domain rule decides the brief note and its age, the field becomes `briefWriter` and derives from the domain's union, a schema test pins its default, the TSDoc states the interface, and a run file records its start time (#1437 M1–M4, L1–L4) <!-- builds: briefWriterNote, a domain rule for the row's note -->

### Board readings wiring

- `bug/the-board-builds-the-default-branch-reading` — a unit test builds a board from a fixture store and a PR record with `checksSha`, the Estate's `defaultBranch` is wired or removed, `checksShaSuffix` handles `''` and names a missing record, and the green browser test waits on the board payload (#1476 M1, L1–L4) <!-- builds: a buildBoard wiring test for the default-branch reading -->

### Page event throttle

- `bug/the-page-hears-the-last-event` — the event window owes one trailing send or refetch after a drop, the tabs of one browser share one stream, the first `welcome` after a load triggers no refetch, absence tests wait on receipt, and `window` is renamed; adds a browser test and moves `EXPECTED_TESTS` (#1470 M1, M2, L1–L4) <!-- builds: a trailing send in ruleEventWindow -->

### Mod reload and gate

- `bug/the-mod-follows-after-a-reload` — the mod reconnects after a reload, a `clear` drops its held line, the turn gate is keyed by repository and written with `ifVersion`, a restart starts no turn for unchanged findings, and the read loop always closes its follower (#1481 M1–M3, L1, L2) <!-- builds: a per-repository turn gate for plot-follow -->

## Notes

- Created unattended by `/plot-idea` on 2026-10-10; the Type `bug`, `Review: pr` and `Impl: own branches` came from the request. The slug check found no plan or branch named `the-channel-closes-its-review-findings`.
- Every finding was checked against `origin/main` at `eb4bda159` by reading the cited code and grepping the tests. No test was run, so each "untested" claim rests on the review's mutation and on a grep that found no assertion.
- Line numbers drift from the issues: #1437 cites `schema.ts:2871` (now `:2901`), #1470 cites `page-hears-channel.browser.test.ts:603-604` (the file has 91 lines; now `:54-56`), and #1476 L1 cites `estate.ts:124` (now `:126`). #1437 M1 says `schema.test.ts` catches a removed default; no test in `packages/board/test` references the field.
- Order and overlap: slice 3 follows slices 1 and 2 (`registryd-main.ts`, `index-monitor.ts`); slice 5 follows slice 4 (`agents-tab.browser.test.ts`). Slices 1 and 6 may both export from `packages/domain/src/index.ts`. The other slices share no file.
- Deliverable search, 2026-10-10: `readingAge` exists at `packages/domain/src/entities/identity.ts:102` (slice 1 reuses it if the shape fits); `trailing refetch`, `newestBuildPerSha` and `briefWriter` name nothing in the estate.
- Sprint `the-gates-and-the-review-findings` has no sprint file on `origin/main` at `eb4bda159`.

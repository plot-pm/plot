# One git cat-file batch per repository

> fleetd and the board each hold one long-lived `git cat-file --batch-command` per repository and answer every object read through it: plan blobs, tree listings, existence and type checks. A request that takes longer than its bound ends the process, fails the waiting reads, and the next read starts a new one.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** desk-probes-and-liveness
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged

## Changelog

- fleetd and the board read plan files and tree listings from one `git` process that stays open, instead of starting `git ls-tree` and `git cat-file` for each read. A process that stops answering is replaced, and the reads it held fail instead of hanging.

Board impact: none visible. The board's own reader (no fleetd) and `GET /api/board` start fewer processes, because they read plans through the same `Refs` adapter. The plan format, the template, the helper scripts and the `docs/plans` layout do not change; `board-server.mjs` rebuilds on `main`.

## Motivation

Census S4 on the sprint PR #3277 (CI run 42595561157, `census-report-head` artifact) counts per idle fleetd pass, 5 open PRs: GitHub 0 desks 1124.5, GitHub 3 desks 2585.5, Bitbucket 3 desks 2676. The object reads in that count are:

| Command key | Per pass (GitHub 0 / 3 desks, Bitbucket 3) | Source in this worktree |
|---|---|---|
| `git ls-tree` | 37 / 37 / 16 | `listBlobs`, `ls-tree -r <ref> -- <dir>` (`packages/domain/src/adapters/refs/refs-git.ts:686-700`), called by the plan store once per ref it reads (`packages/domain/src/adapters/plan-store/plan-store-ref.ts:79`) and per idea branch by the scan (`packages/fleet/src/shared/fleet-scan.ts:402`); `entriesAt`, `ls-tree -z --full-tree` (`refs-git.ts:492-497`) |
| `git cat-file` | 12 / 12 / 8.5 | `readBlobs`, one `cat-file --batch` per call (`refs-git.ts:702-716`, `plan-store-ref.ts:121`); `containsMany`, one `cat-file --batch-check` per call (`refs-git.ts:936-941`). The census key also counts `fileExistsSync`, one `cat-file -e` per path (`refs-git.ts:809-814`), which this plan leaves on one process per call; the census does not split `-e` from the two batch forms, so the `-e` share of the 12 is unmeasured until slice 2's PR states it |

That is 49 of 1124.5 `execve` per pass on GitHub with 0 desks (4.4 %) and 24.5 of 2676 on Bitbucket with 3 desks. The `cat-file -e` starts stay inside those figures after this plan, so the part this plan removes is 49 minus the `-e` share. More object reads sit outside the idle pass and outside the census fixture: `showFile`, one `git show <ref>:<path>` per file (`refs-git.ts:750-751`); the board's release-version read, one `git show origin/<branch>:package.json` per release branch (`packages/board/src/server/fleet.ts:1410`); the brief check, one `cat-file -e` per dispatch candidate (`packages/fleet/src/shared/auto-dispatch.ts:340`); and `trees-git.ts:610`, `packages/board/src/server/entry/review.ts:618`.

The batch shape already exists per call. `readPlansFromRef` reads every plan blob "in ONE `git cat-file --batch`" (`packages/board/src/server/board.ts:855`) and measured 1.5 s for one process per file against 0.011 s for one batch on 2026-08-27. What remains is one process per call instead of one per repository.

`git log` (35 per pass) and `git rev-list` (5 per pass) walk history; `cat-file` cannot answer them, and this plan leaves them.

## Design

This plan depends on `the-snapshot-entity` (delivered): the `plans` reading is what the object reads fill. It works better after `refs-from-files` (this sprint): the reader takes object ids, and `refs-from-files` resolves a ref name to an oid with no process. Without it, `cachedRefs` (`packages/domain/src/workflows/plan-walk-cache.ts:261`) still resolves names from the beat's one `for-each-ref`. `triggers-replace-the-tick` (Phase 8) depends on this plan, because a plan-content event re-reads blobs. It shares `refs-git.ts` with `refs-from-files`, which changes the ref and default-branch methods (`defaultBranch`, `branchDates`) while this plan changes the object-read methods (`readBlobs`, `listBlobs`, `entriesAt`, `showFile`, `containsMany`); the second to merge rebases. No other plan of this sprint (`desk-probes-in-domain`, `github-reads-in-process`, `node-worker-wrapper`, `liveness-token`, `sprint-prs-run-ci`) touches `refs-git.ts`'s object reads.

This plan moves census row **S4** down on every fixture and leaves it `it.fails`: its zero belongs to `triggers-replace-the-tick`. One `git cat-file` start per repository happens when fleetd starts and is outside every pass.

### Approach

**The minimum git.** Plot requires git 2.42 or later: `--batch-command` needs 2.36 (April 2022) and `-z` input needs 2.42. fleetd and the board server read `git --version` once at start, and an older git refuses the start with a named message, for example `plot needs git 2.42 or later for its object reader; found git 2.34.1`. The reader has no two-process fallback for an older git. The requirement line of `skills/plot-board-setup/SKILL.md` ("Requires git, bash, curl, and the Node …") names the minimum, and `plot-board-probe.sh` reports the git version beside the Node version.

**One process, one queue.** `packages/domain/src/adapters/refs/objects-batch.ts` exports `objectsBatch({ repoRoot, gitDir, timeoutMs })`, with `timeoutMs` 10,000 (10 s) per request: the largest batch today reads 623 blobs (7.5 MB) in 63 ms (`packages/board/src/server/fleet.ts:1652`), so the bound leaves a factor of more than 150. It starts `git cat-file --batch-command --buffer` on the first request. Git answers in request order, so the reader keeps a FIFO of pending requests and frames each answer by its declared byte length, as `blobsOf` does today (`refs-git.ts:60-93`). It sends `contents <oid>` for a blob or tree, `info <oid>` for an existence or type check, and `flush` after each request. It accepts an object id or `<oid>:<path>` only. It never takes a ref name, so a long-lived process cannot answer from a ref it read before the ref moved. A path holding a newline is refused before it reaches the process, because one stray newline shifts every later answer.

**A tree listing from tree objects.** `listBlobs` and `entriesAt` read `<oid>:<dir>` as a tree object and walk its subtrees through the same process. The tree format (`<mode> <name>\0<20-byte oid>`, repeated) is a git rule this code now repeats, so the tree parser is a pure function in `packages/domain/src/rules/git-tree.ts` and a declared duplicate: `packages/domain/corpus/git-tree.corpus.test.ts` compares `listBlobs` through the batch with `git ls-tree -r` at `origin/main` and at every `origin/idea/*` tip of this repository. A disagreement names the ref, the path and both answers.

**The bound, and what a wedge costs.** A wedged process blocks every read queued behind it. The bound is per request:

| Event | Answer |
|---|---|
| No complete answer within `timeoutMs` | the reader sends `SIGKILL` to the process, fails the request in flight and every queued request with `failed`, and drops the process |
| The process exits, closes stdout, or stdin raises `EPIPE` | the same as a timeout |
| A header the reader cannot parse | the same as a timeout: the stream is out of step and no later answer can be trusted |
| `<oid> missing` or `<oid> ambiguous` | an answer for that request only; the process stays |
| The next request after a drop | starts a new process |
| 3 drops within 60 s | the reader stops starting processes for 60 s and answers `unaskable`; `refsGit` then runs today's per-call process, so a read slows down and never stops |

A failed read is never an empty one. `readBlobs` answers `failed`, and the plan store already reads that as a failed `plans` reading, not as "no plans" (`the-snapshot-entity`: "An unread reading is never an empty one").

**New objects after a fetch.** A long-lived `cat-file` must see objects that a later `git fetch` writes. Git re-scans its pack directory when an object is not found, so an oid the process has not seen before is found. A test fetches into a sandbox after the reader starts and reads the new blob through the same process.

**Who holds the process.** `refsGit` is built at 83 sites in `packages/board/src` and `packages/fleet/src`, many inside short-lived CLI bundles such as `plot-ask.mjs`. A long-lived process there would keep the bundle from exiting or would start one process to answer one read. So the reader is installed, not built by default: a process-level holder keyed by the common git directory, as `processAnswers` holds the fixed answers (`packages/domain/src/adapters/git-dirs/git-dirs.ts:259`). fleetd's start (`packages/fleet/src/server/entry/registryd-main.ts`) and the board server's start install it. Every other process keeps one `git` per call, as today. The process and its pipes are `unref`'d, so it never holds a process open, and it ends with its owner when stdin closes.

**Slice 1: the reader.** `objectsBatch` with the FIFO, the framing, the bound and the drop rule; `git-tree.ts` and its corpus test. Adapter tests run against a real sandbox repository and against a stub `git` on `PATH` that stops answering, so the timeout, the exit, the `EPIPE` and the out-of-step header each have a row.

**Slice 2: the adapters read through it.** When a reader is installed, `readBlobs`, `listBlobs`, `entriesAt`, `showFile` and `containsMany`'s `--batch-check` use it and start no process. The board's release-version read (`fleet.ts:1410`, one `git show origin/<branch>:package.json` per release branch) moves to `showFile` and reads through the board's reader. `fileExistsSync` is synchronous and a pipe answer is not, so it stays on one `cat-file -e` per call; its callers stay synchronous. `branchDates` stays on `for-each-ref`: reading the committer line through the batch is a third declared duplicate, and a later plan takes it. fleetd and the board server install the reader and check the git version. The census S4 report on the sprint PR shows the effect.

### Open Questions

- [x] `--batch-command` needs git 2.36 (April 2022), and `-z` input needs 2.42. This machine runs git 2.56.0; the repository states no minimum git version. A person decides the minimum, or the reader falls back to two processes (`--batch` and `--batch-check`) on an older git. **Decided 2026-11-09, jwloka: require git 2.42. fleetd and the board refuse an older git at start with a named message; `skills/plot-board-setup/SKILL.md` documents the minimum.**
- [x] `timeoutMs`: the largest batch today reads 623 blobs (7.5 MB) in 63 ms (`packages/board/src/server/fleet.ts:1652`). This plan proposes 10 s per request. A person confirms the figure. **Decided 2026-11-09, jwloka: 10 s per request.**
- [x] `fileExistsSync` is called on synchronous paths. Either its callers move to an async `fileExists`, or it keeps one process per call. This plan keeps it; a person decides whether a later plan moves the callers. **Decided 2026-11-09, jwloka: `fileExistsSync` stays one process per call.**
- [x] `branchDates` reads `%(committerdate:unix)` through `for-each-ref` (`refs-git.ts:816-833`). After `refs-from-files`, the batch can read the commit object and its committer line, and `branchDates` starts no process. That is a third declared duplicate (the commit header). A person decides whether slice 2 takes it or a follow-up plan does. **Decided 2026-11-09, jwloka: a later plan moves `branchDates`.**
- [x] The board's release-version read (`fleet.ts:1410`) starts `git show` per release branch while the board runs its own reader. Slice 2 moves it to `showFile` through the reader if the board's composition root reaches it; a person confirms that this belongs here and not in a board plan. **Decided 2026-11-09, jwloka: it belongs here; slice 2 moves it to `showFile`.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| One process answers many reads | adapter test: 100 `contents` and `info` requests through one reader start 1 `git` process (spawn spy) | Reader |
| Answers keep their order and their bytes | adapter test: blobs holding `—` and `→` decode correctly when interleaved with `missing` answers | Reader |
| A wedged process fails its reads and is replaced | stub `git` that stops answering: the request in flight and 2 queued requests answer `failed` after `timeoutMs`, and the next request starts a new process | Reader |
| An exit, `EPIPE` or out-of-step header is a drop | one row each, same answer as the timeout | Reader |
| Repeated drops fall back, never stop | 3 drops within 60 s: the reader answers `unaskable` for 60 s, and `refsGit.readBlobs` returns the per-call answer | Reader |
| A ref name never reaches the process | `objectsBatch` refuses `origin/main` and a path holding a newline before it writes to stdin | Reader |
| A fetch after start is visible | sandbox test: a blob fetched after the reader starts reads through the same process | Reader |
| The tree parser agrees with git | `git-tree.corpus.test.ts`: `listBlobs` through the batch equals `ls-tree -r` at `origin/main` and every `origin/idea/*` tip; a disagreement names ref, path and both answers | Reader |
| An older git is refused by name | a start test with a stub `git --version` answering 2.41.0: fleetd and the board server each refuse the start with the message naming 2.42 and the version found; 2.42.0 starts | Adapters |
| The release-version read uses the reader | spawn-spy row: the board's release-version read starts no `git show` with a reader installed | Adapters |
| A CLI bundle never holds the process | `plot-ask.mjs board` exits with no reader installed, and the reader's process is `unref`'d (test reads `hasRef()`) | Adapters |
| fleetd's pass reads objects with no process | `--once` test over the census fixture with a spawn spy: `git ls-tree`, `git cat-file --batch` and `git cat-file --batch-check` start 0 times after the first pass; `git cat-file -e` starts once per `fileExistsSync` call and the test states that count per pass separately | Adapters |
| S4 moves | census S4 on the sprint PR: `git ls-tree` reads 0 per pass on every fixture, `git cat-file` reads only the `-e` starts of `fileExistsSync` (stated per fixture in the PR), and S4 drops on GitHub with 0 desks against the merge base by 49 minus those `-e` starts | Adapters |

## Slices

### Reader

- `feature/one-cat-file-batch-reader` — `objectsBatch` in `packages/domain/src/adapters/refs/objects-batch.ts`: one `git cat-file --batch-command --buffer`, a FIFO, byte framing, the 10 s per-request bound, drop and fallback; the tree parser in `packages/domain/src/rules/git-tree.ts` and `packages/domain/corpus/git-tree.corpus.test.ts`; adapter tests with a sandbox and a wedging stub `git` <!-- builds: objectsBatch, a long-lived bounded git cat-file reader per repository -->

### Adapters

- `feature/one-cat-file-batch-adapters` — a process-level holder beside `processAnswers`; `readBlobs`, `listBlobs`, `entriesAt`, `showFile` and `containsMany` read through an installed reader; the release-version read through `showFile`; fleetd and the board server install it and refuse a git older than 2.42; the minimum in `plot-board-setup` and `plot-board-probe.sh`; a `--once` spawn-spy test; a changeset <!-- builds: Refs object reads served by one installed cat-file process in fleetd and the board -->

## Notes

- Phase 5 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), candidate plan `one-cat-file-batch`; depends on `the-snapshot-entity`, and runs best after `refs-from-files`.
- Census figures: `census-report-head` artifact of CI run 42595561157 (PR #3277, 2026-11-09). The report records two passes per S4 row; the per-pass figures above are half the recorded command counts. The report keys by image and first argument, so it does not split `cat-file --batch`, `--batch-check` and `-e`; slice 2's PR states that split.
- The story names "`git cat-file --batch` (and `--batch-check`)". `--batch-command` answers both in one process, and the plan requires git 2.42.
- Line numbers checked in this worktree (`idea/batch-refs-from-files`, cut from `origin/sprint/the-board-reads-the-channel`) on 2026-11-09.
- Deliverable search (`plot-deliverable-search.sh`) for "one-cat-file-batch", "cat-file --batch" and "object reader": no long-lived reader exists. The hits are the per-call batch readers this plan reuses: `refs-git.ts:60-93`, `:709`, `:939`, `board.ts:855`, `fleet.ts:1642-1652`, and the byte-shaped `runBytes` (`packages/domain/src/adapters/run-script.ts:221-263`).
- Definition of Done: docs/definition-of-done.md.

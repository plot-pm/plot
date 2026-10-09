# A blocked agent's question has no route: continue refuses no-manifest

> A desk whose agent ended `blocked` stays addressable until its question is answered or released, so `/api/continue` can deliver the answer the board asks a person for.

## Status

- **State:** Released
- **Type:** feature
- **Issue:** #1366, #1375
- **Sprint:** the-release-train-fixes-what-it-found
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-08, jwloka, in-session
- **Started:** 2026-10-08, jwloka, `feature/a-blocked-ending-routes-its-answer`
- **Started:** 2026-10-08, jwloka, `feature/a-blocked-desk-is-not-held-by-a-free-wait`
- **Started:** 2026-10-08, jwloka, `bug/the-loop-resumes-a-continuation`
- **Delivered:** 2026-10-08
- **Released:** 2026-10-08, v2.24.1

## Changelog

- An answer to a blocked agent's question reaches the agent: `/api/continue` finds a desk whose loop ended `blocked` from the desk's own ending record, and no longer refuses it `no-manifest` because the loop has left.
- A blocked desk whose restarted loop is waiting free for a slice is no longer refused `loop-alive` either: `continue` stops that loop, waits for it to exit, writes back the manifest its `SIGTERM` cleanup removed, and continues. A loop actually working a turn still refuses, and the sentence now says so.

<!-- Board impact: the `no-manifest` and `loop-alive` sentences in
     `ContinueWithAnAnswer.tsx` change with the refusals they describe. No plan
     format, template or docs/plans layout change. -->

## Motivation

On 2026-10-08 the agent on `bug/local-checks-find-tests-in-a-temp-worktree` (desk `.worktrees/free-b5f1581a`) wrote `PLOT-BLOCKED.md` with a real question: the brief's regression test cannot fail on `origin/main` on this machine, so how should it proceed. The desk's `.plot-worker.ending.json` reads `{"reason":"blocked","actor":"agent","branch":"bug/local-checks-find-tests-in-a-temp-worktree"}`.

The loop then restarted onto a newer bundle and logged `free on ? — nothing handed over yet`. The board showed the slice under WAITING ON YOU, and `plot-fleetctl --status` listed it as `waiting (pid 43381)`. `POST /api/continue` answered `no-manifest`: `.plot/agents` held no manifest naming the desk.

So the board asks a person for an answer that no controller can deliver. The operator has two routes, and both are closed: a hand edit of the desk breaks *The Master Agent Uses The Controllers*, and a release plus a fresh dispatch has no controller until #1276 lands.

The cause is in two readings that cannot both hold:

- **The manifest lives exactly as long as the loop.** `worker-loop.ts:2153-2160` removes `PLOT_MANIFEST_FILE` in both `leaveNow` and `leave`, so a loop that exits takes its manifest with it.
- **`/api/continue` needs a manifest and refuses a live loop.** `continue.ts:687` refuses `no-manifest` when `deskManifestFor` answers `unnamed` or `several`, and `continue.ts:711` refuses `loop-alive` when any recorded pid is alive.

While the loop waits free on the desk, the second refusal holds; once it leaves, the first does. The window in which a continuation can start is a loop that died without running `leave` — a crash or a `SIGKILL`.

The desk already carries an addressable record. `.plot-worker.ending.json` (`ENDING_FILENAME`, `packages/domain/src/entities/ending.ts:15`) names the branch and the reason, and it survives the loop. Nothing reads it to find a desk for a continuation.

## Design

### Approach

One domain rule answers *which desk does an answer for this branch go to, and what blocks it*. `/api/continue` calls it instead of reading `deskManifestFor` alone.

- **`continueTarget(readings)`** — readings are the desk's manifest answer (`named` / `unnamed` / `several`), its ending record (reason, branch), its marker, and its loop pids with their state. It answers one of:
  - `continue` with the manifest to stamp — a manifest names the desk, as today;
  - `continue` with a manifest to **write** — no manifest names the desk, and its ending record reads `blocked` for the asked branch with an unanswered marker in the tree;
  - a refusal, named as today (`no-manifest`, `several`, `loop-alive`, `no-question`).
- **The ending record is the fallback, not a second registry.** It is desk-local, written by the loop that asked, and already carries the branch. A blocked ending whose branch differs from the asked branch is refused, so a stale record from an earlier slice cannot route an answer to the wrong work.
- **The continuation writes the manifest it needs.** `PLOT_MANIFEST_FILE` must name a file for `loopRegistration` (plan `a-desk-and-its-manifest-name-each-other`) to end the new loop's wait honestly, so the route writes one through the existing manifest writer before it starts the loop, and only after every refusal has been asked. A refused continuation still writes nothing.
- **`several` stays a refusal.** Two manifests on one desk remain an estate defect, as `continue.ts:122-131` states.

### Open Questions

- [x] **A free wait on a blocked desk.** *Answered 2026-10-08, jwloka: (b). `continue` stops a loop that reports a free wait and refuses every other live loop; the loop's life cycle stays as it is.* In the measured case the restarted loop waited free on the desk that holds the question, and `continue` would refuse it `loop-alive` even with a manifest. A free wait holds no turn, so stopping it loses no work — which the `loop-alive` rationale (*"a stop can land mid-turn"*) does not cover. Two answers: (a) a loop whose desk holds an unanswered `PLOT-BLOCKED` marker does not wait for a hand-over on that desk and exits; (b) `continue` stops a loop that reports a free wait and refuses every other live loop. (a) keeps "refuse, never stop" whole; (b) needs the loop's wait state as a reading.
- [x] **Keep the manifest instead.** *Answered 2026-10-08, jwloka: read the ending record; the manifest keeps its meaning.* The issue proposes that a blocked ending keeps its manifest until the question is answered or released. That changes what a manifest means — today a manifest with no live loop reads as a registered agent to `registryd` and `/plot-fleet --status` — so this plan reads the ending record instead. Confirm, or name the reader that needs the manifest.
- [ ] **Why the registry was empty while pid 43381 ran.** *Reopened 2026-10-08 by the review of #1372 (#1373): `main()` also calls `leave()` on a normal return (`worker-loop.ts:2286`), `onStop` exits the process after cleanup, and `deregister` and `reap` also remove manifests. The answer below came from reading code, not from the desk or registryd logs; measure it before slice 2 relies on it.* *Measured 2026-10-08, before the first slice wrote the rule: neither hypothesis holds.* An `execve`-based restart (`worker-loop.ts:335`, `reexec`) does not run `leave`/`leaveNow`, and does not drop `PLOT_MANIFEST_FILE` — it is spread through explicitly via `{...deps.env, PLOT_WAIT_STARTED, PLOT_HOP_FROM}`. `leave`/`leaveNow` run only behind `onStop`'s `SIGTERM`/`SIGINT`/`SIGHUP` handlers, so at some point in pid 43381's lifetime — which an `execve` restart does not interrupt, since the pid is unchanged — the process received one of those signals, which deleted the manifest. Nothing downstream recreates it: a later restart's `main()` only re-reads `env.PLOT_MANIFEST_FILE` and calls `stampManifestLoopJs`, which no-ops silently against a missing file. *Measured 2026-10-08 after #1376, and still open: a `SIGTERM` to a loop removes the manifest the board stamps next.* `continue-route.test.ts` › *a stopped loop that removes its own manifest* starts a process whose `SIGTERM` handler removes `PLOT_MANIFEST_FILE`, as `leaveNow` does (`worker-loop.ts:2190`), and lets `continueOnDesk` stop it with no injected stop. On #1376's head the route answered 202 and left no manifest, and the fresh start answered `failed` after the old loop was already gone. `continueOnDesk` now reads the manifest before the stop and writes it back after. The test proves that one `SIGTERM` path removes a manifest while its loop is stopped. It does not show which signal pid 43381 received, or from whom, so the question stays open.
- [ ] **Release.** A blocked desk whose question is never answered is released through #1276's controller. This plan adds no release path; it states that the ending record stops routing once the claim is released.

### What this does NOT do

- It does not add a release or re-dispatch controller (#1276).
- It does not change which endings ask a person — that is `every-loop-ending-has-a-supervisor-rule` slice 3, `infra/an-unrepaired-ending-asks-a-person`. This plan makes the answer to such a question deliverable.

## Slices

### The ending record routes an answer

- `feature/a-blocked-ending-routes-its-answer` — `continueTarget` in the domain with one test per answer, `/api/continue` calling it, and the manifest written for a continuation found by its ending record → #1372 <!-- builds: continueTarget, the desk an answer goes to -->

### A blocked desk is not held by a free wait

- `feature/a-blocked-desk-is-not-held-by-a-free-wait` — the answer to the first Open Question, and the `loop-alive` sentence in `ContinueWithAnAnswer.tsx` → #1376 <!-- waits: feature/a-blocked-ending-routes-its-answer -->

### A stopped loop keeps its manifest

- `bug/a-stopped-loop-keeps-its-manifest` — the fix for the two HIGH review findings on #1376, which merged with them open: a stopped loop's manifest is read before the stop and written back after it, the free wait is re-read before the signal, the wait for exit is bounded, and Open Question 3 is open again (#1377) → #1378

### The loop resumes a continuation

- `bug/the-loop-resumes-a-continuation` — the JS worker loop reads `.plot-worker.continue.md` and resumes the blocked session (`resumeId`) with the answer instead of taking the slice up again; uncommitted work on the desk's own assigned branch is the slice's own work, not foreign unlanded work; and an answer routes to a desk whose ending reads `holding-work` while its `PLOT-BLOCKED.md` is still unanswered (#1375) → #1380 <!-- waits: feature/a-blocked-desk-is-not-held-by-a-free-wait --> <!-- builds: the loop's continuation path -->

## Notes

**Done when:**

- A continuation reaches the JS loop: given a desk with `PLOT-BLOCKED.md`, uncommitted work on its own branch and `.plot-worker.continue.md`, the loop resumes the blocked session with the continuation text, does not end `holding-work`, and does not overwrite the ending before the turn runs. Observed failure: #1375, desk `free-b5f1581a`, 2026-10-08 16:43.

- A desk with a `blocked` ending record for branch B, an unanswered marker, no manifest and no live loop: `POST /api/continue {branch: B}` starts a loop with a manifest that names the desk.
- The same desk with an ending record for a different branch is refused, and nothing is written.
- A desk in the measured state — blocked, its loop waiting free — accepts a continuation, through whichever answer the first Open Question takes.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

**Created unattended, 2026-10-08.** Ceremony follows this repo's practice for issue plans: `in-session` review, `own branches`, plan committed to `main`. Overlapping plans: `a-desk-and-its-manifest-name-each-other` (built `deskManifestFor`, `loopRegistration` and the `no-manifest` refusal) and `every-loop-ending-has-a-supervisor-rule` (decides what each ending does). The deliverable search found no `continueTarget`; `deskManifestFor` (`packages/board/src/server/manifest-stamp.ts:207`) is the reading this rule wraps, not a duplicate.

Related: #1250, #1283, #1276.

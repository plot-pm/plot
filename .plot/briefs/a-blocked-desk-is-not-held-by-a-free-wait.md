## Implementation brief — a-blocked-agent-s-question-has (wave 2: A blocked desk is not held by a free wait)

- **Plan (canonical):** `docs/plans/2026-10-08-a-blocked-agent-s-question-has.md` on `main`
- **Approved:** 2026-10-08, jwloka, in-session
- **Branch:** `feature/a-blocked-desk-is-not-held-by-a-free-wait` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issue #1366

This wave waits on `feature/a-blocked-ending-routes-its-answer`, which merged as #1372. Nothing waits on this wave.

### What to build

On 2026-10-08 the agent on `bug/local-checks-find-tests-in-a-temp-worktree` (desk `.worktrees/free-b5f1581a`) wrote `PLOT-BLOCKED.md` with a real question. The loop then restarted and logged `free on ? — nothing handed over yet` (`worker-loop.ts:1514`). The board listed the slice under WAITING ON YOU, and `POST /api/continue` answered `no-manifest`. Wave 1 fixed that refusal: `continueTarget` (`packages/domain/src/rules/continue-target.ts`) now routes the answer by the desk's ending record when no manifest names the desk.

Wave 1 left the second refusal in place. In the measured state the restarted loop is alive and waits free on the desk, so `continueTarget` answers `loop-alive` (`continue-target.ts`, line `if (reading.loop.kind === 'alive')`) before it reads the manifest or the ending. The route never reaches the write. The third bullet of the plan's `Done when` — a desk that is blocked with its loop waiting free accepts a continuation — fails today.

Build, in this order:

1. **A reading that says a loop waits free.** The rule needs this as a value. Read first what the loop already records on the desk: no file or manifest field names a free wait today (`PLOT_WAIT_STARTED` in `worker-loop.ts:403` is process environment, and the `free on` line goes to the log). Settle the carrier from the code, record the choice in the PR body, and keep it a desk-local fact written by the loop that holds the wait. The reading must be absent-safe: a missing or unreadable record means "not a free wait", so the loop stays a refusal.
2. **`continueTarget` takes the reading.** Add the value to `ContinueTargetReading` and the stop to `ContinueTarget` as a third `continue` outcome or an additional field — your choice, but the rule stays pure, imports `zod` and nothing else, and has one test per answer. A live loop that reports a free wait yields a *stop, then continue*. Every other live loop still yields `loop-alive`.
3. **`continueOnDesk` performs the stop.** The route stops the free-waiting loop only after every refusal was asked, and before it writes the continuation. It keeps its refusal order. A refused continuation still writes nothing and stops nothing.
4. **The `loop-alive` sentence in `ContinueWithAnAnswer.tsx`** (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:49`, currently *"A loop is already running in this worktree — stop it first, then continue."*) changes to say what the refusal now means: a loop that is working a turn. Add the matching assertion in the component's test.

### Settled decisions — do not re-derive them

- **Answer (b), not (a).** Answered 2026-10-08, jwloka: `continue` stops a loop that reports a free wait and refuses every other live loop; the loop's life cycle stays as it is. Alternative (a) — a loop whose desk holds an unanswered `PLOT-BLOCKED` marker does not wait for a hand-over and exits — was rejected because it changes the loop for every desk, and it keeps no record of why a loop waited. Do not edit the loop's wait logic to exit on a marker.
- **A free wait holds no turn, so a stop loses no work.** This is the whole licence for the stop. The existing `loop-alive` rationale (*"a stop can land mid-turn"*) does not apply to it, and it must keep applying to every loop that does not report a free wait. A loop whose record is missing, stale or unreadable is not a free wait: the rule refuses it.
- **The stop must not let the old loop delete what the continuation needs.** `leave` and `leaveNow` remove `PLOT_MANIFEST_FILE` on `SIGTERM`/`SIGINT`/`SIGHUP` (`worker-loop.ts:2153-2160`). When the route stamps an existing manifest and then stops the loop, the loop's cleanup can remove that manifest between the two steps. Order the steps so the manifest that the new loop uses exists after the old loop has gone: wait for the old pid to exit, then resolve the manifest (stamp, or write), then start. Test this order by name. Do not touch `leave` or `leaveNow`.
- **The ending record stays the fallback, and the manifest keeps its meaning.** Settled in wave 1 and unchanged here. A `write` outcome still requires a `blocked` ending for the asked branch and an unanswered marker.
- **The stop is as targeted as the refusal.** Signal only the pid that `deskLoopAlive` named, and only after the free-wait reading is confirmed for that same desk. A `pkill -f` over process names is the shape `plot-board` refuses (it killed an operator's board on 2026-09-04). A pid that no longer exists at stop time is success, not an error.
- **Carried-over invariants:** absent is not false (no reading means refuse, not stop); read the exit code, not the emptiness; `EPERM` on a pid reads as alive (`pidAliveEverywhere`), so a loop that cannot be signalled is refused, not skipped.
- **Open Question 3 is open, and this wave must not build on its old answer.** The plan's third Open Question was reopened by the review of #1372 (#1373): `main()` also calls `leave()` on a normal return (`worker-loop.ts:2286`), `onStop` exits after cleanup, and `deregister` and `reap` also remove manifests. Read those call sites, measure with the desk or `registryd` log where one exists, and write the finding in the PR body and in the plan's Open Questions. If it shows the restart path deletes the manifest of a live loop, report it as a separate defect; do not fix it here.
- **Release is out of scope.** The ending record stops routing once the claim is released (#1276). Add no release path.

### Done when

The plan's `## Notes › Done when` list is the specification. Its third bullet belongs to this branch: a desk in the measured state — blocked, its loop waiting free — accepts a continuation. The first two bullets are wave 1's and must still pass.

Assertions that exist because a naive implementation passes without them:

- **A loop that is mid-turn is still refused `loop-alive`, and its pid is still alive after the call.** A rule that stops every live loop passes the free-wait test and kills work.
- **A live loop with no free-wait record is refused and not signalled.** Absent is not a free wait.
- **A free wait on a different desk's record does not license a stop here.** The reading is per desk, and the pid stopped is the pid read from this desk.
- **After the stop, the manifest the new loop receives exists and `deskManifestFor` answers `named`.** A route that stamps first and stops second passes a file-exists check at the wrong moment.
- **A refusal after the rule said "stop" leaves the old loop running.** For example `no-worker-command`: the loop is alive and unsignalled, and the desk holds no new file.
- **The component sentence for `loop-alive` no longer tells a person to stop a loop that the route would stop itself.**

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset (description first, `bumps:` block last). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/continue-target.ts` and its test, the reading's carrier (new domain file if the carrier needs one), `packages/board/src/server/continue.ts`, `packages/board/src/app/components/ContinueWithAnAnswer.tsx`, the loop's write of the free-wait record in `packages/board/src/server/entry/worker-loop.ts` (that write only — not the wait logic, `leave` or `leaveNow`), and their tests.

Branches of other plans that touch the same files, verified 2026-10-08 against `origin/main`:

- `infra/an-ending-that-held-nothing-releases-its-claim` changes `packages/board/src/server/entry/worker-loop.ts`. Rebase onto `main` before the PR, keep both sides on a conflict, and re-read `EndingReason` and `readEnding` from `main` because the reason list may have moved.
- `bug/local-checks-find-tests-in-a-temp-worktree` is the blocked desk of the measured case. It touches none of this wave's files. Do not answer its question or edit its desk from this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

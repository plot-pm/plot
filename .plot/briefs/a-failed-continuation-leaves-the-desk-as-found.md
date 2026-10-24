## Implementation brief — a-desk-continuation-skips-its-run (wave: Continuation, 2 of 2)

- **Plan (canonical):** docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2491 merged
- **Branch:** `bug/a-failed-continuation-leaves-the-desk-as-found` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This is the second of two branches in the Continuation wave. It waits on `bug/continuation-reads-the-loops-run-limits`, which merged as PR #2511 on 2026-10-24 (commit `31bcf15d1`) — so `continueOnDesk` in `packages/fleet/src/shared/continuation.ts` already carries that slice's parser and manifest-accounting fixes. Rebase onto current `main` before starting; the line numbers below are read against `main` at the time this brief was written, not the plan's original `84b1638e4`.

### What to build

Three failure-handling defects in `continueOnDesk` (`packages/fleet/src/shared/continuation.ts`), found by plot-review against 16 merged PRs (issue #2475):

1. **A failed stop returns before the manifest is restored.** `restoreManifest(stampPath, manifestBeforeStop)` runs at line 877, but two earlier returns in the same `if (target.stop !== undefined)` block skip it: line 863 (`if (!stopped.ok) return refused(409, 'loop-alive', stopped.why)`) and line 867 (`if (!wrapperStopped.ok) return refused(...)`). Both fire after `SIGTERM` was already sent to the loop pid (line 862) and removed `PLOT_MANIFEST_FILE` via the loop's own `onStop` handler (the comment at line 789-792 names this handler). A caller who gets either refusal finds a desk with no manifest and no running loop — not the pre-continuation state the refusal implies, and not a fresh start either. Both returns need the same restore the success path performs before they return.

2. **The prompt is written before several steps that can still fail, and none of them remove it.** `promptPath` (`.plot-continuation.md`) is written at line 896. From there, the function can still return `failed` at lines 912-915 (opening `.plot-worker.log` fails), 947-950 (`writeDeskManifest` returns null), 957-960 (`assignEmptyManifestBranch` fails), 967-973 (`writeResumeId` fails), and 1066-1069 (the spawn errors). None of these unlink `promptPath` first. (The write failure itself, lines 897-901, is the one early return that never created the file — nothing to clean up there.) A later loop that starts on this worktree reads `.plot-continuation.md` via `PLOT_CONTINUATION` and resumes a session with an answer that was never actually accepted — the prompt is this run's only record of "did this start," and a failed run must not leave it looking like a pending one did.

3. **The wrapper pid is signalled with no ownership check; the loop pid is.** At line 841, before `stop(pid)` is even called, `deskWaitsFree(deskFreeWait(worktree), pid)` confirms the loop pid still belongs to this desk's free wait — a refusal there (`pid ${pid} left its free wait before the stop`) is exactly a guard against pid reuse. `wrapperPid` (read from the manifest at lines 853-860) gets no equivalent check: `wrapperStop(wrapperPid)` at line 866 sends `SIGTERM` straight from the manifest's recorded value. After pid reuse — the wrapper exited, the OS recycled its pid, and something unrelated now holds it — this kills that unrelated process. The loop pid's check is the pattern to extend to the wrapper pid, not a new mechanism to invent; the plan's Open Question #2 (process start time vs. working directory) is about *how* to compare, since neither is recorded in the manifest today — decide and record whichever you pick.

### Decisions this plan settles — do not re-derive them

**This is a continuation of the SAME function the previous slice touched — read its current shape before editing, not the plan's line numbers.** `bug/continuation-reads-the-loops-run-limits` (PR #2511) already restructured the run-limit and spend-limit checks (now at lines 807-833) and already seeds `sliceRuns: 1` on the write path (line 945). Nothing in this slice's scope touches those; this slice's three findings are all in the `target.stop` block (lines 839-880) and the prompt-write-through-spawn sequence (lines 882-1069) that sit after them.

**The pid-ownership comparison is still open — the plan does not choose process start time vs. working directory, and neither is recorded in the manifest today.** Pick one, record what it needs (a new manifest field, most likely), and say in the PR which you chose and why — this is exactly the shape of decision a later slice or reviewer needs named, not re-derived.

**Prompt removal on failure must not touch a prompt this run did not write.** Every failing return after line 896 wrote `promptPath` itself in this same call — unlink it unconditionally on those paths. Do not add a removal to any refusal that returns *before* line 896 (lines 705-731, 766-782, 804, 818, 822-826, 831), since those never created the file; removing on a path that wrote nothing risks deleting a different run's prompt if one somehow exists.

**Rules carried over unchanged, worth restating because a misread here hides a desk silently stuck:** absent is not the same as unreadable (`DollarsReading`'s three-way kind, settled by the prior slice) — the same discipline applies to a restore that silently no-ops versus one that actually ran. `restoreManifest`'s own boolean return (line 601) already distinguishes "wrote it back" from "could not," and the `failed` return at line 878 already treats the latter as not recoverable silently; keep that shape when extending the restore to the two new call sites.

### Done when

The plan's `## Changelog` line for this wave: *"...restores the manifest and removes its prompt when it fails, and signals a wrapper pid only after it confirms the pid belongs to the desk."* Concretely:

- A failed `stop(pid)` or failed `wrapperStop(wrapperPid)` restores the manifest (when `stampPath !== ''`) before returning its `loop-alive` refusal. A test drives a stop failure and a wrapper-stop failure separately and asserts the manifest file's content is unchanged afterward (not merely that a restore function was called).
- Every `failed` return after the prompt is written removes `promptPath` first. A test drives at least one of the post-prompt failure points (e.g. `writeDeskManifest` returning null) and asserts `.plot-continuation.md` no longer exists after the call returns `failed`.
- The wrapper pid is checked against the desk before `SIGTERM` — using whichever comparison you chose (process start time or working directory) — and a continuation refuses rather than signals when the check fails. A test simulates a reused wrapper pid (the recorded identifying value no longer matches) and asserts no signal was sent and a named refusal was returned instead of a `loop-alive`-via-stale-signal outcome.
- The dead `manifestBeforeStop === null` branch inside the line-877 condition is removed — line 803 already refused on that condition for any `stampPath !== ''`, so by line 877 it cannot be true again. Removing it is a cleanup, not a behavior change; keep a comment or the plan's own language if a future reader would otherwise reintroduce it "for safety."

Plus: the repo's standing gates — no `State:` line hand-edited (none should be touched by this slice), and `scripts/check-shell-lines.sh` if any shell under `skills/` changes (it should not for this slice).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests, related-package vitest, and typecheck for the files this branch actually touches (this slice's files sit under `packages/fleet/src/shared/continuation.ts` and its test file). The suites in the `CI suites` config key run in CI on every PR — don't run them locally as a matter of course; a failure there comes back as a correction.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the wave heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/a-failed-continuation-leaves-the-desk-as-found` line under `### Continuation`).

### Scope guard

**This branch owns:** `packages/fleet/src/shared/continuation.ts` (the `target.stop` block and the prompt-write-through-spawn sequence inside `continueOnDesk`) and its test file. If the pid-ownership comparison needs a new manifest field, that also touches `manifest-stamp.ts` and its type (already touched by the prior slice for `sliceRuns` — check for a clean rebase there).

**Siblings in flight, verified at brief-writing time (2026-10-24):** `bug/continuation-reads-the-loops-run-limits` merged (PR #2511) — this branch should start from current `main`, not from a stale fork point. No other slice of this plan (`bug/drop-reads-the-boards-branch`, `bug/mergeability-uses-the-prs-own-base`, `bug/continuation-tests-assert-their-names`) has a remote ref yet; none overlaps this slice's files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

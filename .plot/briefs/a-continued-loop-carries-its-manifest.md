## Implementation brief — a-desk-and-its-manifest-name-each-other (slice 3: A continued loop carries its manifest)

- **Plan (canonical):** `docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-continued-loop-carries-its-manifest` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a person reading the diff)
- **Issue:** #1101 (the loop half)

The one wait is met on `main`: slice 1 (`bug/the-join-is-one-rule`) landed `rules/desk-manifest.ts` with `manifestDirectory` and `deskManifest`, and slice 2 (#1234) added `watchedDesk` to the same file. Slice 4 (`bug/a-desk-with-no-manifest-says-so`) waits on slice 1 only, adds `unnamedDeskLabel` to the same file and edits `registry.ts`. Add `loopRegistration` as a separate export and leave the three existing exports untouched.

### What to build

`/api/continue` answers a `PLOT-BLOCKED` question by spawning the `Worker command` in the blocked desk. It passes `PLOT_BRANCH`, `PLOT_WORKTREE` and `PLOT_EXIT_FILE` and nothing else (`packages/board/src/server/continue.ts`, the `spawn` call near `:525`). It looks for the desk's manifest only to stamp it afterwards, and it starts the loop when none names the desk. The loop it starts has no `PLOT_MANIFEST_FILE`, so `assigned_branch` (`plot-worker-loop.sh:632`) returns 1 on every poll and `wait_for_work` (`:2404`) holds the desk for `Worker bound` (8 h on this repo), logging `free on ?`. #1101 measured that on `free-c7b58b4f`. The route also leaves the previous dispatch's `.plot-worker.wrapper.pid` on the desk and starts no wrapper. `plot_worker_state` reads that file as proof of a wrapper, so a waiting loop with no agent beneath it reads `finished`, and `--stop` answered *not running (finished 29948)* while 29948 ran.

Build four things:

1. **`loopRegistration({ manifestFile, exists })`** in `rules/desk-manifest.ts`: `registered` when `manifestFile` is non-empty and `exists`, `unset` when `manifestFile` is empty, `gone` when it is non-empty and absent. The caller passes the existence reading; the rule does no I/O.
2. **`/api/continue` asks `deskManifest`.** On `named` it adds `PLOT_MANIFEST_FILE` to the spawn environment. On `unnamed` or `several` it refuses with 409 and a sentence naming the desk and the answer, and starts nothing. Before the spawn it removes `.plot-worker.wrapper.pid` from the desk.
3. **`wait_for_work` ends on `gone`.** Each poll, after the `assigned_branch` check, the loop reads `loopRegistration`. On `gone` it logs a line naming the manifest path, calls `write_ending` with reason `unregistered`, and returns 124. `unset` keeps today's behaviour, because a hand-started loop is a supported shape.
4. **A corpus row** in `packages/domain/corpus/desk-manifest.corpus.test.ts` for `loopRegistration`, driving the real shell reading, in the shape slice 2's `watchedDesk` row has (`:421`).

The plan is canonical. This brief is orientation.

### Decisions the plan settles — do not re-derive them

**The refusal comes before every write.** Put the `deskManifest` check right after the `Worker command` check and before `fs.writeFileSync(promptPath, …)`. A refused continuation leaves no `.plot-continuation.md`, no appended log and no removed `.plot-worker.exit`. A refusal after the prompt file is written leaves a trace the next reader takes for a started run.

**`several` is refused, not tie-broken.** The plan's second Open Point keeps it open: if a measured estate shows a legitimate two-manifest desk, the answer needs a tie-break. Today there is no such desk, and a first match hides an estate defect. Refuse and name every path in the sentence.

**`unset` is not `gone`.** *Absent is not false.* An empty `PLOT_MANIFEST_FILE` means a hand-started loop and it keeps waiting. Only a name that points at a missing file ends the wait. Ending on `unset` would kill every hand-started loop, and the test suite blanks `PLOT_MANIFEST_FILE` in seven workerloop fixtures (`workerloop.test.mjs:155`, `:563`, …) for exactly that shape; they must stay green unchanged.

**The shell keeps a declared duplicate and no bundle call.** The wait polls every `WAIT_POLL_SECONDS`, and a 39 ms `node` start per poll per agent is the per-pass cost *A Shell Script Asks The Domain* assigns to duplication. `[ -f ]` answers it. On a corpus disagreement the branch stops; adjusting either side to make the comparison pass is the one forbidden move. No new `plot-*.sh` script.

**Not in scope** (the plan's "What this does NOT do"): finding what removed the two manifests in #1101, stopping an orphaned loop, moving the agent's pid file after a hop. A manifest that vanishes mid-wait is what slice 3 now survives, not what it prevents.

### Traps the plan does not name

**1. `unregistered` is not an `EndingReason`, and a record carrying it reads as unreadable.** `EndingReasonSchema` (`packages/domain/src/entities/ending.ts:69`) is a strict `z.enum` of six words. `write_ending` would write the file, `plot_worker_ending` would return it, and the board's parse would fail on the unknown reason, so the ending reads `unreadable` — the one answer this slice exists to avoid. Add `'unregistered'` to the enum and to its TSDoc list. `test/reconcile/ending.test.mjs` and `packages/domain/test/ending.test.ts` are where the existing six are held; add the seventh there.

**2. The actor decides whether the ending is attributable.** `endingIsAttributable` (`packages/domain/src/transitions/agent.ts:397`) refuses `actor: 'agent'` for every reason except `unstarted` and `limited`, because *no watcher produces those*. An `unregistered` ending has no watcher either: the loop itself finds its manifest gone. So `write_ending … unregistered agent …` is the honest record, and the guard must admit `unregistered` beside the other two (and its refusal text must name the third). Writing `bound` or `monitor` as the actor instead would be false — neither fired. If the lifecycle test (`a-lifecycle-is-enforced-by-a-test`) refuses this shape, report that rather than picking a false actor.

**3. The existing test that says a missing manifest is fine is the anti-contract.** `continue-route.test.ts:340`, *"does not fail the continuation when no manifest names the worktree"*, asserts 202. After this slice that is the 409. Rewrite it into the plan's second case; do not leave it beside a contradicting one. Also extend *"gives each refusal its own reason"* (`:466`) with the new reasons. The fixture helper that builds a worktree for the other cases must now also write a manifest naming it, or every 202 test in the file turns into a 409.

**4. `manifestForWorktree` collapses `unnamed` and `several` into `''`.** The route needs the two answers apart, to word two different refusals. Keep `manifestForWorktree` (`manifest-stamp.ts:207`, its other callers read the empty string) and add a sibling that returns the `DeskManifest` answer, built from the same collection loop, with `manifestForWorktree` implemented on top of it. Do not copy the loop.

**5. The wrapper pid removal is before the spawn, and it is a `force` removal.** Use `fs.rmSync(path, { force: true })`, as the `.plot-worker.exit` removal beside it does. The route starts no wrapper, so the file can only be stale. Do not remove `.plot-worker.pid`: the route overwrites it with the new child's pid.

**6. `wait_for_work` returns its status to `|| exit 124`.** The loop runs under `set -uo pipefail` (no `-e`), and the caller at `:2888` turns any non-zero return into exit 124. Return the registration word on stdout from a small function (as `assigned_branch` returns its branch) and `case` on it inside the poll loop, so a `registered` or `unset` answer cannot leak a non-zero status out of the function. The caller at `:2886` needs no change: `wait_for_work` returns 124 and the caller already exits.

**7. `plot-worker-loop.sh` is not sourceable.** It has no `NO_MAIN` guard (slice 2's monitors have one), so a test cannot source the loop to call one function. Put the shell reading where the corpus can reach it, and read `desk-reset.corpus.test.ts` and `production.ts` first: the `desk_reset_refusal` row already compares a rule with a function that lives in this loop, and how it reaches that function is the precedent. Do not add a `NO_MAIN` guard to the loop for this slice.

### Done when

The plan's `## Done when` list is the specification. Each test below must FAIL on `origin/main` and PASS on the branch; run each against `main` before claiming it.

- **`continue-route.test.ts`, spawn environment:** for a desk a manifest names, the spawned process's environment carries `PLOT_MANIFEST_FILE` equal to that manifest's path. Read it from the worker's own output (the command prints `$PLOT_MANIFEST_FILE` to the log), not from the route's reply; a test that reads the route's reply passes with the variable unset.
- **`continue-route.test.ts`, refusal:** no manifest names the desk gives 409 and a body naming the desk; two manifests naming it give 409 naming both; in both, nothing was spawned and the desk holds no `.plot-continuation.md`. The second assertion catches a refusal placed after the prompt write.
- **`continue-route.test.ts`, stale wrapper pid:** a desk holding `.plot-worker.wrapper.pid` has none after a continuation.
- **`workerloop.test.mjs`:** start a free loop with `PLOT_MANIFEST_FILE` naming a real manifest that has no branch, delete the manifest during the wait, and assert the loop exits 124 within two polls with `.plot-worker.ending.json` naming `unregistered` and the manifest path in `detail`. Keep the existing wait tests (blanked `PLOT_MANIFEST_FILE`) green: they catch a rule that treats `unset` as `gone`.
- **`packages/domain/test/desk-manifest.test.ts`:** `loopRegistration` at 100% branch coverage (`registered`, `unset`, `gone`), and the module's existing coverage kept.
- **Ending:** `ending.test.ts` and `ending.test.mjs` hold `unregistered` as a seventh reason, and `endingIsAttributable` admits `actor: 'agent'` for it. This catches trap 1: without it the ending exists and reads `unreadable`.
- **Corpus:** a `loopRegistration` row driving the real shell reading over the three shapes (unset, set and present, set and absent).

Plus: one `plot` patch changeset and one `@plot-pm/board` patch changeset (`packages/board` and `packages/domain` change), each with the description first and the `bumps:` block last. The `plot` one carries `plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md` and `skills: plot: patch` inside the block; the board one uses the `'@plot-pm/board': patch` frontmatter and no `skills` block. Run `./scripts/check-changeset-packages.sh`. `.changeset/` holds siblings' files: add yours, touch none. Use `nvm use` (Node 24) before any `pnpm` command. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Run `pnpm build:board` from the repository root if `packages/board/src` changes, and commit the artifact.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work continues). Do not use `gh pr create`.
- When the PR exists, append `, PR: #<number>` inside this slice's heading in the plan's `## Slices` (`(Branch: bug/a-continued-loop-carries-its-manifest, PR: #N)` is the form waved plans parse), through a scratch worktree on `origin/main`.
- Do not `git add -A` after a suite run: board tests rewrite the tracked `tiny-garden/.plot/state` fixture.

### Scope guard

This branch owns:

- `packages/domain/src/rules/desk-manifest.ts` (add `loopRegistration` only), `packages/domain/test/desk-manifest.test.ts`, `packages/domain/corpus/desk-manifest.corpus.test.ts` (one row)
- `packages/domain/src/entities/ending.ts` and `packages/domain/src/transitions/agent.ts` (the seventh reason and its attribution), with `packages/domain/test/ending.test.ts` and the lifecycle test that holds `endingIsAttributable`
- `packages/board/src/server/continue.ts`, `packages/board/src/server/manifest-stamp.ts` (the sibling reader only), `packages/board/test/unit/continue-route.test.ts`
- `skills/plot/scripts/plot-worker-loop.sh` (`wait_for_work` and the registration reading only), `test/reconcile/workerloop.test.mjs`, `test/reconcile/ending.test.mjs`

Other branch in flight on the same plan: `bug/a-desk-with-no-manifest-says-so` (slice 4: `unnamedDeskLabel`, `synthesizeEntry` and `registry.ts`, `AgentEntrySchema`). It does not edit `continue.ts` or the loop. Do not edit `registry.ts` or `AgentEntrySchema` here. `bug/the-monitor-follows-the-hop` is merged (#1234) and edited the monitors and the wrapper in `plot-dispatch.sh`, neither of which this slice touches.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

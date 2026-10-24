## Implementation brief — implement-leaves-the-main-checkout-on (wave Checkout)

- **Plan (canonical):** `docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2471 merged
- **Branch:** `bug/implement-restores-the-checkout` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's first wave. `bug/implement-pushes-no-held-ref` waits on it; `bug/dead-claim-releases` waits on neither.

### What to build

`/api/implement` runs `/plot-implement <slug> --brief-only` through `startImplement` (`packages/fleet/src/shared/implement-run.ts:506`), which calls `startBoardRun` with `tree: opts.repoRoot` (`board-run.ts:184`) — the **operator's own checkout**, not a scratch worktree. When `/api/implement` is invoked from the main checkout, the agent runs there directly.

`/plot-implement` step 3 (branch setup) does `git checkout -b <branch> origin/<default>` in that tree. Nothing in the skill or the run records what branch the checkout was on before, and nothing returns it afterward — on success, on failure, or on the `IMPLEMENT_TIMEOUT_MS` (5 min) kill. On 2026-10-20 this left the main checkout on `bug/plot-reads-as-an-unknown-tracker` with a pushed Started-only commit, and a second `/api/implement` run then committed its own brief on top of that stranded branch. The slice sat undispatched for 90 minutes until a person manually moved the checkout back to `main` and released the claim.

Build: the implement run records the branch the checkout was on **before** it does anything, and returns the checkout to that branch on every exit path — success, an agent failure, and the timeout kill. `--brief-only` mode (the only mode this run ever uses — `composeImplementPrompt` at `implement-run.ts:113` always appends `--brief-only`) does not need the slice branch checked out at all beyond writing the brief and the `Started:` record on it; whatever it does to produce those needs to leave the tree exactly where it found it.

### The decisions the plan settles — do not re-derive them

**This is the only slice in the wave that changes behaviour the operator will notice directly, so it goes first.** The plan's Design section orders the three slices by blast radius: restoring the checkout is the smallest, most self-contained fix (a single run's start/end behaviour); the ref-push and dead-claim-release slices build on knowing this one is fixed first, because both of their fixes are easier to reason about once a stray Started-only ref can only happen from a race, never from "the checkout was already elsewhere."

**Which open question this slice must still answer — it is NOT settled by the plan:** "restore in place, or run in a scratch worktree?" The plan names both as live options and explicitly notes a scratch worktree has a second benefit — it also stops a second concurrent `/api/implement` run from committing onto the first run's stranded branch, which is exactly what happened in the 2026-10-20 incident's second half. Decide this with a reproduction before writing the fix, not from this brief: the plan's own first open question (which code path pushes the branch) says "a reproduction in a sandbox repo answers this before slice 2 starts" — the same discipline applies here. Whichever you choose, the fix must be provable with a sandbox contract test, the same shape as `test/reconcile/main-checkout-writers.test.mjs` used in the already-released sibling plan (`docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`) for the adjacent "main checkout stays clean" fix. Read that test before writing this one — it already runs fleet commands against a sandbox and asserts `git status --porcelain` is empty and `HEAD` matches the tree afterward; this slice's assertion is a sibling of that one (checkout back on its original branch, not just clean).

**Do not confuse this with the already-released sibling plan.** `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md` (Released, v2.28.0) fixed scratch-file writers and a `HEAD`-without-tree mover, and added the `main-checkout` gate (`packages/domain/src/rules/main-checkout-write.ts`, `MAIN_CHECKOUT_WRITER_ENV`) that refuses a *manual* mutating git command run in the main checkout by an unattended agent with that marker unset. `implement-run.ts:574` already sets `MAIN_CHECKOUT_WRITER_ENV=1` for this exact run, by design — "the brief and the `Started:` record are committed in the main checkout by design, so the `main-checkout` gate allows this run." That gate is doing its job correctly here; it is not the defect. The defect is that nothing records or restores the pre-existing branch once that legitimate write finishes. Do not weaken or extend the gate as part of this fix.

**Everything this brief states as fact about `implement-run.ts` and `board-run.ts` was read from the file at the commit this branch forks from** (`startBoardRun(... tree: opts.repoRoot ...)`, `MAIN_CHECKOUT_WRITER_ENV` set at `implement-run.ts:574`) — re-check both are still current before relying on them, since no reproduction has run yet in this slice.

### Done when

The plan carries no `## Done when` list of its own; its three Open Questions marked `[ ]` are this slice's acceptance bar for the part it owns:

- The code path that leaves the checkout on the slice branch is identified by reproduction (sandbox repo), not by reading source alone — the sibling plan's wave 1 found its own candidate list of movers was wrong ("the actual mover is unnamed and outside this slice's candidate list") precisely because it skipped reproduction.
- The choice between "restore in place" and "scratch worktree" is made and justified in the PR, with the second-run-stacking failure mode from the motivation named as a factor either way.
- A sandbox contract test proves: after an `/api/implement --brief-only` run (success case, and a forced-failure/timeout case), the main checkout is back on the branch it started on, with no stray commits from the run on top of whatever branch it used.

Plus: the repo's gates — build artifacts where the board package changes (plan says `/api/implement`'s handler and the row's release-claim offer are the board-impact surface, so check whether this slice's fix touches `packages/board/` and rebuild if so), and a changeset bumping `plot` or `@plot-pm/board`. For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` (resolved from this skill's directory under `skills/plot-implement/`) before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice is TypeScript-only by the plan's own file list (`packages/fleet/src/shared/implement-run.ts` and board-run plumbing), so it should not touch `.sh` files — if it turns out to need one, growth there must be paid for by removing shell elsewhere in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Once it returns a PR number, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`### Checkout` heading, the `bug/implement-restores-the-checkout` line) and commit that where the plan lives.

### Scope guard

This branch owns the implement-run start/end path: `packages/fleet/src/shared/implement-run.ts`, `packages/fleet/src/shared/board-run.ts`, and the `/plot-implement` skill's step 3 (branch setup) where it governs the checkout's pre-existing branch. It does not own ref/claim semantics (that is `bug/implement-pushes-no-held-ref`, which waits on this branch) or claim-release logic (`bug/dead-claim-releases`, independent).

Other branches in this plan: `bug/implement-pushes-no-held-ref` (waits on this one — do not assume it has started), `bug/dead-claim-releases` (independent, may run concurrently). Verify at dispatch time whether either has opened a PR before assuming file-level non-overlap; this brief's file list is drawn from the plan's own "files likely touched," not from a diff of those branches.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

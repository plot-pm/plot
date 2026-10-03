## Implementation brief — every-desk-state-has-an-exit (slice 1: An empty claim is not unlanded work)

- **Plan (canonical):** `docs/plans/2026-10-03-every-desk-state-has-an-exit.md` on `main`
- **Approved:** 2026-10-03, jwloka, in-session
- **Branch:** `bug/an-empty-claim-is-not-unlanded-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1242

This is slice 1 of 3. `bug/a-refused-slice-is-held` (#1243) and `bug/the-desk-has-a-lifecycle` wait on it; neither starts until this merges.

### What to build

Measured 2026-10-03: desk `free-50562867` held `bug/the-queue-reads-the-scans-order`. Its only commit beyond `origin/main` was `a20c71285 plot: claim bug/the-queue-reads-the-scans-order`, which changes no file. Its worker was dead and `origin/bug/the-queue-reads-the-scans-order` no longer existed. Every agent handed the slice ran `yield_the_held_checkout` (`skills/plot/scripts/plot-worker-loop.sh:933`), which measured `unpushed` against `@{upstream}`. With the ref gone there is no upstream, so the reading was `unknown`, `checkoutYield` kept the desk, and the agent wrote `PLOT-BLOCKED.md`. That happened 250 times in about 24 hours.

The change: where the holder has no `@{upstream}`, measure `unpushed` as *the commits on the holder's `HEAD` that `origin/<default>` does not hold, excluding empty claim commits*. Zero such commits reads `0`; one or more reads `1`; an unreadable `origin/<default>` reads `unknown`. Where an upstream exists, the reading stays exactly as it is.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**`checkoutYield` does not change.** `packages/domain/src/rules/checkout-yield.ts` is right: an `unknown` reading keeps the checkout, because a removal deletes the only copy of whatever the reading missed. The defect is the READING the loop hands it, not the rule. A change to the rule's `unknown` polarity is out of scope and wrong.

**The comment at `plot-worker-loop.sh:962-964` stays true.** It says a branch whose claim push never happened has no upstream and *"its own commits are the work a removal would delete"*. The new reading still protects every commit that changes a file. It drops only commits that are provably empty claims, so a desk with real unpushed work still keeps.

**"Empty claim commit" already has a definition. Use it; do not write a third.** `plot-reap.sh:1037-1057` (`sweep_is_empty_claim`) and `plot-reconcile-scan.sh:423` agree: the subject starts with `plot: claim ` AND the commit's tree equals its parent's tree. Both conditions are required: *"a human commit titled 'plot: claim handling refactor' carrying real files would otherwise read as an empty claim"* (`plot-reap.sh:1015-1017`). Prefer extracting the predicate into a sourced helper that the loop and the reaper both call. If you keep two copies, a test must hold them to the same answers.

**Compare against `origin/<default>`, not against `@{upstream}` and not against the branch's remote ref.** The case this fixes is precisely the one where the remote ref is gone. `origin/$main_branch` is the ref the loop already reads: `reset_desk` detaches to it at `:1084` and counts against it at `:1343`.

**No `--force`, ever.** `git worktree remove "$holder"` at `:999` stays as it is. If the reading misses something, git's refusal is the second line of defence, and that is the design (`checkout-yield.ts` header).

**The cost rule permits this.** `yield_the_held_checkout` runs once per take-up, never per idle pass, so a `rev-list` plus a tree comparison per commit is within budget (CLAUDE.md, *A Shell Script Asks The Domain*).

### Done when

The plan's slice line is the specification. These assertions exist because a naive fix passes without them:

- A holder with a dead worker, no upstream, a clean tree and only an empty claim commit → `yields`, and the worktree is removed without `--force`. This is the measured case.
- The same holder plus one commit that changes a file → `keep` with `unpushed-commits`. Catches a fix that ignores everything once the upstream is missing.
- A commit titled `plot: claim …` that changes a file → counts as real work → `keep`. Catches a fix that trusts the subject alone.
- `origin/<default>` unreadable → `unknown` → `keep`. Catches a fix that reads a failed `rev-list` as zero.
- A holder WITH an upstream → behaviour unchanged. Run the existing `test/reconcile/checkout-yield.test.mjs` and `test/reconcile/deskreset.test.mjs` cases unmodified.

Plus the repo's gates: a `.changeset/*.md` naming `'plot': patch` with the description first and the `bumps:` block last, plus `plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md`. Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. Run no full suite locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-loop.sh` (the `unpushed` reading in `yield_the_held_checkout`), a sourced helper if you extract the empty-claim predicate, the matching call site in `skills/plot/scripts/plot-reap.sh`, and tests under `test/reconcile/`.

In flight, verified 2026-10-03: PR #1234 (`bug/the-monitor-follows-the-hop`, OPEN) also edits `test/reconcile/workerloop.test.mjs`. Put new cases in `checkout-yield.test.mjs` or `deskreset.test.mjs` rather than `workerloop.test.mjs`, so the two PRs do not collide.

Not this slice: the queue's `refused` hold (slice 2), the desk lifecycle rule (slice 3), and any change to `reapable.ts`. If you find something the plan did not anticipate, report it rather than improvising outside scope.

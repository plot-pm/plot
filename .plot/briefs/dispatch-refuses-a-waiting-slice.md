## Implementation brief — dispatch-refuses-a-waiting-slice (wave Refusing)

- **Plan (canonical):** `docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/dispatch-refuses-a-waiting-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

The plan's third and last wave. `Declaring` landed as #623 — `plot-plan-meta.sh` parses `<!-- waits: <branch> -->` and reports `waves[].branches[].waits_on` (`plot-plan-meta.sh:123`). `Holding` landed as #637 — the scan turns that annotation into a branch state, and `waits_state()` at `plot-fleet-scan.sh:1049` is the verdict: `MERGED` clears, `NONE` reads `blocked`, everything else reads `waiting`. Consume both. `plot-dispatch.sh` reads neither today: `grep -c waits skills/plot/scripts/plot-dispatch.sh` returns **0**, and that gap is this slice.

### The failure this closes, measured twice in one day

`feature/the-domain-forgets-the-vendor-list` is gated on another plan's slice, and the gate is **prose**: bold text at `docs/plans/2026-09-01-a-third-connector-costs-one-adapter.md:114` reading *"Gated on the budget slice that removes the two `fleet.ts` branches"*. `plot-dispatch.sh` gates on the plan's PHASE, that plan is Approved, so the slice read as eligible and a worker was dispatched to it. The worker did everything right — it verified the gate, confirmed the condition still holds, committed nothing, wrote a `PLOT-BLOCKED` marker and stopped. It was then dispatched **again** at 04:50 on 2026-09-02 and produced the same block a second time. Two workers, zero progress, because the constraint a dispatcher must honour was written where a dispatcher cannot read it. The second worker's own report names the fix: *"the cross-plan gate wants to be machine-readable in the Branches line rather than prose a dispatcher cannot see."*

### What to build

`plot-dispatch.sh` refuses a waiting branch, names the prerequisite, and honours `--allow-waiting`.

**Most of the refusal is already free, and the brief says so to keep the change small.** `plot-dispatch.sh:103` records the architecture — *"Eligibility is NOT decided here: this script asks plot-fleet-scan.sh"* — and `isClaimable` at `packages/domain/src/rules/eligible.ts:107` is `verdict === 'eligible' && state === 'open'`. A waiting branch reads `waiting` rather than `open` since #637, so **`--next` and `--list-eligible` already exclude it**. Assert that rather than reimplementing it.

What is left is the path that does not go through `--next`: a branch named explicitly, and `--restart`. Those reach `start_worker` without consulting the scan's verdict, and they are where a person can still hand a worker an unstartable branch.

Add `--allow-waiting` in the shape `--allow-local` already has — declared in the usage block at `plot-dispatch.sh:4`, documented at `:38`, defaulted at `:169`, parsed at `:201`, and reported when it fires (`:1201` prints what it overrode and why). A named escape that says what it bypassed, not a silent one.

### The decisions the plan settles — do not re-derive them

**`deferred:` and `waits:` are different annotations and must not converge.** The plan is explicit: *"`deferred:` remains the annotation for a judgement; `waits:` is only for a fact a script can check."* It gives the case that proves it — `the-registry-supervises-its-agents` defers its daemon on *"a week of visibility AND a non-zero count of reported-but-unattended desks"*, deliberately not mechanical, because the plan is willing to cancel itself. Encoding that as `waits:` would replace a judgement with a branch name and lose the cancellation. A test must assert the two do not interfere on one branch.

**One branch, one prerequisite, no transitive resolution.** *"Not a dependency graph… If a plan needs a DAG, the plans are wrongly cut."* Do not follow a prerequisite's own `waits:`.

**Ask the host for a merged PR, never the refs.** The plan's `Done when` makes this a named case: `plot-release-refs.sh` deletes merged refs, so a prerequisite that merged and was then reaped has no ref — and a ref-based check would turn correct, finished work into a permanent block. `waits_state` at `plot-fleet-scan.sh:1049` already asks `host_pr_state "$1" --ask`; reuse that answer rather than writing a second reader.

**An unreachable host holds the slice and does not block it.** The scan's own table states the reason: *"silence is not evidence, in EITHER direction: not permission to start, and not proof of a typo."* So an unreachable host produces `waiting`, which refuses the start — it must not produce `blocked`, which would tell a person to go and edit the plan.

**A closed, unmerged PR is `waiting`, not `blocked`.** The host has seen the branch, so nothing is misspelled — somebody withdrew the work, and that resolves by reopening it rather than by editing the plan.

**Not a cross-repo mechanism.** The waited-on branch is in this repo. A split-home plan is a different problem and this must not pretend to solve it.

**The refusal names the prerequisite.** The brief gate at `plot-dispatch.sh:2144` is the model, and its comment gives the reason: *"The refusal names the REF it looked at, not a bare path"* — a message that sends a person to the wrong place costs more than no message. A refusal reading *"waiting on `bug/x`, which has not merged"* is actionable; *"not eligible"* is not.

### Out of scope

**Do not change what `--next` offers.** `isClaimable` already excludes a non-`open` branch, and widening the domain rule to know about waiting would put the same decision in two places.

**Do not add a second host reader.** `host_pr_state` and `waits_state` exist; a new PR lookup in `plot-dispatch.sh` would be a second answer to *did this merge?*, and this repo already records what two answers to one question cost.

**The two live plans need their annotation, and one of them is half-done in a way that hides itself.** The `Done when` lists *"the two live cases carry the annotation and stop needing their prose: `a-third-connector-costs-one-adapter` and `the-pulse-is-an-entity`"*.

Measured 2026-09-02 on this checkout: `docs/plans/2026-09-01-a-third-connector-costs-one-adapter.md:114` **already carries** `<!-- waits: bug/the-budget-knows-which-bucket-it-spent -->` in the working tree, and `git show origin/main:…` on the same line carries **none** — the edit is uncommitted. `the-pulse-is-an-entity` has no `waits:` at all. This matters more than a bookkeeping detail: the brief gate reads `origin/<main>` rather than the working tree (`brief_ref` at `plot-dispatch.sh:337`) precisely because *the question is what the WORKER will find*, and a `waits:` gate must read the same ref for the same reason. **An annotation that exists only in a local checkout refuses nothing**, which is indistinguishable from the prose gate it was meant to replace.

So commit the annotation for both plans, remove the prose gate each one replaces in the same commit — one gate must not exist twice — and assert the gate against the ref, not the file.

### Done when

- **A branch annotated `waits:` on an unmerged branch is not offered by `--next`** — asserted, even though `isClaimable` already gives it, because a later change to the state vocabulary would silently remove the property.
- **`plot-dispatch.sh` refuses that branch BY NAME when it is named explicitly**, and the message says which prerequisite and that it has not merged.
- **`--allow-waiting` starts it anyway and says what it overrode**, in the shape `--allow-local` reports at `plot-dispatch.sh:1201`.
- **A prerequisite that merged and was then reaped still clears** — asserted directly, since `plot-release-refs.sh` deletes merged refs and this is the case where correct work would otherwise block forever.
- **A `waits:` naming a branch the host has never seen a PR for reads `blocked`**, and the refusal points at the plan rather than at the wait.
- **An unreachable host holds the slice and does not block it** — the two verdicts differ in what a person is told to do next, so a test that cannot tell them apart has not tested the distinction.
- **`deferred:` is untouched**, with a test asserting the two annotations do not interfere on one branch.
- **Prove each test is discriminating.** Make a waiting branch dispatchable deliberately and confirm the test fails. Three inert mutations were caught in this repo on 2026-09-01; a passing test against unchanged behaviour proves nothing.

### Repo gates

Node 24 (`nvm use`; `pnpm` crashes on Node 26). Run `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` and `pnpm build:board`.

**The root `pnpm run typecheck` is board-only.** It is `pnpm --filter @plot-pm/board typecheck`, so a change under `packages/domain/` also needs `cd packages/domain && npx tsc --noEmit`. That package additionally has `pnpm run test:corpus` on its own vitest config, which is **not** part of `test:board`; the corpus tier runs `plot-fleet-scan.sh` against this repository's real estate, so a change to the scan or to eligibility runs it.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer a request in 25 seconds.

### Changeset

One changeset, **description FIRST and the `bumps:` block LAST** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships. Name `plot`, plus any package whose source changes. Run `./scripts/check-changeset-packages.sh` before pushing; it refuses a description shorter than 20 characters.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim and the anchored one does not, and it cost a red main on 2026-09-01.

## Implementation brief — a-correction-is-not-unlanded-work

- **Plan (canonical):** `docs/plans/2026-09-27-a-correction-is-not-unlanded-work.md` on `main`
- **Approved:** 2026-09-27, jwloka, in-session after panel (round 1, `proceed`)
- **Branch:** `bug/a-correction-is-not-unlanded-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1024

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

Exclude `PLOT-CORRECTION.md` from the reaper's dirty reading, so writing a correction to an agent's desk stops making that desk unreapable.

Reproduced in a scratch repo: `echo body > PLOT-CORRECTION.md` gives `?? PLOT-CORRECTION.md`, which is `dirtyPath`; `reapable.ts:95-97` tests `readings.dirtyPath !== ''` and pushes `uncommitted-changes`. Helping an agent is what blocks cleaning up after it.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The premise is measured, not assumed.** `git check-ignore -v PLOT-CORRECTION.md` exits 1 — the file is NOT git-ignored, so the reaper genuinely sees it. This was the premise most likely to be false and the juror checked it first.

**The mechanism is settled by precedent: one `grep -v` in the READING, not a rule change.** `plot-reap.sh:511-518` already argues the identical case for the `tiny-garden` fixture:

> the tiny-garden pulse is excused because every board suite rewrites it — a worker that did nothing but run the tests would otherwise never be reapable. Any OTHER dirty path is still reported, which keeps this an exception rather than a hole. **It is filtered HERE, in the reading, because it is a fact about this repository's fixtures and not about whether a worktree may go.**

Follow that. Do not add a refusal to `reapable.ts` and do not teach the rule about correction files.

**TWO filter sites, and both or neither.** The snippet appears independently at:

- `plot-reap.sh:522` — `| grep -v 'tiny-garden/\.plot/state' | head -1` (the reap reading)
- `plot-reap.sh:1036` — `| grep -v 'tiny-garden/\.plot/state' | wc -l` (the dirty sweep)

**Excluding at `:522` alone leaves the defect half-fixed**: the sweep goes on counting the desk in `dirty_trees=` and printing it under *"dirty trees nobody owns"* — a finding about a file the reaper just decided does not count.

**The tooling-state file is TRACKED, so `.gitignore` cannot fix it.** The plan offers `.gitignore` as an option for `packages/board/.omc/state/last-tool-error.json`. Measured: `.omc/` IS already in `.gitignore` (line 18) and the file is still reported, because an ignore rule does not apply to a tracked path — which is why it shows ` M` rather than `??`. **The answer is `git rm --cached` or a named exclusion.** A slice that adds an ignore rule will observe no change and be confused.

Corroborating: the merge that shipped #1018 carries *"board: leave the tool-error state file to whatever wrote it — swept into this branch by a `git add -A`. It is agent tooling state, tracked on main."* The estate has hit this once already and worked around it by hand.

**Anchor the match.** `PLOT-CORRECTION.md` at a desk root is `?? PLOT-CORRECTION.md`, and the existing exclusions are whole-line `grep -v`. A loosely anchored pattern would also match `docs/PLOT-CORRECTION.md` or any path containing the name. The plan's rule — *"closed and named, never a pattern"* — extends to anchoring, because the whole safety argument is that no source file can be caught.

**`PLOT-BLOCKED*` is a different thing and stays a refusal.** `reapable.ts:48-49,92-93,139-140` makes `blockedMarker` its own field with its own refusal, and `plot-worker-loop.sh:561-563` states the distinction: *"IT IS A `PLOT-CORRECTION` FILE AND DELIBERATELY NOT A `PLOT-BLOCKED*` ONE … a correction owes [a person nothing]."* A blocked marker means a person is owed an answer; a correction does not. Do not touch it.

**Out of scope:** the pid half of the composed refusal is #1015's; the reaper's liveness reading is not yours to change.

**Rules carried over:** `trash` over `rm` in any teardown you write by hand; read the exit code, not the emptiness.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **Both sites are covered**, asserted by a test that drives the **sweep's counter** as well as the reap decision. A test asserting only "the desk is reapable" passes with `:1036` untouched.
- **The anchoring is proved**: a test shows `docs/PLOT-CORRECTION.md` is still reported as dirty. Without it nothing stops the exclusion widening later.
- **A desk with any OTHER uncommitted file is still kept**, and the refusal still names the path — the exception must stay an exception.
- **The tooling-state file is resolved by `git rm --cached` or a named exclusion**, never by an ignore rule; say in the PR which you chose and why.

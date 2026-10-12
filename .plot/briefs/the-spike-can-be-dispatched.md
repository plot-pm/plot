## Implementation brief — design-work-proves-the-path (wave 4: Dispatching the spike)

- **Plan (canonical):** [docs/plans/2026-10-12-design-work-proves-the-path.md](../../docs/plans/2026-10-12-design-work-proves-the-path.md) on `main`
- **Approved:** 2026-10-12, Jan Wloka, plan-PR #1608 merged
- **Branch:** `feature/the-spike-can-be-dispatched` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI gates; no separate review channel declared for this slice)

This is slice 4 of 7. Slices 1–3 are merged: `feature/the-design-approvals-are-gated` (#1616, the person arm), `feature/a-slice-is-marked-spike` (#1621, the `spike`/`spikeOf`/scan readings), `feature/the-spike-is-approved-alone` (#1629, `approveSpike` and the `Spike approved:` record + its gate). This slice has no remote ref yet — nothing to collide with. The two slices that fold after this one, "Confirming the slices" (`feature/the-slices-are-confirmed-after-the-spike`) and the two tracer slices, read the admission this slice adds but build nothing that touches the same files.

### What to build

Everything this slice needs already exists: `spikeOf(slices)` (`packages/domain/src/rules/spike.ts:37`), the two new `P`-row/verdict-line readings from the markers slice, and the `Spike approved:` record with its `spikeApprovalOf` transition (`rules/state-transition.ts:48`) from the approval slice. None of that is wired into the four places that decide whether a branch may be worked. Today, a `design`-phase plan's slice reads `unapproved` everywhere, full stop — `sliceVerdict` (`packages/domain/src/rules/eligible.ts:106-123`) tests `readings.phase !== DISPATCHABLE_PHASE` with no exception, and its own doc comment says so explicitly: *"{@link sliceVerdict} does not read it yet"* (`eligible.ts:36`, `:43`), referring to the `spike`/`spikeApproved` fields already declared on `SliceReadings` (`:38`, `:45`) but unused.

This slice makes exactly one branch — the plan's spike, once `Spike approved:` is recorded — pass through all four gates that a normal `approved`-phase branch would pass through, while every other branch of the same Design-phase plan keeps refusing. The four places:

1. **`sliceVerdict`/`sliceVerdicts`** (`eligible.ts`) — admit the slice `spikeOf` names, for a `design` plan whose `spike_approved` reads true. Every other slice of that plan still reads `unapproved`.
2. **`plangate`** (`packages/domain/src/workflows/dispatch.ts:533`, called from `:267`) — pass a `design` plan whose spike is approved, but only for the spike branch; refuse any other branch of it with a new reason, `spike-only`. `plot-dispatch.sh` needs no change — it already asks `plangate` in place of its own phase/`Impl:` cases since the markers slice.
3. **`implement`** (`packages/domain/src/workflows/implement.ts`, the `state-too-early` refusal around `:131-138`) — admit the spike branch so its brief can be written; a non-spike branch of the same plan still refuses `state-too-early`.
4. **`phaseGateRefusal`** (`packages/domain/src/rules/phase-gate.ts:185`) — pass a commit on the approved spike branch of a `design` plan, where today it refuses any implementation commit on a plan that isn't `approved`.

### Decisions the plan settles — do not re-derive them

**This is a read-only wiring slice, not a new mechanism.** Every input you need — `spikeOf`, the `spike`/`spike_approved` scan columns, the `Spike approved:` record and its parse — shipped in slices 1–3. If you find yourself adding a new domain rule to compute "is this the approved spike branch," stop: that's what `spikeOf` plus the `spikeApproved` reading already answers. The work here is exclusively *which of the four gates reads that answer, and what each one does when the answer is no*.

**`spike-only` is the refusal name for a non-spike branch of a plan whose spike is approved but not yet confirmed.** This is a new `plangate` refusal reason, parallel to the other eight (`phase-draft`, `state-terminal`, `state-wrong`, `state-unreadable`, `impl-same-branch`, `impl-none`, `impl-unrecognised`, plus the base `unapproved`/`blocked`/`empty` verdicts `sliceVerdict` already returns). Per the plan's refusal convention (*The words*, plan line 60), it must name the next command: something to the effect of "the spike must be confirmed before this branch opens — see `/plot-approve` to confirm the remaining slices once the spike merges." Match the style of the other eight hints exactly — each names what moved and what to run next, not just what's wrong.

**One test per place, each with a spike branch and a non-spike branch of the same Design-phase plan.** The plan's *Acceptance* section is explicit that this is the proof shape: "one test per place proves it with a spike branch and a non-spike branch of one Design plan" (plan line 78). A test that only exercises the spike branch (and never proves the sibling branch still refuses) does not prove the gate — the risk here is the admission set silently widening to the whole plan rather than the one named branch.

**The end-to-end test belongs to CI, not to your local run.** `test/e2e/spike-dispatch.test.mjs` (named in *Acceptance*, plan line 194, and already referenced by slice 1's panel resolution) proves the full path — annotation → plan-meta → scan → `sliceVerdicts` → `plangate` → brief → worker commit — in a sandbox repo. CI's `test:e2e` job runs it on this slice's PR. Per `CLAUDE.md` *Testing*, do not run `pnpm run test:e2e` locally as a matter of course; it dispatches real workers and starves the machine. Write the test, let CI run it.

**The reconcile scan already treats a Design-phase plan's merged spike as non-drift — add a test proving it, don't change the scan.** *Merged-but-not-delivered* in `plot-reconcile-scan.sh` filters to `[ "$st" = approved ]` (verified at `:1140` on this branch's base) before it ever looks at branches, and the symlink-drift `case` block has no `design` arm (verified around `:1035-1045`) — both already exclude a `design` plan outright. So a spike branch merging while its plan is still Design does not trip either check today, with zero code changes needed. The plan's own wording (*What the spike leaves on the default branch*, line 95) says exactly this: "the reconcile scan does not read it as drift." Your job is a regression test that pins this — write a fixture with a Design-phase plan whose spike branch is merged into main, and assert the scan reports zero drift for it. Do not add a `design` branch to either `case`; that would be solving a problem that doesn't exist and risks being wrong about what "non-drift" should mean for a plan that iterates design, confirms its slices, and only then is dispatched further.

**Scope boundary with the next slice.** "Confirming the slices" (`feature/the-slices-are-confirmed-after-the-spike`) owns the `approve` refusal `spike-unmerged` (reading `prMerged` from the host) and the card states that show *spike merged, confirm the slices*. Do not build that refusal here — this slice's four gates all answer *may this branch run*, never *is the plan ready to leave Design*. Those are different questions on different transitions (`sliceVerdict`/`plangate`/`implement`/`phaseGateRefusal` vs. `approve`), and conflating them would duplicate `spike-unmerged` into a place that doesn't need it.

### Done when

The plan's `## Acceptance` section is the specification. In particular:
- A Design plan whose first slice holds one `<!-- spike -->` branch, approved via `plot-approve.mjs --spike --who <handle>`, dispatches that branch, and a worker's commit on it passes the phase gate; every other branch of the plan refuses. `test/e2e/spike-dispatch.test.mjs` proves this end to end; CI's `test:e2e` job runs it, not your local shell.
- One unit test per gate (`sliceVerdict`/`sliceVerdicts`, `plangate`, `implement`, `phaseGateRefusal`) with both a spike branch (admitted) and a non-spike branch (refused) of the same Design-phase plan.
- A reconcile test proving a merged spike of a Design plan reads as zero drift.
- `check-shell-lines.sh pr` passes with no shell lines added — this slice is TypeScript only; the shell line budget was already spent and repaid by the markers slice (net ≈ −20). If your change touches a `.sh` file, you've gone off scope — the plan explicitly routes all shell changes through `feature/a-slice-is-marked-spike`, already merged.

Plus the repo's standard gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` (resolved relative to `skills/plot/scripts/`) before each push, and run exactly what it prints — the suites naming your changed files, related tests and typecheck for touched packages, and the gate scripts. The `CI suites` listed in `## Plot Config` run in CI on every PR; do not run them locally as a substitute. A changeset is required — the plan does not specify a `bumps:` line for this slice in its slice heading (unlike slices 1–3, which bump `plot`/`plot-approve`); check whether this slice's changes are domain-only (no skill-visible behavior change) before deciding whether a changeset is needed at all, and if one is, size it to what actually changed.

### Bookkeeping

Open the PR through the controller once the branch carries a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # on this branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the "Dispatching the spike" heading, line 178).

### Scope guard

This branch owns: `packages/domain/src/rules/eligible.ts` (`sliceVerdict`/`sliceVerdicts` spike admission), `packages/domain/src/workflows/dispatch.ts` (`plangate`'s `spike-only` refusal), `packages/domain/src/workflows/implement.ts` (the brief-write admission for the spike branch), `packages/domain/src/rules/phase-gate.ts` (`phaseGateRefusal`'s spike-branch pass), the matching unit tests for each, a reconcile fixture/test under `test/reconcile/`, and `test/e2e/spike-dispatch.test.mjs`.

Other branches of this plan, verified via `git ls-remote --heads origin` at brief-writing time: none exist remotely besides what's already merged (`feature/the-design-approvals-are-gated` → #1616, `feature/a-slice-is-marked-spike` → #1621, `feature/the-spike-is-approved-alone` → #1629, all merged). `feature/the-slices-are-confirmed-after-the-spike`, `feature/a-tracer-plan-stays-in-design`, and `feature/a-tracer-plan-ships-with-its-dependent` have no ref yet and build nothing this slice touches.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

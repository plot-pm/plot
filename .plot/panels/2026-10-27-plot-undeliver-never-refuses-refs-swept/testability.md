# Testability and scope — plot-undeliver-never-refuses-refs-swept

Position: amend
Evidence: ran plot-undeliver.sh (as shipped and with line 79 swapped for a plot-plan-meta.sh read) in a throwaway repo with a local bare origin, ran plot-state-gate.sh on its write, measured 55 Delivered plans' branches against `git ls-remote --heads origin`; read plot-undeliver.sh, plan.ts undeliver, plan-undeliver.ts, plot-state-receipt.sh, plot-reject/SKILL.md, check-shell-lines.sh, MANIFESTO.md.

## What I ran

Scratch dir: `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-testability/`.

1. Throwaway repo plus bare origin, one Delivered plan in the current `## Slices` line shape with two branches and no remote refs. The shipped script exited 0 and wrote `State: Approved`. The bug reproduces.
2. Same repo, `git add` the write, fed a `git commit` hook payload to `plot-state-gate.sh`. Exit 2: *"Delivered -> Approved, written by hand. The command that owns this write: /plot-approve demo"*. `plot-undeliver.sh` leaves no receipt (no `.plot/state/state-receipts/` was created; the script never sources `plot-state-receipt.sh`).
3. Scratch copy of the script with line 79 replaced by `bash plot-plan-meta.sh "$file" | jq -r '.branches[]'`. Exit 1, refusal names both branches. After pushing a ref for one branch, it still refuses on the other. Note the printed text: `plot-undeliver: plan '' has branches whose refs are already deleted: …` — the word `refs-swept` does not appear (line 98 cuts field 1), and the slug prints empty.
4. Estate measurement against the real origin (10 remote heads): of 55 Delivered plans, plot-plan-meta.sh finds at least one branch in all 55; the current regex finds one in 2. With deferred slices excluded, **54 of 55 have every branch ref gone**, 1 has none gone.
5. `docs/plans/`: 597 plans, 358 heading-shape `### … (Branch: …)` plans (335 Delivered or Released), 596 with `## Slices`. plot-plan-meta.sh reads both shapes.
6. `.branches` from plot-plan-meta.sh includes deferred branches (`2026-02-11-plot-sprint-support.md`: `feature/plot-sprint-support` is in `.branches` and marked `deferred:true` in `.waves`).

## (a) Problem statement

The facts are measured and reproduce: the regex at `plot-undeliver.sh:79` misses the line shape, and `/plot-reject` bypasses the script. One overstatement: "`swept` is always empty" holds for line-shape plans only; the regex does read the 358 heading-shape plans. For live Delivered plans it is 53 of 55 empty, which is the case that matters.

It is half the right problem. The routing defect (`/plot-reject` has no controller) is real and worth fixing. The "refusal never fires" defect is only a defect if firing is correct, and run 4 says it is not: on this estate merged refs are deleted on merge or by `plot-release-refs.sh`, so "no remote ref" is the normal state of a Delivered plan's branches.

## (b) Does the approach solve it without a new defect

No. Approach step 1 as written makes `/plot-reject` refuse 54 of 55 Delivered plans. The shell's reading "no remote ref" conflates three populations: merged and deleted (work is in main), never pushed (the unbuilt work that is the usual reason to reject — the skill's own example is "5/7 branches unbuilt"), and pushed-unmerged-then-deleted (the only case where "work that no longer exists anywhere" is true). Run 3 shows a never-pushed branch triggers the refusal. Fixing the parse without redefining the reading converts a dead refusal into one that blocks the command's main use.

Second new defect: approach step 3 drops the `--unowned` receipt, but run 2 shows the gate then refuses the commit, and points the operator at `/plot-approve`. Slice 2 as written leaves `/plot-reject` unable to commit.

Smaller ones: `.branches` includes deferred branches (run 6), so the plan's suggested read counts a deferred, never-created branch as swept; and a repo whose remote is not named `origin` reads every branch as swept (`ls-remote origin` fails), which fails manifesto Q2/Q3.

## (c) Slices

- Missing work: `plot-undeliver.sh` must call `record_state_receipt "$file" "$decided_state"` (as `plot-sprint-state.sh:169` does), and the gate's owner text for Delivered -> Approved must name `plot-undeliver.sh`. It belongs in slice 1, before slice 2 removes the escape. Without it slice 2 cannot be tested end to end.
- Missing work: the definition of "swept" (see (d) Q1) must be decided and tested before slice 1 parses anything. The parse is a one-line change; the semantics are the slice.
- Acceptance criteria are not measurable as worded. "asserts the script exits 1 with `refs-swept`" cannot match stdout or stderr today: the rule name is cut. Either the test asserts the sentence, or the script prints the rule name; name which.
- Missing test cases: a merged-and-deleted branch (must NOT refuse, under the recommendation below), a never-pushed branch (must not refuse), a deferred branch (must not be measured), a heading-shape plan (regression for the 358), and the gate accepting the write with the receipt.
- Order is right: the controller slice waits on the refusal slice. Size is right: both are small.
- Shell ratchet: replacing line 79 with a `plot-plan-meta.sh | jq` read counts the same (2 commands for 2). The receipt adds 2 (`source`, `record_state_receipt`); the plan must name where 2 come out, since `check-shell-lines.sh` stores no allowance. The plan says nothing about the ratchet.
- Model Guidance: `plot-reject` says "All (1-8) Small … no judgment calls". Routing through a script with refusals keeps that true; the update is a note, not a tier change. Acceptable.

## (d) Open questions a person decides before approval

1. **What does `refs-swept` mean?** Either (A) any non-deferred slice branch with no remote ref — the domain's current wording, and 54 of 55 Delivered plans refuse; or (B) a branch with no remote ref AND no merged PR AND a PR that was opened (closed unmerged) — the only case where work is actually lost; or (C) stop measuring refs and leave the refusal unreached by this script. **Recommend B**, read through `plot-pr-merged.sh`/the host port per "One Answer To Did This Land"; if B is too costly for this plan, C, and say so in the plan rather than wiring A.
2. **Receipt: does `plot-undeliver.sh` record its own receipt, or does `/plot-reject` keep `--unowned`?** Measured: it records none, and the gate refuses its write. **Recommend: the script records it**, in slice 1; the receipt script's own header names this as the intended end state.
3. **Old `(Branch: …` shape: keep a second regex, or read through plot-plan-meta.sh?** Measured: 358 heading-shape plans, and plot-plan-meta.sh reads both shapes. **Recommend plot-plan-meta.sh `.waves[].branches[] | select(.deferred|not)`**; this closes the plan's open question 2 without a second parser and without a corpus pair. Note the plan's `slices[].branch` field does not exist; the output names `waves` and `branches`.
4. **Remote name: hardcode `origin`, or read the configured remote?** **Recommend** the same remote the other ref readers use, or name the assumption in the plan.

## (e) Position

Amend. The routing slice is right and small. The refusal slice, as specified, swaps a dead refusal for one that blocks `/plot-reject` on 54 of 55 Delivered plans, the controller slice fails at the state gate, and the main acceptance criterion cannot match the script's output. All three are fixable inside the same two slices once question 1 is decided. Manifesto: Q3 (fail gracefully) fails as written; Q5 asks whether `refs-swept` earns its place at all, which is question 1 option C; Q6, Q7, Q9 pass.

# Juror: layering and controllers

Position: amend
Evidence: ran plot-undeliver.sh (current, and patched to read branches via plot-plan-meta.sh) on a delivered list-form plan in a throwaway repo with a local bare origin, ran plot-state-gate.sh on the staged write with and without an --unowned receipt, measured branch-line formats over 594 plans in docs/plans; read plot-undeliver.sh, transitions/plan.ts undeliver, entry/plan-undeliver.ts, rules/state-transition.ts owningCommand, rules/controller-gate.ts, plot-state-receipt.sh, plot-reject/SKILL.md, CLAUDE.md.

## What I ran

- Throwaway repo `juror-layering/repo` with bare `origin.git`: plan `demo` at `State: Delivered`, `## Slices` list form, two slices: `feature/demo-merged` (merged, ref deleted, the normal post-merge state) and `feature/demo-unbuilt` (never pushed, the case `/plot-reject` exists for: "5/7 branches unbuilt"). `git ls-remote` shows only `main`.
- Current `plot-undeliver.sh demo --why ...`: exit 0, writes `State: Approved` and `Rejected:`. Confirms the bug for the list form.
- Patched copy, line 79 replaced by `plot-plan-meta.sh` `.branches` (the plan's approach 1): exit 1, `refs-swept` naming both branches. The message reads `plan ''` — the slug does not reach the bundle's refusal text.
- Staged the current script's write and fed a `git commit` hook payload to `plot-state-gate.sh`: exit 2, "Delivered -> Approved, written by hand. The command that owns this write: /plot-approve demo". With `plot-state-receipt.sh --unowned ...` first: exit 0. No `.plot/state/state-receipts` existed after `plot-undeliver.sh` ran.
- Format count in `docs/plans/*.md`: 358 plans carry a `### Name (Branch: x)` heading, which line 79's regex does read; 235 `## Slices` plans carry no `(Branch: ` at all. Of Delivered plans, 1 is heading form and 53 are not.

## (a) Problem statement

The problem is real and the two causes are right in kind, with one factual error. "Current `## Slices` lines ... contain no `(Branch: `, so `swept` is always empty" is false for 358 of 594 plans: the heading form `### Name (Branch: x)` matches `\(Branch: [^,)]+`. The defect is specific to the list-item form, which is what the #2400 plan at `b2df79eaf` uses and what 53 of 54 Delivered plans use today. The Motivation should say that, because it changes the scope of open question 2 (the old form is not a legacy population, it is 60 % of the estate, and `plot-plan-meta.sh` already reads both).

The second cause is stated correctly but incompletely: `/plot-reject` does not call `plot-undeliver.sh`, and `plot-undeliver.sh` would not clear the state gate if it did (see (b)).

## (b) Does the approach solve it without a new defect

No. It introduces two.

**1. `refs-swept` then refuses the canonical rejection.** Measured above: once the script reads list-form branches, a delivered plan with one merged-and-deleted branch and one never-built branch is refused. Both populations are normal. `plot-release-refs.sh` deletes merged refs by design (the domain's own comment says so), and an unbuilt branch never had a ref. So the fixed script refuses almost every real `/plot-reject` — the "5/7 branches unbuilt" example in the skill's own header included. Slice 2 then routes `/plot-reject` through it, so the skill becomes unusable and operators return to the `--unowned` escape. That is the outcome `plot-state-receipt.sh`'s header warns about: "a gate refusing the only available method stops work rather than routing it."

Under *One Answer To "Did This Land"*, the absence of a ref is not evidence about the work. The ref says nothing about whether the branch merged (the host's `mergedAt` answers that) or whether it ever carried commits. The work that is actually lost is narrow: a branch that carried commits, did not merge per `mergedAt`, and whose ref is gone. Open question 3 leans toward "intended"; I read it as the defect the plan should fix in the domain rule, not confirm.

**2. Layering: the shell decides "swept".** `plot-undeliver.sh:79-84` turns a ref reading into the conclusion "swept" and sends the domain a pre-decided list. Under *The Layering Rule* and *A Shell Script Asks The Domain*, the shell should send readings per branch (ref present; `mergedAt` via `plot-pr-merged.sh`, the one host answer) and `undeliver` should decide which combination refuses. That puts the decision where a unit test in `packages/domain` can assert it, and it keeps the destructive-adjacent reading on `mergedAt`.

**3. The write has no receipt (verified).** `plot-undeliver.sh` sources nothing from `plot-state-receipt.sh`, so a commit of its write is refused by `plot-state-gate.sh`. Worse, `owningCommand('plan', slug, 'Approved')` in `rules/state-transition.ts:139` ignores the from-state and names `/plot-approve` as the owner of Delivered -> Approved, which is wrong and sends the operator to the forward transition. Slice 2 as written ("in place of the hand edit and the `--unowned` receipt") makes every `/plot-reject` commit fail at the gate. Open question 1 is answerable now: no, it leaves no receipt.

## (c) Slices

- Missing slice: `plot-undeliver.sh` calls `record_state_receipt "$file" Approved` after its `mv`, the way `plot-sprint-state.sh:169` does, and `owningCommand` takes the from-state so Delivered -> Approved names `/plot-reject` / `plot-undeliver.sh`. This must land before or with the skill slice, never after.
- Slice 1 should change the domain contract, not only the shell regex: per-branch readings in, `refs-swept` refused only for a branch with no ref and no `mergedAt` that had a PR (or carried commits). Reading branches through `plot-plan-meta.sh` is right and creates no duplicate, so no corpus test is needed for the branch list.
- Slice 1's test: extend `test/reconcile/undeliver-two-format-scan.test.mjs` or add beside it, with three cases, not two: refs all present -> Approved; merged-and-deleted plus never-built -> Approved; unmerged-with-PR and ref gone -> `refs-swept`. The plan's single "slice ref is gone -> exit 1" case asserts the defect.
- Fix the empty slug in the bundle's refusal (`plan ''`), observed above.
- Slice 2 leaves two hand steps in the skill that this lens covers: step 3 asks `gh pr list --state merged` directly instead of `plot-pr-merged.sh` / `plot-host.sh` (*Gates Over Rules*: one place talks to the host CLI), and step 5 moves the `delivered/` -> `active/` symlink by hand. Name them in scope or out of scope explicitly.
- `plot-state-receipt.sh`'s header and `SKILL.md` step 4 both name `/plot-reject` as an unowned writer and `a-rejection-is-a-controller-command` as the closer. The plan should update both texts and say whether it supersedes that plan (it is referenced from `2026-09-08-the-master-agent-uses-the-controllers.md`).

## (d) Open questions for a person

1. `refs-swept` semantics: refuse when any named ref is gone (the plan's current reading), or refuse only when a branch has no ref, no host `mergedAt`, and had a PR? Recommend the second, decided in `undeliver` from per-branch readings.
2. Receipt: `plot-undeliver.sh` records its own receipt and `owningCommand` learns the from-state, or `/plot-reject` keeps `--unowned`? Recommend the receipt; the escape exists only for writes with no owning script, and this plan creates one.
3. Controller tier: a script with a domain decision and a receipt now (the `plot-sprint-state.sh` tier), or a full controller action now (`ControllerAction` `'undeliver'`, an endpoint, a bundle route through the controller gate)? Recommend the script tier in this plan and a named follow-up for the endpoint, stated in the plan so the gap stays countable.
4. Old `(Branch: ` form: not a question once branches come from `plot-plan-meta.sh`, which reads both. Recommend closing it with the measured count above.

## (e) Position

Amend. The direction is right: the domain already owns `undeliver`, and routing `/plot-reject` through it closes a real controller gap. As written, slice 1 turns the refusal on for exactly the plans `/plot-reject` exists for, the shell keeps the "swept" decision, and slice 2 produces a write the state gate refuses while naming the wrong owner. Both are fixable inside this plan with the slice changes in (c).

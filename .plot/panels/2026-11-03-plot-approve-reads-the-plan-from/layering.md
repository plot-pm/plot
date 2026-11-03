# Layering juror: plot-approve-reads-the-plan-from

Position: amend

Subject: `docs/plans/2026-11-03-plot-approve-reads-the-plan-from.md`, plan PR #3097, issue #3093. Code read on `origin/main` at `ee678d5c8`.

## Summary

The defect is real and the plan names it correctly. The plan's direction (approach step 3: "the rule lives in the domain, the controllers only read the heads the rule asks for") is right. The plan does not yet say how that split works, leaves three open questions an unattended agent cannot answer, misses a second domain rule that lives in a controller, and does not sequence itself after #3091, which rewrites the same functions.

## Findings

### F1. The domain already names the PR; the controller reads the plan before it asks

- `packages/board/src/server/entry/approve.ts:441-460` (`remotePlanOf`) reads the record at `first.pr.headSha` from `planPrsCarrying` (`packages/domain/src/rules/plan-pr.ts:174-183`) before `choosePlanPr` (`approve.ts:370-427`) asks `planPrOf`. `approve.ts:934-945` then takes the PR from `planPrOf`. The plan's line citations for these places are true.
- `planPrOf`'s named route (`plan-pr.ts:208-219`) returns `rivals: []`, `carried: []` and `branch: ''`, and never asks `open`. So the domain cannot see a rival on that route, and it does not name the file or the head to read. One domain function can name both, because every input it needs is already a reading: the open listing (`OpenPr.headSha`, `OpenPr.changed`) and the named PR.
- Layering conclusion: the fix belongs in `planPrOf` (or one sibling rule beside it), whose `found` answer names the file and the head sha to read. The controller then reads the plan at that answer and nothing else. The plan states the destination but not this contract.

### F2. needs-design holds its own `planPrOf` in the controller, with a different order

- `packages/board/src/server/entry/needs-design.ts:225-240` defines a local `planPrOf` that shadows the domain function of the same name. Its order differs from `plan-pr.ts:205-257`: it takes `idea/<slug>` only when OPEN, otherwise the first carrying open PR, then a CLOSED or MERGED named PR. It computes no rivals and does not ask the merged route at all.
- This is domain logic outside the domain ("No domain-specific code or behaviour lives outside the domain", CLAUDE.md, The Layering Rule). The plan's open question 3 asks whether needs-design "should" share the rule. Through this lens it must: the drift the plan wants to stop already exists, and the plan does not name `needs-design.ts:225`.
- A second drift sits beside it: `needs-design.ts:385` finds the plan on main with `file.endsWith(`${slug}.md`)`, which is the bare suffix match that `namesPlan` (`plan-pr.ts:136-146`) documents as wrong (slug `declared` matches `the-phases-are-declared.md`). `approve.ts:448` uses `namesPlan`.
- `NeedsDesignReadings.pr` (`packages/domain/src/workflows/needs-design.ts:150-159`) carries `number`, `state` and `head` only, so the needs-design workflow has no refusal for a rival. A shared rule needs a reason there too.

### F3. The gate read and the merge pin come from two different host answers

- On the named route the pin is `named.headSha` from `prState(idea/<slug>)` (`approve.ts:384-387`, `:941`, `:1084`). The record would, after a plain reorder, come from the same PR but through a different call. If the fix reads at the `OpenPr` entry's `headSha` from `pr-list` and pins to `prState`'s `headSha`, a push between the two calls makes the approval judge one commit and pin another. If it reads at `prState`'s `headSha`, on Bitbucket that value is a 12-hex short hash (`plot-host.sh:2221`) that git may not hold, because `openPrsOf` fetches only heads of listed rows.
- Requirement: one value is both the read target and the pin. The natural one is the `OpenPr` entry whose `number` equals the named PR's number, which after #3091 carries the full sha.

### F4. A named PR that does not change the plan file is not covered

- If `idea/<slug>` is OPEN but its head does not change the plan file (no entry in `planPrsCarrying`), today the record comes from PR B and the merge goes to PR A, which carries no copy at all. After a plain reorder, the read at A's head finds no file and the approval ends in `plan-not-found`, which names the wrong cause. The plan must name a refusal for this case (for example `pr-carries-no-plan`).

### F5. Conflict with #3091 (`plot-approve-finds-no-plan-on`, Approved, slice `bug/plot-approve-finds-no-plan-on` not yet pushed)

- #3091's slice moves `openPrsOf` and `holdsCommit` out of `approve.ts:320-362` and `needs-design.ts:163-201` into a new `packages/board/src/server/entry/open-prs.ts`, changes `OpenPr.headSha` to the full sha, and changes `plan-pr.ts:241`. This plan edits `remotePlanOf` (`approve.ts:441-460`), the needs-design read (`needs-design.ts:383-399`), `plan-pr.ts` and the controllers' imports. Both slices are in sprint `follow-ups-2-30-1`, and the template's waves order branches only inside one plan, so the fleet can run both at once.
- Every line number this plan cites in `approve.ts` and `needs-design.ts` moves when #3091 lands. A Sonnet agent that starts from `origin/main` before #3091 merges builds on code that is about to move and meets a conflict in the region it changed.
- #3091 is complementary rather than in the way: after it, `open-prs.ts` returns full shas and both controllers share one listing. This plan's work then reduces to "choose in the domain, read at the chosen `OpenPr`", with no host call added.

### F6. Two more places where the gate copy and the merged copy can split, not mentioned

- `approve.ts:883-886`: a plan held in the checkout is read from the working tree, while the merge goes to the named PR's head. Run from a checkout that is not that head (an idea worktree with an unpushed edit, or another branch that also holds the file), the approval judges the local copy and merges the pushed one.
- `approve.ts:928-929`: under `Impl: same branch` the PR comes from `sameBranchOf` (`approve.ts:241-254`), while `remotePlanOf` still reads the first carrying PR. No merge happens on this arm, so the effect is a record judged from the wrong copy, not an irreversible merge.
- Whether these are in scope is a decision for a person (see below). The plan should say which.

### F7. Rubric answers in brief

1. Fixes the defect: yes in intent. A reader verifies it with the named board test plus a domain test that `planPrOf` returns the named PR's file and head and fills rivals on the named route. It moves the sprint toward zero interventions only marginally: today the wrong merge needs no person; it is a silent wrong answer, and a refusal will need one. That is the correct trade for an irreversible merge.
2. Claims: the cited lines `approve.ts:452-457`, `:934-945`, `plan-pr.ts:174-183`, `:205-219`, `workflows/approve.ts:325-333`, `needs-design.ts:232`, `:393-397` are true on `origin/main` at `ee678d5c8`. The plan omits that `needs-design.ts:225` is a separate controller-side `planPrOf`.
3. Breaks or leaves half-done: the needs-design workflow's readings and refusal set; the `readPlanAt` copies in both controllers (`approve.ts:304`, `needs-design.ts:148`) stay duplicated; no shell, bash 3.2 or ratchet impact, because no script changes. Bitbucket: see F3.
4. Failure modes: rival with differing copy (named in the plan), named PR carrying no copy (F4, not named), named head not held locally (F3, not named), head moved between list and pin (F3, not named).
5. Unattended build: not yet. The three open questions are design decisions, and the plan defers them to "the first interrogation round". The agent also needs the sequencing in F5.
6. Tests: the one named board test fails on main as described. It does not cover the domain rule directly, the needs-design controller, or the F4 case.

## Amendments required

1. Close the three open questions in the plan text. The layering lens answers them this way:
   - Q1: reorder. `planPrOf` names the PR, the plan file and the head sha to read. The controllers ask it first and read the plan only at its answer. A copy comparison, if the person keeps one (Q2), takes blob oids as readings (`refs.resolve('<head>:<file>')`, an existing port op, no new git call and no host call), and the domain compares them. The controller compares nothing.
   - Q2: one rule for both routes. On the named route with `onMain: false`, `planPrOf` asks `open` and fills `rivals` with the other PRs that change the plan file. Then the existing `pr-ambiguous` (`workflows/approve.ts:325-333`) covers both routes and no new reason is needed. If the person wants the equal-copy carve-out instead, it must apply to the open route too, or the two routes refuse differently for the same estate.
   - Q3: yes. Delete the controller-side `planPrOf` at `needs-design.ts:225-240`; needs-design calls the domain `planPrOf` through the same ask loop as `choosePlanPr`, and the needs-design workflow gains a rival refusal.
2. Extend `PlanPrFound` (or add one rule beside it) so the answer carries `file` and the head sha to read. On the named route, take both from the `OpenPr` entry whose `number` equals the named PR. Use that one sha for the plan read, `writeApprovalStatus` and the `--match-head` pin.
3. Name a refusal for an OPEN named PR whose head does not change the plan file (F4).
4. State that the slice starts after `bug/plot-approve-finds-no-plan-on` (#3091's slice) merges, and cite functions by name (`remotePlanOf`, `openPrsOf` in `open-prs.ts`, the needs-design plan read) rather than by line, because those lines move.
5. Replace `needs-design.ts:385`'s `endsWith` with `namesPlan` in the same slice, since the slice rewrites that block.
6. Add tests: in `packages/domain/test/rules-plan-pr.test.ts`, a named OPEN PR plus a second carrying PR yields `rivals` holding the second; a named OPEN PR absent from the carrying list yields the new refusal; the found answer names the file and head of the named entry. In `packages/board/test/unit/needs-design-route.test.ts`, the two-PR case refuses and writes nothing. Each fails on main: the named route returns `rivals: []` and names no file, and needs-design has no rival reason.

## Decisions for a person

- Q2's policy: refuse every rival (reuse `pr-ambiguous`) or allow a rival whose copy is equal (new reason, copy readings). The juror recommends the first: the merge is irreversible, `workflows/approve.ts:325-326` already argues this, and an equal-copy rival is rare.
- Whether F6's checkout read (`approve.ts:883-886`) and same-branch arm (`approve.ts:928-929`) are in scope, or filed as a follow-up.
- Whether to hold this plan's approval until #3091's slice merges, so the fleet cannot dispatch both slices into the same functions at once.

## Ran versus read

Ran (read-only): `git fetch`, `git show origin/main:<file>` for `plan-pr.ts`, `entry/approve.ts`, `entry/needs-design.ts`, `workflows/approve.ts`, `workflows/needs-design.ts`, `ports/refs.ts`, `rules-plan-pr.test.ts`, `approve.test.ts`, `plot-host.sh`, `.plot/templates/plan.md`, the sprint file and the #3091 plan; `git log -S`, `git branch -r`, `git ls-tree`, `gh issue view 3093`, `gh pr list`. Read only: the plan file in the worktree. Ran no test suite and wrote nothing outside this file.

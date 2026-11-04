# Testability juror — 2026-11-04-record-names-no-branch-so-a

Position: amend

## Findings

1. **The code claims hold.** On origin/main `e54e53815`: `eligible.ts:132-134` admits on `phase === design`, one branch, `spike === true`, `spikeApproved === true`. `spike.ts:37-41` is `spikeOf`. `plan-walk-assembly.ts:334` reduces the record to `spikeApprovedRaw !== ''`. `plan.ts:600` writes `${input.on}, ${who}, ${input.channel}` and `:601` returns `branch` beside it, unrecorded. The defect is real and each fact is assertable on a domain value with no browser.

2. **The plan names no test.** The only test text is the slice line (`plan:52`): "tests for a moved marker and a renamed branch". It names no file, no fixture, no assertion and no fail-before cell. Compare plan `2026-11-03-registry-never-hands-out-an-approved.md:81-95`, which names each test, its fixture and the exact cell that fails on main. An unattended agent cannot tell a test that fails before the change from one that passes on main already.

3. **The tests cannot be named until a person chooses the option** (`plan:34`, `:43-46`). Option 1 tests a domain value (`sliceVerdict`, `assemblePlanWalk`, `approveSpike`'s `record`). Option 2 tests a script contract (`test/reconcile/state-gate.test.mjs` over `plot-state-gate.sh`). They share no test. The open questions are correctly a person's decisions, so the plan cannot reach Approved in its current form without them.

4. **The readers to test are wider than the plan names.** The plan names `sliceVerdict` and the queue. A branch-binding rule (option 1) must also hold in every other reader that derives "the approved spike" from marker plus record, or a moved marker still admits through them: `packages/board/src/server/board.ts:1398` (`approvedSpikeOf`, feeds `approvedSpikes` at `:3149`), `packages/board/src/server/entry/gate.ts:566` and `:758` (phase gate `spikeBranch`), `packages/board/src/server/entry/plangate.ts:55`, `packages/board/src/server/fleet.ts:4116` (`approvedSpike`), `packages/board/src/server/entry/verdicts.ts:113` (TSV `spikeApproved` column), `packages/domain/src/rules/draft-placement.ts:13`, `rules/phase-gate.ts:178`, `workflows/dispatch.ts:111`, `workflows/implement.ts:61`, `rules/spike-confirm.ts:39`, `rules/card-controls.ts:70`. A test on `sliceVerdict` alone passes while `gate.ts` still admits the moved branch's commits.

5. **A legacy record exists in the evidence.** The #3095 plan measured a plan carrying `Spike approved: 2026-11-03` — a date alone, with no who, channel or branch (`2026-11-03-registry-never-hands-out-an-approved.md:25`). Option 1's parser needs a test for that shape and for the three-field shape `approveSpike` writes today, whatever legacy rule the person picks.

6. **The tests can run without the operator's fleet, launchd or port 7777.** Option 1 lives in pure domain rules that take readings as values (`eligible.test.ts`, `approve-spike.test.ts`, `plan-walk-assembly.test.ts` already exist). Option 2 lives in `plot-state-gate.sh`, which `test/reconcile/state-gate.test.mjs` drives in a sandbox repo. Neither needs `test/e2e/spike-dispatch.test.mjs` or `spike-card-states.browser.test.ts`, and the plan must say so, or an agent reaches for those.

## Amendments required

- A person answers the four open questions at `plan:43-46` and the plan records the answers.
- Replace `plan:52`'s test clause with named tests, each with its file, fixture and the cell that fails on main. For option 1, at minimum: (a) `approveSpike` returns a `record` that carries `spike.branch` (`approve-spike.test.ts`; fails on main, `plan.ts:600`); (b) `assemblePlanWalk` over a Design plan whose record names `feature/a` while the marker sits on `feature/b` answers `unapproved` for `feature/b`'s slice (fails on main: `eligible`); (c) the same with the spike branch renamed; (d) the legacy shapes `2026-11-03` and `date, who, channel` read per the chosen legacy rule; (e) a domain corpus or agreement test that every reader in finding 4 answers the same licensed branch for fixtures (b) and (c), so no reader keeps the marker-only reading. For option 2: a `state-gate.test.mjs` case that commits a marker move in a plan with `Spike approved:` and expects a named refusal (fails on main: exit 0), plus a case that a marker move in a plan without the record still passes.
- State that the tests run under `vitest` in `packages/domain` and `node --test test/reconcile/`, and that no browser, e2e, fleet or board test belongs to this slice.
- Name the refusal word for a record whose branch the marker no longer carries, so a test asserts a word rather than a missing admission.

## Decisions for a person

- Option 1, option 2 or both.
- The legacy rule for a record that names no branch.
- Whether `/plot-reslice` renaming the spike branch re-approves or rewrites the record under a receipt.

## What I ran versus read

Ran: `git show` and `git grep` on origin/main `e54e53815`, `gh issue view 3101`, `gh pr view 3095` (MERGED). Read: the plan, the issue, `eligible.ts`, `spike.ts`, `plan-walk-assembly.ts`, `plan.ts`, grep hits across `packages/` and `skills/plot/scripts/`. I ran no test suite and executed no fixture, so the fail-before claims in the amendments are read from source, not measured.

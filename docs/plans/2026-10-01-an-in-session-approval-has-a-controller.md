# An in-session approval has a controller

> A plan reviewed in the session and a plan marked Released have no script that owns the write, so each one is a counted `--unowned` receipt. This checkout has recorded 237 of them: 109 `Approved` and 112 `Released`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1088
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `plot-approve.sh --reviewer <name> <slug>` approves a `Review: in-session` plan and records `Approved: <date>, <name>, in-session`. `POST /api/approve` passes the reviewer through. The approval no longer needs an `--unowned` receipt.
- `plot-deliver.sh --release <version> <slug>` marks a Delivered plan Released and records `Released: <date>, <version>`. `/plot-release` calls it, so marking a release no longer needs an `--unowned` receipt.

Board impact: none. No plan-format, template or payload change; the `Approved:` and `Released:` records keep their current form.

## Motivation

Measured 2026-10-01 in `.plot/state/unowned-state-writes.tsv` of the main checkout: 237 rows, of them 109 `Approved`, 112 `Released`, 11 `Rejected` and 5 `Superseded`; 39 rows on 2026-10-01 alone. Every `Approved` row is a `Review: in-session` plan, and every `Released` row is `/plot-release` step 5. The receipt's own header (`plot-state-receipt.sh:13-16`) names both as writes "no script owns today".

The refusal is in three places on `origin/main`:

| Site | Text |
|---|---|
| `skills/plot/scripts/plot-approve.sh:200-205` | `die "plan '$slug' declares 'Review: in-session' — the reviewer is a human in the room."` |
| `packages/domain/src/transitions/plan.ts:257-262` | `review-human`, `the approval needs a human` |
| `packages/domain/src/workflows/approve.ts:155-161` | `review-human` |

The refusal is right that a script cannot be the reviewer. It is wrong that nothing can record the reviewer: the person who said yes is a reading, the same way `/api/continue` takes an answer. `ApproveInput` (`transitions/plan.ts:186-195`) already carries `who` and `channel`; only the refusal discards them.

The `Released` write is already decided in the domain. `release` (`workflows/release.ts:270`) writes `plan-phase Released` and the `Released` record, and the transition bundle accepts the verb (`entry/transition.ts:44`, `:139`, `:151`). No script performs it: `skills/plot-release/SKILL.md:401-406` writes the field by hand under an `--unowned` receipt because "no script owns `Released`".

## Design

### The transition takes the reviewer

`approve` adds no field. Both `ApproveInput` types already carry the approver: `who` in `transitions/plan.ts:186-195`, and `who` beside `on` in `workflows/approve.ts:65-70`, which the record at `:215` writes as `Approved: <on>, <who>, <channel>`. For an in-session approval the caller passes `who: <reviewer>` and `channel: "in-session"`. The case arm splits: `transitions/plan.ts:257-262` handles `in-session` and `ballot` in one arm today, and `in-session` gets its own arm that proceeds when `who` is non-empty and refuses with `review-human` when it is empty, the text naming the flag that supplies it. `ballot` keeps its refusal. `workflows/approve.ts:155-161` already has a separate `in-session` arm; it applies the same rule. `Review: ballot` still refuses in both: a tally is not a name, and this plan does not read ballots.

`workflows/approve.ts` takes the same field and gives the same answer, so the two approve implementations stay one rule. A corpus case in `packages/domain/corpus/` holds the shell's answer against both.

### The scripts perform it

`plot-approve.sh` takes `--reviewer <name>`. For `Review: in-session` it skips the plan-PR steps (there is no plan PR), passes the reviewer to `plot-transition.mjs`, writes the decided phase and record, writes its receipt as the owner it already is, clears `.plot/hold` for each branch, and pushes through `plot-push-main.sh`. Without the flag, the refusal at `:200-205` stays and names the flag. `POST /api/approve` accepts `{"reviewer": "<name>"}` and passes it; a request without it for an in-session plan answers the refusal's sentence.

`plot-deliver.sh` takes `--release <version>`. It asks `plot-transition.mjs` for the `release` verb, writes `State: Released` and `Released: <date>, <version>`, writes its receipt, and pushes. It refuses a plan that is not Delivered, and a version that `git tag --list "v<version>"` does not find, because a Released record must name a tag that exists. `/plot-release` step 5 calls it once per plan instead of the hand edit.

**Why `plot-deliver.sh` and not a new script.** The repository refuses a new `plot-*.sh` (`scripts/check-script-names.sh`), `plot-deliver.sh` already performs the transition bundle and owns a `State:` receipt, and Released is the transition after Delivered. A dedicated controller name belongs to the port work `check-script-names.sh:106` names, not to this plan.

### What this does NOT do

- **It does not approve a `Review: ballot` plan.** Reading a tally is a separate rule.
- **It does not remove `--unowned`.** `Rejected` and `Superseded` keep it until `/plot-reject` has an owner.
- **It does not let a script choose the reviewer.** The name comes from the caller; the board passes the operator's configured name, and a master agent passes the name of the person who said yes.

## Done when

- `plot-approve.sh --reviewer jwloka <slug>` on an in-session Draft plan writes `State: Approved` and `Approved: <date>, jwloka, in-session`, commits, and adds no row to `unowned-state-writes.tsv`; without `--reviewer` it refuses and names the flag.
- `plot-deliver.sh --release 2.22.3 <slug>` on a Delivered plan writes `State: Released` and `Released: <date>, v2.22.3`, and adds no row to `unowned-state-writes.tsv`; it refuses a version with no tag and a plan that is not Delivered.
- `transitions/plan.ts` and `workflows/approve.ts` answer the same for in-session with a non-empty and with an empty `who`, at 100% branch coverage, and a corpus case holds the shell's answer.
- `/plot-approve` step 3b and `/plot-release` step 5 call the scripts; neither SKILL.md tells an agent to write `--unowned` for these two writes.

Tests that fail on `origin/main` today:

- `packages/domain/test/transitions.test.ts`: a new case *approves an in-session plan with a non-empty `who`* fails, because `:132-140` asserts `review-human` for every in-session input. The `:132` case is rewritten to pass an empty `who` and keeps its refusal.
- `packages/domain/test/workflows-approve.test.ts`: the `it.each` at `:61` splits; *approves in-session with a non-empty `who`* fails today, and `ballot` keeps the refusal.
- `test/reconcile/approve.test.mjs`: a new case *--reviewer approves Review: in-session with no unowned row* fails, because `:238-242` asserts the refusal. The `:238` case keeps the refusal without the flag and asserts the message names `--reviewer`.
- A new case in `test/reconcile/deliver-phase-takes-effect.test.mjs`: *--release writes Released and its record with no unowned row* fails, because `plot-deliver.sh` takes no `--release` today.

## Slices

### The transition takes the reviewer (Branch: bug/the-transition-takes-the-reviewer)

The `in-session` arm split in `transitions/plan.ts` and the `who` rule in `workflows/approve.ts`, with one unit case per arm in each: in-session with a non-empty `who` approves, in-session with an empty `who` refuses with `review-human`, and `ballot` refuses with `review-human`. Also the corpus case, the transition bundle input column, and the changeset.

### The scripts own the approval and the release (Branch: bug/the-scripts-own-the-approval-and-the-release) <!-- waits: bug/the-transition-takes-the-reviewer -->

`plot-approve.sh --reviewer`, `plot-deliver.sh --release`, `POST /api/approve` with a `reviewer` body field that becomes `who`, the contract tests in `test/reconcile/`, and the two SKILL.md steps.

## Notes

Split from #1040 on purpose. #1040 is about the release PR's required CI check; this plan is about who writes a lifecycle field. They share the release moment and nothing in their mechanism, so #1040 has its own plan, `the-release-pr-is-checked-before-it-merges`.

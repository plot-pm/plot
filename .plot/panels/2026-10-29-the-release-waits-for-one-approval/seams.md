# Juror verdict: seams with the nine sibling plans and the design

Position: amend

Evidence: Read the plan, DESIGN-delivery-loop.md, issue #2907 (`gh issue view`, read-only), and all nine sibling plans (their Design and Slices sections). Read code at the worktree's HEAD 5246a64f3: `packages/domain/src/workflows/release.ts`, `workflows/merge.ts`, `ports/host.ts`, `ports/build.ts`, `ports/notifier.ts`, `ports/agent-run.ts`, `packages/board/src/server/release.ts`, `server/entry/main.ts` (plot-ask), `server/entry/gate.ts`, `contract/schema.ts`, the header of `skills/plot/scripts/plot-sprint-state.sh`, and `.github/workflows/release.yml`. Ran only greps and reads. I ran no test, because none of these slices exists yet and no current test covers the seams below.

## (a) Problem statement

- The motivation is correct: the steps listed under *The release* are manual today (the design's *What exists today* table, row "Close a sprint; merge the release PR; release sweep").
- The plan says "No other route reaches `release`" and "`release` stays refused for every unattended caller", and treats both as existing facts. They are not facts in the code. `workflows/release.ts:239-245` turns an unattended run into a `PLOT-UNASKED` warning and proceeds, and refuses only on `must-haves-open` (lines 20-21, 231). The controller gate is a Bash PreToolUse hook (`entry/gate.ts:649-651`). It reads command lines that an agent types. It does not see a TypeScript caller in fleetd. So no code stops fleetd from running `release` today.
- "the `/api/release` sweep" does not exist as one call. `server/release.ts:89-97` takes exactly one `slug` and one `version`, refuses a second run for the same slug, and starts `plot-deliver.sh --release <version> <slug>` (line 152). A sweep is N calls, one per Delivered plan.
- `plot-sprint-state.sh` "commits nothing and pushes nothing — the caller owns the commit" (header lines 22-25). The Finish slice therefore owns a commit and a push to the default branch, under `plot-state-gate.sh`'s receipt. The plan does not say this.

## (b) Approach, read against the siblings

**1. The dependencies are named wrong.** The plan names #2900 and #2902 and says "confirm what each delivers". Here is what each step actually needs, and which plan owns it:

| Piece this plan uses | Owner | Named by #2907? |
|---|---|---|
| Frozen sprint scope ("every plan in the frozen scope is Delivered") | #2900, slice `feature/fleetd-reviews-sprint-scope` | No. Prepare step 1 says "A domain rule reads the sprint's plans", which would build a second scope reader |
| Start the reviewer through `agent-run` with a role name | #2898, slice `feature/agent-run-takes-a-role` | No |
| The review record (`plot/review` status on a head SHA) | #2900 defines it (`slicePrNext` reads "the review record's head SHA"); #2902 reads it the same way | No. The plan says "a green, reviewed head" and does not name the record |
| One notification per head, and the record that it was sent | #2899 owns the run log and the once-per-episode notification over `ports/notifier.ts:41` | No. Open question 1 proposes a new state file |
| Merge pinned to the head | Already exists: `workflows/merge.ts` and `plot-ask.mjs merge` (`entry/main.ts:151-176`). #2902 adds only the "one merge in flight" hold | Named as #2902, but the plan does not say which part it needs |
| Fleetd caller identity, and the `release` refusal for unattended callers | #2898, slice `feature/fleetd-caller-identity` | No |

The release PR is not a slice PR. Its branch is `changeset-release/main` (`schema.ts:2590`), and it belongs to no plan (`tuple-row.ts:810`). So #2900's `slicePrNext` review arm and #2902's merge arm do not reach it. This plan has to start the reviewer itself, and it needs #2898's runner to do so. It does not need #2902's merge arm. It needs only the in-flight hold.

**2. No plan builds the `release` refusal for unattended callers.** #2898's caller-identity slice says "`release` *still* refuses every unattended caller". #2907 says "No other route reaches `release`". Each plan assumes that the other plan, or the current code, holds the refusal, and (a) shows that the code does not. Open question 3 makes this a real risk: "a separate step the fleet resumes after a restart" turns fleetd into an unattended caller of `release`, which the design's *Calls made* forbids ("`release` never"). Owner: #2898's caller-identity slice should build the refusal in the domain, and this plan should answer Q3 with "the sweep runs inside the person's approval action, or it does not run".

**3. Approving an `action_required` run is a new write, and no plan owns it.** `ports/build.ts` has only read operations (`system`, `runs`, `runForSha`, `runsForSha`, `limit`, `lastRefusal`, lines 53-155). `ports/host.ts` has no run approval either. The approval is a new Build-connector write. CLAUDE.md's layering rule puts it in an adapter. It is GitHub-only, so Jenkins and Bitbucket need an `unaskable`-style answer. If it lands as a `plot-host.sh` verb, it adds shell lines, and the shell ratchet (`check-shell-lines.sh`) then asks for an equal removal. This plan should own the work, and should state the port operation and its non-GitHub answer.

**4. The release-branch name lives in the board.** `RELEASE_BRANCH` is in `packages/board/src/contract/schema.ts:2590`, with the rule "the name is matched in exactly one place". A domain `releasePrepare` rule cannot import from the board, because the purity gate allows only `zod`. If the rule copies the regex instead, the one-place rule breaks. The constant must move into `@plot-pm/domain`, and the board must re-export it. Name this in slice 1.

**5. The siblings disagree about who builds caller identity.** #2902 says that it "depends on #2900 for that identity". #2913, #2915 and the design attribute caller identity to #2898. This is a defect in #2902, not in #2907, but this plan inherits it through its "Needs #2902".

**6. The review of the release PR has no rule for a HIGH finding.** The design's loop table covers slice PRs only. If the reviewer finds a HIGH on the release PR, the fixer and ticket arms from #2903 do not apply, because there is no desk and no plan. The plan should state the answer. A proposal: notify the person and keep the PR out of "ready", because the person is the one stop anyway.

**7. The plan follows the layering and shell rules.** The rule reads values and spawns nothing, the adapter calls the host, and new code goes into TypeScript. `plot-ask.mjs` has no `release-approve` verb today (`questionFrom`, `entry/main.ts:105-107`, plus the `release-claim` and `merge` branches), so the new verb is a real addition. CLAUDE.md's *The Master Agent Uses The Controllers* paragraph lists the actions that run with no board. That list, and the gate's `mayRunController`, must learn about `release-approve` in the same slice. If they do not, a person's `release-approve` that reaches `plot-deliver.sh --release` meets the controller gate with no receipt.

## (c) Slices

- **Prepare** combines four deliverables: the rule, the new Build write (approve the run), the reviewer start and the notification. Split it into:
  1. `releasePrepare` rule plus moving `RELEASE_BRANCH` into the domain. Waits on #2900's scope slice.
  2. The Build-port approve-run operation and its adapter. Independent; it can merge first.
  3. The fleetd tick wiring. Waits on 1 and 2, on #2898's runner, and on #2899's run log.
- **Approve** needs #2898's caller-identity slice only to prove that the *unattended* path refuses. It needs #2902's in-flight hold, so that a release merge does not land while main is unsettled.
- **Finish** cannot be a separate step that fleetd resumes (see b.2). Either merge it into Approve, as one person-initiated controller call that records its progress so that a re-run by the person can continue, or keep it separate and make it reachable only from the person's action. Its order behind Approve is right.
- **Missing:** the domain refusal of `release` for unattended callers. Either #2898 adds it, or this plan carries it as a fourth slice and #2898's wording ("still refuses") is amended.

## (d) Open questions

- **Q1, the "prepared" state:** do not add a new file. The release PR number and head come from the PR index row. "Reviewed" is the `plot/review` status on that head SHA, the record #2900 defines. "Notified" is a run-log line from #2899, keyed by PR and head. The approval re-asks the host fresh, as `merge.ts` already does, and refuses `head-moved`.
- **Q3, same call or resumed by fleetd:** the same person-initiated call. A fleetd resume makes fleetd an unattended `release` caller, which the design forbids. If the call dies midway, the person re-runs `release-approve`. Each step must be idempotent: `release.ts` already skips `already-released` plans (line 300).
- **Q2, the wait for publish:** `release.yml` is the single publishing workflow. `Build.runForSha(default, mergeSha)` can read its outcome with no new read operation. Bound the wait by the existing `Checks wait` key rather than a new one. If publishing fails after the merge, report it and run no sweep: `release` already refuses `tag-absent` (release.ts:276-279).
- **Q4, the board:** a `release` row kind already exists (`schema.ts:1605-1616`). Extend that row rather than adding a "release-ready row".
- **New questions to carry:**
  - Which version does the sweep pass? `/api/release` needs one, and the release PR's `package.json` holds it (`schema.ts:2662-2665`).
  - What happens when the reviewer finds a HIGH on the release PR?
  - Which plan builds the `release` refusal for unattended callers?
  - How does approving a run answer on Jenkins or Bitbucket?

## (e) Tests

- **Rule:** vitest in `packages/domain/test/`, one case per step: scope not all Delivered gives none; no release PR gives none; `action_required` gives approve-run; pending gives wait; green with no review on this head gives review; green and reviewed with no run-log line for this head gives notify; already notified gives none.
- **Unattended refusal:** a domain unit test showing that `release` with `unattended: true` and no person's approval refuses, and that fleetd's caller identity refuses too.
- **release-approve:** an entry test with a stubbed host for `head-moved`, `not-prepared`, `not-reviewed` and the pinned merge. Add a gate test showing `mayRunController` knows the new verb.
- **Approve-run adapter:** an adapter test with a stubbed `gh`, plus the answer on a non-GitHub backend.
- **Finish:** a test that a re-run after a partial sweep releases only the remaining plans (`already-released`), and a test that a refused `plot-sprint-state.sh` leaves the sprint file unchanged.

## Amendments

1. Replace "Needs #2900, #2902" with the owner table in (b).1. Add #2898 (runner, caller identity) and #2899 (run log, notification).
2. Reuse #2900's scope reader and review record. Do not build either again in Prepare.
3. Record "notified at head X" as a #2899 run-log line, not a new state file.
4. Move `RELEASE_BRANCH` from `packages/board/src/contract/schema.ts:2590` into the domain as part of slice 1.
5. Name the new Build-port operation that approves an `action_required` run, and its answer on non-GitHub backends. Make it its own slice.
6. Answer Q3: the sweep and the sprint close run inside the person's action and never in a fleetd resume. State who commits and pushes the sprint close.
7. Make the `release` refusal for unattended callers a named deliverable, owned by #2898 or added here. Correct "No other route reaches `release`" to describe today's code (`release.ts:239`).
8. State the rule when the reviewer finds a HIGH on the release PR, and which version the sweep passes to `/api/release`.
9. Extend the existing `release` row kind instead of adding a new row, and add `release-approve` to the gate's `mayRunController` and to CLAUDE.md's list of board-free actions.

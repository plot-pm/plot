# Safety juror — plot-approve-reads-the-plan-from

Position: amend

Read on `origin/main` at `ee678d5c8`. The defect is real and every line reference in the plan holds. The plan's approach removes the main split, but it leaves three paths where the copy judged is still not the copy merged or written, and it leaves the refusal name and the comparison undecided.

## Findings

### F1 (HIGH) — The record SHA and the merge pin come from two different host reads

- `approve.ts:457` reads the record at `first.pr.headSha`, which comes from the `pr-list` call in `openPrsOf` (`approve.ts:343-359`).
- On the named route, `choosePlanPr` asks `readPlanPr` (`approve.ts:381-386`), a separate `pr-state` call, and `approve.ts:941` takes `pr.headSha` from that answer.
- `approve.ts:1075` writes the approval status and `approve.ts:1084` pins `--match-head` to that second SHA.
- So even when both reads name the same PR, a push to `idea/<slug>` between the listing and the `pr-state` call makes the gate judge the old head while the merge pins the new head. The pin then proves only that nothing moved after the second read. `hostPinsMerges` returns `true` for every backend (`packages/domain/src/workflows/merge.ts:268`), so the pin is the only guard, and it guards the wrong SHA.
- Approach step 1 says "read the plan record from the head SHA of the PR that `planPrOf` names". It does not say that the record SHA, the status SHA and the `--match-head` SHA are one value read once. An agent can satisfy step 1 by reading `origin/idea/<slug>` or by calling `pr-state` a second time, and both keep the race.

### F2 (HIGH) — A plan in the checkout is judged from the local file, and the plan does not cover it

- `approve.ts:884-890`: where `findPlanFile` finds the plan in the checkout, the record comes from the local file and `remotePlanOf` never runs. No open listing exists either, so `listedOpen` is undefined and the named route never lists rivals.
- `/plot-approve` run from the idea worktree, or from any checkout whose `idea/<slug>` copy holds unpushed or stale edits, judges the local copy and merges the head on the host. That is the same split as #3093, on a path the plan does not name.
- Approach step 2 can never fire on this path, because the named route fills `rivals: []` (`plan-pr.ts:211-221`) and no listing exists to compare.

### F3 (HIGH) — The needs-design write path writes onto a copy it did not judge

- `needs-design.ts:393-397` judges `phase`, `review` and `spec` (`specOf(planText)`, `needs-design.ts:420`) from the first carrying PR's head.
- The board-local `planPrOf` (`needs-design.ts:224-239`) is a second implementation, not the domain rule. It returns no `headSha`, only a branch name.
- `bookOnPlanPr` (`needs-design.ts:486-535`) fetches `origin/<head>` again at write time, and `writePlan` (`needs-design.ts:271-293`) applies the edits to whatever text is there. It checks only that the parse reads `design`.
- So needs-design can move a copy to Design that it never judged, both through the rival split and through a push between the read and the fetch. The push itself is a plain fast-forward push, so a push after the fetch fails, but a push before the fetch is absorbed silently.
- The plan names needs-design in the Motivation, but Approach step 2 names only `workflows/approve.ts`. `planNeedsDesign` has no `pr-ambiguous` refusal at all.

### F4 (MEDIUM) — "The copies differ" is not defined

- Approach step 2 leaves open what is compared: the bytes of the file, the parsed record, or the fields `Review:`, `Impl:` and slices. A parsed comparison over named fields misses a field nobody named. The safe and cheap comparison is the blob ID of the plan file at each head (`git rev-parse <sha>:<file>`), and a rival whose path differs (a rename that `namesPlan` still matches) counts as differing.
- The refusal name is "for example `pr-copies-differ`". An unattended agent needs the exact word, because `approve.ts:573` maps every refusal to its message in a switch, and the board and tests key on the word.

### F5 (MEDIUM) — A rival the listing cannot see passes as no rival

- `openPrsOf` lists at most 100 open PRs (`approve.ts:280`, `:343`). It skips fork PRs and heads that git cannot resolve after the fetch (`approve.ts:347`, `:356`). A rival in any of those sets is absent, and step 2 reads its absence as "no rival".
- With F1 fixed, this cannot cause a wrong merge: the merged copy is the copy judged. It can only let the approval proceed while a differing copy stays open. That is acceptable, but the plan must say so, so that nobody later reads step 2 as proof that no rival exists. A listing that fills its limit should be named in the output.

### F6 (LOW) — Refusal order against the pre-merge writes

- Before the merge, `approve.ts:1066-1075` runs `pr-ready` on a draft PR and writes the `plot/review`-style approval status. Both are host writes. The new refusal must be decided by the domain workflow, before the dry-run block at `approve.ts:1041`, so that "writes nothing" also covers these two writes. The plan says "write nothing" but does not name where the check sits.

### F7 (LOW) — The spike route

- `approveSpike` (`workflows/approve.ts:490-512`) carries its own `pr-ambiguous` arm and also merges the plan PR. The fix must cover it, or the plan must say why a spike approval is out of scope.

## Required amendments

1. State one invariant and test it: the SHA the gating record is read at, the SHA the approval status is written on, and the `--match-head` SHA are one value, taken from one host answer. On the named route, that is the `headSha` of the `pr-state` answer, and the record is read at that SHA after the fetch. No second host read of the head happens between the record read and the merge.
2. Cover the in-checkout path: where the approval merges a plan PR (not `in-session`, not `same-branch`), the gating record is read at the pinned head SHA, whatever the checkout holds. Where the checkout's copy exists and its blob differs from the head's blob, refuse with a named reason before any write. A person decides whether this refuses or only reads the head (see Decisions).
3. Cover needs-design in the same slice: replace the board-local `planPrOf` with the domain rule so that it returns the head SHA, judge the record at that SHA, and in `bookOnPlanPr` compare the plan file's blob at the fetched `origin/<head>` with the blob judged. On a difference, refuse before `writePlan` with a named reason. Add the rival refusal to `planNeedsDesign`.
4. Fix the comparison and the name: compare the plan file's blob ID at each head; a differing path counts as differing. Fix the refusal word (one word for both controllers), add it to the `ApproveRefusal` union, to the switch at `approve.ts:540-577`, and to the needs-design refusal set.
5. Place the check in the domain workflow so that it refuses before `pr-ready`, the status write and the merge, and before the dry-run summary.
6. Name the limit of rival detection (F5) in the plan's Design, and decide whether the named route now lists open PRs (one extra `pr-list` call per approval) so that rivals are visible there at all. Without that listing, step 2 never fires on the named route except where `remotePlanOf` already listed.
7. Extend the tests. Each one fails on `main`:
   - approve, named route: two open PRs, the rival listed first, copies differ in `Review:` → named refusal, and the fixture host records no `pr-ready`, no status write and no `pr-merge`.
   - approve, same PR: the listing reports head A, `pr-state` reports head B → the merge is pinned to the SHA the record was read at, or the approval refuses; never record at A and pin at B.
   - approve, equal copies (same blob) on two PRs → proceeds, pinned to the named PR's head.
   - approve, in checkout: the local copy differs from the head copy → behaviour from amendment 2.
   - needs-design: two open PRs with differing copies → named refusal and no push; `origin/<head>` moved between the read and the fetch → refusal and no push.
   - spike approval: the rival case, or a stated exclusion.
   The fixture for the first test must leave the plan out of the checkout's plan store, or `remotePlanOf` never runs and the test passes on `main` for the wrong reason.

## Decisions for a person

- Open Question 1: from the safety lens, reordering alone is not enough. Approve both: read at the named PR's pinned SHA, and refuse on a rival whose blob differs. A person confirms that the extra `pr-list` call per approval is acceptable.
- Open Question 2: a rival with an equal blob can stay allowed; the merge is still the copy judged. A person decides, because the rival later meets an add/add conflict on the plan file after the approval lands.
- The in-checkout case (amendment 2): refuse on a differing local copy, or read the head and ignore the local copy. Refusing costs an intervention when the operator has unpushed edits; ignoring silently approves text the operator did not see in their own editor. This is a person's choice.
- Each new refusal stops the fleet and asks a person to close a PR. That works against the sprint's zero-intervention goal, but the alternative is an irreversible merge of an unjudged copy, so the refusal is the correct trade.

## What I ran versus read

- Ran: `git fetch`; `git show origin/main:` for `packages/board/src/server/entry/approve.ts`, `packages/board/src/server/entry/needs-design.ts`, `packages/domain/src/rules/plan-pr.ts`, `packages/domain/src/workflows/approve.ts` and `packages/domain/src/workflows/merge.ts`; `git grep` for `hostPinsMerges`, `pr-ambiguous` and `PRS_LISTED`; `git ls-tree` over `packages/board/test/unit/`; `gh issue view 3093`; `gh pr view 3097`.
- Read only: the code paths above. I ran no test and did not reproduce the race; F1 and F3 follow from the code order, not from an observed run.

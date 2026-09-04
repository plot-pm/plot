# A ref is not a claim

> A branch ref answers *does this name exist in git*. Plot reads it as *is somebody working on this*, *has this landed*, and *may an agent take it* — three questions git never answered. Four separate failures on 2026-09-04 traced to that one substitution.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The fleet stops reading a ref's existence as a statement about work. A claim becomes something an agent holds and releases, merge state comes from the host on every path that asks, and a ref that outlives its work stops blocking the plan it belongs to.

Board impact: yes. The board's placement of a branch depends on merge state, and two fixes were needed on 2026-09-04 because the two paths a branch takes read it differently.

## Motivation

**Measured 2026-09-04, this estate:**

| Reading | Result |
|---|---|
| merged branches still carrying a remote ref | **10** |
| of those, where **ancestry disagrees with the host** | **10 of 10** |
| a merged branch's ref **re-created as a claim** after the merge | **2 occurrences on one branch, 35 minutes apart** |
| waves blocked by one such stale claim | **4** |

Ten out of ten is the number that matters. `git merge-base --is-ancestor` is not occasionally wrong here — **squash-merge makes it wrong every time**, because the squashed commit is not the branch's commit. Ancestry has no true answers left in this estate.

### The four failures, and the one substitution behind them

**1. A merged branch read as abandoned work.** `unmergedBranches` asks `git branch -r --no-merged`, an ancestry question, and the board's loose-branch path trusted it. #610, #577 and #616 — merged 2026-09-01 — sat in WAITING ON YOU for three days labelled *abandoned*. Fixed twice, in #684 and #688, because a branch reaches the board by two paths and only one was taught.

**2. A closed PR read as work owed.** The same path hardcoded the closed flag to `null`, so a rejected branch could never reach the one kind `quietNeedsPerson` releases. Fourteen rows. Fixed in #690.

**3. A stale claim blocked four waves.** `feature/an-agent-declares-what-it-is` merged as #679 at 20:46 on 2026-09-03. Its ref was **re-created at 08:59 the next morning** carrying one `plot: claim` commit and nothing else. The scan read the ref, called the slice `claimed`, and — waves being sequential — held four later waves blocked. Deleting the ref cleared them. **It came back at 13:35.**

**4. A phantom ref refused every dispatch.** `origin/HEAD` pointed at `plot-corpus-pin`, a branch that does not exist, so `plot-dispatch.sh` could not resolve the default branch and refused to run. Twice, hours apart.

**One sentence covers all four:** *the existence of a ref is being read as a statement about work.* Git only ever said the name exists.

### Why this is not simply "use the host everywhere"

`DESIGN-branch.md:64` is right that a Branch **is** `refs/remotes/origin/<name>` — that is what makes the push-claim work without a lock manager, and this plan does not touch it. The defect is narrower and it is about *inference*: a ref's presence is being asked questions it cannot answer, and each caller invents its own answer.

`plot-pr-merged.sh` already exists and already says so — *reads `mergedAt`, never `state`, and never ancestry*. The estate has the right answer in one place and does not use it in the places that keep failing.

## Design

### Approach

**One answer to "did this land", and it is the host's.** `plot-pr-merged.sh` is that answer. Every path that asks — the board's two, the scan's, the reaper's, the sweep's — reads it rather than deriving one. Ancestry is not a fallback: it is wrong 10 times in 10 here, so a caller that falls back to it fails in the direction of hiding finished work.

**A claim is held, not implied.** Today a claim IS a ref with a claim commit, so a ref that outlives its work reads as a live claim forever, and re-creating the ref re-creates the claim. Separate them: an agent holds a claim while it lives, and the claim ends when the agent does — which `an-ending-carries-its-reason` (#687) now makes recordable.

**A merged branch cannot be claimed.** The re-claim at 13:35 is the sharpest measurement in this plan: something asked for a branch whose PR merged the previous evening and got it. Whatever offers work must ask the host before offering, or the loop repeats however many times the ref is deleted.

**`origin/HEAD` is repaired, not trusted.** `git remote set-head origin --auto` fixed it twice. A component that needs the default branch should ask for it and repair a symref that does not resolve, rather than refusing.

### Open Questions

- [ ] **What re-creates the claim ref?** Measured twice, cause unknown. A worker loop hopping, a dispatch racing, or the corpus tests — `plot-corpus-pin` is theirs, and the phantom `origin/HEAD` points at it. The cause must be found before the fix, or this plan patches a symptom for the third time.
- [ ] **Does the push-claim survive as the lock?** `DESIGN-branch.md:52` says it is the whole locking mechanism, and `an-agent-holds-one-desk` already argues the registry becomes the assignment lock with git's refusal demoted to a backstop. This plan should not decide that twice — but a claim that is *held* rather than *implied* is the same change seen from the ref's side, and the two plans must agree.
- [ ] **Should a merged branch's ref be deleted at merge?** `plot-release-refs.sh` deletes refs plan-scoped, after delivery, for a stated reason: a deleted ref is not re-creatable and the blast radius must be bounded by the plan file. Deleting at merge is simpler and removes the population entirely — but it is exactly the estate-wide sweep that script declines to be.

## Branches

### Asking the host

- `feature/one-answer-to-did-this-land` — every path that decides merge state reads `plot-pr-merged.sh`, and no caller derives one from ancestry or from `state`. Includes a gate: a grep in CI for `--no-merged` and `is-ancestor` outside that script, so the next caller cannot quietly add an eleventh wrong answer.

### Finding the re-claim

- `bug/a-merged-branch-cannot-be-claimed` — **find the cause first, then refuse.** Reproduce the 13:35 re-claim, name what did it, and make whatever offers work ask the host before offering. The refusal is the deliverable only once the cause is written down.

### Repairing the symref

- `bug/the-default-branch-repairs-itself` — a component that needs the default branch repairs an unresolvable `origin/HEAD` rather than refusing. Names what it repaired, so a recurring corruption is visible rather than silently patched.

## Notes

**This plan came from a question after four fixes.** Asked *"the ref seems to be the cause in most of the cases, should we introduce a different concept?"* — the answer is that the concept is already right and the inference is wrong. A Branch is its ref; what a ref *means* is where the estate keeps guessing.

**Three of the four failures were reported fixed before they were.** #684 fixed one of two board paths and was reported as closing the bug; #688 fixed the second; #690 fixed a third defect on the same line. Each time the measurement was real and the scope was assumed. That pattern is the reason the first branch here carries a CI gate rather than a fix alone.

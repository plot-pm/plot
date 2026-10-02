---
'plot': patch
'@plot-pm/board': patch
---

The fleet scan reads both hosts' merge subjects as proof that a branch with no ref landed. Fixes part of #1139. Measured 2026-10-01 on a Bitbucket repository, a branch merged and deleted is proven merged by the `Merged in <branch> (pull request #N)` commit on the default branch, and Plot read only GitHub's `Merge pull request #N from <owner>/<branch>` — so under HTTP 429 the branch read `unknown`, its slice never completed, and every later slice of its plan was held while `git log --grep='^Merged in '` returned 1723 proofs nothing could see. The forms are now data in the host adapter, matched by the vendor-free rules `rules/merge-subject.ts` and `rules/remote-owner.ts`; a backend Plot has no form for proves nothing and every branch falls through to the host as before. On GitHub a subject counts only when it names the repository's own owner, compared without case, and any owner counts where none can be read, as for a local-path origin. A subject proves a branch for a plan only when the merge is not contained in the commit that added that plan's file, so a name a later plan reuses does not settle a slice nobody started; the footer counts those as `subject_predates_plan` and the branch reports `subjectIgnored`. A proven branch costs no host call unless its plan is a delivery candidate and the host is answering. Auto-delivery and the board's Deliver control read the new rule `allSlicesConfirmed`, so neither acts on a landing only a subject proves — a throttled host no longer leaves a plan's auto-delivery stuck until the board restarts. `merge_detect` gains `unaskable`, which says the rule could not be asked rather than that the estate has no merge commits.

<!--
plan: docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md
bumps:
  skills:
    plot: patch
    plot-pulse: patch
-->

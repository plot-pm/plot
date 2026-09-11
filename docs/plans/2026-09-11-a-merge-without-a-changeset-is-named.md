# A merge without a changeset is named

> A branch can merge with no changeset and nothing says so. The gate that exists validates changesets that EXIST; a merge carrying none passes every check and ships with no release note.

## Status

- **State:** Approved
- **Type:** feature
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-11, Jan Wloka, plan-PR #887 merged
- **Started:** 2026-09-11, Jan Wloka, `feature/a-merge-without-a-changeset-is-named`

## Changelog

- A merged branch that committed no changeset is reported before the release consumes the estate, so a change cannot ship with no release note.

<!-- Board impact: none. This adds a scan finding, not a rendered state. -->

## Motivation

**Measured in one session: two merges nearly shipped with no release note.** Filed as a W36 Must, unbuilt when that sprint closed on 2026-09-11, and re-validated that day — still true.

**`check-changeset-packages.sh` is the wrong shape for this.** It validates changesets that exist: that each names a real workspace package, says what changed in more than 20 characters, and does not lead with its `bumps:` comment. A branch carrying **no** changeset passes it trivially, because there is nothing to validate.

**The failure is silent in the direction nobody investigates.** A missing release note is invisible until someone reads the published changelog and finds a feature absent — by which time the release is cut and the tag cannot be moved.

### Why this is not a merge gate

**A merge with no changeset is legitimate and common.** A docs fix, a test-only change, a revert, a build-artifact rebuild — this repo merges all of them without a changeset, correctly. A gate refusing them would fire constantly on honest work, which is the shape people turn off.

**So this reports and never refuses**, the same call `a-merged-pr-carried-work` made for the same reason: what is missing is the *decision*, not the outcome.

**And it reports rarely.** With the exclusions below, the check is silent across the last 40 merges on this estate — which is what separates a signal from a second `sprint_drift`.

## What this is not

- **Not a check that the changeset is CORRECT.** That is `check-changeset-packages.sh`, which already runs in CI and stays as it is.
- **Not a release blocker.** `/plot-release` gates on the sprint, not on this. A finding informs the person cutting; it does not stop them.
- **Not a per-commit hook.** The question is about a merged *branch*, and a branch's changeset can arrive in any commit on it.

## Slices

### The scan reports a merged branch that carried no changeset (Branch: feature/a-merge-without-a-changeset-is-named)

A new advisory section in `plot-reconcile-scan.sh`, below the `== blocking sections end ==` marker, with its own footer counter.

**It asks the MERGE COMMIT, not the branch, and needs no host call at all.** `git diff --name-only --diff-filter=A <merge>^1 <merge>^2` names every file the merged side added, so a `.changeset/*.md` among them is the answer. Verified 2026-09-11 in both directions: #886 added `the-mock-board-has-a-sprint.md` and the method found it; #884 added none and the method said so.

**The branch ref is the wrong handle and would have failed quietly.** The first draft of this slice read `<base>...<head>`, which needs the branch to still exist — and `plot-release-refs.sh` deletes merged refs by design. Measured the same day: **3 remote branches survive on this repository** against hundreds of merges, so a branch-keyed check would answer *no changeset* for almost everything, for the wrong reason.

**So the scan is where it lives for a different reason than the first draft gave.** Not because the merged-PR bundle is already fetched — it needs no host at all — but because a person already runs the scan, it has a footer-counter convention, and its advisory/blocking split is established.

### Three exclusions, each measured rather than assumed

**Unnarrowed, this fires on 25 of the last 40 merges — 63%.** That is `sprint_drift=57`'s failure reproduced: a counter so loud nobody reads it. Each exclusion below was measured on that window.

| exclusion | why | after |
|---|---|---|
| the merge touched no `packages/*/src/` or `skills/` | a docs, test or fixture merge describes nothing a release note would carry | 25 → 8 |
| the merged branch is `idea/*` | a plan PR ships no code and carries no changeset by construction | 8 → 2 |
| the merged branch is `changeset-release/*` | the release PR CONSUMES changesets; demanding one of it inverts the workflow | 2 → 0 |

**Zero findings on the last 40 merges, and 7 across 150.** Every implementation merge that touched shipped code in that window carried a changeset — so this section is silent on a healthy estate, which is the property that makes a non-zero count worth reading.

**A fourth exclusion the 150-merge window exposed:** most of those 7 are `Merge remote-tracking branch 'origin/main' into <branch>` — a rebase-style merge INTO a feature branch, not a merge of work into main. Those are not deliveries and must not be counted.

**Done when:**

- A merge of implementation work that added no `.changeset/*.md` is named, with its PR number where one is resolvable.
- The four exclusions hold: no shipped-code change, `idea/*`, `changeset-release/*`, and a merge whose first parent is not on the default branch's history.
- A merged branch that added a changeset is silent.
- The section carries a footer counter and sits **below** the blocking marker, so it gates nothing.
- **Measured on this estate: the count is 0 over the last 40 merges.** A non-zero count is then a signal rather than a backlog, and each finding is confirmed by hand.

## Notes

### Where this deliberately does not go — 2026-09-11

**Not `/plot-deliver`.** Delivery asks whether a plan's branches merged. A changeset is a property of the *release*, not of the plan, and a plan can legitimately deliver work whose release note another slice carries.

**Not a PR check.** A changeset committed after CI runs would report a false positive, and re-running to clear it trains people to re-run.

**The honest limit is now git's, not the host's.** Reading merge parents needs no `pr-list`, so `MERGED_PR_LIMIT` does not bound this section — what bounds it is how far back the scan chooses to walk `git log --merges`. That is a local choice with no rate limit behind it, and the section states its window rather than implying completeness.

**What the merge-parent method cannot answer** is a SQUASH-merged branch: the squash has one parent, so there is no merged side to diff. This repository uses merge commits — verified 2026-09-11 — and an adopting repository that squashes needs a different handle. The section says so rather than reporting every squashed merge as missing a changeset.

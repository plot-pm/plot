# A merge without a changeset is named

> A branch can merge with no changeset and nothing says so. The gate that exists validates changesets that EXIST; a merge carrying none passes every check and ships with no release note.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches

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

## What this is not

- **Not a check that the changeset is CORRECT.** That is `check-changeset-packages.sh`, which already runs in CI and stays as it is.
- **Not a release blocker.** `/plot-release` gates on the sprint, not on this. A finding informs the person cutting; it does not stop them.
- **Not a per-commit hook.** The question is about a merged *branch*, and a branch's changeset can arrive in any commit on it.

## Slices

### The scan reports a merged branch that carried no changeset (Branch: feature/a-merge-without-a-changeset-is-named)

A new advisory section in `plot-reconcile-scan.sh`, below the `== blocking sections end ==` marker, with its own footer counter.

**The data is already fetched.** The scan bundles one `pr-list --state merged --limit "$MERGED_PR_LIMIT"` at `plot-reconcile-scan.sh:473` and keeps `number head` pairs for section 18. This reads the same bundle and adds no host call — which is the whole reason the section belongs in the scan rather than in a new script.

**A branch's changeset is any `.changeset/*.md` added by a commit on it**, which `git diff --name-only --diff-filter=A <base>...<head>` answers without touching the host.

**Done when:**

- A merged branch whose commits added no `.changeset/*.md` is named, with its PR number.
- A merged branch that added one is silent.
- The section carries a footer counter and sits **below** the blocking marker, so it gates nothing.
- An unreachable host reports nothing rather than everything — the same `pr_reliable` rule section 18 already applies, because without the merged list every branch reads as unchecked.
- Measured against this estate: the count is reported, and every named branch is confirmed by hand to carry no changeset.

## Notes

### Where this deliberately does not go — 2026-09-11

**Not `/plot-deliver`.** Delivery asks whether a plan's branches merged. A changeset is a property of the *release*, not of the plan, and a plan can legitimately deliver work whose release note another slice carries.

**Not a PR check.** A changeset committed after CI runs would report a false positive, and re-running to clear it trains people to re-run.

**The honest limit:** the merged-PR bundle is capped at `MERGED_PR_LIMIT` and the scan already says so when the page fills exactly. An older merge with no changeset is not seen, and the section inherits that caveat rather than pretending to completeness.

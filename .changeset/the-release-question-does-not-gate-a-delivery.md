---
'plot': patch
---

`plot-reconcile-scan.sh` prints `Delivered but already released` below the `== blocking sections end ==` marker, so the release question no longer stops a delivery. The section asks which release contains a plan, not whether that plan's delivery landed, and its unanswerable case is `cannot resolve` — which on a host whose `pr-state` carries no merge commit is every delivered plan there is: the repository that reported #943 measured 45 findings and `unreleased_delivered=82`, with `/plot-deliver`'s step 7b gate unable to clear on any plan. **The section keeps the number 6 and prints last**, which is the marker's design rather than an oversight: the number is a label, the marker is the boundary, and `/plot-deliver`'s `sed` is untouched by the move. Renumbering the sixteen sections it now follows was measured and rejected — 49 failing tests, 46 of them asserting a literal `== N.` whose meaning had not changed. The section reports exactly as before and `unreleased_delivered=` still counts what it reported. Its `inspect:` line named `gh pr view` unconditionally and now switches on `PR_SOURCE`, whose arms are named rather than interpolated because that variable also carries the status words `degraded`/`absent`/`failed`/`off`; a Bitbucket repository is handed `bb pr view` and an unprobed one the adapter itself. Two tests run `/plot-deliver`'s own `sed`+`grep` over a fixture carrying such a finding, and the Bitbucket one reproduces #943 directly — a `bb pr view` answering without a `mergeCommit` key. **This does not fix `/plot-release`**: its step 5b gate reads the footer's `unreleased_delivered=` count, which placement does not affect, so the reporter can deliver and still cannot release.

<!--
plan: docs/plans/2026-09-17-a-merge-commit-is-asked-of-the-host.md
bumps:
  skills:
    plot: patch
    plot-deliver: patch
-->

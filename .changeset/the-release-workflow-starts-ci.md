---
'plot': patch
---

`release.yml` starts CI on `changeset-release/main` each time it updates the release PR, so the PR's required `validate` check reports and a release merges without `--admin`. The required check had never reported once: the pull request run is held at `action_required` because the PR is bot-authored, and the push run this file was written for does not exist, because the branch is pushed with `secrets.GITHUB_TOKEN` and GitHub starts no workflow from an event that token caused. Measured 2026-10-01 through the Actions API: 0 runs with `event=push` on that branch, ever, and v2.22.0, v2.22.1 and v2.22.2 each merged with `gh pr merge --admin`. A new `dispatch-ci` job holds `actions: write` and nothing else, checks nothing out and adds no action, so the publishing job's permissions do not change and every `uses:` stays SHA-pinned. `ci.yml` gains a `workflow_dispatch` trigger whose first step in both jobs refuses any ref but `refs/heads/changeset-release/main` and any `github.sha` that differs from the dispatcher's `expected_sha` — that branch carries no branch protection and no ruleset, so any writer can push between the force-push and the dispatch. Its `concurrency` group lets a regeneration cancel the superseded release run while leaving every pull request and `main` push run alone.

<!--
plan: docs/plans/2026-10-01-the-release-pr-is-checked-before-it-merges.md
-->

# Sprint: Desk probes and liveness

> fleetd reads refs, objects, desks and GitHub in-process, and a worker's liveness needs no process, so an idle fleetd pass starts a fraction of today's processes.

## Status

- **State:** Planning
- **Start:** 2026-11-09
- **End:** 2026-11-13
- **Release:** 2.35.0

## Sprint Goal

The sprint delivers Phases 5 and 6 of the story [Nothing changed, nothing runs](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (#3170): refs and objects read from files and one batch, the per-desk probes in the domain, GitHub reads in-process, a node worker wrapper and a liveness token. It also runs CI on slice PRs into a sprint branch, reuses a green CI job while the base is unchanged, and makes `GET /api/board` start no process while the board serves fleetd's snapshot.

The census measures the outcome: S4 (an idle fleetd pass) at merge base 1124.5 (GitHub, 0 desks), 2585.5 (GitHub, 3 desks) and 2676 (Bitbucket, 3 desks) per pass, from CI run 42595561157. Each plan names the share it removes.

All work for this sprint goes to the integration branch `sprint/desk-probes-and-liveness`. `sprint-prs-run-ci` lands first, so every later slice PR runs CI. The sprint PR merges into `main` at sprint close.

### Must Have
- [ ] [sprint-prs-run-ci] Sprint PRs run CI <!-- pr: #3308, branch: infra/sprint-prs-gate-base -->
- [ ] [refs-from-files] Refs and worktrees read from files (#3170) <!-- pr: #3308, branch: feature/refs-from-files-adapters -->
- [ ] [one-cat-file-batch] One git cat-file batch per repository (#3170) <!-- pr: #3308, branch: feature/one-cat-file-batch-adapters -->
- [ ] [desk-probes-in-domain] The desk probes read from files (#3170) <!-- pr: #3308, branch: feature/desk-probes-in-domain-activity -->
- [ ] [github-reads-in-process] GitHub reads in-process (#3170) <!-- pr: #3308, branch: feature/github-reads-in-process-client -->
- [ ] [node-worker-wrapper] The worker wrapper is a node bundle (#3170) <!-- pr: #3308, branch: feature/node-worker-wrapper-bundle -->
- [ ] [liveness-token] A worker's liveness is a token (#3170) <!-- pr: #3308, branch: feature/liveness-token-locks -->

### Should Have
- [ ] [ci-reuses-green-runs] CI reuses green runs <!-- pr: #3308, branch: infra/ci-reuses-green-runs -->
- [ ] [board-api-starts-nothing] The board API starts nothing (#3170) <!-- pr: #3308, branch: feature/board-api-starts-nothing-census -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->

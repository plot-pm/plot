# plot-reconcile

Plot/branch hygiene sweep — surface drift between plan status, index symlinks, and branches in one read-only pass.

## Purpose

The periodic reconciliation pass for the Plot workflow. Per-delivery attention misses drift that only becomes visible in aggregate: a plan's `status:` disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing `status:`, `status:`/`phase:` disagreement).

`/plot-reconcile` runs a deterministic scanner (`../plot/scripts/plot-reconcile-scan.sh`) that emits a five-section report, each finding carrying its exact remediating command as copy-paste text. It is **read-only by construction** — the only write it performs is `git fetch`. The human decides which printed commands to run.

Run it weekly, and especially **after a delivery batch**, when a half-landed `/plot-deliver` (symlink moved, `status:` not flipped) is freshest.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md`. The integration branch the sweep compares against defaults to `main` and is overridable with an `- **Integration branch:** <name>` config line.

## Design split

Follows Manifesto Principle 3 (skills interpret and adapt; scripts collect and report):

- **`plot-reconcile-scan.sh`** — the computational half: mechanical, reproducible enumeration of ref/plan state. Small-model runnable.
- **`SKILL.md` Stage 2** — the inferential half: deciding which drift to fix, which branch is truly stale, whether a plan should be delivered or rejected. Frontier-tier judgment.

## Forge

gh-native. The scan learns open-PR branches from `gh pr list --state open --json headRefName`, degrading gracefully to git merge-state alone when `gh` is unavailable (it prints `PR state: DEGRADED`; in that mode the stale-branch section may list a branch that still has an open PR, so each is confirmed before deletion).

A forge abstraction (Bitbucket/GitLab) is a possible follow-up if demand exists; plot is gh-only across all its helpers today, so gh-native is the natural fit.

## Testing

- **Scan against plot's own plans:** run `skills/plot/scripts/plot-reconcile-scan.sh --no-fetch` — plot dogfoods `docs/plans/`, so the sweep has real data. Verified all five sections execute, the integration-branch config read + default both work, and a missing `docs/plans/delivered/` dir is tolerated without crashing.
- **Config parsing:** the `- **Integration branch:** <name>` read handles bold-markdown, plain, and indented forms, and rejects prose false-positives.
- **Provenance:** the scan engine was proven twice in a downstream monorepo (cpq-cds), each run catching genuine drift a human then fixed, before being contributed upstream.

## Known Gaps

- **gh-only.** No forge abstraction — Bitbucket/GitLab repos can't enumerate open PRs (they fall back to git merge-state via the degraded path).
- **Advisory only, by design.** Never auto-applies a fix. This is deliberate: a downstream run showed the scan's own suggested fix for a `Superseded` plan was wrong (defaulted the symlink to `active/`; the terminal index was correct), so the human override must stay in the loop.
- **Branch prefixes are hardcoded** in the scan (`idea|feature|bug|docs|infra`) rather than read from the `## Plot Config` branch-prefixes key.

## Planned Improvements

- Optional forge adapter (gh/bb/glab) if a non-GitHub adopter needs open-PR precision in the stale-branch section.
- Read branch prefixes from `## Plot Config` instead of hardcoding them.
- A separate, opt-in `/plot-deliver` nudge ("run the reconcile sweep?") after a delivery batch, gated behind a `## Plot Config` key so repos that don't use the sweep aren't prompted.

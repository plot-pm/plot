# plot-reconcile

Plot/branch hygiene sweep — surface drift between plan phase, index symlinks, and branches in one read-only pass.

## Purpose

The periodic reconciliation pass for the Plot workflow. Per-delivery attention misses drift that only becomes visible in aggregate: a plan's phase disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing phase, front-matter `status:`/`phase:` disagreement).

`/plot-reconcile` runs a deterministic scanner (`../plot/scripts/plot-reconcile-scan.sh`) that emits a five-section report, each finding carrying its exact remediating command as copy-paste text. It is **read-only by construction** — the only writes it performs are `git fetch` and (when unset) the local `origin/HEAD` ref. The human decides which printed commands to run.

Run it weekly, and especially **after a delivery batch**, when a half-landed `/plot-deliver` (symlink moved, phase not flipped) is freshest.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md` (plan directory, indexes, branch prefixes). The main branch the sweep compares against is detected from `origin/HEAD` and overridable with an `- **Main branch:** <name>` config line.

## Design split

Follows Manifesto Principle 3 (skills interpret and adapt; scripts collect and report):

- **`plot-reconcile-scan.sh`** — the computational half: mechanical, reproducible enumeration of ref/plan state. Small-model runnable.
- **`plot-plan-meta.sh`** — the shared plan parser the scan builds on: the one place that knows what a plan file looks like (canonical `## Status` body format and YAML front matter both parse). Its contract is specified by example in `test/reconcile/`.
- **`plot-config.sh`** — the `## Plot Config` accessor the scan builds on: the one place that knows where plot configuration lives.
- **`SKILL.md` Stage 2** — the inferential half: deciding which drift to fix, which branch is truly stale, whether a plan should be delivered or rejected. Frontier-tier judgment.

## Forge

Open-PR enumeration binds to the forge of the **`origin` remote's host**: `gh` on GitHub (pinned to origin's repo via `-R`), `bb` on Bitbucket. A repo can carry extra remotes on other forges; letting a CLI resolve the "current repo" itself would silently enumerate the wrong repo's PRs, so the scan never does. Unknown host or missing CLI → `PR state: DEGRADED`, falling back to git merge-state alone (the stale-branch section may then over-list branches with an open PR, so each is confirmed before deletion).

Since bb 3.1 ([quatico-solutions/agent-skills#18](https://github.com/quatico-solutions/agent-skills/issues/18)) the two arms are call-symmetric: `bb pr list --state open --json headRefName --jq '.[].headRefName'` matches the `gh` invocation exactly. Older bb versions reject the field argument and fall back to the full-object `--json` form; pre-`--json` versions degrade to git merge-state.

## Testing

- **Contract tests** (`pnpm run test:reconcile`, wired into CI): `test/reconcile/` specifies the plan-format and config grammar by example — one fixture per supported shape with exact expected parser output — and runs the scan end-to-end against a throwaway git repo containing one planted finding per report section (non-default `plans/` layout, so the config path is exercised). The tests verify the scan *detects*, not merely *runs*.
- **Real-repo verification:** run against plot's own `docs/plans/` (finds genuine merged-but-not-delivered and stale-branch findings) and against a Bitbucket monorepo with `plans/` at the repo root (config honored, `develop` detected from `origin/HEAD`, `bb` PR enumeration excludes branches with open PRs).
- **Provenance:** the scan concept was proven twice in a downstream monorepo (cpq-cds), each run catching genuine drift a human then fixed, before being contributed upstream.

## Known Gaps

- **Advisory only, by design.** Never auto-applies a fix. This is deliberate: a downstream run showed the scan's own suggested fix for a `Superseded` plan was wrong (defaulted the symlink to `active/`; the terminal index was correct), so the human override must stay in the loop.
- **GitHub.com and Bitbucket only** for open-PR precision; other forges (GitLab, self-hosted hosts) run in the degraded git-merge-state mode.
- **`origin` is assumed** as the remote of record (matching the rest of plot).

## Planned Improvements

- A one-line drift summary in `/plot`'s dispatcher output pointing at `/plot-reconcile`.
- A scoped post-delivery verification gate in `/plot-deliver` (re-run the scan for the just-delivered slug), superseding the earlier opt-in-nudge idea.
- `glab` arm in the forge seam if a GitLab adopter shows up.

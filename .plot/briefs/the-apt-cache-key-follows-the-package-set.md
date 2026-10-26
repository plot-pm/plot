## Implementation brief — ci-job-caps-and-the-apt (wave: Apt cache)

- **Plan (canonical):** docs/plans/2026-10-24-ci-job-caps-and-the-apt.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2534 merged
- **Branch:** `infra/the-apt-cache-key-follows-the-package-set` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (plot-review required on main)

This is one of three sibling branches on the same plan. `infra/ci-job-caps-exceed-their-step-caps` (wave: Caps and gate order) already has a `Started:` record and PR #2557; `infra/ci-comments-state-current-behaviour` (wave: Comments and gates) has not started. All three touch `.github/workflows/ci.yml` — this branch and the caps branch both edit it in different jobs. Rebase over whichever merges first; do not wait for it.

### What to build

The Playwright apt cache in `.github/workflows/ci.yml` goes stale because its key tracks only the resolved Playwright version, not the package set `install-deps` actually wants. Three independent defects, all in the same ~130-line block (lines 399-520 as of `84b1638e4`, re-measure before editing — slice 1's edits to earlier jobs may have shifted them):

1. **Cache key ignores the package set** (`ci.yml:448`, `key: playwright-apt-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}`). An exact-version key hit never re-saves, so once a key exists for a Playwright version, the packages cached under it are frozen at whatever Ubuntu published the day it was created — even as the runner image and mirror move on. Fix: the key must include something that changes when the actual package set changes, not just when Playwright's version bumps.
2. **The stage step copies everything, not just what this run needed** (`ci.yml:515-519`, `Stage this run's apt packages for the cache`, `sudo cp -n /var/cache/apt/archives/*.deb ...`). `cp -n` (no-clobber) means an obsolete `.deb` already in the staging directory from a prior run is never overwritten and never removed — it rides along in every subsequent save under `restore-keys`, forever, even after the real package no longer matches it.
3. **Resolve the Playwright version step has no failure guard** (`ci.yml:399-403`). No `set -euo pipefail`. If `pnpm --filter @plot-pm/board exec playwright --version` fails or prints nothing, `awk '{print $2}'` on empty input emits an empty string, `$GITHUB_OUTPUT` gets `version=`, and every downstream cache key becomes `playwright-apt-Linux-` — a hit against garbage, or a silent fallback to `restore-keys`' broadest match. This must fail loud instead.

### Decisions the plan leaves open — you decide, with a measurement

- **Cache key source (plan's Open Question, unresolved):** the plan names two options and does not pick one. **Prefer hashing the pinned package list this repo controls** (e.g. the Playwright version's own `install-deps --dry-run` listing, or whatever file names the exact packages/versions it wants) over an `apt-get --print-uris` network call before the cache restore step — the point of the cache is to avoid hitting the mirror on a hit, so a key that itself requires a mirror round-trip undoes half the saving. If you go the other way, say why in the PR: the plan allows it, but the no-network-call property is the one this slice should not give up without a stated reason.
- **What "the package set" means operationally:** it is NOT the Playwright npm version string (already in the key) — it is the set of OS `.deb` names/versions `install-deps` resolves for the current runner image. If you can get a stable, cheap (no mirror fetch) representation of that set — e.g. `playwright install-deps chromium --dry-run` output, hashed — key on that composed with the OS and Playwright version. If no cheap deterministic source exists, name what you tried and what blocked it; do not silently fall back to "just the version" (that is the bug this slice fixes).
- **Stage step fix:** drop `-n` or add a cleanup pass so a `.deb` superseded by a newer version in the same package name does not survive alongside it. Simplest correct form: clear the staging directory's prior contents for the cache's key scope before copying this run's actual archive contents, so what gets saved is exactly what this run fetched/validated — nothing inherited from a different package generation.
- **Resolve-version step:** add `set -euo pipefail` and fail the step explicitly if `version` resolves empty (e.g. `[ -n "$version" ] || { echo "::error::empty Playwright version"; exit 1; }`), so a broken resolve stops the job instead of silently poisoning the cache key for every downstream step.

None of this touches the browser cache (`ci.yml:416-422`, keyed on Playwright version alone) — that one is correct as-is, because the browser binary genuinely is selected by Playwright version and nothing else (see the comment above it). Scope is the **apt** cache only.

### Done when

The plan's `## Done when` is implicit in its Design section 2 — lift these as the testable claims:

- A changed package set (not just a changed Playwright version) produces a different cache key, or the PR states why no cheap source exists.
- The stage step's output cannot carry a `.deb` left over from a different package generation than the one this run resolved.
- The "Resolve the Playwright version" step fails the job (non-zero exit, visible error) when the version string would otherwise resolve empty — add a test or a recorded CI run demonstrating this if a direct unit test isn't practical for a workflow YAML step.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this branch touches only `.github/workflows/ci.yml`, which the local-checks mapping does not cover with a package-scoped suite, so expect it to print the repo-wide shell/script gates (`check-script-names.sh`, `check-temp-paths.sh`, etc.) and nothing else. The suites under `CI suites` in `## Plot Config` run in CI on every PR; do not run them locally — a failure there comes back as a correction, not a local gate.

`scripts/check-shell-lines.sh` ratchets the shipped shell's total line count against this branch's merge base. The YAML `run:` blocks you're editing count toward that total — if your fix adds lines to the install/stage steps, either keep the net shell line delta at or below zero, or remove an equal number of lines elsewhere in this same change. The gate stores no number and grants no exemption.

### Bookkeeping

- Open the PR with `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving) — never `gh pr create`. It reads the plan, titles the PR from this branch's wave heading, and fills the body from the plan and this brief.
- When the PR exists, append `→ #<number>` to this branch's line under `### Apt cache` in the plan's `## Slices` section, and push that commit.
- Push the first real commit as soon as it exists — an empty claimed branch with no commits is indistinguishable from an abandoned one.

### Scope guard

This branch owns the apt-cache block in `.github/workflows/ci.yml` only: the "Resolve the Playwright version", "Cache Playwright's apt packages", "Install Playwright system packages", and "Stage this run's apt packages for the cache" steps (lines ~399-520 at `84b1638e4` — re-measure, do not trust these numbers after slice 1 lands). Do not touch:
- the `validate` job, step/job `timeout-minutes` values, or `Require the split jobs` ordering — that's `infra/ci-job-caps-exceed-their-step-caps` (PR #2557, may already be merged or in flight).
- `checks-verdict.ts`, `bounded-run-group-stop.test.ts`, `check-helper-table.sh`, `plot-host.sh` comments, or any other stale-comment fix — that's `infra/ci-comments-state-current-behaviour` (not yet started as of this brief).
- the browser cache step (`ci.yml:416-422`) and the browser install step (`ci.yml:522-534`) — unrelated to the apt package cache, out of scope here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

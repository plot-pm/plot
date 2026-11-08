# plot-release

Create a versioned release from delivered plans.

## Purpose

Spoke of the Plot workflow. Verifies release readiness: discovers delivered plans since the last release, collects changelog entries, cross-checks release notes against actual work, and presents recommended next steps (version bump, tag, push) for the user to confirm. Does not execute release steps automatically — the user controls when versions are bumped and tags are pushed. Only feature and bug plans are included in release notes — docs/infra are live when merged.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow. Adopting projects configure via a `## Plot Config` section in their `CLAUDE.md`.

## Testing

Validated as part of the Plot end-to-end lifecycle tests:

- **test-v2:** Full 4-phase lifecycle (Draft through Released). Found and fixed tag creation issue (annotated tags required for `git push`). Successfully created release v0.1.1.

## Provenance

Originated as part of the Plot workflow in a private project. Created during the v2 refactoring (session 4, 2026-02-07) as a new command splitting release from the original ship flow. Migrated to a standalone skill in this repo.

See [plot/README.md](../plot/README.md) for the full development history and [plot/changelog.md](../plot/changelog.md) for commit-level details.

## Known Gaps

- Version detection relies on git tags — projects not using tags will need manual version input.
- No support for pre-release versions (alpha, beta, rc).

## Planned Improvements

- Pre-release version support (e.g., `1.2.0-beta.1`).
- Configurable changelog format and release note templates.

## State branch

Where `## Plot Config` declares `State branch`, the commit this skill makes in a default-branch checkout is landed with `board/plot-state-cut.mjs --land` instead of a plain `git push`: the state ref and the default branch are merged into HEAD and the record is pushed at the state ref. Exit 4 means no key is declared, and the plain push runs.

# Round 1 — moderation

Panel: skeptic, operator, domain. Positions: amend, amend, amend (unanimous).

## What each juror looked at

- **Skeptic:** read `ci.yml` step order, `.gitattributes`, `package.json`, the dirt readers and the push history of `main` (`gh run list`), and measured run time and push rate.
- **Operator:** read GitHub settings through read-only `gh api` calls (protection, secrets, the release PR #1160's checks and runs), the last 7 `main` runs, the loop's `reset_desk`, and the fail-closed bundle callers.
- **Domain:** read the dirt readers through the domain (`trees-git.ts`, `rules/gates.ts`, `rules/movable.ts`, `registry.ts`), `plot-desk-dirt.sh`'s naming rule, the bundle derivations and the resolver's removal sites.

All three read code and settings. None ran the build or a test.

## Agreements (all three)

1. Slice 2's gate refused the bot's own bundle PR, which deadlocked the design.
2. Keeping the freshness check failing on `main` made `main` red after every source merge, by design.
3. CI ran contract, e2e and corpus suites before the build, so a PR would be tested against `main`'s bundles.
4. `plot-desk-dirt.sh` is one of four readers of desk dirt; the supervisor's reading (`plot_worker_dirty_filter`) would call a desk holding a rebuild `stalled`.
5. The workflow needs a `concurrency` group.
6. "Every bundle caller treats a missing answer as could not ask" is false: several callers stop, and an old bundle can answer the old rule.
7. The release PR builds bundles (`package.json:22`), so Open Question 4 had an answer.
8. Slice 3's removal list was incomplete.

## Findings by one or two jurors

- **Repair line from the wrong commit** (operator, domain): restoring from `origin/main` leaves a diff against the merge base. Restore from the merge base.
- **The directory is not the generated set** (domain): `README.md` and `plot-monitor.mjs` are hand-written. Name paths, never the directory.
- **`reset_desk` leaks a desk** (operator): a desk holding rebuilt bundles cannot check out a `main` whose bundles moved.
- **A commit-time gate** (skeptic): refuse a staged generated path at commit, not after CI.
- **Release tag freshness** (domain): the release job must check freshness before tagging.
- **The freshness and set-equality assertions** live in the repair's test file and must move, not go (domain).
- **`artifact-conflict` would promise a repair nobody runs** (domain).
- **Release PR #1160 never ran a check** (operator): `GITHUB_TOKEN` pushes start no workflow, so the `ci.yml:6-22` workaround never fired, and the repository holds no secrets.

## The one divergence: how fresh bundles reach `main`

- Skeptic and operator measured a 16–18 minute `validate` against a push about every 9 minutes, with bursts of four in 10 minutes. A force-pushed bot PR restarts its checks on each push and can starve for hours. Both named a direct push through a bypass actor as the alternative that removes the window.
- Domain held that, with `strict: false`, the bot PR trails by at most one merge, and named `workflow_dispatch` as a token-free route.
- The divergence is about burst behaviour. The skeptic and operator measured bursts; the domain juror reasoned from one merge at a time.

**Decision (operator, 2026-10-02): a GitHub App pushes the build to `main` through a ruleset bypass.** That removes the bot PR, its gate exemption and its starvation, and shortens the window to one build.

## Shared blind spot

No juror ran the build or measured how long the workflow's install-and-build takes on a runner. The plan's 3–5 minute window is an estimate until slice 1 measures it.

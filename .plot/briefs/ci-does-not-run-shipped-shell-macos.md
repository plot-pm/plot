## Implementation brief — ci-does-not-run-shipped-shell (wave macOS run)

- **Plan (canonical):** `docs/plans/2026-10-25-ci-does-not-run-shipped-shell.md` on main
- **Approved:** 2026-10-25, Jan Wloka, plan-PR #2670 merged
- **Branch:** `bug/ci-does-not-run-shipped-shell-macos` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review App, required since 2026-10-15)

This branch waits on `bug/ci-does-not-run-shipped-shell-scan`, which merged as PR #2679 (`637a37f96`, "Static gate") — the wave is eligible now. Nothing else is in flight on this plan.

### What to build

A CI job on a macOS runner that runs shipped-shell-touching tests with `bash` resolved to `/bin/bash` 3.2.57 — the version macOS ships, and the version the static gate (`scripts/check-bash32-syntax.sh`, merged in the prior slice) cannot fully stand in for. The static gate greps for eight named bash-4 constructs; it cannot catch a construct it doesn't name, or a behaviour change with no syntax error at all. PR #2659's `${1^^}` was exactly a syntax hit the grep now catches — this job exists for the next bug that isn't on the list.

All four existing CI jobs (`corpus`, `helper-contracts`, `board-integration`, `validate` — `.github/workflows/ci.yml:103,203,341,574`) run `runs-on: ubuntu-latest`. None run macOS. This is a fifth job, not a modification of the four.

### Decisions the plan leaves open — resolve them, don't re-derive them from scratch

The plan's `## Open Questions` names four things this slice must settle. Measure before committing to an answer; this plan explicitly expects a throwaway branch to prove the runner behaves before the real job is written.

**Which tests run under 3.2.** `test/reconcile/*.test.mjs` is 176 files. `CLAUDE.md`'s own Testing section says that glob "takes more than ten minutes on Linux" and `test:e2e` is excluded from local runs for cost reasons already — a macOS runner is both slower per-minute-charged and likely slower in wall time for the same work. Running the full glob risks exceeding `timeout-minutes`. Favor a bounded subset: the `Local checks` config's own `** = node --test test/reconcile/*gate*.test.mjs` row is the precedent for a cheap, targeted slice of this same glob, and this plan's wave explicitly asks for "the shell contract tests," not the whole reconcile suite. Pick the subset that actually starts a shipped `.sh` script (so a bash-3.2-breaking change is caught) and name what's excluded — no silent narrowing. If the full glob turns out to fit the runner's `timeout-minutes` after measuring, say so and use it; don't assume either way without the measurement.

**Does `macos-latest` still ship `/bin/bash` 3.2.57.** GitHub rotates `macos-latest`'s underlying image periodically; Apple has shipped 3.2.57 as `/bin/bash` since Snow Leopard and that has not changed, but confirm on the actual runner rather than assuming — `bash --version` as the job's first step, asserted or at least logged, so a future image bump that somehow ships a newer bash is visible in the job output rather than silently testing nothing. Also confirm the Node 24 / pnpm setup this repo's other jobs use (`.github/workflows/ci.yml`'s setup steps) actually completes on `macos-latest` — different `actions/setup-node` and corepack behavior per OS is a real failure mode, not a hypothetical.

**Static scan alone vs. this job for the first merge.** The plan raises deferring this job until the scan has run for a release. That's a judgment call for review, not something to decide unilaterally in the branch — build the job, and let the open question stand as a discussion point if the PR reviewer wants to defer merging it. Don't skip building it on the assumption it'll be deferred.

**Which files count as "shipped" shell for this job.** The static gate's own `$ROOTS` (read `scripts/check-bash32-syntax.sh` for its current file-selection logic — it covers `skills/**/*.sh` and the `scripts/*.sh` CI runs) is the precedent to follow for scope, since the macOS job's purpose is to catch what that same scan structurally cannot. Keep the two in scope-agreement: a file the scan checks but this job's tests never execute is only half-covered, and that gap is worth naming in the PR even if not fully closed in this slice.

### Done when

The plan's `## Done when` list is the specification (the plan carries none explicitly beyond the Expected-behaviour paragraph in Motivation — treat "a pull request that adds any of the eight named constructs to shipped shell fails CI" as already satisfied by the merged scan; this slice's own bar is narrower: a macOS job exists, runs a real `/bin/bash` 3.2.57, and fails on a defect the static scan's grep cannot see).

Add: a fixture or manual check proving the job actually runs under 3.2 and not under whatever `bash` resolves to on `PATH` — the same mistake the plan's Motivation documents CI making before this plan existed (`bash` from `PATH` is bash 5 even on `ubuntu-latest`; macOS runners typically have a newer Homebrew bash on `PATH` too, ahead of `/bin/bash`). Resolve the binary by absolute path (`/bin/bash`), not by name, in whatever invokes the tests.

Plus the repo's standing gates: `scripts/check-shell-lines.sh` refuses growth in shipped shell under `skills/` beyond the merge base — this slice's shell (if any — a CI workflow YAML change plus a script invocation may need none) should stay flat or pay for growth by removing elsewhere. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` (`CLAUDE.md`'s `## Plot Config`) run in CI, not locally — do not run `test:e2e` locally (`CLAUDE.md`'s Testing section: CI's job, not a local one, and a local run of it degrades the shared machine).

### Bookkeeping

- Open the PR through the controller: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` directly.
- When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### macOS run` heading.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `.github/workflows/ci.yml` (a new job, not edits to the four existing ones), and whatever new script or workflow step resolves `/bin/bash` and runs the chosen test subset. It does not own `scripts/check-bash32-syntax.sh` or its registration — that shipped in PR #2679 and is done.

No other branch of this plan is in flight. The scan slice (`bug/ci-does-not-run-shipped-shell-scan`) merged as #2679; nothing else claims this plan's territory.

If you find something the plan did not anticipate — e.g. `macos-latest` no longer shipping bash 3.2, or the Node/pnpm setup failing on macOS — report it rather than improvising a workaround outside this scope.

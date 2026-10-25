# CI does not run shipped shell under bash 3.2

> A pull request that adds bash-4-only syntax to shipped shell fails CI, because a gate checks for it and a job runs the shell under bash 3.2.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2669
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-25, Jan Wloka, plan-PR #2670 merged
- **Started:** 2026-10-25, Jan Wloka, `bug/ci-does-not-run-shipped-shell-scan`
- **Started:** 2026-10-25, Jan Wloka, `bug/ci-does-not-run-shipped-shell-macos`

## Changelog

- CI refuses bash-4-only syntax in shipped shell (`${x^^}`, `${x,,}`, `declare -A`, `mapfile`, `readarray`, `|&`, `&>>`, `${x@Q}`), so a script that breaks under macOS `/bin/bash` 3.2.57 no longer merges.

<!-- Board impact: none. No plan format, template, plan-directory layout or board code changes. A new script under scripts/ is a CI gate, not a shipped helper under skills/plot/scripts/. -->

## Motivation

Shipped shell must run under bash 3.2, the `/bin/bash` on macOS and the shell on the operator's machine. Scripts already declare this, for example `plot-fleet-scan.sh:3036` and `plot-reconcile-scan.sh:877`. No gate holds the rule.

Measured on PR #2659: it added `${1^^}` to `bb_query_state` in `skills/plot/scripts/plot-host.sh`. Under `/bin/bash` 3.2.57 the function fails with `${1^^}: bad substitution`, and all three Bitbucket PR queries break. CI was green on that head, for two reasons:

- All four CI jobs (`corpus`, `helper-contracts`, `board-integration`, `validate`) run `ubuntu-latest` with bash 5, and the tests start `bash` from `PATH`.
- `bash -n` does not catch it. `/bin/bash -n plot-host.sh` passes on the broken version, because the bad substitution is a run-time error.

The `plot-review` reviewer found the defect by reading the code (#2660), and a fix agent confirmed it by hand with `/bin/bash`. A rule that depends on a reviewer noticing is a rule, not a gate (see *Gates Over Rules* in `CLAUDE.md`).

Expected: a pull request that adds any of these to shipped shell fails CI: `${x^^}`, `${x,,}`, `declare -A`, `mapfile`, `readarray`, `|&`, `&>>`, `${x@Q}`.

## Design

### Approach

Two checks, because each catches what the other misses:

1. **Static scan** — `scripts/check-bash32-syntax.sh` greps every tracked shipped shell file (`skills/**/*.sh`, and the `scripts/*.sh` that CI runs) for the bash-4 constructs above and fails with `file:line: construct`. It needs no bash 3.2 binary, runs on the existing Ubuntu jobs in seconds, and follows the pattern of the other `scripts/check-*.sh` gates (`check-host-cli-callers.sh`, `check-script-names.sh`). Comments and quoted strings must not trigger it: `scripts/owned-run.sh:336` mentions bash 3.2 in a comment. A line that deliberately uses the construct (for example inside a `[ "${BASH_VERSINFO[0]}" -ge 4 ]` guard) declares it with an inline marker, the way `check-ancestry-decisions.sh` takes a declared kind.
2. **Run under 3.2** — a CI job on a macOS runner (`macos-latest`, `/bin/bash` 3.2.57) runs the shell contract tests with `bash` resolved to `/bin/bash`. This catches what grep cannot: a construct not on the list, or a bash-4 behaviour change with no syntax error. It costs a macOS runner minute rate and a slower job, so it runs a bounded subset (see Open Questions).

The gate registers in `## Plot Config` → `Local checks` (the `**` row that lists the `scripts/check-*.sh` gates) so that `plot-local-checks.mjs` prints it, and gets a row in `skills/plot/scripts/README.md` only if it lives there. It lives in `scripts/`, so it does not.

A test in `test/reconcile/` mutation-tests the gate: a fixture holding each of the eight constructs fails it, a fixture holding the bash-3.2 equivalents passes it, and the pre-fix `plot-host.sh` from before #2660 fails it.

### Open Questions

- [ ] Which macOS tests run under 3.2 — the whole `test/reconcile/*.test.mjs` glob, or only the files that start a shipped script? The glob under `owned-run.sh` takes more than ten minutes on Linux; on macOS it may exceed the job's `timeout-minutes`.
- [ ] Does `macos-latest` still ship `/bin/bash` 3.2.57, and does the Node 24 / pnpm setup run there? Measure on a throwaway branch before the slice commits to it.
- [ ] Is the static scan alone enough for the first merge, with the macOS job deferred until the scan has run for a release? The scan catches all eight constructs named in the issue.
- [ ] Which shell files count as shipped: `skills/**/*.sh` only, or also `scripts/*.sh` and the `.husky`/hook scripts? Only files the operator's machine runs need 3.2.

## Slices

### Static gate

- `bug/ci-does-not-run-shipped-shell-scan` — `scripts/check-bash32-syntax.sh`, its mutation test, and its CI and `Local checks` registration <!-- builds: check-bash32-syntax.sh, a CI gate refusing bash-4-only syntax in shipped shell --> → #2679

### macOS run

- `bug/ci-does-not-run-shipped-shell-macos` — a CI job that runs the shell contract tests under `/bin/bash` 3.2.57 on a macOS runner <!-- builds: a macOS CI job running shipped shell under bash 3.2 --> <!-- waits: bug/ci-does-not-run-shipped-shell-scan -->

## Notes

- Source: tracker issue #2669. The plan records it in `Issue:`; nothing was written to the tracker.
- Evidence: PR #2659 (`${1^^}` in `bb_query_state`), review finding #2660.
- Created unattended: Review (`pr`), Impl (`own branches`) and State (`Draft`) took the defaults. A reader can change them before approval.

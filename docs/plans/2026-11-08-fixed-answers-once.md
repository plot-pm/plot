# Answers fixed for a process's life are read once

> The repository root, the common git directory and the host backend do not change while a board or fleetd runs. Each process reads them once, and passes them to the scripts it starts, instead of starting `git rev-parse` and `plot-host.sh backend` on every pass.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** nothing-runs
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3238 merged
- **Delivered:** 2026-11-08

## Changelog

- The board and fleetd read the repository root, the common git directory and the git host once per process, and pass them to the helper scripts they start. An idle pass no longer starts `git rev-parse` or `plot-host.sh backend` to ask them again.

Board impact: none on the plan format, the template or `docs/plans`. Helper scripts read two environment variables they already accept or newly accept; their output does not change.

## Motivation

On 2026-11-05 a 30-second sample of the idle board's direct children counted 8 × `git rev-parse --show-toplevel` and `plot-host.sh backend` among about 75 processes; fleetd's 160 included 44 `git` (story, Why Now). Each new image costs a `syspolicyd` check on macOS, which ran at about 80 % CPU that day across three boards and three fleetds.

These answers are fixed for the process lifetime (story, *Answers with no process*), and the code asks them again per call:

- `refsGit.repoRoot` starts `git rev-parse --show-toplevel` per call (`packages/domain/src/adapters/refs/refs-git.ts:727`).
- `hostShell.backend` starts `bash plot-host.sh backend` per call (`packages/domain/src/adapters/host/host-shell.ts:354`), and `reviewWriter` does it again (`:530`). fleetd builds a fresh `hostShell` and asks `backend()` at `registryd-main.ts:885`, `:966`, `:986`, `:2672`, `:2948`, `:3069` and `:3082`, and `registry.ts:1091` does the same. Inside the script, `backend` reads `plot-config.sh get "Git host"` and `git config --get remote.origin.url` (`plot-host.sh:3358-3378`).
- Every `plot-host.sh` call resolves `be="$(backend)"` before its op (`plot-host.sh:3909`), so each host question starts `plot-config.sh`, which starts `git rev-parse --show-toplevel` unless `PLOT_REPO_ROOT` is set (`plot-config.sh:290-291`).
- Fourteen file adapters each start `git rev-parse --git-common-dir` to place their file: `pr-index-file.ts:84`, `issue-index-file.ts:62`, `reader-lock-file.ts:89`, `slice-spend-file.ts:94`, `run-log-file.ts:109`, `answer-record-file.ts:89`, `fresh-agent-record-file.ts:90`, `refused-slices-file.ts:70`, `fleetd-start-file.ts:60`, `pinned-tips-file.ts:74`, `supervision-report-file.ts:74`, `ending-ask-record-file.ts:74`, `reap-record-file.ts:101`, and `tracker-plan-state.ts:72`. Some cache per adapter instance (`registryd-main.ts:2820`, `:2858`, `pr-refresh.ts:1486`); a fresh instance asks again.

Two precedents exist. The board caches its backend per cache entry (`fleet.ts:791`, `resolveBackend` at `:2633`), and `scan-walk.ts:224-225` memoises it per walk. `plot-config.sh` reads `PLOT_REPO_ROOT`, which the board exports (`index.ts:78`); measured on CI 2026-09-25, one board build started `git rev-parse --show-toplevel` 21 times out of 42 `git` processes before that.

## Design

This plan depends on `process-census-gate`. Slice *Answers in process* turns its **P3** row (after the first pass, neither fleetd nor the board starts, as a direct child, `git rev-parse` with `--show-toplevel` or `--git-common-dir`, or `bash …/plot-host.sh backend`) into a required pass. Slice *Answers in scripts* turns its **P4** row (after the first pass, no process in the tree starts `git rev-parse` with `--show-toplevel` or `--git-common-dir`) into a required pass.

### Approach

**Slice 1: the adapters ask once per process.**

- A new adapter module `packages/domain/src/adapters/git-dirs/git-dirs.ts` answers `{ toplevel, commonDir }` for a `cwd` with one `git rev-parse --show-toplevel --path-format=absolute --git-common-dir` and holds the answer in a module-level map keyed by the `cwd`'s realpath. A failed read is not held, so the next call asks again.
- `refsGit.repoRoot` and the file adapters listed above read their paths through it. Each keeps its own rule for which directory it uses (`--git-common-dir`, never `--show-toplevel`, for the shared state files); only the read moves.
- `hostShell.backend` and `reviewWriter` read the backend through a module-level memo keyed by the repository root and the value of `PLOT_HOST`. An exit 4 ("cannot drive") is held too: it is the script's permanent answer. Any other failure is not held.
- All functions are arrows with TSDoc that states behaviour. The memo lives in adapters only; no rule or workflow holds it.

**Slice 2: the scripts take the answers they are given.**

- The adapters that start scripts (`runProcess` in `scriptsShell`, `hostShell`, `processesShell`) set `PLOT_REPO_ROOT` and a new `PLOT_GIT_COMMON_DIR` in the child's environment from the slice 1 answer, and `PLOT_HOST` from the memoised backend. They set them in the child's `env` only, never in `process.env`, and never in the environment of a dispatched agent.
- `plot-config.sh` already reads `PLOT_REPO_ROOT` (`:290-291`). `plot-host.sh`'s `backend_declared` already reads `PLOT_HOST` (`:3358`) and then starts no `plot-config.sh` and no `git config`. `plot_env_file` (`plot-host.sh:3028-3034`) reads `PLOT_REPO_ROOT` and `PLOT_GIT_COMMON_DIR` before it asks git. `plot-worker-state.sh` and `plot-desk-root.sh` read them where they ask `--show-toplevel` or `--git-common-dir` today. A missing or non-directory value falls back to git, as `plot-config.sh` does.
- `PLOT_HOST` keeps its meaning: it is the declared host, and the memoised value is the answer `plot-host.sh backend` gave from the same configuration. `PLOT_HOST_OTHER` (`plot-host.sh:3915`) still selects the other backend after it.
- `scripts/check-shell-lines.sh pr` reads zero or fewer: each change replaces `x="$(git rev-parse …)"` with `x="${VAR:-$(git rev-parse …)}"` on the same line, or removes a line elsewhere.

**Risk.** A held answer outlives a repository that moves while the process runs (story, Candidate Plans). The board and fleetd restart on a move in practice; the risk is accepted in the story's table and the memo holds no answer across processes.

### Open Questions

- [ ] `PLOT_HOST` also suppresses `backend`'s "no 'Git host' key and no remote names one — assuming" warning (`plot-host.sh:3431-3434`). With the memo passing `PLOT_HOST` to every child, a repository that names no host warns once, at the first read, and not per call. A person confirms that is the wanted behaviour.
- [ ] `sdk-runner.ts:54` removes `PLOT_REPO_ROOT` from an agent's environment on purpose. Slice 2 keeps that filter and adds `PLOT_GIT_COMMON_DIR` and `PLOT_HOST` to it, so a dispatched agent asks for itself.
- [ ] The census P3 row measures only direct children; how many of the 8 `--show-toplevel` calls in the 2026-11-05 sample came from scripts rather than adapters is unknown until the census runs. Slice order follows that number if the census shows scripts dominate.

## Done when

| Claim | Check | Slice |
|---|---|---|
| fleetd and the board ask each fixed answer once | census P3 is `it` and reads 0 per pass after the first | Answers in process |
| A failed read is asked again | unit row: a `git` stub that fails once and then answers; the second call starts `git` and holds the answer | Answers in process |
| A refusal is held | unit row: `plot-host.sh backend` exits 4; the second call starts nothing and returns the same refusal | Answers in process |
| Paths do not change | the existing adapter tests (`pr-index-file`, `slice-spend-file`, `reader-lock-file` and the rest) pass unchanged, including the desk-versus-main-checkout rows | Answers in process |
| No script re-asks | census P4 is `it` and reads 0 per pass after the first | Answers in scripts |
| A wrong variable falls back | contract rows: `PLOT_REPO_ROOT=/nonexistent` and `PLOT_GIT_COMMON_DIR=/nonexistent` make the scripts ask git and answer as before | Answers in scripts |
| An agent does not inherit them | a dispatch row asserts the agent's environment holds none of the three variables | Answers in scripts |
| The shipped shell does not grow | `scripts/check-shell-lines.sh pr` passes | Answers in scripts |

## Slices

### Answers in process

- `bug/fixed-answers-once-in-process` — `packages/domain/src/adapters/git-dirs/git-dirs.ts`; `refs-git.ts`, the file adapters and `host-shell.ts` read through it and the backend memo; unit rows; census P3 flipped to `it`; a changeset for `plot` <!-- builds: gitDirs, a once-per-process git directory reading --> → #3261

### Answers in scripts

- `bug/fixed-answers-once-in-scripts` — the script-starting adapters pass `PLOT_REPO_ROOT`, `PLOT_GIT_COMMON_DIR` and `PLOT_HOST`; `plot-host.sh`, `plot-worker-state.sh` and `plot-desk-root.sh` read them; contract rows in `test/reconcile/`; census P4 flipped to `it`; a changeset for `plot` <!-- builds: PLOT_GIT_COMMON_DIR, an environment answer the helper scripts read -->

### Remaining askers

- `bug/fixed-answers-once-remaining` — `plot-desk-root.sh` (`plot_repo_root`, `plot_exclude_desk_root`), `plot_desk_exclude` in `plot-worker-state.sh`, `plot-agent-settings.sh` and `plot_env_file` in `plot-host.sh` read `PLOT_REPO_ROOT` / `PLOT_GIT_COMMON_DIR` before they ask git, under the same same-repository check as `plot_given_common_dir`; each node bundle fleetd starts reads them from its environment before it asks; census P4 flipped to `it` once it reads 0; a changeset for `plot` <!-- builds: the remaining fixed-answer readers in scripts and bundles -->

## Notes

- Phase 2 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `process-census-gate`.
- Callers checked against `origin/sprint/nothing-runs` on 2026-11-08. The story's claim that the board starts `plot-host.sh backend` holds for its sub-paths (`gate.ts:899`, `plan-state.ts:153`, `released-labels.ts:165`, `finding-tickets.ts:158`), but the board's own cache already holds the backend (`fleet.ts:791`); fleetd builds a fresh `hostShell` at seven sites.
- Definition of Done: docs/definition-of-done.md.
- 2026-11-08: Slice *Remaining askers* added. With *Answers in process* (#3261) and *Answers in scripts* (#3262), P4 still has askers that ignore the environment: `plot-desk-root.sh`, `plot_desk_exclude` (`plot-worker-state.sh:537`), `plot-agent-settings.sh`, `plot_env_file` (`plot-host.sh`, Jira only), and every node bundle fleetd starts (one ask per new process). The first census also counted 1 tree-wide ask in 2 idle passes (github, 0 desks) that nobody has traced yet.

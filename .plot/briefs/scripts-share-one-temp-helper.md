## Implementation brief — every-temp-directory-has-an-owner (slice 1 of 3: Scripts share one temp helper)

- **Plan (canonical):** `docs/plans/2026-09-30-every-temp-directory-has-an-owner.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session (over a round-3 `amend`; the eight round-3 fixes are folded into the plan and no juror has measured them, so each Done-when fixture is the first proof)
- **Branch:** `bug/scripts-share-one-temp-helper` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session
- **Issue:** #1083

This is the first of three slices, and both later slices wait on it. `bug/the-suites-own-their-temp-root` (Layers 3-4) needs every script temp path under `TMPDIR`, or its leak gate is blind on macOS and red on Linux. `bug/every-state-file-declares-its-bound` (Layer 5) needs slice 2's sandbox. So this slice builds none of the test wrapper, the leak gate, the ledger rotation or the log rotation.

### What to build

Layers 1 and 2 of the plan:

1. `skills/plot/scripts/plot-tmp.sh`, a sourced helper with `plot_tmpdir VAR prefix`, `plot_tmpfile VAR prefix` and `plot_on_exit command`, a file-backed exit registry at `"${TMPDIR:-/tmp}/plot-reg.$$"`, and the process's only EXIT/INT/TERM traps.
2. The migration of every site the plan counts. The counts were re-verified against `main` at `49919cbf` on 2026-09-30 and all hold: 14 `mktemp` sites (5 template-less, 2 hardcoded `/tmp`, 7 templated), 48 `/tmp/plot-host-err.$$` occurrences, the other eight fixed-name `/tmp` paths in `plot-host.sh`, `plot-open-pr.sh` and `plot-write-config.sh`, and 8 traps in 7 scripts, with the fleet-scan pair at `plot-fleet-scan.sh:583` and `:2588`.
3. `scripts/check-temp-paths.sh` (or a similar name that passes `scripts/check-script-names.sh`), a gate modelled on `scripts/check-host-cli-callers.sh` and wired into `ci.yml` beside it (`ci.yml:473`).
4. The fleet-scan host-state cache renamed to `plot-fleet-host-state.*`.
5. `plot-reap.sh --sweep-temp`, `--dry-run` by default, over `$TMPDIR/plot-*` and dead-pid `$PLOT_BUDGET_HOME/memo/<pid>`, with a `Temp sweep after` config key (default 24 h).
6. `plot-registryd.mjs --sweep-temp`, off by default, shaped like `startAgents` (`registryd-main.ts:110-120`), run at most once an hour and keyed by the mtime of `.plot/state/temp-sweep.at`, through an adapter. Pass the flag in both `skills/plot/units/com.plot-pm.registryd.plist` and `plot-registryd.service`.
7. Three advisory counts in `plot-reconcile-scan.sh`, below `== blocking sections end ==`: the sweepable count, the legacy `tmp.*` fleet-cache count, and the broken-lock count. Until slice 3, `budget-lock-broken.tsv` does not exist, so the broken-lock count reads 0 when the file is absent. Absent means zero lines here, not "unaskable".

The failure this fixes: a fleet scan leaves one `tmp.*` directory of about 955 files on every run, because `:2588`'s `trap` replaces `:583`'s. Measured on 2026-09-30: about 50 new entries in six minutes with two boards and two supervisors running. The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**Assignment by name, never `d=$(plot_tmpdir x)`.** Round 2 measured the substitution form. A trap installed on first call inside `$(…)` removes the path when the substitution closes. A variable registry filled inside `$(…)` is a copy, so the path leaks. `printf -v "$1"` assigns in the caller's shell, and the gate refuses `$(plot_tmpdir` and `$(plot_tmpfile`.

**The registry is a file keyed by `$$`, not an array.** `$$` is the owner's pid in every subshell, so a registration made inside `$(…)` or `( … ) &` reaches the owner's trap. Four sites already run inside a substitution: `plot-host.sh:861`, `:2878`, `:2884` and `plot-reconcile-scan.sh:2966`. `plot-budget.sh:410-417` records the same fact for the budget memo. Do not use `$BASHPID`.

**Traps are installed at source time, once.** The `PLOT_TMP_LOADED` guard makes a second source a no-op. Without it, a library that re-sources the helper truncates the live registry. At first source, the helper fixes the registry path, so a later `TMPDIR` change does not move it, and truncates any file already at that path. That file is a dead same-pid process's registry, and its `c:` commands must not run.

**INT and TERM re-raise.** The handler runs the cleanup, clears its own trap with `trap - INT` or `trap - TERM`, then runs `kill -INT $$` or `kill -TERM $$`. Round 2 measured the current `trap 'rm …' EXIT INT TERM` shape: on TERM it deleted the directory and exited 0. The five `EXIT INT TERM` scripts now exit 143 or 130, which is a behaviour change. Check each for a caller that reads the old 0: `plot-board-verify.sh`, `plot-install-hooks.sh`, `plot-fleet-scan.sh` (read by the board with a 90 s timeout, and by `bounded.sh`), and `plot-resolve-artifact.sh`. The three EXIT-only scripts already exit 143.

**`plot-worker-loop.sh` keeps its ALRM and USR1 traps.** Only its EXIT trap (`:1611`, `_cleanup_on_exit`) moves to `plot_on_exit`. `plot-host.sh:2655`'s `budget_memo_clear` moves to `plot_on_exit` too.

**Templates put the X's last.** Use `"${TMPDIR:-/tmp}/plot-<prefix>.XXXXXX"`, because BSD `mktemp` requires trailing X's. `mktemp -t` and a bare `mktemp` both ignore `TMPDIR` on macOS (`man mktemp`). That is the whole reason for the helper.

**The sweep matches `plot-` plus at least one character, with any separator.** `mkdtempSync` appends six characters with no dot, so `plot-host-pTFuyG` is the common shape. In the real `$TMPDIR`, 4,850 of 4,952 `plot-*` entries had no dot. The sweep excludes an entry named exactly `plot`, `plotter-old` and every `tmp.*`. It lists candidates with `find "$TMPDIR" -maxdepth 1 -user "$(id -un)" -name 'plot-?*'`, compares each entry's own mtime, and removes each entry by the full path it listed. It never passes a glob to `rm`, and it never reads `/tmp` or `/var/folders` when `TMPDIR` points elsewhere.

**Legacy `tmp.*` caches are counted, never removed.** Neither ownership nor age separates Plot's `tmp.*` entries from any other program's. The reconcile section counts a `tmp.*` directory only when it holds `.list-arrived`, `.list-complete`, `pr-list.json` or `pr-list-open.json` (`plot-fleet-scan.sh:855-1075`), and it prints no removal command.

**Safety: no glob delete in a shared temp directory, and the gate holds it.** On 2026-09-30 a juror ran `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*` and removed every `tmp.*` entry in the operator's real temp directory. That applies to this session's own probes too. Use `trash`, or `rm` on a path you hold by its exact name. Never glob in `$TMPDIR`, `/tmp` or `/var/folders`.

**The gate strips before it matches.** It joins continuation lines, replaces each `"…"` span with a token, and removes `${VAR:?}` guards and comments. Then it refuses an unquoted glob in an `rm` argument under `$TMPDIR`, `${TMPDIR`, `/tmp`, `/var/folders` or `$(getconf`, and it refuses `find … -delete`, `find … -exec rm` and `xargs rm` outright. It also refuses any `mktemp` outside `plot-tmp.sh`, any non-comment fixed `/tmp/` literal, and any `trap` naming EXIT, INT or TERM. A redirection-only `/tmp` match misses three sites, and the gate must catch them: `plot-host.sh:578`, `:1051` and `:4636` assign the path to a variable first. The exception list holds exactly two lines, each with its reason: `plot-reap.sh:470` (a `case` pattern that writes nothing) and `plot-update-board.sh:66` (a state cache that slice 3 moves). Scope is `skills/plot/scripts/*.sh`, plus `scripts/` for the glob-`rm` rule. `.dev/scripts/create-release.sh`, `scripts/migrate-plans-to-slices.sh` and `scripts/release-smoke.sh` stay out of scope for the `mktemp` rule.

**`plot-update-board.sh`'s cache is state, not a temp path.** Leave it alone. It is slice 3's.

**The sweep's age bound rests on call-scoped temp paths, not on process lifetime.** The board and the supervisor run for days. `lsof` showed no open file under `$TMPDIR` or `/tmp` in either process, and the board's `mkdtempSync` sites (`board.ts:1831, 1857, 2326`) are per request. 24 h is about 1,000 times the 90 s scan timeout.

**The supervisor flag is opt-in, and `--once` still performs nothing.** `plot-fleetctl.sh:14-16` states that contract. The spawn of `plot-reap.sh` goes through an adapter under `packages/domain/src/adapters/` (the Layering Rule), not a new `spawn` in a controller. The CI spawn ratchet (`ci.yml`, *One place reaches a process*) must not grow.

### Done when

The plan's `## Done when` list is the specification. The bullets for this slice are the first eight: TMPDIR containment, the fleet scan leaving no directory, registration in the calling shell, TERM 143 and INT 130, a double source as a no-op, the CI gate, the sweep, the glob gate, and the reconcile counts. Some assertions exist because a naive implementation passes without them:

- **A path registered inside `$(…)` and inside `( … ) &` must exist after the call returns and be gone after the owner exits.** An array registry passes the plain-call test and fails both of these. A first-call trap fails the "exists after the call" half.
- **A stale `plot-reg.<pid>` holding a `c:` command, placed at the next process's path, must be truncated, and its command must not run.** Without the truncate, a pid reuse runs a dead process's cleanup.
- **The TERM test asserts that no command after the signal runs**, not only the exit status. Spawn from node: a script that a non-interactive shell starts with `&` inherits SIGINT as ignored, so an INT test started that way passes vacuously.
- **The two-statement fleet-scan reproduction becomes a test** (`unnamed dir: tmp.… survives=YES`). Assert on the real scan's host-state cache, not only on the helper.
- **The sweep fixtures include `plot-host-pTFuyG`, `plot-run.x`, `tmp.*`, `plotter-old`, `plot`, a live-pid memo directory and a young entry.** A dot-only matcher passes the `plot-run.x` case and misses the common shape. A `plot*` matcher removes `plotter-old`.
- **Glob-gate fixtures:** `rm -rf "$TMPDIR"/tmp.*`, the incident form `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*`, a continuation-line form and `find "$TMPDIR" -name 'tmp.*' -delete` must fail. The quoted `rm -rf "$TMPDIR/tmp.*"` and `rm -rf "${TMPDIR:?}/plot-foo.$$"` must pass. A gate that does not strip quotes fails the second pass case, and one that does not join lines misses the continuation.
- **The TMPDIR containment check runs on macOS** against `getconf DARWIN_USER_TEMP_DIR` and `/tmp`, for the six commands the plan names. Count by exact name, and never clean up by glob.

Repo gates: `nvm use` (Node 24) before any pnpm command, then `pnpm install`, `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (it rebuilds `plot-registryd.mjs` and `board-server.mjs`, so commit the rebuilt artifacts), `pnpm run typecheck`, `./scripts/check-host-cli-callers.sh`, `./scripts/check-ancestry-decisions.sh` and the new gate. Do not run `test:e2e` locally. Add a changeset: package `plot`, description first and the `bumps:` block last, with a `plan:` line and bumps for `plot` and any skill whose SKILL.md changes. A registryd change also needs `'@plot-pm/board': patch`. If `Temp sweep after` joins `plot-config.sh`'s documented keys, update the CLAUDE.md helper table rows for `plot-reap.sh`, `plot-config.sh` and `plot-registryd.mjs`, and add a row for `plot-tmp.sh`.

### Bookkeeping

- Push the first real commit as soon as it exists. The ref already exists as the claim, pushed at `origin/main`.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, change the slice heading in the plan on `main` to `### Scripts share one temp helper (Branch: bug/scripts-share-one-temp-helper, PR: #N)`. A trailing `→ #N` does not parse on a waves plan. Make that edit from a detached scratch worktree on `origin/main`, not the shared main worktree.
- No project board is configured, so there is no status to set.

### Scope guard

This branch owns `skills/plot/scripts/plot-tmp.sh` (new) and the new gate script under `scripts/`, plus their tests, and the temp and trap lines in `plot-host.sh`, `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`, `plot-board-verify.sh`, `plot-install-hooks.sh`, `plot-open-pr.sh`, `plot-write-config.sh`, `plot-dispatch.sh`, `plot-resolve-artifact.sh`, `plot-worker-loop.sh`, `plot-approve.sh`, `plot-deliver.sh` and `plot-phase-gate.sh`. It also owns the `--sweep-temp` code in `plot-reap.sh`, the reconcile advisory section, the registryd flag, an adapter under `packages/domain/src/adapters/`, both unit files and `ci.yml`.

Other branches in flight, verified at dispatch on 2026-09-30:

- `bug/a-state-sweep-is-one-request` (no PR yet, 4 commits) edits `plot-host.sh` near `:964`, `:1894` and `:3802-3841`, plus `test/reconcile/host.test.mjs`. That is textual overlap with the `plot-host-err` migration, and no temp or trap line changes on that branch. Expect a rebase conflict in whichever branch lands second.
- `bug/an-idle-reading-knows-the-conversation-started` (no PR, 2 commits) edits `plot-worker-loop.sh`, but not its trap lines.
- PR #1092 `bug/a-question-nobody-asked-has-its-own-word` edits `registryd-main.ts`, `supervisor.ts` and the `plot-registryd.mjs` artifact. Expect an artifact conflict: take either side and run `pnpm build:board` (CLAUDE.md › Testing).
- `bug/fleet-status-sees-every-supervisor` edits `plot-fleetctl.sh`, which this slice does not touch.

Out of scope: `scripts/owned-run.sh`, the leak gate, test `mkdtempSync` cleanup (slice 2), and ledger rotation, `truncate()`, log rotation and the board-cache move (slice 3).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

## Implementation brief — fleet-status-sees-every-supervisor

- **Plan (canonical):** `docs/plans/2026-09-29-fleet-status-sees-every-supervisor.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session (six panel rounds; round 6 `proceed`)
- **Branch:** `bug/fleet-status-sees-every-supervisor` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #1080

Single-slice plan: nothing waits on this branch, and it waits on nothing. #1084 (the orphan cause in `scripts-shell.ts`) is a separate, unstarted fix; this branch reads its result and does not touch it.

### What to build

On 2026-09-29 an operator reported the board dead. It answered `/api/board` in 4.5 s and timed out `/api/fleet` at 90 s under load 11–17, while `plot-fleetctl.sh --status` printed one healthy supervisor. The machine held 17 `plot-fleet-scan.sh` processes from five installations, spawned by **boards** and not by supervisors, and no reading on the estate showed any of it.

Add a second block to `--status`, printed after the `summary:` line (`plot-fleetctl.sh:616`), that lists every Plot supervisor, board and top-level scan on the machine. Each row names the checkout it serves (from its cwd) and the installation it runs from (from its argv). Scans are grouped by (checkout, installation), and orphans are counted separately. When every Plot process serves this checkout and no scan is orphaned, the output stays **byte-identical** to today's. The plan's *Design* section is the spec, down to the four classifier steps. This brief lists what not to re-open.

### Settled decisions — do not re-derive them

- **Enumerate by process, never by label.** `LABEL` (`:84`) accepts any string. A prefix search over `com.plot-pm.registryd*` misses `com.quatico.ewz.registryd` and still claims it looked. The label is read from the found process afterwards (`launchctl list` by pid; on Linux the `0::` cgroup line's `.service` segment).
- **Boards are in scope, not only supervisors.** Three readings (09-29, 09-30 09:58 and 10:17) found zero scans below either supervisor, and every scan below a board, a session, or nothing. A supervisor-only block names 2 of 4 processes and omits both that spend.
- **No `pgrep -f`.** In the sandbox it matched 3 processes for 1 board: the `--watch` watcher, its child, and a `bash -c` decoy. Use ONE `ps axww -o pid=,ppid=,uid=,args=` snapshot. A second snapshot (for example `ps -o comm=`) was rejected: pids can enter or leave between two reads, and `comm` is `node` for some rows and a full path for others.
- **`uid=`, not `user=`.** procps truncates `user=` to 8 columns. Resolve the name with `id -un` only for a `cannot determine` row.
- **Top-level rule:** a process is reported only when its parent is not of the same kind. This single rule folds `node --watch` into one board row with the watcher's pid (the pair `plot-boardctl.sh --stop` already treats as one), and it counts a scan's subshells as one scan. A live scan shows as four processes, measured six times on board 35248.
- **Scans are attributed by cwd and installation, never by parentage.** A timed-out scan reparents to pid 1 and belongs to no board. Orphaned = ppid 1, or a parent whose args are `…/systemd --user` (the Linux subreaper). The output claims nothing about why the parent exited.
- **A foreign installation serving THIS checkout is silent.** That is every adopting repository's normal shape. Printing on it would print on every machine.
- **Arm by `uname -s`, not `platform()`.** `platform()` answers `none` on Linux without `systemctl` (`:131-137`), and a board still runs there.
- **Stated limits, asserted as limits and not to be fixed:** an option value holding a `/` (`bash --rcfile /dev/null …`) starts the path early. A spaced interpreter path that has been deleted or is unreadable is not found.

### Safety — the one rule a naive build breaks

**Nothing read from another process reaches a shell evaluator.** The `ps` snapshot holds every user's command lines. awk emits candidate paths as data, one per line. Bash reads each into a variable and tests `[[ -f "$p" && -x "$p" ]]`. No awk `system()`, no `eval`, no interpolated `sh -c`. Measured: `awk '{ system("test -x \"" $0 "\"") }'` executed `$(touch …)`, and round 6 found it also executes backtick and `$(( $( ) ))` shapes. **Apply the same rule to the `lsof` cwd and the cgroup line** (round 6's addition). Add an `lsof`-stub fixture whose cwd holds `$(touch <box>/pwned)` beside the plan's two argv fixtures.

### Carried-over invariants

- **The board reads the first line that starts with `summary:`** (`packages/board/src/server/supervisor-reading.ts:106`). No line of the new block may start with `summary:`, and the block goes after it, never before.
- **The exit code stays 0/1 from the capture.** The block changes neither it nor the `summary:` line (plan, *What this does NOT do*).
- **The board runs `--status` with a 5 s bound** (`SUPERVISOR_TIMEOUT_MS`, `supervisor-reading.ts:50`). The plan budgets `lsof` at 0.053 s per process and the `ps`+awk pass at 0.08 s. Keep the block within that envelope: one `ps`, one `launchctl list`, and cwd reads only for classified rows, never for every row.
- **macOS `/bin/bash` is 3.2: no `declare -A`,** and no `mapfile`/`readarray`. Do the fold and grouping as a second awk pass (round 6).
- **Absent is not false:** an empty `lsof` answer is `cannot determine`, whatever the exit code. It never means *no cwd* or *this checkout*.

### Done when

The plan's `## Done when` list is the specification. It names every fixture. Some bullets exist because a naive implementation passes without them:

- **The `-c`/`-e` decoys** (`bash -c 'sleep 45; : /opt/App Support/…/plot-fleet-scan.sh'`, `bash -lc`, `sh -xc`, `node -pe`, `--eval=`): a space-tolerant path matcher re-admits them unless step 3 runs.
- **`/bin/zsh -c cd x; /bin/bash …/plot-fleet-scan.sh`:** the widened argv[0] regex matches inside it. Only the `-f && -x` check on a spaced argv[0] rejects it.
- **A directory at the interpreter path:** catches `-x` alone.
- **`board-server.mjs.bak` and `…mjs')`:** catch an artifact match not anchored to a space or end of args.
- **Bare `bash plot-fleet-scan.sh` from `/c`:** catches an installation derived from a path that lacks the full `/skills/plot/scripts/` suffix.
- **The three byte-identical fixtures,** the third being a foreign installation serving this checkout: catch a silence rule that keys on the installation instead of the cwd.
- **Every macOS case under `stubPlatform(box, { kernel: 'Darwin' })`:** CI is `ubuntu-latest`. Without the stub those cases take the `readlink` arm and pass for the wrong reason.
- **The Linux cwd test against a real `sleep`:** proves `readlink` on a live `/proc`, not only on a fixture.

Test harness additions the plan names: a `launchctl list` answer in `stubPlatform` (it answers `print` only, `:1024-1026`), plus `lsof` and `id` stubs through `guardBin` (`:130`).

Plus the repo gates: `nvm use` (Node 24), `node --test test/reconcile/fleetctl.test.mjs` green (72 tests on 2026-09-30; a changed assertion is named, not renumbered), `pnpm test`, `pnpm run test:contracts`. Add a changeset for `'plot': patch` with the description first and a `bumps:` block for `plot-fleet` last, plus `plan: docs/plans/2026-09-29-fleet-status-sees-every-supervisor.md`. If the `/plot-fleet` skill's prose describes `--status` output, update it and its Model Guidance where steps change. Do not run `pnpm run test:e2e` locally.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never use `gh pr create`.
- When the PR exists, append it inside this plan's slice heading on `main`, `(Branch: bug/fleet-status-sees-every-supervisor, PR: #N)`. That is the form a wave-heading plan parses. A trailing `→ #N` parses as `prs=[]`. Make the edit from a scratch worktree on `origin/main`, not from the shared main checkout.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh` (the `--status` path only), `test/reconcile/fleetctl.test.mjs`, `skills/plot-fleet/` prose about `--status` output, and its changeset.

It does not touch `packages/board/src/adapters/scripts-shell.ts` (#1084), `--start`/REFUSAL 4 (`:722-742`), `--stop`, the `summary:` line, or any signal to any process.

Verified 2026-09-30 at claim time: the only other remote branch that differs from `main` in these paths is `changeset-release/main`, a version bump in `skills/plot-fleet/SKILL.md`. Expect at most a trivial conflict there.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

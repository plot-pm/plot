## Implementation brief — every-temp-directory-has-an-owner (slice 2 of 3: The suites own their temp root)

- **Plan (canonical):** `docs/plans/2026-09-30-every-temp-directory-has-an-owner.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session (over a round-3 `amend`; no juror has measured the round-3 fixes, so each Done-when fixture is the first proof)
- **Branch:** `bug/the-suites-own-their-temp-root` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session
- **Issue:** #1083

This slice waits on slice 1, `bug/scripts-share-one-temp-helper`. On 2026-09-30 that branch has a `Started:` record and no remote ref, so the fleet scan does not offer this branch until slice 1 merges. Slice 3, `bug/every-state-file-declares-its-bound`, waits on this one: its inventory gate runs inside the sandbox this slice builds.

**Before the first commit, prove slice 1 is on your base.** `grep -n 'mktemp' skills/plot/scripts/*.sh` must return lines in `plot-tmp.sh` only, and `grep -c '/tmp/plot-host-err' skills/plot/scripts/plot-host.sh` must return 0. If either fails, stop and write `PLOT-BLOCKED`: without slice 1 the leak gate cannot see macOS script paths, and on GNU `mktemp` it fails on 98 `tmp.*` entries that this slice does not own.

### What to build

Layers 3 and 4 of the plan:

1. `scripts/owned-run.sh`, a wrapper around the whole script string of `test:contracts` and `test:board` in the root `package.json`, `bounded.sh` included. It creates one root from the template `"${TMPDIR:-/tmp}/plot-run.XXXXXX"`, and exports `TMPDIR`, `HOME`, `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` as directories inside that root for the whole process tree.
2. After the suite, the wrapper runs `node scripts/check-registry-not-leaked.mjs` with the **original** `TMPDIR` and `HOME`, then the leak gate, then removes the root whatever the exit code. The registry check moves out of the `test:contracts` string and into the wrapper.
3. The leak gate: list every entry still in the root's temp directory, and fail with each entry's name and its prefix when the list is not empty.
4. INT and TERM traps in the wrapper, with Layer 1's re-raise semantics. Reuse `skills/plot/scripts/plot-tmp.sh` if it fits a wrapper under `scripts/`; do not write a second trap idiom.
5. The migration: fix each leaking test file, or give it a `t.after` cleanup, until the gate passes.

The failure this fixes: one clean run of `test/reconcile/host.test.mjs`, 266 of 266 green, left **365 entries** in an empty `TMPDIR`. The same run with the real `HOME` wrote **430 lines** into the operator's `~/.plot/state/budget.tsv`, and the live ledger carries 32,220 `bitbucket/plot-pm` fixture lines. The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**The gate compares against an empty private root, not a before/after snapshot.** `check-registry-not-leaked.mjs:19-31` refuses a snapshot of the shared registry, because the supervisor writes manifests during a run. That objection does not apply here: no supervisor, board or other agent writes into a per-run root, so an entry present at the end came from this run. The plan measured this across 11 files, 3 with `detached: true` spawns: the count at exit equalled the count 40-45 s later. Do not add a settle delay or a retry loop to the gate.

**Redirect the environment, do not edit the call sites.** `os.tmpdir()` reads `TMPDIR`, so the 347 `tmpdir()` calls in `test/reconcile/` (re-counted 2026-09-30) and the 140 `mkdtempSync(` calls in `packages/board/test/` follow the root unchanged. The plan sampled 7 of 181 `env: {` literals: every helper spreads `...process.env`, and no test clears the environment. `fleetrefplans.test.mjs:274` sets `TMPDIR` from `os.tmpdir()`, which stays inside the root.

**The registry check runs with the original environment.** It builds its temp set from `[os.tmpdir(), process.env.TMPDIR, '/tmp', '/var/tmp']` (`:116`). Inside the root, `os.tmpdir()` answers the root, and `/var/folders/.../T` leaves the set, so a fixture manifest there would pass. Done-when asserts the check still sees `/var/folders/.../T`.

**`HOME` is redirected, and CI already proves the suites do not need the operator's `~/.gitconfig`.** `ci.yml` runs no `git config --global`, and a GitHub runner has no global identity, so every commit a test makes already works without one. Locally the redirect removes the operator's global config, signing and hooks included. A test that fails only under the redirect depended on the operator's machine: fix the test, and do not copy `~/.gitconfig` into the root.

**The wrapper traps signals itself.** A Ctrl-C or a CI cancel signals the wrapper and its child, and `bounded.sh` installs no trap. `bounded.sh` returns to its caller after it kills the child (`timeout -k 30s`), so the wrapper survives a child SIGKILL and removes the root. It also covers `bounded.sh`'s unbounded branch, where no `timeout` is on PATH (the stock-macOS case). A SIGKILL of the wrapper leaves one `plot-run.*` directory, and slice 1's sweep removes it: that is why the root carries the `plot-` prefix.

**Migrate from the measured per-file counts, not from a grep of cleanup calls.** `commitrecord` has 10 `mkdtempSync` sites and one cleanup and leaves 0. `budget` has 5 sites and no cleanup and leaves 64. The measured leakers: `host` 365, `budget` 64, `state-gate` 21, `dispatch` 4, `packages/board/test/lifetime` 1. Measure each file under its own empty `TMPDIR` before and after. A temporary allow list is acceptable only when it names each file with its measured count and can only shrink, in the shape of the spawn ratchet at `ci.yml:340`.

**A board test removes a tree with `rmTree`.** The CI step *A teardown does not race a child* (`ci.yml:579-594`) allows exactly 1 raw recursive `fs.rmSync` under `packages/board/test/`, which is `rmTree`'s own body (`packages/board/test/helpers.mjs:527`). A cleanup added there with a raw `fs.rmSync(…, { recursive: true })` fails that step.

**No pattern delete in a test.** A test removes only a path it holds, by the exact name `mkdtempSync` returned. The migration adds no glob, `find -delete` or prefix sweep: on 2026-09-30 a juror's `rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"tmp.*` removed every `tmp.*` entry in the operator's temp directory.

**The gate reads the temp directory only.** Writes under `HOME` go into the root, so they cannot reach the operator's machine, and slice 3's inventory gate reads them. Do not add a `HOME` check to the leak gate.

Carried over unchanged: the gate reads the listing, never an exit code alone; a `find` or `ls` that fails is a gate failure, not an empty list.

### Done when

The plan's `## Done when` list is the specification. This slice owns these items:

- **One run of `host.test.mjs` leaves zero entries in its `TMPDIR`**, on macOS and with GNU `mktemp` (`gmktemp` first on PATH). The four scan files `fleet`, `fleetrefplans`, `fleetclaimable` and `fleetderived` leave zero with GNU `mktemp`. This is the check that slice 1 really landed: before it, those four left 98 `tmp.*` entries.
- **One run of `host.test.mjs` adds zero lines to the operator's `budget.tsv`** and creates nothing under the operator's `~/.plot/state/slots/`. Count the lines before and after with the real `HOME`. A wrapper that sets `HOME` and forgets `PLOT_BUDGET_HOME` passes only when `PLOT_BUDGET_HOME` is unset in the caller's environment, so run this check once with `PLOT_BUDGET_HOME` exported to the real ledger's directory.
- **`pnpm run test:contracts` fails when a test leaves an entry**, asserted by a fixture test that creates one on purpose and checks that the run names it. Run the wrapper over a small fixture command, not over the real suite, so the suite stays green.
- **A killed contract run leaves at most one directory**, a `plot-run.*`: SIGKILL to the run mid-suite, then count. SIGINT and SIGTERM to the wrapper leave none, and the wrapper exits 130 and 143. Spawn the wrapper from node: a script that a non-interactive shell starts with `&` inherits SIGINT as ignored, so an INT test started that way passes without testing anything.
- **`check-registry-not-leaked.mjs` still sees `/var/folders/.../T`** when it runs after a wrapped suite. A fixture manifest whose `worktree` lies under the original `os.tmpdir()` must still fail it.
- **Count by exact name, and clean up by exact name.** Never a glob over the shared temp directory.

Repo gates: `nvm use` (Node 24) before any pnpm command, then `pnpm install`, `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and slice 1's temp-path gate, which now also covers `scripts/owned-run.sh` if it reaches that directory. Do not run `test:e2e` locally. Add a changeset: package `plot`, description first, a `plan:` line in the trailing comment block. CLAUDE.md's Testing section lists `test:contracts` and `test:board`: add one line saying both run in a private `TMPDIR` and `HOME` and fail on a leaked entry.

### Bookkeeping

- Claim the branch with a push from `origin/main` before any work, and push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, change the slice heading in the plan on `main` to `### The suites own their temp root (Branch: bug/the-suites-own-their-temp-root, PR: #N)`. A trailing `→ #N` does not parse on a waves plan. Make that edit from a detached scratch worktree on `origin/main`, not the shared main worktree.
- No project board is configured, so there is no status to set.

### Scope guard

This branch owns `scripts/owned-run.sh` (new), the leak gate (inside the wrapper or a sibling under `scripts/`), their tests, the `test:contracts` and `test:board` strings in the root `package.json`, and cleanup lines in the leaking files under `test/reconcile/` and `packages/board/test/`. It changes no assertion: the plan's *What this does NOT do* says only where a test's sandbox and `HOME` live may change. It leaves the 73 hardcoded `'/tmp'` literals in the tests alone: none creates a file, and `idea-route.test.ts:378`'s `/tmp/plot-pwned` is an injection canary that must stay literal.

Other branches in flight, verified on 2026-09-30:

- `bug/a-state-sweep-is-one-request` (4 commits, no PR) edits `test/reconcile/host.test.mjs` and `scan.test.mjs`. `host.test.mjs` is the largest migration target here (39 `mkdtempSync` sites, 10 `rmSync`), so expect a rebase conflict with whichever branch lands second.
- `bug/an-idle-reading-knows-the-conversation-started` (3 commits, no PR) edits `test/reconcile/workermonitor.test.mjs`.
- PR #1095 `bug/fleet-status-sees-every-supervisor` edits `test/reconcile/fleetctl.test.mjs`.
- PR #1092 `bug/a-question-nobody-asked-has-its-own-word` edits `packages/board/test/unit/registryd-main.test.ts`.
- PR #1047 `changeset-release/main` edits both `package.json` files' versions, not their scripts.
- Slice 1 adds its own tests under `test/reconcile/`; rebase onto it after it merges.

Out of scope: `plot-tmp.sh`, script temp paths, the sweep and the registryd flag (slice 1); the ledger rotation, `truncate()`, log rotation, the board-cache move and the inventory gate (slice 3).

**Known gaps to report, not to fix here:**

- `packages/domain/test/{host-shell,tracker-shell}.test.ts` use fixture accounts without `PLOT_BUDGET_HOME` (plan, Motivation), and the domain suite runs through neither `test:contracts` nor `test:board` (`ci.yml:94`, `:873`). The wrapper therefore does not stop those two files writing to the operator's ledger. Name this in the PR body.
- CI's *What was still running* step (`ci.yml:187-197`) lists `.plot-worker*.log` files and `plot-*` fixture directories under `$TMPDIR` after a wedged suite. Once the wrapper redirects `TMPDIR` and removes the root, that step finds nothing. Name this in the PR body with the choice you made: for example, the wrapper prints the leak listing and the tail of each `.plot-worker*.log` before it removes the root on a non-zero exit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

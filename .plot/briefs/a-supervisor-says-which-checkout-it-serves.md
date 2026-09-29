## Implementation brief — a-supervisor-says-which-checkout-it-serves

- **Plan (canonical):** `docs/plans/2026-09-28-a-supervisor-says-which-checkout-it-serves.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-supervisor-says-which-checkout-it-serves` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1048

Single-slice plan; nothing waits on it. #1051 (the `Label` inside the plist) and #1053 (systemd unit name) are separate, open, and not this branch's.

### What to build

`plot-fleetctl.sh --start` refuses at REFUSAL 4 (`plot-fleetctl.sh:609-617`) with `'$LABEL' is already loaded` and cannot say whose supervisor holds the label. The operator must run `launchctl print` by hand to learn which checkout it is. `--status` (`:392-475`) names the label and never the checkout.

Add one reader: the loaded job's working directory, compared with this checkout's root (`repo_root`, `:88`). It gives three answers: **this repository's**, **another checkout's (named)**, and **cannot determine**. Print the answer in the REFUSAL 4 text and as a line in `--status`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Read `launchctl print`, not the plist.** The installed plist carries `<key>WorkingDirectory</key>`, but a plist on disk may not be the loaded job, and a file read cannot see a hand-installed job elsewhere. The loaded job is the authority, the same way `supervisor_loaded` (`:153`) asks the init system rather than a pidfile.

**Domain `gui/$(id -u)`, never `system/`.** The unit is a LaunchAgent: `:686` bootstraps into `gui/`, and `supervisor_loaded`/`supervisor_pid` already read from there. `launchctl print system/<label>` answers `Bad request. Could not find service`, which falls into *cannot determine* silently.

**The printed key is `working directory`**, lowercase and space-separated. `launchctl print … | grep -c WorkingDirectory` returns 0. Use the extraction the plan verified, re-measured 2026-09-29 against both live jobs:

```sh
launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null \
  | sed -n 's/^[[:space:]]*working directory = \(.*\)$/\1/p' | head -1
```

It prints `/Users/jwloka/Quatico/Agentic-Tools/plot` for `com.plot-pm.registryd` and `/Users/jwloka/Quatico/ewz/ewz-kus-portal` for `com.plot-pm.registryd.ewz-kus-portal`.

**Compare physical paths.** Follow `plot-boardctl.sh:288-297`: `here=$(cd "$repo_root" && pwd -P)`, `there=$(cd "$served" 2>/dev/null && pwd -P) || there="$served"`. A symlinked checkout path otherwise reads as *another checkout*.

**Empty means *cannot determine*, never *this repository*.** The reachable causes are exit 113 (a label launchd does not hold; `:140-151` records that code leaking once), a job in another user's domain, and a hand-written unit without the key. The plan rules out *"the job predates the field"*: `f8cb6b03` added the template and the field together. Fail toward the answer that does not invite an overwrite.

**No second identity mechanism.** Add no `PLOT_REPO` env, no sidecar file, and no repository name in the label. The label is #1051's. `PLOT_REPO_ROOT` also appears in the printed `environment` block, but read `working directory` only; one reading, not two that can disagree.

**Rules carried over unchanged:**

- A function's status is 0 or 1 and never the init system's own code. `supervisor_loaded`'s comment records 113 escaping as `--status`'s exit code and breaking the board's reading. A reader that ends with a `launchctl` pipeline must not leak its status.
- The board reads only `--status`'s exit code and its `summary:` line (`packages/board/src/server/supervisor-reading.ts:68`). A new line is safe, but do not change the `summary:` line or the exit codes.
- The refusal stays a refusal on all three answers: exit 1, nothing written, nothing unloaded.

**systemd.** `systemctl --user show plot-registryd -p WorkingDirectory --value` is the counterpart. It is **unverified** (read, not run). One unit name is hardcoded (`:156`, `:167`, `:220`, `:648`), so the *another checkout* answer is unreachable on Linux until #1053. Wire it if it is cheap, and say in the PR that it was not run. Do not add a Linux test that pretends otherwise.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation passes without them:

- **The unreadable case refuses and says *cannot determine*.** An implementation that treats empty as "mine" passes the other two cases and invites an overwrite of a foreign supervisor.
- **The reading is tested against `launchctl print`'s real printed shape**, a stub printing `\tworking directory = /path` under a tab, not the plist XML. A test fed `WorkingDirectory` passes against the template and finds nothing on a live machine.
- **The *another checkout* case names the path in the refusal text**, not only in `--status`.
- **Nothing is unloaded or overwritten on any path.** Assert this through the suite's `guardBin` seam (`test/reconcile/fleetctl.test.mjs:130-147`, passed to `run` at `:161`): stub `launchctl` in `guardBin` so `print` answers the case and `bootout`/`bootstrap` record a call, then assert no such call. Every case runs under its own minted label (`:18-26`). The suite never touches the operator's live label and never unloads anything.

Plus the repo gates:

- `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, and `node --test test/reconcile/fleetctl.test.mjs` (baseline 48/48 green, measured 2026-09-28).
- A changeset for `'plot': patch`, description first, `bumps:` block last, naming `plot-fleet: patch` if the skill text changes, with a `plan:` line.
- Update `skills/plot/units/README.md` or the `plot-fleet` skill only where they quote the refusal text.
- Not `test:e2e`: that is CI's job.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Do not run `gh pr create`.
- When the PR exists, append `(Branch: bug/a-supervisor-says-which-checkout-it-serves, PR: #N)` to the slice heading in the plan's `## Slices`. This plan uses the heading form, and a trailing `→ #N` parses as `prs=[]`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh`
- `test/reconcile/fleetctl.test.mjs`
- a new changeset
- the refusal text where `skills/plot-fleet/` or `skills/plot/units/README.md` quote it

It does not touch:

- `plot-boardctl.sh`: that is the pattern, not the subject.
- the unit templates in `skills/plot/units/`: nothing is added to the unit.
- the label mechanism: that is #1051.
- the systemd unit name: that is #1053.

At dispatch (2026-09-29) no other remote branch changes `plot-fleetctl.sh` or `fleetctl.test.mjs`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

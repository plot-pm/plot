## Implementation brief — a-shared-account-names-what-spends-it (wave 1: The account's spend is attributed by caller)

- **Plan (canonical):** `docs/plans/2026-10-01-a-shared-account-names-what-spends-it.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-account-spend-is-attributed-by-caller` (base: `main`)
- **Ends as:** one PR to `main` whose only change is the plan file: the measurement table in `## Notes`, and slice 2's verdict on its branch line. Open it with `skills/plot/scripts/plot-open-pr.sh`.
- **Review of the code:** there is no shipped code. A person reviews the table and the verdict in the PR.

Slice 2, `bug/the-largest-caller-follows-the-account-rate`, waits on this branch (`<!-- waits: … -->`). Its scope comes from this slice's table: it names the caller slice 2 changes, or it defers slice 2.

### What to build

A measurement, not a change. Issue #1069: on 2026-10-01 one Bitbucket workspace spent 3363-3515 requests an hour while one supervisor read `mine=1140/hr` and `mine=1200/hr`. The listing endpoint answered 429 from about 12:30 to after 14:10. Two boards, two supervisors, two fleet scans and one interactive session ran across two checkouts of that workspace. Nothing split the rate by caller.

This slice splits it. For one hour, a `bb` wrapper in a scratch directory sits first on `PATH` for every Plot process of two checkouts of one Bitbucket workspace. It logs each call, and a short script then counts the log per checkout and per caller. The result is one table, posted on #1069 and recorded in the plan's `## Notes`.

### Decisions the plan settles — do not re-derive them

**The spend record gets no caller field.** `plot-budget.sh:607` reads `if (NF != 10 || $1 != "b1") { unreadable++; next }`, and `decodeEntry` refuses an eleventh field too. One added field makes every existing line unreadable to every reader. The rejected plan `a-spend-line-names-its-caller` proposed exactly that. The wrapper is the instrument because it changes no shipped file.

**A `PATH` wrapper sees every call.** The `bb()` function in `plot-host.sh:3167-3174` runs `command bb "$@"`, which resolves through `PATH`. `command` skips shell functions only, not a wrapper binary. No TypeScript under `packages/` spawns `bb` directly. Every Bitbucket call goes through `plot-host.sh`.

**The supervisor does not read your shell's `PATH`.** The launchd unit bakes `PATH` into the plist at load (`skills/plot/units/com.plot-pm.registryd.plist:62`, `__HARNESS_DIR__` first, usually `~/.local/bin`, where the real `bb` lives). A wrapper exported in your shell never reaches it. Choose one of these, and write the choice in the Notes entry:
- Load a scratch copy of the unit, with the wrapper directory first on its `PATH`, for the hour. Restore the original unit afterwards.
- Unload the unit and run `plot-registryd.mjs` in the foreground under the wrapped `PATH` for the hour.

Unloading the label stops only the daemon. Do **not** use `/plot-fleet --stop` for this, because it also stops every agent. Do not replace `~/.local/bin/bb` itself: that is a shipped install outside the scratch directory. Boards started with `pnpm board` read the shell's `PATH`, so restart each board from a shell where the wrapper comes first.

**Attribute by the ancestor chain, not by the parent.** The parent of `bb` is always `plot-host.sh`. Walk `ps -o ppid=,command=` upwards until the first process that names its caller:
- `plot-fleet-scan.sh` under the board is the **board fleet scan**. It runs on the 5 s pulse (`fleet.ts:118`, `:3655`), with two listings per run (`plot-fleet-scan.sh:882`, `:898`), outside the cadence rule.
- A `plot-host.sh pr-list` started directly by `board-server.mjs` is the **board PR refresh**. It follows the cadence through `prRefreshMsFor` (`fleet.ts:1844`).
- `plot-registryd.mjs` is the **supervisor**.
- Anything else is **other**, including an interactive session.

Record the checkout as the `git rev-parse --show-toplevel` of the caller's working directory. A desk under `.worktrees/` belongs to its main checkout: use the parent of `--git-common-dir`, the rule `plot_repo_root` applies. Before the hour starts, check the classification on one known call of each kind.

**`bb --version` is recorded as a spend.** `bb_require_json` runs `bb --version` through the metered function (`plot-host.sh:2051`, `:2111`). The record therefore counts a call that makes no request. Count every wrapper line when you compare with `spend-rate`, because that is what the record counts. Report the network calls (`bb api`, `bb pr …`) separately per caller, because the 429 comes from those.

**`spend-rate` is the cross-check.** It reads this computer's record, `$HOME/.plot/state/budget.tsv`, unless `PLOT_BUDGET_HOME` is set. Every process in the hour must write to the same record, so check that no process has `PLOT_BUDGET_HOME` set. Read the rate with `plot-host.sh spend-rate --connector bitbucket --account <workspace>` for the same window. The Done-when tolerance is 10%. A larger difference means the wrapper missed a process, or counted one the record does not count. Find the cause before you post anything.

**This measurement needs a Bitbucket estate, and this repository is on GitHub.** `plot-pm/plot` cannot produce the reading. It needs a computer with two checkouts of one Bitbucket workspace, each running its board and its supervisor, for example the workspace in #1069. If no such estate is available, do not simulate one with stubs or a fixture. A synthetic hour measures the fixture, not the account. Write `PLOT-BLOCKED` and name what is missing: the workspace, the two checkouts, and the running boards and supervisors.

**Carried-over rules.** Absent is not zero: a caller that made no call in the hour is reported as `0`. A caller you could not observe is reported as `not observed`. Create the scratch directory with `mktemp -d` and remove it by its exact path with `trash`, never with a glob over the shared temp directory. Give the Plot version and the `origin/main` commit for every reading. The supervisor's merge lookups changed after the #1069 reading (#1140), so the split on `main` may differ from 2.22.1.

### Done when

The plan's `## Done when` is the specification. For this slice:

- A table on #1069 gives one hour of requests per checkout and per caller (board PR refresh, board fleet scan, supervisor, other), as requests an hour and as a share of the account's total. **This assertion exists because** a total without a per-caller split repeats the #1069 reading, which already had a total.
- The table's total agrees with `spend-rate` for the same window within 10%. **This assertion exists because** a wrapper that missed the launchd supervisor would still produce a plausible table. Only the agreement shows that the wrapper saw what the account spent.
- The largest caller outside the cadence rule is named, with its share. The verdict for slice 2 is stated with the plan's own test: callers outside the cadence rule spend **50% or more** of the account's requests, and one of them spends more than the others. Then do one of these:
  - **The condition holds.** Name the caller in the Notes entry. Slice 2's line stays as it is.
  - **The condition fails.** Add `deferred: <the measurement in one clause>` to slice 2's branch line, in the same PR. Do not close #1069: Plot closes no issue, so the operator closes it with the table.

Repository gates: no code changes, so `pnpm test` is the only gate that applies. Add no changeset, because a plan-only change ships nothing to release. The scratch directory and the wrapper are never committed.

### Bookkeeping

- Push the first commit as soon as it exists: the plan edit with the table, or a `PLOT-BLOCKED` marker.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never with `gh pr create`. Then add `→ #<number>` inside the slice heading: `(Branch: bug/the-account-spend-is-attributed-by-caller, PR: #<number>)`. The arrow form after the heading parses as no PR.
- Posting the table on #1069 is a write to a public tracker. The plan authorizes it. Post the table only, and post it once.

### Scope guard

This branch owns the `## Notes` section of `docs/plans/2026-10-01-a-shared-account-names-what-spends-it.md` and the branch line of slice 2. It owns no file under `skills/`, `packages/` or `scripts/`.

Verified at dispatch (2026-10-02, `origin/main` `6751c6ab`): three remote branches are in flight, `bug/a-started-agent-leaves-its-starters-group`, `bug/the-merge-subject-is-one-rule` and `bug/the-rule-names-a-usage-limit`. None of them touches this plan file. `a-pr-refresh-reads-the-history-once-a-day` (#1087) owns the board's full PR read, and no branch for it is in flight. Do not change that read, even if the table names it.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Examples: a caller that is not one of the four, or a `spend-rate` difference above 10% whose cause is in the record itself.

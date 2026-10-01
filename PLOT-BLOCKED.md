PLOT-BLOCKED: This machine has no estate that can produce the reading — two checkouts of ONE Bitbucket workspace, each running its board and its supervisor. Which estate should the hour be measured on, or should the slice be deferred?

## What the brief requires

`.plot/briefs/the-account-spend-is-attributed-by-caller.md` states the condition and forbids the workaround:

> This measurement needs a Bitbucket estate, and this repository is on GitHub. `plot-pm/plot` cannot produce the reading. It needs a computer with two checkouts of one Bitbucket workspace, each running its board and its supervisor, for example the workspace in #1069. If no such estate is available, do not simulate one with stubs or a fixture. A synthetic hour measures the fixture, not the account. Write `PLOT-BLOCKED` and name what is missing: the workspace, the two checkouts, and the running boards and supervisors.

## What is missing

Measured 2026-10-02 on this machine. Plot 2.22.2, `origin/main` 47e527cd.

**The workspace** — present. `quatico` on Bitbucket, and it is the account that spends: 46 118 of 62 916 lines in `$HOME/.plot/state/budget.tsv` are `bitbucket<TAB>quatico`. No process has `PLOT_BUDGET_HOME` set, so one record holds the hour.

**Two checkouts of one workspace, each with a board and a supervisor** — absent. Two boards listen and one supervisor is loaded, and they do not form the required pair:

| process | pid | checkout | origin | host |
|---|---|---|---|---|
| board :7777 | 6738 | `Agentic-Tools/plot` | `github.com/plot-pm/plot` | GitHub |
| supervisor (launchd `com.plot-pm.registryd`) | 10942 | `Agentic-Tools/plot` | `github.com/plot-pm/plot` | GitHub |
| board :7778 | 68912 | `ewz/ewz-kus-portal` | `bitbucket.org:quatico/ewz-kus-portal` | Bitbucket |

Three defects against the requirement:

1. **The board and the supervisor that run together are on the GitHub checkout.** Both pid 6738 and pid 10942 have cwd `/Users/jwloka/Quatico/Agentic-Tools/plot`, whose `plot-host.sh backend` answers `github`. Neither spends a Bitbucket request, so wrapping `bb` would observe them making zero calls.
2. **The one Bitbucket checkout serving a board has no supervisor.** `launchctl list | grep -i plot` returns exactly one label, `com.plot-pm.registryd`, and it is the GitHub checkout's. The *supervisor* row of the table — one of the four callers the slice must split — cannot be observed at all.
3. **The two Bitbucket-spending checkouts would not be of one workspace repo.** `ewz-kus-portal` is the only Bitbucket checkout with a live board. The nearest candidate pair, three checkouts of `quatico/cpq-cds` (`-develop`, `-stable`, `-temp`), run no board and no supervisor, declare no `Board artifact` or `Board port` key, and hold 0 registered agents each.

A single board on one Bitbucket checkout cannot produce the table. Three of the four caller rows — board PR refresh and board fleet scan for the second checkout, and supervisor for either — would read `not observed`, and the `spend-rate` cross-check inside 10% is what the brief says proves the wrapper saw the account. With the launchd supervisor spending on GitHub and the Bitbucket spend coming from a checkout it does not supervise, that agreement cannot be reached by measurement.

## What would unblock it

Any one of these, named by the operator:

- **A workspace and two checkouts to use.** Name two checkouts of one Bitbucket workspace repo, and start each one's board and supervisor for the hour. `quatico/cpq-cds` already has three checkouts on disk and is the cheapest candidate; it needs `/plot-board-setup` per checkout and a supervisor per checkout.
- **Re-measure on the #1069 estate.** That reading came from a computer that had this shape. If it is a different machine, this slice belongs there.
- **Defer the slice.** If no estate is available, slice 2 (`bug/the-largest-caller-follows-the-account-rate`) takes `deferred: <clause>` on its branch line, since its scope comes from this slice's table.

## What was NOT done, deliberately

No wrapper was installed, no scratch directory created, no launchd unit copied or unloaded, and no table written. The plan file is untouched. Nothing was posted to #1069.

The brief forbids the available workaround by name: a stub `bb`, a fixture hour, or a table whose rows read `not observed` for three of four callers would satisfy the shape of the Done-when while measuring nothing — and slice 2 would then be scoped from that fiction. Issue #1069 already has a total without a per-caller split; a synthetic split is worse than none.

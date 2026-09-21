# The ledger prunes what it read

> The budget record's truncation rule exists, is tested, and has no caller — so every host call scans a 17.6 MB file that only ever needs its last hour.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A host call stops scanning the whole budget ledger. `budget_rate` reads 312589 lines to answer a question about the last hour, at 516 ms a read and several reads per call; the reader that already proved which lines are dead now removes them, as `truncationOwed` has always specified. Measured on a Bitbucket repository with three open pull requests: `plot-host.sh pr-list` took 2567–7241 ms against 507–1183 ms with the record switched off, and one `budget_rate` took 516 ms against 5 ms over fifty lines.

Board impact: none. The board reads no ledger; it calls `plot-host.sh`, which gets faster.

## Design

### The rule is finished and dead

`packages/domain/src/rules/budget-record.ts` defines `truncationOwed` and `PRUNE_THRESHOLD = 100`. `ports/budget.ts` declares `truncate(keep)`. `adapters/budget/budget-file.ts` implements it. The design is argued in place:

> PRUNED BY THE READER THAT ALREADY READ IT. A reader holding the file has just established which lines are dead; a separate cleaner would re-read everything to learn the same thing and would need a lock the append-only design exists to avoid.

**Nothing calls it.** `grep` for `truncationOwed` and `readWindow` outside the rule and its own tests returns no production caller, and `plot-budget.sh:187` only ever appends, exactly as its header states. This is the shape CLAUDE.md names: *"Where a rule exists and nothing calls it, that is a defect to report."*

### What it costs today

Measured 2026-09-21 on `quatico/quaweb-website`, Plot 2.19.0:

| | |
|---|---|
| `~/.plot/state/budget.tsv` | 17.6 MB, 312589 lines |
| lines for the account under test, inside the 1 h window | 119937 |
| `budget_rate` over that file | **516 ms** |
| `budget_rate` over 50 lines | **5 ms** |
| `plot-host.sh pr-list --state open` | 2567–7241 ms |
| the same with `PLOT_BUDGET_OFF=1` | **507–1183 ms** |

**The window filters which lines COUNT, not which are READ.** Every line is parsed by awk on every call, so cost grows with total file size forever while the answer only ever needs the last hour. That is why this is a defect rather than a tuning opportunity: the growth has no ceiling.

### Where the pruning goes, and why it is the shell

The rule says the reader prunes, and **the reader on this path is `plot-budget.sh`, not the domain.** The board is the only TypeScript spender; the other spenders are eleven shell scripts and a person at a terminal, and `plot-budget.sh`'s own header already refuses to start `node` on the hot path for exactly this reason.

So the shell gets the pruning, and `PRUNE_THRESHOLD` stays the domain's number — read from the bundle at adoption or duplicated under the corpus tier, never re-invented. `docs/shell-and-domain.md` governs which: this runs **once per host call**, not once per operator command, so it duplicates the rule and a corpus test holds the pair.

### What must not break

**Append stays lock-free.** The truncation is a rewrite, which is the one write the append-only design does not have. It goes through a scratch file and one `mv`, so a concurrent appender either writes to the file being replaced (its line is lost, which `budget_append`'s own `|| true` already tolerates) or to the replacement. A partially written ledger must never be visible.

**A failed truncation costs disk, never correctness.** `truncationOwed` answers *should*, not *must* — the window filter is what makes the answer right. Every failure path leaves the ledger as found.

**The threshold is not one.** `PRUNE_THRESHOLD = 100` exists so that pruning happens on some reads rather than every read; a threshold of one would make every reader a writer and reintroduce the contention the append-only design removes.

## Slices

### The shell prunes what it read (Branch: bug/the-shell-prunes-what-it-read)

- `bug/the-shell-prunes-what-it-read` — `budget_rate` counts the dead lines it skipped and, past the threshold, rewrites the ledger through a scratch file and one `mv`; a corpus test pins the shell's threshold against `PRUNE_THRESHOLD`, and a test proves a concurrent append cannot see a partial file

## Notes

- The first measurement of this blamed the concurrency slot and a supposed `budget_rate` defect. Both were false: the bound IS computed (`limit=1000` → 1), and the `lines: 0` reading was a zsh artifact — `plot-budget.sh` is bash, and sourced into zsh `budget_now_ms` fails with `command not found: date`. Full record in `docs/notes/2026-09-20-the-board-never-fetches-pr-data.md`.
- No rate limit was ever reached on the repository that prompted this: `bb` answers in 0.4 s, `jen` in 11 ms, exit 0. The timeouts are Plot's own overhead.

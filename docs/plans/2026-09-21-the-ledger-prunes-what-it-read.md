# The rate is read once, and the ledger stops growing

> A host call scans a 17.6 MB budget ledger three times to answer a question about the last hour — reached from the concurrency slot, not from the write, and measured at ~3100 ms of a 4020 ms call.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-21, jwloka, in-session

## Changelog

- A host call stops scanning the whole budget ledger. `budget_rate` reads 312589 lines to answer a question whose live answer is 2273 of them, at 516 ms a read and several reads per call; the reader that already proved which lines are dead now removes them, as `truncationOwed` has always specified. Measured on a Bitbucket repository with three open pull requests: `plot-host.sh pr-list` took 2567–7241 ms against 507–1183 ms with the record switched off, and one `budget_rate` took 516 ms against 5 ms over fifty lines.

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
| lines for the account under test | 120728, of which **2273 live** — 98.1% dead |
| `budget_rate` calls per `pr-list` | **3** |
| `budget_rate` over that file | **516 ms** |
| `budget_rate` over 50 lines | **5 ms** |
| `plot-host.sh pr-list --state open` | 2567–7241 ms |
| the same with `PLOT_BUDGET_OFF=1` | **507–1183 ms** |

**`PLOT_BUDGET_OFF=1` is not a clean reading and the first draft of this plan treated it as one.** It disables the concurrency slot AND the ledger append. Splitting the two guards attributes the cost (median of five, 2026-09-21):

| cell | |
|---|---|
| everything on | **4020 ms** |
| slot off | **895 ms** |
| append off | **3608 ms** |
| both off | **597 ms** |

**The slot path costs ~3100 ms and the append ~400 ms** — an 8:1 ratio the combined switch hides.

### The read is reached from the slot, not from the write

Slot acquisition itself is cheap: `ln`-based, **11 ms**, and it succeeds immediately on an idle account. The cost is one layer above it — `host_slot_take` calls `host_concurrency_bound`, which calls `budget_rate`, which scans the whole file.

**And it happens three times per `pr-list`**, counted with a probe: once per host call the operation makes. So the ~1650 ms of scanning is the dominant term, and the appends are the remainder.

That reframes the fix. Pruning the ledger makes the READ cheap, which removes most of the slot cost as a side effect. A second, independent lever exists — `budget_rate`'s answer does not change three times inside one process, so caching it per process removes the 3× multiplier without touching the file at all.

**The window filters which lines COUNT, not which are READ.** Every line is parsed by awk on every call, so cost grows with total file size forever while the answer only ever needs the last hour. That is why this is a defect rather than a tuning opportunity: the growth has no ceiling.

### Where the pruning goes — REOPENED by the panel

> The paragraph below argued for the shell and is kept because the plan's first slice was built on it. **It no longer decides anything**: the estate juror showed the rule a shell prune would duplicate is `survivors` (per-key, regrouped) rather than `truncationOwed`, and that `spend-rate` is an operator-frequency seam where the domain can simply be called. The second slice states the decision as open.

### Where the pruning goes, and why it is the shell

The rule says the reader prunes, and **the reader on this path is `plot-budget.sh`, not the domain.** The board is the only TypeScript spender; the other spenders are eleven shell scripts and a person at a terminal, and `plot-budget.sh`'s own header already refuses to start `node` on the hot path for exactly this reason.

So the shell gets the pruning, and `PRUNE_THRESHOLD` stays the domain's number — read from the bundle at adoption or duplicated under the corpus tier, never re-invented. `docs/shell-and-domain.md` governs which: this runs **once per host call**, not once per operator command, so it duplicates the rule and a corpus test holds the pair.

### What must not break

**Append stays lock-free.** The truncation is a rewrite, which is the one write the append-only design does not have. It goes through a scratch file and one `mv`, so a concurrent appender either writes to the file being replaced (its line is lost, which `budget_append`'s own `|| true` already tolerates) or to the replacement. A partially written ledger must never be visible.

**A failed truncation costs disk, never correctness.** `truncationOwed` answers *should*, not *must* — the window filter is what makes the answer right. Every failure path leaves the ledger as found.

**The threshold is not one.** `PRUNE_THRESHOLD = 100` exists so that pruning happens on some reads rather than every read; a threshold of one would make every reader a writer and reintroduce the contention the append-only design removes.

**And on this estate it is not a throttle.** Against 118455 dead lines it is true on every read until the backlog clears, then true again every ~3 minutes at the measured 2586 lines/hour — it was sized against 1160/hour. The released plan `one-account-has-one-budget` bounded it by TIME, *"at most once per reset"*, and that bound is the one to restore.

**`plot-budget.sh`'s header says the file never prunes.** Any slice that makes it prune amends that header in the same commit, or the file documents the opposite of what it does.

## Slices

**The panel split this, and the measurement agrees with the split.** Read cost and disk growth are two problems; the first is the one a caller waits on.

### The rate is read once per process (Branch: bug/the-rate-is-read-once-per-process)

- `bug/the-rate-is-read-once-per-process` — `budget_rate` memoises its answer per (connector, account, bucket) for the life of the process, so three calls inside one `pr-list` scan once. Nothing is written, nothing is deleted, no rule is duplicated, and the saving is measured rather than argued: 3 → 1 scan. This is the slice that needs no permission

### The disk stops growing (Branch: bug/the-disk-stops-growing) <!-- deferred: the shape is undecided — day-files, a window-bounded reverse read, or survivors at the spend-rate seam. The rewrite-in-place form is refuted: a juror measured a correct multi-key prune at 685 ms against the 516 ms read it would amortise. Decide by measuring, then undefer -->

- `bug/the-disk-stops-growing` — the ledger stops growing without bound. **The shape is open and the panel named three candidates**: day-files as `plot-commit-record.sh` already does next door, a window-bounded reverse read, or `survivors` called through a bundle at the `spend-rate` seam, which is operator-frequency and therefore `docs/shell-and-domain.md` §1's *call the domain*. **Decide before building** — a juror measured a correct multi-key prune at 685 ms, slower than the 516 ms read it would amortise, so the rewrite-in-place shape is refuted as written

## Notes

- The first measurement of this blamed the concurrency slot and a supposed `budget_rate` defect. Both were false: the bound IS computed (`limit=1000` → 1), and the `lines: 0` reading was a zsh artifact — `plot-budget.sh` is bash, and sourced into zsh `budget_now_ms` fails with `command not found: date`. Full record in `docs/notes/2026-09-20-the-board-never-fetches-pr-data.md`.
- No rate limit was ever reached on the repository that prompted this: `bb` answers in 0.4 s, `jen` in 11 ms, exit 0. The timeouts are Plot's own overhead.

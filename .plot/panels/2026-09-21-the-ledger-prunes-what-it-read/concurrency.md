# Juror: concurrency and data loss

Subject: `docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md`
Lens: the ledger is append-only and lock-free BY DESIGN; the plan adds the one write the design does not have.

Position: amend

## The short form

The problem is real, the direction is right, and the loss is small — I measured it. What I refuse is one sentence. The plan licenses its rewrite by claiming `budget_append`'s `|| true` "already tolerates" a lost line. That claim is false at the kernel level, and it is the sentence doing the licensing work. A concurrent appender whose file was replaced under it **succeeds**: it writes into an unlinked inode, `printf` returns 0, `|| true` never fires, and the line is destroyed with no error anywhere. The plan's safety argument names a mechanism that does not exist.

Everything else I would let through. Fix the argument, state the real loss, and I would move to proceed.

---

## 1. Does the stated problem exist, verified in code?

Yes, on every count, and the measurements are worse than the plan's.

**The rule is finished and dead.** Verified directly rather than from the plan's prose:

- `truncationOwed` (`packages/domain/src/rules/budget-record.ts:205`) is referenced in exactly three places: its own definition, a doc-comment cross-reference, and `spendRate` at `:342`, which merely reports `pruneOwed` in its return value.
- `.truncate(` — **zero call sites in the entire repository.** The port method (`ports/budget.ts:96`) and its adapter (`adapters/budget/budget-file.ts`) are fully implemented and reached by nothing.
- `survivors` and `groupByBudget` exist only in their own file. The one `survivors` hit outside it is an unrelated identifier in `working-agents.ts` and a comment in `plot-host.sh:840`.

So `spendRate` computes `pruneOwed` on every read and every caller discards it. The plan's framing — CLAUDE.md's *"where a rule exists and nothing calls it, that is a defect to report"* — is correctly applied.

**The cost is real and the plan understates it.** Live ledger, measured now:

| | plan says | I measured |
|---|---|---|
| `~/.plot/state/budget.tsv` | 17.6 MB / 312589 lines | **17.68 MB / 314002 lines** |
| append rate | ~1,160 lines/hour (cited from 2026-09-01) | **2,586 lines/hour** over the last 20k lines |
| peak burst | not stated | **8 lines in one second** |

**The dead fraction justifies the change on its own.** Computing the per-key live window across all 13 budget keys at the current instant:

```
total readable=314013  survivors=2616  dead=311397  (99.2% dropped)
```

**99.2% of the file is dead.** `budget_rate`'s awk parses all 314,002 lines to answer a question that 2,616 lines can answer. The plan's "growth has no ceiling" is correct: this is not tuning, the work is unbounded and the answer's input is bounded.

**Three callers pay it**, all in `plot-host.sh`: `graphql_budget_spent:1549` (on the GitHub router's hot path), `host_concurrency_bound:2789` (per call, to compute the slot bound), and the `spend-rate` op at `:4485`. The first two run beside host calls, which is exactly where the header refuses to spend 40 ms on `node`.

## 2. Is it the smallest change that fixes it?

Broadly yes, with one caveat my lens cares about.

Pruning in the shell rather than the domain is right, and the plan's reasoning survives scrutiny: `plot-budget.sh` is sourced by `plot-host.sh`, the spenders are shell, and the file header already refuses a `node` hop on this path. `docs/shell-and-domain.md`'s frequency table settles it — "once per agent per pass" duplicates and a corpus test holds the pair, and `budget_rate` runs far more often than once per operator command. The plan cites this correctly.

**The caveat: the plan proposes pruning inside `budget_rate`, the function on the hot path, and never asks whether a cheaper trigger exists.** It does not consider:

- pruning in `budget_append` instead (also hot, but already the writer — no new writer role is created), or
- a size check before the scan, so the common case costs one `stat` rather than a full parse, or
- most importantly, **`budget_rate`'s awk already reads every line.** The natural implementation counts survivors in the same pass it already makes and only then decides. The plan says "counts the dead lines it skipped", which reads as this — but it is left implicit, and an implementer who adds a *second* scan to collect survivors doubles the very cost being removed.

That is a slice-instruction gap rather than a design flaw. It should be said explicitly.

## 3. What could I NOT verify?

- **The 516 ms / 5 ms `budget_rate` timings.** Measured on `quatico/quaweb-website` with Plot 2.19.0; I have neither. My own proxy — a full awk pass over the 17.6 MB file — ran **360–460 ms**, the same order, so the claim is plausible.
- **`plot-host.sh pr-list` at 2567–7241 ms vs 507–1183 ms with `PLOT_BUDGET_OFF=1`.** I did not run host calls. I also could not find `PLOT_BUDGET_OFF` handled anywhere in `plot-budget.sh`; if it lives in `plot-host.sh` the measurement stands, but the plan cites a switch it never locates.
- **"several reads per call."** Three call sites exist; whether a single `pr-list` hits more than one is a path I did not trace.
- **The "eleven shell scripts" figure.** Inherited from the file header, not re-derived.
- **The 1,160 lines/hour figure is stale.** The plan quotes it from 2026-09-01 to size the threshold. The live file says 2,586/hour. The plan reasons from a number that is 2.2x low, and the threshold argument (§"The threshold is not one") rests on it.

## 4. What breaks if this ships as written?

### 4a. The licensing sentence is false — this is my core finding

The plan, §"What must not break":

> a concurrent appender either writes to the file being replaced (**its line is lost, which `budget_append`'s own `|| true` already tolerates**) or to the replacement

I tested the actual POSIX semantics:

```
$ printf 'line1\n' > f.tsv
$ exec 9>>f.tsv                                  # appender's O_APPEND fd
$ printf 'new\n' > f.tsv.tmp; mv -f f.tsv.tmp f.tsv   # the prune
$ printf 'orphaned\n' >&9
append to replaced inode: SUCCEEDED (exit 0, || true never fires)
$ cat f.tsv
new
```

**`|| true` tolerates nothing here, because nothing fails.** `||` fires on a *non-zero exit*. An append into an unlinked-but-open inode returns **success**. The write lands in a file with no directory entry, the inode is released when the fd closes, and the line ceases to exist — with no error, no exit code, and no stderr.

The distinction matters because the two situations differ in what a reader can know:

| | what `|| true` actually covers | what the prune does |
|---|---|---|
| trigger | write returns an error (ENOSPC, EACCES, bad path) | `rename(2)` swaps the inode under an open fd |
| exit code | non-zero → `|| true` swallows it | **zero** |
| detectability | the caller *could* have known | nothing anywhere can know |

The plan borrows the credibility of an existing, argued tolerance to cover a different and less visible failure. The adapter (`budget-file.ts`) is honest about this in a way the plan is not — it says *"A CONCURRENT APPEND CAN STILL BE LOST HERE, and that is accepted rather than overlooked"* and names the cost. The plan should say that, in those terms, and delete the `|| true` clause.

**This is my amendment, and it is the whole of it.** Not because the loss is unacceptable — it is not, see below — but because a design document that licenses its one dangerous write with a mechanism that does not fire teaches the next reader something false about the file. Every other paragraph in `plot-budget.sh` earns its claim with a measurement. This one does not.

### 4b. The loss itself: measured, small, and acceptable

I built the race rather than reasoning about it. 400,000-line seeded ledger (20.3 MB, comparable to live), six concurrent bash appenders, one prune doing `awk > scratch; mv`:

```
awk scan: 461 ms   mv: 101 ms   TOTAL WINDOW: 562 ms
appender a: sent=1068 present=1060 lost=8
appender b: sent=1073 present=1064 lost=9
... (six appenders)
TOTAL: sent=6419 LOST=51
```

Then I characterized *which* lines vanish. Two appenders writing monotonic counters:

```
appender a: lost 1: [1082]   contiguous=True
appender b: lost 1: [1082]   contiguous=True
```

**Each appender loses a contiguous run at one instant — the moment of `rename`** — and nothing before or after. This is the correct and expected shape: the loss window is not the whole rewrite, it is the interval between an appender's last `open()` and the `rename`. A shell `>>` reopens per line, so the exposure is one line per appender per prune.

Scaling to the real rate:

| ledger size | prune window | expected loss @ 2,586/h | @ 8/s burst |
|---|---|---|---|
| 5.0 MB | 148 ms | 0.11 lines | 1.2 lines |
| 10.1 MB | 222 ms | 0.16 lines | 1.8 lines |
| 20.3 MB | 407 ms | 0.29 lines | 3.3 lines |

And the crucial point the plan never makes: **pruning is self-limiting.** Post-prune the file holds ~2,616 lines (~150 KB), so the *next* prune's window is roughly 3 ms, not 400. Steady-state loss is well under one line per prune. The 51-line figure above is the one-time cost of the first prune over an unpruned 20 MB file.

Against ~2,586 lines/hour, where each line is one `spent: 1` in a rate divided by a span, this is noise. The window filter is what makes the answer right — the plan says so and the domain says so — and losing a spend understates a rate, which relaxes a cadence by a fraction of a percent. **I accept the loss. I reject the argument offered for it.**

### 4c. The 512-byte cap is untouched, correctly

`PIPE_BUF` on this machine confirms **512**. Live line lengths: 55–72 bytes, every one far under the cap. The prune writes through a scratch file, so the rewrite is not subject to `O_APPEND` atomicity at all and the cap is irrelevant to it. No regression here.

### 4d. Three real gaps in the slice as written

1. **Scratch file naming and collision.** The plan says "a scratch file and one `mv`" without naming it. `budget-file.ts` uses `${path}.${process.pid}.tmp` and `budget_slot_acquire:403` uses `$dir/.$$.$now.tmp`. The shell prune must follow suit — `$$` at minimum. A fixed name lets two concurrent pruners (a board tick and a dispatched agent) write one scratch file and `mv` a half-file into place. **The plan's own "a partially written ledger must never be visible" does not survive two pruners with one scratch name.**

2. **Same filesystem.** `rename(2)` is atomic only within a filesystem. Scratch must sit beside `budget.tsv` in `$PLOT_BUDGET_HOME`, never `/tmp` — the adapter states this and the plan does not.

3. **Multiple concurrent pruners are not discussed at all.** With `PRUNE_THRESHOLD = 100` and 311,397 dead lines, **every reader crosses the threshold simultaneously** on the first run. Several processes will scan-and-rewrite at once; last `mv` wins, and each loser discards the survivors the winner just wrote — including any line appended between them. This is convergent and self-correcting (the next append re-adds, the window filter still answers right), but the plan should say so rather than leave a reader to discover it. A `-o` age check on the scratch, or simply naming the behaviour as accepted, would close it.

### 4e. What does NOT break

- **Appends stay lock-free.** No appender acquires anything; the prune never blocks one.
- **Correctness is untouched.** `survivors` keeps every budget's live window per key (`groupByBudget` + per-key `windowStart`), so pruning for one connector cannot delete another's live lines — the rule is careful about exactly this and the shell must mirror it.
- **The slot mechanism is independent.** `budget_slots_dir` is a separate directory with `ln`-published claims; the prune touches none of it.
- **Failure is safe.** A failed `awk` leaves the scratch file and never renames; the ledger is as found. The plan's "every failure path leaves the ledger as found" holds — provided the implementation does `awk … > scratch && mv`, never `awk … > "$path"`.

## 5. Existing mechanism, or a nearer one ignored?

**Yes — and the plan names it and then walks past it.**

`BudgetRecord.truncate()` is fully implemented in `adapters/budget/budget-file.ts`, using precisely the scratch-plus-`rename` the plan proposes, with the concurrency cost already argued in place. The plan cites this as evidence the rule is dead, which is right, but the consequence deserves more weight: **the shell prune is a second implementation of a shipped adapter method.**

Under `docs/shell-and-domain.md` that is allowed — the frequency test puts `budget_rate` firmly in the "duplicates the rule" row — but §"Duplication is allowed and undeclared duplication is not" requires the pair be held by a corpus test. The plan promises a corpus test that pins **the threshold** (`PRUNE_THRESHOLD`). That is the smaller half. The corpus test should pin **`survivors`** — which lines are kept — because that is where a divergence destroys live data. A shell `survivors` that computes `windowStart` per *file* rather than per *budget key* would silently delete another connector's live window, and a threshold test would pass throughout.

`corpus/sprint-score.corpus.test.ts` is the precedent and it compares *answers over the live estate*, not constants. The README's rule applies directly: "a comparison that can only pass proves nothing" — the corpus must exercise each answer, meaning multiple budget keys with differing reset times. The live ledger has 13 keys and would make a good corpus.

Nearer mechanisms the plan does not weigh:

- **Prune in `budget_append`.** The appender is already the writer; making the *reader* a writer is what the file header spent a paragraph refusing (`plot-budget.sh:11-15`). The plan overrides that header without quoting it. It is right to — the domain rule's "pruned by the reader that already read it" is the better argument — but the header will now contradict the code and **must be amended in the same slice**, or the next reader finds a file whose header says "IT APPENDS AND READS, AND IT NEVER PRUNES" above a function that prunes.
- **Bounding the scan.** Since the answer only needs the last hour and the file is append-ordered by time, a reverse read that stops at the window boundary answers `budget_rate` in O(window) with **no write at all** — no rewrite, no rename, no lost line, no new writer. It does not reclaim disk, so pruning is still wanted eventually; but as a fix for the *stated problem* (the 516 ms read) it is strictly smaller and carries zero concurrency risk. **The plan does not mention this alternative.** Given the plan's own §2 framing — the smallest change — it owes a sentence on why the rewrite is preferred. My guess is that the file is not strictly time-ordered across keys and the tail read is fragile; that is a fine answer, but it should be the plan's, not mine.

---

## What would move me to proceed

1. **Delete the `|| true` clause** and replace it with the adapter's own honest sentence: a concurrent append can be lost here, the write returns success, nothing detects it, and it is accepted because the window filter is what makes the answer right.
2. **State the measured loss**: one line per concurrent appender per prune, ~51 lines on the first prune over a 20 MB ledger, under one line per prune in steady state once the file is ~150 KB.
3. **Name the scratch file** as `$$`-scoped and beside the record, and say what happens when two pruners race.
4. **Point the corpus test at `survivors`**, not only at `PRUNE_THRESHOLD`, with a corpus spanning several budget keys.
5. **Amend `plot-budget.sh`'s header** in the same slice — it currently says the file never prunes.
6. **Refresh the append rate** to the measured 2,586/hour, or say why 1,160 is still the right number to size a threshold against.
7. One sentence on why the rewrite beats a window-bounded reverse read.

Items 1 and 5 are the ones I will not drop. The rest are improvements; those two are a design document telling the next maintainer something untrue about how the file behaves under concurrency.

Position: amend

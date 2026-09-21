# Estate lens — the-ledger-prunes-what-it-read

Position: amend

Reading position: ~290 plans and a long history. The commonest defect here is a plan proposing what the estate already has. This plan is the *inverse* of that defect — the estate already has the rule and the plan knows it — so the question I actually had to answer is different: **does the estate already hold a cheaper mechanism, and does the estate already hold a rule that FORBIDS the shape this plan chose?** The answer to the second is yes, in writing, in the file the plan proposes to edit.

## 1. Does the stated problem exist? — YES, reproduced independently

Measured on this machine, 2026-09-21, against the live `~/.plot/state/budget.tsv`:

| | plan claims | I measured |
|---|---|---|
| ledger size | 17.6 MB, 312589 lines | **17,682,981 B, 314,030 lines** |
| `budget_rate` over it | 516 ms | **498–566 ms** (3 runs each, two different keys, via the shipped `plot-budget.sh` sourced in bash) |
| oldest line | — | **17.98 days** |
| live lines in the 1 h window | — | **2,617 of 314,030 — 99.17% dead** |
| append rate | ~1,160/h (2026-09-01) | **2,014/h** measured over the last 24 h — the growth is worse than the record's own design note assumed |

The dead-line fraction is the finding that settles the premise. The plan says "cost grows with total file size forever while the answer only ever needs the last hour" — on this machine the reader parses **120 lines for every 1 it can use**. That is not a tuning opportunity. It is unbounded growth against a bounded answer, exactly as stated.

**And the caller-absence claim is true.** `git grep` over `truncationOwed`, `readWindow`, `survivors`, `groupByBudget`, `PRUNE_THRESHOLD`: every production hit is inside `budget-record.ts` itself; every other hit is a test, a brief, or this plan's own prose. `truncate` has no production caller — `budgetFile` itself is exported from `adapters/index.ts` and **constructed nowhere in production**; the only `budgetFile(` call sites are in `packages/domain/test/`.

The plan understates its own case here in a way worth recording: `spendRate` already computes and returns `pruneOwed`, and `accountSpend` aggregates it across buckets. So the estate has not merely an uncalled rule — it has a **fully plumbed answer that is computed, returned in a public interface field, and read by nobody.** That strengthens the "rule exists, nothing calls it" finding the plan leans on.

## 2. Is this the smallest change that fixes it? — NO. It is a larger and more dangerous change than one the plan never evaluates.

This is my central objection.

**The plan never considers reading less. It only considers writing more.** Truncation is a *write* — a whole-file rewrite, the one operation the append-only design was built to avoid. Before accepting a write, the estate rule is to ask whether a read change gets there. I measured two:

```
full awk scan (today)              317–337 ms
tail -n 20000 | same awk            30–44 ms
```

**~10× for a read-only change**, with zero new write path, zero concurrency exposure, zero scratch file, zero `mv`, zero corpus test, and nothing to fail. And the ordering assumption that makes it safe is *measurable rather than assumed* — I measured it:

```
out-of-order lines:      2,352 of 314,036
max backward jump:       7,139 ms
```

The file is near-monotonic in `$5`, with a bounded 7.1-second worst-case inversion. A tail window of 20,000 lines covers ~10 hours of appends at the measured 2,014/h — three orders of margin over a 1-hour window and four over a 7-second inversion. A reader that tails N lines, and falls back to a full scan only when the oldest line it read is still inside the window, is **correct by construction** and never writes.

The plan's Design section has a heading "Where the pruning goes, and why it is the shell" — it argues *which component* prunes, and never argues *whether a prune is the mechanism.* The alternative that removes 90% of the cost with no write at all is not mentioned, not measured, not refused. On this estate that omission is itself the finding: `plot-reconcile-scan.sh` §19/§20 and `plot-release-refs.sh` are both built on the principle that a reporting or read-side change beats a destructive one when both reach the goal, and truncation is the destructive one here.

**Note what this does NOT say.** Tail-reading and truncation are not mutually exclusive, and truncation still has an independent justification the tail does not: **disk**. 17.6 MB growing at 2,014 lines/h is ~15 MB/week unbounded, and a tail reader leaves every byte of it. So the right shape is very likely *both* — tail for the hot path now, truncation for the disk later, decided separately — and the plan currently bundles them into one slice that pays the write's whole risk to buy the read's whole benefit. Splitting them is most of my amendment.

## 3. What I could NOT verify — and one claim I verified as FALSE

**Could not verify:**

- Every number from `quatico/quaweb-website` (`pr-list` 2567–7241 ms, the `PLOT_BUDGET_OFF=1` 507–1183 ms comparison, "three open PRs"). Different repository, not on this machine. I could reproduce the *ledger* half exactly, which is the load-bearing half, so I am not treating this as a gap.
- "several reads per call." I found **3** `budget_rate` call sites in `plot-host.sh` (`:1549` via `graphql_budget_spent`, `:2789` via `host_concurrency_bound`, `:4485` for `spend-rate`). On a *Bitbucket* call — the measured repo — `graphql_budget_spent` is a GitHub-only path, so the plausible count is **one per call, not several**. 1 × 516 ms against a 2567 ms total is ~20%, not the ~80% the note attributes to the budget record. The `PLOT_BUDGET_OFF=1` delta is real and measured, but it switches off appends and slot acquisition too — **it is not a clean measurement of the read.** The plan inherits "several reads per call" from the note without re-deriving it, and its own Changelog repeats it. *That number should be measured per-call-site before it ships as justification.*

**Verified FALSE — the plan's central structural claim.** The plan writes:

> "The rule says the reader prunes, and **the reader on this path is `plot-budget.sh`, not the domain.**"

`plot-budget.sh`'s own header, lines 11–15, refuses this in advance and by name:

> "**IT APPENDS AND READS, AND IT NEVER PRUNES.** Truncation is the one write that is not an append, and it belongs to the `BudgetRecord` port's `truncate()` — **a second pruning path in shell would rewrite the file while the port's reader believed it held the lines it had just proven dead.** The shell writes the record; the domain is what cleans it."

The plan proposes to do the exact thing this comment forbids, gives the forbidding comment no quotation, no rebuttal, and no acknowledgement that it exists. On an estate whose CLAUDE.md amends sentences in place rather than quietly breaking them (`plot-host.sh`'s "The two issue ops READ", the Layering Rule's `HostBackend`), **silently contradicting a load-bearing header is the process failure.** If the header is now wrong, the plan must say so and amend it. It may well be defensible to amend — but that is an argument the plan has to make and currently does not.

## 4. What breaks if this ships as written — a correctness bug, not a risk

**ONE FILE, TWELVE BUDGET KEYS. The shell reader cannot see eleven of them.**

`budget_rate`'s awk filters on line 250: `if ($2 != want_c || $3 != want_a) next`. Every line for another key is discarded **before** it is collected. Measured on the live ledger right now:

```
bitbucket|quatico    dead=118346  live=2273
github|jwloka        dead=123462  live=102
jenkins|unknown      dead=48365   live=231
bitbucket|plot-pm    dead=16293   live=0
jira|jira:01c8...    dead=153     live=2
...12 keys total
```

The plan's slice says `budget_rate` "counts the dead lines it skipped and, past the threshold, rewrites the ledger." **`budget_rate` never sees another key's lines to skip them.** A rewrite driven from inside that awk keeps only what the caller's key matched and **silently destroys the other eleven keys' live windows** — including `jenkins` (231 live) and `github` (102 live) on a Bitbucket call.

The domain anticipated precisely this. `survivors()` exists for it, and says so:

> "ONE FILE, MANY BUDGETS. A truncation driven by one reader's window would drop another connector's live lines, and the two windows differ in length because the reset is the connector's."

So the domain's rule is **not** what the plan proposes to duplicate. `truncationOwed` reads a single-key `RecordRead`; `survivors` reads *all* lines and regroups by `groupByBudget`, recomputing `windowStart` per key from that key's own resets. A shell prune must implement `survivors`, not `truncationOwed` — a second, larger, per-key-reset rule the plan does not mention it is duplicating.

**And that erases the plan's own performance claim.** I implemented a correct multi-key survivors pass in awk and timed it:

```
correct multi-key prune pass:  685 ms   (keeps 2,615 of 314,051)
```

**685 ms — slower than the 516 ms read it is supposed to be amortising.** So on any read where the threshold fires, the call gets *slower*, not faster. The plan's "516 ms → ~5 ms" holds only for reads *after* a successful prune, and only if the prune was correct, and the correct prune is the expensive one. The plan never measures the prune, only the post-prune read.

**Second break — the threshold fires on essentially every read, forever.** `PRUNE_THRESHOLD = 100`, and today's dead counts are 118,346 / 123,462 / 48,365. The plan states "the threshold is not one... so that pruning happens on some reads rather than every read." With a backlog four orders of magnitude over the threshold, `truncationOwed` is `true` on **every read on this machine until the backlog clears**, and then true again the moment 100 lines age out — which at 2,014/h is **every 3 minutes**. The plan's own stated safety property ("pruning happens on some reads rather than every read") does not hold on the estate it was measured against. `PRUNE_THRESHOLD = 100` was sized against 1,160/h and a file that had never been allowed to grow; at 2,014/h with 17 days of backlog it is not a throttle.

**Third — the concurrency argument is under-measured in the one direction that matters.** The plan and `budget-file.ts` both accept a lost line during the `mv`. Fine. But I measured **max 8 appends in a single second** over the last 24 h, and the correct prune takes **685 ms** — so the rewrite window overlaps a realistic burst. Losing ~5 spends per prune, every 3 minutes, from a record whose *entire purpose* is metering spend, is a different trade than "one line out of 1,160 an hour." It may still be acceptable; it has not been measured, and the plan asserts the old number.

**Fourth — the test the slice promises cannot be written as stated.** "a test proves a concurrent append cannot see a partial file." `rename(2)` already guarantees this; the test would assert the OS. The actual risk is the *lost* append, which the design explicitly accepts and therefore cannot be tested as a prohibition. The slice's stated deliverable and its stated safety property are not the same thing.

## 5. Existing mechanism, or a nearer one — three, and the plan reaches for the farthest

**a) The estate's own pruning pattern is day-files, and it is cheaper.** `plot-commit-record.sh` solves the identical problem — an append-only forensic record that must not grow forever — with `.plot/state/commit-records/YYYY-MM-DD.jsonl`, `KEEP_DAYS=30`, and `tail -n +$((KEEP_DAYS+1)) | rm -f`. CLAUDE.md states the reasoning: *"the day is the unit because that is how a forensic record is asked for, and pruning whole days is one `rm` rather than a rewrite."* That is **the same argument, already won, already shipped, in `.plot/state/` beside `budget.tsv`.** Day-files give: no rewrite, no lost append, no lock question, no multi-key survivors problem (a whole day is dead for every key at once), a bounded read (today's file + yesterday's), and deletion by `rm`. The plan never mentions it. On this estate, proposing a whole-file rewrite when the sibling state file next door already solved it with day-files is exactly the defect my lens exists to catch — the estate has the mechanism, in the same directory, written by the same project.

**b) Tail-reading** — §2. ~10×, read-only, ordering measured and bounded.

**c) The `spend-rate` seam is one hop from free, and the plan misses it.** The board does **not** use `budgetFile`; `fleet.ts:1784` shells `plot-host.sh spend-rate` (`spendRateFor`, "ONE LOCAL `bash` PER REFRESH"). So `spend-rate` at `plot-host.sh:4485` is a **once-per-operator-command / once-per-refresh** path — §1 of `docs/shell-and-domain.md` puts that squarely in "**calls the domain**", 39 ms, no duplication, no corpus test. The plan asserts the opposite ("this runs once per host call, not once per operator command, so it duplicates the rule") by treating all three `budget_rate` sites as one frequency class. **They are not.** `:4485` (`spend-rate`) is operator-frequency and could call `survivors` through a bundle *today*. Only `:1549` and `:2789` are hot-path. Splitting them means the domain's real `survivors` rule gets its caller — closing the "rule exists, nothing calls it" defect **properly**, in the domain, per the plan's own citation — while the hot path gets a read-side fix that needs no rule at all.

**d) Prior attempts.** No abandoned truncation branch. The history is cleaner and more damning than that: `docs/plans/2026-09-01-one-account-has-one-budget.md` (**State: Released**) scoped this into slice `bug/a-budget-belongs-to-the-computer` and wrote, in the slice line:

> "**Plus the window and the pruning**, which the design spec settles and **which cannot be deferred** ... A reader consumes only lines newer than the connector's own reset window **and truncates what it has just proven dead** — the one write that is not an append, at most once per reset."

That slice shipped as **PR #621**. The window shipped; **the pruning did not**, and the plan was released anyway. So this is a **half-delivered released slice**, not a new defect — and "at most once per reset" was the original throttle, which is a *time* bound, not `PRUNE_THRESHOLD`'s *count* bound. The plan should cite #621 and say the slice under-delivered; that is a stronger and more honest framing than "the rule is finished and dead," and it also recovers the throttle the estate originally specified.

## What would make me say proceed

1. **Split the slice.** Hot-path read cost and unbounded disk growth are two problems with two mechanisms. Do not buy the write's risk to pay the read's bill.
2. **Slice A — read side, no write.** Bound `budget_rate`'s read (tail-with-fallback, or day-files per `plot-commit-record.sh`). Measured ~10× here, nothing destructive, no corpus test, no concurrency exposure.
3. **Slice B — the disk, in the domain.** Give `survivors` its caller at the `spend-rate` seam (operator frequency → `docs/shell-and-domain.md` §1 says *call the domain*). This closes "a rule exists and nothing calls it" in the place the rule actually lives, and the multi-key correctness comes free from `groupByBudget`.
4. **If shell pruning survives that, it duplicates `survivors`, not `truncationOwed`** — say so, implement per-key `windowStart`, and measure the prune pass (mine: 685 ms) alongside the post-prune read.
5. **Re-measure the threshold.** 100 against 118k dead and 2,014/h fires every read now and every ~3 min after. Restore the released plan's own "at most once per reset" time bound, or justify a new number against 2,014/h.
6. **Answer `plot-budget.sh`'s header by name.** Quote lines 11–15 and either amend them in place with the reason, or accept them and put the prune in the domain.
7. **Re-measure "several reads per call" per call site.** I count 1 on a Bitbucket path, not several; `PLOT_BUDGET_OFF=1` is not a clean read measurement because it also disables appends and slots.

## Position

The defect is real, reproduced, and worse than stated (99.17% dead, 2,014 lines/h against a design sized for 1,160). The plan deserves to exist. But as written it contains a **correctness bug that destroys eleven budget keys' live windows**, a performance claim that **inverts once the bug is fixed** (685 ms prune vs 516 ms read), a threshold that **does not throttle on the estate it was measured against**, an unrebutted contradiction of the target file's own header, and it **skips both the cheaper read-side fix and the estate's own already-shipped day-file pattern sitting in the same directory.**


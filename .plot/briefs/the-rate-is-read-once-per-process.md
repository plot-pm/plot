## Implementation brief — the-ledger-prunes-what-it-read (slice 1: The rate is read once per process)

- **Plan (canonical):** `docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md` on `main`
- **Approved:** 2026-09-21, jwloka, in-session
- **Branch:** `bug/the-rate-is-read-once-per-process` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This slice waits on nothing and nothing waits on it. Its sibling `bug/the-disk-stops-growing` is **deferred** — its shape is undecided and a juror refuted the rewrite-in-place form by measurement. Do not build it, do not prepare for it, and do not prune anything here.

### What to build

`budget_rate` memoises its answer per (connector, account, bucket) for the life of the process, so the three calls inside one `plot-host.sh pr-list` scan the ledger once instead of three times.

The observed failure: on `quatico/quaweb-website` with Plot 2.19.0, `~/.plot/state/budget.tsv` holds 312589 lines across 17.6 MB. One `budget_rate` over that file takes **516 ms**, against **5 ms** over fifty lines. A single `pr-list` calls it **three times** — counted with a probe, not inferred — so ~1650 ms of a 4020 ms call is the same file scanned three times for the same answer. Splitting the two `PLOT_BUDGET_OFF` guards attributes it: everything on 4020 ms, slot off 895 ms, append off 3608 ms, both off 597 ms. The slot path costs ~3100 ms and the append ~400 ms.

Nothing is written, nothing is deleted, no rule is duplicated. The plan calls this "the slice that needs no permission" and that is the scope: a memo, and the test that proves it fires.

The plan is canonical. This is orientation.

### The decisions the plan settles — do not re-derive them

**Do not prune the ledger.** The plan's `## Slices` defers pruning to a separate branch with an explicitly undecided shape. A juror measured a correct multi-key prune at **685 ms** against the **516 ms** read it would amortise — the rewrite-in-place form is refuted as written. Pruning here also drags in `plot-budget.sh`'s header amendment, the scratch-file-and-`mv` atomicity argument, and the `PRUNE_THRESHOLD` corpus pairing, none of which this slice needs.

**Do not touch `PLOT_BUDGET_OFF`.** It disables the concurrency slot *and* the append together. The plan's first draft treated it as a clean performance reading and was wrong; `plot-budget.sh:2604` states it is "not a performance switch". It exists for tests proving the record changes nothing about a call's behaviour, and for a read-only home directory.

**Do not add a TTL, a file-mtime check, or an invalidation hook.** Per process is the whole bound. The plan's lever is stated as "`budget_rate`'s answer does not change three times inside one process" — a `plot-host.sh` invocation is short-lived, and a memo that tried to notice the file moving would re-`stat` on every call and re-open the question this slice closes.

**The key is the triple, never a single variable.** `budget_rate` has four call sites with three distinct keys: `host_concurrency_bound` (`plot-host.sh:2789`) passes an **empty** bucket, `graphql_budget_spent` (`:1549`) passes `graphql`, and the `spend-rate` op (`:4485`) passes whatever the operator named. An empty bucket means *every bucket* and is a different question from any named one — `plot-budget.sh` says so in its own words: "a cadence divided by one pool's rate would ignore the traffic on the other." A memo keyed on less than the full triple returns the graphql answer to a caller asking about the account.

**`now` is the fourth argument and it must not silently join the key.** `budget_rate` takes an optional `now-ms`; callers in `plot-host.sh` omit it, so it defaults to `budget_now_ms()` and differs by milliseconds between calls. Keying on it makes every lookup a miss and the memo is dead code that passes every test. Decide explicitly what an explicitly-passed `now` does — the honest options are *bypass the memo* or *key on it* — and say which in a comment, because a reader will ask.

**Rules carried over from this estate, do not re-discover them by breaking them:**

- **Absent is not zero, and absent is not false.** `-` in the record means the connector did not say; `remaining: 0` means the bucket is spent. A memo that normalises a missing answer into a present one inverts the gate. The same applies to the memo itself: *not yet computed* and *computed to empty* are two states, and bash's unset-vs-empty distinction is the one tool that separates them.
- **A missing file is an empty record, not a failure.** `budget_rate` returns a well-formed zero object for a missing path and for a `budget_path` that fails. Both are cacheable answers, not errors to skip caching.
- **Read the exit code, not the emptiness.** `budget_rate` prints a JSON object on every path and returns 0; its callers test the *content*. A memo must preserve both the stdout and the exit status of the call it replaces.

### Done when

The plan's `## Done when` list is the specification. This slice's plan text names no separate list, so the slice line is it: *"`budget_rate` memoises its answer per (connector, account, bucket) for the life of the process, so three calls inside one `pr-list` scan once. 3 → 1 scan."*

Lift these assertions, because a naive implementation passes without them:

- **The memo actually fires — counted, not assumed.** This is the assertion the whole slice turns on. `rate="$(budget_rate ...)"` is a **command substitution, which is a subshell**: a variable the function sets inside it dies when the substitution closes. A memo written the obvious way is written three times, read zero times, and every behavioural test still passes because the answers are identical. Count the scans — instrument the read, or assert on a counter the function increments — and assert the second and third calls in one process do **not** read the file. A test that only compares return values cannot distinguish a working memo from an absent one.
- **Three distinct keys in one process yield three distinct answers.** Call with bucket `''`, `graphql`, and `core` against a fixture holding different lines per bucket, and assert each gets its own answer. Catches the single-variable cache that returns the first caller's reading to everyone.
- **An append between two reads does not have to be seen, but a *different key* must not be served the stale one.** `budget_record_call` appends after every host call, so within one `pr-list` the file grows between reads. Serving the memo is the point; serving it *across keys* is the bug.
- **The zero object is memoised too.** A missing ledger and a failing `budget_path` both return the all-null object. Assert a second call on the same key still returns it and still exits 0 — a memo that treats "no answer worth caching" as a miss reintroduces the scan on exactly the machines that have nothing to scan.
- **`spend-rate` still answers the operator honestly.** `plot-host.sh:4485` is the one caller that reads `spent`/`perHour` rather than just `limit`/`basis`. It is an operator-frequency command, one read per process, so the memo is a no-op for it — assert it, so a future change that makes it loop does not silently start serving a stale spend figure.

Plus the repo's gates:

- `nvm use` first — Node 24 per `.nvmrc`; **pnpm crashes outright on Node 26**.
- `pnpm test`
- `pnpm run test:contracts` — this is the suite that owns `test/reconcile/budget.test.mjs`, the shell half's contract test. Your new assertions belong there; read its header first, it states the three things it exists to pin.
- A changeset. `.changeset/` is often empty in a fresh worktree and the files there belong to siblings — add yours, touch none. This is a `skills/` change, so it uses the `'plot': patch` frontmatter with a `bumps:` block, **description first and `bumps:` last** — a `bumps:` block written first becomes the published release note.
- **Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one; it dispatches real workers into sandbox repositories and has taken this machine down.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. `gh pr create` takes it from the last commit subject, which on this estate is routinely `plot: build the board artifact` — measured 2026-09-08 across three slice PRs.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-budget.sh` — `budget_rate` and its header comment
- `test/reconcile/budget.test.mjs` — the new assertions
- `.changeset/` — your own file only

It does **not** own `packages/domain/**`. No rule is duplicated by this slice, so nothing joins the corpus tier and `PRUNE_THRESHOLD` is not read here.

`skills/plot/scripts/plot-host.sh` is **read, not edited**, unless the memo's shape forces it. If it does — because the subshell problem cannot be solved inside `budget_rate` alone — that is a finding worth stating in the PR body rather than a licence to restructure the four call sites. Keep any such change to the minimum that makes the memo observable.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

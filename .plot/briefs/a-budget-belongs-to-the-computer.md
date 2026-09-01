# Implementation brief — one-account-has-one-budget (Naming the record)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on main
- **Design spec:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-budget.md` — §2 Identity, §5 Where it lives, §4b Lifecycle. **Binding**, per CLAUDE.md > The Domain Package.
- **Approved:** 2026-09-01, after 5 rounds of interrogation
- **Branch:** `bug/a-budget-belongs-to-the-computer` (base: `main`)
- **Ends as:** one PR to main
- **Runs second.** `bug/a-connector-answers-for-its-limit` merged as **#608** and settled what a connector can answer; this settles where that answer is kept. Everything that appends waits on this.

### What to build

The record's **location, key, format, and pruning** — and nothing that appends to it. The plan is explicit that this comes "before anything appends", because a format that gains writers before it has a shape gains them in whatever shape the first writer chose.

### The decisions already settled — do not re-derive them

**It lives outside any checkout.** Two GitHub checkouts on this machine share one account, so a per-checkout `.plot/state/` would let each read a full 5000 and both spend it. The budget belongs to the computer, which is what the branch name says.

**Keyed by `(connector, account, bucket)`.** Not by repo, not by checkout. Bucket is load-bearing: measured 2026-09-01, `gh` GraphQL and REST have **separate limits**, so a GraphQL exhaustion says nothing about REST — a single per-connector number would refuse calls that would have succeeded.

**The connector is a STRING the record does not validate.** This was decided against a closed enum, twice. `Tracker` already names `linear` with no adapter behind it, and `ports/host.ts:6` already carries `HostBackend = 'github' | 'bitbucket'` — a closed vendor list *in the domain* that `host-shell.ts:110` throws on. That enum is a known defect with its own plan; **do not add a second one here.**

**Append-only, with a stated line cap.** Concurrent `O_APPEND` is atomic only below `PIPE_BUF`. A line that can exceed it can interleave with another writer's, so the cap is part of the format rather than a nicety.

**CHECK THE NUMBER; DO NOT COPY IT.** The plan (line 373) and `DESIGN-budget.md` (line 250) both say *"4096 bytes on Linux and macOS"*, and that is **wrong for macOS**. Measured 2026-09-01 on the machine this fleet runs on:

```
$ getconf PIPE_BUF /
512
```

512 is POSIX's guaranteed minimum; Linux reports 4096. A cap chosen at 4096 would be **eight times** the atomicity guarantee here — the exact class of bug the cap exists to prevent, arrived at by trusting a documented constant over a measured one. Pick the cap against the smallest value the fleet's machines report, and say in the code which number you measured and where. Correcting the plan and the spec is in scope for this branch: they state a fact this slice depends on.

**A connector that reports no limit records `unknown` — never `free`.** The distinction is the whole provenance model: `actual` where the connector has a rate-limit API or sends headers, `predicted` where the adapter supplies a value from experience. Absent is not zero and not unlimited; a reader that treats `unknown` as headroom will spend a budget it never measured.

**The window and the pruning cannot be deferred.** Measured 2026-09-01: one board at 5 s plus eleven scripts at 90 s append **~1,160 lines an hour, ~15 MB a week**. A rate derived over the whole file therefore approaches zero as the file grows, and every reader parses megabytes to learn about the last hour. So a reader consumes **only lines newer than the connector's own reset window**, and truncates what it has just proven dead — the one write that is not an append, at most once per reset.

**Why the reset window and not a fixed age:** the window is the connector's, not Plot's. GitHub's hourly reset and a Jenkins instance with no limit at all do not share a horizon, and a fixed age would be wrong for both.

### Done when

The plan's own list is the specification: **the location, the key, the format, and what a connector reporting no limit records.** Plus the window and the pruning above.

Then the assertions that exist because a naive implementation passes without them:

- **A second checkout of the same account reads the same record.** The one-line statement of why this slice exists; a test that only ever uses one checkout cannot see the bug.
- **`unknown` does not read as headroom.** Assert the reader's decision, not just the stored value — the defect is a consumer treating absence as permission.
- **Truncation keeps every line inside the window.** A pruner that is merely *called* proves nothing; assert what survives.
- **Two concurrent appends both survive**, and neither is interleaved.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run typecheck`, a changeset, and the domain package's own rules — **arrow functions, factual TSDoc, and the layering rule.** Do NOT run `pnpm run test:e2e` locally; CI owns it.

**The domain gates are enforced in CI**, and one of them was blind until today: `bug/a-gate-reads-every-file` (#613) adds `-a` to six greps that a single NUL byte could hide a file from. If your branch predates it, rebase before trusting a green actor-name gate.

### Bookkeeping

When the PR exists, append `(Branch: bug/a-budget-belongs-to-the-computer, PR: #N)` to this slice's `### Naming the record` heading in the plan — **the heading form, not a trailing arrow**: this plan uses `## Slices`, where `→ #N` parses as unannotated. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the record's definition — its location, key, format and pruning. It does **not** own anything that writes to it: `bug/the-budget-knows-which-bucket-it-spent` and the counting slice follow. If you find the format needs a field only a writer could justify, say so in the PR rather than adding the writer.

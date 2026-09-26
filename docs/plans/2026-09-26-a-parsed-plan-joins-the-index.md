# A parsed plan joins the index

> The scan parses all 349 plans on every pass, at **~93 ms each — 32 seconds** before any git or host work. Almost none of them changed. `git ls-files -s` hands back a content hash for all 349 in **134 ms**, so a parse result keyed by blob SHA is reusable until the file itself changes.

## Status

- **State:** Rejected
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1017
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1

## Why this was rejected

**Rejected 2026-09-26 after round 1. The premise is false: the scan already batches the parse.**

`plot-fleet-scan.sh:2916` passes `"$@"` — every plan file in ONE invocation of `plot-plan-meta.sh`. Measured by the moderator:

```
ALL 350 plans in one invocation:  481 ms
```

Not 32 seconds. **The plan's own measurement was honest and its inference was wrong**: 30 *separate* invocations at 93 ms each is a real number for a call pattern the scan does not use. The 93 ms is almost entirely per-process startup, and a batch pays it once.

So the optimisation this plan proposes is already built. It cites `plot-fleet-scan.sh:3118` while the batching sits at `:2916` in the same file.

**#1017 stays open.** The 90 s scan timeout is real and now has one fewer explanation — not the parse, not machine load, not the host, not the board's deleted path. What remains unmeasured is where the scan's time actually goes, and a replacement plan starts by profiling that rather than by proposing a fix.

## Changelog

- A plan parsed once stays parsed. The scan reads a plan index keyed by content hash and re-parses only what changed, instead of re-deriving 349 plans on every pass.

Board impact: the board's scan is what pays this cost today, so it is the beneficiary. No payload change and no new field.

## Motivation

### Measured 2026-09-26

```
plot-plan-meta.sh, one plan            156-198 ms
30 plans, sequentially                 2808 ms      → 93 ms each
349 plans                              ~32 s
git ls-files -s, all 349 blob SHAs     134 ms
```

The board reports `Last scan failed: timed out after 90000ms`. A direct scan run exceeds 150 s. The estate is **9 remote branches** and **349 plans** — the cost tracks the corpus, not the estate.

### The cost is per invocation, not per plan

```
165-line plan → 198 ms
268-line plan → 156 ms
```

The longer file parsed **faster**, and a `bash -x` trace of one parse is **26 lines**. This is fixed startup: `plot-plan-meta.sh` spawns `plot-config.sh`, itself another bash plus awk, so each plan costs roughly two shell startups. Bare `bash -c true` is **26 ms** on this machine.

**So optimising the parser cannot help.** The work is to stop invoking it.

### Almost nothing changes between passes

349 plans exist; a busy day touches perhaps a dozen. Every pass re-derives 337 answers that were already correct.

### The key is free and exact

`git ls-files -s` returns each plan's blob SHA in one call, 134 ms for the whole corpus. Git maintains these already — there is no hashing to do.

**A blob SHA is the right key and mtime is not.** `plot-fleet-scan.sh:3124` records why the previous pre-filter failed: it keyed off a symlink's mtime, *"and a fresh checkout stamps every symlink at once — 56 of 56 delivered links admitted here, so the parse it was meant to avoid was already being paid in full."* A content hash cannot be perturbed by a checkout.

### The index is not the filename and not the directory

**The filename carries a date and a slug, never a state**, so it cannot answer *is this plan done*.

**The `delivered/` index is nearly right and not exact.** Measured: 318 of 319 links point at a plan reading `Delivered` or `Released`, with one exception — `the-ci-key-carries-its-instance`, whose `State:` field is **empty**. And `active/` is not a partition: **all 99 of its links also appear in `delivered/`**, because `delivered/` means *no longer active* rather than *phase is exactly Delivered* (`/plot-release` step 5b states this).

So the directories are a good heuristic and a wrong oracle. **This plan caches the parse rather than inferring from layout**, which is why it does not inherit that exception.

## Design

### The rule

**A parse result is stored against the plan's blob SHA. A pass reads the index, parses only the plans whose SHA it has not seen, and writes those results back.**

An entry is never invalidated — it is superseded. The SHA changes or it does not, so a stale entry is unreachable rather than wrong.

### Where it lives, and the precedent is exact

`PrIndexStore` — a port (`ports/pr-index.ts`) with a file adapter writing JSON under the git common dir, plus a fold rule — shipped 2026-09-25 and holds 967 rows. **A plan index is the same shape for a different subject**, and `a-decision-reads-the-index` is already the plan for giving that store its first consumer.

**These two plans meet here and the slice must say how.** Either the plan index is a second store beside the PR one, or the two are instances of one mechanism. Deciding that is part of the work, not a detail.

### What it stores

**What `plot-plan-meta.sh` answers, and nothing derived from it.** Phase, type, title, sprint, story, branches, PRs, the transition records — the parser's own output.

**No verdicts.** Whether a wave is eligible, whether a branch is claimable, what section a row belongs in: all re-derived per pass from indexed facts plus fresh git. The estate's rule (`fleet.ts:2173`) is *"A DERIVATION, NEVER A RECORD"*, and it is a verdict that may not be recorded, not an answer.

### Correctness rests on one property

**The parse is a pure function of the file's bytes.** If `plot-plan-meta.sh` ever consults anything outside the plan — config, git state, the clock — then two identical files could parse differently and the key is wrong.

**The slice must verify this rather than assume it.** The parser reads `plot-config.sh` today, which is exactly the shape that breaks the property: if a config key changes what a parse returns, the key must cover the config too.

### What this does NOT do

- **It does not infer state from the filename.** Names carry a date and a slug.
- **It does not trust `delivered/`.** Measured at 318 of 319, and `active/` is a subset rather than a partition.
- **It does not cache a verdict.** Only the parser's output.
- **It does not change the parser.** The fix is to call it less, and optimising a 26-line trace would not repay the effort.
- **It does not remove `delivered_in_window`.** The frozen-plan filter is correct and shipped; this reduces the cost of the plans that survive it.

## Done when

- A second scan over an unchanged estate parses **zero** plans and says so.
- Editing one plan re-parses exactly that plan.
- A plan whose blob SHA is unknown is parsed, never guessed.
- The parse is proved a pure function of the file's bytes, or the key is widened to cover what else it reads.
- The index's relationship to `PrIndexStore` is stated — one mechanism or two.
- A full scan on this estate completes inside the board's 90 s bound.

## Slices

### The parse is a pure function (Branch: `infra/the-parse-is-a-pure-function`)

**First, because everything else depends on it.** Establish whether `plot-plan-meta.sh`'s output depends on anything but the file's bytes — it reads `plot-config.sh` today. If it does, either remove the dependency or widen the key, and say which. No cache is built here.

### A parsed plan joins the index (Branch: `infra/a-parsed-plan-joins-the-index`)

The store, keyed by blob SHA, with its relationship to `PrIndexStore` decided and argued. Read-through and write-back, and the two tests above.

### The scan reads the plan index (Branch: `infra/the-scan-reads-the-plan-index`)

`plot-fleet-scan.sh` takes its plan facts from the index. The measurement that closes this plan is here: a full scan inside 90 s.

## Notes

The 5.8 ms per-plan figure in `plot-fleet-scan.sh:3118`, recorded 2026-08-19, is **below the 26 ms cost of starting bash on this machine**. Whether it was ever achievable here is unresolved (#1017) — it may have been different hardware, or a batched path since lost. **This plan does not depend on the answer**: at 93 ms or at 6 ms, parsing 349 unchanged plans on every pass is work with no reader.

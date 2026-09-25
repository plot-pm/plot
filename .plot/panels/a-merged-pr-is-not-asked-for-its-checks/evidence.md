# Evidence juror — a merged PR is not asked for its checks

Position: amend
Evidence: executed

Every figure below was re-taken on 2026-09-25 between 15:51 and 16:20, on the estate, at load average 7.4–8.2 over 16 cores. Each timing is the median of two or three runs.

## The claim table

| # | Plan's claim | What I measured | Holds? |
|---|---|---|---|
| 1 | `gh pr list --state all --limit 1000 … statusCheckRollup` = **20.8 s** | 19.26 s, 20.86 s | **yes** |
| 2 | same call without the rollup = **5.1 s** | 5.06 s, 5.22 s | **yes** |
| 3 | `gh pr list --state open --limit 100 … statusCheckRollup` = **0.6 s** | 0.82 s, 0.66 s | **yes** |
| 4 | **957 PRs: 920 MERGED, 34 CLOSED, 3 OPEN** | `Counter({'MERGED': 920, 'CLOSED': 34, 'OPEN': 3})`, total 957 | **yes, exactly** |
| 5 | scan takes **54 s** | 52.19 s, 58.47 s | **yes** |
| 6 | phases: 296 Released / 13 Rejected / 8 Superseded / 12 Delivered / 3 Approved | 296 / 13 / 8 / 12 / 3+1, plus 1 Draft (this plan). 334 files vs the plan's 333 — the plan itself | **yes** |
| 7 | plan parsing **13.3 s over 333 files at 44 ms each, 25%** | per-file loop: 42.6 ms/file — matches. **But the scan does not loop.** Batch over all 338 files: **0.53 s** | **NO — see below** |
| 8 | git **81 invocations**, ~30 ms each, **2.4 s**, 5% | **63 and 67** invocations over two scans. Warm replay of 62 (fetch excluded): 1.67 s total, **mean 27.0 ms** | count **no**, unit cost **yes**, total roughly right for the wrong reason |
| 9 | fork overhead **5 ms** | `/usr/bin/true` 3.57 ms; `git --version` 26.4 ms; `git rev-parse --git-dir` 10.95 ms | **not reproducible** — see below |
| 10 | heaviest single git call **32 ms** | cold 196.9 ms (`rev-parse --git-dir`); warm 293.7 ms (`ls-tree origin/main -- docs/plans/`) | **no** |
| 11 | unattributed **~12 s, 22%** | the true residual is far smaller once (7) and the real host cost are corrected — see the budget | **no, as stated** |
| 12 | board fleet cadence 4 s (`App.tsx:30`) | `FLEET_POLL_MS = 4_000` at `packages/board/src/app/App.tsx:30`. Path in the plan reads `App.tsx` without the `app/` segment | **yes** (line and value exact) |
| 13 | `--rich` adds `checks` at `:716`; call at `:747`; `--limit` rationale at `:615`; empty-`TRACKED_BRANCHES` at `:743` | all four verified verbatim | **yes** |
| 14 | `plot-host.sh:1003` carries the `exit 7` partial vocabulary | `:1003` is inside `pr_list` truncation reporting; the design juror is right that this is the Bitbucket sweep arm | **already amended** |

## The row that does not hold: plan parsing

**The scan already batches, and it has since 2026-08-27.**

- `parse_plan_estate()` at `plot-fleet-scan.sh:2822`, comment `# Called ONCE`, body `records=$("$script_dir/plot-plan-meta.sh" "$@" --prefixes "$PREFIX_RE" …)` at `:2825`.
- It is the **only** executable invocation of `plot-plan-meta.sh` in the whole scan — `grep -n '\$script_dir/plot-plan-meta.sh'` returns exactly one line, 2825.
- Two call sites, both batched: `:2995` (`parse_plan_estate "${plan_reads[0]}"`, a batch of one when a slug is named) and `:3145` (`[ ${#cand_reads[@]} -gt 0 ] && parse_plan_estate "${cand_reads[@]}"`, preceded by the comment `# ONE INVOCATION FOR THE WHOLE ESTATE. Everything below reads its result.`). The comment at `:3089` explicitly forbids adding a second call.
- It landed in `The scan parses its plans once (#486)`, dated **2026-08-27** — 29 days before this plan was written (`plot: a plan for the checks the scan re-fetches`, 2026-09-25).

Measured both ways, on the real estate:

```
per-file loop, 30 files      1.28 s   →  42.6 ms/file    (reproduces the plan's 44 ms)
batch, all 338 files         0.53 s, 0.75 s, 0.53 s
batch as the scan calls it   0.527 s / 0.75 s / 0.531 s   (with --prefixes)
```

**So the 13.3 s row measures the author's own shell loop and not the scan.** The real cost of that component in a scan is about **0.5 s — 1% — not 13.3 s and 25%.** The row overstates it by a factor of 25.

This does not harm the plan's own change, which is explicitly scoped away from plan parsing. It does harm the plan's **Notes**, which promote the parsing finding as *"real and separate"* and worth its own plan. On this evidence it is neither: it is already fixed. A reader acting on that note would open a plan to batch something that has been batched for a month.

## The row that holds better than drafted: the host call

The plan times bare `gh`. The scan does not call bare `gh` — it calls `plot-host.sh pr-list --state all --limit 1000 --rich` with a `--branch` argument per tracked ref (`:747`). Timed as the scan actually issues it, with the 9 tracked branches of this checkout:

```
plot-host.sh pr-list --state all --limit 1000 --rich  <9x --branch>   39.05 s, 36.80 s
plot-host.sh pr-list --state all --limit 1000         <9x --branch>    7.05 s,  7.23 s
plot-host.sh pr-list --state open --limit 100 --rich  <9x --branch>    2.21 s,  2.62 s
```

**The premise verifies larger, not smaller.** ~37 s of a 52–58 s scan is the rich call — about **70%**, not the 38% the table states. The split saves roughly **37 → 9.4 s**, about 28 s, against the plan's implied ~20 s. My numbers sit above the design juror's 31.7 / 6.8 / 2.5 and agree on the shape; the spread across the three of us is consistent with network variance on the same GraphQL query.

Incidentally `plot-fleet-scan.sh:716` justifies requesting the rollup unconditionally because *"the cost is zero on GitHub (same GraphQL call)"*. Three independent measurements now refute that sentence; it is the comment the slice should delete.

## The git rows

Two instrumented scans, every `git` call logged through a PATH shim:

```
scan 1   52.19 s wall   63 git invocations
scan 2   58.47 s wall   67 git invocations
```

Not 81. The call mix: 15 `rev-parse`, 13 `hash-object`, 10 `ls-tree`, 6 `-C`, 5 `log`, 3 `show`, 3 `config`, 2 `for-each-ref`, and singletons. Replayed warm, 62 calls excluding `git fetch` total **1.67 s at 27.0 ms mean**, so the plan's "~30 ms each" is right and its "2.4 s" is high by the same proportion as its call count.

**The conclusion the rows support is unchanged and I endorse it.** Git is ~1.7 s of ~55 s — **3%**, even less than the 5% the plan claims. The plan's central defensive point ("the obvious optimisation is the wrong one") is *strengthened* by a correct measurement.

Two supporting figures do not reproduce:

- **Fork overhead 5 ms.** I measure `/usr/bin/true` at 3.57 ms and any real `git` at 11–26 ms. There is no measurement on this machine that yields 5 ms for a git fork. The arithmetic `81 × 5 ms = 2.4 s` in the Notes is also internally inconsistent — it gives 0.4 s, not 2.4 s. The 2.4 s figure comes from 81 × 30 ms; the 5 ms number appears to be a different quantity presented as if it were the same one.
- **Heaviest single git call 32 ms.** Cold, the heaviest is 196.9 ms; warm, 293.7 ms (`git ls-tree -z --name-only origin/main -- docs/plans/`, which is the estate listing and grows with the plan count). Nothing I ran capped at 32 ms.

## The unattributed residual

With the corrections the budget resolves, which is itself evidence the old table was wrong:

```
host pr-list --state all --rich       ~37 s     ~70%
git (63 calls, warm)                   ~1.7 s     ~3%
git fetch                              ~0.6 s     ~1%
plan parsing, batched                  ~0.5 s     ~1%
remainder                             ~13 s      ~25%
```

The remainder is the same order as the plan's "~12 s, 22%" and the plan's open question about it stands. But it is now the residual of a *different* decomposition: the 13.3 s the old table assigned to plan parsing is not in the budget at all, and the host line is 16 s larger. The open question is worth keeping; the row it sits under must be restated.

## Contention

I could not take any figure on a quiet machine — load averaged 7.4–8.2 throughout, the same condition the plan declares. Three judgements on that:

- **Network-bound figures are clean.** Rows 1, 2, 3 and the `plot-host.sh` timings are dominated by a GitHub GraphQL round trip; they reproduced within 10% across runs taken 15 minutes apart and match a second juror's independent readings. I would report these as sound.
- **Scan wall time is contended.** 52.19 s and 58.47 s differ by 12%, and the dominant term inside them is the network call. I would state it as "roughly 55 s" rather than 54 s.
- **The git per-call tail is not clean, and it is the one place contention changes a conclusion.** The heaviest-call figure moved from 197 ms to 294 ms between a cold and a warm pass, and the mean from 36.9 to 27.0 ms. I cannot separate `ls-tree`'s real cost from scheduler delay here. I therefore report the git *total* (~1.7 s, 3%) with confidence — it is small under every reading I took — and decline to certify any single-call figure. The plan should not state one either.

## Verdict

**Amend.** The plan's thesis is correct and the change it proposes is justified by a larger margin than it claims. Three of its five headline numbers reproduce exactly. But the cost table contains one row that measures something the scan does not do, and the Notes promote that row into a second plan.

### Numbers that must be restated

1. **Delete the plan-parsing row**, or restate it as **~0.5 s, ~1%**. The scan batches at `plot-fleet-scan.sh:2825` and has since #486 (2026-08-27). The 13.3 s figure is a per-file loop the scan does not run.
2. **Delete or rewrite the third Notes bullet.** *"The plan-parsing finding is real and separate … It needs its own plan"* is false. The phase counts in that bullet (296/13/8/12/3) are correct and worth keeping as an observation about the estate; the finding attached to them is not.
3. **Restate the host row as ~37 s and ~70%**, measured through `plot-host.sh pr-list` with the `--branch` arguments the scan passes, not through bare `gh`. The saving is ~28 s, not ~20 s. Keep the bare-`gh` triple as the isolation experiment it is, labelled as such.
4. **Restate the git row as ~63 invocations, ~1.7 s, ~3%.** The direction of the finding is unchanged and gets stronger.
5. **Drop "fork overhead is 5 ms" and "the heaviest single git call is 32 ms."** Neither reproduces, `81 × 5 ms` does not equal 2.4 s, and the surviving sentence — git is 3% of the scan, so leave it alone — needs neither.
6. **Rebase the unattributed row** on the corrected budget: ~13 s of ~55 s, ~25%. The open question survives; its arithmetic does not.
7. Minor: the `App.tsx` path is `packages/board/src/app/App.tsx`. Line 30 and the 4 s value are exact. The comment at `:26-28` notes `/api/fleet` reads a server-refreshed cache and "never runs a scan per request", which qualifies the Board-impact paragraph's "the board re-runs this scan on a 4-second fleet cadence" — the client polls at 4 s, the server refreshes on its own timer. Worth a sentence so the contention story names the right loop.

None of these block the slice. Every one of them is a number a later reader would otherwise act on.

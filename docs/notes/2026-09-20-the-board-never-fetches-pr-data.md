# The host-call overhead is an untruncated budget ledger

**Measured 2026-09-20 and re-measured 2026-09-21** on `quatico/quaweb-website` (Bitbucket, Jenkins, 9 remote branches, 3 open PRs), Plot 2.19.0.

This note was written in German on 2026-09-20 and rewritten on 2026-09-21 after the second measurement **overturned three of its own findings**. The corrections are named below rather than quietly removed, because two of them are errors a reader could repeat.

## The symptom

The board shows `PR data unavailable` and lists seven branches as *"commits, no PR ever opened — abandoned"*. **Three of them have an open PR** (#358, #405, #445). `/api/fleet` reports `prAgeSeconds: null` — no successful PR fetch since the process started.

## The chain works; it is only slow

`plot-host.sh pr-list --state open --rich` returns **complete and correct, exit 0**. Bitbucket, Jenkins and the link between them all stand. The board simply never gets to see the answer before its own timeout.

## The measurement that found the cause

| | |
|---|---|
| raw `bb pr list --state OPEN --json` | 363–426 ms, spread 63 ms — **stable** |
| `plot-host.sh pr-list --state open` | 2567–7241 ms, spread 4674 ms |
| the same call with `PLOT_BUDGET_OFF=1` | **507–1183 ms** |

**One environment switch removes about 80% of the runtime.**

The hint was in the spread. Raw: 63 ms, stable. Through Plot: a factor of 2.8 on an identical call. Stable raw time with unstable total time means the overhead is not computation — computation is reproducible.

### Where it goes

| | |
|---|---|
| `~/.plot/state/budget.tsv` | **17.6 MB, 312589 lines** |
| lines for this one account | 120728, of which **2273 live** — 98.1% dead |
| `budget_rate` over that file | **516 ms** |
| `budget_rate` over a 50-line file | **5 ms** |
| ledger lines written per `pr-list` | 7 |

**Factor 100 on the read, and several reads per call.**

The window does not save it: it filters which lines **count**, not which are **read**. Every line is still parsed. So cost grows with total file size forever, while the answer only ever needs the last hour.

## The rule exists and nothing calls it

`packages/domain/src/rules/budget-record.ts` defines `truncationOwed` and `PRUNE_THRESHOLD = 100`; `ports/budget.ts` declares `truncate()`; `adapters/budget/budget-file.ts` implements it. The design is explicit — *"pruned by the reader that already read it"*, so no lock is needed.

**No production code calls any of it.** `grep` for `truncationOwed` and `readWindow` outside the rule and its tests returns nothing, and `plot-budget.sh` only ever appends (`:187`), exactly as its own header says.

This is the shape CLAUDE.md names: *"Where a rule exists and nothing calls it, that is a defect to report."*

## Three findings from the first pass that are FALSE

Recorded because two of them are mistakes a reader could repeat.

**1 · "The concurrency slot is never taken."** Wrong. `limit=1000` → `bound = 1000 × 4 / 3600` → floored to 1. `prConcurrencyCap: 1` is real and deliberate.

**2 · "`budget_rate` returns `lines: 0` despite 2241 matching lines."** A **zsh** artifact. `plot-budget.sh` is bash; sourced into zsh, `budget_now_ms` fails with `command not found: date`, `now` is empty, and every line falls outside the window. In bash the same file answers `lines: 119937, limit: 1000, basis: predicted`. **Source Plot's shell helpers in bash.**

**And `lines` is not what it looks like.** It counts lines MATCHING the connector and account, not lines inside the window — `spent` is the windowed figure. This note first read it as a window count and said so; the live split is 2273 of 120728.

**3 · "The page size is known but unused."** Overtaken by #954 (2026-09-20), which asks Bitbucket per branch; completeness now comes from the sweep's own statement rather than from comparing a row count to a page size.

## What is still true

**`pr: null` is a claim, not a state.** Plot reports `possibly truncated … unprovable` correctly, and the display turns that into *"no PR ever opened — abandoned"*. Not-knowing becomes a false fact. A third state — *not asked* — is already derivable from `prAgeSeconds: null`.

**No rate limit was hit during these measurements** — `bb` answers in 0.4 s, `jen` in 11 ms, exit 0, three correct rows — and the account CAN be pushed into one: a later run under eight concurrent agents drew a `429` from `bb` and `EXIT=6` through `plot-host.sh`, both gone on the next attempt. So the 90 s timeouts are Plot's own overhead rather than a remote refusing, and the headroom is smaller than a single-caller measurement suggests.

## Proposal, by effect

| # | Measure | Effort | Effect |
|---|---|---|---|
| 1 | Call the truncation that already exists | small | 516 ms → ~5 ms per read |
| 2 | Third state instead of `pr: null` | small | no more false "abandoned" |
| 3 | Re-measure, then decide on a PR cache | — | 1 and 2 may remove the need |

**A cache was the obvious answer before this measurement and is now the third question.** It would move the wait out of the display path without removing it; truncation removes it. Measure again after 1 and 2 before designing an index.

## Environment

- Plot 2.19.0 (`2d9ef409`), `bb` 1.9.0, `jen` against `jenkins-ci-apps.internal.quatico.dev`
- Repo: 9 remote branches, 3 open PRs, 126 plans
- Board: `board-server.mjs` on port 7801, working directory `quaweb-website`
- All times measured with `date +%s%N` around the call, stdout to `/dev/null`

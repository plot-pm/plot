# Scan performance samples

`scan-sample.sh` records one fleet-scan run against the estate that produced it,
appending a row to `scan-samples.tsv`. Run it whenever the estate changes — after
a reap, after deleting branches, after a batch of dispatches — so the series
answers *what actually drives the 90 s timeout* from data rather than from one
lucky run.

    .plot/measure/scan-sample.sh              # online
    .plot/measure/scan-sample.sh --offline    # host excluded

## Why it exists

Four ad-hoc timings on 2026-08-27 produced a contradiction:

| worktrees | branches | real |
|---|---|---|
| 54 | 43 | 462.9 s |
| 42 | 43 | 51.3 s |
| 11 | 43 | 218.5 s |
| 11 | 34 | 111.5 s |

Worktree count does not order those runs — 11 was slower than 42 — and the 51.3 s
outlier was read as *reaping fixed the timeout*, which three later points refute.
Two separate plans carry corrections written from single measurements that a
series would have prevented.

## What each column is for

- **real vs cpu_pct** — the one that settles *waiting* against *working*. A run at
  11 % CPU is blocked on something; one at 87 % is computing. The 778-process-spawn
  theory was built on a low-CPU reading and needs the high ones beside it.
- **offline** — the host's share, by subtraction. Measured twice with opposite
  results (≈1 s once, 16.2 s later), which is itself the finding: the host cost
  is variable, so a single reading cannot price it.
- **worktrees / branches / plans** — the three estate sizes, recorded BEFORE the
  run so a scan that times out still yields a row.

## Two properties worth keeping

**It scans from a detached worktree on `origin/main`**, never from the caller's
branch. Running the scan from a branch 380 commits behind produced a wrong
conclusion about #470 earlier the same day.

**It measures the estate before running**, so the slowest samples — the ones most
worth having — are not the ones that go missing.

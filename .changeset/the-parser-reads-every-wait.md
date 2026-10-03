---
'plot': patch
'@plot-pm/board': patch
---

`plot-plan-meta.sh` reads every `<!-- waits: … -->` marker on a branch line, and every comma-separated name inside one, instead of keeping only the last — so a slice naming two prerequisites no longer reads eligible while the first has not merged. `waits_on` is now a list in the plan's order, duplicates removed; a marker whose value cannot be read as a branch is reported in a new `unread_waits[]` field rather than dropped. A marker inside a code span is quoted text and is read nowhere.

Measured on `main`: two Draft plans in this sprint each declared a slice with two `<!-- waits: … -->` comments on one heading, and the parser's greedy read kept only the second, reporting `waits_on` as a single string. `the-parser-reads-every-wait` is the second of two slices — the first (`every-wait-reaches-the-verdict`, #1253) taught every domain and board reader to take a list; this one teaches the producers. The fleet scan's shim joins the list into its tab-separated column and the payload emits `waits_on` as an array; `waits_pairs` in `plot-dispatch.sh` now refuses a branch by the first unmerged prerequisite it names rather than matching only a single-string shape (a pattern an unmigrated dispatch would have silently read as "waits on nothing"); `branchOf` in `plan-store-shell.ts` accepts both the new list and a legacy single-name string, so a plan blob written by an older parser still maps.

Reconcile gains a new advisory section, `unread_waits=`, beside `unread_headings=`: a `waits:` marker on a branch's own line whose value does not look like a branch is named, while the same marker written as prose on a line with no branch claim stays silent, as it always has. Section 18 (`stated_waits=`) is unchanged — it already counts a two-marker line as annotated.

<!--
plan: docs/plans/2026-10-02-a-slice-waits-on-every-branch-it-names.md
bumps:
  skills:
    plot: patch
-->

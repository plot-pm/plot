# Delivery is measured from the plan files

> `plot-ask.mjs metrics` prints, per week, the merged pull requests, the plans approved, delivered and released, and the median lead time from approval to delivery, read from git and the PR index with no host call.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-ask.mjs metrics [--weeks N]` prints one row per ISO week: merged pull requests, plans approved, delivered and released, and the median days from `Approved:` to `Delivered:` for the plans delivered that week. The default is the last 8 weeks. It reads the plan files on the default branch and the PR index, and it calls no host.

<!-- Board impact: none in this plan. A board view of the same rows is a later plan. -->

## Motivation

Plot cannot say whether it delivers faster. The research dossier of 2026-11-20 (`gap-delivery-metrics`) found no lead-time or rework metric in Plot's source, while 9 of the 10 company factories it read give merged pull requests as their volume figure. The operator wants to hand the software-development part of the home automation to Plot instead of building more infrastructure, and that decision needs a measure of what Plot delivers.

The data is already recorded and needs no new write:

- Every plan carries dated transition lines: `- **Approved:** <date>, <who>, <channel>`, one `- **Started:**` line per slice, `- **Delivered:**` and `- **Released:**`. The dossier counted 708 `Approved:` lines.
- The PR index (`.plot/state/index/github.json` under the common git dir) holds each merged PR's `mergedAt`, written by fleetd's PR pass. *A Decision Reads The Index* in `CLAUDE.md` allows a reader to take its MERGED rows.

## Design

### Approach

- **A domain rule computes the rows.** `deliveryMetrics(plans, mergedPrs, weeks)` takes the parsed transition lines and the merged rows as values and returns one row per ISO week. The entry reads the plan files and the index and passes them in. The rule awaits nothing.
- **Lead time is approval to delivery.** A plan with an `Approved:` and a `Delivered:` line counts in the week of its delivery. A plan with a `Design:` line also reports design to approval, in its own column. Medians, not means: one plan that waited a month must not move the figure.
- **Merged PRs count from the index.** A missing or old-version index prints `merged: unread`, never 0: the index never says no.
- **Who approved is reported, not judged.** One column counts approvals per approver. The dossier found 660 of 708 approvals by one person, and the hand-off to a second operator should show in this column.

### Open Questions

- [ ] `[question-rework]` Is a correction (a `PLOT-CORRECTION` hand-back) or a fixer attempt the rework measure? Both are recorded per slice today; neither is in this plan's rows.
- [ ] `[question-agent-share]` Does a column separate PRs merged by the Merger app from PRs merged by a person? The index holds the merger's login where the host gave it.
- [ ] `[question-baseline]` Which past weeks serve as the baseline before the hand-off? The record goes back to the first plan file.

## Slices

### Metrics

- `feature/delivery-is-measured-from-the-plan-files` — `deliveryMetrics` over the plans' transition lines and the PR index's merged rows, and `plot-ask.mjs metrics [--weeks N]` that prints its rows <!-- builds: deliveryMetrics and plot-ask metrics --> <!-- tests: deliveryMetrics — weeks with and without deliveries, a median over an even count, a missing index reads unread; the entry makes no host call -->

## Notes

Created on 2026-11-23 from the research dossier "Plot as a factory" (`gap-delivery-metrics`), for the sprint that prepares the hand-off of the operator's software-development work to Plot.

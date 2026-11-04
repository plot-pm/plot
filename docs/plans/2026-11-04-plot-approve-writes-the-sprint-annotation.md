# /plot-approve writes the sprint annotation onto scope-change log lines that name the slug

> `/plot-approve` is reported to write the sprint annotation `<!-- pr: #N, branch: B -->` onto a `### Scope Changes` log line that names the plan's slug, in addition to the tier item; the sprint annotation belongs on checkbox items under the Must, Should and Could headings only.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2532
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-approve` writes the sprint annotation onto the sprint's tier item and onto no other line, including a `### Scope Changes` log line that names the same slug.

<!-- Board impact: none to the plan format or layout. The approve controller and its bundle may change; `main` rebuilds the bundle after the merge. -->

## Motivation

Issue #2532 reports, for Plot 2.28.0 on `docs/sprints/2026-W43-bb-pr-reads.md`, that approving `bb-pr-merge-match-head` through `POST /api/approve` annotated two lines: the Could item and the scope-change log line `- 2026-10-23: Added [bb-pr-merge-match-head] to Could — …`. The log line follows the documented format `- YYYY-MM-DD: Added [slug] to Must/Should/Could — <reason>`, so every logged scope change would receive an annotation meant for a tier item.

Current `main` already restricts the write. `memberLineIndex` (`packages/domain/src/rules/sprint-membership.ts:125`) returns the first `- [ ] [slug]` line under a `### Must Have`, `### Should Have` or `### Could Have` heading, and `annotateSprintItem` annotates only that line. The reported behaviour therefore has two possible causes, and this plan separates them before it changes code:

1. The bug is fixed on `main` since 2.28.0, and the issue needs a regression test and a close.
2. A writer other than `annotateSprintItem` produced the second annotation, for example a path in `plot-approve.sh`, `plot-sprint-member`, or an older bundle.

## Design

### Approach

Reproduce first. Build the sprint file from the issue (a Could item, then a `### Scope Changes` line naming the same slug) and run it through every path that writes the annotation: `annotateSprintItem`, the `approve` workflow's sprint step, and `plot-approve.mjs`.

- If one path annotates the log line, fix that path to use `memberLineIndex`.
- If none does, add the issue's file as a fixture to the existing sprint-annotation tests so the behaviour is held, and report on the issue that the bug does not reproduce on `main`.

In both outcomes the test names the log line explicitly and asserts it is byte-identical after the write.

### Open Questions

- [ ] Does any writer other than `annotateSprintItem` touch a sprint file on approve?
- [ ] Does a log line that begins `- [ ] [slug]` (a checkbox in `## Notes`) stay unannotated? `memberLineIndex` ends tier scope at the next `##` or `###` heading, so it should.

## Slices

### Reproduce and hold

- `bug/plot-approve-writes-the-sprint-annotation` — reproduce the issue's sprint file against every annotation writer, fix a writer that touches the log line, and add a regression test with the log line as a fixture

## Notes

- Source: tracker issue #2532, https://github.com/plot-pm/plot/issues/2532. Nothing was written to the tracker.

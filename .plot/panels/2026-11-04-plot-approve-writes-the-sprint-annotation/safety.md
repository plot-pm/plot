# Safety juror: plot-approve-writes-the-sprint-annotation

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Findings

1. The cause is already known, so the plan's two-way fork is not open. On `v2.28.0`, `packages/domain/src/rules/sprint-annotation.ts:39` matched with `line.includes(needle)`, so every line that names `[slug]` got the annotation. Commit `0ef7e8a2b` (2026-11-01, "plot-approve, plot-deliver: find the sprint by rule, not by directory scan", first in `plot-approve@2.10.0`) switched to `memberLineIndex`. The board's approve entry on main calls `annotateSprintItem` (`packages/board/src/server/entry/approve.ts:659`, `:754`), which now writes the tier line only. Hypothesis 1 holds for the board path.

2. A second substring writer remains on main, and the plan does not name it. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:221`) skips a line only when `!line.includes(marker)` (`:230`). So it annotates every line that names `[slug]`, including a `### Scope Changes` log line and a `### Deferred` line. With `tick: true` it also rewrites the first `[ ]` to `[x]` on each such line (`:231`). The `sprint-annotation` Write from `workflows/approve.ts:386` (tick false) and `workflows/deliver.ts:245` (tick true) reaches it through `performDecision` (`adapters/performer/perform-fs.ts:164`). `git grep performDecision` on origin/main finds no production caller outside tests, so today this is a latent defect in the sandbox tier. It becomes a live one the day a controller performs the workflow's writes. The deliver arm is the larger risk: it can tick a `- [ ] [slug]` line under `### Deferred`, and a ticked box is what sprint scoring reads as delivered (misreport).

3. The test the plan asks for exists in part. `packages/domain/test/rules-sprint-annotation.test.ts:72` covers a log line with no tier member, which gives `missing`. It does not cover the issue's shape: a Could member line first, then a log line that names the same slug, where the log line must stay byte-identical while the member line is annotated.

4. The "if none reproduces" branch tells the agent to "report on the issue that the bug does not reproduce on main". That is a tracker write by an unattended agent, and its content would be wrong: the bug did reproduce on 2.28.0 and was fixed by `0ef7e8a2b`. The plan's Notes say "Nothing was written to the tracker", which conflicts with this step.

5. The missing-member case is safe. `annotateSprintItem` returns the named outcome `missing` and writes nothing, and the board reports it as `sprint: missing`. A `withSprintAnnotation` changed to `memberLineIndex` must return `wrote: false` for the same case and must not fall back to a substring match.

6. Plan claims checked: `memberLineIndex` is at `sprint-membership.ts:125` (true). `ANY_HEADING` ends tier scope at `##` and `###` headings, so a `- [ ] [slug]` checkbox under `## Notes` stays unmatched (Open Question 2: yes, by reading).

## Required amendments

- A1. Name `withSprintAnnotation` (`rendering.ts:221`) as the remaining writer. Make it find its line through `memberLineIndex`, or delegate to `annotateSprintItem` and `tickSprintItem`. It must change no other line, and it must return `wrote: false` when no member line exists.
- A2. Add tests on the issue's shape for `annotateSprintItem` and `withSprintAnnotation`, both with tick false and with tick true. Use a Could member line, then a `### Scope Changes` line, and add a `### Deferred` `- [ ] [slug]` line. Assert that every non-member line is byte-identical and that the Deferred box stays `[ ]`. Each `withSprintAnnotation` test fails on main today.
- A3. Replace the "report on the issue" branch: the slice writes nothing to the tracker. The PR body cites `0ef7e8a2b` as the board-path fix, and the issue closes through the normal delivery link.
- A4. Remove the hypothesis "a path in plot-approve shell or an older bundle" as an open branch, or state the measurement that settles it: v2.28.0's `includes(needle)` is enough to explain the report.

## Decisions for a person

None. Hiding the second writer behind a test-only caller is not a reason to defer the fix: the change is small and reversible.

## Ran versus read

Ran (read-only): `gh issue view 2532`; `git show` and `git grep` over `origin/main` and `v2.28.0` for `sprint-membership.ts`, `sprint-annotation.ts`, `rendering.ts`, `perform-fs.ts`, `workflows/approve.ts`, `workflows/deliver.ts`, `board/.../entry/approve.ts`, `sprint-tick.ts`, `transitions/sprint-member.ts`, and the domain tests; `git log` and `git tag --contains` for `0ef7e8a2b`. Read only: the code paths above. No test was run, so the claim that the A2 tests fail on main comes from reading `rendering.ts:230-231` and was not executed.

# Panel moderation: plot-approve-writes-the-sprint-annotation

Round 1. Four jurors: layering, safety, testability, seams. Positions: amend, amend, amend, amend. Every verdict file names a position, so the gate refused none.

## Agreement

- All four found the cause in git: at `v2.28.0`, `annotateSprintItem` matched `line.includes('[slug]')` on every line, and `0ef7e8a2b` (2026-11-01, first in v2.30.0) moved it to `memberLineIndex`. The moderator confirmed that the every-line body is unchanged at `0ef7e8a2b^` (`git show 0ef7e8a2b^:packages/domain/src/rules/sprint-annotation.ts`, the `lines.map` over `includes(needle)`), so a regression test on the issue's shape fails there.
- All four found that `rules-sprint-annotation.test.ts:72` covers a log line with no member line (`missing`) and not the issue's shape (member line first, log line after, byte-identity on an `updated` write).
- All four asked for the "reproduce first" fork to become a citation.

## Disagreements

1. **Scope of the fix.** Layering (A2) asked for a test-only slice in `rules-sprint-annotation.test.ts` and did not name `withSprintAnnotation`. Safety, testability and seams named `withSprintAnnotation` (`rendering.ts:221`, substring match at `:230`, tick at `:231`) as a second tier-unaware writer and asked to route it through `memberLineIndex`. The moderator confirmed the code on origin/main. Layering's lens did not reach it because the function lives in `workflows/rendering.ts`, not under `rules/`, and has no board caller. Resolved by the caller: fix `withSprintAnnotation`.
2. **Delegate or share the rule.** Safety (A1) allowed delegation to `annotateSprintItem` and `tickSprintItem`; seams (A2) asked for `memberLineIndex` with no write on `-1`. Resolved by the caller: `memberLineIndex`. The plan states why delegation is not used (non-null `pr`, different outcome shape).
3. **How live the defect is.** Safety called it latent and rated the deliver tick as a misreport risk. Testability called it real for the sandbox tier. Seams called it two implementations of one write with no pairing test. These are three readings of one fact: `git grep perform-fs origin/main -- packages/*/src` finds no production importer. The plan states that fact and does not rate it.
4. **Which extra lines the fixture holds.** Layering and seams named a `## Notes` checkbox; safety named a `### Deferred` checkbox; testability named a `## Notes` case for both writers. Resolved by the caller: a `### Scope Changes` line under `## Notes`, plus a `### Deferred` line. A `### Deferred` `- [ ] [slug]` line is the stronger case, because deliver's tick would turn it into a scored box.
5. **The tracker.** Safety (A3) said the slice writes nothing to the tracker. Testability and seams left the issue's closing words to a person. Resolved by the caller: no tracker step. The moderator chose `Fixes #2532` in the PR body, so the issue closes on merge through the normal delivery link.
6. **`pr: #0`.** Layering and testability raised it; safety and seams did not. The moderator confirmed it on origin/main (`entry/approve.ts:902`, `:931`, `:1098`, `:754`) and filed it as #3140, out of scope.

## Shared blind spots

- No juror ran a test. Every "fails on main" claim for `withSprintAnnotation` is read from `rendering.ts:230-231`. The plan names the failing tests so the implementing agent observes the red before the fix.
- No juror checked the existing `rendering.test.ts:180-288` cases beyond testability, who saw that they pass bare lines with no tier heading and turn red after the fix. The plan names that red as expected and prescribes the `### Must Have` wrap.
- No juror named the changeset. The plan names one (`'plot': patch`, plan line, `plot-deliver: patch` bump).
- Seams alone checked PR #3112. The other three did not look for overlapping open work.

## Ran versus read

| Juror | Ran | Read only |
|---|---|---|
| layering | `git show` at `v2.28.0` and origin/main, `git grep` for writers in `packages/*/src` and `skills/**/*.sh`, `git log -S`, `git tag --contains`, `gh issue view 2532` | `rules-sprint-annotation.test.ts:60-100` |
| safety | `gh issue view 2532`, `git show` and `git grep` over origin/main and `v2.28.0` for the rules, workflows, performer and board entry | the code paths; no test |
| testability | `gh issue view 2532`, `git show` of origin/main and `v2.28.0` for rules, workflows, performer and both test files, `git grep`, `git log -S`, `git tag --contains` | no test; fail-before read from source |
| seams | `git grep`, `git show`, `git log`, `gh pr list`, `gh pr diff 3112`, `gh pr view 3112`, `gh issue view 2532` | rendering, workflows, perform-fs, entry/approve, corpus headers, `docs/shell-and-domain.md`; no test |
| moderator | `git show 0ef7e8a2b^` and origin/main for `sprint-annotation.ts`, `rendering.ts`, `sprint-membership.ts`, `perform-fs.ts`, workflows, `entry/approve.ts`; `git grep` for importers of `perform-fs` and callers of `withSprintAnnotation`; `gh pr view 3112`, `gh pr diff 3112 --name-only` | no test |

## Decisions

| Decision | By |
|---|---|
| Cite v2.28.0's `includes` match and `0ef7e8a2b`; drop "reproduce first", `plot-approve.sh`, `plot-sprint-member` and the tracker report | caller |
| Route `withSprintAnnotation` through `memberLineIndex`; one rule, no undeclared duplicate | caller |
| Tests: `withSprintAnnotation` red test, `annotateSprintItem` regression hold shown red at `0ef7e8a2b^`, deliver tick leaves Notes and Deferred boxes, wrap `rendering.test.ts` fixtures in `### Must Have` | caller |
| `waits: bug/plot-approve-reads-the-plan-from` on the slice, because PR #3112 is OPEN | caller |
| Close both Open Questions | caller |
| `withSprintAnnotation` returns `wrote: false` on `-1` and never falls back to a substring match (fail closed) | moderator |
| A third `withSprintAnnotation` test: slug only under `### Scope Changes` gives `wrote: false` | moderator |
| The slice changes no caller and no board file; a later failure is fixed in the domain only | moderator |
| Changeset `'plot': patch` with the plan line and a `plot-deliver: patch` bump | moderator |
| `Fixes #2532` in the PR body | moderator |
| Keep the wave heading `Reproduce and hold` unchanged, as the brief requires; the branch line carries the new scope | moderator |
| File `pr: #0` as #3140 | moderator |

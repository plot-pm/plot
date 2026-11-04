# Layering juror — plot-approve-writes-the-sprint-annotation

Position: amend

## Findings

1. The plan keeps the rule in the domain. The only writers of the `<!-- pr: #N, branch: B -->` annotation on origin/main are `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts:29`), called from the approve controller (`packages/board/src/server/entry/approve.ts:754`) and from the `sprint-member` transition (`packages/domain/src/transitions/sprint-member.ts:229`). No shell script writes it: `git grep "pr: #"` over `skills/**/*.sh` finds only a format comment in `plot-review-status.sh:21`, which reads the annotation. The plan's fix direction ("use `memberLineIndex`") stays controller → domain, and the plan adds no shell. The shell-lines ratchet is not touched.
2. Cause 1 is already proven by git, so the "reproduce first" step can be replaced by a citation. At `v2.28.0`, `annotateSprintItem` matched `line.includes("[slug]")` on every line of the file (`git show v2.28.0:packages/domain/src/rules/sprint-annotation.ts`, the `lines.map` body). That is exactly the reported double write. Commit `0ef7e8a2b` (2026-11-01, first tag `v2.30.0`) changed it to `memberLineIndex` (`sprint-membership.ts:125`), which scopes the match to `### Must/Should/Could Have` and ends scope at any `##`/`###` heading. The plan's Motivation states the current behaviour correctly but does not name this commit, so an unattended agent may spend its slice re-deriving it.
3. A regression test already exists for one ordering: `packages/domain/test/rules-sprint-annotation.test.ts:72` ("never on a log line naming the slug elsewhere") puts the `### Scope Changes` line BEFORE the tier and asserts `missing`. The issue's file puts the tier item first and the log line after, and no test asserts the log line is byte-identical after an `updated` write. That is the one test gap, and it is a domain unit test.
4. The plan names `plot-approve.sh` and `plot-approve.mjs` as paths to run the repro through. Both reach the same controller → `annotateSprintItem`; running a bundle or the shell in a repro is a test-of-the-adapter, not a new writer. It is harmless, but it invites a Sonnet agent to write a shell-level test for a domain rule, which the layering rule says belongs in `packages/domain/test/`.
5. The issue shows `pr: #0` on an in-session approve. That is a second, separate observation (an approval with no plan PR records PR 0). The plan does not mention it. It is out of this lens's scope except that, if it is a defect, it is the controller's input and not the rule's.

## Amendments required

- A1. In Motivation, name `0ef7e8a2b` as the commit that moved `annotateSprintItem` to `memberLineIndex`, and state that the reported behaviour is v2.28.0's `line.includes` match. Remove cause 2 or reduce it to "confirmed: no other writer" with the grep above as evidence.
- A2. Make the slice a test-only change in `packages/domain/test/rules-sprint-annotation.test.ts`: the issue's file (tier item first, `### Scope Changes` log line after it, and a `- [ ] [slug]` checkbox under `## Notes`), asserting `outcome: 'updated'` and that every line except the tier item is byte-identical. State that the slice writes no shell and no board-side test.
- A3. Say what the slice does if the test fails: it fixes `annotateSprintItem` or `memberLineIndex` in the domain only, never a caller.
- A4. Either name the `pr: #0` observation as out of scope with a follow-up, or drop it explicitly, so the agent does not chase it.

## Decisions for a person

- Whether `pr: #0` on an in-session approve is a defect worth its own issue.

## Ran versus read

Ran: `git show` of `sprint-annotation.ts` at `v2.28.0` and origin/main, `sprint-membership.ts:110-150`, `approve.ts:740-765`, `sprint-member.ts:215-235`; `git grep` for annotation writers in `packages/*/src` and `skills/**/*.sh`; `git log -S` and `git tag --contains` for `0ef7e8a2b`; `gh issue view 2532`. Read only: the existing tests at `rules-sprint-annotation.test.ts:60-100`. Ran no test suite.

# Panel moderation — 2026-11-04-record-names-no-branch-so-a

Plan PR #3116, issue #3101. Round 1, four jurors. Claims re-checked at origin/main `e54e53815` on 2026-11-04.

## Positions

| Juror | Position |
|---|---|
| layering | amend |
| safety | amend |
| testability | amend |
| seams | amend |

Unanimous `amend`. No juror chose `proceed` or `reject`.

## Shared findings

- All four found the plan's reader inventory incomplete. The plan named `plan-walk-assembly.ts:334` only. Each juror listed the board copies `board.ts:1398` `approvedSpikeOf`, `entry/gate.ts:566` `approvedSpikeOf` and `entry/plangate.ts:55` `spikeBranchOf`. Verified: each composes a non-empty record with `spikeOf`.
- All four asked for the option and the legacy rule to be a person's decision before approval.
- Layering, testability and seams asked that the branch be parsed in the domain and `plot-plan-meta.sh` stay unchanged, so the shell-lines ratchet does not move.
- The cited lines (`eligible.ts:132-134`, `spike.ts:37-41`, `plan.ts:493-494,600-601`, `plan-walk-assembly.ts:334`) hold at `e54e53815`. Safety noted `eligible.ts` is `:132-133`; the plan now says so.

## Disagreements

1. **Whether the queue hands out a moved spike today.** Safety (finding 1) said yes, because plan PR #3095 is merged. Seams (finding 3) said #3105, the implementation, is open. Verified: #3095 is the plan PR; #3105 is OPEN; `queue.ts` and `queue-reading.ts` on main contain zero `spike` lines. Seams is right. The plan states the exposure in two tenses: the scan, board placement, commit gate and dispatch gate today; the queue once #3105 merges.
2. **Whether any plan on main carries a record.** Safety (finding 4) said `2026-10-12-design-work-proves-the-path.md` does. Seams (finding 7) said zero plans do. Verified: `git grep -n '^- \*\*Spike approved' origin/main -- docs/plans` prints nothing; that plan only mentions the record in prose. Seams is right. Both reach the same conclusion: fail-closed costs no plan in this repository.
3. **Option 2 as an extra guard.** Layering called it optional, safety allowed it as defence in depth, seams showed it refuses every `/plot-reslice` of a plan with a record because reslice has no receipt path. The person removed option 2.
4. **Which readers are in scope.** Safety, testability and seams listed `entry/verdicts.ts:96,113`; layering did not. Verified: no script on main writes its spike columns (`plot-fleet-scan.sh` is a 276-line launcher with zero `spike` lines). The plan leaves it unchanged and #3123 files it. Testability alone listed `workflows/implement.ts:61`; verified that no production caller supplies its `spikeBranch`; #3124 files it.
5. **Where the named reasons show.** Safety asked for a reason on board, pulse, dispatch and commit gate. The others asked only for a named word a test can assert. The plan names reasons on the dispatch gate and the commit gate; the card reason is #3122.

## Shared blind spots

- No juror checked how the record is written on a re-approval. `insertStatusRecord` (`plan-record-edit.ts:169-201`) appends a second line where a filled one exists, and the awk parser keeps the first (`plot-plan-meta.sh:1283`). Without a replace, a re-approval writes a record nobody reads. The plan adds `replaceStatusRecord`.
- No juror named what happens to a spike already in flight on an adopting repository. Under fail-closed its commits and dispatch stop until a re-approval. The changelog line now says so.
- Safety raised the `spike-approved` refusal (`plan.ts:533-538`) as a dead end; no other juror did. The plan defines it: refuse only while the record licenses the marked branch.
- No juror noticed that `test/e2e/spike-dispatch.test.mjs:119` keeps passing with a fourth field, because its regex has no end anchor. The plan tightens it.

## What each juror ran versus read

| Juror | Ran (read-only) | Read only |
|---|---|---|
| layering | `git fetch`, `git show` of 9 source files, `git grep`, `gh issue view 3101`, `gh pr view 3095` | the plan, the issue, CLAUDE.md |
| safety | `git fetch`, `git show` of 9 source files, `git grep`, `gh pr view 3095`, `gh issue view 3101` | `fleet.ts:4106`, `draft-placement.ts`, `verdicts.ts` through grep lines |
| testability | `git show`, `git grep`, `gh issue view 3101`, `gh pr view 3095` | the plan, source excerpts; fail-before claims read from source, not measured |
| seams | `gh pr list`, `gh pr view 3095/3105/3112/3115`, `gh pr diff 3105/3112`, `git grep`, `git show` | the plan, source excerpts |

No juror ran a test, a build, the board or the fleet. The moderator ran `git grep`/`git show` at `e54e53815` and `gh pr view`/`gh pr diff` for #3105 and #3112, and no test.

## Decisions

| Decision | By |
|---|---|
| Option 1: the record names the branch; option 2 removed | person (jwloka) |
| One domain rule `licensedSpike(record, slices)` in `rules/spike.ts`, parsed in the domain; awk and `plot-plan-meta.sh` unchanged | person (jwloka) |
| A branchless record (including `2026-11-03`) licenses nothing, with a named reason | person (jwloka) |
| The way out is re-approval through `plot-approve.mjs --spike` / `POST /api/approve {spike:true}`; moved marker, renamed branch and `/plot-reslice` follow it | person (jwloka) |
| Every reader switches to the rule; the three board copies are deleted | person (jwloka), from the panel |
| `spike-approved` refuses only while the record licenses the marked spike; otherwise the approval decides and replaces the line under the same receipt key | moderator — the person required a re-approval path; this is the narrowest change that opens it |
| `replaceStatusRecord` replaces the line instead of appending | moderator — an appended second line is never read |
| Reason words `spike-record-absent`, `-branchless`, `-unparseable`, `spike-none`, `spike-marker-moved`, `spike-branch-renamed`; dispatch refusal `spike-unlicensed` | moderator — named words make each test assert a word, and a plan with no record keeps `state-wrong` |
| The rule reads no phase; each caller keeps its own phase test | moderator — the callers already hold the phase, and a phase argument would duplicate it |
| Card reason, `verdicts.ts` columns, `implement.ts` caller left out; filed #3122, #3123, #3124 | moderator — out of scope, reversible to add later |
| Two slices: rule and writer (waits on #3112), then readers (waits on #3105) | moderator — each slice stays small enough for a Sonnet agent, and slice 1 alone changes no reader's admission |

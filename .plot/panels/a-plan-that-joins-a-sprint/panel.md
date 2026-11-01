# Panel: a-plan-that-joins-a-sprint

Round 1, 2026-11-01. Subject: `docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md` (plan PR #3000, issue #2999). Four jurors, one rubric, lens as the only variable. Line numbers are against `origin/main` 68fde7aa8.

**Reconciliation:** `unanimous amend` (layering, safety, testability, seams).

## What each juror looked at

- **layering:** read `annotateSprint` and `tickSprint`, `itemsFrom`, `slugOf`, the `GATES` table, the board's sprint joins and `check-shell-lines.sh`. Ran two scans with the domain's tier reading: 428 slug members over 25 sprint files (335 agree, 77 disagree, 16 name no plan), and 58 plans that name a sprint which does not list them. It was the only juror to name the five existing membership readers and the three sprint-slug cuts.
- **safety:** read approve and deliver, the hook wiring, `plot-sprint-state.sh` and every form of the `Sprint:` line. Ran `measure.py` and `multi.py` with the reconcile regex over the whole file: 446 members, 93 disagreements in 13 files, 27 plans in two sprints. Found that `f57425ec0` ticked the Deferred line of a Closed sprint, and counted 32 of 40 recent sprint-file commits as approve or deliver.
- **testability:** read the plan, `state-gate.test.mjs`, `replay-state-gate.test.mjs` and the domain sprint tests. Ran `measure.mjs` and `reverse.mjs` (446 rows, 77 disagreements in 11 files, 58 reverse). Proposed the four real commits as the disagreement fixture: `b1df72cf1` and `fc06f0678` refused, `ab0ab107b` and `d1c9e7eeb` passed. Found that no mutation tooling exists.
- **seams:** read the board contract comments, the live desks and the open slices of other plans. Ran `count.py` (446 members, 77 disagreements in 11 of 26 files, 36 plans in two sprints, 64 reverse). It was the only juror to measure the cost of the empty field on the Active sprint: the unticked delivered item and the three unannotated Should Have items.

Every juror measured something. All four used the same tree at `origin/main` and different member readers, so their counts differ by reader and not by sample.

## Agreed findings

1. **Approve and deliver do not use the field's value.** `annotateSprint` (`approve.ts:747-771`) and `tickSprint` (`deliver.ts:574-599`) return `none` on an empty field and otherwise act on the first sprint file whose text contains `[slug]`. A decision about membership therefore sits in two controllers, and a plan listed by two sprints is ticked or annotated in the wrong one. (layering, safety, seams; testability through the delivery fixture)
2. **A whole-file or whole-tree gate refuses the existing estate.** Every disagreement sits in a Closed sprint; the Active sprint has 0. A gate that reads a touched sprint file whole refuses approve and deliver commits of unrelated plans. The gate must read only the member lines a commit adds, in open sprints. (all four)
3. **A plan in two sprints is the normal case.** Close moves unfinished Must Haves to Deferred (`SKILL.md:655`) and the next sprint lists them again (`:745`), while `entities/plan.ts:212` says a plan has at most one sprint. One rule must choose. (all four)
4. **The motivation's claim is half right.** `SKILL.md:781` (Scope Change) is a second prose step that asks for the field; no code writes it. Step 6 says "after the Phase line", which no plan has. (all four)
5. **The reverse direction is not covered, and this plan is an example.** It names `delivery-loop`, which does not list it. (all four)
6. **The writer is a domain rule behind a bundle**, not an action on `plot-sprint-state.sh`, which owns the `State:` receipt and is counted by the shell ratchet. (all four)
7. **A Deferred plan keeps the sprint's name** until another sprint adds it. (all four)

## Disagreements

**The counts.** The jurors used three member readers. layering and testability's main count used the domain's tier reading or close to it; safety and seams used a checkbox regex over the whole file. The figures differ: 25 or 26 sprint files, 77 of 412 or 93 of 446 disagreements, 27 or 36 plans in two sprints, 58 or 64 reverse. **Settled by one method** (`itemsFrom`'s reading, stated in the plan's Notes, script `moderator-3000/measure.py` in the session scratchpad): 25 sprint files (the 26th count included the `active/` link or a worktree file); 428 slug members, 16 with no plan, 77 of 412 disagree, in 11 Closed files; 27 plans in two sprint files; 82 plans name a sprint whose member lines do not list them. The reverse count is the one that moves most with the reader: a checkbox regex over the whole file gives 59, because it also reads lines under headings such as `### Also shipped` that `itemsFrom` skips. seams' 36 was not reproduced by any reader tried (the `[slug]` substring gives 33).

**Where the gate runs.** layering, safety and testability want both a commit-time and a CI form over one rule. seams wants commit time only, because a CI check over all sprints fails on the Closed estate. safety warned that a CI form on a push to `main` turns `main` red through `default-branch-red` on the next carried delivery. **Operator's decision:** both forms, diff-scoped, and the CI form on pull requests only, beside `A PR carries no bundle` (`ci.yml:1039-1041`). It never runs on a push to `main`. A replay over 321 commits since 2026-10-01 refuses 19 lines in 13 scope-change commits and no approve or deliver commit.

**Whether the field or the sprint file is the source.** layering's optional O1 treats the field as a cache derived from the rule and nothing decides from it. seams wants the field to name the latest sprint that lists the plan in a non-Deferred tier, and the board comments amended. safety and testability keep the field as a checked value with the sprint file as the truth. **Operator's decision:** the sprint files are the source; one domain rule (`sprintOfPlan`) answers the plan's one sprint, preferring a non-Closed sprint, then the newest; approve and deliver call the rule and stop reading the field; the writer keeps the field equal to the rule's answer, and the gate holds that for added members.

**Whether a plan may name a sprint before it joins.** seams recommended no (remove this plan's `Sprint:` line, and #2998's). layering and testability asked the plan to choose and test it. **Operator's decision:** a Draft or Design plan may name the sprint it is about to join; the reverse case is reported, not refused.

**Where the approve and deliver fix goes.** seams made it optional; layering and safety required it as a slice or a follow-up. **Operator's decision:** its own slice in this plan.

## Points one juror raised

- **layering:** five membership readers exist and the gate must not become a sixth; `plot-reconcile-scan.sh:1688-1690` says "a script writing one would be inventing it", which the writer must reword; the board already joins on the sprint file, so board impact is small.
- **safety:** the writer must handle every form of the `Sprint:` line, scope its write to the first `## Status`, write nothing on refusal, commit only its two paths, and refuse a plan file that is not in the checked-out tree. Approve and deliver commit inside a node process, which no PreToolUse hook sees.
- **testability:** a struck member is read two ways (`MEMBER_LINE` accepts it, the reconcile regex rejects it, `sprint-scope.ts` reads it as out of scope), and the plan must choose; a plan that names a sprint by its file name needs a test; the mutation step must be manual and recorded in the PR body.
- **seams:** the `### Scope Changes` log is also incomplete (2 of 5 later additions have no line); the later slices of `every-plan-reference-shows-its-issue` edit `ci.yml` and `schema.ts`.

## Shared blind spot

No juror read `annotateSprintItem` and `tickSprintItem` themselves. `annotateSprintItem` (`sprint-annotation.ts:27`) annotates every line that contains `[slug]`, including a `### Scope Changes` log line, and `tickSprintItem` (`sprint-tick.ts:33`) ticks the first unchecked line in any section. Fixing which file approve and deliver choose does not fix which line they edit, and the repair of `delivery-loop` would annotate its three Scope Changes lines. The amended plan adds `memberLineIndex` and scopes both functions to the member line.

A second point no juror checked: seams attributed the three unannotated Should Have items to approve's empty-field guard. The commit times show each plan was approved before it joined the sprint (`cbdf00859` and `54d9ffacd` before `b1df72cf1`; `8235c973a` one minute before `fc06f0678`), so approve found no line to annotate whatever the field said. Nothing annotates a plan that joins after approval. The amended plan makes `add` write the annotation the plan's state owes.

## Amendments made to the plan

1. Motivation corrected: two prose steps ask for the field (`SKILL.md:337-344`, `:781`); the measured cases on `delivery-loop` (three missing fields, two missing log lines, the unticked delivered item, the unannotated Should Have items and their real cause); `f57425ec0`; the estate counts by one stated method.
2. `### Approach` written: `sprintOfPlan` and `sprintMembers` in `rules/sprint-membership.ts`; approve and deliver call the rule and drop the empty-field guard; the writer `plot-sprint-member.mjs add|defer|remove` with its field rule per verb, its refusals and its no-partial-write contract; `/plot-sprint` creation, scope change, close and carry-over call it; the gate rule and its two forms; the Draft rule; the board contract; the repair of `delivery-loop`.
3. The three Open Questions answered and ticked, with five decisions recorded under `### Decisions`.
4. Five slices with `waits:`: membership rule; approve and deliver (waits on the rule); writer (waits on the rule); gate (waits on the rule and the writer); repair (waits on approve and deliver and on the writer). The placeholder slice removed.
5. A `## Done when` table maps every Changelog line to a test, including the old-and-new-disagree fixtures (`f57425ec0` for deliver, `b1df72cf1` and `fc06f0678` for the gate) and the manual mutation step.
6. Notes name the measurement method, the seam with `every-plan-reference-shows-its-issue` in `ci.yml` and `schema.ts`, and what stays out of scope.
7. Changelog rewritten to match. `- **Rounds:** 1` added to `## Status`. `State:` and `Sprint:` unchanged.

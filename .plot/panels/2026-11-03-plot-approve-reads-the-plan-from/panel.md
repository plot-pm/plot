# Panel: plot-approve-reads-the-plan-from

Subject: `docs/plans/2026-11-03-plot-approve-reads-the-plan-from.md`, plan PR #3097, issue #3093. Four jurors: layering, safety, seams, testability. Each read `origin/main` at `ee678d5c8`.

## Reconciled position

`unanimous amend`. All four jurors wrote `Position: amend`. No juror wrote `proceed` or `reject`.

## Agreement

All four jurors found the following.

- The defect is real, and the plan's line citations hold on `ee678d5c8`.
- `needs-design.ts` holds its own `planPrOf`, not the domain rule. Approach step 1 said both controllers "ask the same rule", which was false.
- The three open questions are design decisions. An unattended agent cannot build the slice while they stay open.
- The one named board test covers `approve.ts` only. No test covered the domain rule or needs-design.
- Three jurors (layering, seams, testability) named the docs, the `refusalText` case and the changeset as missing. Two (layering, seams) named the overlap with `bug/plot-approve-finds-no-plan-on` and asked for a `waits:` annotation.

## Findings only some jurors made

- **Two shas for one approval** (safety F1 HIGH, layering F3). The record is read at the `pr-list` row's `headSha`; the status and the `--match-head` pin take the `pr-state` answer's `headSha`. A push between the two calls splits them. Seams S1 adds that the `pr-state` sha is a 12-hex short hash on Bitbucket, which git may not hold.
- **The checkout read** (safety F2 HIGH, layering F6, seams S6, testability F1). A plan in the checkout is judged from the working tree, and the approval merges the PR's head. Safety rated it HIGH; seams rated it LOW and proposed to scope it out. Layering also named the `Impl: same branch` arm.
- **The closed idea PR** (testability F4 and its second decision, seams S2). With `idea/<slug>` CLOSED and an open rival, needs-design today writes onto the rival. Moving needs-design to the domain rule changes that choice.
- **A named PR without the plan file** (layering F4, seams). Today it ends in a misleading `plan-not-found` after a reorder.
- **An unheld head** (seams, layering F3). `readPlanAt` returns undefined and the workflow says `plan-unparseable`, which names the wrong cause.
- **needs-design writes onto a copy it did not judge** (safety F3). `bookOnPlanPr` fetches `origin/<head>` again at write time.
- **The test fixture** (testability F1, F2; safety amendment 7). The board test must leave the plan out of the checkout's plan store, and `planStoreFixture.readPlan` cannot parse a copy read from a revision without a wrapper.
- **The spike route** (safety F7, testability). `approveSpike` has its own `pr-ambiguous` arm.
- **Rival detection limits** (safety F5). The listing cap of 100, fork PRs and unresolvable heads hide a rival.
- **`endsWith` in needs-design** (layering F2). The suffix match that `namesPlan` rejects.
- **The sprint line** (seams S7). `docs/sprints/2026-W45-follow-ups-2-30-1.md` holds no line for this slug.

## Disagreement

The jurors split on a rival open PR beside `idea/<slug>`.

- Seams: allow every rival. After the reorder the gating record is the merged copy, so the listing order plays no part. A warning at most.
- Safety and layering: refuse. Layering proposed to reuse `pr-ambiguous` for every rival; safety proposed to compare blob IDs and allow an equal copy, with a person to decide.
- Testability: named it a decision for a person, together with the definition of "copies differ".

Decision taken: compare the plan file's git blob ID at each head. An equal blob proceeds; a differing blob or path refuses `pr-copies-differ`. On the open route, any rival still refuses `pr-ambiguous`.

## Ran versus read

All four jurors only read. Each ran read-only `git` and `gh` commands to show files and list PRs. No juror ran a test suite or reproduced the race; the findings follow from the code order.

## Shared blind spot

No juror ran the proposed board test on `main`, so the claim that it fails there rests on reading the fixtures. No juror checked whether the sibling slice had been pushed; at moderation `origin/bug/plot-approve-finds-no-plan-on` held only its claim commit.

## Operator decisions

1. Reorder. `planPrOf` names the PR, the plan file and the head sha to read; `PlanPrFound` carries them. One sha is the read target, the approval status and the `--match-head` pin, from one host answer. The head is fetched before the read; a head git does not hold refuses by name.
2. Rivals. The named route lists the open PRs that change the plan file. An equal blob proceeds; a differing blob or path refuses `pr-copies-differ` in both controllers, before any host write. The plan states the limit of rival detection.
3. A named `idea/<slug>` PR whose head does not change the plan file refuses by name (`pr-carries-no-plan`).
4. A plan in the checkout is read at the pinned head; a differing checkout copy refuses (`checkout-copy-differs`) and writes nothing. The same-branch arm and the spike route use the same rule.
5. needs-design deletes its board-local `planPrOf`, calls the domain rule, gains `pr-copies-differ`, uses `namesPlan`, and shares the head-read function in `open-prs.ts`. The change of PR choice for a CLOSED `idea/<slug>` is intended.
6. The slice waits on `bug/plot-approve-finds-no-plan-on`.
7. Tests in `approve.test.ts` with an empty plan store and a wrapped `readPlan`, in the domain at 100% coverage, and for needs-design.
8. Docs in `skills/plot-approve/SKILL.md` and `skills/plot/scripts/README.md`, the refusal messages, and a changeset.
9. One slice, one branch: `bug/plot-approve-reads-the-plan-from`.

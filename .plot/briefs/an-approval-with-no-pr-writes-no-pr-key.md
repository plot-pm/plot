## Implementation brief — board-readings-take-the-domain-answer (wave 1: Sprint annotation)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/an-approval-with-no-pr-writes-no-pr-key` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

This is slice 1 of 7 and closes #3140. No slice names a `waits:`; the fleet starts slices in heading order, so waves 2 to 7 start after this one merges. This slice touches `packages/domain` and `packages/board/src/server/entry/approve.ts`; no other slice owns those lines.

### What to build

An in-session approval, and an approval whose host read was refused, record `pr: #0` in the sprint item's annotation. Issue #2532 shows `<!-- pr: #0, branch: feature/bb-pr-merge-match-head -->`. `docs/sprints/2026-W41-the-release-train-fixes-what-it-found.md:27-42` holds 9 such lines. `skills/plot-sprint/SKILL.md:285` documents the key as *"PR number (`#N`) or `none`"*, so `#0` names a PR that does not exist.

The cause: `annotateSprintItem` (`packages/domain/src/rules/sprint-annotation.ts`) takes `pr: number` and always writes the key. `approve.ts` starts `pr` as `{ number: 0, state: 'NONE', draft: false }` (`:336` in the PR reader, `:891`), sets `number: 0` on the host-refused arm (`:1005`), and passes `pr.number` into the write request (`:1190`, `:1228`), which hands it to `annotateSprintItem` (`:720`).

Build, in this order:

1. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts`, with `annotationBody` and `annotateExisting` below it) takes `pr: number | 'none' | null`. `null` keeps today's meaning: write no key and leave an existing one (`perform-fs.ts:166` still passes it). A number writes `pr: #n` as today. `'none'` writes `pr: none`. On a line whose key reads `pr: #0`, `'none'` rewrites it to `pr: none`. On a line whose key names a real PR (`pr: #12`), `'none'` keeps it.
2. `annotateSprintItem` stops editing the line itself. It finds the member line with `memberLineIndex`, answers `missing` where there is none, and otherwise calls `withSprintAnnotation(content, slug, false, pr ?? 'none', branch)`, mapping `wrote` to `updated` or `already`. It takes `pr: number | null`; `null` passes `'none'`. One line-editing implementation remains in the domain.
3. `approve.ts` passes `null` where no plan PR was read: the in-session arm (`:891`) and the host-refused arm (`:1005`). The write request's `prNumber` (`:534`, `:1190`, and the `bookApproval` argument at `:1323`) becomes `number | null`. The texts that print `#${pr.number}` are reached only on the PR arm and keep `number`. Make the `PlanPr` shape carry the absence in a way the type checker enforces; do not leave `number: 0` as a sentinel that a later reader treats as a PR.

The plan's `### Approach › Slice 1` is canonical; this is orientation.

### Settled decisions — do not re-derive them

**`null` on `withSprintAnnotation` does not become `'none'`.** `perform-fs.ts:166` passes `null` to mean "record nothing, leave what is there". Re-pointing `null` at `pr: none` makes every sprint-note write stamp a key it never meant to. `'none'` is a new, separate value; `annotateSprintItem` is the one place that maps its own `null` to it.

**`'none'` never overwrites a real PR.** An approval with no plan PR (a second approval run, or a host that refused once) must not unmake `pr: #12`. Only `pr: #0` and a missing key change. Without the `#12` test a naive "write `pr: none` always" passes every other cell.

**`transitions/sprint-member.ts:230` keeps its output.** `withOwedAnnotation` passes a non-null PR from `planApprovedPr`; routing it through `withSprintAnnotation` must not change one byte of a line it already wrote. The agreement cell below is what proves it.

**The two implementations differ today, and delegation picks one.** `annotateSprintItem` matches the PR key with `/pr:[ \t]*#?[0-9a-zA-Z]+/` (upper case allowed); `annotateExisting` uses `[0-9a-z]+`. Its branch rewrite also differs (`annotateExisting` guards against eating the `--` of `-->`, see the comment at `rendering.ts` above the branch pattern; `annotateSprintItem` splits off the closing `-->` first). Run the existing `rules-sprint-annotation.test.ts` cells first: they pin `pr: none, status: draft, branch: none` (`:29`), an unterminated comment (`:66`) and an absent branch (`:103`). Where the delegated path disagrees with a cell, fix `withSprintAnnotation`; do not edit the cell. Report a real behaviour difference in the PR rather than hiding it.

**The closed sprint file stays as it is.** Slice 1 rewrites `pr: #0` only when an approval with no plan PR runs on that line again. Do not edit `docs/sprints/2026-W41-…md`; it records history.

**Absent is not false.** `null` in `prNumber` means "no plan PR was read", not "the plan has no PR". Nothing downstream may read it as a refusal.

### Done when

The plan's `## Slices` line for this branch is the specification: `annotateSprintItem` delegates to `withSprintAnnotation`, which gains `'none'`; an approval with no plan PR writes `pr: none` and rewrites `pr: #0`; the unit, agreement and approve tests.

Tests, from the plan:

- `packages/domain/test/rules-sprint-annotation.test.ts`: `null` on a bare line writes `<!-- pr: none, branch: x -->`; `null` on a line with `pr: #0` writes `pr: none`; `null` on a line with `pr: #12` keeps `#12` (catches the always-overwrite shortcut); a number still writes `pr: #n`; a missing member line answers `missing`.
- One agreement cell runs `annotateSprintItem` and `withSprintAnnotation` over the same fixture lines and asserts the same text (catches the two implementations drifting again).
- `packages/board/test/unit/approve.test.ts`: the harness at `:191-233` asserts `pr: #42` today. Add an in-session approval of a sprint member that writes `pr: none`. Without it the `approve.ts` change has no test and the `#0` path can return.

Plus: a changeset for `@plot-pm/board` (description first, `bumps:` block last; the changeset gate refuses a bare comment-open first line and a description under 20 characters; if `packages/domain` is its own changeset package, name it too). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally, and do not run board tests while the operator's board is open. Commit no board bundle: `scripts/check-no-bundle-diff.sh` refuses one. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge.

New functions in these files are arrows; leave the surrounding declarations alone. TSDoc says what the export does, its parameters, its return and its failures, with no history.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

You own `packages/domain/src/rules/sprint-annotation.ts`, the `withSprintAnnotation` family in `packages/domain/src/workflows/rendering.ts`, the `prNumber` and `PlanPr` paths in `packages/board/src/server/entry/approve.ts`, the two test files above, and one changeset. Callers to check, not to redesign: `transitions/sprint-member.ts:230`, `perform-fs.ts:166`. The other six slices of this plan are not started and touch `fleet.ts`, `delivery-readings.ts`, the spike rules, `verdicts.ts`, `classifier-is-total.test.ts` and `escalation.ts`; none shares a file with this branch, verified by the plan's slice lines. If you find something the plan did not anticipate, report it rather than improvising outside scope.

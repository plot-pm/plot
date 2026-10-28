## Implementation brief — deliver-passes-a-plan-whose-slices (wave 1: Unread item records)

- **Plan (canonical):** docs/plans/2026-10-28-deliver-passes-a-plan-whose-slices.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2827 merged
- **Branch:** `bug/deliver-reads-unread-branch-items` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR review per repo convention

This wave blocks wave 2 (`bug/deliver-refuses-unread-branch-items`), which reads the field this wave adds. Waves 3 and 4 follow in order.

### What to build

Plan 3853 in ewz-kus-portal names six foreign-repository branches in list items the parser does not read, and `plot-deliver.sh --dry-run` still reported `verified 1 branch(es) merged` and would deliver. Plan 3819 has `` - Umsetzung: `bug/…` `` and parses zero branches. This wave makes the parser report such items and carries the report to every record that reads the parser. It does not make delivery refuse; wave 2 does.

- `plot-plan-meta.sh` emits `unread_branch_items` as `{ wave, branch, line }` per item, beside `unread_heading_items` (`plot-plan-meta.sh:780`). Extend the empty-file JSON at `:340` too.
- Carry the field through `PlanMetaSchema` (`packages/board/src/contract/schema.ts:64`), `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) via `planOf` (`plan-store-shell.ts:137`), and the pulse plan (`PlanSchema`, `packages/domain/src/entities/fleet.ts:695`) via `plot-fleet-scan.sh`. Carry it; do not add it to `KNOWN_UNCARRIED` in `plan-store.corpus.test.ts`.
- `plot-reconcile-scan.sh` gets section 24c with counter `unread_branch_items=`, reusing `report_unread_pairs` (`:297`). Each finding names plan, line and branch token, prints the rewrite (a claim line `` - `<branch>` — <repo>: … → owner/repo#N ``, or `<!-- deferred: <reason> -->`), and states that delivery refuses until the line changes. Update `skills/plot-reconcile/SKILL.md`: 24c blocks delivery, unlike 24, 24a and 24b.

### Settled decisions — do not re-derive

- **Detector rule:** a list item in `## Slices`, `## Branches` or `## Waves`, outside fences, that is not a claim line and holds a token with a configured `Branch prefixes` entry, inside or outside a code span (the 3819 line needs code spans scanned). Use the parser's existing `PREFIXES` (`:372,424`). Exclude `idea/`, names containing `*`, and file paths (a `.` after the prefix, such as `docs/plans/x.md`). No keyword: German, French and English lines must read alike.
- **Deferred marker:** `<!-- deferred: … -->` on the item excludes it. Read the marker before comments are masked; today `deferred:` is read only on claim lines (`keep_branch`, `:987`).
- **Rejected: a keyword or prose heuristic.** The panel measured the token rule at 6 of 6 branch-naming lines on 3853 and 1–2 borderline hits in 601 plans here, both in `2026-08-20-a-row-is-a-tuple.md` (Released).
- **Known limit:** the `vnull in ewz-kus-contracts` line names no branch and no token rule reports it. A foreign branch with a prefix outside this repository's `Branch prefixes` is also outside the rule. Do not widen the rule to catch them.
- **Not a board badge:** no board code reads `unread_*` today, and none is added in this wave.
- **Open question 1** (a foreign branch with no `→ owner/repo#N` yet) decides what the 3819 test asserts. Assert whichever answer you implement, explicitly, and report it.
- The `owner/repo@branch` form is dropped: `@` means a commit.

### Done when

The plan's tests for slice 1 are the specification:

- `test/reconcile/parser.test.mjs`: the 3853 lines verbatim give 6 items and none for `vnull`; a list-dialect copy gives the same 6; German, French and `siehe` lines give one each; a claim line, a backticked `docs/plans/x.md`, `idea/*` and an `idea/` plan line give none; a deferred item gives none; every plan in `docs/plans` gives the measured count.
- `test/reconcile/scan-unread-branch-items.test.mjs`, modelled on `scan-unread-heading-items.test.mjs`: summary key, printed rewrite, blocking sentence.
- `packages/domain/test/plan-store-shell.test.ts` maps the field; `plan-store.corpus.test.ts` shows it carried.

Plus: add a changeset (description first, `bumps:` last), keep a changeset `plan:` line if you add one below the description. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the CI suites run in CI. Do not run `test:e2e`.

`scripts/check-shell-lines.sh` refuses growth of shipped shell. This wave adds a detector, a pulse field and section 24c in shell, so the PR must remove an equal number of shell lines elsewhere, or write the rule in the domain and ask it through a bundle, and name the removed lines in the PR body. Joining statements with `;` or `&&` is not a payment.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-plan-meta.sh`, `plot-fleet-scan.sh` (field passthrough), `plot-reconcile-scan.sh`, `skills/plot-reconcile/`, the three schema/port/entity files above, and their tests. Not owned: `deliver()`, `deliverabilityOf`, `landed()` (wave 2), `crossRepoReferences`, `plot-impl-status.sh` (wave 3), template and `/plot-idea` docs (wave 4).

If you find something the plan did not anticipate, report it rather than improvising outside scope.

# Deliver passes a plan whose slices in other repositories are written in a shape the parser does not read

> A plan can read as complete while it names work in other repositories that Plot never checked. Delivery must refuse while a slice list item names a branch the parser did not read, and cross-repository references must not collapse when several repositories share one branch name.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2826
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2827 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/deliver-reads-unread-branch-items`
- **Started:** 2026-10-28, Jan Wloka, `bug/deliver-refuses-unread-branch-items`
- **Started:** 2026-10-28, Jan Wloka, `bug/a-cross-repo-reference-is-read-per-line`

## Changelog

- `/plot-deliver`, the board's Deliver action, `plot-ask.mjs deliverable` and fleet auto-delivery refuse a plan whose slice section holds a list item that names a branch the parser did not read, and the refusal names each item.
- A `<!-- deferred: <reason> -->` marker on such an item records a person's decision to accept it, and the item no longer blocks delivery.
- `/plot-reconcile` lists each unread branch item with its plan, line and branch, prints the rewrite, and states that the item blocks delivery.
- The board's Testing column no longer offers a plan as deliverable while delivery refuses it for unread branch items.
- A branch name used in several repositories is checked once per repository: delivery asks every `→ owner/repo#N` reference, not only the first.
- Delivery reads the heading form `PR: owner/repo#N` as a cross-repository reference, as `plot-impl-status.sh` already does.
- The plan template, `/plot-idea` and the plot skill document one written form for a slice in another repository.

<!-- Board impact: yes. No board code reads any `unread_*` field today. The new field enters the contract (`PlanMetaSchema`, `packages/board/src/contract/schema.ts:64`), `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) and the pulse plan (`PlanSchema`, `packages/domain/src/entities/fleet.ts:695`). The board shows the domain's refusal as the reason a plan is not deliverable; it adds no badge. The plan format gains no new syntax; the template documents an existing form. -->

## Motivation

**Live case 1: ewz-kus-portal plan 3853.** Plan `2026-10-23-ewzkus-3853-build-identitaet.md` has one slice line Plot reads and seven it does not (ewz-kus-portal `docs/plans/…3853…md`, `## Slices`, the lines after the `infra/ewzkus-3853-build-identitaet` claim). Six of the seven name a branch, all with one name in six repositories: `- **ewz-kus-contracts** (dort eigener Branch infra/EWZKUS-3853-monotonie-waechter) — …`. The seventh, `` **`vnull` in ewz-kus-contracts** ``, names no branch. The plan states that every slice in a foreign repository needs its own branch and PR. None existed, and the `vnull` tag was still present.

- `plot-plan-meta.sh` reads one branch, `prs: [3722]`, and `unread_branch_headings`, `unread_waits` and `unread_heading_items` are all `[]` (four panel jurors ran it). The six lines do not match `branch_claim_re` (`skills/plot/scripts/plot-plan-meta.sh:1062`), which requires a backticked branch at the start of the item.
- `plot-reconcile-scan.sh` listed the plan under *Merged-but-not-delivered*.
- `plot-deliver.sh --dry-run` reported `verified 1 branch(es) merged` and would deliver. That sentence comes from `packages/board/src/server/entry/deliver.ts:437`; `plot-deliver.sh` is a launcher for `board/plot-deliver.mjs`. A board-unit reproduction with no git and no host gives `{"merged":1,"deliverable":true}`.

Only a person reading the plan noticed. The plan was delivered by decision, with a note.

**Live case 2: ewz-kus-portal plan 3819.** Plan `2026-09-09-ewzkus-3819-mandats-whitelist-rechnungsliste.md` is `State: Approved`. Its `## Branches` holds `` - Umsetzung: `bug/ewzkus-3819-mandats-whitelist-rechnungsliste` `` (line 222). The parser reads zero branches, and every `unread_*` field is empty. With zero branches, delivery prints `no branches found in plan — proceeding (nothing to verify)` (`packages/board/src/server/entry/deliver.ts:434-435`).

**Cause 1: the decision lives in the domain, and the domain never sees the items.** The deliver decision is `deliverabilityOf` (`packages/board/src/server/controllers/deliverability.ts:227`), which reads `PlanStore.readPlan` (`:250`) and asks the domain's `deliver()` (`:317`, `packages/domain/src/workflows/deliver.ts:139`). `deliverabilityOf` also serves the board and `plot-ask.mjs deliverable`, and fleet auto-delivery runs the same launcher (`packages/fleet/src/shared/auto-deliver.ts:106`). `/plot-deliver` step 4b (`skills/plot-deliver/SKILL.md:175`) is prose and does not decide. No code under `packages/*/src` reads any `unread_*` field, and `plan-store.corpus.test.ts:84-89` lists the three existing fields in `KNOWN_UNCARRIED`.

**Cause 2: the pulse decides auto-delivery separately.** Auto-delivery starts only when `allSlicesConfirmed` (`packages/domain/src/rules/deliverable.ts:103`) answers `merged` over the pulse (`packages/domain/src/rules/auto-deliver.ts:370`). A refusal that only `deliverabilityOf` knows leaves the slug in `inFlight` until the board restarts, as measured 2026-10-01 (`deliverable.ts:85-91`).

**Cause 3: cross-repository references are keyed by branch name.** The 3853 plan uses one branch name in six repositories. `crossRepoReferences` keeps the first reference per name (`packages/domain/src/rules/cross-repo-reference.ts:51`), `branchesOf` merges by name (`deliverability.ts:70-90`), and `plot-impl-status.sh` takes `sort -u` of names (`skills/plot/scripts/plot-impl-status.sh:118`) and the first annotation (`:142`). Reproduced: with #11 merged and #22, #33 open for one name in three repositories, `deliverabilityOf` asks only #11 and answers `deliverable: true`. `crossRepoReferences` also ignores the heading form `PR: owner/repo#N`, because its pattern requires `→` (`cross-repo-reference.ts:23`), while the shell reads it (`plot-impl-status.sh:151`).

**Cause 4: the documented forms do not cover a foreign branch.** `owner/repo@X` already means a commit in another repository (`skills/plot/SKILL.md:316,323`), and the parser reads `owner/repo@branch` as nothing. `plot-impl-status.sh` resolves `→ owner/repo#N` and `PR: owner/repo#N` (`:141`, `:151`), not `@branch`.

Section 24b of the reconcile scan (`skills/plot/scripts/plot-reconcile-scan.sh:3286-3298`) reports a heading-shape list item naming a branch no heading in its wave claims. It does not read list items that are not in claim form.

## Design

### Approach

**The detector.** An unread branch item is a list item in a slice section (`## Slices`, `## Branches`, `## Waves`, outside fences) that is not a claim line and that holds a token matching a configured `Branch prefixes` entry, inside or outside a code span, so that `` - Umsetzung: `bug/…` `` (3819) counts. The parser uses the same `PREFIXES` it already reads (`plot-plan-meta.sh:372,424`). Tokens with the `idea/` prefix, names containing `*`, and file paths (a `.` after the prefix, such as `docs/plans/x.md`) do not count. The rule uses no keyword, so German, French and English lines read alike. A `<!-- deferred: … -->` marker on the item records a person's accept, and the item does not block. The parser reads the marker before it masks comments; today it reads `deferred:` only on claim lines (`keep_branch`, `plot-plan-meta.sh:987`). The parser emits `{ wave, branch, line }` per item, in the shape of `unread_heading_items`.

Measured by the panel: 6 of 6 branch-naming lines on the 3853 plan; 1–2 borderline hits in this repository's 601 plans, both in `2026-08-20-a-row-is-a-tuple.md` (Released, prose such as "Absorbs bug/…"); 3819 caught by the prefix-only sweep that keeps code spans. The `vnull` line names no branch, and no token rule reports it; this plan states that limit. A foreign branch whose prefix is not in this repository's `Branch prefixes` is also outside the rule.

**Slice 1 — the parser reports, the records carry, the scan lists.**

- `plot-plan-meta.sh` emits `unread_branch_items` beside `unread_branch_headings`, `unread_waits` and `unread_heading_items` (`plot-plan-meta.sh:760-780`).
- The contract carries it: `PlanMetaSchema` (`packages/board/src/contract/schema.ts:64`), `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) through `planOf` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:137`), and the pulse plan (`PlanSchema`, `packages/domain/src/entities/fleet.ts:695`) through `plot-fleet-scan.sh`. The field is carried, not added to `KNOWN_UNCARRIED`, so `plan-store.corpus.test.ts:229` passes without a later move.
- `plot-reconcile-scan.sh` gets section 24c with its own counter `unread_branch_items=`. Each finding names the plan, line and branch token, prints the rewrite (a claim line `` - `<branch>` — <repo>: … → owner/repo#N ``, or `<!-- deferred: <reason> -->`), and states that delivery refuses until the line changes. The section reuses `report_unread_pairs` (`plot-reconcile-scan.sh:297`). `skills/plot-reconcile/SKILL.md` describes 24c as blocking delivery, apart from the non-blocking 24, 24a and 24b. The reconcile finding is the one channel that reaches a repository with its own `Plan template`.
- `scripts/check-shell-lines.sh` refuses any growth of shipped shell. The slice names, in its PR, the shell lines it removes to pay for the detector, the pulse field and section 24c.

**Slice 2 — the domain refuses.**

- `DeliverReadings` (`packages/domain/src/workflows/deliver.ts:38`) gains the unread items, and `DeliverRefusal` (`:9-16`) gains `slices-unread`. `deliver()` refuses with it and names each item and both repairs, also when the plan has zero parsed branches (the 3819 case).
- `deliverabilityOf` passes the items from `PlanRecord` to `deliver()`.
- `landed()` (`packages/domain/src/rules/deliverable.ts:124`) answers `not-merged` for a pulse plan with non-deferred unread items, so `allSlicesConfirmed`, the board's Testing column and auto-delivery agree with `deliver()`.
- Step 4b of `skills/plot-deliver/SKILL.md` reports the domain's refusal and offers no override; its text follows the domain.

**Slice 3 — a cross-repository reference is read per line.**

- `crossRepoReferences` returns every (repository, branch) reference, not the first per name, and reads the heading form `PR: owner/repo#N`.
- `branchesOf` keeps two claims of one name in different repositories apart, and `deliverabilityOf` asks each reference's `prState`.
- `plot-impl-status.sh` keys its lookups by (repository, branch) instead of `sort -u` names and `head -1` (`:118`, `:142`), within the same shell budget.

**Slice 4 — one written form for a foreign slice.** After slice 3, the plan template (`skills/plot/templates/plan.md`), `/plot-idea` (`skills/plot-idea/SKILL.md:221-230`) and the plot skill (`skills/plot/SKILL.md`) document `` - `<branch>` — <repo>: … → owner/repo#N ``, with a Bitbucket example where `owner` is the workspace. They state that `owner/repo@<sha>` names a commit and never a branch, and that a plan may mix implementation homes per slice. The `owner/repo@branch` form is not documented.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-deliver-passes-a-plan-whose-slices/panel.md`):

- [x] Refuse or ask: delivery refuses, in the domain, with `slices-unread`, in both attended and unattended mode. Step 4b's text follows the domain.
- [x] The detector: a non-claim list item in a slice section that holds a token with a configured branch prefix, inside or outside a code span; `idea/`, names containing `*` and file paths (a `.` after the prefix) are excluded; no keyword. Code spans are scanned so that 3819's `` - Umsetzung: `bug/…` `` line counts.
- [x] A `<!-- deferred: … -->` marker on an unread item is a person's explicit accept, and the item no longer blocks.
- [x] Slice order: parser and records, domain refusal, per-line cross-repository references, authoring docs.
- [x] Board: the board shows the domain's refusal as the reason a plan is not deliverable; no separate badge.
- [x] The `owner/repo@branch` form is dropped, because `@` means a commit in another repository (`skills/plot/SKILL.md:316,323`).
- [x] Slice 3 also makes `crossRepoReferences` read the heading form `PR: owner/repo#N`.
- [x] Facts corrected: no board code reads `unread_*` today; six of the seven 3853 lines name a branch; 3819 is a second live case; the refusal lives in the domain, not in step 4b.

### Open Questions

- [ ] How does a plan name a foreign branch before its PR exists? A backticked branch with no `→ owner/repo#N` asks `prMerged(branch)` in this repository (`deliverability.ts:183`).
- [ ] `prs` flattens cross-repository numbers to bare integers. Does `releasePr` (`packages/board/src/server/entry/deliver.ts:775`) pick a foreign number and read it in this repository?
- [ ] How many Delivered and Released plans in ewz-kus-portal and in this repository newly read as having unread branch items, and what does section 24c say about a plan that already shipped?

## Slices

### Unread item records

- `bug/deliver-reads-unread-branch-items` — `plot-plan-meta.sh` emits `unread_branch_items` with deferred items excluded; `PlanMetaSchema`, `PlanRecord` and the pulse plan carry it; reconcile section 24c lists each item with its rewrite and says it blocks delivery; the PR names the shell lines removed for `check-shell-lines.sh` <!-- builds: unread_branch_items in plot-plan-meta.sh, reconcile section 24c --> → #2858

### Deliver refusal

- `bug/deliver-refuses-unread-branch-items` — `deliver()` refuses `slices-unread` through `deliverabilityOf`, also with zero parsed branches; `landed()` answers `not-merged` so `allSlicesConfirmed` and auto-delivery agree; step 4b reports the refusal <!-- builds: slices-unread in deliver() --> → #2877

### Per-line references

- `bug/a-cross-repo-reference-is-read-per-line` — `crossRepoReferences`, `branchesOf` and `plot-impl-status.sh` key references by (repository, branch); `crossRepoReferences` reads `PR: owner/repo#N` on headings → #2883

### Foreign slice form

- `docs/a-foreign-slice-has-one-written-form` — the template, `/plot-idea` and the plot skill document `` - `<branch>` — <repo>: … → owner/repo#N `` with a Bitbucket example; `@` stays the commit form

## Tests

**Slice 1:**

- `test/reconcile/parser.test.mjs` (`node --test`): the 3853 lines verbatim give 6 `unread_branch_items` and none for the `vnull` line; a list-dialect copy gives the same 6; German, French and `siehe` lines each give one item; a claim line, a backticked `docs/plans/x.md`, `idea/*` and an `idea/` plan line give none; an item with `<!-- deferred: … -->` gives none; the 3819 line follows the answer to the first open question, asserted explicitly. Every plan in `docs/plans` gives the measured count.
- `test/reconcile/scan-unread-branch-items.test.mjs`, modelled on `scan-unread-heading-items.test.mjs`: the summary key, the printed rewrite and the blocking sentence.
- `packages/domain/test/plan-store-shell.test.ts`: `planOf` maps the field. `plan-store.corpus.test.ts`: the key is carried.

**Slice 2:**

- `packages/domain/test/workflows-deliver.test.ts`: readings with unread items refuse `slices-unread` and name each item; a deferred item does not refuse; a plan with zero branches and one unread item refuses.
- `packages/domain/test/deliverable.test.ts` and `auto-deliver.test.ts`: a pulse plan with unread items is `not-merged`, and auto-delivery does not start it.
- `packages/board/test/unit/deliverability.test.ts`: the 3853 plan text with its one branch merged gives `deliverable: false` (today `true`).

**Slice 3:**

- `packages/domain/test/cross-repo-reference.test.ts`: three lines with one branch name and three repositories give three references; a heading `PR: owner/repo#N` gives one.
- `packages/board/test/unit/deliverability.test.ts`: #11 merged and #22, #33 open for one name in three repositories refuse and name all three (today `deliverable: true` after asking only #11).
- A corpus pair (`packages/domain/corpus/`) holds `crossRepoReferences` against `plot-impl-status.sh`'s `annotation_for` on both forms.

**Slice 4:** a parser test that the template's documented example gives 0 unread items and resolves to `owner/repo#N`; `pnpm test` for skill parsing.

## Notes

- Source: https://github.com/plot-pm/plot/issues/2826. The plan names it in `Issue:` and writes nothing to the tracker.
- Panel round 1 verdicts: `adopter.md`, `lifecycle.md`, `parser.md`, `testability.md` beside `panel.md`.
- The four slices are four waves and gate in order. Slice 3 is independent of slices 1 and 2 in code; it precedes slice 4 because slice 4 teaches the form that slice 3 makes safe.
- Amended 2026-10-28 after panel round 1.

# Juror verdict: plan parser owner (plot-plan-meta.sh, PlanStore, unread_* fields)

Position: amend

Evidence: Read the plan, issue #2826, `skills/plot/scripts/plot-plan-meta.sh` (header :60-260, `branch_claim_re` :1062, `extract_prs` :1028, both slice handlers :1301-1440), `skills/plot/scripts/plot-reconcile-scan.sh` (24/24a/24b :3233-3298), `skills/plot-deliver/SKILL.md` 4/4b (:130-194), `packages/domain/rules/deliverable.ts`, `packages/domain/src/rules/cross-repo-reference.ts`, `packages/board/src/server/controllers/deliverability.ts`, `packages/domain/corpus/plan-store.corpus.test.ts` (:67-94, :223-229), and the real plan `docs/plans/2026-10-23-ewzkus-3853-build-identitaet.md` from the ewz-kus-portal checkout (`git show` of commit 371d63d098). Ran: `plot-plan-meta.sh` on four fixtures (the issue shape, a list-dialect variant, a heading-dialect cross-repo variant, and one branch name in three repos); `crossRepoReferences` (copied, run with Node 24 type stripping) on the three-repo fixture; three sweep scripts over all 601 plan files in this repo's `docs/plans`, 42 in ewz-kus-portal's, and the real 3853 plan. Scripts are under `scratchpad/juror-2826-parser/`. Did not run any vitest, corpus or reconcile suite.

## (a) Problem statement

- Correct: on the real 3853 plan shape, the parser reads one branch, `prs: [3722]`, and `unread_branch_headings`, `unread_waits` and `unread_heading_items` are all `[]` (ran it). The six bold lines match no branch claim (`branch_claim_re` at `plot-plan-meta.sh:1062` requires `- \`<prefix>/…\`` at the start of the item), so the heading-dialect handler (:1409) treats them as prose and reports nothing.
- Imprecise: "seven it did not" (Motivation). Six lines name a branch. The seventh, `**\`vnull\` in ewz-kus-contracts**`, names no branch at all ("Gehört in den contracts-Slice"). No token-based definition can report it, and the plan should say so, not imply that slice 1 covers it.
- False: "the board reads `unread_*` fields from the same JSON" (Changelog, Board impact). `git grep unread` over `packages/board/src`, `packages/domain/src` and `packages/fleet/src` finds no reader of any `unread_*` field. The only reader is `plot-reconcile-scan.sh` (:3259, :3280, :3293). The corpus test lists all three as `KNOWN_UNCARRIED` (`plan-store.corpus.test.ts:85-89`).
- Missing cause: delivery is not decided in `/plot-deliver` step 4b. `plot-deliver.sh` is a launcher (`:1-13`) for `board/plot-deliver.mjs`. The verdict `verified 1 branch(es) merged` comes from `packages/board/src/server/entry/deliver.ts:437` through `deliverabilityOf` (`controllers/deliverability.ts:227`), which reads `PlanStore.readPlan` (:250) and asks the domain's `deliver()` (:316). Step 4b is skill prose, so it is a rule. The board button, `plot-deliver.mjs` and the auto-deliver path never read it.

## (b) Approach

1. **Approach item 3 targets a rule, not the gate.** A refusal in step 4b alone leaves `POST /api/deliver`, `plot-deliver.mjs` and auto-delivery passing the 3853 plan. The refusal must be a domain answer reached through `PlanRecord`: the adapter carries the new field, `deliverabilityOf` passes it to `deliver()`, and `deliver()` refuses. That also means the corpus test moves the field from `KNOWN_UNCARRIED` to carried.
2. **Slice 1 alone breaks the corpus tier.** `plan-store.corpus.test.ts:229` fails on any wire key that is on neither list. Slice 1 must add `unread_branch_items` to `KNOWN_UNCARRIED` with a reason, and slice 2 must move it out again.
3. **The proposed authoring form `owner/repo@branch` is read by nothing.** I ran the parser on `acme/other@infra/foo`, bare and backticked: no branch, no PR, no unread field. `plot-impl-status.sh` resolves `→ owner/repo#N` (:6, :59, `annotation_for` :137), not `@branch`. The parser reads `owner/repo@<hex>` only as a commit (`plot-plan-meta.sh:170-178`), and `deliverability.ts:109` answers `unknown` for it. If the template documents `owner/repo@branch`, it adds a new shape that the parser does not read, which is the defect this plan exists to remove.
4. **The `→ owner/repo#N` form does not fix the reported shape either.** In the 3853 plan, six repositories use the same branch name `infra/EWZKUS-3853-monotonie-waechter`. I ran a fixture with three claim lines of that one name, each with a different `→ owner/repo#N`. The parser returns `branches: [one name]`, and `crossRepoReferences` returns one entry (`quatico/ewz-kus-contracts#11`). `found.has(branch)` at `cross-repo-reference.ts:53` keeps the first match, and `branchesOf` (`deliverability.ts:70-90`) merges by branch name. Delivery would ask about 1 PR out of 3 and pass. The key must be (repository, branch), in `crossRepoReferences`, `branchesOf` and `annotation_for`. If not, the slice 2 template points authors at a form that hides 5 of 6 foreign PRs.
5. **Auto-delivery.** `allSlicesConfirmed` reads the pulse, not the plan (`deliverable.ts:128-132`). If only `deliverabilityOf` refuses, auto-delivery starts a delivery that the script refuses. `deliverable.ts:85-89` documents the measured result (2026-10-01): the slug stays in `inFlight` until the board restarts. The pulse plan must carry the count, or the auto-deliver candidate check must read it, so that both readers reach one answer.

## (c) Slices

- The cut is mostly right. Slice 1 (parser + scan) merges independently if it adds the `KNOWN_UNCARRIED` entry.
- Slice 2 bundles three things: the domain/controller refusal, the template text, and the `/plot-idea` text. The refusal is the gate and the template is guidance, so they can ship separately. The (repository, branch) keying from (b)4 must land before or with the template text. Otherwise the documented form is still wrong.
- Proposed order: (1) parser + scan; (2) `PlanRecord` carries the field + `deliver()` refuses + pulse/auto-deliver alignment; (3) cross-repo keying per (repository, branch) + template and `/plot-idea` text. Step 4b prose follows (2), in the same branch.
- Not in this plan: label-led items. ewz-kus-portal's Approved plan `2026-09-09-ewzkus-3819-mandats-whitelist-rechnungsliste.md` has `- Umsetzung: \`bug/ewzkus-3819-…\`` and parses to `branches: []` with every unread field empty (ran it). Delivery already refuses it, because a slice that names no branch is `not-merged` (`deliverable.ts:167`), but nothing says why. The definition below reports it.

## (d) Open questions

**Q2: which shapes count as "names a branch"?** I measured four candidate definitions. Each one looks only at list items inside `## Slices|Waves|Branches`, skips fences and comment interiors, and skips items that already match `branch_claim_re`. Totals: 601 plan files here, with 1080 list items (750 claims, 330 not); 42 in ewz-kus-portal, with 55 list items (48 claims, 7 not).

| definition | plot false positives | ewz hits | real 3853 |
|---|---|---|---|
| any `<prefix>/x` token in the item | 2 items, 1 plan | 2 (3819) | 6/6 |
| bare `<prefix>/x` token anywhere | 2 items, 1 plan | 0 | 6/6 |
| token before the first ` — ` | 2 items, 1 plan | 2 (3819) | 6/6 |
| `Branch[:\s]+<prefix>/x` (case-insensitive) | **0** | 0 | 6/6 |
| keyword form, OR a backticked `<prefix>/x` before the first ` — ` | 1 (`idea/*`, a glob), **0** when `*` is excluded | 2 (3819, both true) | 6/6 |

The two plot false positives are in `2026-08-20-a-row-is-a-tuple.md` (Released). They are heading-dialect description bullets ("Absorbs bug/one-column-…") without an em-dash, so neither "anywhere" nor "lead" separates them from a real line. The 23 bold-led non-claim items and the 45 items that mention "branch" all produce zero hits with the keyword rule, so `**repo**` alone is not a usable signal.

**Recommendation:** an unread branch item is a list item in a slice section that is not a claim and that either (i) has the word `Branch`/`branches` followed by a `<prefix>/name` token, backticked or not, or (ii) starts with a backticked `<prefix>/name` before its first ` — ` separator. A name that contains `*` is a pattern, not a branch. Measured: 0 false positives over this estate, 6/6 on 3853, and 2 true hits on 3819. Emit `{ wave, branch, line }` triples, so the scan can name the item, as `unread_heading_items` does. The `vnull` line stays unreported, and the plan should state that as a known limit.

**Q1: refuse or ask?** Refuse, in the domain. `deliverabilityOf` has no interactive channel, and the auto path must not ask. Escape hatch: the person in 3853 delivered "by decision". The parser honours `<!-- deferred: … -->` only on a claim line (`keep_branch`, :987). An unread item with a deferred marker must therefore count as deferred, not unread. Otherwise the only way to record that decision is to rewrite the line. The plan does not name this. My sweep strips comments before it matches, so a parser change must read the marker before it masks the comment.

**Q3: board?** The board shows no `unread_*` field today. If (2) is done, the refusal sentence reaches the board through the deliver controller, with no new UI. A plan-row badge is a separate decision. Under "Every rendered state is a domain property", a badge needs `PlanRecord` to carry the field, and slice 2 adds that anyway.

**New questions the plan should carry:**
- How is one branch name in N repositories keyed? (b)4: today, the first match wins.
- Does the pulse plan carry the unread count, so that `allSlicesConfirmed` and `deliverabilityOf` reach one answer? (b)5.
- Is an unread item with a deferred marker exempt?

## (e) Tests

- Slice 1, `test/reconcile/parser.test.mjs` (node --test): the 3853 heading-dialect fixture gives 6 `unread_branch_items` and the `vnull` line gives none. The list-dialect equivalent gives the same 6. `- Umsetzung: \`bug/x\`` gives 1. "Absorbs bug/x" prose gives 0. `` `idea/*` `` gives 0. A real claim line gives 0. An item with a deferred marker is not unread. Differential estate test: `unread_branch_items` is `[]` on every plan in `docs/plans` (measured: 0). A new `scan-unread-branch-items.test.mjs`, modelled on `scan-unread-heading-items.test.mjs`. The corpus test gets the `KNOWN_UNCARRIED` entry.
- Slice 2, domain unit (`packages/domain/test`): `deliver()` refuses on readings with unread items and names them. The pulse rule answers `not-merged` for the same plan. Adapter unit: `planStoreShell` maps the field. Board unit: `deliverability` returns the refusal for a 3853-shaped plan with its one branch merged. The corpus test moves the key to carried.
- Slice 3, domain unit: `crossRepoReferences` keeps three entries for one branch name in three repositories, and `deliverabilityOf` asks all three PRs.

## Amendments

1. Make the refusal a domain answer: `PlanRecord` carries `unreadBranchItems`, `deliverabilityOf` passes it to `deliver()`, and the auto-deliver/pulse reading agrees. Step 4b prose only describes that answer.
2. Remove `owner/repo@branch` from the authoring form, or add a slice that makes the parser read it. Today nothing reads it.
3. Key cross-repository references by (repository, branch) before the template documents `→ owner/repo#N` for a branch name shared across repositories.
4. Adopt the measured definition in (d) Q2, report `{ wave, branch, line }`, exclude names that contain `*`, and treat an item with a deferred marker as deferred.
5. Slice 1 adds the `KNOWN_UNCARRIED` entry, or the corpus tier fails.
6. Fix the Motivation ("six lines name a branch; the `vnull` line names none and stays unreported") and the Board impact sentence (no board code reads `unread_*` today).

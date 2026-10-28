# Juror verdict: lifecycle (owner of delivery)

Position: amend

Evidence: Read the plan, issue #2826, `skills/plot-deliver/SKILL.md:120-195` (steps 4 and 4b), `packages/domain/src/workflows/deliver.ts`, `packages/domain/src/rules/deliverable.ts` (`allSlicesMerged`/`allSlicesConfirmed`/`landed`), `packages/board/src/server/controllers/deliverability.ts`, `packages/board/src/server/entry/deliver.ts:372-440`, `packages/domain/src/rules/cross-repo-reference.ts`, `skills/plot/scripts/plot-impl-status.sh:137-352`, `skills/plot/scripts/plot-plan-meta.sh` (commit form `:963-972`, unread fields `:223-240`, `:760-780`), `packages/domain/corpus/plan-store.corpus.test.ts:84-89`, `packages/fleet/src/shared/auto-deliver.ts:106`, `skills/plot/SKILL.md:316-324`, `skills/plot/templates/plan.md:74`. Ran: (1) `plot-plan-meta.sh` on two scratch plans — one in the ewz shape, one in the plan's proposed "documented" foreign form; (2) `crossRepoReferences` on the documented-form plan with node 24 type stripping; (3) a scratch vitest (`juror-2826-lifecycle/probe.test.ts`, run with the board package's vitest against the real `deliverabilityOf` and the domain's `planStoreFixture`) with three cases A–C below. All three assertions passed, which means each defect reproduces on current main.

## (a) Problem statement

- The facts about the ewz plan reproduce. `plot-plan-meta.sh` on the ewz-shaped scratch plan returns one wave with one branch (`infra/ewzkus-3853-build-identitaet`), `prs: [3722]`, and `unread_branch_headings: []`, `unread_heading_items: []`. The foreign lines produce nothing and no field mentions them.
- **"Seven it did not" is right, but the proposed detector catches six.** The seventh line, `**\`vnull\` in ewz-kus-contracts** — … git push origin :refs/tags/vnull`, names no branch. A rule keyed on "names a branch" (Approach 1) does not see it. The cause is broader than the plan names: a slice list item that is not a backtick claim is work Plot does not read, whether or not it names a branch.
- **The Board-impact sentence is false.** "the board reads `unread_*` fields from the same JSON": `git grep` finds no reader of `unread_branch_headings`, `unread_waits` or `unread_heading_items` in `packages/board/src`, `packages/fleet/src` or `packages/domain/src`. `plan-store.corpus.test.ts:84-89` lists all three as fields "no domain rule decides on". Only `plot-reconcile-scan.sh` §24/24a/24b reads them.
- **Approach 4 cites a form that does not exist.** "`owner/repo@branch` … which `plot-impl-status.sh` already resolves": the helper resolves only `→ owner/repo#N` (`plot-impl-status.sh:137`, `:325-332`). `owner/repo@<hex>` is already the **foreign-commit** form (`plot-plan-meta.sh:963-972`, `skills/plot/SKILL.md:316`). `owner/repo@infra/x` matches neither form. In the scratch plan, a slice written that way parsed to a wave with **zero branches** (`"Web","branches":[]`).

## (b) Approach

**Step 4b in the skill is the wrong place for the gate. It is a rule, not a gate, and it misses the path that delivers without a person.** `packages/fleet/src/shared/auto-deliver.ts:106` runs `plot-deliver.sh` (to `plot-deliver.mjs`, then `deliverabilityOf`) directly, and no skill step runs on that path. The board's Testing bump reads `allSlicesMerged` over the pulse (`deliver.ts` `readCheck`, `:283-347`). A step-4b-only fix therefore leaves three readers, and only the interactive skill refuses:

| reader | sees unread items after this plan? |
|---|---|
| `/plot-deliver` step 4b (prose) | yes |
| `plot-deliver.mjs` → `deliverabilityOf` → domain `deliver` (auto-deliver, board route, skill step 6) | no |
| `allSlicesConfirmed` / pulse (Testing column, auto-deliver trigger) | no |

The plan says "the deliver decision belongs in the domain", but neither slice puts it there. The refusal belongs in `DeliverReadings` and `DeliverRefusal` (`workflows/deliver.ts:9-16`), next to `branches-unmerged`, and `deliverabilityOf` has to pass it through. `landed()` (or the pulse's slice verdict) should answer `not-merged` for the same plan, so the card does not show "deliverable" while delivery refuses it. That is the "every rendered state is a domain property" rule.

**Writing foreign slices in the documented form does not make delivery correct today.** I probed `deliverabilityOf` with the plan's own proposed shape:

- **A: one branch name shared by two foreign repositories.** This is the ewz pattern, where six repos each use `infra/EWZKUS-3853-monotonie-waechter`. `crossRepoReferences` returns only the first reference: `[["infra/EWZKUS-3853-monotonie-waechter",{"repo":"quatico/ewz-kus-contracts","number":12}]]`. The second, `→ quatico/ewz-kus-consumptions#7`, is dropped. The doc comment says "the first line that carries a reference wins" (`cross-repo-reference.ts:31`). `branchesOf` also keys by branch name (`deliverability.ts:70-90`). Result: `deliverable: true, merged: 2` while consumptions#7 is OPEN and never asked. The same plan's empty "Web" slice (`owner/repo@branch` form) is skipped, because `branchesOf` iterates branches only. **This is the #2826 defect again, inside the form the plan tells authors to use.**
- **B: a foreign branch whose name matches a merged head in this repository's PR index.** The result is `deliverable: true` with zero host calls. `mergedBranches` checks `mergedRowByHead` (`deliverability.ts:166-169`) **before** it checks `prRef` (`:171-182`). The cross-repo PR is never asked. Ticket-named branches such as `EWZKUS-3853-…` across sibling repos make this collision likely.
- **C: a foreign commit (`owner/repo@abc1234`).** The result is `reason: cannot-tell`, permanently (`deliverability.ts:98-125`, `:285-295`). That matches `SKILL.md:323`, but it means the commit form cannot be used to deliver a cross-repo slice. Only `→ owner/repo#N` can.

**Empty-slice disagreement (existing defect, exposed by Approach 4):** `landed()` refuses a slice with no branch (`deliverable.ts:166`, `return 'not-merged'`), while `deliverabilityOf` delivers it. These are two answers to one fact. Any foreign line that parses to a branchless slice hits it.

**Refuse versus ask.** Refuse in the mechanism. "Deliver anyway" over unread items has the same shape as "deliver anyway" over open PRs, which `SKILL.md` already refuses in both modes. The auto-deliver path has no person to ask. The skill can explain the refusal and name the two exits: rewrite the line in a read form, or defer it.

## (c) Slices

- **The cut leaves the gate in prose.** Slice 2 must change `workflows/deliver.ts`, `deliverability.ts` and the pulse/`landed` reading, not only `SKILL.md`. Otherwise it fails Gates Over Rules: `plot-deliver.mjs` still prints `verified 1 branch(es) merged`.
- **A slice is missing, and it ships first or in the same release as the template change:** "a cross-repo reference is keyed by (repo, branch), not by branch". Fix `crossRepoReferences` (all references per branch, not the first), `branchesOf` (do not merge two claims of one name with different repos), and the order in `mergedBranches` (a `prRef` decides before the local index). Without it, Approach 4 teaches authors a form that passes delivery with work outstanding (probe A).
- **A third, small slice:** `deliverabilityOf` refuses a non-deferred slice with no branch, so it agrees with `landed()`.
- Slice 1, the parser and scan, is independent and can ship first. Its detector must cover every non-backtick list item in a slice section, so it includes the `vnull` line.

## (d) Open questions

1. *Refuse or ask?* Refuse in `deliver` (domain) with a new `DeliverRefusal`, for example `slices-unread`. The skill reports the refusal and does not offer an override. Evidence: auto-deliver has no person (`auto-deliver.ts:106`), and the open-PR guardrail already refuses in both modes (`SKILL.md` step 4, unattended note).
2. *Which shapes?* Use the same scope `crossRepoReferences` uses: top-level list items in `## Slices|Branches|Waves`, outside fences. Every such item without a backtick claim counts as unread unless it carries `<!-- deferred: … -->`. Prose mentions in paragraphs stay out because only list items count. This also catches the `vnull` item. A branch-name heuristic would miss it.
3. *Board?* Yes, as a domain property: the plan row's deliverability answer should carry the reason. Today no board reader exists, so the plan's premise is wrong (see (a)).
4. **New question:** how is an unread item deferred? `<!-- deferred: -->` is read only on branch lines. The gate needs a stated exemption, or the author has to rewrite the line first.
5. **New question:** what is the read form for a foreign slice **before** its PR exists? A backtick branch with no `→ owner/repo#N` asks `host.prMerged(branch)` in **this** repository (`deliverability.ts:183-185`). It is wrong when the name collides and silent about which repository it means. The plan needs a repo-qualified branch claim (for example `` `owner/repo:branch` ``) that reads `unknown` (refuse) until a `#N` is added.
6. **New question:** `prs` flattens cross-repo numbers to bare integers (`"prs":[7,12,3722]` in the scratch run). Does `releasePr` (`entry/deliver.ts:775`) pick a foreign number and look it up in this repository?

## (e) Tests

- Domain unit (`packages/domain/test`): `deliver` refuses `slices-unread` and names each item; deferred items are exempt. `landed` answers `not-merged` for a plan whose pulse entry carries unread items.
- Domain unit: `crossRepoReferences` returns both references for one branch name in two repositories (probe A as the fixture).
- Board unit (`test/unit/deliverability.test.ts`, the existing port-fixture style): probe A must refuse (consumptions#7 OPEN), probe B must ask `prState` and refuse, a branchless slice must refuse, and the ewz plan text must refuse naming 7 items.
- Shell (`test/reconcile/parser.test.mjs`): `plot-plan-meta.sh` on the ewz fixture reports 7 `unread_branch_items` (or the renamed field), and reports none for a plan in `→ owner/repo#N` form. Reconcile: the new section's counter.
- Corpus: if the scan duplicates the rule, add a `corpus/*.corpus.test.ts` pair (shell-and-domain contract), and add the new field to the `plan-store.corpus.test.ts` list with its reader named.

## Amendments

1. Move the refusal into the domain: add a `DeliverReadings` field and a `DeliverRefusal` (`slices-unread`), pass it through `deliverabilityOf`, and fold it into `landed()`/the pulse so the Testing column agrees. Step 4b then only reports it.
2. Count every non-backtick list item in a slice section, not only items that "name a branch". Otherwise the `vnull` line, the seventh item, stays invisible.
3. Remove `owner/repo@branch` from Approach 4. It collides with the foreign-commit form and parses to an empty slice. Document `→ owner/repo#N` as the deliverable form, and say that `owner/repo@sha` never delivers (`cannot-tell`).
4. Add a slice that keys cross-repo references by (repo, branch): all references per branch in `crossRepoReferences`, no merging of same-name claims across repos in `branchesOf`, and `prRef` checked before the local PR index in `mergedBranches`. Ship it no later than the template change.
5. Add a slice, or extend slice 2, so that `deliverabilityOf` refuses a non-deferred branchless slice, as `landed()` already does.
6. Correct the Board-impact line: no board code reads `unread_*` today (`plan-store.corpus.test.ts:84-89`).
7. Add open questions 4–6 from (d).

# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2826, `skills/plot/scripts/plot-plan-meta.sh` (field docs :223-245, heading handler :1380-1440, `branch_claim_re` :1062), `plot-reconcile-scan.sh` §24a/24b (:3268-3298), `packages/domain/src/workflows/deliver.ts`, `rules/deliverable.ts`, `rules/auto-deliver.ts:355-370`, `rules/cross-repo-reference.ts`, `packages/board/src/server/controllers/deliverability.ts`, `server/entry/deliver.ts:413-440`, `server/deliver.ts:320-348`, `packages/domain/corpus/plan-store.corpus.test.ts:67-91`, `scripts/check-shell-lines.sh`, `skills/plot-deliver/SKILL.md:123,175-194`, `skills/plot/SKILL.md:316-323`. Ran: `plot-plan-meta.sh` on two scratch fixtures (heading shape copied from the issue, list shape) and on a same-branch-name fixture; an awk sweep of slice-section list items over this repo's 601 plans and ewz-kus-portal's 42 plans; `plot-plan-meta.sh` on ewz-kus-portal's `2026-09-09-ewzkus-3819-…md`; the real 3853 plan text from ewz-kus-portal commit `9666197896`; the existing `packages/board/test/unit/deliverability.test.ts` (17 pass) and `packages/domain/test/workflows-deliver.test.ts` (26 pass); and two scratch vitest cases calling `deliverabilityOf` with fixture ports (both reproduce the defect, output quoted below). No file in the worktree was changed except this verdict.

## (a) Problem statement

- **The defect reproduces at the board-unit tier, with no git and no host.** A scratch test fed `deliverabilityOf` (`deliverability.ts:227`) the issue's plan text and a `planRecord` holding the one parsed branch, with a MERGED store row for it. Output: `{"merged":1,"deliverable":true,"reason":""}`. This is the same sentence `entry/deliver.ts:438` prints (`verified 1 branch(es) merged`), so the issue's measurement holds.
- **The parser half reproduces too.** `plot-plan-meta.sh` on the heading-shape fixture gives one branch and `unread_branch_headings: [] unread_heading_items: [] unread_waits: []`. The list-shape fixture is silent the same way. The `**repo** (dort eigener Branch X)` lines do not match `branch_claim_re` (`plot-plan-meta.sh:1062`), so neither shape reports them.
- **The "Board impact" line is wrong.** "The board reads `unread_*` fields from the same JSON" has no evidence: `git grep -i unread` over `packages/{board,domain,fleet}/src` finds no reader. The corpus test lists all three fields as `KNOWN_UNCARRIED`, with the note "no domain rule decides on it" (`plan-store.corpus.test.ts:85-89`). The real board impact is the opposite: slice 2 needs the field CARRIED into `PlanRecord`, which the plan does not mention.
- **A second live case exists, and it is worse.** ewz-kus-portal `docs/plans/2026-09-09-ewzkus-3819-mandats-whitelist-rechnungsliste.md` is `State: Approved`. Its `## Branches` holds `- Umsetzung: \`bug/ewzkus-3819-…\``, and the parser reads `{"waves":[]}`. With zero branches, `entry/deliver.ts:434-435` prints `no branches found in plan — proceeding (nothing to verify)`, so that plan would deliver with nothing checked. The plan's two example shapes (`dort eigener Branch X`, `**repo** … Branch X`) do not cover this label-then-backtick shape.
- **"24b … for branches in this repository only" misnames 24b.** 24b reports a backticked claim line that no heading in its wave claims (`plot-reconcile-scan.sh:3288-3297`). It is about attribution, not about which repository.

## (b) Approach

1. **The gate is in the wrong place in slice 2.** "Step 4b" is prose in `skills/plot-deliver/SKILL.md:175`. The deterministic gate behind `plot-deliver.sh`, `plot-ask.mjs deliverable` (`entry/ask.ts:127`) and auto-delivery is `deliverabilityOf` → domain `deliver` (`workflows/deliver.ts:139`, refusal union :9-16). A fix that edits SKILL.md alone leaves the board button and the unattended path delivering. The refusal must be a new `DeliverRefusal` (for example `branches-unread`), and `DeliverReadings` must gain the unread items.
2. **The pulse side must agree, or auto-delivery gets stuck.** The board's Deliver verdict (`server/deliver.ts:341`) and auto-deliver (`auto-deliver.ts:370`) read `allSlicesConfirmed` over the pulse. Both comments name the failure in which the pulse says merged, `plot-deliver.sh` refuses, and the slug stays in `inFlight` (`auto-deliver.ts:362-369`). A refusal that only `deliverabilityOf` knows recreates that failure. So either the pulse carries the count and `landed()` (`deliverable.ts:116`) answers `not-merged`, or the plan states why it accepts the retry loop (`AUTO_DELIVER_MAX_FAILURES = 3`, `auto-deliver.ts:73`).
3. **The proposed authoring form `owner/repo@branch` collides with an existing form.** `owner/repo@abc1234` is already the cross-repo COMMIT form (`skills/plot/SKILL.md:316,323`, `plot-deliver/SKILL.md:123`), and it reads `unknown` → `cannot-tell` (`deliverability.ts:293`). Documenting `@branch` gives one token two meanings. Only `→ owner/repo#N` is safe.
4. **The `→ owner/repo#N` form also fails the issue's real case, which I executed.** All six foreign slices share ONE branch name, `infra/EWZKUS-3853-monotonie-waechter`. The parser keeps three same-named entries (fixture: `branches: [local, f, f, f]`, `prs: [11,22,33,3722]`). `crossRepoReferences` keys by branch name, and the first reference wins (`cross-repo-reference.ts:49-51`). Scratch test with the host answering MERGED for #11 and OPEN for #22 and #33: `ASKED [[11,{"repo":"quatico/ewz-kus-contracts"}]] DELIVERABLE true`. So the documented form, written for the issue's own plan, delivers with two open foreign PRs that nobody asked about. This is the defect the plan sets out to remove.
5. **The shell may not grow.** `scripts/check-shell-lines.sh` (CI `ci.yml:1323-1325`) fails any change that makes the shipped shell longer than its merge base, and it has no allowance. Slice 1 adds a detector to `plot-plan-meta.sh` and a section to `plot-reconcile-scan.sh`, so it must name the shell lines it removes. Another option is to put the detector in the domain, as `crossRepoReferences` already reads plan text in TS. In that case it is a declared duplicate only if the shell keeps it too.
6. **The corpus gate.** A new wire key that is on neither list fails `plan-store.corpus.test.ts:223-229` (CI job `corpus`, `ci.yml:103`). Slice 1 must add `unread_branch_items` to `KNOWN_UNCARRIED`, or carry it. Slice 2 then has to move it from that list to a carried field. Carrying it in slice 1 avoids that churn.

## (c) Slices

The current cut puts two unrelated concerns in slice 2 (the refusal, and the authoring docs). It also misses the cross-repo identity fix, which the docs depend on. Proposed order, each slice mergeable alone:

1. `bug/deliver-reads-unread-branch-items`: parser field (both shapes) + reconcile section 24c + `PlanRecord` carries it (plan-store-shell). It reports only and gates nothing. Shell budget named.
2. `bug/deliver-refuses-unread-branch-items`: domain `deliver` refusal, `deliverabilityOf` passes the items, and `landed()` / pulse answer `not-merged` so the board verdict and auto-deliver agree. The refusal also applies when the plan has zero parsed branches but has unread items (the 3819 case). This slice needs slice 1's field.
3. New, `bug/a-cross-repo-reference-is-read-per-line`: `crossRepoReferences` and `mergedBranches` key on (line or repo, branch), not on the branch name. Without this, the documented form is unsafe (finding b4). It is independent of slices 1-2 and can ship first, as a bug.
4. `docs/…-foreign-slice-form`: template + `/plot-idea` document `- \`<branch>\` — <repo>: … → owner/repo#N`. They state that `@` is for commits only, and that a slice with no PR yet stays unmerged. This slice needs slice 3.

## (d) Open questions

- **Refuse or ask?** Refuse in the domain. `deliverabilityOf` has no channel for a question, and the unattended path must refuse anyway. The person's way through is the existing deferral: honour `<!-- deferred: <reason> -->` on the unread line, so the 3853 "delivered by decision" outcome stays expressible and is recorded in the plan rather than as a bypass. The refusal sentence names each line and both repairs (rewrite as a claim line, or defer it), in the same way as `cannot-tell` (`deliverability.ts:293`).
- **Which shapes count?** Measured with an awk sweep of `## Slices|Branches|Waves` list items outside `branch_claim_re`, fences skipped:
  - Keyword detector (`[Bb]ranch:? +\`?<prefix>/`): 0 hits on this repo's 601 plans, 0 on ewz-kus-portal's 42, and 6/6 on the real 3853 plan. It misses the 3819 shape (`Umsetzung: \`bug/…\``).
  - Prefix-only detector (any configured-prefix name in such an item): 2 hits here, both prose ("Absorbs feature/…", `2026-08-20-a-row-is-a-tuple.md:410,413`, a Released plan). It gets 2 hits in ewz-kus-portal, both on the 3819 plan: one a real missed slice, one an `idea/` plan-PR line.
  - Recommendation: the prefix-only detector, scoped to plans before Delivered for the gate, with `idea/` excluded and "Absorbs" left reported. Pin both real plans as fixtures.
- **Board row?** Not before slice 2. The board reads none of the `unread_*` fields today. Once the pulse carries the count, the Deliver verdict ("not-merged"/a new word) is the rendered state, and it is a domain property via `landed()`.
- **New question: the foreign branch prefix.** A foreign repository's branch may use a prefix outside this repo's `Branch prefixes`, and a PREFIXES-based detector cannot see it. The plan should state that limit.
- **New question: work with no branch.** The `vnull` tag deletion line names no branch, and no proposed detector finds it. The plan should state that it is out of scope.
- **New question: should the empty-plan case refuse?** A plan with zero parsed branches and an Approved state proceeds (`entry/deliver.ts:434-435`). Should unread items be the only trigger, or should zero branches refuse as well?

## (e) Tests, per slice, at the lowest tier that fails today

- **Slice 1:** `test/reconcile/branch-heading.test.mjs` (or `parser.test.mjs`), node --test on fixtures:
  - The issue's heading-shape text gives 6 `unread_branch_items` (fails today: the field is absent).
  - A list-shape fixture gives the same result.
  - The 3819 label shape is reported.
  - "Absorbs feature/x" and the `vnull` line follow whatever the plan decides, asserted explicitly.
  - A deferred unread line is not reported.
  - Also: a new `test/reconcile/scan-unread-branch-items.test.mjs` cloned from `scan-unread-heading-items.test.mjs:86-93`, the corpus key list, and `plan-store-shell.test.ts` for the carried field.
- **Slice 2:**
  - Domain unit `packages/domain/test/workflows-deliver.test.ts`: readings with unread items refuse `branches-unread`. A deferred one does not refuse.
  - Board unit `packages/board/test/unit/deliverability.test.ts`: my scratch case with `deliverable: false` expected. It fails today; it ran and returned `true`.
  - Domain unit `deliverable.test.ts` / `auto-deliver.test.ts`: a pulse plan with unread items is not `merged`.
- **Slice 3:**
  - Domain unit `cross-repo-reference.test.ts`: three lines with the same branch and different repos give three references.
  - Board unit `deliverability.test.ts`: #22 OPEN refuses. It fails today; it ran and returned `deliverable: true` after asking only #11.
- **Slice 4:** a parser test that the template's documented example parses with 0 unread items and resolves to `owner/repo#N`. Plus `pnpm test`, which checks that the skills parse.

## Amendments

1. Move the gate into the domain: a new `DeliverRefusal`, `DeliverReadings` carries the unread items, and `deliverabilityOf` passes them. Make the pulse / `landed()` agree so the board verdict and auto-deliver do not offer what the script refuses.
2. Drop `owner/repo@branch`, because it is the commit form. Document only `→ owner/repo#N`.
3. Add a slice that makes cross-repo references per line rather than per branch name, ahead of the docs slice. Name the issue's shared-branch-name case as its test.
4. Replace the "Board impact" sentence: no board code reads `unread_*`. The impact is carrying the field into `PlanRecord` and the pulse.
5. Name the `check-shell-lines.sh` budget for slice 1, and the corpus `KNOWN_UNCARRIED` / carried decision.
6. Cover the 3819 shape (`Label: \`<branch>\``, zero parsed branches) and decide whether a zero-branch plan with unread items refuses.
7. Honour `<!-- deferred: … -->` on an unread line as the person's way to accept, and state that `vnull`-style branchless work and foreign prefixes are out of scope.

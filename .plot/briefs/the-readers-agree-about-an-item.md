## Implementation brief — two-readers-disagree-about-a-sprint-item (wave 1: The readers agree about what an item is)

- **Plan (canonical):** `docs/plans/2026-09-24-two-readers-disagree-about-a-sprint-item.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-readers-agree-about-an-item` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #966

The plan has one slice. Nothing waits on it and it waits on nothing.

### What to build

A sprint file has three readers, and they disagree about the line `- [ ] rename the deploy step` under `### Must Have`. Measured 2026-09-24 on one sandbox sprint with two such lines: `plot-sprint-release.sh` reports **2 Must items, both open**, and `plot-sprint-state.sh … Committed` refuses with `commitment-empty`, *"names no Must"*. The board drops the same lines.

| Reader | File | Bare line |
|---|---|---|
| `emit_tier` (release gate) | `skills/plot/scripts/plot-sprint-release.sh:230` | an item |
| `itemsFrom` (commit gate) | `packages/board/src/server/entry/sprint-transition.ts:64`, `:88` | not an item |
| `parseSprintMembers` (board) | `packages/board/src/server/board.ts:1148`, `:1167` | not an item |

The cause in both TypeScript readers is the mandatory second bracket in `MEMBER_LINE` / `SPRINT_MEMBER_LINE`. The fix makes the checkbox make the item, the heading make the tier, and the link optional metadata. Then a corpus test under `packages/domain/corpus/` declares the three readers as a pair and fails when they part. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The release reader is the reference.** It matches the checkbox alone and treats the slug as optional. `skills/plot-sprint/SKILL.md:240` documents the bare form, `SprintItem.plan` (`packages/domain/src/entities/sprint.ts:52`) is documented as `''` for a line that names no plan, and `scoreItem` has a `no-plan-named` path. Do not change `plot-sprint-release.sh` or `scoreItem`.

**Making the bracket optional is not the fix; the dedup key is half of it.** Both TS readers dedupe on the captured slug (`sprint-transition.ts:100-101`, `board.ts:1175-1176`). With the bracket optional every bare line captures `''` and they collide. Measured by the panel: three lines, two bare and one linked, keep **1 of 3** as shipped and **2 of 3** with only the regex changed; eight bare Musts keep **1 of 8**. Key on the slug where there is one and on the line's own position otherwise (for example its index in the file). **Do not key on the item text:** two identical bare lines would collapse and reproduce the defect in miniature. Every test on a bare sprint asserts the COUNT, not only that it commits, because the 2-of-3 result passes *"it commits"*.

**`commitment-empty` stays.** A sprint with an empty `### Must Have` is still refused (`transitions/sprint.ts:263`). Its sentence is correct for that case and changes only if a case that still refuses reads wrongly.

**The struck-through form is out of scope** (`plot-sprint-release.sh:241-249`). See the corpus section below: the TS readers do not handle it, and that is a finding to report, not a change to make here.

### The board needs more than a regex

`SprintMemberSchema` (`packages/board/src/contract/schema.ts:704`) carries `slug`, `tier`, `checked` and `known`, and **no text**. A bare member arrives with `slug: ''`, and three things then go wrong, each of which needs a test:

1. `SprintModal.tsx:151` keys the list on `m.slug`, so bare members share the key `''`.
2. `SprintModal.tsx:172-189` renders the slug as the member's label and link, so a bare member renders as nothing.
3. `collectSprints` (`board.ts:1369-1371`) marks a member `known: false` when its slug is not a known plan, so `''` gets the *unknown* badge (`SprintModal.tsx:201`). A bare item is not an unknown plan: it names no plan, the way `scoreItem` separates `no-plan-named` from a lookup.

So the board carries the item's text for a member with no slug, keys the row on something unique, renders the text without a plan link, and does not flag it unknown. A new schema field touches the contract, the server, and the client (the client casts the payload and never parses it, so a Zod default does not apply there). `packages/board/src/app/lib/filters.ts:22-32` reads `members.slug` for sprint membership, and a `''` slug must not match any card. `fleet.ts` also reads members for its sprint counts, so check that a bare item counts the way the release gate counts it.

`packages/board/test/unit/sprint-members.test.ts:45` filters lines with `/^- \[[ x]\] \[/`, so its oracle bakes the bracket in. Do not rewrite that test to hide bare lines. Add bare-item cases beside it.

### The corpus pair will meet two populations the plan does not name

Measured on this estate 2026-09-24, re-checked 2026-09-25. A test over `docs/sprints/*.md` comparing the three readers' item sets will disagree on both of these even after the fix:

- **Struck-through references, 4 lines.** `- [x] ~~[slug]~~ …` in `2026-W36-a-half-landed-workflow-says-so.md:56`, `2026-W36-the-domain-is-one-implementation.md:93`, and `2026-W41-a-declared-agent-costs-what-it-costs.md:76`, `:79`. The release reader counts each as an item with its slug. With the bracket optional, both TS readers will count each as a bare item with no slug. That is a disagreement about the slug, not about whether the line is an item.
- **Duplicate slugs, 2 files.** `2026-W34-working-shows-the-agent.md` and `2026-W35-the-board-tells-the-truth-in-every-section.md` list a slug more than once. `emit_tier` does not dedupe, so it reports every line; both TS readers keep the first. That is a disagreement about membership versus lines.

The plan's corpus question is *which lines are items, and at which tier*. Compare on that question, over lines, before any dedup, and compare tiers. Where a comparison field also covers the slug or the member count, these two populations make it fail. **On that failure, stop and report; do not adjust either reader or the corpus to make it pass.** `docs/shell-and-domain.md` forbids that move, and the plan repeats it. Name the population, its count, and the lines in the PR body or in a `PLOT-BLOCKED.md`, so a person decides whether the strike-through handling or the dedup belongs in a follow-up plan.

The existing pattern to copy is `packages/domain/corpus/sprint-score.corpus.test.ts` with `compare.ts` and `production.ts`: production supplies the shell's reading, and a disagreement names both answers and the subject.

### Done when

The plan's `### Done when` list is the specification. The assertions that exist because a naive fix passes without them:

- **An all-bare Must sprint commits, and the test asserts the item count.** It catches the 2-of-3 regex-only fix.
- **Two identical bare lines are two items.** It catches a dedup keyed on text.
- **An empty `### Must Have` is still refused with `commitment-empty`.** It catches a fix that removes the refusal instead of feeding it items.
- **The board renders a bare-item sprint's members with their text and without the unknown badge.** It catches a fix that lands in the transition only, which the plan calls *"green and wrong"*.
- **The corpus pair covers all three readers**, including `parseSprintMembers`. A pair of two misses the board.

Plus the repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds `board-server.mjs` and the transition bundle; commit the rebuilt artifacts), `pnpm run typecheck`, and the domain package's tests, which include `corpus/`. Do not run `pnpm run test:e2e`: it is CI's gate. Add a changeset: `'@plot-pm/board': patch` with the description first, and a `plan:` line inside the trailing comment block if you add one.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Say in the PR body that #966's title names the symptom, so its retitling can follow the merge.

### Scope guard

This branch owns `packages/board/src/server/entry/sprint-transition.ts`, the sprint-member parser and `collectSprints` in `packages/board/src/server/board.ts`, `SprintMemberSchema` in `packages/board/src/contract/schema.ts`, `packages/board/src/app/components/SprintModal.tsx`, the sprint tests under `packages/board/test/unit/` (`sprint-transition.test.ts`, `sprint-members.test.ts`, `fleet-sprints.test.ts`), a new corpus test under `packages/domain/corpus/`, and the rebuilt artifacts under `skills/plot/scripts/board/`.

It does not own `skills/plot/scripts/plot-sprint-release.sh`, `packages/domain/src/entities/sprint.ts` (`scoreItem`, `isPromised`), or `transitions/sprint.ts`. `board.ts` and `schema.ts` are shared files. Checked 2026-09-25 over the unmerged remote branches and the local worktrees: only `feature/one-monitor-watches-the-slice` edits `packages/board/src/contract/schema.ts`, and no branch in flight edits `board.ts`, `SprintModal.tsx`, `filters.ts`, `sprint-transition.ts` or `packages/domain/corpus/`. Expect a rebase on `schema.ts`, and resolve a `board-server.mjs` conflict by rebuilding it, never by reading the diff.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

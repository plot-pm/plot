# Contracts lens — what does this change promise, and what breaks?

Position: amend

The diagnosis is correct and verified. `MEMBER_LINE` (`packages/board/src/server/entry/sprint-transition.ts:64`) requires the second bracket, `itemsFrom:98` does `if (!m) continue`, and the dedup at `:100-101` keys on `m[2]` so bare items would all collide on `''`. The plan's measured 1-of-3 / 2-of-3 table reproduces. The fix is right; **three contract gaps below make the slice as written land wrong.** Each is a specific amendment, not a reason to reject.

---

## 1. The Open Question is answered, and the answer is a THIRD writer this plan does not scope

The plan's own Open Question (line 117) asks whether `parseSprintMembers` shares the parser. **It does not share it — it is a second copy, and it is on the board's live render path.**

- `packages/board/src/server/board.ts:1148` — `const SPRINT_MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]/;` — the same mandatory bracket, the same first-wins dedup on `m[2]` (`:1161-1180`), and the same TSDoc rationale copied across.
- It feeds `parseSprintContent:1286` → `members:` → `SprintCardSchema.members` (`contract/schema.ts:770`) and `FleetSprint.members` (`:3658`).
- Consumers: `fleet.ts:7293 sprintMembership()` (which Active sprint owns a plan → the board's sprint column), `fleet.ts:7350 activeSprints()` (the four exhaustive counts the Agents-tab chip renders), and client-side `sprintMembershipLookup` in `filters.ts:24`, used by `Board.tsx:186`, `Swimlanes.tsx:131`, `App.tsx:900`, `AgentList.tsx:478`.

So the blast radius **is three readers, not two**, and the plan says so itself and then does not act on it. The Changelog's *"Board impact: yes"* is asserted and the slice contains no board work.

**Amend:** either bring `board.ts:1148` into the same change, or state explicitly and in the plan why the board keeps the old reading. Leaving it undecided ships the same disagreement one reader over, with the plan having named it first.

**And there is a type reason it cannot simply be copied.** `SprintMemberSchema.slug` is `z.string()` with no `''` case documented (`schema.ts:705`), and `sprintMembership()` keys a `Map<string, string>` on `member.slug` (`fleet.ts:7302`). Admit bare items there and **every bare item collides on `''`** in a map keyed by slug — the same defect the plan caught in `itemsFrom`, one layer up, and the domain already states the contract the board does not: `SprintItem.plan` is *"`''` when the line names no plan"* (`entities/sprint.ts:53`) and `sprintMembers()` filters `slug !== ''` (`:150`). The board has no such filter.

## 2. The corpus test as specified FAILS ON LANDING — on cases this plan scopes out

The plan promises a corpus pair comparing *"which lines are items, and at which tier"* (line 102/123) and simultaneously says it *"does not touch the struck-through `~~[slug]~~` handling"* (line 113). **These two promises contradict each other on this repository's real estate.**

Measured over all 14 files in `docs/sprints/`, comparing the post-fix regex against `plot-sprint-release.sh:249`'s `'^(~~)?\[[a-z0-9][a-z0-9-]*\]'`:

| sprint | tier | domain reads | shell reads |
|---|---|---|---|
| `2026-W36-a-half-landed-workflow-says-so` | **must** | `""` | `the-board-watches-instead-of-re-asking` |
| `2026-W36-the-domain-is-one-implementation` | could | `""` | `the-board-suite-fits-its-budget` |
| `2026-W41-a-declared-agent-costs-what-it-costs` | could | `""` | `a-connector-declares-its-ceiling` |
| `2026-W41-a-declared-agent-costs-what-it-costs` | could | `""` | `a-complete-page-is-not-truncated` |

Four real disagreements, one of them a **Must**. The shell strips `~~` deliberately and says why in a comment it measured on 2026-09-08 (`plot-sprint-release.sh:243-249`); the domain regex has no `~~` clause and never will under this plan's stated scope.

`packages/domain/corpus/README.md` forbids the one move that would make this pass: *"Adjusting either side to make the comparison pass is the one move forbidden here."* Its stated remedy is the amendment: *"A known divergence is declared, not skipped … names those subjects with the reason and asserts the set exactly."*

**Amend:** either add the optional `~~` to the domain regex (one character class, inside scope), or specify the corpus pair with those four subjects as a declared divergence set. The plan must say which — "Done when" line 123 as written is unachievable.

## 3. What the corpus pair should compare — and one thing it must not

Item sets **and** tiers, keyed per sprint file. Both are safe to compare and both are the thing that drifted.

But **it must not compare the `plan` slug field naively**, for a reason beyond §2: the two readers extract different things from the same line. Verified against real lines —

- `- [ ] Close [#935](https://github.com/plot-pm/plot/issues/935) — …` (W39, could): the post-fix domain regex captures `#935` as the plan; the shell's `[a-z0-9][a-z0-9-]*` anchor rejects it and answers `''`. **The plan's own note at line 76** — *"the capture is `[^\]]+`, any text in brackets"* — identifies this as the reason a linked non-plan item commits, then carries it forward into the fix unchanged.

That is the scoring seam. A `#935` "slug" flows to `scoreItem` as a plan lookup that finds nothing; the shell's `''` flows as `no-plan-named`. Both produce `open` for an unchecked box by luck, and diverge the moment the box is ticked: `disputed` versus `done` (`entities/sprint.ts:120-127`).

**Amend:** narrow the domain's capture to the shell's slug shape, or compare item-identity and tier only and declare the slug field out of the pair with the reason.

## 4. The dedup question the plan raises and leaves open

Line 87 says the key must be *"the plan where there is one, and the line's own identity otherwise"* and never says what "identity" is.

Measured: **no two identical bare lines exist in any sprint in `docs/sprints/`.** So this is a design decision with no current evidence, not a live defect — which is exactly why it needs stating rather than discovering later.

The right answer follows from the existing contract and costs one sentence: dedup exists *"because a plan cut into several slices is listed once per slice"* (`entities/sprint.ts:143`). A bare item names no plan and can be listed once per slice of nothing, so **there is no reason to dedup bare items at all** — key them by line index, i.e. never collide. Two identical bare Musts then count 2, which is the honest reading of a file that wrote the task twice. **Amend to say this explicitly**, because `Set`-with-line-text (the other natural reading of "the line's own identity") silently drops the second, and the plan's own "Done when" demands the COUNT be asserted.

---

## What checks out

- **`scoreItem` handles a bare item correctly and needs no change** (`entities/sprint.ts:118-127`). `delivered === 'no-plan-named'` → `item.checked ? 'done' : 'open'`; it can never be `disputed`, documented at `:113-115` as *"a dispute is a disagreement between two sources and such an item has one."* An unchecked bare Must scores `open`. Confirmed.
- **No other refusal in `setSprintState` changes for any existing sprint.** `state-unrecognised` (`transitions/sprint.ts:219`), `state-unreachable` (`:253`) and `release-unnamed` (`:268`) read `sprint.state`, `NEXT` and `sprint.release` — never `items`. `commitment-empty` (`:259`, via `isPromised` on `tier`) is the only item-dependent gate, and it is the one the plan targets.
- **Measured over all 14 real sprints**, the fix changes the Must count on exactly one: `2026-W36-a-half-landed-workflow-says-so`, must 4 → 5 — and that is the struck-through line from §2, so it is admitted at `plan: ''` and scored `done` on its `[x]`, when the shell scores it against a real delivered plan. Same answer today, different reasoning, and it is the case §2 asks to be declared. Item totals move on 5 of 14 files (10→13, 8→9, 22→23, 12→14, 11→13); **all 5 are non-Must or struck**, so no currently-Committed or Active sprint changes its commitment. The naive-fix trap the plan warns about is real here too: W34 reads 11 under naive dedup against 13 under correct dedup.
- **`SKILL.md:240` does document both forms**, verbatim: *"Item format: `- [ ] [slug] description` (plan reference) or `- [ ] description` (lightweight task)."* The plan's citation is accurate, and it is the strongest argument that the release reader is right.
- **`openPromises` (`transitions/sprint.ts:327`) has no production caller** — exported from `index.ts:398`, otherwise only tests. It already handles `item.plan === ''` → `'no-plan-named'` (`:331`), so it is correct in advance and changes nothing today.
- **`release-gate.ts:133`'s `itemsFrom` is a different function** reading the shell's JSON report, not sprint markdown. Not affected. Worth naming in the plan so an implementer does not edit the wrong one — the names are identical and both are exported.

## Summary of amendments

1. Decide `board.ts:1148` — fix it with the transition, or state in the plan why it keeps the old reading. Its `Map` keyed on `member.slug` collides on `''` if fixed naively.
2. Resolve the §2 contradiction: admit `~~`, or declare the four measured subjects as a divergence set. As written, "Done when" line 123 cannot be satisfied.
3. Say what the corpus pair compares, and exclude or narrow the slug field — `#935` is captured as a plan by the post-fix regex.
4. State the bare-item dedup key as "never collides" and say why.

## Implementation brief — a-plan-is-questioned-before-it-is-approved (wave 1: A plan is questioned before approval)

- **Plan (canonical):** `docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-plan-is-questioned-before-it-is-approved` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

This is wave 1 of two. Wave 2, `feature/a-delivery-verdict-names-what-it-ran`, is the delivery-side caller and waits on nothing this branch produces — the two callers *"share the mechanism and nothing else."* What this branch genuinely waits on is **not in this plan**: see the next section.

### The mechanism is built, unmerged, and you must not rebuild it

**Measured 2026-09-12.** `feature/a-panel-questions-one-plan` carries the whole panel mechanism and **has no PR** (`plot-pr-state.sh` answers `{"found": false}`). It is dispatched work in flight, not landed work. Against `origin/main` it adds:

| what | where |
|---|---|
| `readJuror`, `readPanel`, `commitmentLine`, `panelDir`, `jurorPath`, `moderationPath` | `packages/domain/src/rules/panel.ts` (217 lines) |
| the rule's tests | `packages/domain/test/panel.test.ts` (196 lines) |
| the controller entry | `packages/board/src/server/entry/panel.ts` (171 lines) |
| the shipped bundle | `skills/plot/scripts/board/plot-panel.mjs` |
| the skill | `skills/plot-panel/SKILL.md`, `README.md` |

**So this branch is a caller and writes no mechanism.** Do not add a second verdict parser, a second commitment check, or a second reconciler. If `skills/plot-panel/` is absent from your checkout, it is because that branch has not merged — say so and stop, rather than building what it holds.

**Read the mechanism's real contract before writing the caller**, from the branch rather than from this brief:

```bash
git show origin/feature/a-panel-questions-one-plan:skills/plot-panel/SKILL.md
git show origin/feature/a-panel-questions-one-plan:packages/domain/src/rules/panel.ts
```

The four parameters a caller supplies are **Subject** (one plan path), **Lenses** (the personas, caller's choice of N), **Commitment** (a label plus the words that count as a position) and **Rubric** (the questions, identical across lenses). The gate is `plot-panel.mjs check <label> <positions> <lens> < juror.md` — exit `0` committed, `3` refused, `2` unusable arguments — and `plot-panel.mjs reconcile`, which answers `unanimous`, `divided` or `refused`.

**Your commitment vocabulary is `proceed|amend|reject`.** The mechanism takes it as a parameter and knows none of the words.

### What to build

**73% of plans reach implementation unquestioned.** Re-measured on this branch's base 2026-09-12: **268 plans, 73 carrying a `Rounds:` field** — 27.2%. The panel skill publishes 268/74 from a slightly later reading. Use the numbers you measure at implementation time and say when you took them; do not copy the plan's `262 / 71`, which is stale.

Two deliverables:

1. **A Draft panel inside `/challenge-the-plan`.** The parallel, persona-driven engine that runs when nobody is there, calling `/plot-panel` with Draft lenses. Its subject is the plan **plus its sprint siblings**.
2. **A verdict gate on `/plot-approve`.** A juror returning `reject` refuses the approval.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The gate fires on a verdict, never on a ritual.** A plan nobody has questioned is approvable exactly as it is today. This is what keeps the 73% from becoming unapprovable overnight, and it is the difference between a gate people keep and one they turn off — `a-merged-pr-carried-work`'s call, made again here. Do **not** implement "refuse an unquestioned plan."

**A reject is cleared by a later round that no longer rejects — never by an override.** No override flag, no waiver field, no recorded reason. The plan is amended and re-questioned; approval unblocks when no juror rejects, and the next round is the evidence. An override is a claim about a conversation nobody else saw; a round is re-derivable by anyone who reads the plan later.

**`/challenge-the-plan` keeps its name, its Open Questions section and its `Rounds:` record.** The alternative — a second interrogation surface beside the first — means plans get challenged two ways and neither is authoritative. One surface, a faster engine inside it.

**Interactive mode stays.** The panel is what runs when nobody is there. Removing the interview would delete the mode that produced all 73 existing rounds.

**Prose quality is deliberately not a lens.** A juror reporting awkward wording alongside a missed deliverable dilutes both. Do not add a writing lens.

**Lenses do not transfer between the two panels, and the mechanism knows none of them.** A Draft lens asking *does the estate already have this?* is meaningless at delivery. Name your Draft lenses in this skill; do not put them in `packages/domain/`.

**How many jurors is yours to choose and nobody has measured it.** The plan and the mechanism both say four is a guess. Do not hardcode a number in the mechanism; the first real number comes from running it.

### The sibling set — the plan's own answer is now stale

The plan's Open Questions say: *"The sprint when one is active; every unfinished plan when none is. All six sprints are Closed today, so the fallback is the normal case."*

**The second sentence is false as of this branch's base.** Measured 2026-09-12:

- `docs/sprints/active/an-agent-is-declared-and-corrected.md` exists — sprint **W40 is Active**, with **10 items**, of which this plan is one.
- Unfinished plans across the estate (phase neither Delivered nor Released): **15**.

So the **sprint path is the normal case and the fallback is the exception** — the reverse of what the plan assumes. Build both arms; the rule itself is unchanged and still correct. Do not carry the plan's "~6 plans" sizing into a bound: measure it.

**The set is bounded and the panel names what it dropped.** Most recently amended first, up to N, and the output says how many siblings went unread. **A panel that silently truncates is a panel whose blind spot is invisible** — `plot-reconcile-scan.sh`'s rule, that a finding is reported rather than decided. With 10 sprint members the bound may not bind today; the report of what was dropped is still owed, because it is what makes the bound safe when it does.

The contradiction this exists to catch, measured in this story's own preparation: a plan proposed fixing a per-board cap that `fleet.ts:2691` already read from the shared registry. A juror holding the sibling plans would have seen it.

### Writing `Rounds:` — the one place a naive implementation corrupts history

The panel writes a round exactly as an interactive one does, and `/challenge-the-plan` Phase 5b already states the rule. **Carry it over unchanged:**

- **Replace-or-insert-after-`Impl:`.** If a `- **Rounds:**` line exists in `## Status`, replace that line. If not, insert immediately after `- **Impl:**`. Never a rewrite of the section, never a reflow, never an insert computed from a line number — `## Status` holds the `Approved:` / `Started:` / `Delivered:` / `Released:` transition records, facts nothing in the repo can reconstruct.
- **One metadata block, replaced in place.** A second `CHALLENGE-THE-PLAN-METADATA` block freezes the count: the parser reads only the first `"round":` line it finds.
- **`"round": <integer>` on its own line, in a multi-line HTML comment.** That exact line is the only thing `plot-plan-meta.sh` reads out of the block. A single-line `<!-- … -->` block is treated as a placeholder and produces no count.
- **A round that changed nothing is still a round.** Absent and `0` are deliberately different: absent means nobody looked.

**Open question the plan leaves open, and this slice does not close it:** whether `Rounds:` should distinguish a panel round from an interactive one. It stays one field here. A second field is a plan-format change and needs its own argument — do not invent one.

### Where the approve gate goes

`plot-approve.sh` **refuses `Review: in-session` and `ballot` by name** — a script cannot stand in for a human reviewer or read a ballot. This plan's own `Review:` is `in-session`. So the verdict gate is a **skill-level** check in `/plot-approve`, not a new refusal inside `plot-approve.sh`, unless you can show the script sees every channel the gate must cover. Say which you chose and why.

Two invariants this repo keeps re-learning: **absent is not false** — a plan with no panel record is unquestioned, not "questioned and clean." And **read the exit code, not the emptiness** — `plot-panel.mjs` exits `3` for a refusal and `2` for unusable arguments, and a missing bundle is a broken installation rather than a clean panel.

### Done when

The plan ships no `## Done when` list, so its Slices section is the specification: the Draft panel and its lenses, reading the plan plus its sprint siblings.

Lift these assertions, each because a naive implementation passes without them:

- **A plan with no panel record approves unchanged.** Catches a gate built on existence rather than verdict — the one failure that would make 73% of this estate unapprovable.
- **A `reject` refuses the approval, and a later round with no `reject` clears it without any override.** Catches a waiver flag creeping in.
- **`Rounds:` is replaced in place and `## Status` keeps every transition record.** Catches the greedy-match rewrite that destroys `Approved:` / `Started:` lines — the failure Phase 5b is written to prevent, and one an implementer only sees by diffing a plan that had those lines.
- **The sibling set falls back to unfinished plans when no sprint is active, and the output names how many siblings went unread.** The fallback arm has no live exercise today (W40 is Active), so nothing else will catch it.
- **No second verdict parser, commitment check or reconciler is added.** `git grep` for a local re-implementation; the mechanism branch owns all three.
- **Interactive mode still runs.** Catches the panel replacing the interview rather than joining it.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:contracts`, and `pnpm run test:board` if you touch `packages/`. A changeset is required — description **first**, `bumps:` block **last**, package `plot`, and it may name this plan on a `plan:` line. **Do not run `pnpm run test:e2e`** — it is CI's gate, and two local runs once produced 53 concurrent test processes and took an operator's board down.

Every skill question needs a `PLOT-UNASKED` line; a sweep test checks all skills. A panel is **unattended-first** — its reason for existing is that rounds cost attention, so every step needs defined behaviour with nobody watching.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the wave heading the plan names this branch under. Measured 2026-09-08, three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/challenge-the-plan/`, the approve-side gate in `skills/plot-approve/`, and whatever Draft-lens definitions the panel caller needs.

**Verified 2026-09-12** — every remote branch diffed against `origin/main` for files matching `challenge-the-plan|plot-approve|plot-panel|rules/panel`:

- `feature/a-panel-questions-one-plan` holds `packages/domain/src/rules/panel.ts`, `skills/plot/scripts/board/plot-panel.mjs` and all of `skills/plot-panel/`. **Those files are its, not yours.** It also edits this plan's own file and the W40 sprint file, so expect a conflict there and resolve toward main.
- **No other branch touches any of the four.** `skills/challenge-the-plan/` and `skills/plot-approve/` are exclusively yours.

If `skills/plot-panel/` has merged by the time you start, rebase onto it and call it. If it has not, you are building a caller for an interface you can read but not run — say so in the PR, and do not vendor a copy to get green.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

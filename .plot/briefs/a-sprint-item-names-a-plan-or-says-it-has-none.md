## Implementation brief — a-sprint-item-names-a-plan-or-says-it-has-none

- **Plan (canonical):** `docs/plans/2026-09-28-a-sprint-item-names-a-plan-or-says-it-has-none.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-sprint-item-names-a-plan-or-says-it-has-none` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #1045

Single-slice plan; nothing waits on it and it waits on nothing.

### What to build

One sprint-file line format has three readers, and they disagree about what an item's reference is:

| Reader | File | Consumer |
|---|---|---|
| `emit_tier` | `skills/plot/scripts/plot-sprint-release.sh:230` | `plot-release-gate.sh` → `release()`, `/plot-release`, reconcile §17 |
| `itemsFrom` | `packages/board/src/server/entry/sprint-transition.ts:108` | `setSprintState` via `plot-sprint-state.sh` |
| `parseSprintMembers` | `packages/board/src/server/board.ts:1168` | the board's sprint counts (`fleet.ts:7532`) and member list |

The shell matches the reference with `^(~~)?\[[a-z0-9][a-z0-9-]*\]` (`:249`): slug-shaped only, strike allowed. Both TypeScript readers use `^- \[( |x)\] (?:\[([^\]]+)\]\s*)?(.*)$`: any bracketed text, no strike. So `[#1039](…)` reads `""` in the shell and `#1039` in TypeScript, and `~~[slug]~~` reads `slug` in the shell and `""` in TypeScript.

**The PR's deliverable is a decision, then the code that follows from it.** The plan names three shapes and requires the PR to state which was chosen and why the other two were rejected. The plan is canonical; this brief is orientation.

### The population is the struck-through lines, not the issue-linked ones

The plan was written about issue-linked items. After `f6c7c9ef` rewrote W40, **zero** issue-linked items exist on the estate. The live disagreement is the five struck-through lines. Re-measured 2026-09-29 at `dcde0afa`, with each plan's phase from `plot-plan-meta.sh`:

| Sprint (state) | Tier | Box | Plan phase | Shell scores | TypeScript scores |
|---|---|---|---|---|---|
| W36 `a-half-landed-workflow-says-so` (Closed) | — | `[x]` | released | done | done |
| W36 `the-domain-is-one-implementation` (Closed) | — | `[x]` | rejected | **withdrawn** | **done** |
| W40 `plot-observes-and-recovers-its-own-fleet` (**Active**, Release 2.21.1) | Should | `[ ]` | superseded | **withdrawn** | **open** |
| W41 `a-declared-agent-costs-what-it-costs` (Closed), line 76 | Could | `[ ]` | rejected | **withdrawn** | **open** |
| W41, line 79 | Could | `[ ]` | rejected | **withdrawn** | **open** |

"TypeScript scores" is `scoreItem(item, 'no-plan-named')`, which is what a `""` slug reaches (`entities/sprint.ts:125-130`, `fleet.ts:7532`).

**The panel's framing of the gate is one step too strong. Verify this before arguing from it.** `release()` gets its items only from `release-gate.ts:itemsFrom`, which parses the **shell's** JSON (`release-gate.ts:216` is the only writer of `sprintItems`). So the release gate reads the struck line as `withdrawn` today and excludes it (`release.ts:178-180`). The TypeScript reading reaches:

- **the board's sprint counts**: W40's chip counts its struck Should as `open`, where the release gate counts it as `withdrawn`. That is a live disagreement on the Active sprint.
- **`openPromises`** (`transitions/sprint.ts:327`), which is exported and has **no caller** in `packages/*/src`. A future caller inherits the disagreement.
- **`setSprintState`**, which reads the tier only (`transitions/sprint.ts:260`) and is not affected.

So *strike a Must and the gate refuses differently* is not true today. *Strike a Must and the board shows it open while the release gate lets it through* is true. Put the measured version in the PR.

### Settled facts — do not re-derive them

**Shape 2 (an issue in its own field) makes a ticked issue-only Must uncloseable.** Both jurors measured it. The slug lookup misses, `scoreItem` returns `disputed` for a checked item over an undelivered plan, and `release.ts:179` counts `disputed` as unfinished. The plan's recommendation produces the outcome it wanted to avoid. A shape-2 argument must add a scoring path for "names an issue" that is not the plan-lookup path, or it is rejected on this measurement.

**Shape 3 (refuse at write time) has no reader to extend.** `plot-sprint-state.sh` → `setSprintState` reads no item reference; a refusal would be the first write-path code to read one. It also refuses W40 line 41 (`~~[slug](…)~~` leads the line) unless the strike is carved out by name.

**Shape 1 (all say `""`) loses the distinction between a legal item and a malformed one.** The plan's `Done when` requires the release gate to tell them apart, so shape 1 needs a second signal or is rejected on that line.

**Whatever the shape, the strike must be read the same way by all three.** The corpus footnote (`sprint-item.corpus.test.ts`, limit 1) calls "should the TypeScript readers learn the strike-through" a follow-up decision. This plan is that decision: the scoring table above is the case for it. The shell's reading (strike → slug → `withdrawn` from the plan's phase) is the one the release gate already relies on.

**The TypeScript regex is broad on purpose.** `sprint-transition.ts:69-72` says `[#966](…)` is a reference this estate writes, and narrowing the bracket drops a line the release reader keeps. If the PR narrows it, it must say what `[#N]` becomes (an item with no plan, or a refusal) and assert it.

**Corrections of fact, re-checked 2026-09-29:**

- `.plot/templates/sprint.md` does not exist (the panel is right). **`skills/plot/templates/sprint.md` does exist**, and `skills/plot-sprint/SKILL.md:238` tells `/plot-sprint` to write from it. That template is where an author learns the item shape (`- [ ] <items>`, line 21), so it is the place to teach the rule.
- `skills/plot-sprint/SKILL.md:240` documents two forms, `- [ ] [slug] description` and `- [ ] description`. It documents neither `~~[slug]~~` nor `[#N](url)`. Whichever shape wins, this line and the template must state it. Otherwise the next author follows the visible pattern again.

**Rules carried over unchanged:**

- **Neither side is authoritative, and on a disagreement the branch stops** (`docs/shell-and-domain.md`). Changing a reader is allowed here because the plan decides it. Changing the corpus test's expectations to make a disagreement pass is not allowed.
- **Absent is not false.** A reader that cannot parse a reference must not score it as "no plan named" silently if the chosen shape says the two differ.
- **The two TypeScript readers stay identical.** `parseSprintMembers`' comment says so (`board.ts:1186`). If one changes, the other changes in the same commit.
- **Dedup keys stay as they are**: slug where there is one, `line:<n>` otherwise, never text (`sprint-transition.ts:92-106`).

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation passes without them:

- **The comparison goes through the real readers, not the corpus file's replicated regex.** `sprint-item.corpus.test.ts` carries a deliberate third copy of the TypeScript rule (its own `MEMBER_LINE`). A fix that edits only that copy turns the corpus green and leaves the board's reading unchanged. Assert on `itemsFrom` and `parseSprintMembers` (or the board payload), and on `plot-sprint-release.sh`'s JSON.
- **The issue-linked fixture is a fixture, since the estate holds none.** The corpus tests read the live `docs/sprints/`, so a test over the estate alone proves nothing about `[#N](…)`. Add a fixture sprint that carries an issue-linked item, a struck-through item, a bare item and a malformed item, and run all three readers over it.
- **Compare the scored state, not only the slug.** The slug test excludes the struck population by name, and no corpus test compares `open` against `withdrawn`, which is where the board and the gate part. If the strike becomes a shared reading, remove the exclusion and update the pin (`expect(struckThrough).toBe(5)`) in the same commit, with the reason in the commit message.
- **A malformed item stays distinguishable from a legal no-plan item**, asserted on what the release gate receives, not on a parser's internals.
- **Historical sprints parse unchanged**, asserted over every file in `docs/sprints/`. The W36 `[x]` rejected line changes from `done` to `withdrawn` on the TypeScript side if the strike is learned. Both are excluded from `unfinished`, so the gate is unchanged. Name it in the PR as the one intended change of reading.
- **The PR body states the chosen shape and why the other two were rejected**, with the measurements above.

Plus the repo gates:

- `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds the artifact), `pnpm run typecheck`, and the domain corpus tier (`packages/domain`, vitest).
- `pnpm build:board` and commit the rebuilt bundles if `packages/board/src` changes (`board-server.mjs`, `plot-sprint-transition.mjs`, `plot-sprint-score.mjs` as affected). CI's artifact gate diffs every bundle.
- A changeset, description first, `bumps:` block last, with a `plan:` line. `'plot': patch` for the shell and skill text (bump `plot-sprint: patch` if its SKILL.md changes), and a separate `'@plot-pm/board': patch` changeset for the board readers.
- Arrow functions for any function written or rewritten, in board files too.
- Not `test:e2e`: that is CI's job.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Do not run `gh pr create`.
- When the PR exists, append `, PR: #N` inside the slice heading in the plan's `## Slices`: `### A sprint item names a plan or says it has none (Branch: bug/a-sprint-item-names-a-plan-or-says-it-has-none, PR: #N)`. This plan uses the heading form, and a trailing `→ #N` parses as `prs=[]`.
- Do not edit W40's sprint file to change the population. Rewriting items made the corpus green on 2026-09-28 and hid the defect. That is the workaround the plan names, not the fix.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-sprint-release.sh` (`emit_tier` only)
- `packages/board/src/server/entry/sprint-transition.ts` (`MEMBER_LINE`, `itemsFrom`)
- `packages/board/src/server/board.ts` (`SPRINT_MEMBER_LINE`, `parseSprintMembers`) and, if the scoring changes, the bare-member branch at `packages/board/src/server/fleet.ts:7532`
- `packages/domain/corpus/sprint-item.corpus.test.ts` and a new fixture sprint
- `skills/plot/templates/sprint.md` and `skills/plot-sprint/SKILL.md:240` (the documented item forms)
- the rebuilt board bundles and the changesets

It does not touch:

- `scoreItem` and `release()`: the rule is right, and the readers feed it. If the chosen shape needs a new `PlanDelivery` value, report it before building it. That widens a domain type other callers read.
- the BSD `sed` `\t` defect at `plot-sprint-release.sh:241` (limit 3 in the corpus footnote). It is real and it is a separate issue. Do not fold it in.
- historical sprint files.
- the struck-through pin's unsettled question, *do Closed sprints reach `release()`*. `plot-sprint-release.sh` reports every active sprint, and W41 is Closed. Report what you find; do not build on it.

At dispatch (2026-09-29, `dcde0afa`), no remote branch other than `changeset-release/main` exists, and no open PR touches these files. The other W40 slices in flight (`a-supervisor-says-which-checkout-it-serves`, `a-label-override-reaches-the-unit`, `a-row-is-owned-by-more-than-its-pr`) own `plot-fleetctl.sh`, the unit templates and `ownership.ts`/`mine-filter.ts`. None of them overlaps this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

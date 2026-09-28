## Implementation brief — the-jury-button-names-its-caller

- **Plan (canonical):** `docs/plans/2026-09-28-the-jury-button-names-its-caller.md` on `main`
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Branch:** `bug/the-jury-button-names-its-caller` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1035

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

`composeInterrogatePrompt` (`packages/board/src/server/interrogate.ts:114`) asks for `/plot-panel` and supplies **one** of its four parameters. `/plot-panel`'s unattended rule refuses when one is missing (`skills/plot-panel/SKILL.md:104`), so every click produces a refusal and writes nothing.

Ask for `/challenge-the-plan` instead. It is the Draft-plan caller and already supplies all four — verified by the panel: Subject `:193`, Lenses `:203-208`, Commitment `Position: proceed | amend | reject` at `:224`, Rubric `:238`.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The routing already works — do not add anything to make it work.** `interrogate.ts:317` sets `PLOT_UNATTENDED: '1'` in the child's env, and `challenge-the-plan/SKILL.md:58-59` routes on exactly that: *"`PLOT_UNATTENDED=1` → the panel."* The skill ships in the same plugin the runner loads.

**Do not give the board its own lenses, commitment or rubric.** That was the first draft and it is a third copy beside `/challenge-the-plan`'s and `/plot-deliver`'s. A rubric inlined in TypeScript is prose no skill author would think to update.

**THREE SITES PIN THE OLD PROMPT, NOT ONE.** `grep -n 'plot-panel' packages/board/test/unit/interrogate-route.test.ts`:

- `:173` — `assert.match(prompt, /^\/plot-panel docs\/plans\/x\.md$/m)`, the obvious one.
- `:185` — a **different test**, *"names the real plan file, relative to the repo"*, with the same pin.
- `:229` — **not an assertion.** It is the stub runner's parser: `plan=$(sed -n "1s|^/plot-panel ||p" "$PLOT_INTERROGATE_PROMPT")`. Against a `/challenge-the-plan` prompt it returns empty, the stub then runs `cp "" "$seen"`, and the test fails three lines later on an empty variable — **naming neither the prompt nor the skill.** Fix all three or you will diagnose that from scratch.

**The button inherits three behaviours beyond running a panel, and the plan names them deliberately.** Settled with the operator: it gets all three.

- **A sibling comparison** (`challenge-the-plan/SKILL.md:172-196`) — each juror reads the subject plus up to 9 sprint members, or 27 unfinished plans with no sprint. That is the button's real cost.
- **Open Points written into the plan body** (`:243-248`) — a **fourth** artifact. `interrogate.ts:18-20` lists three; update that docstring.
- **A `CHALLENGE-THE-PLAN-METADATA` block** (`:353-380`) beside `Rounds:` — 71 plans carry one against 158 carrying `Rounds:`, so the button starts adding it. Name it in the docstring too.

**Rewrite the tests, do not delete them.** `:173` and `:185` assert today's behaviour as intended, and the fix changes what is intended. The rewritten assertion tests that the prompt names a caller supplying all four parameters — not merely that the string changed.

**Out of scope:** `/plot-panel` itself (`readJuror` and `readPanel` learn no vocabulary — that genericity is why the mechanism was extracted); the route, spawn, log, status read-back and button, all of which work; `Interrogate command`, which is configured and correct.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **A real click produces juror files, a `panel.md` and a `Rounds:` increment.** The suite is 9/9 green today while the capability cannot work — nothing in it asks whether a panel appears, and that is the defect in miniature.
- **All three sites handled.** A test run that passes with `:229` untouched means you did not reach it.
- The route docstring names Open Points and the metadata block.
- The board still holds no lens, commitment or rubric text.

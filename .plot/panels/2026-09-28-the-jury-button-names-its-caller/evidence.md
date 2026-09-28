Position: amend
Evidence: executed

# Evidence lens — the jury button names its caller

## What I ran

| # | Command | What it showed |
|---|---|---|
| 1 | `cat .worktrees/plot-interrogate-a-dispatch-promises-a-worker.{state,prompt.md,log}` | The measured click exists on disk. State `0`, prompt is `composeInterrogatePrompt`'s exact output, log is the refusal. **The plan's motivation is verified verbatim.** |
| 2 | `corepack pnpm vitest run test/unit/interrogate-route.test.ts` | **9 passed.** The plan's claim that the suite is green while the capability cannot work is true. |
| 3 | `grep -n "plot-panel" packages/board/test/unit/interrogate-route.test.ts` | **Three sites, not one:** `:171` (named by the plan), `:185`, `:229`. |
| 4 | Ran the `:229` `sed` parser against a `/challenge-the-plan`-first prompt in `/tmp` | `parsed plan = []` — **empty.** The fix breaks a test the plan does not name. |
| 5 | `grep -n` over `skills/challenge-the-plan/SKILL.md` | All four parameters are there. Lenses `:203-208`, commitment `:224`, rubric `:238`, subject `:193`. |
| 6 | `ls docs/sprints/active/`, `grep -c '^- \['`, `grep -L 'State:.*\(Delivered\|Released\)' docs/plans/*.md \| wc -l` | Active sprint, **9 members**; fallback arm would be **27 plans**. |
| 7 | `grep -l "CHALLENGE-THE-PLAN-METADATA" docs/plans/*.md \| wc -l` vs `grep -l "Rounds:"` | **71 blocks against 158 `Rounds:` fields.** |
| 8 | `ls .plot/panels/2026-09-27-a-dispatch-promises-a-worker/` | `evidence.md`, `moderator.md` — the hand-run panel the plan cites is real. |

## The central claim holds

I tried to refute *"`/challenge-the-plan` already supplies all four parameters"* and could not. The lines are there:

- **Subject** — `skills/challenge-the-plan/SKILL.md:193`: *"The subject parameter stays ONE plan."*
- **Lenses** — `:203-208`, the four-row table (Estate, Contradiction, Deliverable, Cost).
- **Commitment** — `:224`: ``Position: proceed | amend | reject``, and `:227` *"`/plot-panel` knows none of these words"*.
- **Rubric** — `:238`: *"The rubric is identical across lenses; only the persona line differs."*
- **It calls and does not reimplement** — `:148`: *"This phase calls `/plot-panel` and implements none of it."*

The routing also works. `interrogate.ts:317` sets `PLOT_UNATTENDED: '1'` in the child's env, and `challenge-the-plan/SKILL.md:58-59` routes on exactly that: *"`PLOT_UNATTENDED=1` → the panel."* `challenge-the-plan` is a shipped skill directory (`skills/challenge-the-plan/`) inside the same plugin the runner loads, so the configured `claude -p` runner can reach it. **No false central claim. That is why this is `amend` and not `reject`.**

## What a measurement contradicts

### 1. "Rewrite the one test" — there are three sites, and the third is the one that breaks

`## Done when` names exactly one: *"`interrogate-route.test.ts`'s 'asks for /plot-panel on the plan path and chooses no parameters' is rewritten rather than deleted."* The `## Slices` line repeats it: *"rewrite the one test that pins the old shape."*

Measured, `grep -n "plot-panel"` on that file returns **three**:

- `:173` — `assert.match(prompt, /^\/plot-panel docs\/plans\/x\.md$/m)` — the named one.
- `:185` — `assert.match(prompt, new RegExp('/plot-panel docs/plans/…'))`, in *"names the real plan file, relative to the repo"*. A **different test**, same pin, unnamed by the plan.
- `:229` — not an assertion at all. It is the **stub runner's parser** inside *"a run records one round, and the board writes none"*:

```sh
plan=$(sed -n "1s|^/plot-panel ||p" "$PLOT_INTERROGATE_PROMPT")
```

I executed that `sed` against a prompt whose first line is `/challenge-the-plan docs/plans/x.md`. It returns **empty**. The stub then runs `cp "" "$seen"` and the whole test fails — not on the string it pins, but on a shell variable going empty three lines later. **That failure names neither `/plot-panel` nor the prompt**, so an implementer who rewrote only the test the plan names will hit it and have to diagnose it from scratch.

This is the plan's own defect in miniature. Its `## Notes` says *"a test can lock in a gap when it was written from the implementation rather than from the outcome"* — and the plan then counted the tests that pin the old shape by reading one test name rather than by grepping the file.

### 2. `/challenge-the-plan` does more than run a panel, and the plan does not say what the button gets

This is the sharpest finding and the plan does not address it at all. Asking for the caller means asking for the caller's **whole** Phase 3P, not just its four parameters:

- **The sibling set.** `:172-196` resolves siblings and puts them **in the rubric**. Measured now: the active sprint `plot-observes-and-recovers-its-own-fleet` has **9 members**, and the no-sprint fallback arm is **27 unfinished plans**. So each of N jurors reads the subject plus up to 9 sibling plans. The button's cost is not the panel the plan pictures — and `## Changelog` says *"No payload change, no schema change, no new capability"*, which is true of the code and silent about what the button now spends. The plan never mentions siblings.
- **Open Points.** `:243-248`: *"each juror's unresolved finding becomes an open point, in the section this skill already owns."* The button now **writes prose into the plan body**. `interrogate.ts:18-20`'s docstring says *"The route decides nothing. The skill writes the verdict files, `panel.md` and the plan's `Rounds:` increment"* — three artifacts. Open Points is a fourth, and the route's own documentation does not list it.
- **The metadata block.** Phase 5b (`:353-380`) writes `CHALLENGE-THE-PLAN-METADATA` in addition to `Rounds:`. `/plot-panel` step 6 explicitly does **not** — it points at 5b's rule and notes a direct interrogation *"needs no metadata block to do it."* Measured: **71 plans carry the block, 158 carry `Rounds:`.** So most interrogated plans on this estate have no block, and the button will start adding one. That is probably fine, but it is a behaviour change to the plan format that this plan does not name while claiming *"no schema change"*.

None of these is a reason to reject. The button asking for the richer caller is likely the right answer. But `## What this does NOT do` lists four things the plan does not change and omits the three things it **does** change, and a plan whose whole subject is *the prompt names the wrong thing* should be precise about what the right thing does.

### 3. "A test asserts the composed prompt names a caller that supplies all four parameters"

`## Done when` asks for this, and as written **no test can satisfy it.** `composeInterrogatePrompt` returns a string. A test can assert the string names `/challenge-the-plan`; it cannot assert that `/challenge-the-plan` supplies four parameters, because that fact lives in a markdown file in another directory. The bullet already anticipates the objection — *"not merely that the string changed"* — without saying what the stronger assertion reads.

There is a real test available and the plan should name it: assert against `skills/challenge-the-plan/SKILL.md` that the skill the prompt names contains the commitment line and the lens table, so a future rename or a gutted Phase 3P fails the board's suite. `plot-panel`'s own unattended sweep is the precedent — CLAUDE.md records that *"every question needs a PLOT-UNASKED line; a test sweeps all skills."* Without naming it, this bullet will be satisfied by `assert.match(prompt, /challenge-the-plan/)` and the plan will have asked for a gate and shipped a rule.

## What it must say before someone builds it

1. **Name all three sites.** `:173`, `:185`, and the stub parser at `:229`. Say that `:229` is a `sed` on the prompt's first line and that a first-line change makes it fail with an empty-variable error naming nothing.
2. **Say what the button now does beyond the panel** — sibling context in the rubric (9 today, 27 on the fallback arm), Open Points written into the plan body, and the `CHALLENGE-THE-PLAN-METADATA` block. If any is unwanted, the prompt must scope it out; if all are wanted, say so and amend `interrogate.ts:18-20`'s docstring, which lists three artifacts.
3. **Name the assertion** for the four-parameter bullet, or drop the word *"not merely"*.
4. Optional but cheap: `## Changelog`'s *"no new capability"* is true of the schema and false of the behaviour. One clause fixes it.

## What executing revealed that reading would not

Reading `## Done when` gives *"one test"* and the file's test names appear to confirm it — `:171` is the only test whose **name** mentions the prompt shape. Only `grep -n "plot-panel"` shows three hits, and only **running** the `:229` `sed` against the proposed new first line shows the failure is silent: the pin is not an assertion, it is a parser, and it fails as `cp "" …` rather than as a prompt mismatch.

Reading `/challenge-the-plan`'s section headings suggests a panel caller. Reading its **body** — `:172-196`, `:243-248`, `:353-380` — shows a sibling resolver, a plan-body writer and a metadata-block writer riding along with the four parameters. And measuring the estate turns that from a worry into a number: **9 siblings today, 27 on the other arm; 71 metadata blocks against 158 `Rounds:` fields.**

Reading the plan's motivation would have left the measurement unverified. `cat`ing the three log files showed it is exact, down to the `PLOT-UNASKED` string — **this plan's central claim is true**, which is itself the finding worth reporting given four false ones the week before.

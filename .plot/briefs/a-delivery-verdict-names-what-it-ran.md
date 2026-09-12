## Implementation brief — a-plan-is-questioned-before-it-is-approved (wave 2: A delivery verdict names what it ran)

- **Plan (canonical):** [docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md](../../docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md) on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-delivery-verdict-names-what-it-ran` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention — PR review before merge

Wave 1 (`feature/a-plan-is-questioned-before-it-is-approved`) merged as **#898** and nothing waits on this branch. Both dependencies are already on `main`: the panel mechanism ([a-panel-questions-one-plan](../../docs/plans/2026-09-12-a-panel-questions-one-plan.md), Delivered, PR #899) and wave 1's Draft caller. **Rebase onto current `main` before starting** — both landed 2026-09-12 and a branch cut from an earlier commit will not see `skills/plot-panel/` at all.

### What to build

`/plot-deliver` step 5 (`skills/plot-deliver/SKILL.md:186-238`) already fans out one subagent per merged PR, adversarially briefed to *refute*. It varies **the PR**. It does not vary the lens, so N agents ask one question of N diffs rather than N questions of one delivery.

This slice makes step 5 a caller of `/plot-panel`, exactly as wave 1 made `/challenge-the-plan` one — and converts step 5's existing prose MUST into a gate.

**The concrete failure being fixed is in step 5's own text.** Line 208 already says:

> **State separately what you EXECUTED versus what you only READ** — a deliverable confirmed by reading a PR body rather than a diff is not confirmed.

That is a rule in CLAUDE.md's sense: a subagent can answer *"did I state that?"* with yes without it being true, and the run still goes green. The plan's motivation names the shape it lets through — *"a changelog entry written at planning time that describes intent nobody implemented"* — which reads as delivered because the plan says so. `plot-panel.mjs check` is the gate that replaces the sentence.

The plan is canonical; this is orientation.

### The decisions already settled — do not re-derive them

**The mechanism exists and you call it. You do not build fan-out.** `skills/plot-panel/SKILL.md` is the mechanism, `packages/domain/src/rules/panel.ts` is the rule, `skills/plot/scripts/board/plot-panel.mjs` is the shipped bundle. Wave 1's `skills/challenge-the-plan/SKILL.md:143-263` (Phase 3P) is the worked example of a caller: a lens table, a commitment block, a *Running it* section handing over the four parameters, and a *What the panel writes back* section. **Follow that structure.** Writing a second fan-out in `/plot-deliver` is the one move that makes the extraction pointless, and the extraction is why `a-panel-questions-one-plan` was a separate plan.

**The four parameters are Subject, Lenses, Commitment, Rubric** (`skills/plot-panel/SKILL.md`, *Parameters*). One rubric, identical across lenses; the persona sentence is the only line that differs. If you find yourself writing a second rubric for a second lens, the lens is doing work the rubric should.

**The lenses are yours and do not transfer from wave 1.** The plan settles this under *The lenses do not transfer between the two panels*: a Draft lens asking *does the estate already have this?* is meaningless at delivery, where the thing is built. Wave 1's four are Estate / Contradiction / Deliverable / Cost — **do not reuse them.** Choose delivery-side reading positions and put them in a table like wave 1's. **Four is not a target**: `/plot-panel` takes N and its own text says *"four lenses is a guess nobody has measured"*.

**Prose quality is not a lens.** Settled in the plan under *What is deliberately not a lens*, and repeated in `skills/plot-panel/SKILL.md` under *What this skill does not do*. A juror reporting awkward wording alongside a missed deliverable dilutes both.

**The commitment vocabulary is the caller's and the mechanism knows none of it.** `Commitment { label, positions }` is a parameter (`packages/domain/src/rules/panel.ts:73-76`). The plan names `supported | refuted` for this caller. `readJuror` matches the label **at the start of a line** and the position **as a whole word, case-insensitively** — a juror quoting the rubric mid-sentence does not satisfy the gate, and neither does one writing two different positions in one file (`panel.ts:118-180`).

**Then the part the plan states in prose and the mechanism cannot enforce — read this before designing the commitment.** The plan says a delivery juror commits to *"supported/refuted **plus the command it ran**"*. `readJuror` gates on **one word from a fixed vocabulary** and nothing else: `panel.ts:149-153` splits the claimed line at the first whitespace and discards the remainder. So `Position: supported (ran pnpm test:contracts)` **passes the gate**, and the command text after the word is never validated — an empty tail passes identically.

That is the design question this slice actually has to answer, and the plan does not answer it. Two shapes are available and both are legitimate:

- **A second commitment line**, gated by a second `check` call with its own label and vocabulary. Costs one more script call per juror; gains a real gate on the distinction.
- **One line, with the command as unvalidated prose after the position**, and the moderator's judgement carrying the *executed vs read* distinction — which `skills/plot-panel/SKILL.md` step 5 already asks for: *"Say what each juror actually looked at."*

**Do not silently pick the first and call it gated, and do not silently pick the second and call the plan implemented.** Whichever you choose, say in the skill prose which one it is and what it does not catch. **Extending `readJuror` to parse a command is out of scope for this branch** — it is a domain change with its own tests, and the mechanism was deliberately built to know no caller's vocabulary.

**The subject is ONE plan, never a wave and never a PR.** `skills/plot-panel/SKILL.md` refuses a directory or a cohort, and the plan's own delivery panel is per-plan. Step 5's existing per-PR fan-out is the thing lenses are gained *over* — reconcile how the two dimensions compose rather than replacing one with the other.

**Then the composition hazard, which the plan does not settle either.** `readPanel` refuses **the whole panel** on any single hedge (`panel.ts:204-210`): *"a juror that hedged has not dissented — it has not reviewed."* Wave 1's panel is 4 jurors over 1 plan, so one refusal costs one re-run. A delivery panel over M lenses × N merged PRs makes that blast radius M×N, and this repo's largest plans carry many merged PRs. Decide and state whether a panel is per-plan (one panel, lenses read all the PRs) or per-PR (N panels, each reconciled separately) — and say why. The re-run rule is **once**, per `skills/plot-panel/SKILL.md` step 4; a juror that hedges twice refuses the panel.

**Rules carried over unchanged, which this repo keeps re-learning:**

- **Read the exit code, not the emptiness.** `plot-panel.mjs` exits `0` committed, `3` refused, `2` unusable arguments (`packages/board/src/server/entry/panel.ts:41-48`). A missing bundle means the panel ran **ungated**, not clean — say so rather than reporting no findings.
- **Absent is not false.** A delivery with no panel record is unquestioned, not clean. `/plot-approve` step 2c states this for the Draft side; the same distinction applies here.
- **Panel files are tracked, not machine-local.** `.plot/panels/<subject>/` — `panel.ts:19-32` records why: `.plot/state/` is git-ignored and reaped with the desk, so a verdict written there dies with the checkout.
- **This step decides nothing on its own.** `/plot-panel` moves no phase and writes no `State:` line. Step 5 already ends by asking the user to confirm; the panel feeds that decision rather than replacing it. The `State:` write stays `plot-deliver.sh`'s, and `plot-state-gate.sh` refuses any other writer.

### Done when

The plan's `## Changelog` is the specification for this slice:

> `/plot-deliver` step 5 gains lenses over its existing per-PR fan-out, and its verdicts must name what was executed rather than read.

Assertions that exist **because a naive implementation would pass without them**:

- **Step 5 calls `/plot-panel` and implements no fan-out of its own.** A step that grows its own lens loop passes every test and defeats the extraction. Wave 1's Phase 3P says it outright — *"calls `/plot-panel` and implements none of it"* — and this should too.
- **The step declares its `PLOT_UNATTENDED` shape with a `PLOT-UNASKED:` line.** `test/reconcile/unattended.test.mjs` sweeps every `skills/*/SKILL.md` structurally: a question site that loses its unattended clause breaks no runtime test and just quietly starts improvising. Step 5 already carries one for *deliver anyway or hold off* — a new question needs its own.
- **`skills/plot-deliver/README.md` and the Model Guidance table both move with the change.** CLAUDE.md requires each skill's Model Guidance table to be updated when its steps change, and the README is a required file. Neither is checked by a runtime assertion.
- **A missing `skills/plot-panel/` is reported as a broken installation, not a clean panel.** The only way to get this wrong is to treat an unreadable mechanism as no findings, and nothing fails if you do.

Plus the repo gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:contracts      # helper estate + CI gates, includes the unattended sweep
```

`pnpm run test:board` and `pnpm run typecheck` only if you touch `packages/`, which this slice should not need to. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers into sandbox repos, and CLAUDE.md records an operator's board going unresponsive when two agents ran it at once.

A changeset is required — `skills/` is shipped code and `plot-reconcile-scan.sh` section 22 reports a merge that adds none. Wave 1's is the model (`.changeset/brave-lenses-question.md`): **description first, `bumps:` block last**, since Changesets publishes the first line after the frontmatter and a `bumps:` block written first becomes the release note. Name the plan on a `plan:` line in the same block.

```markdown
---
'plot': minor
---

<the description, which is what the changelog publishes>

<!--
plan: docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md
bumps:
  skills:
    plot-deliver: minor
-->
```

### Bookkeeping

Open the PR through the controller — **not `gh pr create`**, which takes its title from the last commit subject and on this estate is routinely `plot: build the board artifact`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It reads which plan names the branch and uses that plan's wave heading as the title. When the PR exists, annotate the plan's wave heading — **this plan uses the inline form**, not a trailing `→ #N`:

```
### A delivery verdict names what it ran (Branch: feature/a-delivery-verdict-names-what-it-ran, PR: #N)
```

A trailing `→ #N` on a `## Slices` heading parses as `prs=[]`. Wave 1's heading is the worked example in the same file. That edit lands on `main`, not on this branch.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot-deliver/SKILL.md` — step 5, its Model Guidance row, and its unattended declaration
- `skills/plot-deliver/README.md`
- one new `.changeset/*.md`

Verified 2026-09-12: **no other remote `feature/*` branch touches `skills/plot-deliver/SKILL.md`**, so the file is yours. `.changeset/` holds other branches' files — add yours, touch none of theirs.

Do **not** edit `packages/domain/src/rules/panel.ts`, `packages/board/src/server/entry/panel.ts`, or `skills/plot-panel/SKILL.md`. The mechanism is delivered and vocabulary-agnostic on purpose; a caller that needs the mechanism changed is a finding to report, not a change to make here. `skills/challenge-the-plan/SKILL.md` and `skills/plot-approve/SKILL.md` belong to wave 1 and are merged — read them, do not amend them.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The two questions the plan leaves genuinely open — how the command-executed claim is gated, and how lenses compose with the per-PR fan-out — are answered **in the skill prose you write**, with the reasoning stated.

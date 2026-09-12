## Implementation brief — a-panel-questions-one-plan

- **Plan (canonical):** `docs/plans/2026-09-12-a-panel-questions-one-plan.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-panel-questions-one-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

The plan holds one wave with one branch, so this waits on nothing and nothing in this plan waits on it. Its **consumer** is [a-plan-is-questioned-before-it-is-approved](../../docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md), still Draft: it calls this mechanism twice, from `/challenge-the-plan` and from `/plot-deliver` step 5. Build the mechanism; do not build either caller.

### What to build

A reusable panel: N agents read **one plan** through different lenses, each writing a verdict file that must carry a committed position, reconciled by a moderator that names disagreements rather than averaging them.

The concrete failure it addresses, re-measured on this branch's base 2026-09-12: **268 plans, 74 carrying a `Rounds:` field — 27.6%.** Of those 74, 33 stopped at one round. The plan quotes 262/71, taken a day earlier; the estate grew and the ratio did not move. Reproduce with:

```
ls docs/plans/*.md | wc -l
grep -l "Rounds:" docs/plans/*.md | wc -l
grep -h '^- \*\*Rounds:\*\*' docs/plans/*.md | sort | uniq -c | sort -rn
```

That is a **cost** measurement, not a verdict on the existing skill's value. `/challenge-the-plan` asks 4 questions per round through the structured question tool (`skills/challenge-the-plan/SKILL.md:107`) and states that coverage takes five to ten rounds. The uptake measures what that costs a person, which is why the panel's target is the unattended case.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**One prompt file, the persona as the only variable.** N prompts produce N unrelated reviews with no shared rubric, and nothing the moderator can compare. Writing one rubric and varying the lens is what makes the verdicts commensurable. This is the plan's first design point and it is the reason the mechanism is worth extracting at all — fan-out alone is a `Task` call.

**The subject is one plan, never a wave.** A wave holds slices from several plans and is *"sized by the agents available, bounded by what can land"* (`DESIGN-slice.md`). Four personas asked to interrogate a scheduling cohort produce four answers with no shared subject. A plan is the coherent unit: its slices are one deliverable split for parallelism.

**The commitment gate is the part that is more than parallel subagents.** A verdict file that does not contain a line naming a position is refused. This is the same conversion `plot-state-gate.sh` performed for `State:` writes — the rule existed in prose, agents routed around it, and a file check ended the argument. CLAUDE.md's own test applies: *"Can you answer 'Did I complete this?' without actually doing the work? If yes, it's a rule."* A juror asked in prose to commit can answer yes without it being true; a juror whose file is rejected cannot.

**The required line is a parameter; the mechanism does not know the vocabulary.** A Draft juror commits to proceed/amend/reject. A delivery juror commits to supported/refuted plus the command it ran. The panel takes the required shape and validates against it. Hardcoding either vocabulary is what makes the second caller impossible — and the second caller is the entire justification for extracting this.

**Verdicts are files, not a transcript.** A file is readable by the moderator, by the next session, and by a person a week later. This repo has measured the alternative repeatedly: an observation that exists only in one agent's context dies with it.

**A moderator runs even on unanimity.** The plan leans this way explicitly — *"a moderator reading four agreements is also how a shared blind spot gets named."* Skipping reconciliation when jurors agree is the cheap path that removes the one reader positioned to notice they all missed the same thing.

**No prose-quality lens.** Named in the consuming plan as deliberately excluded: a juror reporting awkward wording alongside a missed deliverable dilutes both. Do not add one as a fifth default.

#### Two findings from the base, measured on this branch — read before you start

**1. `verdict` is a taken word in this estate, and it means something else.** `skills/plot/scripts/board/plot-verdicts.mjs` exists and is wired (`packages/board/src/contract/bundles.generated.ts:63`). Its verdict is a **slice's wave eligibility** — `complete` / `empty` / `unapproved` / `eligible` / `blocked` — computed in `rules/` and rendered by the board. It has no relationship to a juror's position.

So the collision is in the name only, and it is a real hazard in both directions: a new `verdicts.ts` in the domain, or a new `plot-verdict*.mjs` bundle, will be read by the next person as the eligibility rule. Disambiguate in code (`juror`, `panel-verdict`, or similar) even where the plan's prose says "verdict file". The plan's word is fine in prose; the identifier needs to survive a `git grep`.

Confirm the collision before naming anything:
```
git grep -n "verdict" packages/domain/src/rules | head
ls skills/plot/scripts/board/plot-verdicts.mjs
```

**2. The estate has no panel mechanism, and the search that proves it needs the right corpus.** `plot-deliverable-search.sh panel` returns only prose hits — three comment lines in `plot-dispatch.sh` / `plot-worker-state.sh` using "panel" to mean a UI panel, two in the domain's process port, and it declines to search `packages/board/src` where "panel" names 29 React components (`AgentPanelFacts.tsx`, `StatusPanel.tsx`). None is this. Likewise `juror` and `moderator` return nothing anywhere.

The one thing that *is* prior art is `/plot-deliver` step 5 (`skills/plot-deliver/SKILL.md:197-215`): it already launches one `Task` agent per merged PR, in parallel, adversarially briefed to refute. **It varies the PR, not the lens** — four agents asking one question of four diffs. Read it before designing the fan-out; it is the shape the consuming plan extends, and its brief template is where the commitment rule currently lives as prose:

> *"A deliverable that names a behaviour is only SUPPORTED when someone ran it. 'The diff appears to add it' is a reading."*

That sentence is the gate this slice converts into a file check. Do not reimplement step 5 — this slice must not touch `skills/plot-deliver/`.

#### Rules carried over unchanged

- **Where verdict files live is an Open Question the plan parks — and `.gitignore` constrains it.** `.plot/state/` is machine-local and ignored (`.gitignore:30`); `.plot/briefs/` is tracked. A desk is transient and reaped by `plot-reap.sh`, so verdicts written there vanish with the worktree. The plan leans toward a panel directory beside the plan and does not settle it. Whichever you choose, say so in the PR body and make it a stated decision rather than a side effect of a path.
- **Every skill's question sites need a `PLOT-UNASKED` declaration.** `test/reconcile/unattended.test.mjs` sweeps **every** `skills/*/SKILL.md` directory, so a new skill is caught the moment it exists. Under `claude -p` the question tool is *not registered at all* — the agent improvises and exits 0 (`skills/plot/docs/unattended.md`). A panel is an unattended-first mechanism, so this is on the critical path, not an afterthought.
- **Arrow functions** in `packages/domain/**`, and in any function you write or rewrite anywhere. The unit is the function, not the file.
- **Import through the narrow path, never the package root,** if this gains a bundle. Measured 2026-09-03: a root import produced a 334 KB artifact against `plot-movable.mjs`'s 1.2 KB.
- **A bundle that cannot be asked is not a refusal.** A missing artifact means a broken installation — fall back and *say you could not ask*.
- **Skills interpret and adapt; scripts collect and report** (Manifesto Principle 3). A juror's lens is judgement and belongs in prose; the gate that checks a file contains its committed line is mechanical and belongs in a script or rule.

### Done when

**The plan carries no `## Done when` section.** Its sections are Status, Changelog, Motivation, Design, Slices, Notes. The specification is the slice sentence under `## Slices`, and it is the whole scope:

> The panel helper: fan-out over one prompt, verdict files, the commitment gate, and the moderator that reconciles.

Read with the Changelog entry, which is what ships:

> A reusable panel: N agents read one subject through different lenses, each writing a verdict file that must carry a committed position, reconciled by a moderator.

**The assertion that exists because a naive implementation would pass without it:** a verdict file missing its commitment line must be **refused**, and a test must prove the refusal fires. Fan-out, file-writing and reconciliation all work perfectly with the gate absent — the panel runs, produces four files and a summary, and looks finished. The gate is the only part whose absence is invisible at runtime, which is exactly the failure mode this repo keeps paying for. A test that only checks four files appeared is a test that would pass against no gate at all.

**Three Open Questions are deliberately unanswered — leave them that way.** How many jurors (the panel takes N; the callers choose, and the first real number comes from running it), whether unanimity skips reconciliation (leaning no, per the plan), and where verdict files live. Answering the first by hardcoding four is the tempting one; do not.

Plus the repo's gates:

```
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # validates all skills parse
pnpm run test:contracts      # includes the unattended sweep
pnpm run test:board          # only if packages/ is touched
```

Do **not** run `pnpm run test:e2e` — it is CI's gate, it dispatches real workers into sandbox repos, and a local run starves the machine the board lives on.

A changeset is required. Description **first**, `bumps:` block **last** — a `bumps:` block written first becomes the published release note. Name the plan on a `plan:` line in the same block.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```
../plot/scripts/plot-open-pr.sh          # or --draft while the work is moving
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section. Push the first real commit as soon as it exists.

### Scope guard

**This branch owns** a new panel mechanism — most likely a new `skills/<name>/` directory, plus whatever rule or script the commitment gate needs. Nothing else.

**It must not touch** `skills/challenge-the-plan/` or `skills/plot-deliver/`. Both are the *consumers*, and they belong to the Draft plan [a-plan-is-questioned-before-it-is-approved](../../docs/plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md), which is not approved. Editing either here does that plan's work before it is approved, and does it invisibly to its review.

**Two sibling plans in the same story are Approved and in flight.** Verified against `origin/main` at dispatch:

- `feature/an-agent-declares-what-it-runs` — remote branch exists, holding `packages/board/src/server/entry/prompt.ts`, `packages/domain/src/rules/prompt.ts`, `packages/domain/test/charter.test.ts`, `skills/plot/scripts/board/plot-prompt.mjs`.
- `feature/a-charter-bounds-what-an-agent-may-touch` — no remote branch yet; it will touch `packages/domain/src/entities/charter.ts` and the shipped worker-prompt template.

If this slice gives a juror a declared tool scope, it is reading the charter work rather than writing it — that dependency runs one way and the plan says so: *"This slice does not depend on that one — an unbounded panel works."* Build the panel unbounded and let the charter slice bound it later.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

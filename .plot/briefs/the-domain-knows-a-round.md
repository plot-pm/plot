## Implementation brief — a-round-is-a-domain-fact (wave 1: The domain knows a round)

- **Plan (canonical):** `docs/plans/2026-09-22-a-round-is-a-domain-fact.md` on `main`
- **Approved:** 2026-09-22, jwloka, in-session
- **Branch:** `feature/the-domain-knows-a-round` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review, CI gates green

Wave 2 (`feature/the-controller-records-it`) declares `waits: feature/the-domain-knows-a-round` and cannot start until this merges. It builds the `plot-panel-round.mjs` bundle and rewires `/plot-panel` step 5 and `/challenge-the-plan` to call it. **Nothing in wave 2 is this branch's job** — no bundle, no `build.mjs` entry, no skill prose. This branch ends when the rule exists, is exported, and is tested.

### What to build

`recordRound` — a transition in `packages/domain/src/transitions/` that decides the write recording one completed interrogation of one plan, or refuses with one of five named reasons.

The failure it fixes, measured 2026-09-22: four panels ran against four plans, zero `Rounds:` fields were written, and the board reported three heavily questioned plans — two of which the panels had **rejected** — as plans nobody had looked at. The field, its parser and its badge all already work. What was missing was anything that writes it other than an instruction in skill prose, and prose is what failed four times out of four.

The plan is canonical; this is orientation for the shape, which the plan describes in two ways that disagree.

### The decisions the plan settles — do not re-derive them

**The shape is `setSprintState`'s, and the plan says so — take the shape over the plan's prose.** The plan's Design says `recordRound` *"takes the plan document"* and returns *"the text to write"*; its Slices line says *"taking the plan text … returning the rewritten `## Status` block"*. Both are loose, and following them literally puts markdown assembly inside the domain. The same paragraph names the authority: *"the shape `setSprintState` established"*. That shape is measurable in four sibling files and it is the one to build:

- the input is **parsed fields**, not file text — `transitions/plan.ts:42` takes a `TransitionPlan` with `slug`, `phase`, `approvedRecord` and friends; `transitions/sprint.ts` takes a `Sprint` entity
- the output is a **`Decision` carrying values** — `transitions/sprint.ts:106` returns `{ outcome, slug, state, actualEnd }`, and the *shell* composes the line
- a fact the domain cannot measure arrives as a **`Precondition`** (`transitions/sprint.ts:64`), supplied by the caller

So `recordRound` takes something like `{ slug, phase, rounds }` plus an input carrying the moderation reading, and returns a `Decision` naming the count to write. The domain reaches no filesystem and assembles no markdown. `ci.yml:246` gates the first half of that mechanically; the second half is a rule and needs a reviewer who knows it.

**`moderationPath()` already exists — do not invent a path convention.** `rules/panel.ts` exports `PANEL_DIRECTORY = '.plot/panels'`, `panelDir(subject)` and `moderationPath(subject)` → `.plot/panels/<subject>/panel.md`. The directory is live: 10+ panels have written there. The `no-moderation` refusal is about whether that file **exists**, which is a filesystem reading — so it arrives as a `Precondition`, the way the plan's PR check does in `transitions/plan.ts:76`. The domain must not stat it.

**Increment, never set — and `count-unparseable` refuses rather than repairing.** A plan can face a panel twice (`a-waiting-loop-has-not-finished` is the rewrite of a plan a panel rejected; both sittings are rounds). The transition reads the current value and adds one. A `Rounds:` that is not a number is a **defect to report**, never to overwrite: overwriting destroys the evidence of how it got that way. This is the same instinct as `plot-sprint-state.sh` refusing a state word it does not recognise instead of normalising it.

**The five refusals, and why each exists** — the plan's table is the specification. `zero-rounds` because `0` means *questioned and nothing came of it* while absent means *nobody looked*, and the template (`.plot/templates/plan.md:20`) says leave the line out rather than write zero. `not-a-plan` because a file with no `State:` is a decision log. `phase-terminal` because a Released plan's interrogation is history. `no-moderation` because a round is complete when it is **reconciled**, not when it is started — recording one earlier records an intention. `count-unparseable` as above.

**`no-moderation` is the refusal that earns the whole branch.** It is checkable — the moderation file exists or it does not — and it is exactly what prose cannot enforce. A skill told to write the field after moderating can believe it did; a rule handed a subject with no `panel.md` refuses. If that refusal ends up unreachable or advisory, the branch has not delivered its point.

**Absent is not zero.** `schema.ts:172` — `rounds: z.number().optional()`, *"never defaulted to 0 — that is the whole design of the field"*. `plot-plan-meta.sh:665` omits the key entirely rather than sending a sentinel. Keep that: a decision must not be expressible as "write 0".

**No phase moves.** Recording a round is not approval. A rejected plan keeps its round beside its rejection. `plot-state-gate.sh` guards `State:` lines and deliberately does not cover `Rounds:` — the refusals are the gate here.

**The shell stays the parser.** `plot-plan-meta.sh` reads `Rounds:` from three sources in preference order (`## Status`, YAML front matter, the `CHALLENGE-THE-PLAN-METADATA` block — lines 657–665). This branch adds a **writer**, not a second reader. Do not touch the parser.

### Done when

The plan's `## Done when` list is the specification — the plan carries no such section, so its Slices line is: `recordRound` lands in `transitions/`, returning the decision or one of five named refusals, with unit tests pinning each refusal and the increment-not-set rule.

Lift these, because a naive implementation passes without them:

- **a plan already at `Rounds: 2` decides `3`** — catches a `set` written where an increment belongs, which every one of the five refusals would still pass
- **`count-unparseable` refuses and the existing value survives in the refusal's `detail`** — catches a "repair" that silently normalises the defect away
- **`no-moderation` is reachable through the public input** — catches the refusal being declared in the union and never wired, which is `setSprintState`'s own measured history: nine refusals, zero callers, and `commitment-empty` never ran while a sprint was activated by hand
- **an unrecognised `phase` string refuses rather than throwing** — `transitions/sprint.ts` carries this exact scar: a state read from a file was typed as `SprintState` in the tests, the rule's own tests could not reach the case, and a real parsed file threw `Cannot read properties of undefined` instead of refusing. A `phase` arriving from `plot-plan-meta.sh` is a string and can be any word.

Plus the repo's gates:

- `nvm use` (Node 24 — pnpm crashes on 26), `pnpm install`
- `pnpm test`, `pnpm run test:contracts`, `pnpm run typecheck`
- `pnpm run test:board` if anything under `packages/` changed
- **not** `pnpm run test:e2e` — that is CI's gate; running it locally starves the machine
- a changeset naming this plan: description first, `bumps:` block last, `plan: docs/plans/2026-09-22-a-round-is-a-domain-fact.md` in the same comment
- **Domain style gates:** arrow functions only (`ci.yml:732` greps `^\s*(export )?function ` and fails on any hit); no `node:`/`fs`/`child_process` import outside `adapters/` (`ci.yml:246`); the `waves` vocabulary gate (`ci.yml:643`) — a Slice holds one branch, a Wave is the fleet's cross-plan cohort, and prose in this file must not blur them
- **TSDoc is factual**: what it does, what the parameters mean, what it returns, how it fails. The reasoning goes in the commit message and the plan. The first rule moved into this package carried 109 lines of comment on 28 lines of code; do not repeat it.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

**This branch owns:** a new file under `packages/domain/src/transitions/`, its test under `packages/domain/test/`, and the export block in `packages/domain/src/index.ts`.

**The export block has a trap.** `index.ts:188` states the rule: a verb whose name collides with nothing is exported bare, and `scripts/count-domain-aliases.sh` holds aliases-on-uncollided-names at zero. `recordRound` collides with nothing, so **export the verb unaliased**. But if the new module declares its own `Decision`, `Refusal`, `RefusalReason` or `Precondition`, those four **do** collide with `transitions/plan.ts` and **must** be aliased — exactly as `transitions/story.ts`'s are at `index.ts:190`. Getting this backwards fails CI with an error that will not explain itself.

**In flight elsewhere, verified at dispatch:** `feature/the-call-asks-only-for-the-delta` touches `rules/pr-index.ts`, `server/fleet.ts` and three board bundles. `bug/the-index-is-read-once` touches `plot-reconcile-scan.sh` and one test. **Neither touches `transitions/` or `index.ts`.** The only plausible collision is a bundle rebuild, and this branch builds no bundle.

**Explicitly not this branch:** the `plot-panel-round.mjs` bundle and its `packages/board/build.mjs` entry, any edit to `/plot-panel` or `/challenge-the-plan` prose, and any edit to `plot-plan-meta.sh` or the board's rendering. All of that is wave 2.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

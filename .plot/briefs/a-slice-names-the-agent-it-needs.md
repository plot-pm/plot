## Implementation brief — a-slice-names-the-agent-it-needs

- **Plan (canonical):** [docs/plans/2026-09-15-a-slice-names-the-agent-it-needs.md](../../docs/plans/2026-09-15-a-slice-names-the-agent-it-needs.md) on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `feature/a-slice-names-the-agent-it-needs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

One slice, one wave, nothing waits on it and it waits on nothing. The charter half of this story already shipped — `a-charter-reaches-the-agent-it-declares` in v2.18.0 — so every fact this builds on is on main rather than in flight.

### What to build

A slice declares which kind of agent it needs, and dispatch picks that charter with no operator present.

Today `--agent <name>` is the only selector, at `plot-dispatch.sh:294`. An operator types it. `plot-registryd` hands a queued slice to a free agent with no `--agent` anywhere in the path, so an unattended fleet runs every slice as the same undifferentiated worker — which is the half of `plot-agent-identity` that was never started.

Four changes:

1. **`plot-plan-meta.sh`** parses an optional `<!-- agent: <name> -->` annotation on a branch line, emitted as `waves[].branches[].agent`, **absent** where unwritten.
2. **`plot-dispatch.sh`** reads that value when `--agent` is absent.
3. A named-but-missing charter is **reported and dispatched anyway**, naming what it looked for.
4. Both plan templates document the annotation.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The field is a per-branch annotation, not a `## Status` field.** Every existing `## Status` field is plan-level — `State`, `Type`, `Sprint`, `Issue`, `Story`, `Review`, `Impl`, `Rounds`, measured against `.plot/templates/plan.md`. An `Agent:` line there could only declare one kind for a plan with several slices, and a reviewer slice beside an implementer slice is the exact population this exists for.

**The wave heading was the first draft and is rejected by measurement.** `plot-plan-meta.sh:886` decides a heading's shape with `index($0, "(Branch:")` — the literal `(Branch:` must open the parenthesis. A heading written `(Agent: reviewer, Branch: feature/x)` parses to **zero branches**, *and* the wave name becomes the whole heading text, which the board renders as a prose slice name. Both failures are silent. Requiring `Branch:` first would work and would make field order load-bearing in one place and nowhere else.

**`waits:` and `builds:` are the precedent, and the key is ABSENT where unwritten — never `""`.** Verified in the source: `has_builds` at `:986-994` and `has_waits` at `:995-1014` carry presence separately from the value, so a consumer reads a value or nothing and never a blank string that looks like one. `agent:` joins them as the third and must do the same.

**Copy `builds:`'s value rule, not `waits:`'s.** `builds:` runs to the closing marker (`:991`); `waits:` stops at the first whitespace (`:1000`). A charter name is a bare word, so either would work today — but `builds:`'s is the one that does not silently truncate if a name ever grows a space.

**⚠️ `waits:` validates its value and `agent:` cannot — this is the trap in this slice.** Read `plot-plan-meta.sh:1003-1013`:

> *"THE VALUE MUST LOOK LIKE A BRANCH, and that check is what keeps a SYNTAX EXAMPLE from becoming a declaration. A plan that documents the annotation writes the literal marker in prose, and no comment-aware reading can tell that apart from the real thing on the same line — the branch prefixes can. `<branch>` is not a branch name; `bug/x` is."*

`waits:` escapes this because a prerequisite has branch-prefix structure to check. A charter name is a bare word like `reviewer` with no structure at all, so **the same guard is unavailable**, and task 4 of this slice is to write the literal marker into two template files.

**What makes it safe today is the nesting, and you must preserve it.** Measured: `.plot/templates/plan.md` documents `builds:` across eleven lines (`:91-96`) and parses with **no `builds` key** — because the doc text sits inside an outer `<!-- … -->` block, so the inner `builds:` has no `<!--` immediately before it and the parser's `<!--[ \t]*builds:` pattern never matches. Run `skills/plot/scripts/plot-plan-meta.sh .plot/templates/plan.md` before and after your template edit; the output must gain no `agent` key. Document `agent:` the way `builds:` is documented — inside the existing comment block, never as a standalone `<!-- agent: reviewer -->` line on or beside a branch line.

**Dispatch prefers the flag; the plan is the default.** A flag typed on this run is more specific than a field written when the plan was drafted — the same precedence `plot-dispatch.sh` already applies when `--agent` overrides an inherited `PLOT_AGENT`. The mechanism is one line: `:331` is `[ -n "$agent" ] && export PLOT_AGENT="$agent"`, and `resolve_launch` reads `${PLOT_AGENT:-}` at `:995`. The plan's value should reach the same variable, and only when the flag left it unset.

**A missing charter is REPORTED, never refused — and this is a deliberate asymmetry.** `resolve_launch` already refuses a charter it cannot *believe* (malformed) and a harness not on `PATH`; both stay. A charter that simply does not *exist* is the adoption case — a plan written on a machine declaring `reviewer`, dispatched on a clone that does not — and refusing it would make the plan undispatchable on any such clone. Fall back to the default launch and say which name you looked for, in the manifest and in the dispatch output. The estate holds exactly one charter, `.plot/charters/reviewer.json`.

**A slice naming no agent must launch byte-identically to today.** That is the whole estate: no charter resolves, the three variables export empty, the launch is unchanged. v2.18.0 established this property and this plan must not weaken it.

### Rules carried over unchanged

**Absent is not empty.** Stated above for the parser, and it is the contract four keys already keep.

**`git ls-remote --heads` exits 0 whether or not the branch exists** — the emptiness is the answer, not the exit code. Measured while preparing this brief.

**`plot-controller-gate.sh` matches the script basename anywhere in your command string.** A read-only `grep -n foo skills/plot/scripts/plot-dispatch.sh`, and a glob like `skills/plot/scripts/*.sh` that merely *expands* to include `plot-approve.sh`, both trip it with a refusal about controller-owned actions. Two false positives while preparing this brief. Use the `Read` tool, `cd` into the directory first, or assign the filename to a variable. Do **not** spend an unowned-action receipt to read a file — the escape is for a real dispatch you cannot route through the board.

### Done when

The plan's `## Done when` list is the specification. Lifting the three assertions that exist because a naive implementation passes without them:

- **All 280 existing plans parse byte-identically, diffed before and after.** This is a *corpus* assertion, not a fixture one — capture the baseline before you touch the parser, because after the edit there is nothing left to compare against. `ls docs/plans/*.md | wc -l` reads 280 today. The parser is `awk` and a new pattern is exactly where a silent mis-parse hides. **Seventeen scripts read this parser**, not the four the plan's Design names (`plot-boardctl.sh` is in fact not among them) — so this test carries more weight than the plan credits it with. It is the first thing to write.
- **A branch with no annotation emits no `agent` key** — catches the `""`-instead-of-absent defect, which every consumer that checks truthiness would survive and every consumer that checks presence would not.
- **A slice naming no agent produces a byte-identical launch** — catches a regression in the v2.18.0 path that no new-feature test would notice, since the estate has zero plans carrying the annotation.

Also assert: a charter name parses to `waves[].branches[].agent`; a dispatch of a slice naming `reviewer` selects that charter with no `--agent`; `--agent` on the command line overrides the field; a slice naming a charter that does not exist dispatches anyway and names what it looked for.

**Where the tests go:** `test/reconcile/parser.test.mjs` for the annotation contract, and the dispatch behaviour beside `test/reconcile/charter-reaches-launch.test.mjs` (the v2.18.0 predecessor) — `test/reconcile/dispatchwaits.test.mjs` is the closest annotation precedent to copy structure from.

Plus the repo gates:

- `nvm use` first — Node 24, pinned in `.nvmrc`. **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing.
- `pnpm run test:contracts` — this is the plan's named gate. It runs `test/reconcile/*.test.mjs` (82 files), **not** a `test/contracts/` directory.
- `pnpm test` and `pnpm run test:board` if you touch anything the board reads.
- **Do not run `pnpm run test:e2e`** — it is CI's gate. It dispatches real workers into sandbox repos; two agents running it once produced 53 concurrent `node --test` processes and load average 8.69.
- **A changeset is required.** `.changeset/` is often empty in a fresh worktree — copy the format from git history. Description **first**, `bumps:` block **last**: Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note. Bump `plot-dispatch` and `plot` (the parser is the hub's). Optionally add a `plan:` line naming this plan.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

It titles the PR from the wave heading the plan names the branch under, and puts the plan and this brief in the body. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-plan-meta.sh` — the annotation parse
- `skills/plot/scripts/plot-dispatch.sh` — reading the field when `--agent` is absent
- `.plot/templates/plan.md` and `skills/plot/templates/plan.md` — documentation
- `test/reconcile/parser.test.mjs` and a dispatch test beside `charter-reaches-launch.test.mjs`
- a changeset

**The two templates are not copies, and the plan's wording assumes they are.** Measured: `.plot/templates/plan.md` is 104 lines and documents `deferred:/claimed:/moved:/waits:/builds:`; `skills/plot/templates/plan.md` is 66 lines, documents `deferred:/claimed:/moved:` only, and mentions neither `waits:` nor `builds:`. So *"document it beside `waits:` and `builds:` in both templates"* cannot be followed literally in the shipped one — the neighbours are absent. Add `agent:` to the annotation list in both; whether to backfill `waits:`/`builds:` into the shipped template is **out of scope** — report it rather than fixing it here.

**What this branch must not do**, both settled by the plan:

- **Do not make the fleet cap count by kind.** `rules/fleet-size.ts:145` stays `Math.min(wanted, ceiling)`. Making the budget a vector is the story's third bullet and its own plan.
- **Do not declare a new charter.** One exists — `reviewer` — and a second invents a role this estate has not asked for.

No other branch is in flight on this plan, and no other plan names these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

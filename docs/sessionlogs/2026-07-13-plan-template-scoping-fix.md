# Plan-template scoping fix + project-local template override

**Date:** 2026-07-13
**Scope:** Review fix on PR #40 — plot-project-specific content had leaked into
the *shipped* plan template. Revert it, move it to a project-local override, and
implement the override resolution so the override is actually consumed.
**Branch:** `idea/kanban-board-v1` (PR #40)

## The leak

The board work added two things to `skills/plot/templates/plan.md` — the template
**shipped with the plot skill** (what every adopter gets):

1. A **Board impact** comment block referencing this repo's
   `docs/definition-of-done.md` and internal layout — unambiguously
   plot-project-specific.
2. A **`- **Story:**`** field in `## Status`.

Both were reverted from the shipped template (it now matches `origin/main`).

### Why `Story:` moved too (the judgment call)

Max's rule: keep `Story:` shipped **only** if stories are a general,
adopter-facing feature; when unsure, keep the shipped template minimal. Evidence:

- Shipped `story-tracking` (on `origin/main`) manages the **story→plan** direction
  (story files list their plans) and defines **no plan-level `Story:` field**.
- The plan-declared `story` surface — in `plot-plan-meta.sh` and the template — is
  **new on this branch** (`git show origin/main:…/plot-plan-meta.sh | grep story`
  → 0). It exists to feed the board's story filter.

So the plan-level `Story:` field is board-era, not an established general
convention. Per the "when unsure, minimal" tiebreaker it moved to the project
template. (`Sprint:` stays shipped — it was already canonical on `origin/main`.)
The shipped `plot-plan-meta.sh` still emits `story` harmlessly (empty when a plan
doesn't declare it), so nothing breaks; the shipped template simply no longer
advertises a field the shipped skills don't yet formally define.

## Mechanism change: config key, not a bespoke script (Max's call)

**Superseded — read this first.** The first cut of this fix (below) resolved the
override with a dedicated `plot-plan-template.sh` that sniffed for a magic
`.plot/templates/plan.md`. Max reviewed and chose **option (b): resolve through
the existing `plot-config.sh` as one more `## Plot Config` key.** Rationale: plot
already has exactly one adopter-config mechanism (`plot-config.sh`, which reads
`Plan directory`, `Sprint directory`, …); a template path is just another config
value — reuse it, don't invent a third mechanism.

What changed to option (b):

- **Deleted** `plot-plan-template.sh` and its test.
- **`Plan template`** is now a documented `## Plot Config` key (in
  `plot-config.sh`'s known-keys header and `plot/SKILL.md` Setup). Its value is a
  repo-root-relative path.
- **`plot-idea` step 4** resolves with
  `plot-config.sh get "Plan template" skills/plot/templates/plan.md` — configured
  path wins, shipped template is the fallback. The override is now an **explicit
  opt-in via the config key**, not magic file detection.
- **`.plot/templates/plan.md` stays** as plot's own project template, but is now
  **declared**: the repo-root `CLAUDE.md` gained a `## Plot Config` section (plot
  had none — it relied on defaults) with `Plan template: .plot/templates/plan.md`,
  so plot dog-foods the config-key path.
- **Tests:** the script-specific resolver test is gone; `test/reconcile/config.test.mjs`
  now covers the `Plan template` key (present → configured path; absent → shipped
  default) via `plot-config.sh`.

The rest of this log describes the original (now-superseded) script approach and
the still-valid scoping decision (what was reverted from the shipped template and
why `Story:` moved).

## The override mechanism (so `.plot/templates/plan.md` is real) — ORIGINAL (superseded)

The gap Max anticipated was real: `plot-idea/SKILL.md` hardcoded
`skills/plot/templates/plan.md` and **no project-local override logic existed**.
A project template that nothing reads would be worthless, so the resolution is
implemented:

- **`skills/plot/scripts/plot-plan-template.sh`** — prints one path: a repo-root
  `.plot/templates/plan.md` if present (located via `git rev-parse
  --show-toplevel`), else the shipped template. One value on stdout, in the
  `plot-config.sh` mould (scripts collect/report; skills interpret).
- **`plot-idea/SKILL.md` step 4** now resolves via the script and forbids
  hardcoding the shipped path, so a project's template wins.
- **`.plot/templates/plan.md`** (new, this repo) = the shipped template + the
  `Story:` field + the Board-impact prompt + plot-repo guidance (DoD reference,
  monorepo/board layout, changeset-driven versioning). A provenance header notes
  it's a **complete** template (the resolver returns one file, no merge) whose
  structural fields must be kept in sync with the shipped one.
- Documented as a general adopter feature in `plot/SKILL.md` Setup and the script
  listings; added to the project `CLAUDE.md` Helper Scripts table.

## How the override was verified

Plot's plan-creation flow is agent-interpreted, so there is no runtime trace to
capture. What is verified:

- **Resolver contract test** (`test/reconcile/plan-template.test.mjs`, 3 cases):
  falls back to the shipped template with no override; prefers a project-local
  `.plot/templates/plan.md`; finds the **repo-root** override from a subdirectory
  via git toplevel (the real `/plot-idea` case).
- **Manual smoke:** run in this repo → returns `.plot/templates/plan.md`; run in a
  scratch dir → returns the shipped template.
- **`plot-idea/SKILL.md` now instructs running the resolver** and reading its
  output. I.e. *resolver tested + the flow updated to consume it* — not a claim
  that I traced the agent reading it.

## Versioning

Per this repo's convention (changeset-driven; SKILL.md `version:` fields are not
hand-edited), a changeset `.changeset/plan-template-override.md` declares
`bumps: skills: plot: patch, plot-idea: minor` (new plan-creation capability).

## Verification

- `pnpm run test:reconcile` **40/40** (37 prior + 3 resolver).
- `pnpm test` (skills validate) clean — plot-idea / plot still parse.
- Shipped `skills/plot/templates/plan.md` diff vs `origin/main`: empty (reverted).

## Notes / out of scope

- Pre-existing (on `origin/main`, not introduced here) project-specific mentions
  in `skills/ralph-plot-sprint/{README,SKILL}.md` — flagged, not fixed (out of
  scope for this review fix).

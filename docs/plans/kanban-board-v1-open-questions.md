# kanban-board-v1 — open questions for Max

> Output of `/challenge-the-plan` (2026-07-12) on [`2026-07-12-kanban-board-v1.md`](2026-07-12-kanban-board-v1.md). Everything the brief, manifesto, or codebase could decide has been resolved and woven into the plan. These five genuinely need you — pick a letter per question (annotate here, in the PR, or in chat).

## Q1 — Publish `@…/board` to npm with this release?

Today's release pipeline never touches npm (tags + GitHub Release only); publishing adds an npm token to CI and a publish step in `release.yml`, but enables `npx <board>` in any repo.
**A:** publish 1.0.0 now · **B:** defer — ship the git artifact only, wire npm up later when there's a proven need. *(A = more release surface now; B = no `npx` story yet.)*

## Q2 — Package name?

**A:** `@plot-pm/board` — clear provenance, matches the GitHub org, but requires the `plot-pm` npm org to exist/be claimed · **B:** unscoped `plot-board` — no org needed, generic-name/squat territory.
*(Name goes into `package.json` now even if publishing is deferred; A is the default if you own or will claim the org.)*

## Q3 — Sprint filter: upgrade to multi-select for parity with the story filter?

**A:** yes — one shared component, consistent UX, URL becomes `?sprint=a,b` (old single-value links keep working) · **B:** no — keep single-select, zero behavior change to the existing filter.

## Q4 — "Board impact considered in every plan": rule or gate?

**A:** prose — DoD entry + a `Board impact:` prompt-comment in the plan template; relies on authors/agents honoring it · **B:** gate — CI plan-lint fails PRs whose new/changed plan files lack a `Board impact:` line. *(B follows the repo's Gates-over-Rules doctrine but adds a hard requirement to every future plan, plot-wide.)*

## Q5 — Plan Type: confirm `feature`?

**A:** keep `feature` — the board UI/filters are the center of gravity · **B:** `infra` — monorepo/build/release work dominates. *(Affects release-notes grouping, nothing structural.)*

---

### Settled during the challenge (for visibility, no action needed)

- Artifact stays at `skills/plot/scripts/board/`; built + committed by the changesets version step; CI rebuild-and-diff freshness gate; deterministic single-file esbuild bundle, assets served from memory (no fs static serving → no traversal surface).
- Board discovers `docs/plans/` / `docs/sprints/` / stories dir via `plot-config.sh` instead of hardcoding (manifesto Q2).
- `plot-plan-meta.sh` gains `title`/`sprint`/`story`/`assignee` with fixtures; frontmatter wins, H1 fallback for title.
- shadcn/tailwind adopted as directed (build-time only; runtime artifact stays zero-dep). UI is a reimplementation of the current layout, not a redesign.
- Story filter: one story per plan (mirrors sprint); filters intersect; hidden when no stories dir; 30s client polling replaces manual refresh; keyboard/a11y via radix primitives, verified manually.
- Zod schemas exported as `…/contract` subpath to keep the R2 (public viewer) option open.
- Known risk to handle in implementation: release chain + changeset-check CI currently assume a single versioned package.

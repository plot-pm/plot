# Kanban board v1.0 — graduate the board to a first-class Plot package

**Date:** 2026-07-13
**Scope:** Implement the approved `kanban-board-v1` plan end-to-end in a single PR — monorepo package, contract rework, story filter, first-class/DoD.
**Branch:** `idea/kanban-board-v1` (single-PR mode — plan + implementation in one PR)
**PR:** [#40](https://github.com/plot-pm/plot/pull/40)
**Plan:** [`docs/plans/2026-07-12-kanban-board-v1.md`](../plans/2026-07-12-kanban-board-v1.md) · decisions in [`kanban-board-v1-open-questions.md`](../plans/kanban-board-v1-open-questions.md)

## What

Took the experimental lit-html board (a `server.mjs` + hand-rolled `parser.mjs` + vendored deps) and shipped it as a first-class, versioned package. Six workstreams, each committed and independently verified:

1. **Contract extended.** `plot-plan-meta.sh` now emits `title` (front matter wins, H1 fallback), `sprint`, `story`, and `assignee`. New reconcile fixtures specify each shape; `test:reconcile` went 32 → **36**.
2. **`@plot-pm/board` package.** New pnpm workspace (`packages/*`) with `packages/board` — vite + react + shadcn (Radix + tailwind v4) + zod, TypeScript strict. Server is `node:http`; the client is React. Pinned at `1.0.0-rc.1`.
3. **Architecture inverted.** The board no longer parses plans. The server runs `plot-plan-meta.sh` once over all plan files and validates the JSON-lines output through a **zod boundary**; directory locations come from `plot-config.sh`. Sprint/story *files* (not plan files) are read by small, tested helpers in the server. This fixes the headline bug: **front-matter-format plans, invisible on the old board, now render.**
4. **Single-file artifact.** esbuild bundles the server with the built client HTML **inlined** (served from memory — no filesystem static serving, so the path-traversal surface is gone) into one self-contained `skills/plot/scripts/board/board-server.mjs` (625 KB min / **159 KB gzip**). `pnpm board` runs it with no install step. Old board files + tests removed.
5. **Story filter + UI.** One shared Radix multi-select, instantiated for **both** sprints and stories (Q3: sprint filter upgraded to multi-select for parity). URL state `?sprint=a,b&story=c,d`; the two filters **intersect**; story filter hidden when the project has no stories dir; badges suppressed while a filter is active; 30s polling replaces manual refresh.
6. **First-class + DoD.** New `docs/definition-of-done.md` (board must keep working — CI-gated; board impact is a planning item — convention). Plan template gains `Story:` + a `Board impact:` prompt. Beta marker dropped from SKILL/README; CLAUDE.md updated for the monorepo layout. CI now gates board typecheck + tests + a build-and-byte-diff **artifact-freshness** check.

## Non-obvious decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Who parses sprint/story files? | The board (small tested TS readers), **not** `plot-plan-meta.sh` | The helper is "the ONE place that knows what a *plan* file looks like." Sprints and stories are different entities/formats — overloading the awk with two more vocabularies would blur the contract. Plan *membership* fields (`story`/`sprint` on a plan) stay in the helper. |
| CI freshness: byte-diff vs functional | **Rebuild + byte-diff** | Verified the build is deterministic (byte-identical across 3 rebuilds) and platform-clean (no leaked abs paths, no `darwin`/`arm64` in the bundle) — so a Linux CI rebuild should match. The first release regenerates the artifact on Linux and it self-heals from there. (Advisor flagged the cross-machine risk; determinism + platform-clean evidence makes the byte-diff safe. If CI ever reddens on platform, commit the CI-built artifact.) |
| Changesets pre-release mode for `rc`? | **No — hand-pin `1.0.0-rc.1`** | `changeset pre enter rc` writes `.changeset/pre.json` for the *whole workspace* and would drag `plot` (mid-1.6.x) into `-rc` too. Board version is hand-pinned; no board changeset this PR; npm publish stays open-but-deferred (org `plot-pm` exists). Only a `plot` minor changeset ships here. |
| Manual version bumps? | **No** | The release pipeline bumps SKILL.md + the 3 metadata files from the changeset's `bumps:` block (`bump-skill-versions.sh` → `changeset version` → `sync-versions.sh`). Bumping by hand would double-bump. The `version` script gained `build:board` so the release PR carries a fresh artifact. |
| No npm publish trigger from adding a publishable package | Confirmed safe | `release.yml`'s publish step runs `create-release.sh` (tags + GH release), **not** `changeset publish` — so `@plot-pm/board` (`access: public`, no changeset) is inert in the release flow. |
| zod in client bundle? | **No — server validates, client uses `type` imports** | Keeps zod out of the client bundle (size). The schemas are exported as a `@plot-pm/board/contract` subpath to keep the R2 (public viewer) option open. |

## Verification

- `pnpm test` (skills parse), `pnpm run validate`, `pnpm run typecheck` → clean.
- `pnpm run test:reconcile` → **36/36**; `pnpm run test:board` → **8/8** (integration tests spin up the *built artifact* against scratch repos, incl. an explicit "frontmatter plan renders" assertion).
- Artifact freshness: `pnpm run build:board` produces no git diff.
- **Manual UI (Playwright)** against a scratch repo with all four phases + a sprint + a story: React app mounts, 4 columns render with type/sprint/story badges + assignee; the frontmatter plan appears; selecting a story filters to matching cards, suppresses story badges, and writes `?story=…`; sprint∩story intersection verified (`?story=kanban-board&sprint=__no_sprint__` → only the sprint-less story card); console clean (0 errors after adding an inline SVG favicon).

## Notes for next time

- **Board tests need a build first.** `pnpm test:board` = build && test (it runs the shipped artifact, not the TS source). CI runs the freshness build before the tests, so the artifact is fresh when tests run.
- **Determinism is load-bearing** for the freshness gate. If a future dep makes the bundle non-deterministic (hashes, timestamps), the byte-diff gate breaks — keep `reportCompressedSize:false`, no sourcemaps, no content hashes in the single-file output.
- **Introducing `pnpm-workspace.yaml` silently drops the root `plot` package from changesets.** Before this PR there was no workspace, so changesets treated the lone root `package.json` as its package set. The moment a workspace file exists, changesets discovers packages only from the glob list — so `packages: [packages/*]` made `changeset status` fail with "changeset kanban-board-v1 for package plot which is not in the workspace," which would silently no-op the plugin bump at release time (release job runs post-merge, so PR CI never catches it). Fix: list `.` in the workspace globs so the root is rediscovered. Verify with `pnpm exec changeset status --verbose` → must show `plot 1.7.0`.
- **R1/R2 research** (board editing; public `board.plot.pm`) shipped as `docs/research/` write-ups, explicitly not committed to. The package split + the `@plot-pm/board/contract` subpath were chosen to keep both options open.
- Board versions **independently** from the plot plugin. Graduating `1.0.0-rc.1 → 1.0.0` is dropping the tag; wiring npm publish (the deferred work) means adding a publish step + token to `release.yml`.

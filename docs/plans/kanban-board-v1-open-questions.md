# kanban-board-v1 — open questions → decision log

> Output of `/challenge-the-plan` (2026-07-12) on [`2026-07-12-kanban-board-v1.md`](2026-07-12-kanban-board-v1.md). Max decided all five on 2026-07-12; decisions are woven into the plan. This file remains as the decision log.

## Q1 — Publish to npm with this release? → **Deferred; first release is a release candidate**

Decision: do **not** publish 1.0.0. First release is `1.0.0-rc.1`, shipped as the in-repo bundled artifact only. The npm path stays **open** (org `plot-pm` exists) but **deferred** until size/usage justify it. Data-driven recommendation below.

### Q1.1 — Expected artifact size

Single-file esbuild bundle, deps inlined, client served from memory. From published bundle stats of the runtime pieces:

| Piece | minified |
|---|---|
| react + react-dom (client) | ~140–180 KB |
| radix select/popover/checkbox + cmdk (multi-select) | ~60–90 KB |
| zod | ~15–60 KB (v4 core vs v3) |
| tailwind output (purged) | ~15–30 KB |
| app + server code | ~30–50 KB |

**Estimate: ~400–600 KB minified single file; ~120–160 KB gzipped.** Well under 1 MB. Each release *replaces* the file; git history grows ~100–150 KB (delta-compressed) per release. For scale: today's vendored lit-html is ~7 KB — a real increase, but flat per release and trivial against clone size.

### Q1.2 — Install+run recommendation: **(a) ship the bundled file in-repo**

Run story after skill install (Node guaranteed): `node skills/plot/scripts/board/board-server.mjs` — or `pnpm board` in this repo. **No install step, no network, no registry.**

Option (b) "ship package.json + lockfile, install on the fly" was examined and rejected on a structural point: the React client must be **built** no matter what — a browser cannot `npm install` — and the server is dependency-free `node:http` by design, so there is *nothing to install at runtime*. (b) doesn't avoid bundling; it only relocates the built code from git to the npm registry — i.e., it silently re-decides the npm question. It would also add first-run network dependence and a node_modules footprint for zero functional gain. If the artifact ever outgrows git comfort (say ≫1 MB) or non-plot repos want the board standalone, that is the trigger to flip on npm publishing — the packaging already supports it.

### Q1.3 — Version scheme

Confirmed pre-release-first, with one amendment: **`1.0.0-rc.1`** rather than `0.1.0-rc.1`. Rationale: it sorts below 1.0.0, names the target explicitly, and graduation is just dropping the tag (`rc.1 → rc.2 → 1.0.0` via changesets pre-release mode, `changeset pre enter rc`). `0.1.0-rc.1` double-gates (0.x *and* rc) and leaves an awkward 0.1.0 → 1.0.0 hop. npm publishing stays open-but-deferred; if enabled later, RCs publish under `--tag rc` so `latest` never points at a candidate.

## Q2 — Package name → **`@plot-pm/board`** (npm org `plot-pm` exists)

## Q3 — Sprint filter → **multi-select** (A): shared component with the story filter, `?sprint=a,b`; old single-value links keep working.

## Q4 — "Board impact in every plan" → **prose** (A): DoD entry + `Board impact:` prompt-comment in the plan template; not a CI gate. The mechanical "board must work" half is still CI-gated.

## Q5 — Plan type → **`feature`** confirmed (A).

---

### Settled during the challenge (unchanged, for reference)

- Artifact stays at `skills/plot/scripts/board/`; built + committed by the changesets version step; CI rebuild-and-diff freshness gate; deterministic single-file esbuild bundle, assets served from memory (no fs static serving → no traversal surface).
- Board discovers `docs/plans/` / `docs/sprints/` / stories dir via `plot-config.sh` instead of hardcoding (manifesto Q2).
- `plot-plan-meta.sh` gains `title`/`sprint`/`story`/`assignee` with fixtures; frontmatter wins, H1 fallback for title.
- shadcn/tailwind adopted as directed (build-time only; runtime artifact stays zero-dep). UI is a reimplementation of the current layout, not a redesign.
- Story filter: one story per plan (mirrors sprint); filters intersect; hidden when no stories dir; 30s client polling replaces manual refresh; keyboard/a11y via radix primitives, verified manually.
- Zod schemas exported as `…/contract` subpath to keep the R2 (public viewer) option open.
- Known risk to handle in implementation: release chain + changeset-check CI currently assume a single versioned package.

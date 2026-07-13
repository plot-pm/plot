# Council review to convergence + delivery of PR #40

**Date:** 2026-07-13
**Scope:** Deliver the kanban-board-v1 work (PR #40) via an AI-council review run
to convergence, real fixes for every actionable finding, a cleanup rebase, and a
merge-commit merge. Two maintainer-directed housekeeping changes rode along.
**Branch:** `idea/kanban-board-v1` (PR #40)

## Two housekeeping changes first

1. **Plan-template resolution → config key (Part 1).** The earlier project-local
   plan-template override had been implemented with a bespoke
   `plot-plan-template.sh` that sniffed for a magic `.plot/templates/plan.md`.
   Max chose the simpler mechanism: resolve it through the existing
   `plot-config.sh` as one more `## Plot Config` key, `Plan template`. Deleted the
   bespoke script + its test; `/plot-idea` now resolves via
   `plot-config.sh get "Plan template" skills/plot/templates/plan.md` (configured
   path wins, shipped template is the fallback). See
   `2026-07-13-plan-template-scoping-fix.md` for the full mechanism history.
2. **Board version pinned to 0.2.0.** `packages/board/package.json` was
   `1.0.0-rc.1`; set to exactly `0.2.0` per Max (commit 9075071). Deliberate —
   the changeset-managed `plot` skill version was left untouched. NB: the plan
   doc and session logs still say `1.0.0-rc.1`; left as point-in-time records.

## The council arc (why two runs)

Reviewed the **source-only** diff (`git diff origin/main...HEAD` with the 672 KB
minified `board-server.mjs`, the lockfile, and `dist/**` excluded). Including the
artifact in round 0 had pushed the estimate to $1.69 / 313k tokens — over the
$1 confirmation gate and mostly noise. The filtered diff is ~65k tokens / ~$0.49,
under the gate (no `--yes` needed) and far better signal. Council: 4 frontier
models via OpenRouter, `code` rubric/preset.

**Round 1** (4/4 delivered, $0.85) found three real majors on the new
`/plan/<file>` viewer, all verified against the repo:

- **XSS** — the full-page `/plan` view renders `marked` output with no
  sanitization and no CSP; only the modal's iframe was sandboxed. The route is
  network-reachable (HOST → `0.0.0.0`, previews over Tailscale), so this was
  genuinely exposed. → `Content-Security-Policy: script-src 'none'` on `/plan`
  responses.
- **DoS** — `decodeURIComponent` on a malformed `%` threw `URIError` outside the
  `try`, crashing the single-process server. → decode inside `try`, `URIError` → 400.
- **Windows** — `planHref` split `card.path` on `/` only, but the path uses the OS
  separator. → `split(/[/\\]/)`.

All three fixed in commit **a971395** with tests (CSP header present; malformed-%
→ 400 and server survives; backslash path → correct basename).

**Round 2** (confirmatory re-run, 4/4, $0.75) verified the three majors are gone
and surfaced one **new major** that no unit test would have caught:

- **URL filter validation regression** — `?sprint=`/`?story=` values were read
  raw; `passesFilter` hides every card when the selection matches no option, so a
  stale/typo slug blanked the board. This directly contradicts the plan (line
  148: values "validated against known slugs"). → pure
  `sanitizeSelection(selected, options)` drops unknown values; `App` derives
  `validSprintSel`/`validStorySel` for `BoardView` + the `MultiSelect`s. An
  all-invalid selection collapses to "no filter" (show all). **Pure derivation**
  — no state/URL churn on render or the 30s poll (an effect-based fix would have
  looped or stripped slugs mid-session).
- **`collectPlanFiles` `.md`-directory nit** — a directory named `foo.md` passed
  the extension check and would be handed to `plot-plan-meta.sh`. → `isFile()` guard.

Both fixed in commit **1475514** with tests (an unknown slug no longer blanks the
board, via `passesFilter`; a real `docs/plans/*.md` directory is skipped).

### Conscious declines (one line each)

- Version 0.2.0 vs docs' 1.0.0-rc.1 — the pin is intentional (Max, Part 2); the
  council is blind to that decision. Not reverted; history not rewritten.
- Contract subpath exports `.ts` — npm publishing is deferred; no runtime consumer
  in v1.
- Modal focus trap — dialog already has role/aria-modal/Esc/backdrop/Close; full
  trap is v1-deferrable a11y polish.
- Dev server doesn't mock `/plan/` — dev-only DX; the built artifact is the
  shipped + tested path.
- CI freshness byte-diff flake — accepted risk documented in the plan.
- `plot-config.sh` parens stripping — documented tradeoff; persisted from round 1.

**No round 3.** Round 1's re-run earned its cost (it caught the filter major);
a third pass would only surface fresh nits — the diminishing-returns chase the
skill's stuck-rule warns against. Convergence criterion met: no new *actionable*
feedback (per task, not waiting for an APPROVED verdict).

Full report + recorded verification outcomes:
`~/.local/state/ai-council-review/kanban-board-v1/2026-07-13-20-35-08/report.md`.

## Cleanup rebase

Folded the one genuine build-then-discard churn: `1f8cd76` (built the bespoke
`plot-plan-template.sh`) squashed into… actually into a single clean
config-key commit with `7b3068a` (which deleted that script). Neither touched the
minified artifact, so the fold was conflict-free. The plan-viewer trilogy
(`9b529ba` feature → `76d6d00` refine → `a971395` harden) and the round-2 fixes
(`1475514`) were **preserved as distinct thematic commits** — they each rebuild
the artifact and edit the same `/plan` handler, so folding the review-fixes back
would have forced source + artifact conflicts for no real gain, and the honest
feature → refine → harden sequence is worth keeping.

## Verification before merge

Local, all run and green at the time this log was written:

- `pnpm run test:board` — 36 vitest + 9 node:test green (incl. all new fix tests).
- `pnpm run typecheck` — clean.
- `pnpm run test:reconcile` — 39/39.
- `pnpm test` (skills validate) — exit 0.

The CI `validate` gate is confirmed green on the final (rebased) head before the
merge is issued.

## Delivery

Merge procedure: `gh pr merge 40 --merge` (a **merge commit**, not rebase/squash
— the granular thematic history is the point), then delete the remote branch. The
merge SHA is recorded in the session summary rather than here (it does not exist
until the merge lands).

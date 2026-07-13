# plot-config.sh — tolerate backtick-quoted values with prose

**Date:** 2026-07-13
**Scope:** Make `plot-config.sh` parse real-world `## Plot Config` entries that write values as backtick-quoted markdown with trailing prose notes.
**Branch:** `fix/plot-config-prose` (off `main`, **not** the kanban-board-v1 / PR #40 branch)

## Why

A live preview of the new board (PR #40) against a real adopter repo (Quatico's
`cpq-cds`) surfaced a latent bug: the board rendered **0 of 104** board-eligible
plans. Root cause was not the board — it was `plot-config.sh`. `cpq-cds` writes
its config the way people naturally write markdown:

```
- **Plan directory:** `docs/plans/` (date-prefixed `YYYY-MM-DD-<slug>.md`, never moved once created)
```

The old extractor stripped a *leading* backtick but not a backtick-quoted value
followed by prose, so it returned the whole string
`` docs/plans/` (date-prefixed …) `` as the "path." That directory doesn't
exist → the board's `collectPlanFiles` found nothing. (Stories still rendered
because `cpq-cds` has no `Story directory` key, so the board used the clean
default — which is what made the bug look like a board problem rather than a
config one.)

This is squarely a "discover and adapt, never enforce" fix (Manifesto): a config
reader that breaks on backticks is enforcing a rigid format.

## The tricky part (why "first backtick span" is wrong)

`cpq-cds`'s **branch prefixes** line is the real hazard:

```
- **Branch prefixes:** `idea/` (plans), `feature/`, `bug/`, `docs/`, `infra/` (implementation)
```

It combines a backtick-quoted first item **+ inline `(prose)` + a comma list**.
A naive "extract the first backtick span" rule truncates this to `idea/`. And
the `Plan directory` line has **two** backtick pairs (the value *and* a
backticked token inside its prose), so a "count the backticks" rule is also
fragile.

## The fix

One principled, uniform transform on the value (after the `key:` prefix):

1. strip parenthetical prose — `s/\([^)]*\)//g`
2. strip markdown backticks — ``s/`//g``
3. normalize list separators to `, ` and collapse/trim whitespace

Justification: **no documented key's value legitimately contains a backtick or a
parenthesis** — they are paths, prefix lists, or `owner/number`. So backticks
are always decoration and `(...)` is always prose. Documented in the script
header and inline.

Results on `cpq-cds`'s real config:

| Key | Before | After |
|-----|--------|-------|
| Plan directory | `` docs/plans/` (date-prefixed …) `` (bogus) | `docs/plans/` |
| Sprint directory | `` docs/sprints/` (ISO week-prefixed …) `` (bogus) | `docs/sprints/` |
| Branch prefixes | `` idea/` (plans), `feature/` … `` (mangled) | `idea/, feature/, bug/, docs/, infra/` |

## Tests

`test/reconcile/config.test.mjs` gains a real-world case built from `cpq-cds`'s
actual lines, asserting both hard shapes:

- backtick-quoted value **+ prose containing a nested backtick** → clean value
- backtick-quoted **multi-value list + inline prose** → whole list, never
  truncated to the first span

All existing config assertions (plain path, plain list, indented backtick value,
case-insensitivity, section boundaries, HTML-comment exclusion, defaults) still
pass unchanged — the transform is a superset. `config.test.mjs` 8 → **9**; full
reconcile suite **33/33**.

## Verification

- **Independent correctness:** `config.test.mjs` shells out to `plot-config.sh`
  directly (no board/parser dependency) — 9/9.
- **End-to-end board render:** the `cpq-cds` preview server was restarted with a
  scripts dir combining PR #40's `plot-plan-meta.sh` (frontmatter title support)
  and this fixed `plot-config.sh`, reflecting the post-both-merge state. The
  board went from **0 → 104** cards (89 Delivered, 8 Approved, 7 Draft), verified
  via `/api/board`, not just visually.

## Notes

- **Separate PR from #40 by design.** PR #40 is reviewed, green, and awaiting
  merge; this is a pre-existing helper bug, not a #40 regression, so it ships on
  its own branch off `main`. Both are needed for `cpq-cds` to render *nicely*
  (this fix unblocks the plans; #40 adds their titles), but each stands alone.
- The board artifact is **not** rebuilt here — the board shells out to
  `plot-config.sh` at runtime, so no bundling is involved.

## Implementation brief — info-vs-warning-vs-error-and (wave: Classification)

- **Plan (canonical):** `docs/plans/2026-10-23-info-vs-warning-vs-error-and.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2426 merged
- **Branch:** `bug/the-pr-status-has-a-level-and-a-cause` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This is the first of two slices. `bug/the-board-shows-the-pr-level-and-diagnostics` (the Banner wave) renders what this wave produces and waits on it — it touches the footer component and the diagnostics view, not the classification. No branch of this plan is pushed yet; claim `bug/the-pr-status-has-a-level-and-a-cause` by pushing it before starting work.

### What to build

Today `packages/board/src/app/lib/agent-rows/host-notes.ts` builds the PR footer sentence procedurally: `prNote` (around line 330) switches on `hostErrorState(fleet.prError)` and string-concatenates a sentence per case. The plan's own measured example — Bitbucket, 2026-10-23 — shows the actual failure mode: the unreachable-host branch does `` `PR data unavailable (${fleet.prError})` ``, splicing `plot-host`'s raw stderr straight into the reader-facing sentence. That string holds two notices (`ignores --limit 1000`, `page complete`) that are not failures — they are `plot-host` telling you the page is complete — wrapped around the one fact that matters and is currently absent: an HTTP 429 happened and the backoff runs 14 minutes.

Build a domain value — a pure function, not a component — that takes what `host-notes.ts` already has (`prError`, `prAgeSeconds`, `prNextInSeconds`, the refusal classification) and returns a typed decision: `level` (`'info' | 'warning' | 'error'`), the cause, the backoff end, and the `plot-host` notices split out as a separate list rather than folded into the cause string. `host-notes.ts` currently imports `refusalKind` and `resetApplies` from `@plot-pm/domain` (`packages/domain/src/rules/refusal.ts`) — this new value lives beside them in the domain package, and `host-notes.ts`/`prNote` becomes the thing that reads the value and renders words, per CLAUDE.md's *Every rendered state is a domain property*. Unit-test every row of the plan's own table (info/cache-fresh, warning/stale-or-incomplete, error/no-data-or-no-credentials) with no rendering involved.

### Decisions the plan settles — do not re-derive them

**The classification lives in the domain, the wording stays in the board.** `prNote`'s own doc comment already states this split for the sentence-composition it does today ("THE CLASSIFICATION IS THE DOMAIN'S, not a second detector here" — `refusalKind` decides, `host-notes.ts` maps). This slice extends the same split to the level/cause/backoff decision: do not build a second classifier in `packages/board`; the domain value is the only place that decides level, and the component only prints what it returns.

**The notice/failure split is a parsing problem that already has an answer — do not re-litigate the plan's own open question.** The plan lists "where does the notice/failure split live: in `plot-host` or in the board" as open, and calls board-side parsing the weaker option because "the error string carries both kinds today." Confirm which before building: if `plot-host.sh`/the host adapter can be made to carry the 429-and-backoff fact as a structured field (it already computes a backoff — see `fleet.ts:1717` `backoffUntil` and the gate at `fleet.ts:1803`) rather than embedding it in prose, that is the stronger seam, because a prose split can only ever pattern-match on today's exact wording (the `refusalKind` regexes in `packages/domain/src/rules/refusal.ts` already do this once, fragile by the file's own admission: "an unrecognised message is `outage`, never the more specific name, because a wrong reaction to a refusal is worse than no reaction"). If the error string is in practice the only carrier available at this layer, a parser belongs in the domain next to `refusalKind` — not in `host-notes.ts` — so it stays testable without rendering and stays the single place that decides.

**`prSpenders` cannot name spenders — it is a count, not an identity, and the plan's "name the spenders" item does not belong to this slice.** The plan's Open Questions ask "what identity does the spender record hold today?" — checked: `localSpenders` (`packages/domain/src/rules/refusal.ts`) divides an observed spend *rate* by one spender's *share*; it returns `Math.max(1, Math.round(perHour / share))`, an integer with no identity attached, documented as "FROM THE RECORD, NEVER A HEADCOUNT. The spenders are eleven scripts, the board, and a person at a terminal." Naming "board port, project and session count" per the plan's Design §4 requires extending the budget record itself — a slice belonging to whoever owns that record, per the plan's own text ("that slice belongs to the writer of the record rather than the board"). This slice's classification value carries the existing count (or null) through unchanged; it does not invent identity the record cannot supply.

**The backoff end is already computed — reuse it, do not re-derive a reset time.** `prNextInSeconds` (schema.ts:4330) is the board's existing reset field, and `resetApplies(refusalKind(...))` (`refusal.ts:77`) already decides whether a reset describes the refusal that actually fired — printing it unconditionally was the exact bug fixed on 2026-09-02 (a secondary limit's reset describes the wrong bucket). The new domain value must call `resetApplies` the same way `prNote` does today rather than always attaching a backoff time to the cause.

**Three failure kinds already exist and must not become four.** `hostErrorState` (`host-notes.ts`) returns `'rate-limited' | 'secondary-limit' | 'unreachable' | null`, derived from the domain's three-way `RefusalKind` (`'quota' | 'secondary' | 'outage'`). The plan's three-level table (info/warning/error) is a different axis — severity for display — not a fourth failure kind. Map the existing three kinds onto warning/error; a kind is never itself a level.

**Absent is not false, applied to the backoff and to the notices.** A `null` `prNextInSeconds` or `prSpenders` means "cannot be known," never "zero" — this repo's running rule (see `host-notes.ts`'s own `HOST_ANSWER_HINT` and `ageSuffix`/`resetPhrase` null-handling). The domain value's `cause`/`backoffEnd` fields must be optional and the board must render their absence as silence, not as an invented value.

### Done when

The plan's `## Done when` is implicit in its table and Design section — treat these as the assertions a naive implementation would otherwise skip:

- A unit test exists for each row of the plan's three-level table (info: fresh cache; warning: stale-but-usable or known-incomplete; error: no data or missing credentials) asserting the domain value's `level`, with no component rendered.
- A test proves the `plot-host` notices (`ignores --limit`, `page complete`-style lines) are returned as a separate list from the value, not embedded in the cause string — this is the defect the plan's Motivation section measures directly.
- A test proves a quota refusal's backoff end survives into the value only when `resetApplies` says it applies (reuse, don't re-decide).
- A test proves a `null` spender count renders as absent, never as zero or as an invented name.
- The existing `prNote`/`hostErrorState`/`refusalKind`/`resetApplies` tests (wherever they live under `packages/board/test` and `packages/domain/test`) still pass unmodified unless this slice is deliberately changing their contract — this slice should not need to touch `prNote`'s rendered wording, since that is the Banner wave's job.

Plus the repo's gates: a changeset is required (`'plot': patch` or minor per CLAUDE.md's Versioning section, package `plot` or `@plot-pm/board` depending which package's version moves), and `packages/domain/src/**` changes must keep the arrow-function style (CLAUDE.md § The Domain Package) since this value is new domain code. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base — this slice is TypeScript-only and should not touch shell, so this gate should pass with no action.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch, ready
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch has a claim and a commit history a reviewer can follow. Once the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/` (new classification value, alongside `refusal.ts`), `packages/domain/test/` (its tests), and nothing in `packages/board/src/app/` — `host-notes.ts` and the footer component belong to the Banner wave (`bug/the-board-shows-the-pr-level-and-diagnostics`), which has not started and holds no commits yet. Touching `host-notes.ts` to wire the new value in is the Banner wave's job, not this one's, unless the two are later found to need a combined PR — if so, report that rather than improvising the merge.

No other branch of this plan is pushed as of 2026-10-23 — verify with `git ls-remote --heads origin 'bug/the-*'` before assuming that still holds.

If you find something the plan did not anticipate — in particular, if the notice/failure split turns out to require a `plot-host` adapter change rather than board-side parsing — report it rather than improvising outside scope; that decision affects the Banner wave too.

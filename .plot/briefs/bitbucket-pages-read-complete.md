## Implementation brief — bitbucket-parity-and-app-identities (wave 1: `bug/bitbucket-pages-read-complete`)

- **Plan (canonical):** `docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md` on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Branch:** `bug/bitbucket-pages-read-complete` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan's `Review: pr`)

This branch is one of five in Wave 1 of this plan, all eligible together — none
blocks or is blocked by another. It fixes #1757 only; the other four
(`bug/merge-names-what-it-did`, `feature/bitbucket-commit-status-parity`,
`bug/writer-app-push-uses-only-the-app`, `bug/app-identities-refuse-by-name`)
touch different files. `bug/merge-names-what-it-did` has already started
(plan's `Started:` record, 2026-10-16) — nothing here depends on its outcome.

### What to build

#1757's observed failure: `BB_LIST_PAGE_VERSIONS` in `plot-host.sh:2769` and
`BITBUCKET_PAGE_LENGTHS` in `packages/domain/src/adapters/host/listing-paging.ts:15`
each name only `bb 1.9.0`. Any other `bb` version — including 1.11.1, which is
what answers on this machine today — makes `bb_list_page_length` return empty,
so `pr_list_report_truncation` (`plot-host.sh:2816`) can never prove a page
complete under it. Measured 2026-10-15: `pullrequests?state=OPEN&pagelen=50`
against 1.11.1 returns 9 values and no `next` key — an unambiguous last page —
and the current rule still reports it `possibly truncated`.

The fix the plan commits to: **a page's own envelope answers completeness, for
any `bb` version.** `bb_state_listing` (`plot-host.sh:1169`) already receives
this envelope — `{"values": [...], "next": "<url>"}` — from `bb api`, exactly
as `bb_window_listing` (`plot-host.sh:1086`) does for the full-pagination walk
that already reads `next`'s absence as "no more pages" (see its own header,
`plot-host.sh:1074-1076`). Today `bb_state_listing` discards everything but
`.values` (`plot-host.sh:1179`, `jq -c '.values // []'`), so
`pr_list_report_truncation` only ever sees a row count — it has no path to the
one field that would let it prove completeness directly. Carrying whether
`next` was present out of `bb_state_listing`, alongside the rows, is the
change; `BB_LIST_PAGE_VERSIONS` stays as the fallback for whichever `bb`
version does not return an envelope with a `next` key at all (the plan's rule;
no version is known to lack one, but the rule must not assume it).

### The decisions this plan settles — do not re-derive them

**Envelope-first, version-table fallback — not a version bump.** Adding
`1.11.1` to both tables would fix today's measurement and break again on the
next `bb` upgrade, which is the exact failure mode #1137 and #1757 both name
("removes the list as a per-upgrade chore" — plan's Slice 2 rule). The tables
are not deleted: the plan's Open Question asks whether every `bb` version
returns an envelope with `next` on every page, and the honest answer absent a
wider measurement sweep is "unknown" — so the version table remains the
fallback a caller reaches only when the envelope gives no opinion (no `next`
key present AND no `values` key present, i.e. not an envelope shape at all, or
`bb` exits non-JSON). Do not remove `BITBUCKET_PAGE_LENGTHS` or
`BB_LIST_PAGE_VERSIONS`.

**`next`'s absence, not its presence, is the signal that matters here.** A
page WITH `next` is only "possibly truncated" the same way it is today — it
proves nothing new, since a Bitbucket page can in principle set `next` even
when remaining rows are zero (not observed, but the rule must not claim
otherwise without evidence). A page with no `next` key at all, from an
envelope response, is unconditionally the last page regardless of row count:
0 rows, 9 rows, or 50 rows with no `next` are all complete. This is stronger
than the existing `pageLength`-based test (`rows < pageLength`), and supersedes
it whenever the envelope is available — the pageLength test still applies to
the non-enveloped Bitbucket read path (`bb pr list --json`, used nowhere in
`pr_list_report_truncation`'s own call path today — confirm this before
assuming a second call site needs the same treatment).

**Why this is a corpus-held duplicate, not a domain-only answer
(`docs/shell-and-domain.md`).** `pr_list_report_truncation` runs once per
agent per pass — it is on `plot-fleet-scan.sh`'s hot path, which
`the-pass-is-measured` (2026-10-09) measured a `node`-hop launcher at 1750% CPU
overhead over keeping the shell duplicate at 8 concurrent agents. So the rule
is implemented twice on purpose: in `plot-host.sh`'s `pr_list_report_truncation`
/ `bb_list_page_length`, and in the domain's `pagePossiblyTruncated`
(`packages/domain/src/rules/listing-page.ts:35`) via `listingPagingFor`
(`listing-paging.ts:27`). `corpus/listing-page.corpus.test.ts` already holds
this pair for the version-table path — extend it (not replace it) to cover the
envelope path, the same way `docs/shell-and-domain.md`'s `corpus/` tier
requires: **on a disagreement, stop and name both answers; do not adjust either
side to make the comparison pass.**

**This changes a type, and the type is shared.** `ListingPaging`
(`listing-page.ts:9-11`) today has two variants: `honours-limit` (GitHub) and
`fixed-page` (Bitbucket, keyed by measured length). Carrying envelope-derived
completeness through the domain rule means either a third variant (e.g.
`envelope-known`) or a field on the existing page/case type that says whether
this specific page declared no further page (independent of `paging.kind`).
Prefer whichever keeps `pagePossiblyTruncated`'s existing cases (GitHub
honours-limit, Bitbucket fixed-page-by-version) completely unchanged — this
slice adds a new way to prove completeness, it does not change how the
existing two are decided. The corpus test's stub `bb` (lines 64-69 in the test
file) will need its JSON to vary `next`'s presence per case, the same way it
already varies `rows`.

### Done when

The plan's `## Done when` is: #1757 is closed on main, meaning a page without
`next` reads as complete regardless of `bb` version, both `plot-host.sh` and
`listing-paging.ts` implement the same rule, and a corpus test holds them to
agreement. Lift these assertions specifically, because a naive patch passes
without them:

- A case where `bb` answers version `1.11.1` (or any version absent from both
  tables) with an envelope that has 9 rows and NO `next` key must report
  **complete**, not "possibly truncated". This is the literal fix for #1757 and
  the measurement the Motivation table cites — a test asserting only the
  `1.9.0` and `1.10.0` cases (today's corpus) would pass with the bug intact.
- A case where `bb` answers an UNMEASURED version with a `next` key present
  must still report "possibly truncated" — the envelope rule proves
  completeness only from absence, never contradicts a declared next page.
- A case at 50 rows (today's page length) with no `next` must read complete —
  proving the new path supersedes the old `rows < pageLength` test rather than
  only covering rows strictly below it.
- The existing three corpus assertions (lines 98-120 of
  `listing-page.corpus.test.ts`) keep passing unmodified in their GitHub and
  `1.9.0`/`1.10.0` Bitbucket cases — this is an addition, not a rewrite of the
  rule's existing behaviour.
- `skills/plot/scripts/README.md`'s `plot-host.sh` row, if it names page-length
  semantics, is corrected to mention the envelope path (check the row before
  assuming it needs an edit — the plan does not require touching the row if it
  currently says nothing version-specific).

Plus: the repo's gates. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints — it resolves the tests and typecheck for the packages this
slice touches (`packages/domain/**` → vitest + `tsc --noEmit`) and the gate
scripts (`check-script-names.sh`, `check-temp-paths.sh`,
`check-ancestry-decisions.sh`, etc., listed under `## Plot Config` → `Local
checks`). The suites under `## Plot Config` → `CI suites` (including
`pnpm --filter @plot-pm/domain exec vitest run --coverage`, which this corpus
test lives under) run in CI on the PR — do not run the full suite locally.

Name the shell gate explicitly: this slice edits `plot-host.sh`, so
`scripts/check-shell-lines.sh` will compare its new line count against the
merge base. If the envelope-reading addition grows `plot-host.sh`, pay for it
in the same change — trim shell elsewhere in the file, or push logic into the
domain rule instead of growing the shell copy further.

### Bookkeeping

Open the PR through the controller once there is a first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it takes the PR title from the last commit subject
and skips the plan/brief linkage the controller writes into the PR body. Once
the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Slices` → Wave 1 list (the line starting `bug/bitbucket-pages-read-complete`).

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh` (the `BB_LIST_PAGE_VERSIONS`
table, `bb_list_page_length`, `bb_state_listing`, `pr_list_report_truncation`),
`packages/domain/src/adapters/host/listing-paging.ts`,
`packages/domain/src/rules/listing-page.ts` (if the type needs the new
variant/field), and `packages/domain/corpus/listing-page.corpus.test.ts`.
Touch `skills/plot/scripts/README.md`'s `plot-host.sh` row only if it currently
makes a version-specific claim that would become false.

Other Wave 1 branches and what they hold, verified against the plan at dispatch
time — none collide on the files above:

- `bug/merge-names-what-it-did` (already started) — `merge.ts`, `controller-gate.ts`,
  `skills/plot-sprint/SKILL_new.md`
- `feature/bitbucket-commit-status-parity` — `plot-bitbucket-commit-status.mjs`,
  `plot-host.sh`'s `commit-status` arm (a different function/section of the
  same file — if both land, the merge order matters; `/plot-merge-queue` will
  surface it, do not pre-resolve it here)
- `bug/writer-app-push-uses-only-the-app` — `plot-push-writer-app.mjs`,
  `plot-merger-token.mjs`, `plot-push-main.sh`, `pushmain.test.mjs`
- `bug/app-identities-refuse-by-name` — `plot-github-app.mjs`,
  `plot-commit-status.mjs`, `plot-host.sh`'s repo-lookup failure path,
  `docs/review-status-rollout.md`, `approve*.test.mjs`

`feature/bitbucket-commit-status-parity` also edits `plot-host.sh`. Both
branches touching the same file is a known, accepted collision in a shared
file — not a scope violation — and `/plot-merge-queue` predicts whether the
two diffs actually conflict before either merges.

If you find something the plan did not anticipate — e.g. a second call site
that reads Bitbucket pages without going through the envelope, or evidence
that some `bb` version omits `next` even when more pages remain — report it
rather than improvising outside scope.

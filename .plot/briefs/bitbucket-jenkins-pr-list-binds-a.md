## Implementation brief — bitbucket-jenkins-pr-list-binds-a

- **Plan (canonical):** docs/plans/2026-10-18-bitbucket-jenkins-pr-list-binds-a.md on main
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2056 merged
- **Branch:** `bug/bitbucket-jenkins-pr-list-binds-a` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required since 2026-10-15)

PR #1974 merged 2026-10-18T16:45Z (`f50e12d24`), so `jenkins_bind_rows` is on `main` and nothing blocks this slice.

### What to build

The Bitbucket arm of `pr-list --rich` under `CI: jenkins`
(`plot-host.sh:4377-4413` as of `f50e12d24`, #1974 merged) reads `checks`
from `$jmap[.source.branch.name]` — the Jenkins branch colour — and never
emits `checksSha`. A push between builds leaves the row showing the
*previous* head's `green` until Jenkins builds the new one, because the
branch-colour map carries no commit. The board and the merge queue read
`checks`/`checksSha` straight off this row, so a stale `green` reads as
"safe to merge" for a commit nobody built.

The GitHub arm already closed this gap (#1959, then refactored by #1974
into the reusable `jenkins_bind_rows`, `plot-host.sh:1765` onward): it
names the rows the branch-colour map can't settle to a commit (`green`
or `failing` with a head sha), reads each one's builds by sha, and binds
the result over the branch-colour map before emitting `checks`. The
GitHub `pr-list` arm calls it at `plot-host.sh:4237`. This slice gives
the Bitbucket `pr-list` arm the identical treatment.

### The decisions the plan settles — do not re-derive them

**Call the existing bind path; do not write a second one.** PR #1974 (now
merged) refactored the GitHub arm's inline bind loop into a reusable shell
function, `jenkins_bind_rows` (`plot-host.sh`, next to `jenkins_sha_runs`):

```bash
jenkins_bind_rows() {
  { jq -c . <<<"$2"; jq -c . <<<"$3"; } | node "$here/board/plot-jenkins-pr-checks.mjs" rows 2>/dev/null \
    | while IFS=$'\t' read -r _b _s _j; do
        _r=$(jenkins_sha_runs "$1" "$_b" 20 "$_s" 2>/dev/null </dev/null) || break
        printf '%s\t%s\t%s\t%s\n' "$_b" "$_s" "$_j" "$_r"
      done | node "$here/board/plot-jenkins-pr-checks.mjs" bind 2>/dev/null
}
```

The GitHub `pr-list` arm now calls it as
`_sha_map=$(jenkins_bind_rows pr-list "$jen_map" "$_gh_raw")`. The
Bitbucket `pr-list` arm should call the same function the same way,
passing `$jen_map` and the Bitbucket rows shaped the way
`board/plot-jenkins-pr-checks.mjs rows` expects: a `headRefName` and a
`headRefOid` per row (the `PrRowHead` interface in
`packages/domain/src/rules/jenkins-pr-checks.ts`). Bitbucket's head commit
lives at `.source.commit.hash` — map it to `headRefOid` when building the
array you hand to `jenkins_bind_rows`, matching PR #1974's own
`bb_state_row` (`pr-state`'s Bitbucket arm), which does exactly this:
`jq -c '[{headRefName:.source.branch.name,headRefOid:.source.commit.hash}]'`.
Two call sites now share one bind function — `pr-state` (#1974) and this
slice's `pr-list` — and a third copy of the bind loop is the bug this
brief exists to prevent.

**Prefix matching is already built into `jenkins_sha_runs` — do not add a
second match rule.** #1974 added this arm to `jenkins_sha_runs`'s jq
filter:

```
if $sha != "" then map(select(.sha == $sha or (($sha | test("^[0-9a-f]{7,}$")) and (.sha | startswith($sha)))))
```

A 12-character Bitbucket short hash now matches a 40-character Jenkins
SHA1 by prefix, for any caller of `jenkins_sha_runs` — which
`jenkins_bind_rows` already is. Calling `jenkins_bind_rows` for the
Bitbucket arm gets prefix matching for free; writing a second comparison
(e.g. `startswith` in the `pr-list` jq pipeline itself) would duplicate a
rule that already lives in one place.

**`pending` vs `unknown` is settled by #1959/#1974, not by this
slice.** `bindChecks` (`rules/jenkins-pr-checks.ts`) already answers: a
head with no matching build reads `pending`
(`jenkins-pr-checks.ts:80-81`), and `ABORTED`/`NOT_BUILT` read `unknown`.
The plan's Design note — "A colour that cannot bind to the head reads
`unknown`, never `pending`" — describes the *outer* fallback: where
`$jstatus != "ok"` (Jenkins unreachable) the row is `unknown` regardless
of binding, exactly as the existing jq branch already does
(`if $jstatus != "ok" then "unknown" ...`). Don't invent a third word or
move this logic; the existing three-way branch (`unknown` / `none` /
bound value) is the full contract.

**`$jmap`/`jenkins_build_map` is the fallback, not the thing to
extend.** As in the GitHub arm, a row the bind step could not settle
(beyond `SHA_LOOKUPS_PER_PASS`, or where the lookup itself failed) keeps
its branch-colour reading from `$jmap`. The overlay precedence is
`$shamap[.head] // $jmap[.head] // null`, matching the GitHub arm's
`($shamap[.headRefName] // $jmap[.headRefName] // null)` exactly — write
the Bitbucket jq filter the same way, keyed by `.source.branch.name`.

**Emit `checksSha` from the bound reading, `""` where nothing bound.**
This is the field the plan's Changelog promises and the current Bitbucket
arm omits entirely. Read it off `$eff.checksSha` (or whatever field name
`bindChecks`'s output object uses — confirm against
`rules/jenkins-pr-checks.ts`'s `BoundChecks` interface) the same way the
GitHub arm's jq filter does, rather than leaving it absent.

**Host tests use real-shaped values.** A 12-character Bitbucket short hash
and a 40-character Jenkins SHA1, per the plan's Design note and matching
#1974's own test fixtures in `test/reconcile/host.test.mjs` — a shortened
fixture (e.g. `"abc123"` for both sides) would pass even if the
prefix-match arm were silently dropped.

### Open question carried from the plan

`SHA_LOOKUPS_PER_PASS` bounds the GitHub arm's per-pass cost at 5 rows.
Whether Bitbucket's own pagination changes that bound (the plan's second
Open Question) is not yet answered — read how `pr_list_states`/`bb_cmd`
paginate before assuming the GitHub constant applies unchanged, and say
in the PR body whichever way you resolved it.

### Done when

The plan's `## Changelog` is the specification: `pr-list --rich` on
Bitbucket with `CI: jenkins` binds each row's `checks` to the PR's own
head commit and emits `checksSha`; a branch colour that cannot bind to the
head reads `unknown`. Concretely:

- A Bitbucket `pr-list --rich` row under `CI: jenkins` whose branch colour
  is `green` or `failing` is read by sha through `jenkins_bind_rows`
  before being emitted — not taken straight from `$jmap`.
- `checksSha` is present on every rich row, carrying the bound commit
  where one was found and `""` where nothing bound.
- A host-contract test (alongside `test/reconcile/host.test.mjs`) exercises
  a Bitbucket+Jenkins fixture where the branch colour is ambiguous
  (`green`/`failing`) and the head sha has no matching build — the exact
  case a naive implementation (reading `$jmap` directly, as today's code
  does) would pass without. Use a 12-character short hash against a
  40-character SHA1 fixture so a silently-dropped prefix match would fail
  the test, not just the code.
- `pr-list` without `CI: jenkins`, and a GitHub-backed repo, are both
  unchanged by this slice — this is a Bitbucket+Jenkins-only path.

Plus: this touches `plot-host.sh`, so `scripts/check-shell-lines.sh`
applies (currently 5358 lines) — any growth here must be paid for in the
same change: remove shell elsewhere, or keep the new logic in the call to
`jenkins_bind_rows` rather than inlining a second bind loop. Board impact:
per the plan's note, the board and merge queue read `checks`/`checksSha`
from `pr-list` — if `checks-reading.ts`'s contract changes, rebuild the
board artifact; the plan expects no format change and no rebuild, so
treat a forced rebuild as a signal you drifted from the plan's Approach.

For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` from
this skill's directory before each push and run what it prints — the
tests that name a changed file, related tests and typecheck of a changed
package, and the gate tests and `scripts/check-*.sh`. The suites in the
`CI suites` config key (`pnpm run test:e2e`, `test:contracts`,
`test:board`, domain coverage, reconcile tests) run in CI on every PR; do
not run them locally as a matter of course — see CLAUDE.md's Testing
section on why `test:e2e` in particular is CI's job, not a local one.

### Bookkeeping

Open the PR through the controller once there is a commit to show:

```bash
../plot/scripts/plot-open-pr.sh          # on this branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` by hand. Push the first real commit as soon as
it exists — a desk with only a `PLOT-BLOCKED` marker is not a push.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` — the Bitbucket `pr-list --rich`
  arm under `CI: jenkins` (`:4377-4413` as of `f50e12d24`)
- `test/reconcile/host.test.mjs` — new Bitbucket+Jenkins `pr-list`
  fixture(s) for the bound-head case
- `skills/plot/scripts/README.md` — only if a helper's row changes
- a changeset under `.changeset/` naming this fix

The plan names one slice and one branch — there is no sibling branch in
this plan to collide with. PR #1974 (`feature/bitbucket-pr-state-binds-checks`)
already merged and touched the same file (`plot-host.sh`) and the same
test file, in a different region (`pr-state`'s Bitbucket arm,
`bb_state_row`, and `jenkins_sha_runs` itself) — branch from current
`main` so the line numbers above and the `jenkins_bind_rows` helper are
the ones this branch actually sees.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

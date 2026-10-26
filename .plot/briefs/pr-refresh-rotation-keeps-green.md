## Implementation brief — bitbucket-pr-rows-run-per-row (wave Rotation)

- **Plan (canonical):** `docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md` on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Branch:** `bug/pr-refresh-rotation-keeps-green` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** pr (repo convention — CI green + review)

This branch waits on `bug/bitbucket-checks-lookups-bounded`, which is merged
(PR #2617, `68d7a1ee9`) — the `$wasNamed`/`$capped`/`$broken` wiring and the
shared bind budget this slice builds on are already on main. The next slice,
`bug/bitbucket-bind-coverage-and-docs`, waits on this one and adds tests for
what this slice changes — do not add those tests here, name the behaviour
clearly enough that the next slice can cover it.

### What to build

A PR whose checks have been **green and unchanged for days** goes `unknown`
on this board the moment it drops out of the per-pass Jenkins lookup cap. The
cap (`SHA_LOOKUPS_PER_PASS`, `rowsToBind` in `plot-host.sh`) selects rows by
most-recently-updated, bounded per pass, so a quiet PR — the ones least likely
to need re-checking — is exactly what rotates out first. Today both the
GitHub-with-Jenkins arm (`plot-host.sh:4591`) and the Bitbucket arm
(`plot-host.sh:4771`) use the same shape: `$wasNamed` false (or `$broken`
true) and `$ambiguous` true (prior colour was `green`/`failing`, the two
states that need a Jenkins sha to trust) collapses `$eff`/`$jentry` to `null`,
and the row's `checks` becomes `"unknown"` with `checksSha` emptied —
discarding the prior reading instead of holding it. On the TypeScript side,
`storeRow` (`packages/fleet/src/shared/pr-refresh.ts:1101`) only copies
`pr.checksSha` when the host answered one (`:1119`); it has no fallback to
`predecessor.checksSha` when the host's answer is empty because the row was
unnamed this pass.

The fix: an unnamed (or broken-ask) row whose prior reading was stable keeps
that reading — its stored `checksSha` and its stored `checks` colour — rather
than dropping to `unknown`. The plan's own words: *"an unnamed row keeps its
prior `checksSha` and its stable reading."*

### The decisions the plan settles — do not re-derive them

**This is a store-side fix, not a shell-side one.** The shell's `pr-list` call
is stateless per invocation — it has no access to what was stored on the
previous pass, only to `$shamap`/`jmap` built from this pass's own Jenkins
reads. The prior stable reading lives in the TypeScript store
(`PrIndexRow.checksSha`, `packages/domain/src/entities/pr-index.ts:79`), which
survives across refreshes. `storeRow` already receives the `predecessor` row
(`pr-refresh.ts:1102`) for exactly this kind of carry-forward — `mergedAt`
(`:1125`) and `headSince` (`:1132`) already fall back to it. `checksSha` (and
the row's displayed `checks` colour) needs the same treatment: when the host's
row reports `checksLookup: 'skipped'` or `'broken'` (meaning this pass's
Jenkins ask did not settle it) AND a predecessor exists with a `checksSha`,
keep the predecessor's `checksSha` and `checks` rather than the host's
`unknown`.

**`checksLookup` is the signal, not `checks === 'unknown'` alone.** A row can
genuinely BE unknown — no Jenkins job, Jenkins unreachable this whole pass
(`$jstatus != "ok"`) — and those must still read `unknown`; they carry no
`checksLookup` field, or they carry `checksLookup` for an entirely different
reason than "this specific row rotated out." Only `checksLookup === 'skipped'`
(past the cap) or `checksLookup === 'broken'` (named, but the lookup broke
before reaching it) mean "no fresh answer this pass, but an older one may
still be good." Gate the fallback on that field, not on the bare value of
`checks`.

**Do not touch the shell's jq where this can be solved in `storeRow`.** The
jq chains at `plot-host.sh:4591` and `:4771` are already dense and carry
their own carefully-named boundary tests (`$capped`, `$broken`, `$wasNamed`).
Changing them to reach backward into prior state would mean teaching the
shell about the store's on-disk shape, duplicating logic `storeRow` already
owns. The shell's job stays "say what this pass learned, and say
`checksLookup` honestly when it didn't learn anything new" — `storeRow`'s job
is "decide what the stored row becomes, given what changed and what didn't."

**Rotation only ever extends a stable reading; it must never fabricate one.**
A row with no predecessor, or a predecessor with no stored `checksSha`, has
nothing to carry forward — it reads `unknown` exactly as today. The fallback
applies only when there IS a prior answer to preserve.

### Done when

The plan's `## Done when` is this slice's own line in `## Slices`: *"an
unnamed row keeps its prior `checksSha` and its stable reading."* Concretely:

- A stored row with `checks: 'green'` and a `checksSha`, refreshed in a pass
  where the host answers that row with `checksLookup: 'skipped'` or
  `'broken'`, keeps its prior `checks` and `checksSha` in the new stored row
  — it does not become `unknown`.
- A row with no predecessor, or a predecessor carrying no `checksSha`, still
  reads whatever the host answered (including `unknown`) — no fabrication.
- A row the host answers plainly (no `checksLookup` field — Jenkins settled
  it, or it was never ambiguous) is unaffected; this fallback is additive to
  what `storeRow` does today.

Plus: the repo's gates — build artifacts, changeset, platform constraints. For
tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints; the suites in `CI suites` run in CI, and a
failure there comes back as a correction. List no full suite here.

**Shell line gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` is longer than at its merge base. This slice's fix is
expected to land in `pr-refresh.ts`, not `plot-host.sh`, so it should cost
nothing against that gate — but if the investigation finds the shell needs a
touch too, growth there must be paid for in the same change: remove shell
elsewhere, or move the rule into the domain and ask it through a bundle.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Push the first real commit as soon as it exists. When the PR is created,
append `→ #<number>` to this branch's line in the plan's `## Slices` section
(`bug/pr-refresh-rotation-keeps-green` under `### Rotation`).

### Scope guard

**This branch owns:** `packages/fleet/src/shared/pr-refresh.ts` (`storeRow`
and its immediate callers), and — only if the investigation shows the shell
itself must change — the two jq arms at `skills/plot/scripts/plot-host.sh:4591`
and `:4771`. Prefer the TypeScript fix per the decision above.

**Siblings in flight, verified at dispatch:**

- `feature/one-pr-reader-per-machine-and` exists on origin (remote-tracked,
  `f0b1a2fa7`) — a different plan, touching the reader-scope/budget question
  slice 5 of THIS plan (`docs/one-pr-reader-plan-figures`) is meant to
  reconcile. Do not edit that plan's text from this branch.
- `bug/bitbucket-bind-coverage-and-docs` (next slice, not yet created) will
  add the test coverage for `--bound-shas` wiring, the multi-state bind, the
  `$wasNamed`/broken-ask arm, and the `merge-tree` call count — including
  whatever this slice's fix needs proving. Leave tests for the carry-forward
  behaviour to that slice unless a minimal one is needed to pin this change
  down; say in the PR body which you chose.
- `docs/one-pr-reader-plan-figures` (sibling slice of this same plan, not yet
  created) edits the OTHER plan's text only — no file overlap with this
  branch.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.

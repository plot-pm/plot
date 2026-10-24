## Implementation brief — bitbucket-pr-rows-run-per-row (wave: Checks lookups)

- **Plan (canonical):** [docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md](../../docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Branch:** `bug/bitbucket-checks-lookups-bounded` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR, per the plan's `Review: pr`

This branch waits on `bug/bitbucket-mergeable-fold-open-rows`, which merged as PR #2546 on 2026-10-24. Two branches wait on this one in turn: `bug/pr-refresh-rotation-keeps-green` (Rotation) and, through it, `bug/bitbucket-bind-coverage-and-docs` (Tests and wording). Nothing else is in flight on these files right now — this is the only started branch from this plan still open.

### What to build

`pr-state` cannot currently serve a caller that wants only state. `bb_state_row` (`skills/plot/scripts/plot-host.sh:2073`) calls `jenkins_build_map` unconditionally whenever `ci_scheme` is `jenkins`, and every Bitbucket `pr-state` code path — the numeric-ref arm (`:3945`) and the branch-ref arm (`:4009`) — calls `bb_state_row` unconditionally. The merge path's head re-read (`:4249`) goes through the same function, so merging a PR costs a Jenkins lookup it never reads.

Separately, the Bitbucket Jenkins bind has no shared budget. `_bb_jen_bind` (`:4729`) is invoked fresh inside the per-state loop in `pr_list_states` (`:1431`, loop at `:1434`, bind call at `:1483`). Each iteration calls `jenkins_bind_rows` with no running counter carried over, so `--state all` (three states: open, merged, declined) gets three separate 5-row caps — 15 lookups total, not 5. `_bb_jen_bind` also maps every row of whatever state it's handed straight into the bind with no `select` — a MERGED or DECLINED row is bound exactly like an OPEN one, spending cap slots on rows nobody will act on.

Build, in order:

1. Give `pr-state` a way to say "state only" — a caller-declared flag or verb variant, not an inferred one (see Open Questions below; this is the first thing to settle, not assume).
2. Make `bb_state_row` skip the `jenkins_build_map` call (and therefore `jenkins_bind_rows`) when that flag says checks aren't wanted.
3. Route the merge re-read at `:4249` through the state-only path — it reads only `.headSha` (confirmed: no `.checks` reference anywhere in that line or the surrounding arm, `:4246`–`:4253`).
4. Give the `--state all` bind one budget shared across states instead of one per state — thread a counter through the `pr_list_states` loop (`:1434`) into `_bb_jen_bind`/`jenkins_bind_rows`, rather than letting each iteration start a fresh `SHA_LOOKUPS_PER_PASS` (declared `packages/domain/src/rules/jenkins-pr-checks.ts:38`).
5. In `_bb_jen_bind`, filter to non-MERGED, non-DECLINED rows before binding — mirrors the mergeable-fold fix wave 1 already made for `bb_fold_mergeable`.
6. A named row (one the cap did bind) whose Jenkins ask failed must read `unknown`, with `checksLookup` set — not silently keep a stale colour and not read `skipped` (that word is reserved for a row the cap never reached). Check `jenkins-pr-checks.mjs`'s `state` verb and `rowsToBind`/`jenkins_bind_rows` for how `$wasNamed` is currently threaded, per the plan's own citation of `plot-host.sh:4607`'s jq chain.

### Decisions already settled — do not re-derive them

**No existing caller reads `.checks` from `pr-state`, which is why "state only" is safe to add rather than a breaking change.** Surveyed every `pr-state` call site under `skills/plot/scripts/`: `plot-agent-monitor.sh:264`, `plot-impl-status.sh:320/322/334`, `plot-pr-state.sh:33`, and the self re-entry at `plot-host.sh:3912` (the GraphQL-refusal REST retry, same op). None extracts `.checks` from the JSON `pr-state` returns — all read `state`, `url`, `headSha`, or `mergeCommit`. That means today's behaviour (always fetching checks) is pure waste for every caller that exists right now; it also means there is no regression risk in making checks opt-in rather than default, because nothing currently depends on checks being present by default.

**The TypeScript side has no "state-only" concept to plumb through either, so this isn't a port-signature change.** `packages/fleet/src/shared/pr-refresh.ts` does not shell out to `plot-host.sh pr-state` directly — it goes through the `Host` port's `.prState(branch)` method, called from `registryd-main.ts:853,1596,2469`, `worker-loop.ts:933`, `release-claim-reader.ts:72`, `auto-design.ts:407,586`. None of those call sites passes a checks-needed flag today. Adding the flag is therefore a shell-side verb change first; whether it's worth threading up through `Host.prState` to those five callers is itself one of the Open Questions below, not a given — check whether any of the five actually need the savings before plumbing it that far.

**`SHA_LOOKUPS_PER_PASS` is a fixed cap, re-read fresh on every call — not a counter that persists.** Declared `packages/domain/src/rules/jenkins-pr-checks.ts:38`, consumed by `rowsToBind` in the same file (~line 72). It has no cross-call state; `$_bound_shas` (set at `plot-host.sh:4347`, passed as `--bound-shas`) only reorders which rows rotation picks first, it does not shrink the cap. Sharing one budget across states means threading an actual counter through the loop — there is nothing to repurpose.

**`checksLookup` is typed loosely today, and this slice is in scope to tighten it.** `packages/domain/src/entities/pr-index.ts:88` has `checksLookup: z.string().optional()` — a bare string, not the literal `'skipped'` the docs claim. The plan's LOW-findings list carries this fix into this wave's PR along with the schema docs at `packages/board/src/contract/schema.ts:358` (which currently says a broken ask also yields `checksLookup: 'skipped'` — wrong; a named row with a broken lookup keeps its colour and reports none).

**Absent is not false, and this slice must not invert that for Jenkins lookups.** A row the cap never reached is `skipped` (no attempt made, colour unknown-but-unasked). A row that was named and whose ask then failed is `unknown` with `checksLookup` recorded — a different state from `skipped`, and from a prior stable green. Confusing the two is exactly the class of bug issue #2481's nine MEDIUM findings describe; don't collapse them to simplify the jq.

### Done when

The plan's `## Done when` is its Changelog line: *"Bitbucket PR listing and state reads run git and Jenkins lookups only for the rows that need them, and each lookup has a bound."* For this wave specifically:

- A `pr-state` call that doesn't need checks makes zero Jenkins requests — assert this with a call-count test, not just output shape (mirror how wave 1's `bitbucket-mergeable.test.mjs` needed a real `merge-tree` call count, not just a git-status comparison — see the carried-over LOW finding on `test/reconcile/bitbucket-mergeable.test.mjs:340`).
- The merge re-read at `:4249` still reports `head-moved` for a genuine head change, and stops reporting it for what should now read as a parse failure — the plan's Design section calls this out explicitly as the thing a naive "just skip the lookup" fix would break.
- A `--state all` refresh makes at most 5 Jenkins binds total across open+merged+declined, not 5 per state.
- A MERGED or DECLINED row is never bound.
- A named row with a failed Jenkins ask reads `unknown` with `checksLookup` set — test this arm explicitly; it's the one the plan's carried-over LOW finding at `jenkins-pr-checks.test.ts:106` says is currently untestable (`droppedBranches` is defined as the complement of `boundBranches`, so no assertion on it can fail).

Plus: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base — this slice touches `plot-host.sh` directly, so any growth here is paid for in the same change: remove shell elsewhere, or move logic into the domain and reach it through a bundle. There's no stored exemption.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and typecheck for whatever you changed. The full suites named under `CI suites` in `## Plot Config` run in CI on every PR; don't run them locally (`test:e2e` especially — it dispatches real workers and is CI's gate, not a local one, per CLAUDE.md's Testing section).

### Open Questions this slice must answer, not inherit unanswered

The plan itself leaves these open — settle them here, in this PR, not by guessing in each file separately:

- Does `pr-state` learn "caller wants checks" from an explicit flag (`--with-checks` / `--state-only`), or from which verb/alias is called under? Pick one and apply it consistently to both the numeric-ref and branch-ref Bitbucket arms, and to the GitHub arm too if the same waste exists there (the plan's Motivation section only measured the Bitbucket side — check before assuming GitHub already filters this, per `an-a-b-over-code-proves-nothing-when-a-fixture-varies` discipline: don't assume parity you haven't read).
- Is the shared bind budget per-refresh (reset each time `pr-state`/`pr-list --state all` runs) or per-machine-and-account (shared across concurrent refreshes, like the connector rate-limit budget described in CLAUDE.md's Layering Rule)? The sibling plan `one-pr-reader-per-machine-and` is choosing the second scope for a related mechanism — slice 5 of this plan exists specifically to make that plan's figures add up, so this slice's budget scope must not quietly pick a different answer than that plan settles on. If `one-pr-reader-per-machine-and` hasn't landed its scope decision yet, note that in this PR's description rather than silently diverging.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Checks lookups` heading. Push the first real commit as soon as it exists so the branch isn't silently idle.

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-host.sh` — `bb_state_row` (`:2073`), the Bitbucket `pr-state` arms (`:3945`, `:4009`), the merge re-read (`:4249`), `_bb_jen_bind`/`pr_list_states` bind wiring (`:1431`–`:1483`, `:4729`)
- `packages/domain/src/entities/pr-index.ts:88` — `checksLookup` type
- `packages/board/src/contract/schema.ts:358` — doc correction
- Tests covering the above in `test/reconcile/host.test.mjs` and `packages/domain/test/jenkins-pr-checks.test.ts`

Other branches in flight from this plan, verified at dispatch time:
- `bug/pr-refresh-rotation-keeps-green` (not yet started) — owns the rotation fix in `pr-refresh.ts`'s sort order and `checksSha` retention; waits on this branch merging.
- `bug/bitbucket-bind-coverage-and-docs` (not yet started) — owns the remaining LOW-finding doc corrections not already pulled into this wave, plus the `--bound-shas` wiring test from `refreshPrs` through `pr-list`; waits on rotation.
- `docs/one-pr-reader-plan-figures` (not yet started) — edits a different plan file entirely (`one-pr-reader-per-machine-and`), no file overlap with this branch.

`bug/bitbucket-mergeable-fold-open-rows` already merged (#2546) — its changes to `bb_fold_mergeable` and the `pr-state` exit-status handling are already on `main`; this branch builds on top of them, not around them.

If you find something the plan did not anticipate — e.g. the GitHub arm having the same unconditional-checks problem, or the budget-scope question still open on the sibling plan — report it rather than improvising scope.

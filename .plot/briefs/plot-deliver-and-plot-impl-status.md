## Implementation brief — plot-deliver-and-plot-impl-status (wave 2: Resolution)

- **Plan (canonical):** docs/plans/2026-10-24-plot-deliver-and-plot-impl-status.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2489 merged
- **Branch:** `bug/plot-deliver-and-plot-impl-status` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review, `plot-review` app required on `main`)

Wave 1 (`bug/plot-deliver-and-plot-impl-status-repro`, Reproduction) is merged as PR #2552. It added `test/reconcile/cross-host-pr-reference.test.mjs` with two cases marked `todo`, each carrying the message `bug/plot-deliver-and-plot-impl-status (Resolution): resolve a cross-repo reference through the host its repository names, not the checkout's single backend`. This branch's job is to make both pass and remove the `todo` markers — that is the literal "done" signal, not a description to re-derive.

### What to build

A plan repository whose `Git host` is Bitbucket can declare `Impl: other repo` and name a merged GitHub PR on a slice line as `→ owner/repo#N`. Today that reference is unreachable: `plot-impl-status.sh` reports no PRs for it, and `plot-deliver.sh` refuses delivery naming the branch as unmerged.

Two call sites carry the same root cause through different paths — fix both, not just one:

1. **`plot-impl-status.sh:320`** calls `plot-host.sh pr-state "$NUM" --repo "$REPO"` for an annotated line. `--repo` only ever reaches the backend the checkout already committed to (`-R <repo>` on the `gh` arm, the repo argument on the `bb` arm) — it pins the repository, not the host. A GitHub reference on a Bitbucket checkout still asks `bb`.
2. **`plot-deliver.sh` → `packages/board/src/server/controllers/deliverability.ts:165`** falls through to `ports.host.prMerged(branch)` for any branch with no PR-index row — no repo parameter at all. Under `Impl: other repo` the branch never lived in this checkout, so the fixed backend reports it unmerged regardless of where it actually merged.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **Per-reference backend selection belongs inside `plot-host.sh` and the domain's `host` port — never in each caller.** `scripts/check-host-cli-callers.sh` already gates `plot-host.sh` as the one place that may call `gh`/`bb`; a caller that grows its own backend-switch logic duplicates that gate's reason for existing.
- **The port already has room for this.** `packages/domain/src/ports/host.ts:15` declares `export type HostBackend = string` — it is an open type, not a closed union, specifically so a per-call backend can be threaded through without a domain-side enum change. The closed list that still matters lives one layer down, in `plot-host.sh`'s `HOST_DRIVES`/`host_drivable` and the TypeScript adapter's own backend table. Confirm both before assuming either is the single source of truth.
- **Choose the Open Question answer in review, then build one consistently** — do not implement a config key AND a prefix as parallel paths. The plan names the trade-off: a `## Plot Config` key (e.g. `Impl hosts: owner/repo = github`) keeps slice-line grammar unchanged but needs a new lookup; a `host:` prefix on the reference (`→ github:owner/repo#N`) is local and visible but changes the grammar every reader of `owner/repo#N` parses — `plot-impl-status.sh`, `plot-deliver.sh`, the reconcile scan (`plot-reconcile-scan.sh:528` builds `--repo $slug` the same way), and the board's reference parser. If you add the prefix form, grep for every place that splits `${REF%#*}` / `${REF##*#}` before assuming you found them all; the plan's own Open Questions list the four known readers as unverified.
- **A reference with no mapping/prefix keeps today's behaviour** — the plan repository's declared host. This fix widens what can be *expressed*, it does not change the default.
- **An unreachable host (missing/unauthenticated CLI) reports `unknown`, never `not merged`.** Same rule as *An unasked host is not an absent PR* elsewhere in this codebase — silence is not evidence of absence. The repro test does not cover this path; this slice does, or reports why it can't.
- **The deliverability controller's `prMerged` path has no repo parameter today** (`host.ts:228`, `prMerged(branch: string)`). Decide whether it grows one, or whether cross-repo branches route through a different port method entirely (e.g. the same `pr-state`-shaped lookup `plot-impl-status.sh` uses, keyed by the annotation) — the plan's Open Question "does the fleet's PR index key its rows by repository and backend?" is unanswered and bears directly on this.
- **Stub the host CLIs in tests, never `plot-host.sh` itself** — stubbing it hides the backend-selection defect under test, same reasoning as the repro slice's fixture.
- **Mutation fixtures must make the arms disagree.** If you add or extend a fixture, the `bb` stub and `gh` stub must answer differently for the same reference; a fixture where both agree passes with the bug still present (memory: *Mutation fixtures must make the arms disagree*).
- **Absent is not false.** Read exit codes, not the emptiness of output — this governs both the `NONE` vs `unknown` distinction above and any new lookup you add.

### Done when

The plan's `## Done when` is not itself written out as a separate section (this plan has none beyond its Slices), so the test file is the specification: both `test/reconcile/cross-host-pr-reference.test.mjs` cases must pass with their `todo` markers removed, and:

- `plot-impl-status.sh lists a GitHub PR a cross-repo reference names, on a Bitbucket checkout` — passes, meaning `plot-impl-status.sh` on that fixture returns the GitHub PR (number 4711, state `MERGED`) rather than `{"prs": []}`.
- `plot-deliver.sh accepts a slice whose cross-repo reference names a merged GitHub PR, on a Bitbucket checkout` — passes, meaning `plot-deliver.sh` does not refuse the branch as unmerged.
- Both tests still stub `gh` and `bb` with disagreeing answers (per "Settled decisions" above) — if your fix happens to make the test pass by some other route, verify it still catches the regression by confirming it fails when either stub is reverted to its own-backend answer alone.
- An unreachable-host path (CLI missing or unauthenticated) reads `unknown` in whichever caller you touch — add or point at a test proving it, since the repro slice didn't cover it.
- Every known caller that reads `owner/repo#N` is checked, not assumed: `plot-impl-status.sh`, `plot-deliver.sh` (via the deliverability controller), the reconcile scan, and the board's slice-line parser if the chosen design changes reference grammar.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction, so don't skip it locally expecting CI to catch it for you. Run the whole `test/reconcile/*gate*.test.mjs` set, not only the file you touched.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice very likely grows `plot-host.sh` (and possibly `plot-reconcile-scan.sh`) — pay for that growth in the same change: remove shell elsewhere, or push logic into the domain and reach it through a bundle, per the repo's shell-and-domain contract (`docs/shell-and-domain.md`).

If the chosen design touches `packages/domain/src/ports/host.ts` or its adapters, run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and the domain's vitest suite for the changed paths — see the `Local checks` config key for the exact commands, resolved automatically by `plot-local-checks.mjs`.

A changeset is likely needed (`plot`: patch or minor, depending on whether `## Plot Config` gains a new key) — see `CLAUDE.md`'s Versioning section for the exact block shape and ordering rule (description first, `bumps:` last).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). Never `gh pr create` — it takes the title from the last commit subject rather than the plan's wave heading. Append `→ #<number>` to this branch's line under `### Resolution` in the plan's `## Slices` section as soon as the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh`, `skills/plot/scripts/plot-impl-status.sh`, `skills/plot/scripts/plot-deliver.sh`, `skills/plot/scripts/plot-reconcile-scan.sh`, and — if the Open Questions resolve into a port change — `packages/domain/src/ports/host.ts` and its adapters under `packages/domain/src/adapters/host/`. It also owns `test/reconcile/cross-host-pr-reference.test.mjs` (removing the `todo` markers) and any `## Plot Config` documentation this repo's own `CLAUDE.md` needs if a new config key is added.

Wave 1 (`bug/plot-deliver-and-plot-impl-status-repro`) is merged — nothing is still in flight on it. No other branch of this plan remains. If a `## Plot Config` key is added, remember this repo dog-foods its own config (`CLAUDE.md`'s "Plot Config" section) — a new key here is both the feature and its own first real-world test.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, if the four "known callers" list in the plan's Open Questions turns out incomplete, that is itself worth reporting back into the plan before closing it out.

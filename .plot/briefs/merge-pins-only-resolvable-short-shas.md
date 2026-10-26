## Implementation brief — release-deliver-and-merge-controllers-close (wave: Merge path)

- **Plan (canonical):** docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2505 merged
- **Branch:** `bug/merge-pins-only-resolvable-short-shas` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Review: pr` — plan-PR convention, reviewed as a normal PR

This slice is independent of the plan's other four waves (Shared issues, Release chain, Cleanup, One parser) — no ordering dependency either way, but `bug/remove-dead-pin-and-approve-branches` (Cleanup) touches `controller-gate.ts`'s `pinUnavailable`/`UNPINNABLE_NOTE`/`canPinMerge`, which this slice does not touch. If both branches are in flight, a late rebase may see unrelated diffs in that file — not a real conflict.

### What to build

The plan names three findings (#2105, #2118) under "a short sha weakens an irreversible merge." **Re-check each against current `main` before writing any test** — the plan's own Open Question #4 flags that some findings from the `84b1638e4` snapshot may already be fixed, and one of these three is:

1. **`same-commit.ts:2` (`HEX_7_PLUS`, live finding).** `sameCommit` in `packages/domain/src/rules/same-commit.ts` accepts any hex string of 7+ characters as a valid prefix match on either side. A 7-character prefix is cheap to collide across a large repository's history, and `sameCommit` is what `merge.ts`'s `merge()` workflow uses to decide `head-moved` before pinning an **irreversible** merge (`packages/domain/src/workflows/merge.ts:99`). The fix (per Open Question #2) is host-dependent: GitHub resolves a short sha through its commits API (can verify uniqueness), Bitbucket's merge arm re-reads the head immediately before merging and matches by prefix itself (`plot-host.sh:4319`, mirrored by `same-commit.corpus.test.ts`) — so the floor may need to differ per host rather than stay a single constant in the domain rule. Resolve the open question as part of this slice; don't leave it to a future one.

2. **A second, undocumented `sameCommit` exists at `packages/domain/src/rules/verification-record.ts:109`** — a one-line duplicate with **no length floor at all** (`a.startsWith(b) || b.startsWith(a)`), used to compare a plan's named delivery commit against a `Refs.contains` sha (`verification-record.ts:137`). The plan's Design section names only `same-commit.ts:2`; this one is not mentioned. Check whether it is in scope for this finding (it has the identical weakness, just unbounded rather than 7+) or whether it answers a different question that tolerates it — `verification-record.ts` reads a commit **named in the plan**, which a squash-merge cannot rewrite (per *A Decision Reads The Index* › "A commit named by hash"), so the attacker model may genuinely differ from a host's live PR head. Decide and record the reasoning in the PR description; do not silently touch it or silently skip it.

3. **"`approve.ts` posts at the full head sha" — ALREADY FIXED on `main`, do not re-implement.** The plan's Motivation names `approve.ts:1006` from the `84b1638e4` snapshot, but the current domain `packages/domain/src/workflows/approve.ts` is 548 lines with zero sha/pin/status code — that line number no longer resolves to anything in this file. The actual status-posting and pin-matching code lives in `packages/board/src/server/entry/approve.ts`: `writeApprovalStatus` (line ~86-95) already posts `sha: headSha` using the **full** `pr.headSha`, and the merge call (line ~1087) already does `mergeArgs.push('--match-head', pr.headSha)` — also full-length. Confirm this with a quick grep before starting; if it's still true, note in the PR description that this part of the finding was already resolved and cite the lines, rather than silently dropping it with no explanation.

### Decisions already settled — do not re-derive them

- **Why a per-host floor, not a single raised constant.** Raising `HEX_7_PLUS` to require 40 characters everywhere would break Bitbucket, whose `pr view --json` can return a 12-character `headSha` (see the corpus test's `12-character head is a prefix` case) — a legitimate short form the host itself reports, not a weak caller pin. The floor question is about the *caller's* pin, which Open Question #2 does not settle for you: GitHub lets you confirm a short pin resolves to exactly one commit via its API; Bitbucket's merge arm already re-verifies by re-reading the head at merge time regardless of what `sameCommit` said upstream. Read both host code paths before choosing a design — this is a measured constraint, not a style preference.
- **The existing corpus test is a contract, not a reference implementation.** `packages/domain/corpus/same-commit.corpus.test.ts` asserts `sameCommit` agrees with the *shipped* `plot-host.sh:3963` Bitbucket expression, copied verbatim into the test. If you change `sameCommit`'s floor or matching logic, you MUST update the shell expression at `plot-host.sh:3963` in the same PR and keep the copied test fixture in sync — per *A Shell Script Asks The Domain*, a declared duplicate is allowed only while a test proves the two sides agree; a change to one side alone fails CI on this corpus test (not part of the default suite — run it explicitly: `pnpm --filter @plot-pm/domain run test:corpus`).
- **Absent is not false.** `sameCommit('', anything)` must keep returning `false`, not throw — `merge.ts:96-98` already short-circuits an empty `headSha` to a separate `unaskable` refusal before calling `sameCommit`, so `sameCommit` itself only ever sees non-empty strings from that call site in practice, but it is still a shared rule other callers may reach with an empty string. Keep the regex-anchored full-string match (`HEX_7_PLUS.test(a)`), not a truthy check.

### Done when

The plan's `## Done when` is implicit in its Changelog line: "The merge path accepts a short sha only where the host resolves one." Concretely:

- A unit test in `packages/domain/test/same-commit.test.ts` (or a new host-aware variant) proves a prefix shorter than the chosen per-host floor is refused, and the existing 9 cases in that file still pass — do not weaken an existing assertion to make a new one pass.
- `same-commit.corpus.test.ts` still passes, with `plot-host.sh:3963`'s expression updated to match if the floor logic changed.
- If `verification-record.ts:109`'s duplicate is brought into scope, its own tests (check for a `verification-record.test.ts` or similar) still pass, and the reasoning for touching or not touching it is in the PR description.
- No change to `controller-gate.ts`'s `pinUnavailable`/`UNPINNABLE_NOTE`/`canPinMerge` — that is the Cleanup slice's scope (`bug/remove-dead-pin-and-approve-branches`), not this one.

Plus the repo's gates: no bundle diff (`scripts/check-no-bundle-diff.sh` — this touches domain source only, so `pnpm build:board` should not be needed, but verify `git status` is clean of generated paths before pushing), a changeset naming the fix with the plan linked (see CLAUDE.md § Versioning — description first, `bumps:` block last, `plan:` line optional but obeys the same ordering rule). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the domain package's vitest-related and typecheck suites for files you touch. The `CI suites` key's suites run in CI on every PR; do not run the full suite locally. `scripts/check-shell-lines.sh` refuses a growth in shipped shell under `skills/`: if you touch `plot-host.sh:3963`'s expression, keep the line delta at or below zero for that file, or trim elsewhere in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan and opens the PR titled from this slice's wave heading, with the plan and this brief linked in the body. When the PR exists, append `→ #<number>` to this branch's line under `### Merge path` in the plan's `## Slices` section, on `main`.

### Scope guard

This branch owns: `packages/domain/src/rules/same-commit.ts`, `packages/domain/test/same-commit.test.ts`, `packages/domain/corpus/same-commit.corpus.test.ts`, `skills/plot/scripts/plot-host.sh` (only the `pr-merge --match-head` Bitbucket pin-matching expression near line 4319/3963), and — only if you decide it's in scope per the decision above — `packages/domain/src/rules/verification-record.ts`.

Other branches from this plan, in flight or pending, and what they hold (verified against the plan's `## Slices` section at brief-writing time, not guessed):
- `bug/shared-issue-close-reads-every-sibling` — Started 2026-10-24 — `deliver.ts` sibling-read and skip-list logic. No file overlap with this slice.
- `bug/release-chain-reads-every-page-and-hop` — Started 2026-10-25 — `pr-merge-dest`, `release-chain.ts`. No file overlap.
- `bug/remove-dead-pin-and-approve-branches` — not yet started — `approve.ts` dead branch, `controller-gate.ts` pin-availability code (`pinUnavailable`, `UNPINNABLE_NOTE`, `canPinMerge`), the #2407 changeset. Overlaps `controller-gate.ts` only if this slice later needs to touch it (it currently does not) — watch for a rebase conflict there if both land close together.
- `bug/one-remote-url-parser` — not yet started — remote URL parsing, the same-commit corpus test's **relationship to `plot-host.sh`** stays as-is unless this slice changes the expression it mirrors — coordinate if both touch `plot-host.sh:3963` nearby lines.

If you find something the plan did not anticipate — especially if finding #3 above turns out *not* to be already fixed, or if the per-host floor needs a port/adapter change beyond `same-commit.ts` itself — report it rather than improvising outside scope.

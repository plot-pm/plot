## Implementation brief — plot-approve-reports-no-pr-found

- **Plan (canonical):** [docs/plans/2026-10-23-plot-approve-reports-no-pr-found.md](../../docs/plans/2026-10-23-plot-approve-reports-no-pr-found.md) on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2417 merged
- **Branch:** `bug/plot-approve-reports-no-pr-found` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plan declares `Review: pr`

This is the plan's only slice — no wave ordering to track.

### What to build

`packages/board/src/server/entry/approve.ts` is supposed to print "the host could not be asked" (naming the host's refusal) when a PR-listing call fails. In production (ewz-kus-portal, Bitbucket, bb 1.11.2) it instead printed repair advice that implies the PR or plan doesn't exist — "no PR found for branch 'idea/\<slug\>' … or run /plot-idea" from the idea worktree, and "no plan found for '\<slug\>' … or create the plan first: /plot-idea" from the default-branch checkout — while `plot-host.sh pr-list --state open` was refusing with HTTP 429. The plan is canonical; this is orientation.

### A static trace of `main` does not reproduce either symptom — read this before assuming the fix is where the plan's Design section points

The plan's Design section names two suspect call sites. A full line-by-line trace of both (confirmed against the code on `main` today) finds **neither currently swallows a `pr-list` refusal**:

- `choosePlanPr`'s `'open'` ask (`approve.ts:390`, which is `openPrsOf`) is called from inside the `try` at `approve.ts:913-939`. A thrown `Refused` is caught at `:934-938`, which sets `hostRefusal = err` **and** substitutes `pr = { number: 0, state: 'OPEN', draft: false }` — not `'NONE'`. `workflows/approve.ts` reads `state: 'OPEN'` as a normal unmerged PR, not as "no PR" (`pr-absent` only fires on `'NONE'`), so the verdict proceeds past the domain refusal and `hostRefusal` is thrown correctly at `approve.ts:1000`.
- `remotePlanOf`'s `openPrsOf` call (`approve.ts:450`, reached from `perform` at `:878` when `planFile === ''` — the default-branch-checkout scenario) is **not** wrapped in a try/catch inside `perform`, but that is not itself a bug: the thrown `Refused` propagates through `remotePlanOf` → `perform` → to `run`'s own try/catch at `:827-835`, which prints `err.message` (the correct host-refusal text) and returns 1.

**One real, confirmed defect exists, and it is an ordering landmine rather than the two suspects named in the plan:** `approve.ts:990` checks `verdict.outcome === 'refused'` and throws the domain's refusal text — **before** `approve.ts:1000` checks `if (hostRefusal !== undefined) throw hostRefusal`. Any domain refusal reason that fires while a `hostRefusal` sits silently held (today reachable only in combinations the static trace did not find, but not provably unreachable) discards the held host refusal with no trace of it in the output. The fix, once a failing test names the exact reason that fires: move the `hostRefusal` check to before the `verdict.outcome === 'refused'` check, so a held host refusal always wins.

**This means the slice's first step — the plan's own "starts with a failing test" instruction — is not ceremony here, it is the actual investigation.** Write the test described in the plan (a host stub whose `pr-state` finds no PR for `idea/<slug>` and whose `pr-list --state open` refuses, run from both the idea-worktree shape and the default-branch-checkout shape) and run it against unmodified `main` first. Two outcomes are both informative and neither is a dead end:

- **It fails (reproduces the bug):** the failure will name which `verdict.reason` actually fires at `:990` ahead of the `hostRefusal` throw at `:1000` — that is the second open question in the plan's Design section ("which of the two suspect paths fires … or both?") answered by the test itself rather than by further reading. Apply the ordering fix above; the test should then pass.
- **It passes against unmodified `main`:** the two hand-constructed fixtures don't match the exact state production was in. Don't stop — the ordering defect above is real and worth fixing regardless (it closes a hole a future refusal reason would otherwise fall into), but also build a third fixture closer to the production report: a plan **already in the checkout** (`planFile !== ''`) on a non-`same-branch`, non-`in-session` plan, where `pr-list` is refused mid-lookup inside `choosePlanPr` AND some other condition causes `verdict.outcome === 'refused'` with a reason other than `pr-absent`/`plan-not-found` before line 1000 — or, if that still doesn't reproduce, report back precisely what was tried and that the symptom could not be reproduced on current `main`, rather than shipping a fix for a bug that cannot be shown to fire.

### `plot-needs-design` has no analogous gap

`packages/board/src/server/entry/needs-design.ts` shares the lookup shape (`openPrsOf` at `:180`, `planPrOf` at `:224`) but holds **no** `hostRefusal` variable anywhere in the file — every `Refused` it throws propagates straight to `run`'s top-level catch, the same safe pattern `remotePlanOf` uses in `approve.ts`. It does not need the fix this slice makes to `approve.ts`; confirm this with a quick read rather than re-deriving it, and don't spend slice time extending the fix there unless the test work above finds it also exposed.

### Done when

The plan's `## Done when` doesn't exist as a separate section — its `Changelog` entry is the specification: `plot-approve` no longer reports «no PR found» or «no plan found» when the open-PR listing was refused; it reports that the host could not be asked, gives the host's reason, and says to re-run once the host answers. Build the test so it would have caught the production symptom and show it fails against the unfixed code before the fix (mutation-test it by reverting the fix in place and confirming the test fails again).

Plus: a changeset (`plot: patch`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` only gates shell under `skills/` — this slice touches no `.sh` file, so it does not apply.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/approve.ts`, its tests under `packages/board` (or wherever `approve.test.ts` lives today), and one changeset. The plan's second open question ("does `plot-needs-design` or `plot-deliver` share the gap?") is answered above for `needs-design.ts` — leave that file untouched unless the test work proves otherwise. `plot-deliver`'s entry was not traced for this brief; if curiosity leads there, report rather than fix it under this slice's scope.

If you find something the plan did not anticipate — including "the symptom does not reproduce on current `main`" — report it rather than improvising outside scope.

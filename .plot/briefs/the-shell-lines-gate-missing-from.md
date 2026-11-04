## Implementation brief — the-shell-lines-gate-missing-from

- **Plan (canonical):** docs/plans/2026-11-04-the-shell-lines-gate-missing-from.md on `main`
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3130 merged
- **Branch:** `feature/the-shell-lines-gate-missing-from` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (`Review: pr`)

Single slice, no waves — nothing else depends on this branch and it depends on nothing.

### What to build

`CLAUDE.md`'s `Local checks` key lists 15 `scripts/check-*.sh` gates under its `**` entries; `.github/workflows/ci.yml` runs 20. Five run in CI but not locally: `check-no-bundle-diff.sh`, `check-sprint-members.sh`, `check-shell-lines.sh pr`, `check-plan-routes.sh`, `check-helper-table.sh`. The fleet worker loop's `localChecksRunner` (`packages/fleet/src/server/entry/worker-loop.ts:1415`) runs exactly what `plot-local-checks.mjs` prints and stops; `HAND_BACK_PROTOCOL` tells the agent not to run anything else. So today a fleet agent (and an attended one following the Testing section literally) passes its local checks, pushes, and only learns of any of these five refusals one CI round trip later. This plan closes that gap and adds a test that keeps it closed.

### The decisions the plan settles — do not re-derive them

**All five join the `**` entry; order is cheapest-first, `check-shell-lines.sh pr` last.** Append to the existing `&&` chain of the second `**` entry, in this exact order: `./scripts/check-plan-routes.sh && ./scripts/check-helper-table.sh && ./scripts/check-no-bundle-diff.sh && ./scripts/check-sprint-members.sh && ./scripts/check-shell-lines.sh pr`. Measured 2026-11-04 in a worktree at `ad4d08b62`: all five exit 0 on a clean tree; `check-shell-lines.sh pr` took 18.8 s wall (1.2 s user, the seams juror measured 24.0 s under load), `check-sprint-members.sh` took 4 s, the other three ≤1 s. The plan accepts the ~25 s cost added to every `checks` pass — one avoided CI round trip costs more. Do not reorder without reason: the ordering puts a cheap refusal ahead of the 20 s one so the chain fails fast.

**Regenerate `AGENTS.md`, never hand-edit it.** After editing `CLAUDE.md`, run `./scripts/check-agents-md.sh --write` once — it covers both `CLAUDE.md` edits (the `Local checks` line and the Testing sentence, see below) in one regeneration. `scripts/check-agents-md.sh` (no `--write`) is also one of the five gates you're adding to the chain, so verify it now exits 0.

**None of the five needs a CI-only input.** `check-plan-routes.sh` and `check-helper-table.sh` read the working tree only. `check-no-bundle-diff.sh` defaults `BASE_REF` to `git merge-base HEAD origin/main`. `check-sprint-members.sh` runs the committed bundle `skills/plot/scripts/board/plot-sprint-member.mjs` against `git merge-base origin/main HEAD` — no build needed, it's already tracked on `main`. `check-shell-lines.sh pr` counts shell under `skills/` at `HEAD` and at the merge base with `origin/<default>`. All five write nothing and reach no host — so the `CI_ONLY` map in the drift test (next decision) starts empty.

**The drift test is new, in this same slice, and it is a pure file read.** `test/reconcile/local-checks-coverage-gate.test.mjs` parses `.github/workflows/ci.yml` for every `scripts/check-*.sh` basename invoked by a `run:` line (excluding YAML comments), and parses the repo-root `CLAUDE.md`'s `Local checks` value for every `scripts/check-*.sh` basename named in any entry. It fails, naming each gate, when a CI gate is in neither set and no `CI_ONLY` map entry (declared at the top of the test file) names it with a non-empty reason string. It also fails if a `CI_ONLY` entry names a gate CI doesn't run, or one `Local checks` already lists — so the map can't go stale in either direction. Compare by basename only, not arguments: `check-shell-lines.sh` and `check-decision-count.sh` legitimately take `push <sha>` in CI's push-to-main path and `pr` locally — that's not drift. No spawn, no host call, no fleet involvement in this test. It must fail on `origin/main` today (naming the five gates) and pass once step 1 lands.

**The shell-lines refusal gets one new line, because an unattended agent must not delete shell it didn't write.** `check-shell-lines.sh pr` compares `HEAD` against the merge base with `origin/<default>`, read from the *local* ref — which can be stale in a desk worktree (the loop fetches only the branch's own remote head, `worker-loop.ts:1142`, never `origin/<default>`). A stale ref yields an older merge base, so the gate can charge a branch for shell growth that actually landed on `main` via a direct push (or an exact revert) between the stale base and the real fork point — not growth the branch itself introduced. Fix is scoped to the message only: one `echo` in `report()` (`scripts/check-shell-lines.sh`), printed before the two payment options, telling the reader to `git fetch --no-tags origin <default>` and re-run, naming the actual ref and merge-base SHA. This is deliberately the smaller of two options the plan's caller offered — the other being a fetch inside `localChecksRunner`, rejected because it adds a network call and a new failure mode to every `checks` pass of every agent, where this adds neither. Don't go further than the message: no fetch-and-retry logic belongs in this slice.

**Commit before running the checks.** `check-shell-lines.sh pr`, `check-no-bundle-diff.sh` and `check-sprint-members.sh` all measure `HEAD`, not the working tree — uncommitted shell growth passes locally and fails in CI. The fleet path already commits first (`HAND_BACK_PROTOCOL`'s `next: checks` means "you committed work"); this plan adds the same instruction for the attended path: change the Testing paragraph's "Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs`…" to "Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs`…". One wording change, same sentence, same section.

**CI job selection is unaffected — do not touch `ciSelection`.** CI's `select` job (`ci.yml:69-71,166`) calls `ciSelection` (`packages/domain/src/rules/local-checks.ts`); a check with no placeholder is `always`, and `always` checks are dropped from the job map (`ci.yml:190`). The longer `**` entry selects no new CI job and nothing runs twice. If you find yourself editing `local-checks.ts`, you've gone out of scope — this plan touches no domain or board code.

**No changeset.** The change bumps no skill and no package version — don't add one.

### Done when

The plan's `## Done when` is its `Slices` → "Tests that fail before the change and pass after" list:
- `test/reconcile/local-checks-coverage-gate.test.mjs`, `every CI check-*.sh gate is in Local checks or declared CI-only` — fails on current `main` naming the five gates; passes after the `CLAUDE.md` edit.
- `test/reconcile/local-checks-coverage-gate.test.mjs`, `a CI_ONLY entry names a gate CI runs and Local checks omits, with a reason` — passes with the empty map; a mutation check (add a stale `CI_ONLY` entry, confirm it fails, remove it) is the regression guard here, not a third permanent test.
- `test/reconcile/shell-lines.test.mjs`, `pr: a growth refusal tells the reader to fetch the default branch and re-run first` — reuses the fixture of the existing `pr: growth over the merge base fails and states the offset rule` test; assert stderr contains `git fetch --no-tags origin` and `re-run this gate` before `remove at least`. Fails before the `report()` edit, passes after.

Plus the repo's own gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` and everything it prints — and specifically verify its printed second `**` command now ends in `./scripts/check-shell-lines.sh pr` and names all five added gates (this is the self-referential check: the plan's own change must make its own list accurate). Then `node --test test/reconcile/local-checks-coverage-gate.test.mjs test/reconcile/shell-lines.test.mjs` directly, and `./scripts/check-agents-md.sh` (no `--write`) to confirm the mirror is in sync, not just regenerated.

**The shell-lines gate applies to your own diff.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice's only shell edit is one added `echo` line in `scripts/check-shell-lines.sh` itself — but that file lives under `scripts/`, not `skills/`, so it is explicitly not counted by the gate (see the file list below). No payment is owed for this slice's shell edit. If you end up touching anything under `skills/` beyond what's listed, the gate counts it and you pay by removing shell elsewhere or moving the rule into the domain (`docs/shell-and-domain.md`).

### Bookkeeping

Open the PR through the controller once there's a real commit, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Push the first real commit as soon as it exists — don't batch everything into one commit at the end. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-11-04-the-shell-lines-gate-missing-from.md`, under `### Local checks entry`). No project board is configured for this repo's `## Plot Config`, so skip the board-status step.

### Scope guard

This slice owns exactly these files, and no others:
- `CLAUDE.md` — the `Local checks` value (new gates) and the Testing sentence (commit-first wording)
- `AGENTS.md` — regenerated only, via `./scripts/check-agents-md.sh --write`; never hand-edited
- `scripts/check-shell-lines.sh` — one added `echo` line inside `report()`
- `test/reconcile/local-checks-coverage-gate.test.mjs` — new file
- `test/reconcile/shell-lines.test.mjs` — one new test added to the existing file

No other branch is in flight against this plan — it has a single slice and no wave structure. If you find something the plan didn't anticipate (e.g. a sixth undeclared CI gate, or a `CI_ONLY` case genuinely needed), report it rather than improvising — the plan's own `Notes` section already tracks a related follow-up (#3143, a named refusal for `check-sprint-members.sh` with no `origin/main`) as explicitly out of scope.

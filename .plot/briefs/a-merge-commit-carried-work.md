# Implementation brief — a-merge-commit-carried-work

- **Plan (canonical):** `docs/plans/2026-09-14-a-merge-commit-carried-work.md` on `main`
- **Approved:** 2026-09-14, jwloka, in-session (2 rounds of interrogation)
- **Branch:** `bug/a-merge-commit-carried-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer who knows the domain's arrow-function rule

The plan has ONE slice and one branch, so nothing waits on this and it waits on nothing.

## What to build

`git show --name-only` prints **nothing** for a commit with two parents — git suppresses the diff for merges. `carriedWorkOf` ends in `files.value.some(path => !isMarker(path))`, and `.some()` over an empty array is `false`, so every true merge reports *carried no implementation*.

Measured 2026-09-13 over the last 120 commits on `origin/main`: **14 true merges, 14 misread.** Found when delivering `a-claimed-slice-does-not-say-nobody-took-it` — the note fired on PR #907, which carried 410 insertions across 5 files.

The plan is canonical; this is orientation.

## Four files

| file | change |
|---|---|
| `packages/domain/src/adapters/refs/refs-git.ts:189` | add `-m --first-parent` to the `commitFiles` `git show` call |
| same, its comment | state the merge-commit case, not only the squash one |
| `packages/domain/test/ports-real-state.test.ts:192` | add the two-parent row to the existing `it.each` table |
| `.github/workflows/ci.yml` — `validate` job | `fetch-depth: 0` on its `actions/checkout` |
| `CLAUDE.md` | record the two readings (see below) |

## The decisions the plan settles — do not re-derive them

### The two flags are inseparable — never drop `--first-parent`

Measured on `109cce0ac`: `-m` **without** `--first-parent` returns **6** paths instead of 5. It emits one diff per parent, and the sixth is `docs/plans/2026-09-13-a-claimed-slice-does-not-say-nobody-took-it.md` — a file main gained from the OTHER parent, which the slice never touched. On a merge where both parents touched one path, that path would also appear twice.

The exact call:

```
git show --name-only --format= -m --first-parent <sha>
```

### The CI line is load-bearing, not housekeeping

**The test table asserts nothing today.** The domain suite runs at `ci.yml:836` inside the `validate` job, which checks out at the default depth. Measured 2026-09-14 in a `--depth 1` clone of this repo: all three EXISTING fixture shas are absent, `if (!isAnswered(present)) return` takes the early exit, and the file reports **31 passed** — the identical result it reports locally with full history.

So without `fetch-depth: 0` the new row is decoration and CI cannot tell a working reading from a broken one. The `corpus` job already sets it (`ci.yml:61`), so the cost is one this repo already pays per run.

**Do not weaken the skip guard** to "fail when absent" instead. A fork or shallow clone would then fail for the wrong reason — that guard is deliberate and the three rows above follow it.

### The fixture is `900285499`, and it must be discriminating

Expected files, verbatim:

```
.changeset/a-harness-this-machine-cannot-run-refuses.md
skills/plot/scripts/plot-dispatch.sh
test/reconcile/launch-resolution.test.mjs
```

It reads **0** files under the current spelling and **3** under the fixed one, so the row fails before the fix and passes after it. **Verify that both ways** — revert the flag once, watch the row fail, restore it.

`109cce0ac` is deliberately NOT the fixture: it carries `board-server.mjs`, a generated `-merge` artifact that would churn.

### An empty first-parent diff stays `false`, never `unknown`

`851727039` is a two-parent merge whose first-parent diff is genuinely empty — a delivery booking commit. Its merge-base diff reports 2 plan files while first-parent reports 0, because main already held those edits. It must keep reading empty after the fix: it is the one TRUE finding in the window, and the check exists for it.

### Record the two readings in CLAUDE.md — do not add a corpus test

After this fix the estate holds two readings of *what did this merge carry*:

| | reads | answers |
|---|---|---|
| `plot-reconcile-scan.sh` §22 | `merge-base ^1 ^2` | did the BRANCH ship code while open? |
| `refs-git.ts` `commitFiles` | `-m --first-parent` | what did MAIN gain when it landed? |

They agree on **13 of 14** true merges; searched 400 commits and the only divergence is `851727039`. They answer different questions, so **agreement is not the contract** — a corpus test asserting they match would fail on the one commit both sides handle correctly. Add a short note beside the existing *One Answer To "Did This Land"* section in `CLAUDE.md`. Nothing else.

### Scope discipline

`carriedWorkOf` has exactly one caller and nothing refuses on `carriedWork` — it feeds `emptySlices`, which feeds a printed note. No delivery is blocked either way, so **no staged rollout, no feature flag**. The domain rule at `workflows/deliver.ts:113` is correct and is NOT to be touched: this is an adapter defect.

The domain package takes arrow functions (`export const f = (…) => …`). You are editing one existing arrow body plus a test table — do not convert neighbours.

## Repo gates before the PR

```
nvm use                         # Node 24; pnpm crashes on 26
corepack pnpm install
corepack pnpm run typecheck
cd packages/domain && npx vitest run test/ports-real-state.test.ts
corepack pnpm run test:contracts
```

Do NOT run `pnpm run test:e2e` — that is CI's gate, not a local one.

Add a changeset. `@plot-pm/domain` is not a published package here; this is a `plot` patch with no `bumps:` block, description FIRST:

```markdown
---
'plot': patch
---

Delivering a plan whose PR landed as a merge commit no longer reports that the PR carried no implementation.

<!--
plan: docs/plans/2026-09-14-a-merge-commit-carried-work.md
-->
```

## Done when

`commitFiles` reports 5 files for `109cce0ac` and 3 for `900285499`; the three existing fixture rows are unchanged; the new row FAILS against the unfixed adapter and passes against the fixed one, checked by reverting the flag once; the `validate` job checks out with `fetch-depth: 0`; `851727039` still reads empty; `CLAUDE.md` names both readings and the question each answers; typecheck, the domain suite and `test:contracts` pass.

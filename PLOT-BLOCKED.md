PLOT-BLOCKED: Wave 1 never ran — `plot-install-hooks.sh` does not exist, so there is no install to verify. Should this slice wait for wave 1 to be re-dispatched, or is it re-scoped to build the installer too?

## Re-verified 2026-09-10

This question was first recorded 2026-09-09 and is **still unanswered**. Every
fact below was re-measured today against a freshly fetched `origin`:

| reading | 2026-09-09 | 2026-09-10 |
|---|---|---|
| `origin/main` | `43cb0a5d` | `114851ee` |
| wave 1 commits ahead of main | 0 | **0** |
| wave 1 files changed vs main | 0 | **0** |
| wave 1 PR | none | **`{"found": false}`** |
| `plot-install-hooks.sh` on the estate | absent | **absent** |
| wave 1 worktree | none | **none** |
| plan `## Slices` wave order | wave 2 waits on wave 1 | **unchanged** |

`main` advanced by four commits and none of them is wave 1's. The plan was not
resliced. So the blocker is unchanged and the recommendation below stands.

One correction was made to the finding while re-verifying — see
`.plot/findings/an-installed-gate-fires-once.md` §4. The earlier claim that a
scratch repo needs a `## Plot Config` section was **wrong**; measured both ways,
the gate refuses with exit 2 either way, because the plan-directory key carries
a default. It does not change the blocker, and it removes a false requirement
from whoever builds `--verify`.

## The measurement

Branch: `feature/an-installed-gate-fires-once` (wave 2: Proving)
Waits on: `feature/an-adopting-repo-installs-its-gates` (wave 1: Installing)
Plan: `docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md`

Wave 1's branch is a **claim-only ref**. Measured 2026-09-09:

| reading | value |
|---|---|
| `origin/feature/an-adopting-repo-installs-its-gates` | `4501cbf567cfa9e0ee281fb9b9ba7abbe4088361` |
| `origin/main` | `43cb0a5d20750982589afb991c67927111f25433` |
| commits on the branch not in main | **0** |
| files changed vs main | **0** |
| its PR | `{"number":0,"state":"NONE"}` — none was ever opened |
| tip commit subject | `plot: approve a-plan-row-shows-its-phase` (unrelated bookkeeping, already in main) |
| worktree on this machine | none |
| `PLOT-BLOCKED*` on its branch | none |

The tip is an ancestor of `main`, which for a branch with no PR means it never diverged — dispatch pushed the claim and no work followed.

**`plot-install-hooks.sh` exists nowhere on the estate.** Its only occurrences are prose:

- `.plot/briefs/an-adopting-repo-installs-its-gates.md`
- `.plot/briefs/an-installed-gate-fires-once.md`
- `docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md`

`skills/plot/scripts/` holds `plot-install-commit-record.sh` and `plot-install-prompt.sh`, and no hooks installer.

## Why I stopped rather than built it

My brief names the seam as "a `--verify` mode on `skills/plot/scripts/plot-install-hooks.sh`, or whatever seam wave 1 left". Wave 1 left no seam. Building one means building wave 1's whole slice — the script, the `written`/`current`/`present` contract, `--check`, and the `/plot-init` offer — which my scope guard forbids by name:

> **Do not rebuild** the installer, the `written`/`current`/`present` contract, or the `/plot-init` offer — wave 1 shipped those. If wave 1's install path looks wrong, report it rather than fixing it here: a slice that rewrites its predecessor's merged work is a re-litigation, not an implementation.

**There is a second reason, and it is the stronger one.** The plan makes wave 1's first act a measurement that gates the entire plan (`## Design` → *"The route is PROVED before the installer is built"*):

> **`PreToolUse` from a repository's own `.claude/settings.json` is unverified, and this plan will not assume it.** [...] **If the route does not work, the installer has nothing to install** — and building it first would produce a script that writes a file and proves nothing, which is the exact failure the second slice exists to prevent.

Nobody has taken that measurement. Wave 1 was licensed to stop and report if the settings-hook route did not fire, and my own brief says that if it did stop, "that finding is your input and this slice's premise is gone." Wave 1 did not stop — it never started — so the finding does not exist either way. I will not assume the route works and build a proof on top of it.

## What I did instead

Nothing that survives. I took the route measurement as a **finding to hand back** and wrote no product code, no changeset, and no test. It is recorded in `.plot/findings/` on this branch — see the report below. The operator's tree is untouched (`git status --porcelain` clean apart from this marker and that finding).

## The question

One of three, and it is a person's call:

1. **Re-dispatch wave 1** and leave this branch claimed until its PR merges. The plan's dependency order is intact; only the dispatch failed. This is my recommendation — it keeps the route measurement where the plan put it, in front of the installer.
2. **Re-scope this branch** to carry wave 1 *and* wave 2 as one slice, and say so in the plan. Defensible if the two are too small to split, but it discards the plan's deliberate gate: the route is measured before the installer is written, and one slice doing both invites writing the installer first.
3. **Reslice the plan** (`/plot-reslice`) if the wave boundary is now judged wrong.

I have not chosen. Delete this file once answered.

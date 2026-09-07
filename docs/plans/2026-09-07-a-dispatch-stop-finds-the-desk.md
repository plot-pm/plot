# A dispatch stop finds the desk

> `plot-dispatch.sh --stop` rebuilds the worktree path from the branch name. Every agent started by `--start` sits at `free-<hash>`, so the one stop rule refuses the fleet it exists to stop.

## Status

- **State:** Draft
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `--stop` finds an agent's desk by asking git which worktree holds the branch, so it stops a free agent's desk instead of refusing it.

## Motivation

**`plot-dispatch.sh:1171`:**

```sh
wt="$wt_root_early/$wt_prefix_early$(printf '%s' "$stop_branch" | tr '/' '-')"
[ -d "$wt" ] || { echo "plot-dispatch: no worktree for '$stop_branch' at $wt" >&2; exit 1; }
```

**The path is derived, and the derivation is wrong for every agent `--start` creates.** A free agent's desk is `free-<hash>` — cut detached, named before it holds a branch — so the name encodes nothing about what it later takes.

**Measured 2026-09-07**, stopping the fleet to re-fill the unit: `/plot-fleet --stop` reported two agents *"refused by plot-dispatch --stop"*, and running the named command by hand answered *"no worktree for 'feature/the-ref-deleter-asks-the-rule'"*. Both desks existed. Both were stopped by pid instead — **which is the guess the one stop rule exists to prevent.**

**AND `--restart` IN THE SAME SCRIPT ALREADY DOES IT RIGHT.** `plot-dispatch.sh:1221`:

```sh
restart_wt=$(git worktree list --porcelain … | awk -v want="refs/heads/$restart_branch" …
```

**Two verbs, one script, one question, two answers.** `--restart` asks git which worktree holds the branch; `--stop` fifty lines earlier builds a path from the name. The correct implementation is not merely available — it is in the same file, and this slice can copy it rather than write it.

**THE DISPATCH SIDE ALREADY KNOWS.** `plot-dispatch.sh`'s own header states the rule for the shared-file check: the worktree is *"found by asking git which one holds the branch, never by rebuilding the path from the branch name: hand-made worktrees are the population with no claim ref, and they rarely follow dispatch's naming."* **The stop path does the thing the same script forbids twenty lines of prose earlier.**

**IT DEGRADES THE FLEET STOP INTO A PID HUNT.** `/plot-fleet --stop` is an orchestration over this rule precisely so there is *one* rule for ending an agent. When it refuses, the operator falls back to `kill` — no `PLOT-BLOCKED` check, no uncommitted-work check, none of the refusals `--stop` carries.

## What this is not

**Not a second stop rule.** There is one and it stays one; this fixes how it finds its subject.

**Not a rename of the free desks.** `free-<hash>` is correct — a desk cut before its branch is known cannot be named for it. The lookup is what must not assume.

## Slices

### The stop asks git, not the path (Branch: bug/a-dispatch-stop-finds-the-desk)

`--stop` resolves the desk with `git worktree list --porcelain`, matching `branch refs/heads/<branch>`.

**THE DERIVED PATH STAYS AS A FALLBACK, AND ONLY THAT.** A desk whose branch is not checked out — the `reset_desk` window — has no `branch` line to match, and the legacy `plot-wt-` layout is still supported. Ask git first; fall back to the path; refuse only when both miss.

**THE REFUSAL MUST NAME WHAT IT LOOKED FOR.** Today it prints one path and implies that is the only place a desk could be. It should say it asked git and name what it found instead.

**A TEST WITH A DESK THAT DOES NOT MATCH ITS BRANCH NAME.** That is the whole defect, and no test in `test/reconcile/dispatch.test.mjs` creates one — every fixture uses the derived name, so the suite cannot see this.

**Done when** `--stop` stops an agent whose desk is `free-<hash>`, the derived path still works for a legacy desk, a refusal names both lookups, and a test creates a desk whose path does not match its branch.

## Notes

### Why this was invisible — 2026-09-07

Every dispatch test builds a desk at the derived path, so the suite agrees with the bug. `--stop` was exercised for the whole life of `--start [N]` without once being given a free agent's desk — the only kind `--start` makes.

### Round 1 — 2026-09-07

**The round found the fix already written, fifty lines away.** `--restart` resolves its desk with `git worktree list --porcelain` and an awk on `refs/heads/<branch>`; `--stop` derives a path. The slice's work is to make the second verb ask the question the first already asks.

**That makes the defect worse than the plan first put it.** A missing lookup is an omission. A lookup present in one verb and absent in its counterpart is two implementations of one question inside one file — the same shape as `scoreItem` against `item_state`, and this sprint now carries both.

**No slice changed.** The fallback and the refusal wording stand as written; only the evidence is stronger.

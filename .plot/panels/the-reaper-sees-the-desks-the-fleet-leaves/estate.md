Position: reject
Evidence: executed

# The estate lens — the reaper sees the desks the fleet leaves

## The short version

**Slice 1 is already built, shipped, and working. I ran it and watched it report.** Slice 2's premise — "the other `worktree add` paths write no marker" — is false for every path it could mean: the four non-dispatch creators either remove their tree before anything can observe it, or are already recognised by the reaper's second test. And the measurement the whole plan rests on is not merely stale, it is **zero**.

That leaves the plan proposing one deliverable the estate already has, and a second whose target population I could not find a single member of.

## What I ran

### 1. The population is gone

```
$ ./skills/plot/scripts/plot-reap.sh --dry-run 2>&1 | tail -1
summary: reapable=0 removed=0 kept=5 vanished=0 unplaced=0 cleared=0 branches=0
  branches_deleted=0 branches_kept=38 claims=0 claims_deleted=0 claims_kept=5
  dirty_trees=0 dry_run=1
```

`unplaced=0`. Five worktrees under `.worktrees/`, and `find .worktrees -maxdepth 2 -name '.plot-worker.pid'` returns **five paths** — every desk carries its marker:

```
.worktrees/free-0d934050/.plot-worker.pid
.worktrees/free-03e60e45/.plot-worker.pid
.worktrees/free-a8f9a884/.plot-worker.pid
.worktrees/free-6f27c1c7/.plot-worker.pid
.worktrees/free-0f0704ec/.plot-worker.pid
```

The plan's table at line 39-42 says `free-<hash>` desks carry the marker and named desks do not. **There are no named desks.** The `bug-*`, `feature-*`, `infra-*` and slug-named trees the plan counted — all ten of them — are gone. So are `free-0f3f1d2f` and `free-7330dc2a`, the two the plan names by hash at line 46 as proof that the marker is *lost over a desk's life*. That is the plan's one piece of evidence for its Open Question (line 73), and it no longer exists to be examined.

### 2. Slice 1 already exists — I made the defect and watched the scan report it

This is the decisive test. Rather than reason about the code, I created exactly the population slice 1 targets:

```
$ git worktree add --detach .worktrees/probe-unplaced-estate origin/main
$ ls -a .worktrees/probe-unplaced-estate | grep -c 'plot-worker.pid'
0
$ ./skills/plot/scripts/plot-reap.sh --dry-run 2>&1 | tail -1
summary: ... unplaced=1 ...
```

A tree under the configured root, no pid file, no `plot-wt-` in its path — `unplaced=1`, the exact defect. Then I ran the full reconcile scan:

```
$ ./skills/plot/scripts/plot-reconcile-scan.sh   # exit=0

== 21. Desks (a worktree the fleet left behind — a person decides) ==
  /Users/jwloka/Quatico/Agentic-Tools/plot — needs a person: on-default-branch
    (only a person can resolve this one)
  /Users/jwloka/Quatico/Agentic-Tools/plot/.worktrees/probe-unplaced-estate — sits
    under the worktree root and could not be classified — no worker pid file and no
    recognised name
    (only a person can resolve this one)
```

And the machine-countable footer:

```
summary: ... merged_refs=2 desks=2 no_changeset=0 pr_source=gh main=main
```

Now compare against slice 1's own "Done when" (plan line 77) and its slice line (line 86):

| Slice 1 asks for | Estate has it |
|---|---|
| "names every tree under `Worktree root` that no recognition test places" | `reconcile.ts:436` `unclassifiedFindings`, gated on `evidence.unclassified !== true` |
| "with its branch and commit count" | the branch is carried (`dshort`, `plot-reconcile-scan.sh`); commit count is **not** rendered — the one genuinely missing detail |
| "offers no removal command" | `repair: ''`, and the renderer prints `(only a person can resolve this one)` |
| "a machine-countable footer key beside the existing ones" | `desks=2` in the footer, counting `kind == "worktree" or "unclassified-tree"` |

I then removed the probe and confirmed the estate returned to `unplaced=0` with no tracked changes.

**The plan itself half-knows this.** Line 58 says *"`plot-reconcile-scan.sh` §21 already reports desks this way and explicitly carries no `git worktree remove` for the same reason"* — it cites §21 as the **precedent** for slice 1 without checking whether §21 already covers slice 1's own population. It does. The shell takes a third reading the plan never looked for:

```sh
# plot-reconcile-scan.sh, section 21
d_unclassified=false
if [ "$d_dispatch" = false ] && [ -n "$desk_root" ]; then
  case "$dwt" in "$desk_root"/*) d_unclassified=true ;; esac
fi
# Neither: a hand-made checkout, outside the population and silent.
if [ "$d_dispatch" = false ] && [ "$d_unclassified" = false ]; then continue; fi
```

That is three populations — dispatch desk, unclassified-under-root, silent-elsewhere — which is precisely the split `CLAUDE.md`'s own section-21 paragraph describes: *"Three populations, not two: a desk `reap()` judges, a tree under the configured `Worktree root` that it cannot place, and a hand-made checkout elsewhere, which stays silent."* The plan's Motivation (line 22) quotes `plot-reap.sh:415` and stops there. This is the drafting fault `CLAUDE.md` records verbatim — reading the code the issue points at and stopping — and the file it needed to read is one it cites in its own Design section.

The domain rule is equally explicit at `packages/domain/src/workflows/reconcile.ts:429-434`:

> NEVER PROMOTED TO REAPABLE, and never handed a `git worktree remove`. The recognition test stays exactly as strict — widening it would trade a safe refusal for a wider blast radius, while reporting the refusal costs nothing. So the repair is empty and a person decides.

That is slice 1's design argument (plan lines 48-58), already written, already shipped, in the same words.

### 3. Slice 2's premise does not survive the call sites

The plan's line 44 claims `grep -l 'worktree add'` and `grep -l 'plot-worker.pid'` find "a different set", and infers a class of desks created without a marker. I enumerated every real `git worktree add` call site (the greps in the plan also match comments, of which this repo has many):

| Site | Destination | Writes pid? | Is it a desk? |
|---|---|---|---|
| `plot-dispatch.sh:2057,2061` | `$wt_root/free-<hash>`, detached | **yes** | yes — the working path |
| `plot-approve.sh:716` | `$wt_root/.plot-approve-$slug.$$` | no | **no** — `git worktree remove --force "$tmpwt"` at `:723` and `:780` |
| `plot-deliver.sh:638` | `$wt_root/.plot-deliver-$slug.$$` | no | **no** — removed at `:705` |
| `plot-dispatch.sh:2925` | `$wt_root/.plot-start-$slug.$$` | no | **no** — booking worktree, same pattern |
| `plot-worker-loop.sh:2264,2278` | `$wt_root/plot-wt-$suffix` | no | **already recognised** — the legacy `plot-wt-` test places it |
| `plot-resolve-artifact.sh:264` | `plot-wt-<branch>` or `$wt_root/<branch>` | no | mixed (below) |

Three of the six are **booking worktrees**: created, committed from, pushed, and torn down inside one script invocation. They are `$$`-suffixed and dot-prefixed precisely because they are disposable. Making them write `.plot-worker.pid` would mean declaring a transient booking checkout to be an agent's desk, which is the opposite of what the marker means — and the reaper would then be invited to judge a tree that no longer exists by the time it runs. That is not slice 2's stated fix ("so the reaper's existing test places them"); it would be a regression in the vocabulary `DESIGN-agent.md` settles.

`plot-worker-loop.sh`'s hop desk is a real desk with no pid file, and it is **already placed** — by the second recognition test, not the first. The plan treats recognition as a single test keyed to one door (line 44: *"keyed to one of the two doors"*), but `plot-reap.sh:467-470` reads two:

```sh
if [ -f "$wt/.plot-worker.pid" ]; then
  is_dispatch_tree=true
else
  case "$wt" in *"/plot-wt-"*) is_dispatch_tree=true ;; esac
fi
```

That leaves exactly one candidate with real substance: `plot-resolve-artifact.sh:264`, which creates a worktree it never removes (`grep -c 'worktree remove'` returns **0**), and whose path is `plot-wt-<branch>` when `Worktree root` is unset — recognised — but `$wt_root/<branch>` when it is set — **not** recognised. On this estate `Worktree root: .worktrees` is set, so an artifact repair here would leave an unplaced tree.

**That is one script, one line, and one narrow condition.** It is a real finding and I would not have found it without going through the call sites. But it is a fraction of what slice 2 describes ("each path that creates a worktree", "a test per creator"), and it produced **zero** members of the current population — no `.worktrees/<branch>`-shaped tree exists.

## Why reject rather than amend

An `amend` would have to delete slice 1 entirely, rewrite slice 2 down to one line in one script, replace the Motivation, replace the measurement table at lines 30-35, and drop the Open Question whose subjects no longer exist. Nothing structural survives except the title. The honest move is to reject and, if the `plot-resolve-artifact.sh` gap is worth fixing, file it as what it is: a one-line path bug in one script, not a plan about the reaper's recognition rule.

I want to be precise about what I am **not** claiming. I am not saying nothing was ever wrong. The plan's author measured ten unplaced desks and that reading was almost certainly correct at the time. What I am saying is:

- **The deliverable it proposes for slice 1 shipped before the plan was written.** That is independent of the measurement — it would be true even if twenty desks were unplaced right now, and it is the finding that matters most.
- **The population is now zero, so slice 2 has no measurable target.** Its "Done when" (line 79) asks the unplaced count to *fall to zero for newly created desks*, and it already is zero for every desk this estate creates.
- **The one real gap I found is not the one the plan describes**, and it was reachable only by reading the call sites the plan inferred a set from rather than enumerated.

If the operator cleanup that cleared these desks was itself the fix, the right record is a note saying so — not a two-slice plan whose first slice re-implements a shipped feature and whose second targets an empty set.

## If some of it must be salvaged

One finding is worth keeping, and it is small:

- **`plot-resolve-artifact.sh:197`** — under a set `Worktree root`, it creates `$wt_root/<branch>` and never removes it, so an artifact repair can leave a tree neither recognition test places. Either name it `plot-wt-<branch>` unconditionally (one line, matches the sibling at `:191`), or remove the worktree when the repair finishes. A test asserting the created path is recognised by `plot-reap.sh`'s test would lock it.

Two details in the existing slice-1 implementation are genuinely absent, and both are smaller than a slice:

- the finding carries the tree's path but **no commit count**, which plan line 77 asks for;
- the finding carries no branch in its rendered text, though the shell reads `dshort` and passes it through.

Neither justifies a plan. Both are an edit to `unclassifiedFindings` at `packages/domain/src/workflows/reconcile.ts:436-453`.

## Files and lines

- `docs/plans/2026-09-25-the-reaper-sees-the-desks-the-fleet-leaves.md` — the subject
- `skills/plot/scripts/plot-reap.sh:467-470` — the two recognition tests; `:495` the `unplaced` increment
- `skills/plot/scripts/plot-reconcile-scan.sh` §21 — `d_dispatch` / `d_unclassified` / silent, the three-population split
- `packages/domain/src/workflows/reconcile.ts:436-453` — `unclassifiedFindings`, slice 1's deliverable
- `packages/domain/src/workflows/reconcile.ts:53` — `'unclassified-tree'` as its own finding kind
- `skills/plot/scripts/plot-resolve-artifact.sh:187-199` — the one real gap
- `skills/plot/scripts/plot-worker-loop.sh:2263,2277` — hop desk, already recognised via `plot-wt-`
- `skills/plot/scripts/plot-approve.sh:716,723,780` / `plot-deliver.sh:638,705` / `plot-dispatch.sh:2925` — booking worktrees, removed in-invocation

## Estate left as found

The probe worktree was created and removed within this investigation. Final state verified: five worktrees, all carrying `.plot-worker.pid`, `unplaced=0`, and `git status --porcelain` shows no tracked modifications.

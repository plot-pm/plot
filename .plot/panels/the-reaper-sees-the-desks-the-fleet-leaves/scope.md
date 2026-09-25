Position: amend
Evidence: executed

# Scope lens — the reaper sees the desks the fleet leaves

The problem is real, but the plan misnames it in three places and one of its two slices is **already built and shipped**. As written it would produce a duplicate finding, a Done-when that is satisfied before work starts, and a slice 2 aimed at creators that no longer create named desks.

## 1. Slice 1's deliverable already exists — this is the refutation

The plan's slice 1 is: *"a reconcile finding naming trees under the configured root that no recognition test places, with branch and commit count, carrying no removal command; a machine-countable footer key beside the existing ones."*

Every clause of that is on main today except the footer key and two fields.

`packages/domain/src/workflows/reconcile.ts:53` declares the finding kind:

```
  | 'unclassified-tree'
```

and `:444` emits it, with a docstring at `:434-441` that is the plan's own argument, written first:

> NEVER PROMOTED TO REAPABLE, and never handed a `git worktree remove`. The recognition test stays exactly as strict — widening it would trade a safe refusal for a wider blast radius, while reporting the refusal costs nothing. So the repair is empty and a person decides.

`packages/domain/src/workflows/reconcile.ts:44-48` even pre-argues why it is a separate kind:

> `unclassified-tree` is its own kind and not a `worktree` with a softer evidence string. `worktree` means *a desk reap judged*, and a tree no recognition test placed is by definition one `reap` never saw.

`plot-reconcile-scan.sh:2578-2584` renders and counts it:

```
      | map(select(.kind == "worktree" or .kind == "unclassified-tree"))
```

And `plot-reap.sh:466-495` already takes the reading, prints it and counts it:

```
  unclassified=false
  if [ "$is_dispatch_tree" = false ] && [ -n "$WT_ROOT" ]; then
    case "$wt" in "$WT_ROOT"/*) unclassified=true ;; esac
  fi
  ...
    printf '%-8s %-52s %s\n' "unknown" "$label" \
      "under $(basename "$WT_ROOT")/, no worker pid and no recognised name — needs a person"
    unplaced=$((unplaced+1)); continue
```

`plot-reap.sh:463` dates the measurement that motivated it — **2026-09-10**, `.worktrees/feature-one-monitor-watches-the-slice`, "5 unpushed commits, a PLOT-BLOCKED marker and no PR, reported by nothing." That is the plan's own §21 citation, and it is the work already done.

**What is genuinely missing from slice 1** is narrow: (a) branch and commit count on the finding — today the evidence string carries neither; (b) a footer key of its own — §21 folds `unclassified-tree` into `desks=` together with judged desks, so a reader cannot tell "N desks drifted" from "N trees nothing could place", which is precisely the `sprint_drift=57` failure `plot-reconcile-scan.sh`'s own header records. That is a worthwhile slice. It is not the slice the plan describes, and a worker handed this brief would build a second finding beside the existing one.

The plan's Design says §21 "already reports desks this way" as a *precedent to copy*. It is not a precedent — it is the implementation.

## 2. The framing does not name the cause of the symptom

The plan opens: *"an operator reads twelve broken agents where there are two healthy ones."* Line 67 then states:

> **It does not change what the board synthesizes.** A worktree with no manifest still produces a row.

Those two sentences are in tension, and the code settles it. The synthesis is unconditional on recognition — `board-server.mjs`, `t0()`: every worktree that is not main and carries a branch and is not already named by a manifest becomes a synthesized row:

```
for(let m of f) m.isMain || m.branch!==""&&(s.has(m.path)||(o.push(mE(m)),l++))
```

`.plot-worker.pid` appears nowhere in that predicate. So **slice 2 would not move the operator's number at all**: writing a pid marker changes what `plot-reap.sh` classifies and changes nothing about what the board renders. The symptom in the opening sentence belongs to `the-registry-knows-which-agents-live`, which the plan itself points at — and which I could not find as a plan file on this estate (`find docs/plans -iname '*registry-knows*'` → no matches; the slug appears only as prose citations inside other plans, including this one).

The honest framing is the one the Motivation already gives: *an unplaced desk is invisible to every decision*. That is a real cost and it stands on its own. The board sentence should come out of the opening, or be marked as a symptom this plan does not address.

## 3. The Done-when is satisfied before any work starts

Measured now, on this estate:

```
$ skills/plot/scripts/plot-reap.sh --dry-run
summary: reapable=0 removed=0 kept=5 vanished=0 unplaced=0 cleared=0 ...
```

`unplaced=0`. `git worktree list` shows five desks under `.worktrees/`, every one `free-*`:

```
.worktrees/free-03e60e45  [bug/the-scan-reports-an-open-issue]
.worktrees/free-0d934050  [bug/fleet-control-resolves-beside-itself]
.worktrees/free-0f0704ec  [bug/the-scan-reads-a-branch-s-own-plans]
.worktrees/free-6f27c1c7  [bug/the-probe-splits-once]
.worktrees/free-a8f9a884  [bug/the-probe-asks-the-host-for-the-default]
```

*"The unplaced count on this estate falls to zero for newly created desks, measured before and after"* is a gate whose after-value is its before-value. It cannot fail. Replace it with a condition about the **rule**, not the population — e.g. *"a desk created by each enumerated creator is classified by `plot-reap.sh`, asserted per creator in a test"*, which is checkable on a machine with no debris at all.

The measurement block at lines 30-37 has the same problem: `16 worktrees / 10 unplaced / 9 unplaced` (the block says 10 in one line and 9 in the next, which is itself unreconciled) describes a population that no longer exists. Date it explicitly as a past reading, not as the estate's state.

## 4. Slice 2 targets creators that no longer create named desks

This is the substantive scope error. The plan's table asserts *"the other `worktree add` paths → `<type>-<slug>` → no pid"*. I enumerated every `worktree add` in `skills/plot/scripts/`:

| site | path it creates | under `.worktrees/`? | already recognised? |
|---|---|---|---|
| dispatch `:2045,2057` | `$wt_root/${wt_prefix}free-<hash>` | yes | yes — writes the pid |
| worker-loop `:2264,2278` | `$wt_root/plot-wt-$suffix` | yes | **yes — the legacy `plot-wt-` name test** |
| approve `:713` | `$wt_root/.plot-approve-$slug.$$` | yes, dotted | no |
| deliver `:635` | `$wt_root/.plot-deliver-$slug.$$` | yes, dotted | no |
| dispatch `:2925` | booking tmpwt, same shape | yes, dotted | no |
| resolve-artifact `:197` | `$wt_root/<branch-with-dashes>` | yes | **no — this is the one** |

Dispatch's per-slice `git worktree add` **was deliberately removed**. `plot-dispatch.sh:3626`:

> `git worktree add` USED TO BE HERE, with a claim push behind it and a worker start behind that. All three are gone... One desk per agent, not one per slice. The agent decides create-or-reset when it takes the brief... Measured 2026-09-02: 2 manifests against 11 worktrees, 5 of them on branches that had already merged.

So the population the plan measured on 2026-09-25 was created by a code path that no longer runs. The agent-side escape hatch that replaced it (`plot-worker-loop.sh:2264`) cuts `plot-wt-$suffix` — which `plot-reap.sh:470` recognises by name:

```
    case "$wt" in *"/plot-wt-"*) is_dispatch_tree=true ;; esac
```

**Exactly one live creator still makes an unrecognisable named desk**: `plot-resolve-artifact.sh:197`, `"${wt_root%/}/$(printf '%s' "$branch" | tr '/' '-')"`. That is the `<type>-<slug>` shape the plan's table describes, and it is one script, not "the other paths".

The three booking worktrees are a *fourth* population the plan does not mention: they land under `.worktrees/` as `.plot-approve-<slug>.<pid>`, so a crashed approve or deliver leaves a dotted tree that the reaper now counts as `unplaced` — and giving it a `.plot-worker.pid` would be wrong, because it is not a desk and must never be judged as one. Slice 2 as written ("every path that creates a worktree under `Worktree root` writes `.plot-worker.pid`") would mark these as reapable desks. That is a widening of the removal population — the exact thing the plan's own line 66 promises not to do.

So (a) the recognition rule is unchanged but the *creators* are not: the defect does **not** recur the moment desks are created again, because the two creators that run per-slice today both produce recognised names. It recurs only via `plot-resolve-artifact.sh`, and via a crashed booking run.

## 5. The Open Question is now unanswerable, and it gates slice 2's shape

The plan states the answer to *"why do two `free-*` desks have no pid file?"* decides whether slice 2 must make the marker **durable** or merely **universal**. Both named subjects are gone — `.git/worktrees/` lists only the five live `free-*` entries plus unrelated scratch checkouts; neither `free-0f3f1d2f` nor `free-7330dc2a` survives.

That does not by itself sink the plan, but it means slice 2's specification is undetermined and cannot be settled by investigation. Approving it asks a worker to pick between two designs on a question the plan says is decisive. Either drop durability from scope explicitly (universal only), or re-scope slice 2 to the one creator that is measurably wrong.

## 6. Sizing and order

Slice 1 as re-scoped (split the footer key, add branch and commit count) is one slice and correctly first.

Slice 2 as written is two slices wearing one name, and the split is along the line the plan's own §4 exclusion draws:

- **a desk creator writes the marker** — `plot-resolve-artifact.sh` only, one call site
- **a non-desk tree is not mistaken for one** — the three booking worktrees, which need *exclusion* from the unplaced population, not a pid file

Those have opposite remedies. Folding them into "every path writes `.plot-worker.pid`" gets the second one backwards.

## What must change

1. **Slice 1**: re-scope to *split `unclassified=` out of the `desks=` footer key, and add branch and commit count to the existing `unclassified-tree` finding*. Cite `reconcile.ts:444` and `plot-reap.sh:466` as the existing implementation, not §21 as a precedent to copy.
2. **Slice 2**: re-scope to `plot-resolve-artifact.sh:197` — the one live creator of an unrecognisable named desk — and add a separate slice, or an explicit non-goal, for the `.plot-approve-*` / `.plot-deliver-*` booking trees, which must be excluded rather than marked.
3. **Motivation**: delete or demote the *"twelve broken agents"* opening. Board synthesis does not read `.plot-worker.pid` (`board-server.mjs`, `t0()`), so neither slice moves that number. Keep *"invisible to every decision"*, which is true and sufficient.
4. **Done when**: replace the *"unplaced count falls to zero"* condition — already true, `unplaced=0` measured above — with a per-creator assertion that does not depend on debris existing.
5. **Measurement block**: date the 16/10/9 reading as 2026-09-25 past state, and reconcile `10` against `9` in adjacent lines.
6. **Open Question**: mark unanswerable (both subjects gone) and settle slice 2's scope by decision rather than leaving it pending.
7. **Design table**: the row *"the other `worktree add` paths → `<type>-<slug>` → no"* is false for `plot-worker-loop.sh:2264`, which writes `plot-wt-` and IS recognised. Correct it, and record that dispatch's per-slice `worktree add` was removed (`plot-dispatch.sh:3626`) — which is why the measured population was historical.

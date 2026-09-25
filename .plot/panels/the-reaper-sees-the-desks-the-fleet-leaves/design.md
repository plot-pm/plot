# Design lens — the reaper sees the desks the fleet leaves

Position: reject
Evidence: executed

## What I ran

- `git worktree list`, and a per-desk walk of `.worktrees/*/` reading `.plot-worker.pid` and `git branch --show-current`
- `bash skills/plot/scripts/plot-reap.sh --dry-run` (full run, 2026-09-25 ~12:31)
- `bash skills/plot/scripts/plot-config.sh get "Worktree root"`
- `git grep` over `.plot-worker.pid` and `worktree add`, narrowed to `skills/plot/scripts/*.sh` and `packages/*/src`
- reads of `plot-reap.sh:405-520`, `plot-dispatch.sh:2030-2094`, `plot-worker-loop.sh:2200-2310`, `reset_desk`, `plot-reconcile-scan.sh:2455-2590`, `packages/domain/src/workflows/reconcile.ts:420-455`

Reject, on three independent grounds. Any one of them alone would be `amend`; together they mean the plan is answering a question the estate has already answered, with a mechanism that cannot work as described.

## 1. Slice 1 is already built, shipped, and running

The plan's slice 1 proposes *"the scan gains a finding naming trees under the configured root that no recognition test places, with their branch and commit count and no removal command"* (`docs/plans/2026-09-25-the-reaper-sees-the-desks-the-fleet-leaves.md:58`). Its own Motivation cites `plot-reconcile-scan.sh` §21 as precedent — and §21 **is the feature**, not a precedent for it.

- `plot-reconcile-scan.sh:2489-2494` takes exactly the recognition readings the plan describes, and `:2494` keeps the unplaced tree instead of `continue`ing on it.
- `packages/domain/src/workflows/reconcile.ts:436-455` — `unclassifiedFindings` — emits `kind: 'unclassified-tree'` with `repair: ''` and `blocking: false`. The TSDoc at `:428-431` states the plan's own design argument verbatim: *"NEVER PROMOTED TO REAPABLE, and never handed a `git worktree remove` … widening it would trade a safe refusal for a wider blast radius, while reporting the refusal costs nothing."*
- `plot-reconcile-scan.sh:2577,2583` count both kinds into `desks=`, emitted in the summary footer at `:2914`.
- It shipped as PR #878 (`CHANGELOG.md:581`), whose text is the plan's own thesis: *"a tree it cannot classify is named instead of skipped … Such a tree now appears in the sweep with no removal command: the recognition test is unchanged, and only the silence goes."*

The plan's `Done when` first bullet is therefore already true on main. The one gap is cosmetic and not what the plan asks for: the footer key is `desks=`, which folds judged desks and unplaced ones into one number — a genuine (small) finding of the `sprint_drift=57` shape the scan's own history records, and a completely different plan from this one.

CLAUDE.md's *"Where a rule exists and nothing calls it, that is a defect to report"* has a converse the panel should apply here: where a feature exists and a plan proposes building it, the plan is the defect.

## 2. The measurement is stale, and the current estate refutes the causal claim

The plan's Design rests on a table (`:39-42`) asserting a clean split: `plot-dispatch.sh --start` writes `.plot-worker.pid` at creation and names desks `free-<hash>`; "the other `worktree add` paths" name desks `<type>-<slug>` and write nothing. Measured today:

```
free-03e60e45   pid=68875   bug/the-scan-reports-an-open-issue
free-0d934050   pid=48917   bug/fleet-control-resolves-beside-itself
free-0f0704ec   pid=24435   bug/the-scan-reads-a-branch-s-own-plans
free-6f27c1c7   pid=31288   bug/the-probe-splits-once
free-a8f9a884   pid=87360   bug/the-probe-asks-the-host-for-the-default
probe-unplaced-estate   no-pid   (detached)
```

Six trees, not sixteen. **Five carry pids and every one of them holds a NAMED branch.** The plan's asserted correlation — `free-*` carries the marker, `<type>-<slug>` does not — does not hold, because `free-*` is a *birth* name and the branch is acquired later by `reset_desk` (`plot-worker-loop.sh:2261`), which changes the checked-out branch and leaves the pid file in place. The desk name and the branch name are independent facts, and the plan reads a correlation between them that was an artifact of one morning's snapshot.

The reaper's own verdict today:

```
summary: reapable=0 removed=0 kept=5 vanished=0 unplaced=1 ...
```

`unplaced=1`, not 10 — and that one is `probe-unplaced-estate`, a scratch checkout **I created during this review**. The estate has zero genuine unplaced desks. The plan's `Done when` third bullet — *"The unplaced count on this estate falls to zero for newly created desks"* — is satisfied before any work is done.

Two readings are possible and the plan considers neither: the population was transient (workers mid-hop between `reset_desk`'s detach at `:2245` and the pid write), or something between 2026-09-25 morning and now already fixed it. Either way, **the plan never established that its population was a defect rather than a phase.** Principle 12 — *"reading code and judging it is not the same as running it"* — cuts against the plan here: it measured once and inferred a mechanism.

## 3. Slice 2 cannot do what it says, and would corrupt the marker if forced

This is the ground on which the plan is irreparable as written, and the panel's framing question is exactly right.

**`.plot-worker.pid` is not written at `worktree add`. It is written by the wrapper subshell after the agent process exists.** `plot-dispatch.sh:1418`:

```
nohup sh -c '... ( '"$cmd"' ) & agent=$!; printf "%s" "$agent" > "$PLOT_PID_FILE"; ...'
```

`PLOT_PID_FILE` is set at `:1416` to `$wt/.plot-worker.pid`. That happens inside `start_worker`, which `--start` calls at `plot-dispatch.sh:2083` — **after** `git worktree add` at `:2057`. There is a deliberate gap, and the code names it three times: `:1213` (*"starts and before it writes `.plot-worker.pid`; a scan landing in it reads an…"*), `:1291` (*"sub-millisecond gap"*), `plot-worker-state.sh:544`, `plot-worker-monitor.sh:144-146` (*"a scan landing in it reads `none` — honest"*).

So the plan's premise — that `--start` writes the marker "at creation" — is false, and the instruction it derives from it ("every `worktree add` path writes `.plot-worker.pid`") has no honest content to write. The panel's question lists the options; all three are bad:

- **a placeholder or empty file** — `plot-reap.sh:506-508` does `p=$(cat ...)`, then `[ -n "$p" ] && ps -p "$p"`, so an empty file reads as "no live worker" and the tree becomes reapable-eligible with no worker ever having run. That is exactly the widening the plan promises it does not do (`:66`, *"It does not remove anything new"*). The claim is false for the empty-file case.
- **a pid that does not exist yet** — a fabricated number. `plot-worker-state.sh:790-791` and `plot-dispatch.sh:1870-1871` both `cat` the file and `ps -p` it; a stale-but-recycled pid reads as a live worker on an empty desk. `plot-reap.sh:467` uses mere *existence* of the file as the recognition test while `:506` uses its *contents* for liveness — two readers with different contracts on one file.
- **the creating shell's own pid** — actively wrong. `plot-dispatch.sh:1178` states the contract in capitals: *"TWO PIDS, TWO NAMES. `.plot-worker.pid` must name the AGENT"* — which is why `.plot-worker.wrapper.pid` exists separately (`plot-worker-state.sh:79`). Writing the creator's pid violates a rule the estate wrote down after getting it wrong once.

**The panel's second question is the right diagnosis and the plan should have asked it.** CLAUDE.md is explicit: *"A 'worker' is not a separate thing an Agent has — it is the Agent, observed through the process table"*, and `Worker` is Machine-side vocabulary for a *process*. A file named for a process is the wrong carrier for *"this tree is a desk"*, which is a fact about **provenance** and true from `worktree add` onward — before any process exists. The two facts have different lifetimes: provenance is permanent, liveness is transient. Overloading one file with both is what produced the plan's own Open Question (`:73`, *"Why do two `free-*` desks have no pid file?"*) — a question that answers itself once you see the marker is a liveness record that the fleet legitimately clears.

The honest design is a separate provenance marker written by every creator at `worktree add` — and the plan does not consider one. That is a design gap, not a detail.

**A better observation still:** the estate already has such a marker on two of the three creation paths. `plot-dispatch.sh:2076` and `plot-worker-loop.sh:2304` both `: > "$hop_wt/.metadata_never_index"` at creation, and `plot-worker-loop.sh:2291-2297` explains why it is in `info/exclude` rather than `.gitignore`. It is not a *dedicated* provenance marker and I am not proposing it as one — but it demonstrates that "every creator writes a file at `worktree add`" is an established, working pattern here, and that the plan chose the one file that cannot carry the meaning.

## The remaining questions, answered

**Is slice 1 independent of slice 2?** Yes in principle — reporting is correct whatever recognition does. Moot in fact: it is built.

**Gates over rules — is "a test per creator" a gate?** No, and the plan fails its own estate's stated test (CLAUDE.md, *"Can you answer 'Did I complete this?' without actually doing the work?"*). A test per creator enumerates the creators known on the day it was written; a seventh `worktree add` added later escapes silently. This estate knows the shape and has the gate pattern for it — `scripts/check-host-cli-callers.sh`, which greps for the *call* and fails on an undeclared one, and `scripts/check-ancestry-decisions.sh`, which requires a declaration within five lines of each call site. A gate here would count `worktree add` sites and refuse a new undeclared one. The plan proposes the rule where the estate has twice chosen the gate. Note also that CLAUDE.md's own §22 gate rule and the `no_changeset=` design both argue a gate must not fire on legitimate cases — and `plot-approve.sh:716`, `plot-deliver.sh:638`, `plot-dispatch.sh:2925` cut *booking* worktrees that are not desks at all, so a naive "every `worktree add` writes the marker" gate would be wrong on three of the six sites. The plan's own `grep -l 'worktree add' finds six scripts` (`:44`) counted those three without noticing they are a different kind.

**Is slice 3's absence restraint?** Restraint, and correct — but it is restraint the estate already exercised in #878, so the plan earns no credit for it.

**Does the layering rule bear?** Yes, mildly, and in the plan's disfavour. §21 routes through `board/plot-reconcile.mjs` → `reconcile()` → `reap()`, with the refusals in `rules/reapable.ts` — CLAUDE.md records that *"a second copy in shell is what this fixed"*. Slice 1 as the plan describes it (a finding added to the scan) risks re-adding a shell-side reading unless it routes the same way; slice 2's per-creator writes sit in shell scripts that are already adapters, so they are fine on layering but land under no rule at all.

## What would have to be true for this to be `amend`

Not a rewrite of the slices — a new plan with a different subject. Specifically: (a) re-measure and establish whether an unplaced population exists at all outside a mid-hop window; (b) if it does, name the fact as **provenance**, distinct from the liveness `.plot-worker.pid` carries, and propose its own marker written at `worktree add` by the three creators that make desks — not the three that make booking trees; (c) make the creator set a gate, following `check-host-cli-callers.sh`; (d) drop slice 1 entirely and, if the `desks=` footer conflation is worth fixing, file that as the one-line finding it is.

As written, the plan builds a shipped feature, rests on a refuted measurement, and proposes writing a process identifier where no process exists.

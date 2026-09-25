# Slice 2 — `bug/a-manifest-with-no-desk-is-swept`

Position: reject
Evidence: executed

## The premise is false. The sweep slice 2 proposes already exists and already works.

`plot-reap.sh:690-718` is a loop over `$MANIFEST_DIR/*.json` that reads each manifest's `worktree` field, tests `[ -d "$mwt" ] && continue`, and `rm -f "$m"` on the rest. Its own comment names the exact population the plan measured:

> `plot-reap.sh:691-695` — *"Every reap before this script learned about the registry left one, and the board renders each as an `unknown` row naming a directory that does not exist. They are the population this plan was written from — seven of them, measured 2026-08-26."*

It landed **2026-08-27** in `923720c79`, *"A reaped worktree takes its manifest, and a gone worktree can be dropped (#474)"* — a month before this plan was written.

### Executed against the measured population

Sandbox repo, two manifests: one orphan shaped exactly like the 17 measured on 2026-09-25 (`"branch":"feature/stopped"`, `"worktree":"/private/var/folders/zz/plot-restart-DELETED/desk"`, dead pid `999999`), one control naming a desk that exists.

```
=== DRY RUN ===
would    desk    orphaned manifest — worktree absent
summary: ... cleared=1 ... dry_run=1
=== --yes ===
cleared  desk    orphaned manifest — worktree absent
after: live.json
```

The orphan was cleared, the live-desk manifest kept, and `cleared=1` is already in the machine-countable footer. `--dry-run` is already the default. **Every line of slice 2's own "Done when" is already true**, including *"reported per entry like the other kinds"* and *"A manifest naming a live desk … is untouched."*

## The plan's reading of `:133-134` is unfair, and the sentence it quotes points at the answer

The plan argues (Design § *The second half*):

> *"Read the condition: that is a manifest orphaned **mid-reap** … The promise holds for its own failure mode and was never about a manifest that arrived without a tree."*

That reading fails on three counts, each checkable:

1. **`:134` says "the sweep BELOW"** — a forward reference to a block that exists at `:690`. The plan treats the promise as unfulfilled without going to look at what it names.
2. **The sweep's predicate is not mid-reap-specific.** `:698-701`: *"The predicate is the same one the loop above satisfies by construction: the recorded worktree is not there. It needs no PR check and no liveness check — nothing runs in a directory that does not exist."* It is an unconditional loop over the whole registry directory, run on every invocation, with no knowledge of whether this run reaped anything.
3. **The reaper's synopsis already counts four kinds** (`:7`) and the orphan sweep is not among them — because it is not a kind, it is part of kind 1's cleanup. Slice 2 would make a *fifth* thing, duplicating the first.

## The gate as written is unsafe, and the existing sweep is safer than it

Even setting the duplication aside, slice 2's gate — *desk path does not exist AND pid is not running* — is **weaker** than what ships.

**It would delete a legitimate `elsewhere` agent's manifest.** `rules/agent-state.ts:133`: `if (!readings.worktreeHere) return 'elsewhere';`, and `:101-102` — *"No worktree here is `elsewhere`, and it outranks everything."* `DESIGN-agent.md:373` — *"no worktree on this machine | not answerable here."* An agent whose worker runs on another machine satisfies slice 2's first measurement by definition. The pid conjunct does not save it: `kill -0` on a pid belonging to another host's process space is meaningless here — the number is either absent locally or coincidentally matched to an unrelated local process. So the gate reads a remote agent as an orphan.

The shipped sweep refuses this case explicitly. `:703-704`: *"A manifest recording NO worktree path is left alone: it names an agent between checkouts, and absence of a path is not absence of an agent"* — enforced at `:710`, `[ -n "$mwt" ] || continue`. That is a narrower, deliberate carve-out the plan's gate does not have. Slice 2 would therefore **replace a correct refusal with an unsafe one**.

Confirming the other two probes, for the record:

- **Recycled pid fails safe** — a live pid KEEPS the manifest. Correct direction, but it is also why the conjunct is the weaker half: liveness can only ever add safety, and here it adds none for the `elsewhere` case.
- **Unmounted volume / wrong-cwd relative path reads as absent.** Real for slice 2's gate. The shipped sweep is exposed to the same hazard on the `[ -d "$mwt" ]` test, but `plot-reap.sh:346-366` already normalises the macOS `/private` prefix and canonicalises paths for `manifest_for`, and manifests record absolute paths written by the dispatcher. This is a pre-existing narrow risk in shipped code, not a reason to add a second copy of it.

## The shape argument checks out but does not rescue the slice

The instruction the plan cites is real and quoted accurately — `plot-reap.sh:84-85`: *"a backstop that guesses is worse than none. Each new kind brings its own gate instead, in `rules/sweepable.ts`."* The three kinds in `rules/sweepable.ts:13` are exactly `'local-branch' | 'claim-ref' | 'dirty-tree'`, and `:185-186` does define `manifest` as an attribute of `DirtyTreeReadings`, used by `dirtyTreeOwner` (`:228-236`) to decide ownership. The plan's reading of that file is correct.

What the plan missed is that the manifest's own sweep never went through `sweepable.ts` because it predates it by a week and belongs to kind 1. The five refusals in `reapable.ts:134-140` (`no-merged-pr`, `on-default-branch`, `live-worker`, `uncommitted-changes`, `blocked-marker`) are also as described and untouched by any of this.

**On the alternative the question raises:** the supervisor is the wrong place. `rules/supervision.ts:120` gives five verdicts over a desk — `leave | reap | correct | needs-a-person | defer` — and every gate reads the desk (`:284`, `:294-296`). An orphan manifest has no desk to read; `agents-fs.ts:258-266` answers `failed` for a desk that is not there and the caller decides. Making the supervisor de-register on that answer would put a deletion behind a reading that also means *this agent is on another machine*. The reaper is the right owner, and it already owns it.

## What would be worth building instead

The measurement on 2026-09-25 found 17 leaked manifests. That is **not** evidence that nothing sweeps them — it is evidence that **nobody ran the sweep**, which is `plot-reap.sh --yes`, `--dry-run` by default and operator-invoked. If the real finding is *orphan manifests accumulate between reaps*, the honest slice is to have something run the existing sweep — e.g. the registryd tick — or to report the count where an operator sees it. That is a different plan with a different premise, and it needs its own measurement of how long an orphan survives, which nothing here has.

## Bearing on slice 1

None. Slice 1's files are disjoint and its premise is independent — the plan itself says so (*"Their files are disjoint and neither waits on the other"*). Rejecting slice 2 does not touch it.

## What must change in the plan

- Drop the `## Slices` entry `bug/a-manifest-with-no-desk-is-swept`.
- Strike the Design section *"The second half: a manifest with no desk is swept"*, and the sentence in *What this does NOT do* claiming *"nothing reaps a manifest whose desk is gone"* — it is false and it is the plan's own note that the sweep is worth building.
- Reopen the answered question *"Should the registry refuse a manifest whose desk does not exist?"*; its recorded answer rests on the refuted premise.
- Remove the two `Done when` bullets about the fourth sweep kind.
- Add a Notes entry: a **fourth** wrong reading of this defect, recorded the way the other three are — *that no sweep clears an orphan manifest; `plot-reap.sh:690-718` has since 2026-08-27 (#474), and it refuses the pathless case the proposed gate would have deleted.*

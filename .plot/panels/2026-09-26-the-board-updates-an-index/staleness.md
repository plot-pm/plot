# Juror: staleness

Position: amend

Lens: an index is a place where a fact outlives the moment it was measured. I read for what invalidates each kind of entry, whether the plan says so, and what happens when the invalidation signal never arrives.

## 1. The premises check out, but the diagnosis does not

Verified by reading, not by trusting the plan's quotations:

- `App.tsx:283` `setFleet(data)` is the only call site. Confirmed — `grep -n setFleet` returns 137 (declaration) and 283 only.
- The failure path never calls `setFleet`. Confirmed, `App.tsx:290-317`: the catch sets `fleetUnreachable`/`fleetFailures` and nothing else. The plan's refutation of its own first reading is correct.
- `complete` reaches the client. Confirmed at `contract/schema.ts:3833`, `complete: z.boolean().default(true)`, on the fleet payload, with a docstring that says exactly what the plan says it says.
- `fleet.ts:2168`'s "A DERIVATION, NEVER A RECORD" is real and says what is quoted.

**But the server already does the accumulation this plan proposes to add on the client**, and the plan never mentions it. `fleet.ts:3242-3256`, `publishPartial`:

```
const spoken = new Set(arrived.map((p) => p.file));
const plans = [...previous.filter((p) => !spoken.has(p.file)), ...arrived];
```

with `const previous = entry.pulse?.plans ?? []` at `:3225` and the comment at `:3228-3234`:

> The composition is the reason a streaming board does not flicker: at line one the tab would otherwise drop 23 of 24 plans and grow them back … Plans this scan has spoken about win; plans it has not reached yet stay as they were.

There is also `mergePlan` (`fleet.ts:1180`), a by-`file` merge, and `pulseShrink`/`readingLoss` (`:1277`), which compares consecutive readings by SET DIFFERENCE specifically to catch "one plan arrives as another leaves, which nets to zero while a row really did vanish".

So a partial payload is *already* composed over the last one, keyed by plan file, on the server. **A plan absent from a partial scan should already be retained.** The plan's mechanism — "a row absent from one arrival is erased" — cannot be produced by the partial-scan path as written, because the partial-scan path never emits a payload missing a previously-known plan.

This is the finding that moves my position. The defect is real (two slices were missing; I take the measurement), but the plan has attributed it to a mechanism the code contradicts, and a fix aimed at that mechanism may address nothing. **Before building, someone must say which path actually dropped those two rows.** Candidates the plan does not eliminate:

- `entry.pulse` was replaced wholesale by a *complete* scan that genuinely did not contain them (a scan defect, not a client one — that is route 2 in the plan's own table, shipped as #999, and it may not be fully closed);
- a client-side FILTER. `App.tsx:925-927` `sanitizeSelection` exists precisely because "an unchecked selection would hide every card". One of the two missing slices was `feature/the-board-filters-to-my-work` — a filter feature in flight during the measurement. A filter hiding two rows while WORKING (which renders `fleet.agents`, a different array) shows both agents is *exactly* the observed signature, and it is not ruled out.

That second candidate deserves testing before a client index is built, because it would produce the identical observation with no index defect at all.

## 2. `branch` is not a unique key — measured

The plan states `branch` is "present on every row, stable across passes, and how the estate identifies a slice everywhere else". The first clause is true; the uniqueness the merge depends on is not.

`rowsFromPulse` emits rows in a triple loop — `for (const plan of pulse.plans)` → `for (const wave of plan.slices)` → `for (const b of wave.branches)` (`fleet.ts:6301,6382,6383`). One branch named by two plans produces two rows with the same `branch`.

Measured on this estate, over 343 plan files, extracting branch names from `## Branches`/`## Slices` sections:

```
3  bug/a-wave-is-one-row
2  feature/the-registry-supervises-its-agents
2  feature/the-machine-keeps-the-daemon-alive
2  feature/a-split-plan-counts-what-is-elsewhere
2  bug/the-default-branch-repairs-itself
2  bug/done-holds-finished-plans-only
2  bug/board-claimed-from-git
```

`bug/a-wave-is-one-row` is named by four plan files (`2026-08-23-a-split-plan-says-it-is-split.md`, `-a-citation-is-not-a-claim.md`, `-done-holds-what-is-still-yours.md`, `-the-wave-is-a-thing-the-board-can-hold.md`). CLAUDE.md documents this population itself: reconcile-scan section 14, `double_claims=`, "a branch listed by MORE THAN ONE plan".

**Staleness consequence, which is the part that matters for my lens:** with a last-write-wins map keyed by `branch`, two rows collapse to one, and *which* one survives depends on payload ordering. A held entry then carries the other plan's `plan`, `planFile`, `wave`, `sprint` and `section`. That is not a stale row — it is a row attributed to the wrong plan, which is worse, because nothing about it looks held. The key must be `(planFile, wave, branch)` or the row's own identity, and the plan must say so.

There are also eight row kinds (`RowKindSchema`, `schema.ts:1404-1406`: ticket, plan, pr, build, agent, branch, release, wave). The plan never says whether non-branch rows enter the index or how they key.

## 3. What the plan's own admissibility argument does not cover

The plan's licence is the `PLOT_TERMINAL_CACHE` analogy, and it states three adopted properties. I checked the cache against them (`plot-fleet-scan.sh:1223-1270`) and the analogy is weaker than claimed in one specific way.

`terminal_cached` is safe because of a conjunction the plan does not reproduce:

- it is keyed by `TERMINAL_PLAN_OID` (the plan's blob hash) **and** `TERMINAL_MAIN_OID` — either moving discards the entry (`:1244-1246`);
- **only `MERGED`/`CLOSED` are storable** (`terminal_learn`, `:1264`), i.e. only facts that are *monotonic* — they cannot become untrue;
- it is reached **only from the no-ref arm** of `branch_state`, and the header states this is structural: "a branch that is live — in flight, claimed, or with work on the floor — never arrives here and therefore cannot be cached however the cache is filled" (`:1283-1287`).

The proposed index has none of those three. It holds whole `AgentRow`s, and an `AgentRow` carries fields that are **neither terminal nor git-revalidatable**:

- `localLocked` (`schema.ts` AgentRow, ~:2663) — the schema itself says: "**It is also the one signal that can go stale before the next poll** … `.git/index.lock` lives from a fraction of a second to a few seconds and `FLEET_POLL_MS` is 4 s, so most locks are born and die BETWEEN two pulses."
- `localDirty`, `localAhead`, `changedAt`/`changedAgo` — worktree observations, explicitly "true only on the machine doing the looking" and, for `changedAgo`, "FOR DISPLAY ONLY: it is recomputed against `now` every scan, so it moves once a second whether or not anything happened".
- `ageMinutes`, `waitingDays` — recomputed against `now`.

**The plan's claim "a cache revalidated against git on every pass is still a derivation" fails for exactly these entries, because git cannot speak to them.** A held row's `localDirty: true` means "a worktree was dirty when last measured"; there is no git question that invalidates it. An agent that finished and cleaned its desk leaves the index asserting activity with no signal that ever arrives to correct it — and the correcting signal *is* the payload that omits the row, which is precisely the signal this plan teaches the board to ignore. The plan's own held-row rule ("it keeps its section") makes this durable.

The plan says an entry "records what the host said, never what a rule concluded from it". An `AgentRow` is overwhelmingly the second thing: `group`, `section`, `note`, `quietKind`, `waitingOn` are all rule outputs. Storing rows and claiming the terminal-cache licence is a category error the plan needs to resolve — either the index stores host answers (and is not the render index), or it stores rows (and needs its own argument, not this one).

## 4. Invalidation the plan does not specify

Per my lens, each entry kind needs a stated invalidator. The plan states one (`complete: true` + absence → remove) and leaves these open:

- **A held row whose signal never arrives.** `complete: true` is the only reaper. If the scan never completes — and the code has a named path for that, `fleet.ts:3302` "A scan that exited 0 without its terminal line … `pulseComplete` stays false" — held rows accumulate with no bound. The plan sets no age cap, no maximum hold, and no rule for a board that has not seen a complete scan in an hour. Under a sustained partial regime the index only grows, and every entry in it is unfalsifiable.
- **The `readRef` boundary.** The payload carries `readRef` and `localHead` (`schema.ts:3800-3810`) precisely because the answer is *about a particular world*. The plan says entries carry "what it was read against" but never says what to do when `readRef` moves. The terminal cache's answer is to discard (`TERMINAL_MAIN_OID`); the plan should adopt that explicitly, and does not.
- **Deletion that is not absence.** A branch deleted after merge, a plan withdrawn, a plan file renamed. Each removes the row from every future payload, and until a `complete: true` lands the index asserts it exists. On an estate where `complete` is false "for most of that window" (`fleet.ts:898`), that is the common case, not the edge.
- **The non-`rows` arrays.** The fleet payload also carries `issues`, `agents`, `slices`, `summary`, `registry`, `supervisor` (`schema.ts:3960-4010`). `summary` is already recounted honestly per partial (`partialSummary`, `fleet.ts:1204`, with the comment that a carried-over summary is "a measurement of one thing presented as a measurement of another"). If rows are held but `summary` is recounted from the partial, the board shows N held rows beside a total that counts fewer. The plan does not say which arrays are indexed, and the mismatch it creates is the exact dishonesty `partialSummary` was written to prevent.

## 5. Slice 2 is where staleness gets written deliberately

"Every tool call updates the index" installs entries whose invalidator is a future scan. The plan's guard — "an action writes what it was told and never what it assumes" — is the right rule, and it is a *rule*, not a gate, across twelve POST sites. CLAUDE.md's own test applies: can you answer "did I write only what I was told?" without doing the work? Yes. It will drift.

More sharply for my lens: an action-written entry is a fact with **no git counterpart at all**. A 202 from dispatch is not re-derivable; if the dispatch then fails, nothing in the index is wrong in a way any revalidation can detect. The plan needs to say how an action-written entry expires — a bounded lifetime, or a requirement that the next complete scan supersedes it — and it says neither.

## 6. What I would require before this is built

1. **Re-diagnose.** Name the path that actually dropped those two rows, given `publishPartial` already composes. Rule out the client filter explicitly — the coincidence with `feature/the-board-filters-to-my-work` is too close to leave untested.
2. **Fix the key.** `(planFile, wave, branch)`, with the double-claim measurement above as the reason. Say what happens to the eight non-branch kinds.
3. **Narrow what is stored.** Do not hold whole `AgentRow`s under the terminal-cache licence. At minimum, name the fields that may be held and exclude the machine-local ones (`localDirty`, `localLocked`, `localAhead`, `changedAt`) — git cannot revalidate them and no signal invalidates them.
4. **State every invalidator**, including the no-complete-scan case, a `readRef` move, and an entry's maximum hold.
5. **Say what happens to `summary`** and the other payload arrays, or the board will hold rows beside totals that contradict them.
6. **Mark held rows in the DOM**, not only visually — the "Done when" asks for a held row to be "distinguishable", which a browser test cannot assert without an attribute.

The rule the plan states is right and the estate needs it. What is drafted would install entries no signal can retire, keyed by something measurably non-unique, on a diagnosis the server code contradicts.


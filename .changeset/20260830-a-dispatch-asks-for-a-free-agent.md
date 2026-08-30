---
'@plot-pm/board': patch
---

Auto-dispatch asks whether an agent is **free**, not only how many slots are taken.

`isFree` existed in `@plot-pm/domain`, carried six assertions, and had **zero
production callers** (measured 2026-08-30). `planAutoDispatch` now reads it
beside `liveAgentCount`, and a refusal names which of the two questions failed.

**The win:** a fleet at its cap whose agents are all between units, or holding
branches that have landed, now dispatches instead of waiting. An agent asking
for its next slice is `running` with no branch and is available *now*; the
fleet used to wait for a slot it already held.

**`isFree` joins the count; it does not replace it.** The two answer different
questions — *does this agent consume a machine?* (`liveAgentCount`, which
protects the cap) and *can this agent take a slice?* (`isFree`). A
landed-branch agent is **occupied and free at once**, so both are true of it.
Collapsing them re-inverts a measured defect: on 2026-08-25 eleven workers
whose branches had merged sat at zero CPU for up to ten hours, none counted
against the cap, and the fleet grew to 13 against a cap of 3. This slice adds a
reader and changes **no arithmetic** — asserted by `liveAgentCount`'s existing
tests passing unedited, and by a regression test that fails if the two counts
are ever merged.

**A free agent is an existing slot, never an extra one**, so a spent budget
*becomes* the free count rather than growing by it. Verified by mutation: the
`budget + free` spelling is caught by the one test that lowers the cap below
the live count, which is the only case where the two spellings differ.

`sliceHasMerged` is sourced from the pulse, which already publishes
`state: 'merged'` per branch — no additional host round trip. A branch the
pulse does not mention is not treated as landed: silence is never permission.

`isFree`'s parameter widens from `Agent` to the two fields it reads. The
board's registry entry carries `state` and `branch` with the same meanings but
its own state vocabulary — it has `unknown`, and lacks `ended`/`none`/
`elsewhere` — so the two enums are **not** the same set and a cast would have
asserted an equality that does not hold. Every existing caller passes a full
`Agent` and is unaffected.

**Half of `isFree` stays unreachable in production, and that is not this
slice's to fix.** Its first condition is `branch === ''`, and no worker in this
repo has ever hopped: the 3600s `Worker bound` kills every agent mid-run, and
`update_manifest_on_hop` sets the next branch rather than clearing it. That
condition is asserted against a fixture and labelled as such;
`a-working-agent-is-not-a-hung-one` is what makes it reachable.

## Implementation brief — a-pulse-writes-its-own-record (slice: The pulse records itself)

- **Plan (canonical):** `docs/plans/2026-09-05-a-pulse-says-what-changed.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/a-pulse-writes-its-own-record` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of three, and it leads: a delta with no history is the `first run` case forever.

## The gap

**The wrong component writes the file.** Verified 2026-09-06:

```
fleet.ts:2804                 writeBridge(…)   ← the ONLY writer
plot-fleet-scan.sh            'last-pulse'     ← 0 references
```

So `/plot-pulse` in a repository with **no board running** has nothing to diff against — and `DESIGN-process.md` §1 requires the fleet to work with no board at all: *"A repository with no board still dispatches, supervises and delivers."*

**The pulse becomes the writer; everyone else reads.** The scan produces the pulse; the file is *the last pulse*; the component that produces one records it.

## The board's write is not lost — it becomes redundant

**The board spawns `plot-fleet-scan.sh`** (`fleet.ts:902`) to produce the pulse it renders. So a scan that writes the bridge writes it on the board's path too, from inside the same run. **What changes is which process does it, not whether it happens.**

## ONE PROPERTY MUST SURVIVE THE MOVE

`fleet.ts:2800` states it:

> *"The one place the bridge is written, and it is INSIDE the success path on purpose. A scan that failed must not overwrite the last good answer — the only thing standing between a `--watch` restart and an empty board."*

**The scan knows when it completed** — its terminal `pulse` line is what says so, and `--stream`'s contract is that the terminal line is what marks a finished scan, because *"a closed pipe does not, since a killed scan closes it too."*

**So the write goes at the terminal line, not at exit.** A scan killed mid-run must leave the previous pulse intact.

## The format is the board's and stays the board's

`pulse-bridge.ts` owns three things the scan must satisfy exactly:

| | |
|---|---|
| `BRIDGE_VERSION` | `:193` returns `null` on a mismatch |
| `BRIDGE_MAX_AGE_MS` | `:70`, 15 minutes — past it, *"the honest answer is no"* |
| the shape | `at`, `pulse`, `ages`, `branchUrlBase`, `approvedAt`, `ideaPlans` — Maps serialised as entry arrays |

**A scan writing a file the board reads back as a version mismatch renders nothing**, silently. That is the failure to test for.

**It is machine-local and gitignored**, and the file says why: *"A checked-in pulse would be one repository telling another what its branches are doing."*

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**Three cases:** a completed scan writes the bridge; a killed scan leaves the previous one intact; the board reads a scan-written pulse without change.

## Done when

- `plot-fleet-scan.sh` writes `last-pulse.json` on success
- a scan that fails or is killed does not overwrite it
- the board reads a scan-written pulse unchanged — same version, same shape
- a repository with no board accumulates history across pulses
- the gates above pass

## Do not

- **Do not write the bridge at exit.** The success path is the property; a killed scan must not clobber the last good answer.
- **Do not invent a format.** `BRIDGE_VERSION` and the field shape are `pulse-bridge.ts`'s; a mismatch renders an empty board with no error.
- **Do not remove the board's write in this slice.** Redundant is safe; racing to remove it is not.
- **Do not commit the file.** It is machine-local and gitignored.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

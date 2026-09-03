# Implementation brief — the-board-says-slice (Naming it)

- **Plan (canonical):** `docs/plans/2026-09-03-the-board-says-slice.md` on main
- **Branch:** `infra/the-board-names-slice-in-code` (base: `main`)
- **Ends as:** one PR to main
- **Runs second.** `infra/the-board-reads-slice-to-people` lands the prose first, so this diff is identifiers only.

### What to build

The **type** and the **192 identifiers**. `WaveSchema` (`contract/schema.ts:1659`) becomes `SliceSchema`; `WaveRow`, `waveGroupsFor`, `waveSummaryFor`, `WaveGroup`, `WaveRowFacts`, `groupByWave`, `waveLabel`, `waveKeyOf` and their kin follow it.

**The type is the point, not a side-effect.** It is what carries the wrong name into every consumer — `AgentList.tsx:7` and `rows.tsx:11` import `type Wave` from the board's own schema, so every reader of a row inherits the wrong word.

### The one thing that can break silently, and its fix

**`WaveSchema` is on the wire.** The server emits it, the client parses it. Rename a field and an old client meets a new server, disagrees at runtime, and says nothing.

**The precedent is seven lines**, `entities/fleet.ts:563`:

```ts
const readEitherSpelling = (value: unknown): unknown => {
  ...
  if ('slices' in object || !('waves' in object)) return value;
  const { waves, ...rest } = object;
  return { ...rest, slices: waves };
};
```

**Emit `slices`, accept `waves`.** The board serves its own client, so the disagreement window is one deploy rather than a release cycle — but the reader is what makes that window survivable rather than lucky.

**Asserted: a payload carrying the OLD spelling still parses.** That single test is the only thing standing between a rename and a silent runtime disagreement, and it is the deliverable this slice is judged on.

### The decisions the plan settles — do not re-derive them

**Every board `Wave` means Slice, measured: 58 on this estate, all holding exactly one branch.** `WaveSchema` is `{ plan, name, branches }` — belongs to one plan, named by a `### ` heading — which is `DESIGN-slice.md`'s Slice.

**The domain's `entities/wave.ts` is the one correct Wave and is NOT touched.** It is the fleet cohort — *"slices drawn from several plans"* — and it *"has no constructor: nothing forms one today."* If a board site genuinely means that, leave it and say so.

**`branches` stays plural.** A Slice holds one branch, but the array is how the board detects an over-full one and produces the *"wave not sliced"* warning. Making it singular would delete the evidence behind slice 1's fix.

**`plot-fleet-scan.sh` is out of scope.** It still emits `"waves"` (`:3856`), the domain's reader already absorbs that, and its 275 uses are a separate blast radius.

### Done when

- `SliceSchema` exists, `WaveSchema` is gone, and the 192 identifiers follow.
- **A payload with `waves` still parses** — the assertion above.
- `pnpm run typecheck` passes across both packages: the type is imported in `AgentList.tsx:7` and `rows.tsx:11`, so tsc walks you through every consumer.

Plus: `pnpm test`, `pnpm run test:board`, `pnpm build:board` with the artifact committed, a changeset. **Do NOT run `pnpm run test:e2e` locally** — CI owns it.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's bullet under `### Naming it` — trailing arrow, not the heading form. Push the first real commit as soon as it exists.

### Scope guard

Identifiers and the schema. **Not** `data-wave-row` and the browser tests that grip it (slice 3) — a selector and its test must move in one commit, and that commit is not this one.

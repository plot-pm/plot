## Implementation brief — the-pulse-is-an-entity (slice: Freeing the word)

- **Plan (canonical):** `docs/plans/2026-08-30-the-pulse-is-an-entity.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/the-scan-reads-a-fleet-reading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of four, and the other three wait on it. `docs/the-pulse-has-a-design` writes
`DESIGN-pulse.md`; a spec drafted while `FleetPulse` still means the scan's output would
document a collision instead of an entity.

### What to build

`FleetPulse` → `FleetReading`, everywhere, **including the stream's `kind` field**, so the word
`Pulse` is free for the clock the rest of this plan builds.

### Why, in one sentence you should not re-derive

`packages/domain/src/rules/pulse.ts` already means *the fleet scan's output document* —
`sliceReadings(pulse: FleetPulse)`, `doubleClaimedBranches`, `pulseLoss` — while the plan needs
`Pulse` to mean *a clock beating on a Machine*. **Two unrelated concepts, one word**, which is
the `Wave`/`Slice` defect CLAUDE.md records as *"a known defect with its own plan… no new code
may add to it."* The scan's document gives up the word because a clock IS a pulse and the
scan's output is a *reading*.

### THIS IS A WIRE CHANGE, NOT A TYPE RENAME

**The single most important fact in this brief.** `plot-fleet-scan.sh:3618` emits

```
{"kind":"pulse","pulse":{…}}
```

and `packages/board/src/contract/schema.ts:1585` parses it:

```ts
z.object({ kind: z.literal('pulse'), pulse: FleetPulseSchema })
```

**Both sides move in the same commit or the board stops reading its own scan.** A half-done
rename fails at runtime with nothing failing locally — the shell has no type checker and the
board's unit tests do not run the shell.

**Consumers of that line, measured 2026-09-01:** `server/topics.ts`, `server/auto-dispatch.ts`,
`contract/schema.ts`. Change all three with the shell.

### The population, measured — put your own count in the PR

| identifier | references |
|---|---:|
| `FleetPulse` | 200 |
| `FleetPulseSchema` | 48 |
| `pulseLoss` / `PulseLoss` | 19 |
| `sliceReadings` (takes a `pulse` parameter) | 15 |

Roughly 207 sites overall: ~20 domain, ~64 board, ~123 tests, 5 shell scripts. **Re-measure
before you start** — the estate moved under this plan twice today.

### The trap: two generated files carry the string

`skills/plot/scripts/board/board-server.mjs` and `board/plot-ask.mjs` contain `kind":"pulse`.
**They are build output.** Editing them by hand produces a change the next `pnpm build:board`
silently reverts, and on a merge conflict the repo's rule is *take either side and rebuild*
(they are `-merge` in `.gitattributes`). Change the source, run `pnpm build:board`, commit the
result.

### Done when

- The 207 references are one name, and **the shell and the board changed in the same commit**.
- **`plot-fleet-scan.sh --stream` feeds a running board, asserted rather than assumed.** This
  is the assertion the slice exists for: nothing else catches a half-renamed wire. `pnpm board`
  in one terminal, the streaming scan in another, and a payload that arrives.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  changeset (`'@plot-pm/board': patch` — package frontmatter, no `bumps:` block, description
  first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Make one mutation before believing the wire test.** Rename the shell's `kind` and not the
board's, confirm the assertion fails, then put it back. A wire test that passes against a
mismatched pair is testing nothing, and three inert mutations were caught in this repo on
2026-09-01 alone.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** the rename, its wire, and the two rebuilt artifacts.

**It does not own** `DESIGN-pulse.md`, the divisors, subscribers, or anything about a clock —
those are the plan's other three slices. **Resist starting the entity**: this slice exists so
that work can use the word, and doing both at once makes the wire change unreviewable.

**In flight, 2026-09-01:** `feature/the-refusals-are-domain-rules` (`plot-dispatch.sh`),
`bug/a-test-teardown-does-not-call-rmsync` (41 test files — **overlaps the ~123 test
references**, so expect a rebase), `docs/a-machine-has-an-identity`, plus the other machine's
browser-test PRs (#594, #595) in `packages/board/test/`.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.

# Implementation brief — the-board-decides-nothing (Verdicts)

- **Plan (canonical):** `docs/plans/2026-08-30-the-board-decides-nothing.md` on main
- **Branch:** `feature/a-verdict-is-a-domain-rule` (base: `main`)
- **Ends as:** one PR to main
- **Runs first of three**, and the other two follow its shape.

### What to build

`startabilityVerdict` and `waveVerdict` become domain rules; the board calls
them.

### Why these two and not the file

`fleet.ts` is **5953 lines with 49 exports**. Moving it at once is the failure
this story is named for — measured 2026-08-30, seven workers hit their bound in
one day on slices a tenth that size.

**The unit is a verdict, not a file.**

### How to tell a verdict from a policy

**A verdict answers a question about a domain entity:** *is this slice
startable? what phase is this plan in? which agent is waiting on whom?*

**A policy answers a question about the machinery:** *may I ask the host again
yet? how long should I back off? what may I drop from an oversized payload?*

The first moves. **The second stays** — `prGateOpen`, `prNextDueAt`,
`rateLimitBackoffMs` are about a service, not about a Slice.

### Done when

- both are in `packages/domain/src/rules/`, unit-tested at the package threshold
- **`fleet.ts` holds no copy** — a re-export is a copy for this purpose
- **the board payload is unchanged byte for byte**

**That last one is what makes the rest safe.** Everything here is a move, so any
difference in what the browser receives is a defect — and the board is a surface
somebody is watching while it lands.

**How to assert it credibly:** capture the payload before and after and diff it.
A test asserting individual fields passes while dropping one nobody listed.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact rebuilt,
changeset.

### Scope guard

Two verdicts. Not `rowPhase` (next slice), not `deriveWaves` (the one after),
not the fetching, not the caching.

**If a verdict turns out to need a reading the board holds**, that is a finding
for the PR — the domain takes readings as values, and the caller supplies them.
Do not give a rule a port.

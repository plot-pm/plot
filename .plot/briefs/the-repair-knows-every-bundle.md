## Implementation brief — the-repair-knows-every-bundle (slice: One definition of the artifact set)

- **Plan (canonical):** `docs/plans/2026-09-05-every-generated-bundle-is-marked.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/the-repair-knows-every-bundle` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 merged as **#724** — `.gitattributes` marks every bundle and `scripts/check-bundle-attributes.sh` gates it.

## What this delivers

`ARTIFACT_PATH` becomes a **set**, in both languages that hold it.

## This defect was hit today, and it cost a repair

**Measured 2026-09-06.** PR #727 conflicted in `skills/plot/scripts/board/plot-registryd.mjs` — a `-merge` bundle, deterministic rebuild, exactly the case the resolver exists for. It refused:

```
step: conflict set is not exactly the artifact — refusing
step: unmerged: skills/plot/scripts/board/plot-registryd.mjs
summary: outcome=refused reason=not-artifact-only
```

**The refusal was correct behaviour against a stale list**, and the repair was done by hand instead. Hours later the same branch conflicted in `board-server.mjs` and the board's own resolver fixed it automatically — same class of conflict, opposite outcome, because of one hardcoded filename.

## Three places declare it and they must move together

Verified 2026-09-06:

| where | today |
|---|---|
| `plot-resolve-artifact.sh:76` | `ARTIFACT_PATH="…/board-server.mjs"` |
| `packages/board/src/contract/schema.ts:1862` | `BOARD_ARTIFACT_PATH = '…/board-server.mjs'` |
| `packages/board/src/server/resolver.ts:86` | `conflicts.length === 1 && conflicts[0] === BOARD_ARTIFACT_PATH` |
| `packages/board/src/server/stuck.ts` | imports the same constant |

The plan records schema.ts at `:1868`; it is at **`:1862`**.

**`plot-resolve-artifact.sh:75` already says the pairing is *"asserted by a test rather than trusted"***, because the two run in different languages and neither can import the other's constant. **That test is what must now assert set equality**, not string equality.

## The guard's discipline must survive the widening

`plot-resolve-artifact.sh:277` warns against asking whether the artifact is *among* the conflicts: an implementation asking that *"passes every artifact-only case and silently repairs merges that need judgement as a whole."*

**The new guard is: every unmerged path is in the bundle set.** Still an exact claim about the whole set — never a membership test on one element. Get this wrong and the resolver will merge branches that need a person.

## The set has a single source

`.gitattributes` lists them and `scripts/check-bundle-attributes.sh` derives the emitted set from `build.mjs`'s `shippedX = path.join(…)` declarations. **Nine bundles today** (the plan says eight; `plot-landed.mjs` joined since). Prefer deriving over a third hand-written list — a fourth place to drift is what this slice is removing.

**`plot-monitor.mjs` IS NOT IN THE SET**, because nothing builds it. Including it would assert a rebuild that does not exist.

## Done when

- the artifact set is one definition, reachable from both the shell and the board
- the resolver repairs a conflict in **any** bundle in the set
- the guard still refuses any conflict set containing a non-bundle path
- the cross-language test asserts set equality, not one string
- a conflict in `plot-registryd.mjs` alone is repaired automatically
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` pass

## Do not

- **Do not ask whether a bundle is among the conflicts.** The plan and the script both warn about this in the same words; it is the one way to get this slice wrong.
- **Do not hand-write a fourth list.** Derive from the same source `check-bundle-attributes.sh` uses.
- **Do not add `plot-monitor.mjs`.**
- **Do not widen what the resolver may do beyond taking a side and rebuilding.** Its licence is three verified properties, and none of them extends to a file with no deterministic rebuild.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc` if you touch it.

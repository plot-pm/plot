## Implementation brief — the-merge-gate-asks-the-adapter (slice: The merge gate asks the adapter)

- **Plan (canonical):** `docs/plans/2026-09-06-the-last-two-callers-ask-the-adapter.md` on `main`
- **Branch:** `infra/the-merge-gate-asks-the-adapter` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two. **Three rounds, and the last one corrected the other two** — read the plan's round-3 note before its earlier prose.

## What is actually left

**The decision has already moved. Only the lookup has not.**

`plot-pr-merged.sh` **is already an adapter** — #706 made it one. Verified 2026-09-06:

```
:69   resolves board/plot-landed.mjs
:78   pipes two readings into it
```

and `rules/landed.ts` holds `landed`, `openPr` and `mayRemove`, with the coupling **asserted over all nine reading combinations**. The file's own header says so: *"That was a comment in this file and could not be checked. It is now `mayRemove` in the rule."*

**So there is no gate to move, and rounds 1 and 2 of this plan argued about one.** What remains is two `gh` calls:

```
:90   gh pr list --head "$br" --state all  --limit 100 --json mergedAt
:99   gh pr list --head "$br" --state open --limit 1   --json number
```

Each turns its lookup into `found`, `none` or `unaskable`. **`plot-host.sh pr-merged` already produces those same three readings** — verified working: `plot-host.sh pr-merged <branch>` answers `not-merged` today.

## The cost argument decides the shape

**`plot-pr-merged.sh` is sourced, not run.** Four scripts define these functions in their own shell and call them **per branch**:

```
plot-reap.sh:170   plot-release-refs.sh:84   plot-dispatch.sh:152   plot-quiet-stretch.sh:149
```

**A version shelling out to `plot-host.sh` adds one process per call** on a path the fleet scan walks across 48 branches — and `DESIGN-machine.md` measures spawn cost as *the* headroom signal, at 3.6 ms clear against 286 ms starved.

**So the lookup routes without gaining a spawn, or it does not route.** If the only way through the adapter is a subprocess per branch, say so in the PR and leave the calls — that is a real finding, not a failure.

## What must not change

**The three readings reaching `rules/landed.ts` are the contract.** `found`, `none`, `unaskable` — and `mayRemove` permits a removal in exactly one of the nine combinations, including refusing a found merge whose veto lookup could not be asked.

**`mergedAt` is read, never `state`.** A merged PR reports `CLOSED`; trusting `state` would refuse every squash-merged branch, which is the whole population these scripts exist for.

**And the question is ANY PR, not the newest.** `--limit 1` reported three branches unlanded whose work was on main, each masked by a duplicate the fleet opened itself.

## The gate is watching

`scripts/check-host-cli-callers.sh` shipped 2026-09-05 and answers `clean` over 27 exempted call sites. **Its exemption for this file is dated on purpose:**

> *"The exemption is dated, unlike the three above it: those describe questions the adapter does not answer, this one describes work not yet done. **Delete this entry when the lookups route.**"*

**Deleting that entry is part of this slice.** If the lookups do not route, the entry stays and the PR says why.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `./scripts/check-host-cli-callers.sh`.

`mayRemove`'s nine assertions must still pass — they are the proof the readings did not change shape.

## Done when

- `plot-pr-merged.sh` names `gh` zero times, **or** the PR states why routing costs a spawn per branch and the exemption stays
- the three readings reaching `rules/landed.ts` are unchanged
- `mayRemove`'s nine assertions pass
- no caller gains a process per branch
- the dated exemption in `check-host-cli-callers.sh` is deleted if the lookups routed
- the gates above pass

## Do not

- **Do not move the decision.** It moved in #706. `rules/landed.ts` decides; this file reads.
- **Do not read `state` or ancestry.** Ten of ten, measured 2026-09-04.
- **Do not narrow to the newest PR.** Three named branches, measured.
- **Do not add a spawn per branch to buy the routing.** Report it instead.
- **Do not touch `plot-update-board.sh`.** That is slice 2 — the Projects API, which the adapter does not answer.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

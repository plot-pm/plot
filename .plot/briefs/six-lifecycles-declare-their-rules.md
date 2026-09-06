## Implementation brief — six-lifecycles-declare-their-rules (slice: The six the ratchet found)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/six-lifecycles-declare-their-rules` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

## What this delivers

A `transitions/*.ts` for each of the six entities that declare a lifecycle and have none.

## The six, re-measured 2026-09-06 by running the gate

```
entities/sprint.ts:9     declares 'sprint',   no transitions/sprint.ts
entities/pr.ts:9         declares 'pr',       no transitions/pr.ts
entities/fleet.ts:54     declares 'branch',   no transitions/branch.ts
entities/fleet.ts:111    declares 'worker',   no transitions/worker.ts
entities/release.ts:13   declares 'release',  no transitions/release.ts
entities/build.ts:14     declares 'build',    no transitions/build.ts
```

**All six still stand.** `worker` is at `fleet.ts:111`, not the `:102` the plan records — the file has moved since. Run `./scripts/check-state-declarations.sh` yourself before starting; it prints exactly this list and then `State declarations: clean.`

**THE GATE READS `clean` OVER ALL SIX BY DESIGN.** It ratchets against the count on the day it shipped — *"its job is to stop 38, not to reach 0"* — so these sit under a green check. This slice converts that debt into work.

## Order by what a wrong answer costs

The six are not equal, and the plan states the ordering as the design:

| entity | read by | a wrong answer |
|---|---|---|
| `branch`, `worker` | the fleet, on every dispatch and reap | strands an agent, or removes a desk |
| `sprint`, `release` | the release gate | ships or blocks wrongly |
| `pr`, `build` | the host owns these readings | matters least |

**Do `branch` and `worker` first.** If the slice has to stop early, it stops having done the two that cost most.

## What a transition file is

Follow `transitions/slice.ts` and `transitions/story.ts`, which are the two worked examples on `main`. Each declares the states, the legal moves between them, and refuses the rest by name.

**`branch` HAS ITS RULES ALREADY WRITTEN, IN SHELL, TWICE.** `plot-reap.sh`'s five refusals and `plot-release-refs.sh`'s five guards are the same question asked about the same thing, and measured 2026-09-06 each is blind to a guard the other applies — `plot-release-refs.sh` never asks about a live pid, `plot-reap.sh` never asks `pr_open`. `packages/domain/src/rules/reapable.ts` already exists (122 lines); read it before writing `transitions/branch.ts` so the two do not become a third copy.

**`worker` HAS EIGHT STATES AND THEY SPLIT ALONG A LINE CLAUDE.md DRAWS.** Four are Worker facts read from the process (`running`, `failed`, `ended`, `none`); two are **Agent** facts read from the desk (`waiting`, `stalled`); `finished` is a Worker fact the desk refines; `elsewhere` is a Machine answer. `plot-worker-state.sh:46` decides the two workflow states from the TREE, never the process. **Do not add a workflow state to the process side.**

## Sizing

**Each is a slice's worth of work and this is one slice.** That is deliberate — *"splitting it six ways before anyone has written the first is the ceremony this repo already refuses."* If two turn out to be a PR's worth, say so in the PR and land what is done; do not silently drop the rest.

## Done when

- each of the six entities has a `transitions/*.ts` declaring its states and legal moves
- `branch` and `worker` are done first and their rules are not a third copy of the shell's
- `./scripts/check-state-declarations.sh` still exits 0
- `pnpm test` and the domain typecheck pass

## Do not

- **Do not lower the ratchet's threshold to make the list shorter.** The gate's number is a floor against regression, not a target.
- **Do not invent states.** Every state must be one something already reads or writes.
- **Do not use `function` declarations** — the domain package requires arrows, and CI greps only `packages/domain/src/`.
- **Do not narrate history in TSDoc.** What it does, what the parameters mean, what it returns. Reasoning goes in the commit message.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` — vitest passes where `tsc` fails.

# Brief: bug/a-smaller-pulse-is-not-silently-better

Implement **wave 1 (Symptom)** of
`docs/plans/2026-08-18-the-board-never-shrinks-on-a-success.md`.

Read that plan first. Its diagnosis was reproduced in a sandbox, not inferred:
**do not re-derive it, do not widen the scope.**

## The bug

Rows vanish from the Agents tab and return seconds later — including WORKING
rows for agents that are demonstrably running. No error, no staleness marker.

`fleet.ts` guards the cache against **failure** and says why:

```
684:  // A failed refresh NEVER overwrites a good result. Replacing real state
      // with emptiness because one scan failed is what makes a monitoring view
      // untrustworthy — the tab keeps the last pulse, its age, and this error.
```

The PR map obeys the same rule, and its comment describes this exact symptom: an
empty map *"would quietly move every row back to its git-only group, which looks
like state changing rather than data missing."*

But the success path has no equivalent guard:

```
640:  entry.pulse = parsed;
```

Unconditional. The invariant is *failure must not overwrite good data*; the
unstated assumption beneath it is *any success is authoritative*. That is false —
a scan can exit 0, emit schema-valid JSON, and describe fewer plans than the one
before it.

## What to build

Compare the incoming pulse against the cached one before accepting it.

**Accept the smaller pulse, and carry a flag saying the previous answer was
larger**, so the UI can mark the view rather than swapping it without comment.
*Degrade, do not hide* — the rule `pulse-bridge.ts` already follows for
staleness.

**Do not reject the smaller pulse.** A plan legitimately delivered would keep a
dead row forever, and a monitoring view that cannot shrink is a different kind
of lie. This is stated in the plan and is not open for re-litigation.

## Scope boundary — important

You are **wave 1 only**: the symptom, in `packages/board/src/server/fleet.ts`.

Wave 2 (`bug/the-scan-enumerates-the-ref`) fixes the *cause* — the scan globbing
the working tree instead of the ref — and is queued behind other work in
`plot-fleet-scan.sh`. **Do not touch that script.** Your fix must be valuable on
its own even if the cause fix never lands, which is why the plan orders them
this way.

## Open question you may hit

The plan's Open Points asks whether `entry.ages`, `entry.approvedAt`, and
`entry.ideaPlans` share the same unconditional-success assumption — they are
assigned in the same block and none is compared against its predecessor. If you
can answer that cheaply while you are in the file, **report the answer**; do not
expand the fix to cover them without saying so.

## Definition of Done

- A test that reproduces the shrink: feed a larger pulse, then a smaller one,
  and assert the result is marked rather than silently swapped
- `pnpm run test:board` passes (this is board source — it is gated in the
  Definition of Done)
- `pnpm run typecheck` passes
- `pnpm test` and `pnpm run test:reconcile` pass
- `pnpm build:board` run **in this worktree**, with the rebuilt artifact
  committed
- A changeset with a `bumps:` block

## Artifact conflicts

If `board-server.mjs` conflicts, **do not read the diff** — it is generated,
marked `-merge` in `.gitattributes`. Take either side, run `pnpm build:board`,
commit the result. Never phrase it as "take ours": *ours* inverts between merge
and rebase. See `docs/definition-of-done.md`.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.

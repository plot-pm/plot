# Brief: feature/fleet-api-names-its-ref

Implement **wave 1 (Honesty)** of
`docs/plans/2026-08-18-the-board-answers-agents.md`.

Read that plan first — but note you are implementing **only its first branch**.
The plan describes three; the other two are later waves and are not yours.

## What to build

`/api/fleet` reports which ref its data came from and how old that read is:

- `readRef` — the commit the scan actually read
- `readRefAge` — how old that read is
- `localHead` — the local checkout, which may differ

## Why this exists

The UI already renders "scanned 10s ago" well. A machine consumer gets no
equivalent, and the gap has a measured cost: during a live two-agent dispatch on
2026-08-18, an operator read current-looking data while their local `origin/main`
ref was behind other agents' pushes. Three wrong diagnoses followed — including
"the fleet endpoint is broken" and "the scan exceeds the board's timeout" —
neither true. The board was right every time.

A response that names its own ref would have ended that in seconds. This is the
smallest of the plan's three branches and the one that would have prevented the
most wasted work.

## Coordination — read this

A sibling branch, `bug/pulse-names-the-ref-it-read`, is in flight **right now**
fixing the same confusion one layer down: `plot-fleet-scan.sh` builds its banner
from local `HEAD` while reading `origin/$MAIN`, and its `--json` payload carries
that mislabelled value as `head`.

That branch adds `read_ref` and `local_head` to the JSON, keeping `head` as an
alias for one release.

**You consume what it produces.** Two consequences:

1. **Do not edit `plot-fleet-scan.sh`.** That file belongs to the sibling branch
   and to two more queued behind it. Your change is board-side only.
2. **Tolerate both shapes.** Until that branch lands, the scan emits only `head`.
   Read `read_ref` when present and fall back to `head` when it is not — and
   make the fallback explicit in a comment rather than incidental. A hard
   dependency on fields that do not exist yet would make your branch unmergeable
   until theirs lands, and the plan deliberately made these independent.

## Absent values

Follow the convention `fleet.ts` already documents for `mergeable` and
`failing_checks`: one absent-value shape per field, and an absent value never
reads as a confident claim. If the ref cannot be determined, say so — do not
substitute the local head, which is the bug the sibling branch is fixing.

## Definition of Done

- `/api/fleet` carries the three fields, with the fallback path exercised
- A test asserting the response shape, including the case where the scan emits
  only `head`
- `pnpm run test:board` passes (board source is gated in the Definition of Done)
- `pnpm run typecheck` passes
- `pnpm test` and `pnpm run test:reconcile` pass
- `pnpm build:board` run **in this worktree**, artifact committed
- A changeset with a `bumps:` block

## Out of scope

`GET /api/next` and the `POST /api/claim` / `POST /api/transition` endpoints are
waves 2 and 3 of this plan. Wave 3 is blocked on an unresolved authentication
question. **Do not start either.**

## Artifact conflicts

If `board-server.mjs` conflicts, do not read the diff — it is generated and
marked `-merge`. Take either side, run `pnpm build:board`, commit the result.
Never phrase it as "take ours": *ours* inverts between merge and rebase.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.

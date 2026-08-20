# Brief — bug/a-branch-row-carries-its-link

Finding 3 of `docs/plans/2026-08-20-a-held-branch-says-who-holds-it.md`.
Reported by the operator looking at the board: the plan name is a link, the
branch name beside it is inert text.

## The measurement

From `/api/board` on one pulse:

- a **plan** row carries `slug, title, type, phase, path, prs, phaseDate, story, waveSummary`
- a **branch** row carries `branch, path` — and nothing else

Zero of the seven branch rows in that payload held a `pr` field or any URL
field. So this is not a styling omission the UI could correct: **the data is
absent from the contract.**

## Why it is cheap

The number already exists server-side. `plot-fleet-scan.sh` resolves each
branch's PR in order to decide whether the branch reads `merged` — the whole
`host_pr_state` / `merged_by_host` path exists for that. The pipeline computes
the fact, uses it for one decision, and drops it before shaping the row.

The rendering also already works: `WAITING ON YOU` renders `#240` and `#57` as
links today, so there is a component to follow rather than one to invent.

## Scope

- Carry the PR number and its URL onto the branch row in the contract
  (`AgentRowSchema` in `packages/board/src/contract/schema.ts`), sourced from
  what the scan already resolved rather than from a second lookup. **Do not add
  a host call.** If the number is not already in hand at the point the row is
  built, say so in your report rather than fetching it.
- Render it in `AgentList.tsx` the way the PR-bearing rows in `WAITING ON YOU`
  already do. Same component if there is one.
- A branch with no PR carries none and renders as plain text — never a dead
  link.

## The case that must work

A merged branch whose ref was deleted still has a PR. `#252`/`#253`/`#254` are
exactly this: 0 refs, and `pr list --state all` names each as `MERGED`. The PR
outlives the branch, so the link must survive a deleted ref.

## Tests

- a branch with a resolved PR carries its number and URL on the row
- a branch with no PR carries neither, and the row renders text not a link
- a branch whose ref is deleted but whose PR is merged still carries the link
- no new host call is made to produce the field (count invocations with a
  stubbed host, as `test/reconcile/fleet.test.mjs` does)

## Definition of Done

- `pnpm test`, `pnpm run test:board` green
- `pnpm build:board` in THIS worktree, artifact committed
- changeset with a `bumps:` block — `@plot-pm/board: minor`, `plot: patch`
- `trash`, not `rm`

## Hazards

Several suites run concurrently in sibling worktrees. A failing board test
should be re-run alone before you believe it — contention starves tests rather
than breaking them. Wait on your own PID, never `pgrep` by name. Do not touch
sibling worktrees.

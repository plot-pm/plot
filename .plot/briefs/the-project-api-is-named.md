## Implementation brief — the-project-api-is-named (slice: The board updater is routed or exempted)

- **Plan (canonical):** `docs/plans/2026-09-06-the-last-two-callers-ask-the-adapter.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `infra/the-project-api-is-named` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 merged as **#725** — the merge gate asks the adapter.

## What this delivers

`plot-update-board.sh` either asks the adapter, or is exempted **by name with its reason recorded**.

**BOTH OUTCOMES ARE ACCEPTABLE AND THE PLAN SAYS THE EXEMPTION IS LIKELIER.** This slice is a decision with its reasoning written down, not a migration that must succeed.

## Why it is different from every other caller

**IT IS CAPABILITY, NOT ROUTING** — #717's own words. The other four callers asked *what is this PR's state*, a question `plot-host.sh` already answers for both hosts. This one asks the **GitHub Projects v2 API**: resolve a project node ID, find a Status field, match an option, mutate an item. Four operations, verified 2026-09-06 at `plot-update-board.sh:21`–`:33`.

**Widening `plot-host.sh` with four project operations makes the adapter answer for a second GitHub API family with no Bitbucket equivalent.** That is a larger change than moving a call, and it puts a vendor-specific capability behind an interface whose whole point is that both vendors can answer.

## If you exempt it, follow the model that exists

`scripts/check-host-cli-callers.sh` already carries named exceptions with their reasons beside them — read `:50`–`:60` for the form. Each names the script, states what question it actually asks, and says why that question is not this gate's subject.

**The exemption must say what would change its mind.** `plot-pr-merged.sh`'s entry is the standard to match: *"EXEMPT ON A MEASUREMENT, AND NO LONGER MERELY DATED … The routing was attempted 2026-09-06 and it does not hold yet, for a reason that was not visible until the two were compared side by side."* That is an exception a reader can act on, rather than a hole.

## Remember what the tracker port already settled

`plot-host.sh issue-status` is **the ONE write to a tracker**, and the `tracker` port is separate from `host` precisely because a repository's code and its tickets may live with different vendors. A GitHub Projects board is a third thing again — it is neither the git host's PR API nor the tracker's issue status. **If routing wins, be explicit about which port it belongs to**; if it is neither, that is itself the argument for the exemption.

## Done when

- `plot-update-board.sh` either asks the adapter or carries a named exemption the gate reads
- the reason is in the file, and says what would change it
- `scripts/check-host-cli-callers.sh` passes without a broadened pattern
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not add a "just this one lookup" exception.** The gate says at `:93` there is deliberately none.
- **Do not widen `plot-host.sh` with a vendor-specific API family** without saying which port owns it and what Bitbucket answers.
- **Do not weaken the gate's pattern to make this pass.** The exemption list is the mechanism; the pattern is not.
- **Do not leave the decision implicit.** An unexplained exemption is the hole this slice exists to close.
- **Do not run `pnpm run test:e2e`.** CI is its gate.

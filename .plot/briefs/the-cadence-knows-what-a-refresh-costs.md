# Brief: bug/the-cadence-knows-what-a-refresh-costs

Implement the last *Cadence* branch of
`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`.
Read the plan first. Wave 1 (#232) is merged; the two sibling Cadence branches
are separately in flight.

## The defect, stated exactly

The board's PR refresh assumes **one request per refresh**. On Bitbucket it
costs **three**, and the cadence has never known that.

`PR_REFRESH_MS = 60_000` (`packages/board/src/server/fleet.ts:65`) means 60
refreshes an hour. Multiply by what a refresh actually costs:

| Host | requests per refresh | per hour |
|---|---|---|
| GitHub (`gh`) | 1 | 60 |
| Bitbucket (`bb`) | **3** | **180** |

The three is not incidental — it is structural. `plot-host.sh:168` expands
`--state all` into `open`, `merged`, `declined` because `bb` has no `all`
state, and the comment at `plot-host.sh:257` records the consequence:
*"A declined-only or PR-less branch still pays for all three."*

## What #232 did and did not fix

**Do not read #232 as a partial fix for this.** It replaced the per-branch
`host_pr_state()` loop with one joined `pr-list`, and on GitHub that is the
whole story. On Bitbucket the join still fans out to three calls.

Re-measured on `bitbucket.org/quatico/ekzweb` 2026-08-19 against plot 2.6.0
(issue #228):

| | 2026-08-18 (2.5.1) | 2026-08-19 (2.6.0) |
|---|---|---|
| `bb` calls | 39 | **27** |
| wall clock | did not finish in 110 s | **78 s** |

27 calls over 9 branches is exactly 3 per branch. **The improvement came from
the repo having fewer branches, not from the shape changing.**

**#225's early exit is inert in the case that matters most.** It short-circuits
only for a branch that already has an open PR. A freshly dispatched plan has
none — its branches carry a claim commit and nothing else. So right after a
fan-out, when an operator most wants to watch the fleet, the optimisation
contributes nothing.

## What to build

**The refresh cadence accounts for the configured host's real per-refresh
cost**, rather than assuming one request.

The shape is yours to choose and the plan does not prescribe one. Whatever you
choose, these three must hold:

**A GitHub-configured board is unchanged.** Assert it. This branch must not
slow down the common case to fix the uncommon one.

**The rate-limit backoff still holds for its full delay.** `rateLimitBackoffMs`
(`fleet.ts:550`) and the machinery around `PR_TICK_SLACK_MS` (line 589) already
handle a host that says *wait*. The comment at line 602 is the rule:
*a rate-limit backoff is a promise made to the host and is compared exactly.*
A cost-aware cadence must never shave a backoff — it may only be more
conservative than one, never less.

**Cost is read from the configured host, not guessed per request.** The backend
is already known (`plot-host.sh backend`). Do not probe, and do not infer the
multiplier by counting responses.

## Definition of Done

- A Bitbucket-configured board makes measurably fewer requests per hour than
  the naive cadence — assert the count, not just the interval
- A GitHub-configured board is unchanged — assert it
- The rate-limit backoff still holds for its full delay
- The cost is derived from the configured backend, not probed
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not change `plot-host.sh`'s three-call expansion — `bb` has no `all` state
  and inventing one would fabricate answers. This branch makes the cadence
  aware of the cost; it does not remove the cost.
- Do not implement partial rendering or the terminal-branch cache — those are
  the sibling branches, both in flight, and both touch `fleet.ts`
- Do not raise `REFRESH_MS` (the 5 s pulse) — this is about the 60 s PR refresh

## Platform and machine notes

`fleet.ts` is held by sibling branches as this is written. **Rebase before you
push, and expect the board artifact to conflict** — it is `-merge` in
`.gitattributes`, so take either side, run `pnpm build:board`, and commit the
rebuild. Never phrase it as "take ours": *ours* inverts between merge and
rebase.

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**A test must not race what it asserts.** Measured today: a timeout test used a
1 ms budget on a two-file repo, passed on macOS, and failed on CI where the
work finished inside the millisecond. If you assert a timing property, make it
deterministic rather than likely.

**Other agents run on this machine.** If `test:board` gives connection-refused
failures, a sibling worktree's board server is the cause. Kill only servers you
started — `pkill -f board-server.mjs` matches every board on the machine
including the operator's, and it killed a live board twice today.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.

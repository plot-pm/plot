# Cost juror: github-reads-in-process

Position: amend

Lens: does each slice remove the process starts it claims, measured against the census rows S4, S5 and S6 (CI run 42595561157, artifact `census-report-head`), and what new costs does it add?

## Measured share of the host reads

The `commands` map in `census-head.jsonl` covers two idle passes for S4 and one change for S5 and S6. I counted the images that belong to a `plot-host.sh` call: `bash`/`dirname plot-host.sh`, `mktemp plot-host-*`, `gh pr`, `gh issue`, `jq`, `jq length`, `node plot-listing-pages.mjs`, `dirname budget.tsv`, `mkdir`, `mv`, `awk {print $2; exit}`, `awk tolower`. The count leaves out the shared `rm`, `cat`, `tr` and `wc`, so it is a lower bound.

| Row | Fixture | Count | Host-call images | `plot-host.sh` calls | `gh pr` |
|---|---|---|---|---|---|
| S4 | GitHub, 0 desks | 1124.5 per pass | 360 in 2 passes, about 180 per pass (16 %) | 25 in 2 passes | 20 |
| S4 | GitHub, 3 desks | 2585.5 per pass | 492 in 2 passes, about 246 per pass (10 %) | 37 | 32 |
| S5 | GitHub, 3 desks | 2587 | 244 (9 %) | 19 | 15 |
| S6 | GitHub, 3 desks | 2696 | 282 (10 %) | 22 | 17 |

- The plan can remove about 150 to 250 `execve` per idle GitHub pass, which is 10–16 % of S4. S4 does not reach 0 from this plan, and the plan says so correctly (S4's zero waits on Phase 8).
- Each `pr-list` call costs about 14 images plus its share of `rm`/`cat`/`tr`. The 18 `node plot-listing-pages.mjs` starts (`plot-host.sh:3321`) go away with it.
- No `gh run` or `gh api` image appears in any idle S4 pass. The default-branch re-ask runs once per half `Checks wait` (1800 s), so slice 4's `runsForSha` move removes nothing from S4, S5 or S6. Its value is the cutover's completeness, not the census.
- The issue read is 1 `gh issue` in 2 passes. Slice 4 removes about 7 images per pass. `node plot-issue-source.mjs` (1 per 2 passes) stays, and the plan does not name it.

## What stays after the cutover

- **`spend-rate` stays a `plot-host.sh` process tree.** `registryd-main.ts:486`, `pr-refresh.ts:701` and `fleet-scan.ts:317` call `scripts.hostSaid(['spend-rate'])`. That accounts for most of the 5 `plot-host.sh` calls in 2 passes that are not `gh pr` or `gh issue`. The `BudgetRecord` port already reads the same ledger in-process (`budget-file.ts:107`, `:127`). The plan must name `spend-rate` as either in scope or left, with its count. The Done-when row "no `bash` whose argv names `plot-host.sh`" is scoped to three ops, so it stays true while about 2.5 `plot-host.sh` trees per pass remain.
- `node plot-merger-token.mjs` (1 per pass) stays. It is out of scope; the plan should list it beside the AgentMonitor `pr-state` as a known residue.

## New costs the plan adds

- **Processes.** One `gh auth token` at start and one per `401`. These are trigger-time and allowed by *Target Shape*. The census sets `GH_TOKEN`, so it never sees them. Acceptable.
- **Host API calls and GraphQL points.** Unchanged by design: the same queries, the same `--limit`, the same cadence. The client reads `X-RateLimit-*` headers, so it adds no `rate_limit` call. One risk: an in-process request has no 100–300 ms process start in front of it, so the reads of one pass arrive closer together. The secondary GraphQL limit counts concurrency and points per minute. The `Slots` bound (`slots-file.ts`, which spawns nothing) must stay the cap, and a client row must prove that one pass never holds more requests in flight than the shell route did.
- **Files: the budget ledger loses its rotation.** `budget-file.ts:145` says "BOUNDED BY ROTATION, WHICH THIS DOES NOT PERFORM"; `plot-budget.sh` rotates, "because it is what every appender already runs". After the cutover the largest appender, fleetd's reads, appends through `budgetFile().append` and never rotates. Rotation then depends on the shell writers that remain (the merge path, the AgentMonitor until Phase 6). When those end, `budget.tsv` grows without bound, and every `spend-rate` read and every `budgetFile` read scans a larger file. The plan must name who rotates: either the client calls a rotation in-process with the same counter and lock rules as `budget_rotation_due`, as a declared duplicate with a corpus row, or the plan states that `plot-budget.sh` still runs on a named trigger.
- **The account name.** The plan says entries go under the account `budget_account` names (`plot-host.sh:3513-3534`, which reads `gh`'s `hosts.yml`). It does not say how the client learns it. It must read `hosts.yml` once in-process; a `plot-host.sh` call per request would put a process back on every read.
- **Runners.** No new CI job. The census stub server adds no runner minutes of note. The gate script is one more `scripts/check-*.sh`, which is cheap.

## Open Questions

1. **GraphQL or REST for the deltas.** Keep GraphQL in this plan. The idle pass sends about 10 `pr-list` GraphQL calls in 2 passes on the 0-desk fixture; moving the deltas to REST changes the bucket, not the process count, and a second request shape doubles the corpus. Add the concurrency row named above, because the in-process route is the one that can raise the burst rate against the secondary limit (#3271).
2. **Which identity reads.** Agree: no `Reader app` here; `GH_TOKEN` where no person is signed in. Add: when no token resolves and the composition falls back to the shell, fleetd logs the transport once at start and publishes it with the heartbeat. Otherwise a machine where `gh auth token` fails pays the full shell cost and nothing says so.
3. **Rollback switch.** Keep it until `triggers-replace-the-tick` is delivered. It costs no process. The census must run with the default (in-process), never with the switch set.
4. **The merged listing's `--limit 500`.** Agree: no change. `mergedBranches` reads the store plus one `--since` delta when the store is complete (`registryd-main.ts:900` keeps 500 only for the full read). The full read is rare, and 5 GraphQL pages instead of 1 `gh` process is a request count, not a process count.

## Leftovers

- GraphQL vs REST, identity, rollback switch, merged limit: all four are in the plan's Open Questions. Each needs the addition named above; none needs a new slice.

## What would make a slice miss its target or regress silently

- **No green row holds the saving.** S4 is `it.fails` until Phase 8 (`census-rows.ts:42-48`), and S5 and S6 are `measured` with a 10 % tolerance. A drop of 10–16 % in S4 is therefore held by nothing: a later change that sends fleetd back to the shell (a failed token resolution, a composition bug, the switch left set) fails no test. Slice 5 records a number in *Measures*, which is a record, not a gate.
- **Silent shell fallback.** "the client resolves a token, and the shell reads otherwise" (slice 5) gives no signal. See Open Question 2.
- **Slice 1's tolerance claim.** "census S4 and S6 stay within the gate's tolerance" does not apply to S4: S4 is `strict` and `it.fails`. Name S5 and S6, or state the S4 bound.
- **No expected number.** The plan says the PR "states how many `execve` each read removed" but predicts none. Write the expected delta (about 150–250 per idle GitHub pass, about 20 `pr-list` calls in 2 passes to 0) so the cutover PR is checked against a number.

## Changes required

1. Add a per-source census row, for example `P5: an idle fleetd pass on GitHub starts no plot-host.sh pr-list or issue-list`, `green: true` from the Cutover slice, read from the strace tree by argv. Add to it a stub-server count: in-process requests per idle pass do not exceed the baseline request count.
2. Name the budget-ledger rotation owner after the cutover.
3. Name `spend-rate` (3 call sites) and `plot-merger-token.mjs` as in scope or as residue with their counts.
4. Log and publish the chosen transport; never fall back silently.
5. Add a client row: one pass holds no more concurrent requests than the `Slots` bound.
6. Write the expected S4 delta into slice 5.

## The one change that matters most

Add the green per-source census row (change 1). S4 stays an expected failure until Phase 8, so without that row the 150–250 `execve` per pass that this plan removes are recorded once and held by no gate.

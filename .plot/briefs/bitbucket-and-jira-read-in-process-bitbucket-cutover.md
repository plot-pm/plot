## Implementation brief — bitbucket-and-jira-read-in-process (wave 4: the Bitbucket cutover)

- **Plan (canonical):** docs/plans/2026-11-10-bitbucket-and-jira-read-in-process.md, Slice 7
- **Approved:** 2026-11-11, jwloka, plan-PR #3389 merged
- **Branch:** `feature/bitbucket-and-jira-read-in-process-bitbucket-cutover` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to the sprint branch
- **Review of the code:** per repo convention

Wave 4 holds this slice and `…-jira-cutover`. Both edit `census-rows.ts`, `fleetd.census.test.ts` and the story's *Measures*; the second to merge rebases. This slice waits on waves 1–3, all merged.

### What to build

An idle fleetd pass on Bitbucket starts about 1040 more images than the same pass on GitHub: 22 `bb api`, 10 `bb pr`, 10 `bb`, 16.5 `bash plot-host.sh`, 22 `mktemp`. Waves 1–3 built the in-process reader (`bitbucketApi`, `bitbucket-pr-listing.ts`, `rules/bitbucket-pr-row.ts`) and switched nothing. This slice switches the transport:

- Add `bitbucket` to `IN_PROCESS_BACKENDS` (`adapters/host/host-reads.ts:12`). `hostReadsFor` (`:116`) builds the Bitbucket client and listing where the backend answers `bitbucket` and the client resolves credentials; it reads through the shell otherwise. `PLOT_HOST_TRANSPORT=shell` (`rules/host-transport.ts`) forces the shell for both hosts.
- Split `CI: jenkins`: the plain reads (`--state all`, the merged set, the sweep's `all` half) go in-process; the rich open read stays on `plot-host.sh pr-list --state open --rich`.
- fleetd logs the transport, its reason and the credential source once at start, publishes it with its heartbeat, and `/plot-fleet --status` prints it, as for GitHub. The board's own `plot-pr-reader.mjs` takes the same composition.
- Add census row P10 (`census-rows.ts`, `green: true`), measure S4 on the Bitbucket fixture against the merge base, and record the number in the story's *Measures*. State the figure and the images removed per read in the PR.
- Add a changeset for `plot`.

### Settled decisions — do not re-derive them

- **`CI: jenkins` takes option B, not A.** Option A (every read stays on the shell, like `SHELL_CI` for GitHub) moves no read in ewz-kus-portal, the repository the story names first. Moving the rich open read before Jenkins moves reads `checks: none` on every row, because the shell overlays Jenkins colours (`_bb_jen_bind`, `plot-host.sh:4931`). Decided 2026-11-10, jwloka.
- **No credentials means the shell, and no `security` call.** The client reads `BB_TOKEN` from the environment or `.env` only. With none, composition picks the shell with the reason, fleetd logs it once, and a `PATH` stub `security` counts zero calls.
- **Mergeability reads the last fetch** (`origin/<base>`), memoised per head and base SHA. Do not add a fetch or `git merge-tree` per read. Wave 3 built it.
- **The request count stays the shell's.** Do not merge branch queries into one `OR` query.
- **Budget account is the workspace** (`rules/bitbucket-budget-account.ts`). Do not change the key.
- **A refused `next` link outside the base URL is a refusal**; never follow it.
- **The index never says `pr: 'none'`, and absent is not false.** An in-process answer of `possibly-truncated` stays partial, as the shell's does.

### Done when

The plan's `## Done when` rows for *Bitbucket cutover* are the specification:

- P10 `green: true`: no `bb`, and no `bash` whose argv names `plot-host.sh` and `pr-list`; the stub server counts no more requests than the shell's `bb api` calls, measured with `PLOT_HOST_TRANSPORT=shell` as the P5 baseline is (`fleetd.census.test.ts:133-156`).
- A composition row and a stub-server row on a `bitbucket` repository with `CI: jenkins`: the rich open read runs `plot-host.sh pr-list --state open --rich` and the stub server counts no open-rich request. Without it, a naive cutover passes P10 and loses every Jenkins colour.
- A fleetd row: the start log names the transport, its reason and the credential source; `/plot-fleet --status` prints it.
- S4 on the Bitbucket fixture against the merge base, stated in the PR and in *Measures*. S4 on both GitHub fixtures stays within 10 % + 2 of the merge base, and P5 stays green.

Plus the repo gates: no generated bundle in the diff (`scripts/check-no-bundle-diff.sh`), and the changeset. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI. `scripts/check-shell-lines.sh` refuses shell growth: touch no `.sh` file unless you remove as much shell elsewhere.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns: `adapters/host/host-reads.ts`, the fleetd composition root and status line, `census-rows.ts`, `fleetd.census.test.ts`, the story's *Measures*, one changeset. Out of scope: `jira-cutover` (Jira in `trackerFor`, census P11), Jenkins reads, and `plot-host.sh`. If you find something the plan did not anticipate, report it rather than improvising outside scope.

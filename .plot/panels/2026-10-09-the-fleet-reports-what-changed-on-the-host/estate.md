# Estate juror: the-fleet-reports-what-changed-on-the-host

Position: amend

Lens: estate. The question is what the repository already holds, what the plan cites wrongly, and what a slice would build twice. The worktree is `f145ac8bc`, three plan commits ahead of `245af5731`.

## 1. Citations

Most file:line citations hold. Two do not.

| Citation | Finding |
|---|---|
| `pr-index.ts:31` `PrIndexRowSchema` | Holds. The declaration is at `:30`; `head` at `:34` is the branch name; no SHA field exists. `PR_INDEX_VERSION = 3` at `:11`. |
| `build.ts:103` `runForSha` | Holds. |
| `plot-host.sh:4105`, `:4136`, `:4182`, `:3754` | Hold. The three `pr-list` queries request no `headRefOid`; `pr-merged-heads` at `:3754` does. The Bitbucket payload already carries `source.commit.hash` (`plot-host.sh:3768-3771`). |
| `App.tsx:30` | Holds: `POLL_MS = 30_000` at `:30`, `FLEET_POLL_MS = 4_000` at `:31`. |
| `build-shell.ts:161` | Holds: `run-for-sha` is called at `:161`; the verb is at `plot-host.sh:4396`. |
| `approve.ts:256` "writes one `pr-merge` through the performer" | **Wrong.** `approve.ts:256` pushes a `PrMergeWrite` into a decision. The performer does not perform it: `perform-fs.ts:24-28` and `:54-56` list `pr-merge` in `BEYOND_THE_FILESYSTEM` and skip it. The merge happens in `packages/board/src/server/entry/approve.ts:554` through `ctx.scripts.host(['pr-merge', …])`. |
| Open question, slice 2: "`runForSha` answers for `github-actions`" | **Incomplete.** `build-jenkins.ts:59` implements `runForSha` too, and the `run-for-sha` verb has a `jenkins` arm (`plot-host.sh:4396` onward). Only a Bitbucket Pipelines repository lacks an arm. |
| "`plot-fleetd` is the only writer (#1444)" | Holds. `packages/fleet/src/shared/pr-refresh.ts:1238-1250` folds and writes; `packages/board/src/server/fleet.ts:1745-1753` folds into an in-memory overlay when no fleet runs and writes nothing. |

## 2. What already exists

### HIGH: a subscription channel exists, and it refuses CI conditions by design

The domain has a push mechanism the plan does not name: `ports/channel.ts`, `adapters/channel/channel-socket.ts` (`startChannel`, a unix socket under `.plot/`, NDJSON), `adapters/channel/channel-client.ts`, and `rules/channel.ts` (`admit`, `route`, `absorb`). Its test is `packages/board/test/unit/the-master-agent-subscribes.test.ts`. `rules/channel.ts:36-41` holds `REFUSED_BY_DESIGN`, which refuses `ci is green` and `ci is red` with the reason "no monitor asks the host about a check run; adding one to serve this would put a host question on a fast loop".

Slices 3, 4 and 7 build a second event transport (a JSONL file, an SSE route, a mod that tails the file) beside this one. The plan does not say why the channel does not carry index transitions, and it does not say what happens to the `REFUSED_BY_DESIGN` refusal once slice 2 makes the default branch's CI an index reading that costs no fast-loop host call. Two push mechanisms with two vocabularies is the "built twice" case this lens looks for.

### MEDIUM: the monitors already write one NDJSON line per change, including `head moved`

`plot-agent-monitor.sh` and `plot-build-monitor.sh` append to `.plot-worker.monitor.{worker,agent,build}.jsonl` per desk; `packages/board/src/server/findings.ts:1-25` and `:39-43` read them, and states the same design the plan proposes ("published only on change", "a file read rather than a socket subscription"). The BuildMonitor already publishes `head moved`, `build passed` and `build failed` per pushed SHA (`docs/plans/2026-10-05-the-build-monitor-asks-for-the-pushed-commit.md`; `rules/checks-verdict.ts:15`). Slice 3's kinds `head-moved` and `checks-changed` describe the same facts from the index side. The plan must name the relation: which source a listener reads for a slice PR's checks, and why two `head-moved` words with different sources do not disagree.

### MEDIUM: the slice row already renders a PR's CI state through a domain rule

`prStates` (`packages/board/src/server/fleet.ts`, referenced at `:3978`, `:4324`) renders each slice row's CI state, and the delivered plan `2026-10-09-a-merged-pr-s-checks-freeze.md` moved its merged arm into `rules/pr-row.ts` (`prChecksSuppressedByMerge`, `:72`). Slice 5's "row badge" is a second render of the same reading. The slice must extend `prStates` and `pr-row.ts` with the SHA, not add a parallel badge.

### LOW: the board already reads CI runs per branch

`refreshRuns` (`packages/board/src/server/fleet.ts:1385-1440`) reads `ci.runs(branch, …)` for failing PR branches through the build port, with the host-slot rule at `:1424-1430`. Slice 2's default-branch reading must take the same slot rule (a shared GitHub Actions account) or state why it does not.

### Nothing found

No `headSha`/`headRefOid` field in `packages/`; no `text/event-stream` or `EventSource` in source; no `fleet-events` file; no merge workflow in `packages/domain/src/workflows/` other than approve's plan-PR step; no default-branch CI reading. `plot-deliverable-search.sh` for `defaultBranch`, `merge-on-green`, `text/event-stream` and `transition` found nothing a slice would duplicate.

## 3. Settled rules

### HIGH: the merge controller decides an irreversible act from a non-terminal index answer, and cannot pin the SHA

CLAUDE.md, *A Decision Reads The Index*: "Only a terminal answer is read from the index … `OPEN`, `CLOSED` and draft rows are stale in either direction", and *One Answer To "Did This Land"* says the blast radius decides which reading a destructive decision may use. Slice 6 reads `headSha`, `checks: green` and `draft` from the index and then merges. All three are non-terminal.

The plan's guarantee "a merge on green merges the commit that was green" also has no mechanism. `plot-host.sh pr-merge` (`:3812-3830`) takes only `--squash` and `--delete-branch` and calls `gh pr merge` with no `--match-head-commit`; `PrMergeWrite` (`workflows/decision.ts:153-159`) has no `sha` field. A push between the index read and the merge lands an unchecked head. So slice 6 needs a shell change to `pr-merge` and a write-shape change, which contradicts "No other slice touches shell" and "slice 6 writes through the existing `pr-merge` verb".

### MEDIUM: slice 2 reads a non-terminal answer for a decision

The auto-dispatch hold reads the default branch's check state from the index. The hold is reversible (a later tick releases it), so the blast-radius argument of *One Answer* permits it, but the plan must state that exception against "only a terminal answer is read from the index" rather than leave it implied. `unknown` holds nothing, which keeps "the index never says no".

### Holds

One writer is kept (fleetd only). Layering is kept (rules pure, file adapter appends). The shell-line ratchet is acknowledged for slice 1. Project-agnostic design holds: the default branch is read through `Refs.defaultBranch` (`board.ts:924`), not a literal `main`.

## 4. Order and dependencies

Slices 1, 2 and 3 can each merge alone. Slice 4 needs slice 3's file but runs correctly on an absent file (the 30 s poll stays). Slice 5's banner needs slice 2 and its badge needs slice 1, so it must come after both; the order does that. Slice 6 waits on `feature/the-controllers-are-commands` in the Approved plan `2026-10-09-the-fleet-runs-without-the-board.md:127`, which the Notes state. Slice 7 depends only on slice 3. No slice leaves main broken, provided slice 1 makes a v3 store read as "ask the host", which the existing version literal at `pr-index.ts:11` already does by construction.

## 5. The most important change

Rewrite slice 6 so the merge cannot land a head other than the one checked: the merge controller re-reads the PR from the host (not the index) for head SHA, checks and draft, and `pr-merge` gains a `--match-head-commit <sha>` argument (and the Bitbucket equivalent, or `unaskable`), with `PrMergeWrite` carrying the SHA. State that this is a second shell change, and correct the "through the performer" citation to `packages/board/src/server/entry/approve.ts:554`.

## Amendments

1. Slice 6: as in section 5. Severity HIGH.
2. Design §3/§4/§7: name the existing channel (`rules/channel.ts`, `channel-socket.ts`) and either publish index transitions on it or state why a file plus SSE replaces it; state what happens to `REFUSED_BY_DESIGN` for `ci is red`. Severity HIGH.
3. Slice 3: name the BuildMonitor findings files and define how `head-moved`/`checks-changed` relate to `head moved`/`build failed`. Severity MEDIUM.
4. Slice 5: the row badge extends `prStates` and `rules/pr-row.ts` rather than adding a second render of a PR's CI state. Severity MEDIUM.
5. Slice 2: state the reversible-hold exception to "only a terminal answer is read from the index", and apply the `refreshRuns` host-slot rule to the default-branch read. Severity MEDIUM.
6. Open question for slice 2: correct it; Jenkins has a `runForSha` arm (`build-jenkins.ts:59`), and only Bitbucket Pipelines has none. Severity LOW.

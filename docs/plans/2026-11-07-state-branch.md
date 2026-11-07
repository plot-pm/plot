# An opt-in plot/state branch syncs agent state past a protected default branch

> A repository declares a `State branch`, and every lifecycle record Plot would push at its default branch lands on that branch instead: a fast-forward push that no branch restriction, merge check or deploy hook sees. The default branch takes the records back through a sync PR at a moment the design names.

## Status

- **State:** Design
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Design:** 2026-11-07, eins78, cli

## Changelog

- A repository that declares `- **State branch:** plot/state` in its Plot Config gets its lifecycle records (Approved, Started, Delivered, Released, PR records, briefs, verify and needs-design records, sprint state) pushed to that branch instead of the default branch, as a fast-forward with no pull request. The readers (the board, `/plot-reconcile`, `/plot-dispatch`, `/plot-pulse`) read the records from the state branch where one is declared. A sync PR carries the records back to the default branch. A repository that declares no key behaves as today.

Board impact: yes. The board's plan list reads `origin/<default>` and must read the state branch where one is declared. Helper scripts change (`plot-push-main.sh` and the readers). The plan format and the `docs/plans` layout do not change.

## Motivation

**Every lifecycle record is a push at the default branch.** `/plot-approve`, `/plot-deliver`, `/plot-release`, the Started record `/plot-dispatch` writes, the PR record, the brief, the verify record and `needs-design` each commit on a disposable `plot/<action>-<slug>` branch and push it at the default branch through `plot-push-main.sh`, under one push lock (#1349), with five attempts (`ladder.ts`, #1737). On a GitHub origin the push goes through the Writer App, which sits on the ruleset bypass list. On every other origin the push is the ambient identity. Since #1737 removed the micro-PR fallback, a push the host rejects five times leaves no record at all.

**On a protected default branch the record does not land.** Measured 2026-11-07 over 17 Bitbucket repositories of one organisation (16 source-code repositories and one workspace repository that holds the others as submodules), read through the host's web UI because the CLI token lacks the scope (HTTP 403):

| Restriction on the default branch | Repositories |
|---|---|
| Nobody may push | 4 |
| Only named people or the CI account may push | 7 |
| A staff group may push (the workspace) | 1 |
| No restriction | 5 |

7 of the 17 require 1 approval for a merge, and 5 of those also a passing build. Every restriction matches only the development branch of the branching model. No repository restricts any other branch name.

So in 4 repositories no identity can write a record, and in 7 only a person the restriction names or the CI account can. An agent that runs as anyone else gets a rejected push. The route that remains is a pull request into the default branch, which waits for every merge check: an approval by a person and, in 5 repositories, a passing build. The agent that wrote the record waits too, and so does every reader: dispatch refuses a plan with no Approved record at `gate_ref` (`plot-dispatch.sh:2688`), the board lists plans from `origin/<default>` (`fleet.ts:1598`), and the reconcile scan reads a plan's phase at `origin/<default>` (`plot-reconcile-scan.sh:1223`). A record that cannot land stalls the fleet, not only the bookkeeping.

**A merge to the default branch deploys.** In several of those repositories a merge to the default branch deploys to a live test environment. A commit that changes one `State:` line redeploys that environment with no code change. Fewer merges to the default branch is a goal of its own, and it holds for the repositories with no push restriction too.

**The workspaces work today** because a staff group may push to their development branch. This plan changes nothing for a repository that declares no key.

## Design

### Approach

**Vocabulary.** The *state branch* is a shared branch on the origin that holds the lifecycle records, `plot/state` where the repository names no other. It is not `.plot/state/`, the machine-local, gitignored directory that holds the fleet's indexes and pulse; nothing in that directory moves.

**The key.** `- **State branch:** plot/state` in `## Plot Config`, read with `plot-config.sh get "State branch" ""`. Absent, every write and every read behaves as today. The value is a branch name under `refs/heads/`, so a host's PR UI can open a pull request from it (Open Question 3 names the alternative).

**The write.** `plot-push-main.sh` reads the key. Where it is set, the helper cuts the booking worktree from `origin/<state>` (from `origin/<default>` when the state branch does not exist yet, which creates it), merges `origin/<default>` into it so the state branch stays a descendant of the default branch, applies the write, and pushes the result to `origin/<state>` as a fast-forward, under the same push lock. The eight `commitAndPush` calls in the seven ladder entries (approve, deliver, release-finish, verify, needs-design, record-pr, brief-book) follow with no change of their own. The off-ladder sites follow the same helper: `write_started_record` in `plot-dispatch.sh`, which calls it already, and the plain pushes in `plot-reject`, `plot-sprint`, the RC push of `plot-release` and the direct flow of `plot-idea`. Decided 2026-11-07 (Max Albrecht): **every** write that pushes at the default branch moves; a split by record kind would make every reader merge per field. The merge of a plan PR is not a write of this kind: the plan's content is reviewed through its PR as before, and only the record of that approval moves.

The `push=` vocabulary (`clean|bypassed|unknown|rejected|locked|refused`) stays. `bypassed` cannot occur on a branch no restriction matches, and the status line names the branch it pushed, so a reader can tell a state-branch push from a default-branch one.

**The read.** One rule answers *which ref holds this plan's records*: the state branch where the key is declared and the ref exists on the origin, else the default branch. A listing is the union of the plan paths at both refs; where both hold a path, the state branch's blob wins, because every write merged the default branch in first, so the state blob is the default blob plus records until the default branch moves again. Every reader that resolves `origin/<default>` for plans reads through this rule: the board's plan list (`fleet.ts:1598-1599`, `:1817`), `phase_at_main_ref` and the working-tree reads of the reconcile scan (`plot-reconcile-scan.sh:1204-1223`), `gate_ref` and the brief read of dispatch (`plot-dispatch.sh:530-537`, `:2688`), and `/plot-pulse`. `PlanRef` already names a reference from text to a plan (`packages/domain/src/rules/plan-reference.ts:139`), so the rule needs another name; the Spec gives it.

**The sync, in two directions.** Forward, the default branch into the state branch: at every write (above) and by fleetd's tick when the default branch has moved and no write is due, so a plan merged on the default branch reaches the state branch within one tick. Back, the state branch into the default branch: through a pull request from the state branch, which passes the merge checks like any other PR and which a person approves where the host demands one. When it opens is the design's central decision, with fewer default-branch merges as the goal (Open Question 1). The candidate moments: at each release, when the default branch deploys anyway; on a cadence, or once the state branch is N records ahead; when a plan reaches Delivered.

**The state gate.** `plot-state-gate.sh` refuses a commit that changes a `State:` line without the owning script's receipt. The writers leave their receipts for their own commits on the state branch as they do today. The sync merge carries the same `State:` changes a second time; where the host merges it, no local hook runs, and where a person merges it locally the gate sees a merge commit. The Spec says what the gate accepts for a sync merge (Open Question 5). Proposal: a merge whose second parent is the state branch tip, because every `State:` change it carries already exists on the state branch under a receipt.

**Surviving the sweeps.** Measured 2026-11-07 on `origin/main` at `f3a7c01e5`: no sweep deletes a `plot/*` branch by pattern. The reconcile scan enumerates only branches under the declared `Branch prefixes` (`plot-reconcile-scan.sh:425-427`), `plot-release-refs.sh` deletes only the slice branches a delivered plan names, and `plot-dispatch.sh` deletes only the local `plot/start-<slug>` it created. That is a rule, so the write slice adds a gate: a test that feeds every delete path a declared state branch and asserts that none deletes it. `Branch prefixes` must never gain `plot/`.

**The alternative: a bypass identity.** A service account on each repository's push exemption list, the analogue of the Writer App. The data shows that the mechanism exists: the CI account is already exempt in 3 of the 17 repositories.

| | Bypass identity | State branch |
|---|---|---|
| Admin action | One edit of the restriction per repository, by that repository's admin; a client may refuse | None: write access suffices |
| Credential | One shared account and its secret on every agent machine | The agent's own |
| The policy the restriction states | Stepped over: records land on the protected branch past the checks the protection exists to run | Kept: nothing lands on the default branch except through a PR |
| Deploy on the default branch | Every record redeploys | Only the sync PR does |
| Code change in Plot | None beyond the identity selection | `plot-push-main.sh`, every reader, a sync arm |
| Host-specific | Yes: a ruleset bypass on one host, a named user on another | No: a branch push on any host |

The admin cost is the smaller argument. The larger one is the third row: `push-main-bypass` (2026-08-16) measured eight approvals that landed past a rule requiring a pull request, and a bypass identity makes that the design. The state branch respects the owner's rule and pays for it in Plot's own code. Recommendation: the state branch. Max decides on this plan's PR.

**Where it does not apply.** This repository keeps the Writer App; the key is opt-in and this repository does not declare it. A repository with `Plan PRs: never` and an unprotected default branch gains nothing from the key and declares none.

### Open Questions

- [ ] **1. When does the state branch merge back?** At each release, on a cadence or an N-records bound, or at Delivered. Fewer default-branch merges is the goal; the deploy that a default-branch merge triggers is the cost of each option.
- [ ] **2. Which identity opens and merges the sync PR?** On a host with no App identity the opener is the ambient user, who on some hosts cannot approve their own PR. Who approves where the host demands an approval, and does the merge arm merge it where it may?
- [ ] **3. A branch or a non-branch ref?** `refs/plot/state` is invisible to branch restrictions and branch listings, but also to the host's PR UI, so the sync PR needs a branch regardless. Verify that the target hosts accept a push to a non-`refs/heads` ref before the design relies on one.
- [ ] **4. The lag.** When the default branch moves after the last write, the state branch's blob of an edited plan misses that edit until the forward sync. Name the bound (one fleetd tick), and say what a reader with no fleet running does.
- [ ] **5. The receipt a sync merge carries** for `plot-state-gate.sh`, where a person merges locally.
- [ ] **6. The forward merge conflicts.** Both sides edit plan files: idea PRs add them on the default branch, writers append records on the state branch. Different lines merge clean; a conflict refuses and names the file. Who resolves it, and where is it reported?
- [ ] **7. The name of the rule and of the helper** that answer which ref holds a plan's records. `PlanRef` is taken.
- [ ] **8. What the board shows** for a plan whose records are ahead on the state branch: the Delivery tab trusts `origin/<default>` today.
- [ ] **9. The e2e proof.** A sandbox repository whose default branch is protected declares the key, and the lifecycle runs through to Released.

## Spec

_To be filled in during Design._

## Slices

### Write

- `feature/state-branch-write` <!-- spike --> — the `State branch` key; `plot-push-main.sh` cuts the booking from the state branch after merging the default branch in, and pushes a fast-forward to it; the off-ladder pushes in `plot-reject`, `plot-sprint`, `plot-release` and `plot-idea` call the helper; a test asserts that every delete path excludes the declared state branch; proved on a sandbox repository with a protected default branch <!-- builds: the State branch key and the state-branch target of plot-push-main.sh -->

### Read

- `feature/state-branch-read` — one rule names the ref that holds a plan's records and lists the union of plan paths; the board's plan list, the reconcile scan, dispatch's gate and brief read, and the pulse read through it <!-- builds: the rule naming which ref holds a plan's records -->

### Sync

- `feature/state-branch-sync` — fleetd merges the default branch into the state branch when it moves, and opens, refreshes and (where it may) merges the sync PR from the state branch to the default branch at the moment the Spec names <!-- builds: the state-sync arm of fleetd -->

## Notes

- 2026-11-07: created with `/plot-idea` from a hand-off. Decisions by Max Albrecht: Type feature, Review pr, Impl own branches, Design yes, every write moves to the state branch, the deploy motivation, and the design decides the merge-back moment.
- 2026-11-07: deliverable search. `State branch`, `plot-push-state`, `stateRef`: nothing in the estate. `planRef`: `PlanRef` exists in `packages/domain/src/rules/plan-reference.ts:139` with another meaning, so the read rule takes a different name. Title similarity: no active plan overlaps.
- Related: `docs/plans/2026-08-16-push-main-bypass.md` (the `push=` vocabulary), `docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md` (retry replaced the micro-PR), `docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md` and #1825 (the App identities are opt-in), #1835 (open).
- No prior art: no plan, doc or issue covers a state branch, an orphan branch, git notes or `refs/plot/*` as a record store. `refs/plot/claims/*` was considered once and zero exist (`docs/plans/2026-08-20-the-agent-panel-shows-the-agent.md:57`).

# An opt-in plot/state branch syncs agent state past a protected default branch

> A repository declares a `State branch`, and every lifecycle record Plot would push at its default branch lands on that branch instead: a fast-forward push that no branch restriction, merge check or deploy hook sees. The default branch takes the records back through a sync PR at a moment the design names.

## Status

- **State:** Design
- **Type:** feature
- **Sprint:** ship-2-32-0
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 7
- **Design:** 2026-11-07, eins78, cli
- **Spike approved:** 2026-11-08, jwloka, plan-PR #3231 merged, feature/state-branch-write
- **Started:** 2026-11-08, Jan Wloka, `feature/state-branch-write`

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

**Vocabulary.** The *state branch* is a shared ref on the origin that holds the lifecycle records: a branch, `plot/state`, unless the key names another ref kind (D16). The plan says *branch* for that default shape, and what it says of the branch holds for any ref except where a decision names the sync PR, which only a branch can have. It is not `.plot/state/`, the machine-local, gitignored directory that holds the fleet's indexes and pulse; nothing in that directory moves.

**The key.** `- **State branch:** plot/state` in `## Plot Config`, read with `plot-config.sh get "State branch" ""`. Absent, every write and every read behaves as today. The value is a ref: a branch name such as `plot/state`, which gets the sync PR, or any full ref such as `refs/plot/state`, which hides the records from the forge and leaves the merge back to the project (D16).

**The write.** `plot-push-main.sh` reads the key. Where it is set, the helper cuts the booking worktree from `origin/<state>` (from `origin/<default>` when the state branch does not exist yet, which creates it), merges `origin/<default>` into it so the state branch stays a descendant of the default branch, applies the write, and pushes the result to `origin/<state>` as a fast-forward, under the same push lock. The eight `commitAndPush` calls in the seven ladder entries (approve, deliver, release-finish, verify, needs-design, record-pr, brief-book) follow with no change of their own. The off-ladder sites follow the same helper: `write_started_record` in `plot-dispatch.sh`, which calls it already, and the plain pushes in `plot-reject`, `plot-sprint`, the RC push of `plot-release` and the direct flow of `plot-idea`. Decided 2026-11-07 (Max Albrecht): **every** write that pushes at the default branch moves; a split by record kind would make every reader merge per field. The merge of a plan PR is not a write of this kind: the plan's content is reviewed through its PR as before, and only the record of that approval moves.

The `push=` vocabulary (`clean|bypassed|unknown|rejected|locked|refused`) stays. `bypassed` cannot occur on a branch no restriction matches, and the status line names the branch it pushed, so a reader can tell a state-branch push from a default-branch one.

**The read.** One rule answers *which ref holds this plan's records*: the state branch where the key is declared and the ref exists on the origin, else the default branch. A listing is the union of the plan paths at both refs; where both hold a path, the state branch's blob wins, because every write merged the default branch in first, so the state blob is the default blob plus records until the default branch moves again. Every reader that resolves `origin/<default>` for plans reads through this rule: the board's plan list (`fleet.ts:1598-1599`, `:1817`), `phase_at_main_ref` and the working-tree reads of the reconcile scan (`plot-reconcile-scan.sh:1204-1223`), `gate_ref` and the brief read of dispatch (`plot-dispatch.sh:530-537`, `:2688`), and `/plot-pulse`. `PlanRef` already names a reference from text to a plan (`packages/domain/src/rules/plan-reference.ts:139`), so the rule needs another name; the Spec gives it.

**The sync, in two directions.** Forward, the default branch into the state branch: at every write (above) and by fleetd's tick when the default branch has moved and no write is due, so a plan merged on the default branch reaches the state branch within one tick. Back, the state branch into the default branch: through a pull request from the state branch, which passes the merge checks like any other PR and which a person approves where the host demands one. It opens when a plan reaches Delivered and squash-merges, one default-branch commit per sync (D12, D13); the moments considered were each release, a cadence or an N-records bound, and Delivered.

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

**Where it does not apply.** This repository keeps the Writer App; the key is opt-in and this repository does not declare it. A repository whose default branch is unprotected and deploys nothing on a merge gains nothing from the key and declares none; an unprotected default branch that deploys on every merge still gains the second motivation.

### Open Questions

- [x] **1. When does the state branch merge back?** When a plan reaches Delivered; the sync PR squash-merges (D12, D13).
- [x] **2. Which identity opens and merges the sync PR?** fleetd opens it; the host's merge rule decides who merges (D1).
- [x] **3. A branch or a non-branch ref?** Any full ref; `refs/heads/plot/state` is the recommended default, and a non-branch ref gets no sync PR from Plot (D4, D16).
- [x] **4. The lag.** A reader lists both refs and the state branch wins per path; the lag is bounded by fleetd's forward sync and shown as one line (D2).
- [x] **5. The receipt a sync merge carries** for `plot-state-gate.sh`: the gate accepts a squash commit that carries the state branch tip and names its SHA (D12, D14).
- [x] **6. The forward merge conflicts.** The write refuses and names the file; the board and the pulse report it; a person merges by hand (D3).
- [x] **7. The name of the rule and of the helper** that answer which ref holds a plan's records: `recordRef` (D17).
- [x] **8. What the board shows** for a plan whose records are ahead on the state branch: one phase, read through the rule, plus a lag line naming the sync PR (D5).
- [x] **9. The e2e proof.** A contract test against a bare origin with a rejecting pre-receive hook, plus a protected sandbox in CI's e2e (D8).
- [x] **10. The push lock's scope.** One lock per repository, unchanged; the forward sync takes it too (D15).
- [x] **11. The cut of the slices.** A fourth slice, Setup, for `plot-init` and `plot-board-setup`; the rest of the Spec goes to the three existing slices (D18).
- [x] **12. The repository with no fleet.** The commands sync: `/plot-deliver` opens or refreshes the sync PR, and a writer's forward merge is the forward sync (D19).

## Spec

Decisions, numbered. Max Albrecht decided D1 to D16 on 2026-11-07. Jan Wloka decided D17 to D19 at the spike approval on 2026-11-08.

**D1. The sync PR is fleetd's to open and the host's to merge.** fleetd opens the pull request from the state branch to the default branch and refreshes it while the state branch moves. The host's merge rule decides who merges: the merge arm where it may (the Merger App on a GitHub origin), a person where the host demands an approval. No identity steps over the rule, and no person needs to open the PR.

**D2. A reader lists both refs and the state branch wins per path.** A reader lists the plan paths at the state branch and at the default branch. Where both hold a path, the state branch's blob is the plan; a path only the default branch holds is read from there. A reader never merges and never pushes. The lag between a default-branch commit and its arrival on the state branch is bounded by fleetd's forward sync, and the board and the pulse show it as one line while it lasts. A reader with no fleet running reads the same union and shows the same line.

**D3. A forward-merge conflict refuses the write and names the file.** When the merge of the default branch into the state branch conflicts on a plan file, the write refuses, names the file, and writes no record. The board shows the conflict as a row and the pulse as a line. A person merges the default branch into the state branch by hand, pushes, and the next write succeeds. No writer resolves a conflict by rule.

**D4. The default is a branch under `refs/heads/`, named `plot/state`.** The key's default value is a branch, because the sync PR needs one, every host lists and protects branches the same way, and the measured restrictions match no other branch name. Whether the key may also name a non-branch ref such as `refs/plot/state` is deferred to the team (Open Question 3); the default stands either way.

**D5. The board shows one phase, read through the rule, plus a lag line.** The board reads every plan through D2, so a plan's phase is the state branch's phase. One line on the plan page and on the Delivery tab says how many commits the records are ahead of the default branch, and names the open sync PR where there is one. The board never shows two phases for one plan.

**D6. A sync PR changes only files Plot itself writes.** The merge arm and the review refuse a sync PR whose diff touches a path outside the set Plot writes: the plan directory and its index links, the sprint directory, and the release records Plot writes. The slice enumerates the set from the config keys (`Plan directory`, `Active index`, `Delivered index`, `Sprint directory`) and the release paths `/plot-release` writes, and the gate reads that list. A commit that puts code on the state branch never reaches the default branch through Plot; a person who wants it there opens their own PR.

**D7. fleetd merges the default branch into the state branch on every tick where it moved.** On each tick, where `origin/<default>` holds commits the state branch lacks and no writer holds the push lock, fleetd merges the default branch into the state branch and pushes under the lock. The lag D2 names is therefore one tick while a fleet runs. A conflict refuses as D3 does, with the same row and line.

**D8. The Write slice is proved twice.** A contract test runs against a bare origin whose pre-receive hook rejects every push to the default branch: approve, start and deliver land on the state branch, and the test counts zero default-branch pushes. CI's e2e adds a sandbox repository whose default branch requires a pull request, declares the key, and runs through to the sync PR's merge, so a real host refuses a real push in the proof.

**D9. A removed key is reported, not refused.** A `## Plot Config` edit has no gate, so removing the key while the state branch holds records the default branch lacks makes those records vanish from every reader. `/plot-reconcile` gains a section for it: a branch at the default name `plot/state` ahead of the default branch while no key is declared, with the fix in order (merge the sync PR, then remove the key). The board shows the same finding as a row.

**D10. The host may protect the state branch from deletion, and Plot offers it.** `plot-init` and `plot-board-setup` offer the repository's admin a `delete` restriction on the state branch where the host has one. It is optional and one setting per repository. Without it, the sync PR bounds the loss to the records written since its last merge, and the next write recreates the branch from the default branch.

**D11. `plot-init` proposes the key.** `plot-init` and `plot-board-setup` probe the default branch's protection where the host exposes it and propose the key when they find a push restriction. A person confirms; nothing declares the key by itself. The first lifecycle write after the declaration creates the branch from the default branch.

**The revisit criterion.** Max Albrecht named the bar an alternative must clear: a simple, safe and sound solution for both the CI problem (a gated default branch) and the CD problem (a deploy on every default-branch merge), which makes less noise in the repository than the state branch does. A host App identity for pushes clears the CI bar alone and not the CD bar.

**D12. The sync PR squash-merges.** Whatever number of record commits the state branch carries, one commit lands on the default branch per sync. The state branch keeps its own history. The next forward merge (D7) sees the same changes on both sides and merges clean, because git resolves identical hunks without a conflict. The default branch gains fewer commits than today, where every record is one commit.

**D13. The sync PR opens when a plan reaches Delivered.** The Delivered record is the write that makes fleetd open the sync PR (D1) from the state branch, or refresh the open one; the host's merge rule merges it (D1, D12). One default-branch merge per delivered plan, carrying every record written since the previous sync: approvals, starts, PR records and briefs of other plans included. A release still merges its own PR as today, and the Released records written after it wait for the next delivered plan. Where the host demands an approval the sync PR stands open until a person approves it, and that person may approve it earlier than the next delivery; where the merge arm may merge, no PR stands.

**D14. The state gate accepts a squash of the state branch tip.** `plot-state-gate.sh` accepts a commit that changes `State:` lines when it carries the declared state branch's tip to the default branch: every `State:` change such a commit carries exists on the state branch already, each under the receipt its writer left. The local route squashes as the host does (D12): the accepted commit is a single commit whose tree equals the state ref's tip tree and whose message names that tip's SHA, which is the receipt. A plain merge commit, and any other local commit that changes a `State:` line, is refused as today. A host merge runs no local hook and needs nothing from the gate.

**D15. One push lock per repository, unchanged.** The existing lock (`plot-push-lock.mjs`, #1349) serializes every writer and fleetd's forward sync, so a write and a forward merge never interleave. In a repository that declares the key, Plot pushes the state ref and nothing else, so a lock per target branch would have the same contenders. A rejected push retries under today's five-attempt loop.

**D16. The key may name any full ref; a branch is the recommended default.** The value `plot/state`, or any `refs/heads/` name, is a branch and gets the whole design: the sync PR (D1, D13), its gate (D6), the squash (D12) and the delete-restriction offer (D10). A value outside `refs/heads/`, such as `refs/plot/state`, is for a project that wants the records hidden from CI, from the forge's UI and from external systems that read branches. Plot writes it, reads it (D2) and merges the default branch into it (D7) as for a branch, because `git push <remote> HEAD:<ref>` and `git show <ref>:<path>` take any ref. No sync PR can open from it, so the merge back to the default branch is the project's own to set up, and D1, D6, D10, D12 and D13 do not run. `plot-init` and `plot-board-setup` say so when the key is set (D11), and recommend `refs/heads/plot/state`.

**D17. The rule and its helper are named `recordRef`.** `recordRef` answers which ref holds a plan's records (D2). `PlanRef` is taken with another meaning (`packages/domain/src/rules/plan-reference.ts:139`), and the board already logs `planSource` for the ref it reads plans from, so neither name is reused.

**D18. A fourth slice, Setup, holds the `plot-init` and `plot-board-setup` work.** Setup holds the key proposal (D11) and the delete-restriction offer (D10). The other Spec items go to the three existing slices: Write holds the state gate's squash receipt (D14) and the non-branch ref (D16); Read holds the board's lag line (D5) and the reconcile section (D9); Sync holds the path gate (D6), the squash (D12), the Delivered trigger (D13) and the sync with no fleet (D19).

**D19. With no fleet, the commands sync.** Where no fleet heartbeat is live, `/plot-deliver` opens or refreshes the sync PR (D13), and every writer's forward merge before its write is the forward sync (D7). The key does not require a fleet, and `plot-init` does not refuse it where no `Worker command` is declared. The lag D2 names is then bounded by the next lifecycle write.

## Slices

### Write

- `feature/state-branch-write` <!-- spike --> — the `State branch` key; `plot-push-main.sh` cuts the booking from the state branch after merging the default branch in, and pushes a fast-forward to it; the off-ladder pushes in `plot-reject`, `plot-sprint`, `plot-release` and `plot-idea` call the helper; a test asserts that every delete path excludes the declared state branch; proved on a sandbox repository with a protected default branch; the state gate's squash receipt (D14) and the non-branch ref (D16) <!-- builds: the State branch key and the state-branch target of plot-push-main.sh --> → #3234

### Read

- `feature/state-branch-read` — one rule names the ref that holds a plan's records and lists the union of plan paths; the board's plan list, the reconcile scan, dispatch's gate and brief read, and the pulse read through it; the board's lag line (D5) and the reconcile section for a removed key (D9) <!-- builds: the rule naming which ref holds a plan's records -->

### Sync

- `feature/state-branch-sync` — fleetd merges the default branch into the state branch when it moves, and opens, refreshes and (where it may) merges the sync PR from the state branch to the default branch at the moment the Spec names; the path gate (D6), the squash (D12), the Delivered trigger (D13), and the command-side sync where no fleet runs (D19) <!-- builds: the state-sync arm of fleetd -->

### Setup

- `feature/state-branch-setup` — `plot-init` and `plot-board-setup` probe the default branch's protection and propose the `State branch` key (D11), say what a non-branch value gives up (D16), and offer the delete restriction on the state branch (D10) <!-- builds: the State branch proposal in plot-init and plot-board-setup -->

## Notes

- 2026-11-07: created with `/plot-idea` from a hand-off. Decisions by Max Albrecht: Type feature, Review pr, Impl own branches, Design yes, every write moves to the state branch, the deploy motivation, and the design decides the merge-back moment.
- 2026-11-07: deliverable search. `State branch`, `plot-push-state`, `stateRef`: nothing in the estate. `planRef`: `PlanRef` exists in `packages/domain/src/rules/plan-reference.ts:139` with another meaning, so the read rule takes a different name. Title similarity: no active plan overlaps.
- Related: `docs/plans/2026-08-16-push-main-bypass.md` (the `push=` vocabulary), `docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md` (retry replaced the micro-PR), `docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md` and #1825 (the App identities are opt-in), #1835 (open).
- No prior art: no plan, doc or issue covers a state branch, an orphan branch, git notes or `refs/plot/*` as a record store. `refs/plot/claims/*` was considered once and zero exist (`docs/plans/2026-08-20-the-agent-panel-shows-the-agent.md:57`).
- 2026-11-08: Jan Wloka settled Open Questions 7, 11 and 12 (D17 to D19) and approved the spike `feature/state-branch-write`.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 7,
  "questionHistory": [
    {"q": "When does the state branch merge back into the default branch?", "a": "deferred", "category": "tradeOffs"},
    {"q": "Who opens and who merges the sync PR?", "a": "fleetd opens and refreshes; the host's merge rule decides who merges", "category": "technical"},
    {"q": "What does a reader do when the state branch is behind the default branch?", "a": "union of plan paths at both refs, the state branch wins per path; lag bounded by fleetd's forward sync and shown as one line", "category": "technical"},
    {"q": "What happens to a write whose forward merge conflicts on a plan file?", "a": "refuse and name the file; board row and pulse line; a person merges by hand", "category": "technical"},
    {"q": "What does plot-state-gate.sh accept for a locally merged sync PR?", "a": "deferred", "category": "technical"},
    {"q": "A branch under refs/heads or a non-branch ref?", "a": "deferred whether configurable; the default is a branch, plot/state", "category": "technical"},
    {"q": "The name of the rule and helper that answer which ref holds a plan's records?", "a": "deferred to the slice that builds it", "category": "technical"},
    {"q": "What does the board show for a plan whose records are ahead on the state branch?", "a": "one phase read through the rule, plus a lag line naming the sync PR", "category": "ux"},
    {"q": "What may a sync PR change?", "a": "only files Plot itself writes: plan, sprint and release files; the gate reads the set from the config keys", "category": "nonFunctional"},
    {"q": "What does the push lock cover with a state branch?", "a": "deferred", "category": "technical"},
    {"q": "When does fleetd merge the default branch into the state branch outside a write?", "a": "every tick where the default branch moved and no writer holds the lock", "category": "technical"},
    {"q": "How is the Write slice proved?", "a": "a contract test with a rejecting pre-receive hook, plus a protected sandbox in CI's e2e", "category": "technical"},
    {"q": "What catches a removed key while the state branch is ahead?", "a": "a reconcile section and a board row; removal is not refused", "category": "ux"},
    {"q": "What protects the state branch from deletion on the host?", "a": "plot-init offers a delete restriction; the sync PR bounds the loss otherwise", "category": "ux"},
    {"q": "How does a repository come to declare the key?", "a": "plot-init and plot-board-setup probe the protection and propose it; a person confirms", "category": "domain"},
    {"q": "What would make you revisit the state branch for a bypass identity?", "a": "a simple, safe and sound solution for both CI and CD that makes less noise in the repository", "category": "tradeOffs"},
    {"q": "How does the sync PR land on the default branch?", "a": "squash-merge: one commit per sync", "category": "technical"},
    {"q": "When does the sync PR open and merge? (re-asked)", "a": "when a plan reaches Delivered", "category": "tradeOffs"},
    {"q": "What does the push lock cover? (re-asked)", "a": "explanation requested; asked again in round 6", "category": "technical"},
    {"q": "What does plot-state-gate.sh accept for a locally merged sync PR? (re-asked)", "a": "a merge commit whose second parent is the state branch tip", "category": "technical"},
    {"q": "What does the push lock cover? (re-asked with explanation)", "a": "one lock per repository, unchanged; the forward sync takes it too", "category": "technical"},
    {"q": "May the key name something other than a branch? (re-asked)", "a": "any full ref; refs/heads/plot/state is the recommended default; a non-branch ref hides the records from CI and the forge UI and its merge back is the project's own", "category": "technical"},
    {"q": "The name of the rule and helper? (re-asked)", "a": "left to the team", "category": "technical"},
    {"q": "Where does the work rounds 2 to 5 added live in the slices?", "a": "left to the team at approval; a fourth Adopt slice is the candidate", "category": "domain"},
    {"q": "What holds in a repository that declares the key and runs no fleet?", "a": "left to the team; Open Question 12", "category": "technical"},
    {"q": "Does a locally merged sync PR land a merge commit or a squash?", "a": "a squash, as the host does; the gate accepts a single commit whose tree equals the state tip's tree and whose message names the tip SHA", "category": "technical"},
    {"q": "Keep or drop the (round N) tags in the Spec?", "a": "drop", "category": "ux"},
    {"q": "Mark PR #3231 ready for review?", "a": "yes, naming the open items", "category": "domain"}
  ],
  "deferredItems": [
    {"q": "The name of the rule and helper that answer which ref holds a plan's records?", "category": "technical", "context": "Open Question 7; left to the team in the final round"},
    {"q": "Where does the work rounds 2 to 5 added live in the slices?", "category": "domain", "context": "Open Question 11; left to the team at approval"},
    {"q": "What holds in a repository that declares the key and runs no fleet?", "category": "technical", "context": "Open Question 12; the commands sync too, or the key requires a fleet"}
  ],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": true, "performance": false, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

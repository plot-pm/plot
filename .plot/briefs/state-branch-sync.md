## Implementation brief — state-branch (wave 3: Sync)

- **Plan (canonical):** `docs/plans/2026-11-07-state-branch.md` on `main`
- **Approved:** 2026-11-08, jwloka, in-session
- **Branch:** `feature/state-branch-sync` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Write merged as #3234 and Read as #3276. This branch builds on both. `feature/state-branch-setup` is not started and waits for this branch to merge.

### What to build

Where `## Plot Config` declares `State branch`, every lifecycle record lands on the state ref and nothing carries it back to the default branch. Write forward-merges the default branch into the state ref at each write, and Read shows the lag as one line that names the sync PR as absent, so today the records pile up on the state ref and the default branch never receives them. Sync closes both directions.

The Sync slice delivers:

1. **fleetd's forward sync (D7).** On each tick where `origin/<default>` holds commits the state ref lacks and no writer holds the push lock, fleetd merges the default branch into the state ref and pushes under the same lock (D15). A conflict refuses as D3 does: it names the file, writes nothing, and shows as the same board row and pulse line Read built.
2. **The sync PR (D1, D13).** The Delivered record is the write that makes fleetd open a pull request from the state branch to the default branch, or refresh the open one while the state branch moves. The host's merge rule decides who merges: the merge arm where it may, a person where the host demands an approval. No identity steps over the rule.
3. **The squash (D12).** The sync PR squash-merges, so one default-branch commit lands per sync and the state branch keeps its own history. The next forward merge sees identical hunks on both sides and merges clean.
4. **The path gate (D6).** The merge arm and the review refuse a sync PR whose diff touches a path outside the set Plot writes: the plan directory and its index links, the sprint directory, and the release records `/plot-release` writes. Enumerate the set from the config keys `Plan directory`, `Active index`, `Delivered index` and `Sprint directory`. A commit that puts code on the state branch never reaches the default branch through Plot.
5. **The command-side sync (D19).** Where no fleet heartbeat is live, `/plot-deliver` opens or refreshes the sync PR. A writer's forward merge before its write is already the forward sync, from Write.
6. **The lag line's sync PR field.** Read left the open sync PR's number absent. Fill it, and keep "none" a valid answer.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The sync PR is fleetd's to open and the host's to merge (D1).** A bypass identity that lands the records past the host's rule is the rejected alternative: `push-main-bypass` (2026-08-16) measured eight approvals that landed past a rule requiring a pull request. Do not add an identity, a bypass or an auto-approve to make the sync PR merge.

**The moment is Delivered, not each release, a cadence or an N-records bound (D13).** One default-branch merge per delivered plan carries every record written since the previous sync. A release still merges its own PR, and the Released records written after it wait for the next delivered plan. Where the merge arm may merge, no PR stands.

**The squash is the receipt route (D12, D14).** Write built the gate half: `squashOfStateTip` (`packages/domain/src/rules/state-transition.ts`) accepts a commit that changes `State:` lines when the staged tree equals the state tip's tree and the commit is not a merge. It clears on tree equality only, because the commit message is not readable when the gate runs at `git commit` (plan Notes, 2026-11-08, item 7). Do not widen the gate, and do not read the SHA in the message. A host merge runs no local hook and needs nothing from the gate.

**A non-branch ref gets none of this (D16).** `writeTarget` reports `isBranch: false` for `refs/plot/state`. For such a key fleetd still forward-merges (D7) and `/plot-deliver` opens no PR. D1, D6, D10, D12 and D13 do not run. Read `isBranch` from the rule; do not re-parse the key.

**A forward-merge conflict refuses, and no writer resolves it by rule (D3).** The merge in `plot-state-cut.mjs` already aborts and names the files. fleetd's arm does the same and reports; it never picks a side.

**One push lock per repository (D15).** fleetd's forward sync takes the existing lock (`plot-push-lock.mjs`, #1349) and no second one. A rejected push retries under today's five-attempt loop.

**Absent is not false, and the index never says no.** A failed ask for the state ref, the open sync PR or the default branch's tip reads as *not known*, never as *no PR* or *nothing to sync*. Read the exit code, not the emptiness (measured 2026-08-27: an empty result read as no PRs and refused four merged plans). Before opening a sync PR, ask the host whether one is open from the state branch; two open sync PRs for one branch is the failure this prevents.

**The host answers "did it land", not git (CLAUDE.md, *One Answer To "Did This Land"*).** Squash-merge rewrites commits, so ancestry of the state tip in the default branch is false after every sync. Decide *synced* from the host's `mergedAt` for the sync PR and from the trees, never from `merge-base --is-ancestor`. Any ancestry call needs a `plot-ancestry:` declaration or `check-ancestry-decisions.sh` fails.

**Layering holds.** A controller calls the domain and never spawns. The domain owns the port; an adapter reaches `git` and the host. The sync PR goes through the host port (`plot-host.sh pr-create` behind the adapter), not `plot-open-pr.sh`: that opens slice PRs and refuses a branch no plan names, and a sync PR is not one. `gh pr create` is not the route. The decision (open, refresh, merge, refuse, name the reason) is a domain rule asked with readings as values, tested without mocks. Do not add a `spawn` or `execFile` site outside `adapters/`: CI's *One place reaches a process* ratchet fails when the count grows.

**fleetd's tick is one more subscriber.** `packages/fleet/src/shared/fleet-clock.ts` registers its subscribers in `ticks` and derives each divisor from the base beat. Add the sync as a subscriber there; do not start a second timer.

**Shell asks the domain (`docs/shell-and-domain.md`).** `/plot-deliver` runs once per operator command, so its sync step asks the domain through a bundle. A new `.sh` line must be paid for under `scripts/check-shell-lines.sh`.

### Done when

The plan has no `## Done when` section; the slice line is the specification. Treat each clause as a requirement. Then lift the assertions a naive implementation passes without:

- A state ref behind the default branch gets the default branch merged in on one tick, with no writer active. This catches a forward sync that runs only inside a write.
- A tick that finds a writer holding the push lock merges nothing and pushes nothing. This catches a second lock or a lockless push.
- A forward-merge conflict names the file, writes nothing, and the next tick does not retry past it silently. This catches a conflict resolved by rule.
- A plan reaching Delivered opens one sync PR; a second Delivered while that PR is open refreshes it and opens none. This catches a duplicate PR.
- A sync PR whose diff touches `packages/` or any path outside the enumerated set is refused by the merge arm and the review. This catches a gate that checks the title or the head branch name only.
- A key naming `refs/plot/state` opens no PR and still forward-merges. This catches a sync that assumes a branch.
- A repository with no key behaves byte-identically to today: no tick work, no PR, no new host call. Prove it by running each changed path with no key.
- With no fleet heartbeat, `/plot-deliver` opens the sync PR. With a live heartbeat it does not, so fleetd stays the one opener.
- After the sync PR merges, the lag line reads "0 ahead" and names no open PR, and the following forward merge is clean. This catches a squash that leaves the two refs in conflict.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. The board bundle is generated: commit no `board-server.mjs` diff or other bundle (`check-no-bundle-diff.sh`). `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: where this slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines — joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment — stores no number and has no override. Add a changeset with the description first and the `bumps:` block last. A new function you write is an arrow.

### Bookkeeping

Open the PR with `plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `### Sync` in the plan's `## Slices`. Push the first real commit as soon as it exists. Do not edit a `State:` line by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns the forward-sync arm of fleetd, the sync PR's open, refresh and merge decision, the path gate, the squash, the Delivered trigger, the command-side sync in `/plot-deliver`, and the lag line's sync PR field, with their tests. It does not own the writers (`plot-push-main.sh`, `plot-state-cut.mjs`, `write-target.ts`, the state gate's squash receipt: Write, merged), the readers and the `recordRef` rule (Read, merged), or the `plot-init` and `plot-board-setup` proposals and the delete-restriction offer (Setup, not started). Where the default branch is red, `default-branch-red` holds merges; whether it holds a sync PR is not settled by the plan, so report it rather than choose.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

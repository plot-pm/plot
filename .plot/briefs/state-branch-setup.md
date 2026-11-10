## Implementation brief — state-branch (wave 4: Setup)

- **Plan (canonical):** `docs/plans/2026-11-07-state-branch.md` on `main`
- **Approved:** 2026-11-08, jwloka, in-session
- **Branch:** `feature/state-branch-setup` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Write merged as #3234, Read as #3276 and Sync as #3292. Setup is the last wave: nothing waits on it, and it waits on nothing unmerged.

### What to build

The `State branch` key works end to end, and nothing tells a repository to declare it. Measured 2026-11-07 over 17 Bitbucket repositories: the default branch is unrestricted in 5, and 12 restrict pushes or require a merge check. Those 12 need the key, and today a person must know it exists, read the plan and type it into `## Plot Config`. `plot-init` and `plot-board-setup` are where a repository adopts Plot and its host settings, so the proposal belongs there.

The Setup slice delivers:

1. **A protection reading.** Ask the host whether the default branch restricts pushes or requires a merge check. No such question exists: `plot-host.sh` has no op that names protection, and its op list (`die "unknown op …"`, near the end of the script) shows none. The question is new and reaches a remote service, so it is a connector operation: a port method in `packages/domain/src/ports/host.ts`, an implementation in the host adapter, and a `plot-host.sh` op only if the adapter shells to one.
2. **The proposal rule (D11).** A domain rule turns the reading into a proposal, in the shape of `proposeDefaultBranch` (`packages/domain/src/rules/stack.ts`): a small union, readings as values, no port. Propose the key when the reading finds a push restriction, and propose it as `plot/state`.
3. **The non-branch warning (D16).** When the key is set to a value outside `refs/heads/`, say what it gives up: no sync PR, no path gate, no squash, no delete-restriction offer. Recommend `refs/heads/plot/state`. Read `isBranch` from `writeTarget` (`packages/domain/src/rules/write-target.ts`); do not re-parse the key in the skill.
4. **The delete-restriction offer (D10).** Where the host has a `delete` restriction for a branch, offer it on the state branch to the repository's admin. It is optional and one setting per repository. Plot does not apply it.
5. **The skill text.** `skills/plot-init/SKILL.md` and `skills/plot-board-setup/SKILL.md` each gain the proposal under their propose step, a row in their Model Guidance table where a step changes, and an unattended line. Each skill's `README.md` and the root README skills table stay in sync.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**A person confirms and nothing declares the key by itself (D11).** The proposal writes no key without an answer. Under `PLOT_UNATTENDED=1` the skills propose nothing, write no key and print a `PLOT-UNASKED:` line, as the default-branch proposal in `plot-init` does: a key written with nobody present changes where every later command writes and reads.

**Absent is not false: an unanswered ask is `unverified`, never `unrestricted`.** Measured 2026-11-07: the Bitbucket CLI token lacks the scope to read branch restrictions and the host answers HTTP 403. All 17 readings in the plan's table came through the web UI. A 403, a missing adapter, a token without scope and an empty result each read `unverified`, and the skill says so once. Reading them as *no restriction* is the failure the index rule names (measured 2026-08-27: an empty result read as no PRs refused four merged plans), and here it would hide the key from exactly the repositories that need it. `plot-board-probe.sh` already refuses the same direction for auth: report that we cannot tell, never that it is fine.

**A restriction is a proposal signal; its absence is silence.** An unrestricted default branch that deploys on every merge still gains the plan's second motivation, but no host reading shows a deploy. Propose nothing for `unrestricted`, and do not claim the repository gains nothing (plan, *Where it does not apply*).

**A repository that already carries `State branch` gets no proposal.** An existing key is the operator's decision, as with `Main branch` today.

**Do not require a fleet (D19).** `plot-init` does not refuse the key where no `Worker command` is declared. The commands sync.

**The key is never `plot/` in `Branch prefixes`.** Write's delete-path test excludes the state branch because `plot/` is no declared slice prefix. A proposal that adds `plot/` to `Branch prefixes` makes the reconcile scan enumerate and sweep it. Propose the key and touch no prefix.

**The default-branch rule is the model, and the protection rule must not be a string comparison in a skill.** `plot-init` reads `proposeDefaultBranch`'s answer and compares nothing itself. Do the same here: the skill reads the rule's state and words the proposal, and a threshold or comparison written into `SKILL.md` is a second answer to a question the rule settles.

**Layering holds.** The skill and the script call a rule through a bundle; the port is an `interface` with no runtime code; only the adapter reaches the host. Do not add a `spawn` or `execFile` site outside `adapters/`: CI's *One place reaches a process* ratchet fails when the count grows. `ports/host.ts` declares `HostBackend = string` and `host-shell.ts` keeps `DRIVES = ['github', 'bitbucket']`; the question must be answerable on both, and a host the adapter does not drive answers `unverified`, not an error.

**Shell asks the domain (`docs/shell-and-domain.md`).** Both skills run once per adoption, so a script that decides asks the domain through a bundle. A new `.sh` line must be paid for.

### Done when

The plan has no `## Done when` section; the slice line is the specification. Treat each clause as a requirement. Then lift the assertions a naive implementation passes without:

- A 403, a missing adapter and an empty answer from the host each produce `unverified` and no proposal. This catches a reading that treats silence as *unrestricted*.
- A reading with a push restriction proposes `State branch: plot/state` and writes nothing until a person answers. This catches a proposal that writes the key.
- A reading of `unrestricted` prints nothing. This catches noise on the 5 healthy repositories.
- A repository that already carries the key gets no proposal and no question, in `plot-init` and in `plot-board-setup`.
- A key outside `refs/heads/` prints the D16 warning and the recommended value; a key under `refs/heads/` prints neither. This catches a warning read from the string instead of `isBranch`.
- Under `PLOT_UNATTENDED=1` no question tool runs, no key is written and one `PLOT-UNASKED:` line names the skipped question.
- A repository with no push restriction and no key runs both skills byte-identically to today. Prove it by running each changed path against a fixture with no restriction.
- The delete-restriction offer names the host's own setting and runs no host write.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. The board bundle is generated: commit no `board-server.mjs` diff or other bundle (`check-no-bundle-diff.sh`). `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: where this slice touches a `.sh` file, remove shell elsewhere or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines — joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment — stores no number and has no override. A new `plot-host.sh` op grows shell and pays under this gate. Add a changeset with the description first and the `bumps:` block last, naming `plot-init` and `plot-board-setup`. A new function you write is an arrow. Every `SKILL.md` you change keeps its `## Model Guidance` table current, and `skills/plot/scripts/README.md` gets a row for any new script (`check-helper-table.sh`). After editing `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`.

### Bookkeeping

Open the PR with `plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `### Setup` in the plan's `## Slices`. Push the first real commit as soon as it exists. Do not edit a `State:` line by hand; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns the protection question on the host port and adapter, the proposal rule, the two skills' text and READMEs, and their tests. It does not own the writers (Write, merged), the readers and `recordRef` (Read, merged), or fleetd's sync and the sync PR (Sync, merged). No other branch of this plan is in flight.

Test the Bitbucket arm against `ewz-kus-portal` only after Jan Wloka agrees, and read-only first: a write there needs a go. Where a host reading cannot be produced locally, a fixture answers it and the brief's `unverified` rows stand.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

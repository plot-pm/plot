## Implementation brief — adoption-notices-a-stale-default-branch (wave 2: Adoption proposes the key when the two disagree)

- **Plan (canonical):** `docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/adoption-proposes-the-main-branch-key` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #971

This branch waits on wave 1, `bug/the-probe-asks-the-host-for-the-default`. It compares a field that wave 1 adds to `plot-detect-repo.sh`. At the time of writing (2026-09-24) that branch is claimed and holds no commit. Do not start until its PR is merged, and cut this branch from `origin/main` after that merge. Read the field name and its "could not ask" value from the merged probe. Do not guess them from this brief.

### What to build

The failure: a clone whose GitHub default moved from `main` to `develop` kept `origin/HEAD → main`. `/plot-init` wrote no `Main branch` key. `/plot-board-setup` verified the board as healthy. The board then read `planSource.ref: origin/main` and showed one untitled group, with `develop` listed as a branch and two of three plans missing. The operator found the cause only by adding `- **Main branch:** develop` by hand.

Today no adoption path proposes `Main branch` at all. `git grep "Main branch"` over `skills/*.md` returns nothing. The key is read in three places (`packages/board/src/server/board.ts:752`, `packages/board/src/server/idea.ts:654`, `plot-config.sh`) and nothing writes it.

This branch makes adoption compare the probe's two readings (local `default_branch` and the host's answer from wave 1) and propose `- **Main branch:** <host's answer>` where they differ. The proposal names both answers. It is silent where the readings agree, and silent (with a stated reason, see below) where the host could not be asked.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The comparison is a domain rule, not skill prose.** Put it in `packages/domain/src/rules/stack.ts` beside `proposeNode`, `proposeTicket` and the others, and let it reach the skills through `plot-propose-stack.mjs`. The skills already pipe the probe into that bundle (`plot-init/SKILL.md:71`, `plot-board-setup/SKILL.md:110`). The mapping from probe JSON to readings is `packages/board/src/server/entry/stack-readings.ts` (`readingsFrom`). Reasons:

- The probe must not decide. Its header and CLAUDE.md both say it *"reports counts and never the answer they imply"*, and the thresholds moved to `proposeStack` on 2026-09-08 for exactly this reason.
- Skill prose must not decide either. `plot-init/SKILL.md` says the thresholds *"must not be recomputed here"*: until 2026-09-08 they were prose an agent was asked to follow. A string comparison written into two skills is two answers, and it is the shape `A Shell Script Asks The Domain` forbids.
- A domain rule is unit-testable without a sandbox repo; skill prose is not.

**Board setup already runs the adoption probe. The plan's open question is answered.** The plan says `/plot-board-setup` runs `plot-board-probe.sh` and not the adoption probe, and leaves the slice to choose. That is out of date: `skills/plot-board-setup/SKILL.md:83-84` runs BOTH probes, and has since #451 (2026-08-26). It merges the two reports and pipes them into `plot-propose-stack.mjs`. So no second probe gains a field. Wave 1's field reaches board setup through the same bundle, and this branch only teaches board setup's step 2 and step 3 to show and append the proposal. Name this in the PR, because the plan's `Done when` item 3 reads as though the choice was still open.

**The key is a proposal, never a write.** The plan says so twice (*"Adoption proposes"*, *"the operator accepts it"*). Two consequences:

- In `/plot-init`, the proposal appears in step 2's confirmation with the other proposals. `composeAdoption` (`packages/domain/src/rules/adoption.ts`) writes `Main branch` only from a confirmed answer. Add an answer field to `AdoptionAnswers` (for example `mainBranch: string`, `''` = not confirmed) and to the answers JSON that step 3 hands to `plot-write-config.sh`. Do not make `composeAdoption` write the key straight from the proposal. That turns a proposal into a write, and adoption is the one command that writes into a repository Plot does not own.
- In `/plot-board-setup`, step 3 appends only confirmed or structurally proposed keys (`SKILL.md:366-381`). A confirmed `Main branch` joins that list. A repository that already carries `Main branch` gets no proposal: an existing key is the operator's decision.

**Agreement writes nothing.** That is every repository, this one included (host `main`, `origin/HEAD` `main`, probe `main`). A regression here puts a new key into every adoption. The rule answers "no proposal" when the readings agree, and the skills print nothing about the default branch in that case.

**"Could not ask" is not agreement, and it is not a proposal.** Where wave 1 reports that the host could not be asked, propose no key. State once that the host's default branch went unverified, and name the local reading. This is the direction `plot-board-probe.sh` takes with `auth: unknown`: *"Report that we cannot tell, never that it is fine."* Silence would read as confirmation, which is the failure the plan names.

**The host wins, and the proposal names both.** The host owns the default branch; `origin/HEAD` is a clone-time cache of it. The proposal carries both values so the operator sees what disagreed, for example: *"the host's default branch is `develop`; this clone's `origin/HEAD` says `main`"*. Mention `git remote set-head origin -a` as the operator's repair for their own clone. Do not run it (the plan's *What this does NOT do*).

**Out of scope, per the plan:** the board's three-step resolution in `board.ts` stays as is, and so does `idea.ts`. No host call is added to the board's hot path. The question is asked once, at adoption.

### Rules carried over

- Absent is not false: a missing or unknown host reading is `unknown`, never equal to the local one.
- Read the adapter's status, not the emptiness of a string. An empty host field must not compare as "differs from `main`" and propose `Main branch: ` with no value.
- Every question in a skill declares its unattended shape. A new confirmation needs a `PLOT-UNASKED:` line, and the sweep test fails without it. Under `PLOT_UNATTENDED=1` take the default that cannot surprise a shared repository: write no key and report the disagreement.
- When a skill step changes, update its `## Model Guidance` table.

### Done when

The plan's `## Done when` list is the specification. For this slice, the assertions a naive implementation passes without:

- **A `stack.test.ts` case for each of the three states:** agree → no proposal; disagree (`develop` vs `main`, the reported case) → proposal naming both values; could not ask → no proposal plus an explicit unverified state. The could-not-ask case catches an implementation that treats an empty host string as a disagreement.
- **An `adoption.test.ts` case:** a disagreement with no confirmed answer writes no `Main branch` key; a confirmed answer writes it. The first case catches a proposal that became a write.
- **The existing adoption fixtures produce byte-identical key lists.** They all agree, so a diff there is the "every repository gains a key" regression.
- **`readingsFrom` maps wave 1's field, and a probe report without that field** (an older probe, or one that could not ask) maps to the unknown state, not to agreement.
- Both skills show the proposal in their confirmation step and append the key only on confirmation. Each new question carries a `PLOT-UNASKED:` line.
- The rebuilt bundles under `skills/plot/scripts/board/` are committed (`pnpm build:board`); CI's no-diff gate checks them.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. Not `test:e2e`, which is CI's gate. A changeset: `'plot': patch` with the description first. Put the block last, holding `plan: docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md` and a `bumps:` entry for `plot-init` and `plot-board-setup`. Add a separate `'@plot-pm/board'` entry only if `packages/board/src` changes.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (not `gh pr create`). Then add `PR: #<number>` inside this slice's heading in the plan's `## Slices` section: `(Branch: bug/adoption-proposes-the-main-branch-key, PR: #N)`.
- Say in the PR that the plan's "which probe" question was already answered by `plot-board-setup/SKILL.md:83-84`.

### Scope guard

This branch owns:

- `packages/domain/src/rules/stack.ts` and `packages/domain/test/stack.test.ts`: the comparison rule
- `packages/domain/src/rules/adoption.ts` and `packages/domain/test/adoption.test.ts`: the confirmed answer and the key
- `packages/board/src/server/entry/stack-readings.ts` (and `entry/adopt.ts` if the answer needs mapping): the wiring
- `skills/plot-init/SKILL.md` and `skills/plot-board-setup/SKILL.md`: the confirmation and the append
- `skills/plot/scripts/plot-write-config.sh`, only if the answers file needs a new field it rejects today
- the rebuilt bundles under `skills/plot/scripts/board/`, and a changeset

It does not own `skills/plot/scripts/plot-detect-repo.sh` or `plot-host.sh` (wave 1), `plot-board-probe.sh`, or `packages/board/src/server/board.ts` and `idea.ts` (the resolution chain stays as is).

Verified at dispatch (2026-09-24): no remote branch changes any file in the lists above. Wave 1's branch is claimed and holds no commit yet. When it merges, it will own `plot-detect-repo.sh` and possibly the Bitbucket arm of `plot-host.sh default-branch`. Its brief flags that the Bitbucket arm reads `origin/HEAD` first, so on Bitbucket the two readings may always agree. Read wave 1's PR for which route it took. If it took the route that reports `unknown` on Bitbucket, this slice shows "unverified" there and proposes nothing, which is correct.

If you find something the plan did not anticipate, report it rather than improvising outside scope.

# Estate lens — adoption-notices-a-stale-default-branch

Position: amend

The defect is REAL and UNFIXED. No prior art closes it. But two of the plan's factual claims are wrong, and slice 2 targets a layer that no longer decides what it says it decides.

## Verified true

**`plot-detect-repo.sh:20` and its implementation.** The documented rule is implemented at `skills/plot/scripts/plot-detect-repo.sh:64-65`:

```
64: def_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
65: [ -n "$def_branch" ] || def_branch=$(git branch --show-current 2>/dev/null || true)
```

Emitted at `:226`. Confirmed: origin/HEAD, else current branch, else `''`.

**The probe really never asks the host.** `grep -n "plot-host\|gh \|repo view\|curl"` over the whole file returns ZERO matches. `git_host` is inferred from the origin URL alone, by `case` over the URL at `:58-61` — a string match, no network.

**`board.ts:733-761` confirmed.** `defaultBranchOf` at `:751-758`: `Main branch` key (`:752`) → `refs.defaultBranch()` (`:756`) → `'main'` (`:757`). Its docstring at `:735-741` states the deliberate no-network choice.

**Measured on this repo, all three agree:** probe `default_branch=main`, `git_host=github`; `origin/HEAD` = `origin/main`; host = `main`. The plan's "invisible here" claim holds.

**Timing of `plot-host.sh default-branch`: 1.263 s total** (0.81 s user). Plan's "asked once, at adoption" cost claim is fine.

**Issue #971 is OPEN** and its body matches the plan's Motivation table exactly.

## Wrong claim 1 — "asks the host" is GitHub-only

`plot-host.sh:2998-3007`:

```
2999:    if [ "$be" = "github" ]; then
3000:      gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
3001:    else
3004:      git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||' \
3005:        || bb repo view --json | jq -r '.mainbranch.name'
```

On **Bitbucket the op reads `origin/HEAD` first** and only falls back to `bb` when the symref is ABSENT. A stale-but-present symref returns the stale answer, so on Bitbucket the comparison compares the local reading against itself and can NEVER disagree. The plan's Motivation table says "asks the host (`gh repo view`)" without qualification, and Done-when says "reports *could not ask* where the host is unreachable" — a Bitbucket repo is neither "asked" nor "could not ask", it is a silent false agreement. That is the failure direction §"Failing to ask is not failing" explicitly forbids.

## Wrong claim 2 — reconcile does NOT self-heal this

Plan line 76: *"`plot-reconcile-scan.sh` already self-heals it during its fetch"*. It does not, for this case. `plot-default-branch.sh:32-34`:

> IT DOES NOT REPAIR A SYMREF THAT RESOLVES. Only an unresolvable one is broken. A clone whose `origin/HEAD` deliberately names a non-default branch is somebody's choice, and `--auto` would silently overrule it.

`origin_head_resolves()` (`:54-59`) returns 0 for a symref naming an EXISTING branch. In the reported clone `origin/main` exists — it just is not the default. So the repair is skipped by design. The plan cites this as a mitigation to mention in the proposal; it is not one, and repeating it in operator-facing text would misinform.

## Prior art — found, and it is the near-miss, not the fix

`git log -S 'symbolic-ref'` / `-S 'default_branch'` surfaces **#748, "The default branch repairs itself"** (`a1a0aa2d3`, 2026-09-07), which created `skills/plot/scripts/plot-default-branch.sh` — the ONE answer to "what is the default branch, and is origin/HEAD still pointing at something that exists?".

It handles the UNRESOLVABLE symref (the 2026-09-04 `plot-corpus-pin` corruption). It deliberately does NOT handle the stale-but-resolving symref. **So this plan's defect is the complement of #748, not a duplicate.** Prior art does not close it.

No plan in `docs/plans/` proposes a host-vs-local default comparison. `2026-09-07-adoption-asks-about-the-stack.md` and `2026-09-08-the-probe-reads-the-ci-system.md` touch the probe's `default_branch` field but propose nothing branch-related.

**But the plan should cite #748 and it does not.** `plot-detect-repo.sh:64` reads `origin/HEAD` with its own raw `symbolic-ref` instead of sourcing `plot-default-branch.sh`, which is the estate's declared single answer to that question and is sourced by `plot-reconcile-scan.sh:311`. Slice 1 touches exactly that line. Adding a second field beside an un-migrated duplicate entrenches the duplication the #748 header was written to end.

## The real defect — slice 2 targets the wrong layer

The plan says `/plot-init` and `/plot-board-setup` "act on the disagreement" and "propose the key". **Neither skill decides config keys any more.** `1c3385e25` — *"adoption writes its config through a controller (#840)"*, 2026-09-09, fifteen days before this plan — moved that decision into `composeAdoption` (`packages/domain/src/rules/adoption.ts`).

`skills/plot-init/SKILL.md:695`: **"Never write `## Plot Config` by hand."**
`:781` names writing the block by hand as the anti-pattern, remedy `plot-write-config.sh --answers <file>`; *"the block is `composeAdoption`'s"*.
`:41`: *"every decision inside the write is `composeAdoption`'s"*.

`STRUCTURAL_KEYS` (`adoption.ts:210-215`) plus `trackerKey`, `ticketPrefixesKey`, `ciKey`, `Git host` (`:436`), `Worktree root` (`:445`), `Commit style` (`:450`) are all decided there — with 24 tests. `AdoptionReadings` (`:125-138`) carries exactly three fields: `hasPlotConfig`, `hubDocs`, `gitHost`.

**A `Main branch` key proposed in skill prose would be the exact defect CLAUDE.md's "The Master Agent Uses The Controllers" section names**, and the one #840 fixed. Slice 2 as written re-opens it.

## Where the field belongs — `proposeStack`, per the plan's own argument

Checked `packages/domain/src/rules/stack.ts`: it handles `node`, `commitStyle`, `ticket`, `language`. **Zero branch matches** (`grep -n "branch\|Branch"` → nothing). So it does not handle this today.

But its shape is exactly right, and the plan cites the split that created it (line 59) without following it. `StackReadings` (`:53+`) takes probe readings as values; `StackProposal` (`:204+`) carries the judgement plus its evidence, and the file's own rule — *"EVERY PROPOSAL CARRIES ITS EVIDENCE"* (`:19-22`) — is precisely the plan's Done-when *"The proposal names both answers"*. A `defaultBranch: { local, host, agree | differ | unknown }` proposal there is one testable rule, reached by both skills through the bundle they already pipe into (`plot-init/SKILL.md:71`; `plot-board-setup/SKILL.md:110`), and consumed by `composeAdoption` as a key like `Git host`.

That is also the answer to "is adding a field enough": **no, for the skills as the plan scopes them — and yes, for the layer it should target.** With the rule in `proposeStack` and the key in `composeAdoption`, both skills gain the behaviour with no prose rule each must remember. The plan's two slices currently buy a probe field that nothing decides by, then a prose rule in two files that the controller would override.

## Amendments required

1. **Qualify the host reading.** Say `default-branch` asks the host on GitHub only; on Bitbucket it reads `origin/HEAD` first (`plot-host.sh:3004`) and cannot disagree. Either report `unknown` there, or fix the op to ask `bb` first — but state which.
2. **Delete the reconcile self-heal claim** (line 76). `plot-default-branch.sh:32-34` refuses a resolving symref by design.
3. **Cite #748 and route the probe through `plot-default-branch.sh`**, or state why line 64 keeps its own `symbolic-ref` while the estate's single answer sits beside it.
4. **Re-aim slice 2 at `proposeStack` + `composeAdoption`**, not at skill prose. Cite #840 (`1c3385e25`) and `plot-init/SKILL.md:695,781`.
5. Keep slice 1 as a reading. The ordering argument in Notes is sound.

Not a reject: the defect is real, unfixed, correctly diagnosed, and the fix direction (report both, decide outside the probe, propose never write) is right. The layer and two facts are wrong.

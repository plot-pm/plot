# Adoption lens — adoption-notices-a-stale-default-branch

Position: amend

The diagnosis is right and the fix is placed correctly. Three things are wrong end to end: the plan does not verify that its own proposal can be written, it dismisses the cheaper repair on a premise the estate contradicts, and it leaves the reporter's actual detection moment untouched.

## 1. Would it have saved the reporter? Partly — and at the first moment only

Traced through the three commands the reporter ran:

- **`/plot-init`** — YES, this is where it lands. `skills/plot-init/SKILL.md:51` runs `plot-detect-repo.sh`, and the probe's own header (`skills/plot/scripts/plot-detect-repo.sh:20`) states `default_branch  from origin/HEAD, else the current branch, else ""` — the host is never asked. A host reading added here surfaces the disagreement at the one moment the operator is already reading a proposal block and correcting it. This is the plan's strongest claim and it holds.
- **`/plot-board-setup`** — NO, not as the plan is written, and the plan does not say so. Step 1 runs `plot-board-probe.sh`, **not** `plot-detect-repo.sh` (`skills/plot-board-setup/SKILL.md:83`). The plan's "Done when" says */plot-init and /plot-board-setup propose the key* but slice 1 only changes the adoption probe. Board setup would need either a second reading added to `plot-board-probe.sh` or a call to the adoption probe it does not currently make. **Neither slice names that work.** This is the amendment that matters most.
- **`/plot-idea` ×3** — NO, and the reason is the sharpest finding here. `skills/plot-idea/SKILL.md:252` runs `plot-host.sh default-branch`, which asks the host. **So the reporter's three plans were cut from `develop` — correctly — while the board read `origin/main`.** The two readings were live in the same session, in the same repository, minutes apart, and nothing compared them. The plan's motivation table (lines 21-25) lists all three readers and stops short of noticing that /plot-idea is already the host-asking half; it treats the divergence as a probe gap when it is also a live inconsistency inside one workflow.

**Would they have acted on it?** At /plot-init, probably yes — it is the block step 2 exists for them to correct. But the reporter did not report at adoption; they reported after the board looked wrong. The plan's fix moves the message to a moment the reporter had already passed.

## 2. The board-setup gate had its chance and the plan does not fix it

`skills/plot-board-setup/SKILL.md:497` — step 4c fires only when **every** column is empty while `plan_files > 0`. The reporter's board showed *"NOT STARTED (1 plan · 4 slices)"*. One plan is non-zero, so 4c passed and setup reported healthy. The plan says the fix is "adoption proposes the key" and never asks why the gate that ran on this exact board said nothing.

A cheap amendment sits right there: 4c already knows `plan_files` from the probe. A board serving **fewer** cards than the repository has plan files is the same class of finding as zero, and it is the reporter's symptom exactly. That is a reading the gate can take with no host call at all.

## 3. The cheaper fix — and the plan's dismissal is factually wrong

Plan line 76: *"`plot-reconcile-scan.sh` already self-heals it during its fetch."*

**It does not, for this defect.** The self-heal is `skills/plot/scripts/plot-default-branch.sh`, sourced at `plot-reconcile-scan.sh:308`. Its rule is explicit at `plot-default-branch.sh:62`:

> `IT DOES NOT REPAIR A SYMREF THAT RESOLVES. Only an unresolvable one is broken. A clone whose origin/HEAD deliberately names a non-default branch is somebody's choice, and --auto would silently overrule it.`

`origin_head_resolves` (`plot-default-branch.sh:55-59`) returns 0 whenever the target ref exists. In the reported clone `origin/HEAD → main` and `main` **still exists** — it was demoted, not deleted. So `repair_origin_head` returns immediately and repairs nothing. The existing self-heal is scoped to the 2026-09-04 corruption (a symref naming a deleted `plot-corpus-pin`), which is a different defect.

**Correct the plan's line 76.** As written it tells a reader a repair already covers this, which would make the whole plan redundant. It is the one factual error in the document.

Having said that: **running the repair at adoption is still the wrong answer, and now for the right reason.** `plot-default-branch.sh:62` refuses precisely because a resolving symref may be deliberate, and a probe cannot tell a stale cache from a choice. The plan reaches the right conclusion through a false premise. Fix the premise, keep the conclusion — and cite `plot-default-branch.sh:62` as the authority, since that file already settled this argument.

## 4. Propose vs. write — the plan is right, for a reason it does not give

The lens question was whether a stale cache is really a matter of preference. It is not. But `plot-default-branch.sh:62` is the estate's settled answer to the identical question one layer down: a resolving `origin/HEAD` is somebody's choice until proven otherwise. Adoption proposing rather than writing is **consistent with a rule already in the codebase**, not merely deference to "propose, don't interrogate". The plan should cite that line; it is stronger than the appeal to /plot-init's posture.

One genuine gap: the plan says the proposal "names both answers" (line 85) but never says it names the **repair**. The operator who accepts `Main branch: develop` still has a stale `origin/HEAD` that every other git tool on their machine reads. The proposal should name `git remote set-head origin -a` as the operator's own follow-up — the plan's line 76 says this is "useful" and then puts it nowhere in the Done-when list.

## 5. Already-adopted repositories — the disclaimer is not acceptable as written

The plan disclaims it and offers no path. But `plot-reconcile-scan.sh` is the estate's standing drift sweep with twenty-two sections, and this is drift by any definition: a config reading that disagrees with the authority. A reader whose repo adopted Plot before this fix has no moment that ever asks again — adoption runs once.

This does not need a slice in this plan. It needs one sentence in `## Notes` naming the follow-up (a reconcile section comparing `Main branch`/`origin/HEAD` against the host), so the gap is filed rather than waved off. Right now line 99 reads as *not our problem*, and the reporter's repository is in exactly that population the moment they finish this fix.

## 6. `develop` as a branch row — same defect, but the plan should say which half

`packages/board/src/server/board.ts:727-728` filters `tip.branch !== defaultBranch`. With `defaultBranch` resolving to `main`, `develop` survives the filter — so it is a **consequence**, not a second defect, and the plan is right not to open one.

But note the precondition: `prefixedBranches` only lists refs matching `Branch prefixes` (`board.ts:721`). `develop` matched nothing in the shipped default set (`idea/, feature/, bug/, docs/, infra/` — `packages/domain/src/rules/adoption.ts:211`), so the reporter's repo must carry a custom prefix that catches it. Worth one line in Notes: the symptom needed both the stale ref **and** a prefix set that admits the default branch. A reader reproducing this from the plan alone will not reproduce it.

## 7. Slice 2 needs a domain change the plan does not name

`/plot-init` step 3 does not write config by hand — it calls `plot-write-config.sh` with an answers JSON, which asks `composeAdoption` (`skills/plot-init/SKILL.md:390`: *"IT ASKS composeAdoption AND STOPS ON ITS ANSWER. The keys, their order, their values and whether the write may happen at all are the rule's"*). `AdoptionAnswers` (`packages/domain/src/rules/adoption.ts:142`) has no `mainBranch` field, and `STRUCTURAL_KEYS` (`:210-213`) is a fixed list with no `Main branch` entry.

So "propose `- **Main branch:** <host>`" cannot be satisfied by skill prose. Either `composeAdoption` gains the key and the answers file gains the field, or the proposal is one of the "posture keys still yours to add" (`SKILL.md:424`) — a second manual edit, which is a materially weaker outcome than the plan implies. **The plan must pick one and say which.** As drafted, slice 2 reads as a prose change and is not.

## Amendments required

1. **Correct line 76** — the existing self-heal does not cover a resolving-but-stale symref (`plot-default-branch.sh:62`). Cite that line as the authority for proposing rather than repairing.
2. **Name the board-setup path** — `/plot-board-setup` runs `plot-board-probe.sh`, not the adoption probe. Say which probe gains the reading, or drop it from "Done when".
3. **Slice 2 must name `composeAdoption`** — `AdoptionAnswers` and `STRUCTURAL_KEYS` need the key, or the plan must state the proposal is a manual second edit.
4. **Add the repair to the proposal's text** — name `git remote set-head origin -a` as the operator's follow-up, in "Done when".
5. **File the already-adopted gap** in Notes as a reconcile-section follow-up rather than a disclaimer.

Recommended, not required:

6. Note that `/plot-idea` (`SKILL.md:252`) already asks the host, so the reporter's plans were cut from `develop` while the board read `main` — the divergence was live inside one session.
7. Note the branch-row symptom needed a custom `Branch prefixes` set, since the shipped defaults do not match `develop`.
8. Consider widening board-setup 4c from *every column empty* to *fewer cards than plan files* — it is the reporter's symptom and needs no host call.

The shape is right and the two slices are correctly ordered. Amend, do not reject.

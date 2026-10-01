# Round 1 — operator lens (approves and releases)

Evidence: read. Only read commands ran (`git show`, `git grep`, counts over the TSV).

Position: amend

## 1. Does it fix the issue?

The 109 `Approved` rows name 97 distinct plans, and all 97 read `Review: in-session` on origin/main. No `ballot` plan appears. The plan's two commands would own all 221 `Approved` and `Released` rows. The 16 `Rejected`/`Superseded` rows keep `--unowned`. The docs/infra rows (TSV lines 314-319) carry real tags (`v2.18.0`, `v2.21.0`), so `--release` with its tag check covers them too. The plan misses the gate described in section 4, which blocks both commands for a master agent.

## 2. Claims checked on origin/main

True: `plot-approve.sh:200-202` (`in-session)` / `die "… the reviewer is a human in the room.`), `transitions/plan.ts:257-262` (`case 'in-session': case 'ballot': return refuse(… 'review-human'`), `workflows/approve.ts:65-70` (`ApproveInput { on; who }`), `entry/transition.ts:44,139` (`Verb = 'approve' | 'deliver' | 'release'`), `plot-release/SKILL.md:401` (`--unowned … Released`). The entry's full path is `packages/board/src/server/entry/transition.ts`.

## 3. Tests

All four named tests assert the current refusal (`transitions.test.ts:132`, `workflows-approve.test.ts:61` `it.each(['in-session','ballot'])`, `approve.test.mjs:238`), so each new case fails today. No named test passes today. None covers the controller gate or a no-PR workflow input.

## 4. What an implementer must guess

1. **`plot-controller-gate.sh` refuses both commands.** Lines 82-84 gate `plot-approve.sh` and `plot-deliver.sh` and name `POST /api/$action {"slug":"<slug>"}` (`:230`). A master agent at the repo root is blocked without a receipt. `/plot-release` step 5 therefore cannot "call it once per plan" as written. The plan names neither the gate nor `/api/deliver`.
2. **`workflows/approve.ts:169-182` refuses `pr-absent` for any plan with no PR**, and `:208-210` builds the channel from `readings.pr.number`. Specify that in-session skips it.
3. **"The board passes the operator's configured name" has no source.** No config key or server field names the operator (`People` maps spellings and names nobody as operator). `/api/approve` has two arms (`approve.ts:294-303`), and the `Approve command` arm runs `/plot-approve`, which refuses in-session when unattended (SKILL.md:124-128). The plan does not say how the reviewer reaches that arm.
4. **The `--release` version and date.** `workflows/release.ts:270-277` records each plan's own tag, and `plot-release/SKILL.md:395` records `<tag date>`. The plan takes one caller version and writes `<date>`, which it leaves undefined. It must say that `/plot-release` passes the per-plan `git tag --contains` version, and which date the record carries.
5. `.plot/briefs/a-release-is-a-controller-command.md` targets the same gap and goes unmentioned.

## Required changes

- Name `plot-controller-gate.sh` and choose a route: either `/api/approve` takes `reviewer` and `/api/deliver` takes `release`, and the skills call those routes, or the gate exempts the two new modes for a stated reason. Add a contract test for that choice.
- Specify that `workflows/approve.ts` skips the PR checks for in-session, and add a unit case that has no PR.
- Name where the board gets the reviewer, and how the reviewer reaches the agent arm.
- Specify the per-plan version and date for `--release`.
- Name the overlapping brief.

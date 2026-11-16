# Round 2, Estate lens: delivery-work-items-show-gates

Position: amend

## 1. Did the round-1 amendments hold?

- Sibling branch names hold (verified by grep of every `<!-- waits: -->` and slice line): `feature/delivery-section-header`, `delivery-you-groups`, `delivery-agent-roles` and `delivery-release-plan-rows` exist with the stated owners. Plan 5's slice waits on `feature/delivery-work-items-gates`, so the dependency runs both ways consistently. `delivery-agent-roles` does widen `AgentRole` (its slice text says "widened to eight roles").
- `GATE_MARK` (`delivery-row-form.ts:91`) and `gateValue` (`:139`) hold. `gateValue` returns CI if CI is read, else one review mark: "one gate per row" is true (verified).
- `–` for `review: none` holds as a state: `PrReading.review` already includes `'none'` (`delivery-placement.ts:40`). `gateValue` renders nothing for `none` today. The `:221` citation points at the `itemRowCells` signature; the "unread yields null cell" rule is at `:33` and `:215-216` (minor).
- `prUrl` resolution is WRONG (verified). The plan says the gates slice fills `prUrl` "from the PR number and the repository URL". `packages/board/src/contract/schema.ts:292-303` (CardPrSchema) states that nothing under `packages/board/src` may build a PR address from a PR number plus a repo, because it yields a wrong link on GitHub Enterprise or self-hosted Bitbucket. The board has `branchUrlBase` and `issueUrlBase` only, no PR base.
- "No check name or run reading; CI mark links to the checks page" is half wrong (verified). `CardPrSchema` already carries `url` (host-verbatim) and `checksUrl` ("the PR's checks page on the host", `schema.ts:309`). The plan misses the existing `checksUrl`, and `entities/pr.ts:94` has `url` plus `failingChecks: readonly string[]` ("names only"), which is a check-name reading. The "check name is a gap" claim is therefore false for failing checks.
- Commit count resolution is WRONG (verified). `localAhead` (`schema.ts:2489`, `:3050`) counts commits the machine has that the remote does not (`unpushed` only, 0 elsewhere, "absent is not zero, it is unobserved"). A pushed desk reads 0, so "4 commits" is not the branch's commit count. The plan names the shell field `local_ahead`, which is used in `stuck.ts:266` for the unpushed-commits stuck note only.
- Fixer attempt resolution holds: `rules/fixer-attempts.ts:5` `FIXER_ATTEMPTS_BUDGET = 2`; `entities/fixer-attempts.ts` exists (verified by ls and read).
- Open Point 6 (Draft/Design/approval-owed in Queued) stays open for Jan; code confirms today's behaviour: `workGroup` (`delivery-placement.ts:227-229`) sends tickets, draft/design phases and `approvalOwed` to `queued`.

## 2. Claims the source does not support

- `row-identity.ts:77` `isUnbegun`: the line is right, but the file is `packages/board/src/app/lib/agent-rows/row-identity.ts`, not domain. `isUnbegun` is a board-app predicate over `AgentRow`, not a domain rule (verified).
- `AgentList.tsx:1219` is a `dispatch={...}` prop on a block, not the Start control itself (verified by read). The path is `packages/board/src/app/components/AgentList.tsx`.
- `prUrl: () => null` is at `AgentList.tsx:1097` (verified); the plan gives no location.
- "stage: 'building' with no live agent and no stopped agent" matches `workGroup` and the `agent-died` Unblock line (`delivery-placement.ts:220,234-235`). Items with `heldBy` (machine, rate-limit) also land in At a gate (`:230`), and the plan does not say what their Gates cell shows.
- The `<!-- waits: -->` marker as the source of Waits on is not confirmed: `delivery-readings.ts:186-187` sets `waitsOn` from `row.blockedBy`, which `schema.ts:3195` documents as a slice-name string with "blocked by an earlier slice" fallback. I did not trace whether `blockedBy` derives from the marker (inferred, not verified).

## 3. What a builder would guess

- The link target for the CI mark: `resolveLink` (`delivery-link-targets.ts:44-50`) maps `pr` and `review` to the same `prUrl`, and `ci-run` to `none`. A CI-checks link needs a new target or use of `checksUrl`; the plan does not say which.
- How a Progress commit count is obtained for a branch that is pushed or has no local desk. Nothing in the payload provides it.
- Whether `ItemRowFacts` gains a `prReading.review`-link fact, and where `ciRun` (currently never set) goes now.
- Gates cell for `heldBy` items.

## 4. Most serious gap

The two gate-link and progress mechanisms the plan resolved in round 1 contradict the code: the plan prescribes the URL arithmetic that `schema.ts:296-303` forbids, ignores the `checksUrl` and `url` fields the payload already carries, and bases "N commits" on `localAhead`, which counts unpushed commits only. Fixable by editing the plan: use `CardPr.url` and `checksUrl` (empty means plain text), and either drop the commit count or name a real reading for it. Not fatal: amend.

Verified by reading code or grep: everything above except the `blockedBy`-to-`waits:` derivation (inferred). I did not run the board.

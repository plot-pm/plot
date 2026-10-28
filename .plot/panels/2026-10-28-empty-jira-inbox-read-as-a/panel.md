# Panel moderation: empty-jira-inbox-read-as-a, round 1

**Reconciliation:** unanimous `amend` (connectors, domain-rules, operator, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran | Read |
|---|---|---|
| domain-rules | esbuild probes of `waitingTickets` and `ownership` with the ewz-kus-portal shape | `waiting-tickets.ts`, `ownership.ts`, `fleet.ts`, `issue-refresh.ts`, every `isMine` caller |
| connectors | domain probe with the real ewz `People` line; read-only `plot-host.sh account` and `pr-list` in ewz-kus-portal; two read-only Jira searches | `tracker-shell.ts` `walk`, `issue-refresh.ts`, `plot-host.sh` Bitbucket author fields, `AgentList.tsx` |
| operator | node probes of `waitingTickets` and `prOwnership` | `DeliveryFilters.tsx`, `chip-row.ts`, `waiting-view.ts`, `lanes-for-reader.ts`, `StoriesTab.tsx` |
| testability | domain tests for waiting-tickets, ownership, lanes-for-reader (112 pass); board unit tests for mine-filter, waiting-view, unplanned-issues (64 pass); two probes | the tests that pin today's behaviour |

All four executed something. Three probes were independent and agree.

## Where the jurors agree

1. **Slice 1 names the wrong arm.** `inbox: []` already returns 0 tickets and no notice (four independent probes). The issue's banner reproduces word for word only with `inbox: undefined`, which the plan keeps unchanged. The board with no fleet never reads the inbox: `refreshIssues` calls `waitingOf` without one (`fleet.ts:2096-2098`); only fleetd reads it (`issue-refresh.ts:501`), and a failed first fleetd read also leaves it absent (`issue-refresh.ts:259-262`). `waiting-tickets.test.ts:175` pins the wrong advice as current behaviour. The same defect sits in the arm at `waiting-tickets.ts:196-198` (no `jira:` spelling declared).
2. **The notice can suggest a spelling another person holds.** It suggested `jira:markus.ruepp@quatico.com`, which `People` already declares for mruepp; following it would drop that spelling for both (`person.ts:99-101`, connectors).
3. **Duplicates pass through the fallback arms.** Only the matched arms call `unionDedup`; the fallback renders `[...candidates]` (`waiting-tickets.ts:213`). Upstream, `walk` (`tracker-shell.ts:277-299`), the index write and `foldIssueRows` keep a repeated key. Probes reproduce adjacent pairs and a hidden count above the open count.
4. **Slice 3 is a feature and reverses a released contract.** `2026-09-24-the-board-shows-me-only-my-work.md:123` says unknown is shown, pinned by `ownership.test.ts:200,269`, `chip-row.test.ts:141`, `mine-filter.test.ts:45,74-100`. `isMine` has five callers including Discovery (`lanes-for-reader.ts:67`). `agentOwnership` never answers `theirs`, so a mine-only filter hides the reader's own desks and every `elsewhere` agent.
5. **Question 4's premise is false.** The Bitbucket author arrives as `.author.nickname` (`plot-host.sh:4971-4983`); «Christian Kehl» resolves to `ckehl` and `prOwnership` answers `theirs`. No `People` spelling makes a PR row `unknown`.
6. **Open question 4 is answered.** «Only my work» and «Mine» are one control: the chip row replaced the checkbox in #2080 (`DeliveryFilters.tsx:8-9`), same state and storage key.

## Where they add to each other, not disagree

- **Why the Draft rows stayed visible.** connectors: Draft plan rows skip «Mine» entirely (`AgentList.tsx:514,1176`; `DraftPlanSchema` has no owner). domain-rules and testability: plan cards with no author read `unknown` (`plan-card.ts:49-52`). Both are true for different row kinds; the first is a defect independent of slice 3.
- **The duplicate's producer.** domain-rules and testability point at `walk`; connectors found Jira's cursor clean on pages 1–2 and the duplicated keys are the newest tickets, which points at the held index plus the changed-since fold. Neither measured the live ewz `issues.json`. Fixing one row per key at the index write and at the `waitingTickets` read covers both producers.
- **Bitbucket with no login.** connectors: `plot-host.sh account` exits 4 on Bitbucket, so `hostUser` is empty unless `PLOT_BUDGET_ACCOUNT` is set and every PR row reads `unknown`. Slice 3's "hide unknown" would empty that reader's board — the failure the 2026-09-24 contract exists to prevent.

## Shared blind spot

No juror saw the reporting board's own state: whether a fleet ran on ewz-kus-portal when the banner appeared, and what its `issues.json` held. Every conclusion about which arm fired and which path duplicated is inferred from code and probes. The inference is strong (four probes agree on the arm), but the duplicate's producer stays unmeasured until someone runs `jq` over that file.

## Amendments the panel asks for

- Slice 1: fix the `undefined` arm — the no-fleet board reads the inbox, and an absent inbox never takes a spelling from project-wide rows; the notice never names a spelling `People` gives another person. Replace `waiting-tickets.test.ts:175`'s expectation.
- Slice 2: one row per ticket key where the index is written and where `waitingTickets` reads; done-condition: no key appears twice on any arm.
- Add a bug slice: Draft plan rows obey «Mine».
- Move slice 3 («Mine» hides unknown, the count, *Unassigned*) to its own feature plan that states the contract it reverses and the Bitbucket no-login case.
- Rewrite problem 4 and close open questions 2 and 4 with the evidence above; document in `People` that a Bitbucket author is matched by nickname.
- Add a Changelog line for the duplicate fix; list `2026-09-24-the-board-shows-me-only-my-work` in Notes.

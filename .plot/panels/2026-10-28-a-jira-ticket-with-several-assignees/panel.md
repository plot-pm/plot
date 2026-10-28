# Panel moderation: a-jira-ticket-with-several-assignees, round 1

**Reconciliation:** unanimous `amend` (callers, connectors, domain-rules, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran | Read |
|---|---|---|
| domain-rules | node probe of `ownership`, `waitingTickets`, `ownerOf` over 14 cases beside the proposed loop; 112 domain tests | `ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts` |
| callers | node probe of `ownership`, `isMine`, `ownerOf`, `waitingTickets`, `lanesForReader`, also against PR #2814's `waiting-tickets.ts`; 112 domain tests | every ticket-ownership caller, `chip-row.ts`, PR #2814 |
| connectors | vitest probe of the domain functions; read-only `plot-host.sh issue-list --limit 50` in ewz-kus-portal | `plot-host.sh:5429`, `tracker-listers.ts` |
| testability | 140 tests on main; the planned fix in a scratch copy against 151 tests | the existing multi-assignee tests |

All four executed. The connectors reading of live data and the testability mutation run carry the most weight.

## Where the jurors agree

1. **The rule is wrong and the fix is right.** `[mruepp, jan]` answers `theirs`, `[jan, mruepp]` answers `mine` (four probes). The planned loop changes only the cases where a declared other person precedes the reader; every other answer stays (testability: 151 of 151 pass against the fixed copy, so no test pins the order).
2. **The defect is latent on every shipped connector.** Jira is the only `tracker-account` lister (`tracker-listers.ts:19-22`), and its read emits at most one assignee (`plot-host.sh:5429`); ewz-kus-portal: 0 of 50 open tickets with two assignees. GitHub and Bitbucket rows carry several assignees but take the host-login path, which already reads every assignee. The Motivation's "Effect on the board" and the Changelog describe a state no reader reaches today and must say "latent".
3. **The plan's testing claim is too broad.** `waiting-tickets.test.ts:200` and `lanes-for-reader.test.ts:134-136` cover several assignees, with an undeclared one first. The real gap is a declared other person ahead of the reader.
4. **The *Waiting on you* half holds only with no inbox read.** With the ticket in the inbox, `unionDedup` shows it (`waiting-tickets.ts:224`). After PR #2814 the no-inbox arm returns `[]` before `ownership` runs. A test with `inbox: []` and a declared reader fails on main and holds on both bases.
5. **The open question: keep `[undeclared, declared-other]` as `theirs`.** The model is `planOwnership` (`ownership.ts:135-141`), not the host-login loop, which would turn `[undeclared]` alone into `theirs`.
6. **`ownerOf` labels the first declared assignee** (`ticket-lanes.ts:98-109`). After the fix a ticket that answers `mine` shows `mruepp` as its owner. On GitHub this happens today (`['eins78','jwloka']` shows eins78).

## Where they add to each other

- connectors: `accountMatches` (`waiting-tickets.ts:83-93`) is a second copy of the matching rule and can disagree again; replace it with one shared predicate in this slice.
- testability and callers: Discovery (`lanesForReader`) takes the same path and needs its own regression assertion, the `tracker-account` twin of `lanes-for-reader.test.ts:124`.
- callers: this fix merges before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split`, so their tests do not pin the old answer.

## Shared blind spot

None found that the panel did not name itself. The panel established that no connector reaches the defect, which makes its priority, not its correctness, the open point.

## Amendments the panel asks for

- Say "latent" in the Motivation and Changelog; name the Jira single-assignee read.
- Model the fold on `planOwnership`; keep `[undeclared, declared-other]` as `theirs` and pin `[mruepp, undeclared]` → `theirs`.
- Correct the testing claim; write the failing assertions that fail on main (`[mruepp, jan]`, *Waiting on you* with `inbox: []`, the Discovery lane twin).
- Replace `accountMatches` with the shared predicate.
- Decide `ownerOf`: in scope or a named follow-up.
- Note the merge order before #2811's slices.

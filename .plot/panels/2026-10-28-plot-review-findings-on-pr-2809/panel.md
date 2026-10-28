# Panel moderation: plot-review-findings-on-pr-2809, round 1

**Reconciliation:** divided — `amend` (fit, domain-rules, testability), `reject` (process). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| fit | a vitest test on a scratch worktree of PR #2814's head (`5472779b9`) against main's `waiting-tickets.ts` |
| domain-rules | `waitingTickets` at main and at #2814's head; `ownership({kind:'plan'})` on a two-person plan |
| process | `plot-plan-meta.sh`, an esbuild probe of `sliceVerdicts`, read-only `gh` checks of two precedent commits |
| testability | a probe vitest at #2814's head and main; `plot-plan-meta.sh`, `check-plan-headings.sh`; a node probe of `foldIssueRows` |

All four executed. Three reproduced finding 1 in PR #2814's code independently.

## Where the jurors agree

1. **Finding 1 is already a defect in PR #2814, not a future text edit.** In a Jira repository with no `Ticket prefixes`, the inbox read answers `unaskable` (`tracker-jira.ts:179-181`) and becomes `inbox: undefined` (`issue-refresh.ts:258`); #2814 turns that into 0 tickets and the notice "The inbox was not read". Main shows the reader's rows. plot-review found the same as HIGH (#2821). The plan puts this fix last, behind a `waits:`, so #2814 could land first with the defect.
2. **The slice mechanics are wrong.** `<!-- waits: Plan text -->` names a heading, not a branch, and `plot-plan-meta.sh` reports it in `unread_waits`; it is also redundant. The parent's three slices are three waves, so `sliceVerdicts` reads `[eligible, blocked, blocked]`: finding 4's parallel-dispatch risk does not exist, only the parent's Notes sentence "any order" is wrong.
3. **Open question 2 has an answer in the domain.** `ownership({kind:'plan', assignee, author, approver})` (`ownership.ts:135-141,267-268`) answers `mine` when any field resolves to the reader. The plan's "`author`, then `assignee`" would be a second, conflicting rule.
4. **Corrections:** an `idea/` branch with no PR is a branch row with `plan: ''` (`fleet.ts:7023-7026`) and hides no Draft row; `foldIssueRows` keeps a duplicate already held (`[A, A]` stays two); its write-through caller and `foldChangedIssueRows` need covering in the parent's slice 2.

## Where they disagree

- **The vehicle.** process (reject): withdraw this plan and amend the parent directly with one commit to main; the repo already does this for Approved plans after a plan-PR review (`37cf9d803`, `3ba68712b`), `plot-implement/SKILL.md:97-101` sanctions it, no gate needs more, and a `Type: bug` plan would put a plan-text Changelog line into the release checklist with nothing shipped. fit (amend): the findings belong in one docs amendment to the parent, not a second plan lifecycle. domain-rules and testability amend the content and accept a plan as the vehicle. The disagreement is about the vehicle, not the content; no juror defends two slices that edit one file.
- **The signal for finding 1.** domain-rules: a rows scope (`person | project`) from `Ticket prefixes`, because that fact decides the JQL; the outcome only words the notice. fit and testability: the inbox outcome, stored in `issues.json` on the fleet path. domain-rules adds a new question: `PLOT_JIRA_JQL` replaces both JQLs, so the scope then no longer follows `Ticket prefixes`.

## Shared blind spot

All four judged the plan and the PR's current head. The fix for finding 1 is now being made on #2814 itself; whichever signal it lands with becomes the parent's decision by default, so the signal question must be settled against that PR, not in this plan.

## Amendments the panel asks for

- Withdraw this plan, or reduce it to one docs branch; close #2813 with a commit amending the parent plan: findings 3, 5, 6, 7, finding 4 as a Notes sentence, finding 2 resolved with the existing plan-ownership rule, finding 1 recorded as decided on #2814.
- Drop the `waits:` annotation in any case.

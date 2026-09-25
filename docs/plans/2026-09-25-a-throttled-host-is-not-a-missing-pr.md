# A throttled host is not a missing PR

> `plot-approve` reports *"no PR found"* about a pull request that is open, and prescribes pushing a branch the operator already pushed. Measured 2026-09-25 on Bitbucket, `bb` 1.9.0: PR 3636 was OPEN and readable by number, while `bb pr list` answered HTTP 429. The listing was refused; the PR was never absent.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #985
- **Sprint:** plot-works-in-the-repos-that-adopt-it

## Changelog

- `plot-approve` tells a host that could not answer apart from a host that answered *no PR*. A throttled read stops the approval with the host's own reason and prescribes waiting; only a genuine absence prescribes pushing the branch.

Board impact: none. `/plot-approve` runs as a controller action and writes no board state on the refusal path.

## Motivation

**The vocabulary already exists and the caller discards it.** `plot-host.sh:401` defines it:

> Exit 5 — the host refused to answer FOR NOW. A rate limit, primary or secondary.

`plot-approve.sh:230-231` then throws it away:

```bash
pr_json=$(bash "$script_dir/plot-host.sh" pr-state "$pr_branch" 2>/dev/null) || pr_json=""
[ -n "$pr_json" ] || pr_json='{"number":0,"state":"NONE","draft":false,"url":""}'
```

`|| pr_json=""` catches **every** non-zero exit, and the next line turns emptiness into `state: NONE`. Exit 5 (throttled), exit 4 (backend cannot be asked) and a genuine absence all arrive at the refusal as the same word.

**The estate already has the rule this breaks.** `plot-detect-repo.sh:94` states it for a different reading — *absent is not false* — and carries a status field beside the value so a caller can tell *unasked* from *answered nothing*. `plot-board-probe.sh` reports auth as `ok`/`failed`/`unknown` for the same reason. The host adapter does its half correctly; this caller does not read it.

**The prescription is what makes it costly.** The message names a repair the operator has already done:

```
plot-approve: no PR found for branch 'idea/…'.
  Push the branch: git push -u origin idea/…
  Then open its PR — or run /plot-idea, which does both.
```

A rate limit clears on its own. An operator who follows this advice pushes an already-pushed branch, then runs `/plot-idea` against a plan that has one — and neither action helps, because nothing was missing.

## Design

### Read the exit code, not the emptiness

Three outcomes where there is one today:

| exit | what it means | what approval should do |
|---|---|---|
| 0, with a PR | the PR exists | proceed as today |
| 0, no PR | genuinely absent | today's message, unchanged |
| **5** | **throttled — could not ask** | **stop, name the limit, prescribe waiting** |
| **4** | **this backend has no such answer** | **stop, say so; do not prescribe a push** |

The refusal for 5 and 4 is a **stop, not a pass**: approving a plan whose PR state is unknown would merge on an unread gate. But it stops with a different sentence and a different repair.

### The message carries the host's own words

`plot-host.sh` already prints the host's report to stderr — `plot-approve.sh:230` sends it to `/dev/null`. Keep it and print it: *"Bitbucket: HTTP 429 — rate limit for this resource has been exceeded"* tells the operator what to wait for, where *"no PR found"* sends them to fix the wrong thing.

### What this does NOT do

- It does not retry. A retry inside an approval turns one refused read into several, against a limit that is counting them. Waiting is the operator's call.
- It does not change `plot-host.sh`, whose exit codes are already right.
- It does not touch the other callers of `pr-state`. They may have the same bug; this plan fixes the one that was measured and names the rest as a question.

### Open questions

- [ ] **Which other callers collapse the exit code the same way?** `grep -l 'pr-state' skills/plot/scripts/` finds several. Each needs reading, but a sweep is its own slice and should be measured before it is scoped.

## Done when

- A throttled `pr-state` stops the approval with the host's reason, and the word *"push"* does not appear in that message.
- A genuine absence keeps today's message exactly.
- Exit 4 stops with its own sentence rather than the absence one.
- A test per arm, driving `plot-host.sh` through a stub that exits 0-with-PR, 0-empty, 4, and 5.
- **The phase is not flipped on any of the stop arms** — an approval that could not read the PR must not record one.

## Slices

### The approval reads why the host said nothing (Branch: bug/the-approval-reads-why-the-host-said-nothing)

- `bug/the-approval-reads-why-the-host-said-nothing` — `plot-approve.sh:230` captures the exit code and stderr rather than discarding both; exits 5 and 4 stop with the host's own reason and no push prescription; a genuine absence is unchanged; a stub-driven test for each of the four arms, and one asserting the phase is untouched on every stop

## Notes

- Reported from a Bitbucket estate where `bb pr view 3636` answered `State: OPEN` while `bb pr list` answered 429 in the same minute. **The PR was readable the whole time** — only the listing was refused, which is why the by-number path disagreed with the by-branch one.
- **This is the same class as #970's real cause**, and worth reading beside it: a caller that cannot distinguish *could not ask* from *the answer is no*. #970's own fix shipped in v2.19.0 by giving the host arm a partial-answer exit; this is the caller side of the same discipline.

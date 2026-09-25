# A throttled host is not a missing PR

> `plot-approve` reports *"no PR found"* about a pull request that is open, and prescribes pushing a branch the operator already pushed. Measured 2026-09-25 on Bitbucket, `bb` 1.9.0: PR 3636 was OPEN and readable by number, while `bb pr list` answered HTTP 429. The listing was refused; the PR was never absent.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #985
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 1
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Started:** 2026-09-25, Jan Wloka, `bug/the-approval-reads-why-the-host-said-nothing`

## Changelog

- `plot-approve` tells a host that could not answer apart from a host that answered *no PR*. A throttled read stops the approval with the host's own reason and prescribes waiting; only a genuine absence prescribes pushing the branch.

Board impact: none. `/plot-approve` runs as a controller action and writes no board state on the refusal path.

## Motivation

**The caller discards the only signal there is.** `plot-approve.sh:230-231`:

```bash
pr_json=$(bash "$script_dir/plot-host.sh" pr-state "$pr_branch" 2>/dev/null) || pr_json=""
[ -n "$pr_json" ] || pr_json='{"number":0,"state":"NONE","draft":false,"url":""}'
```

`|| pr_json=""` catches **every** non-zero exit, and the next line turns emptiness into `state: NONE`. A host that could not be asked and a host that answered *no PR* arrive at the refusal as the same word.

**`pr-state` exits 3 on a rate limit, not 5.** Measured on both backends with a stubbed CLI answering HTTP 403 / HTTP 429: GitHub `pr-state` exits **3**, Bitbucket `pr-state` exits **3** by branch and by number. Exit 5 is real but belongs to `pr-list` — `pr_list_failed` (`:528`) is the only place 5 and 6 are spent, while `pr-state`'s failures are classified by `host_miss_or_fail` (`:1560`). An earlier draft of this plan keyed its whole design on exits 5 and 4 reaching this caller; **they never do**, and the fix is smaller for it.

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

**Zero versus non-zero. That is the whole reading**, and it needs no exit-code table:

| what `pr-state` did | what approval should do |
|---|---|
| exit 0, a PR in the JSON | proceed as today |
| exit 0, `state: "NONE"` | genuinely absent — today's message, unchanged |
| **any non-zero** | **the host was not asked. Stop, print its stderr, prescribe nothing about the branch** |

**Exit 3 is the code the measured incident produced**, and it means *could not be asked* (`run-script.ts:197-199`); exit 4 means *structurally has no answer*. Both stop, and no doubt attaches to 4: a backend that cannot answer is not evidence of a missing PR either.

The stop is a **refusal, not a pass**: approving a plan whose PR state is unknown would flip the phase on an unread gate.

### The message carries the host's own words

`plot-host.sh` already prints the host's report to stderr — `plot-approve.sh:230` sends it to `/dev/null`. Keep it and print it: *"Bitbucket: HTTP 429 — rate limit for this resource has been exceeded"* tells the operator what to wait for, where *"no PR found"* sends them to fix the wrong thing.

### What this does NOT do

- It does not retry. A retry inside an approval turns one refused read into several, against a limit that is counting them. Waiting is the operator's call.
- It does not change `plot-host.sh`, whose exit codes are already right.
- It does not touch the other callers of `pr-state`. They may have the same bug; this plan fixes the one that was measured and names the rest as a question.

### Open questions

- [ ] **Which other callers collapse the exit code the same way?** Measured: **9 shell call sites**. `plot-pr-state.sh:33` collapses identically and its own comment blesses it; `plot-agent-monitor.sh:249` already reads the code correctly and is the worked example to follow. A sweep is its own slice.

## Done when

- A throttled `pr-state` stops the approval with the host's reason, and the word *"push"* does not appear in that message.
- A genuine absence keeps today's message exactly.
- Exit 4 stops with its own sentence rather than the absence one.
- A test per arm: **0-with-PR, 0-with-`NONE`, and non-zero (3)** — the code the incident produced. Exits 4 and 5 as extra non-zero cases, proving the one branch covers them rather than needing arms of their own. **A test keyed on 5 alone would pass against a mechanism that never fires.**
- **The phase is not flipped on any of the stop arms** — an approval that could not read the PR must not record one.

## Slices

### The approval reads why the host said nothing (Branch: bug/the-approval-reads-why-the-host-said-nothing)

- `bug/the-approval-reads-why-the-host-said-nothing` — `plot-approve.sh:230` captures the exit code and stderr rather than discarding both; exits 5 and 4 stop with the host's own reason and no push prescription; a genuine absence is unchanged; a stub-driven test for each of the four arms, and one asserting the phase is untouched on every stop

## Notes

- **Panelled 2026-09-25: `amend`, `Evidence: executed`.** The diagnosis and the incident are right; **the mechanism was not**. The juror stubbed both backends and measured `pr-state` exiting **3** on a rate limit, never 5 — exit 5 belongs to `pr-list` (`pr_list_failed`, `:528`), while `pr-state` is classified by `host_miss_or_fail` (`:1560`). An earlier draft keyed its whole design table on exits 5 and 4 reaching this caller. Re-verified independently before amending: `pr-state` under a rate-limited `gh` exits 3. The correction makes the fix **smaller** — zero versus non-zero, one branch. Verdict file: `.plot/panels/a-throttled-host-is-not-a-missing-pr/juror.md`.
- **This is the fault the estate keeps catching in its own tickets**: reading the documented exit code and assuming the op in question produces it. The same shape rejected `the-reaper-sees-the-desks-the-fleet-leaves` and corrected the first draft of `a-burst-keeps-the-states-that-answered`.

- Reported from a Bitbucket estate where `bb pr view 3636` answered `State: OPEN` while `bb pr list` answered 429 in the same minute. **The PR was readable the whole time** — only the listing was refused, which is why the by-number path disagreed with the by-branch one.
- **This is the same class as #970's real cause**, and worth reading beside it: a caller that cannot distinguish *could not ask* from *the answer is no*. #970's own fix shipped in v2.19.0 by giving the host arm a partial-answer exit; this is the caller side of the same discipline.

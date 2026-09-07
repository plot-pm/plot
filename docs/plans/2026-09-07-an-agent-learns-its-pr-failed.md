# An agent learns its PR failed

> An agent opens a PR, goes idle, and never learns CI refused it. Three PRs sat red this session while their agents slept in `sleep 60`, and a person read the failure each time.

## Status

- **State:** Draft
- **Type:** feature
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches

## Changelog

- An agent whose PR fails CI is told, so a red PR is work in progress rather than work abandoned.

## Motivation

**Measured 2026-09-07, three times.**

- **#775** failed `validate` on a test pinning the exact key the slice changed. Its agent had opened the PR, written its last commit, and gone idle. A person read the failure and fixed it.
- **#779** failed on a test in the same file it edited. Same shape.
- **#771** failed twice, on two different causes.

**In every case the worker was alive and idle** — `sleep 60`, no children, holding a branch whose PR was red. The agent had done what it was asked; nothing told it the answer came back no.

**THE MONITOR ALREADY ASKS THE HOST.** `plot-agent-monitor.sh` polls, and `sample_finding` reaches `gh pr list` on a desk that is clean and pushed — the exact state an agent is in after opening a PR. **The question is asked; the CI answer is not among the findings.**

**THE COST IS NOT THE FIX, IT IS THE DISCOVERY.** Every one was a small edit — a test assertion, a one-line revert. What it cost was a person noticing, and the fleet's whole claim is that it does not need one for this.

**AND THE WORKER BOUND DOES NOT CATCH IT.** An idle agent sits until `Worker bound` (8 h) or a person stops it. A red PR discovered eight hours later is a red PR nobody fixed.

## What this is not

**Not auto-fixing CI.** A failing test may be the code, the test, or the host — the agent decides that, as it does for any finding. This delivers the fact.

**Not a new poller.** The monitor exists, runs per agent, and already asks the host. A fourth finding beside the three it has.

**Not a gate.** Nothing refuses on a red PR. A finding an agent reads is the whole change.

## Slices

### The monitor reports a failed check (Branch: feature/an-agent-learns-its-pr-failed)

`sample_finding` gains a finding for a PR whose checks failed.

**IT RIDES THE PASS THAT ALREADY ASKS.** `sample_finding` returns at the `blocked`, `dirty` and `unpushed` arms before reaching the host, so the only pass that asks is one on a clean, pushed desk. **That is exactly the state an agent is in after opening a PR** — the finding needs no new poll.

**`pending` IS NOT `failed`.** A check still running is the normal state for the first fifteen minutes. Only a **concluded** failure is a finding, or every agent reports one the moment it pushes.

**IT NAMES THE JOB AND THE RUN.** *"CI failed"* sends the agent to look; *"validate failed — run 34116635093"* is a fact it can act on. The monitor's other findings name their subject and this must too.

**AN UNREACHABLE HOST REPORTS NOTHING.** `plot-pr-merged.sh`'s rule: silence answers *not merged*. Here silence answers *no finding*, never *failed*.

**Done when** an agent whose PR has a concluded failed check reads a finding naming the job and the run, a pending check produces none, an unreachable host produces none, and the finding travels the pass the monitor already takes.

## Notes

### Why the agent and not the board — 2026-09-07

The board could show a red PR, and a person would still have to route it to the agent that wrote it. **The agent is already holding the branch, already has the desk, and is already idle.** The shortest path from *CI said no* to *someone who can fix it* is the monitor that is already asking.

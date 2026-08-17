---
"plot": minor
---

The board's `Approve` button no longer needs a configuration key.

**Two controls on one surface asked different questions.** `Start work` called `plot-dispatch.sh`, a script Plot ships, and worked out of the box. `Approve` beside it called `sh -c '<Approve command> "<prompt>"'` and did not — it rendered dimmed on every card in this repo, naming a key nobody had set. The board reported it plainly: `"available": false, "reason": "no `Approve command` in this project's Plot Config"`.

**The justification did not survive the comparison.** `Worker command` is per-project because dispatch starts an agent that writes an *implementation* — genuinely unknowable to Plot. Approving under `Review: pr` merges a PR whose number the plan already records and writes a dated line into a known field. The real difference was never *approve needs an agent*; it was **approve had no script**, and the board reached for an agent because there was nothing else to reach for. `plot-approve.sh` now exists, so `approveAvailability()` asks exactly what `dispatchAvailability()` asks: is this a local, same-origin request.

**`Approve command` is demoted, not removed** — and the two entrances are not two implementations. A project that wants the full skill (the ceremony questions, the tracer-bullet heuristic, the `in-session` walkthrough) still declares one, and the board prefers it when present. The skill itself calls `plot-approve.sh`, so the seven mechanical steps go through one implementation either way:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

Without that, demoting rather than removing would leave two paths to one outcome, free to drift — the duplication this change exists to remove, reintroduced as a configuration option.

**Over a non-localhost binding the button stays disabled, and that is correct.** The binding is the authorisation, and a Tailscale address is deliberately not localhost. The phone that reads the board perfectly well does not approve from it: approving merges a PR and writes to the default branch, which is a different decision from reading a status away from the desk. `Start work` behaves identically for the same reason, and a future reader finding both disabled on a phone should find this paragraph rather than a bug.

**`ApproveButton` moves off the native `disabled` attribute to `aria-disabled`.** A natively disabled control leaves the tab order and takes its `title` explanation with it, out of reach of exactly the reader who cannot see that it is dimmed. `StartWorkButton` settled that in an earlier change; the two were built in parallel and this one did not see the decision. The refusal is now stated twice on purpose — the attribute is what assistive technology reads, and a guard in the click handler is what makes it true.

Also: the test harness now stubs `plot-approve.sh` alongside `plot-dispatch.sh`. It is what `/api/approve` spawns where no command is declared, and a real run merges a plan PR on the git host — a symlink to the real script would have put that one `git rev-parse` away from CI.

<!--
bumps:
  skills:
    plot: minor
-->

# The lifecycle runs on the other stack

> Three of the sprint's four conditions have a plan. **`unattended` has none** — and the reason is that every skill already implements it, while nothing runs the lifecycle unattended on Bitbucket, Jenkins and Jira together.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #783 merged

## Changelog

- An end-to-end test drives adoption through delivery on a Bitbucket + Jenkins + Jira sandbox with no person present, so the sprint's goal has a measurement rather than an intention.

## Motivation

**Measured 2026-09-07, mapping the sprint's four conditions to its plans:**

| condition | plan |
|---|---|
| **adopted** | `adoption-asks-about-the-stack` |
| **connected** | `the-build-pipeline-is-its-own-connector` |
| **legible** | `a-first-run-refusal-names-its-repair` |
| **unattended** | **none** |

**AND THE REASON IS NOT THAT IT IS UNIMPLEMENTED.** Every skill on the path handles `PLOT_UNATTENDED`: `plot-init` 5 mentions, `plot-idea` 5, `plot-approve` 5, `plot-deliver` 4, `plot-implement` 3, `plot-dispatch` 3, `plot-fleet` 2, `plot-board` 2. **The behaviour is written eight times over and never exercised as a path.**

**THE TWO HALVES ARE TESTED SEPARATELY AND NEVER TOGETHER.** `test/e2e/unattended-launch.test.mjs` proves the variable reaches a worker and that it *"does not convert a refusal into a pass"*. `test/e2e/lifecycle.test.mjs` mentions `Tracker: jira` — **in a config string, with zero `PLOT_TRACKER`, `bb` or `jen` calls.** Jira is named and never asked.

**SO NOTHING MEASURES THE SPRINT'S GOAL.** The goal is one sentence — *a teammate on Bitbucket, Jenkins and Jira runs Plot unattended from adoption to a delivered plan* — and the other three plans each fix a condition without anything proving the sentence.

**THE MACHINERY IS ALREADY BUILT.** `stubHost` gives an e2e sandbox a scripted host; seven fixture connectors exist including `host-fixture.ts` and `tracker-fixture.ts`; `makeSandbox` builds a repo with a `## Plot Config`. **This plan composes what is there rather than adding to it.**

## What this is not

**Not a real Bitbucket, Jenkins or Jira.** Those need accounts nobody has in CI. The sandbox declares the stack and stubs the connectors, which tests **Plot's behaviour on that configuration** — the thing this sprint changes — and not the vendors' APIs.

**Not a replacement for the walkthrough.** [`a-first-run-refusal-names-its-repair`](2026-09-07-a-first-run-refusal-names-its-repair.md) round 1 established that a protocol nobody runs is `docs/fleet-user-test.md`, written 24 days ago with zero results. **A test runs every time; a person reads what it cannot judge.** The release list keeps the human count.

**Not `test:e2e` growing without a bound.** It is CI's gate and already costly — measured 53 concurrent `node --test` processes at load 8.69. This adds **one** file, and says so.

## Slices

### The stack is a sandbox the lifecycle runs in (Branch: infra/the-lifecycle-runs-on-the-other-stack)

One e2e test drives `/plot-init` → `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` on a sandbox declaring Bitbucket, Jenkins and Jira, with `PLOT_UNATTENDED=1` and no answer available.

**IT ASSERTS THE PATH COMPLETES, AND THAT IS THE POINT.** Not that each step is correct in isolation — the reconcile suite has 1,393 tests for that. **That the steps compose without a person.**

**EVERY REFUSAL IT MEETS IS RECORDED, NOT SWALLOWED.** An unattended run that stops is a valid outcome — `PLOT-UNASKED` is the shape `/plot-init` already uses. **The test asserts which refusals happen and that each names a repair**, which is `a-first-run-refusal-names-its-repair`'s condition, measured rather than reviewed.

**IT MUST FAIL TODAY.** A test written against a stack Plot does not yet fully serve should be red on arrival — `runs()` reaches `gh` alone, adoption proposes no tracker. **A green test here on day one would mean it is not testing the goal**, and the slice states which assertions are expected to fail and which plan turns each green.

**ONE FILE, AND THE COST IS NAMED.** `test:e2e` is CI's gate and this adds to it. State the measured runtime in the PR.

**Done when** one e2e test runs the lifecycle unattended on a Bitbucket + Jenkins + Jira sandbox, every refusal it meets is asserted rather than tolerated, the assertions that fail on arrival are listed with the plan that turns each green, and its runtime is stated.

## Notes

### Why the missing condition was the one nobody wrote a plan for — 2026-09-07

The other three are absences: no tracker probe, no CI port, no repair in a message. **An absence suggests its own plan.**

`unattended` is different — it is implemented in eight skills and untested as a path. **A condition that is everywhere looks satisfied**, and the sprint's own goal sentence is the only place it is stated as one thing.

**That is also why it is the condition most likely to fail silently.** Each skill was written to handle no-person correctly; nothing has ever asked whether the eight compose.

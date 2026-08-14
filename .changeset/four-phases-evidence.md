---
"plot": minor
---

Name the four phases, and state evidence over assertion as a principle.

Plot's four phases have always been *states of a plan* — Draft, Approved, Delivered, Released. Cutting across them are four *activities*, each turning one durable artifact into the next: Discovery makes a story, Design makes a plan, Development makes merged branches, Endgame makes a verified release. Everything needed for all four already existed; what was missing was the map. Discovery is the one that predates Plot's own states, and it is optional — small, well-understood work goes straight to Design.

A fifth artifact runs alongside rather than between: the **session log**, recording how something was decided, including the alternatives that were rejected. The line against a plan is now written down: if it must be true *before* building starts it belongs in the plan; if it answers "why not the other way?" it belongs in a log. Plot does not write session logs — session-scoped tools do that better, because they can reconstruct compacted history and classify session types. The new `plot-context.sh` supplies them the plot-shaped facts instead (governing plan, phase, wave, PRs), and `/plot-init` offers a `## Session Wrap Up` section wiring the two together.

**Principle 12, "Evidence over assertion"**, states what Plot's gates already do: `/plot-deliver`'s landed check demands the scan's actual footer line rather than the word "verified", and sign-off stays human. The reasoning is specific to how agents fail — reading code and judging it uses the same mental model that wrote it, so only execution can contradict that model. Two consequences are spelled out: passing tests prove only what they test (a suite can be entirely green while the central mechanism is broken, if the untested case is the one the mechanism exists for), and verification wants a separate adversary, because checking your own work shares the blind spot that produced it.

`/plot-deliver`'s completeness check now acts on that. Its subagents are asked to **refute** each deliverable rather than confirm it, and to report what they *executed* versus what they only *read* — a behaviour claim confirmed by reading a PR body is not confirmed. This is the check that catches a changelog entry written at planning time describing intent nobody built.

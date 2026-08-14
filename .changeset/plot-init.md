---
"plot": minor
---

`/plot-init`: adopt Plot in a repository without writing the config by hand.

Adopting Plot has meant reading `## Plot Config` documentation and composing the section yourself — or, in practice, pasting a long prompt that hardcoded one organisation's parameters and went stale with every release.

`/plot-init` probes instead of interviewing. `plot-detect-repo.sh` reads what is already visible — git host from the remote, quality-gate scripts from `package.json`, a ticket scheme from commit subjects, the commit notation, which planning directories already exist, which hub doc is present — and the skill presents a complete proposal for the user to correct rather than compose. Exactly one thing is always asked: which of the candidate scripts actually gates a merge, because only a human knows that.

Detection is deliberately conservative, since a guess dressed up as a fact costs more than a wrong proposal. A ticket prefix must **recur** before it counts (one stray `ONEOFF-1` is not a scheme), and only recognisable gate names are offered as Definition-of-Done candidates — a repo's `deploy` script is not a quality gate.

Adoption is additive: nothing is moved, rewritten, or deleted. A repo with four overlapping planning systems keeps all four, and the skill offers to *describe* the boundary rather than migrate anything.

House rules are optional extensions, each gated on a detected signal — a Bitbucket repo is offered the `bb`-not-`gh` note, a GitHub repo never hears about it. And one blocked step never sinks the adoption: an unwritable `.claude/settings.json` costs slash-command convenience and nothing else, so the skill prints the block, asks, and continues.

`docs/sprints/` and `docs/stories/` are **not** created by default, and posture keys appear only where the answer is not the default — a new adopter should not start with directories and settings nobody chose.

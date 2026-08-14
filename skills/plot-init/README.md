# plot-init — developer notes

Adoption for a repo that does not have Plot yet. `SKILL.md` is the
agent-facing instruction; this file is why it looks the way it does.

## Where this came from

Adopting Plot used to mean pasting a long prompt into a fresh session — one
that hardcoded per-repo parameters, cited a reference repo to copy from, and
mixed generic Plot setup with one organisation's house rules (a specific git
host wrapper, reviewer agents, session logs, a four-phase process).

That works exactly once per organisation and rots on every Plot release. The
prompt behind this skill still named `plot 1.6.0` and required front-matter
keys the parser no longer reads.

The rewrite splits it along one line: **generic Plot setup is the skill; house
rules are optional extensions, offered only where the repo shows a signal for
them.** A Bitbucket repo gets the `bb`-not-`gh` note; a GitHub repo never
hears about it.

## Probe, don't interview

`plot-detect-repo.sh` answers what is visible: git host, quality-gate scripts,
ticket scheme, commit style, existing planning directories, hub docs, whether
a config already exists.

The skill then presents a **complete proposal** and asks only what the probe
could not read. Asking a user to confirm their own git host teaches them the
tool is not paying attention — and that is how a five-question adoption turns
into a twenty-question interrogation nobody finishes.

Exactly one thing is always asked: the **Definition of Done**. The probe finds
candidate scripts; only a human knows which of them gates a merge.

## Deliberately conservative detection

Every field is a proposal, so a wrong guess costs one correction — but a guess
dressed up as a fact costs trust. Two rules follow:

- **A ticket prefix must recur.** One stray `ONEOFF-1` in a subject line is
  not a scheme. Without the recurrence check the probe proposes a ticket
  scheme to a repo that has none, and the user has to notice and undo it.
  (Caught by sabotaging the detector: the first version of the test missed it.)
- **Only recognisable gate names count as DoD candidates.** A repo's `deploy`
  or `start` script is not a quality gate; offering it as one undermines the
  whole proposal.

Where a signal is ambiguous the field is empty and the skill asks.

## Additive, always

Adoption never moves, rewrites, or deletes anything. A repo with four
overlapping planning systems keeps all four — the skill offers to *describe*
the boundary in a `docs/plans/README.md`, and the human decides what is
canonical.

This is not politeness. Migrating someone's plans destroys both their history
and their own organisation of it, and no probe can tell which of four
directories is the one they still rely on.

## Degrade, never abort

The steps are largely independent, so one blocked file must not sink the rest.
The sharpest case is `.claude/settings.json`: if it is missing, create it; if
it exists, merge and preserve every key; if it is malformed or unwritable,
**print the block, ask, and continue.**

A blocked settings file costs slash-command convenience and nothing else —
the entire lifecycle works with plain git. Aborting the adoption over the
least important step would be the worst possible trade.

## What is NOT created by default

`docs/sprints/` and `docs/stories/`. Both are optional lenses, and an adopting
repo should not start with empty directories nobody asked for. Same reasoning
for posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`): they
appear only when the answer is not the default, so a new adopter is not
handed a wall of settings they never chose.

## Tests

`test/reconcile/init.test.mjs` builds throwaway repos of each shape — GitHub
and Bitbucket remotes, scripts with and without gates, commits with and
without ticket keys, three commit notations, pre-existing planning systems,
both hub docs, an already-configured repo, and a bare repo with nothing in it.

Two properties matter most and are asserted directly: the probe is
**read-only** (a probe that edits the repo it is inspecting is unusable as the
first thing a stranger runs), and it **survives an empty repo** without
crashing.

## Known gaps

- The language hint is weak — a keyword count over the hub doc. It only nudges
  template wording, so a wrong guess is cheap.
- No detection for monorepo layouts; a workspace root and a package both look
  like ordinary repos.
- The skill writes the config but does not verify the DoD commands actually
  run. Confirming that is the adopter's first real use of the workflow.

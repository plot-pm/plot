---
title: Setup asks what the repo already knows
author: jwloka
status: archived
created: 2026-08-26
updated: 2026-09-04
---

# Setup asks what the repo already knows

## Objective

A user runs `/plot-board-setup` in a repo with a Bitbucket remote, a Jenkinsfile
at the root, and Jira keys in every commit message. It asks them which git host,
which tracker, which CI.

Then it records `Tracker: jira` — and nothing reads that key. The board looks
configured and behaves unconfigured, so the user's reasonable conclusion is that
**they set it up wrong**.

## Why Now

The sprint `the-board-serves-an-enterprise-stack` builds the backends those keys
should reach. A backend nobody can configure is a backend nobody uses, so the
setup skill is not polish that follows the origins — it is the same feature seen
from the other end.

Sibling of [[the-board-is-blank-where-it-matters]]: that story is about what the
board SHOWS an enterprise team, this one about what it ASKS them. They share a
sprint and a population, and they fail differently — one renders an untrue
blank, the other accepts an answer it ignores.

## Decisions Taken in Scoping

**Q: Is the problem that setup asks too much?**
Only half. The sharper failure is that it asks, is answered, and does nothing
with the answer. `plot-config.sh` documents `Tracker: jira`; grepping for a
consumer returns nothing. A wizard that is slow annoys; a wizard that accepts
configuration into a void misleads.

**Q: Does the skill already ask well?**
Yes, and that is worth keeping. It carries explicit `PLOT-UNASKED` lines for the
unattended case — *"which Jenkins instance — refused — no Jenkins instance key
written; jen auth unverified"* — so it refuses rather than guessing. The gap is
inference, not manners.

**Q: How much can actually be inferred?**
`plot-detect-repo.sh` already derives `git_host` from the origin URL, and
`plot-board-probe.sh` already reports `ci_signals.jenkinsfile` and whether `jen`
and `bb` are installed and authenticated. The signals exist and are read; they
are simply not turned into proposals. This is closer to wiring than to research.

**Q: Should it infer silently?**
No. Every inferred value is a proposal a human confirms — the rule
`plot-detect-repo.sh` already states about its own output: *"every field is a
proposal a human confirms."* Inferring and asking are not alternatives; the
inference is what makes the question answerable in one keystroke instead of
three.

## Current Plan

### Phase 1: Name the failure as configuration-into-a-void ✅

- ✅ Confirm `Tracker: jira` has no consumer
- ✅ Confirm the probe already reports host, Jenkinsfile and CLI auth
- ✅ Sprint membership as a Must, not a Should

### Phase 2: Plan ⏸️

- ⏸️ One plan: infer from the signals that exist, propose rather than assert,
  ask only what the probe cannot settle, and write every answer to `## Plot Config`

## Open Points

- ⏸️ **What should setup do about a key whose backend does not exist yet?** During
  this sprint `Tracker: jira` will be writable before it is readable. Refusing to
  write it blocks the very configuration the backends need; writing it silently
  recreates today's failure. A warning naming the gap is the obvious answer and
  has not been argued.
- ⏸️ Is a Jira key in commit messages a safe inference, or a coincidence? Never
  measured on a real repo.

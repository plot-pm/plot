---
title: Setup asks what the repo already knows
author: jwloka
status: active
created: 2026-08-26
updated: 2026-09-08
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

- ✅ `Tracker: jira` gained a consumer — the tracker port has two connectors, and a repository declaring none answers `unaskable` rather than succeeding silently
- ✅ `/plot-init` states the proposal rule in full: one signal proposes, two signals ask, and an absent signal writes no key and says so
- ⏸️ **The `CI:` half is inert.** `plot-detect-repo.sh` emits no `ci_system`, so the proposal reads a field that does not exist. Re-opened 2026-09-08; `the-probe-reads-the-ci-system` is the plan.
- ⏸️ **The proposal rule is prose.** *One signal proposes, two signals ask* lives in skill step 2, where an agent can rationalise around it and no test can assert it.

### Why this was re-opened — 2026-09-08

**It was closed on 2026-09-04 with Phase 2 unstarted**, and the tracker half has since shipped. The CI half has not, and it failed in the way this story exists to describe: **the configuration looks done and behaves undone.**

`/plot-init` documents which word each CI signal proposes and what evidence to print. `plot-detect-repo.sh` returns ten fields and none of them is `ci_system`, so the branch is dead code written as prose. The skill's own README records it at `README.md:206`; the slice that was to fix it, PR #811, merged carrying **zero files**.

**That is this story's failure mode aimed at itself.** A user on a Jenkins team runs adoption, is never asked about CI, and concludes their repository has none — the same reasonable-but-wrong inference the objective describes.

**A second open point surfaced while re-reading it.** Seven thresholds decide what the probes report — `node >= 20`, three commit-style counts, the ticket-prefix floor, the German-language count — and each sits inside a collector whose header says it decides nothing. `a-probe-reports-and-the-domain-judges` is the plan; [[plot-gates]] is where the rule-versus-gate argument lives.

## Open Points

- ⏸️ **What should setup do about a key whose backend does not exist yet?** During
  this sprint `Tracker: jira` will be writable before it is readable. Refusing to
  write it blocks the very configuration the backends need; writing it silently
  recreates today's failure. A warning naming the gap is the obvious answer and
  has not been argued.
- ⏸️ Is a Jira key in commit messages a safe inference, or a coincidence? Never
  measured on a real repo.

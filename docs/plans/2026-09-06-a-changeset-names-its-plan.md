# A changeset names its plan

> `/plot-release` cross-checks changesets against plans because nothing links them. Measured 2026-09-06: **0 of 14** changesets on this estate name a plan — worse than the `1 of 42` `DESIGN-release.md` recorded — so every release reconciles by hand what a line in the file would have joined.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A changeset names the plan it came from, so the release cross-check reads a link instead of matching prose.

<!-- Board impact: none directly. A changeset carrying its plan is a join the
     board could render later; this plan does not render it. -->

## Motivation

**The cross-check exists to reconcile what a link would have joined.** `DESIGN-release.md` says so, and `/plot-release` step 3 is that cross-check.

**Measured 2026-09-06: 0 of 14.** The doc recorded `1 of 42` when it was written; the estate's current changesets name a plan **zero** times. The convention did not take, and nothing asked it to.

**THE COST IS PAID EVERY RELEASE, AND THE PROSE IS WHY.** Reconciling which changeset belongs to which plan is a semantic match over descriptions — the exact judgement the release skill runs at Frontier tier — re-derived from scratch each time.

**The descriptions are substantial, and that is the cost rather than the mitigation.** #706's changeset is two paragraphs naming `pr_merged`, `rules/landed.ts`, `plot-landed.mjs` and `mayRemove`. The match succeeds *because* the prose is rich; it is expensive for the same reason. Fourteen of those, read end to end, every release.

**A `plan:` line turns a judgement into a lookup.** Not a more accurate answer — the semantic match gets it right — but one a script can make, where today only a Frontier-tier model can.

**AND ONE OF THE TWO OPEN POINTS BESIDE IT IS ALREADY ANSWERED.** `DESIGN-release.md` asks whether `version` should be normalized at the parser, citing `70 lines say v2.5.0 and 40 say 2.9.0`. `entities/version.ts:25` exports `normalizeVersion` with **10 production callers**, and its own docstring carries that measurement. That point is closed; this plan records it rather than re-planning it.

## What this is not

**Not a changeset-format change.** Changesets owns the frontmatter — package name and bump level — and this adds nothing to it. The plan reference goes in the body or a comment, the way `bumps:` already does.

**Not a gate on day one.** `check-changeset-packages.sh` already refuses an unknown package and a description under 20 characters. A third refusal, applied to a convention nobody follows yet, would fail every changeset in flight.

**Not a migration.** The 14 existing changesets are release notes in transit; they ship within days. Rewriting them buys nothing that waiting does not.

## Slices

### A changeset can name its plan (Branch: feature/a-changeset-carries-a-plan)

The changeset template and `/plot-idea`'s guidance carry a plan reference, and the cross-check reads it when present.

**IT IS OPTIONAL AND THE CROSS-CHECK STAYS.** A changeset written by hand, or by a contributor with no plan, must still be valid. The link is a fast path: present, it answers directly; absent, the existing semantic match runs as it does today.

**THE FORM FOLLOWS `bumps:`.** That block is already an HTML comment in the body, already parsed by this repo's tooling, and already documented in CLAUDE.md — including the ordering rule that a comment written first becomes the published description. A `plan:` line joins it there rather than inventing a second convention.

**Done when** a changeset can name a plan, the cross-check uses it when present, and a changeset without one is still valid.

### The convention is measured before it is enforced (Branch: infra/a-changeset-link-is-counted)

`check-changeset-packages.sh` reports how many changesets name a plan, and refuses none.

**COUNT FIRST, GATE LATER, AND THIS REPO HAS THE PRECEDENT.** `the-sprint-proves-its-own-goal` added a CI ratchet that counts and fails when a number *grows*; the same shape here counts the changesets missing a link. Enforcing a convention with 0 of 14 adoption would refuse every changeset in flight.

**AND A COUNT IS ONLY WORTH PRINTING IF IT LEADS SOMEWHERE.** A finding must be actionable the day it fires; a bare `0 of 14` is not. So the check reports the count **and names the changesets missing a link**, which is what a person acts on — and the number is the ratchet's input once adoption is non-zero.

**Done when** the check reports the count, names the changesets without a link, exits 0 whatever it is, and the number is visible in CI output.

## Notes

### The third open point is left open — 2026-09-06

*"Should an RC be the same entity?"* Two `rc` tags exist. The doc says it *"has a tag, a checklist and a gate that behaves differently — arguably `channel` is enough, arguably it is its own"*, and nothing measured here separates the two readings. It needs a release that actually uses one, which this estate has not had since the question was written.

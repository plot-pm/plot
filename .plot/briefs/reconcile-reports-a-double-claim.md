## Implementation brief — a-citation-is-not-a-claim (wave: Counted)

- **Plan (canonical):** `docs/plans/2026-08-23-a-citation-is-not-a-claim.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/reconcile-reports-a-double-claim` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 2 of 2.** `Anchored` shipped as **#490** — the parser now reads a claim
as a list item that STARTS with a branch, so a citation in prose, a blockquote
or an HTML comment is no longer a claim.

### What to build

A new section in `plot-reconcile-scan.sh` reporting any branch claimed by **more
than one plan**, naming both plans and their waves, with a machine-countable
footer entry.

### The decisions the plan settles — do not re-derive them

**It REPORTS and never gates.** `attention=` is what gates, and this section must
not change it — a double claim is a shape for a person to resolve, not a reason
to stop the fleet. There is a listed assertion for exactly this, against a
fixture that HAS a double claim.

**Wave 1 is the reason this is now meaningful.** Before #490 the matcher read any
backticked branch name anywhere on a line, so half the "double claims" would have
been citations — a plan mentioning another plan's branch. Building this first
would have produced a section full of false positives. That ordering was the
point of the two waves.

**Expect the section to report NOTHING on this estate.** The plan says so: it
must report nothing "for the estate as it stands after the citations were
reworded." An empty section is the correct result here, and the test therefore
needs its own fixture rather than the live estate.

**Follow section 3's shape.** `plot-reconcile-scan.sh` already has seven sections
and a machine-countable footer; this is an eighth in the same form. Read how
section 3 classifies and counts before inventing a format — the footer is parsed
by other tools, and a new key must follow the existing convention.

### Done when

From the plan's `## Done when`:

- **`plot-reconcile-scan.sh` reports a branch listed by two plans**, naming both
  and their waves, with a footer count.
- **It reports nothing for the current estate.** Both halves matter: a section
  that reports something here is matching citations again, which is the defect
  wave 1 removed.
- **`attention=` is unchanged by the new section.** Asserted directly against a
  fixture that has a double claim — the assertion a naive implementation passes
  without, because adding a finding to `attention=` looks like diligence and
  turns a report into a gate.

Plus: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` green; a
changeset with a `bumps:` block naming `plot`; Node 24 (`nvm use`,
`corepack pnpm`); `trash` not `rm`.

Run `test:e2e` with `env -u PLOT_UNATTENDED` — that variable in the ambient
environment trips a control test.

**Do not run `pnpm run test:board`** (operator rule); this branch does not need it.

**Known-flaky, not yours:** `test/reconcile/dispatch.test.mjs` fails ~5 tests
with `ETIMEDOUT` under parallel load, identically on main, and passes 71/71 run
alone. Baseline before believing a failure there.

### Bookkeeping

Annotate this branch inside its **wave heading** on main:
`(Branch: x, PR: #N)` INSIDE the heading — this plan uses the Waves dialect and
a trailing `→ #N` parses as `prs=[]`.

### Scope guard

This branch owns the new section in `skills/plot/scripts/plot-reconcile-scan.sh`
and its tests. The matcher itself was wave 1 — do not touch `plot-plan-meta.sh`.

## Implementation brief — a-changeset-link-is-counted (slice: The convention is measured before it is enforced)

- **Plan (canonical):** `docs/plans/2026-09-06-a-changeset-names-its-plan.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `infra/a-changeset-link-is-counted` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of two. Slice 1 merged as **#731** — a changeset can now name its plan.

## What to build

`scripts/check-changeset-packages.sh` **reports how many changesets name a plan, and refuses none.**

## COUNT FIRST, GATE LATER

**Enforcing a convention with near-zero adoption would refuse every changeset in flight.** Measured 2026-09-06, before slice 1 landed: **0 of 14** named a plan.

**`the-sprint-proves-its-own-goal` is the precedent** — a CI ratchet that counts and fails when a number *grows*. Same shape here, one direction later.

## A COUNT IS ONLY WORTH PRINTING IF IT LEADS SOMEWHERE

**A bare `0 of 14` is not actionable**, and a finding must be actionable the day it fires.

**So the check names the changesets missing a link.** That is what a person acts on, and it is the ratchet's input once adoption is non-zero.

## READ THE RULE, DO NOT RE-IMPLEMENT IT

**`rules/changeset.ts` already exports** `parseChangeset`, `publishedDescription`, `checkChangeset` and `MIN_DESCRIPTION`.

**`check-changeset-packages.sh` calls none of them** — it runs inline JavaScript from a quoted heredoc (`:62`) and re-implements the same checks. **Two implementations of *is this changeset valid*, and the CI one is what gates.**

**This slice must not add a third.** Where the gate needs the count, it asks the domain — the layering `plot-approve.sh` already uses through `plot-transition.mjs`.

## The order rule still applies

CLAUDE.md is explicit: Changesets publishes the **first line after the frontmatter**. Measured: **19 of 169 published entries — 11%** — printed a bare comment-open marker as their whole description, and this script already refuses that. **A count that reads a `plan:` line must not change which line publishes.**

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **and the domain's own `tsc`**, plus `./scripts/check-changeset-packages.sh` on this estate.

**The check must exit 0 whatever the count is.** A test with a linked and an unlinked changeset proves the count and the exit code separately.

## Done when

- the check reports how many changesets name a plan and names the ones that do not
- it exits 0 whatever the count
- the count comes through `rules/changeset.ts`, not a third implementation
- the published-description rule is unchanged
- the gates above pass

## Do not

- **Do not refuse a changeset without a link.** Count first, gate later.
- **Do not add a third implementation of the validation.** The rule exists.
- **Do not change which line publishes.** 19 of 169 is what that costs.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

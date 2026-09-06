## Implementation brief — a-changeset-carries-a-plan (slice: A changeset can name its plan)

- **Plan (canonical):** `docs/plans/2026-09-06-a-changeset-names-its-plan.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/a-changeset-carries-a-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two. Two rounds.

## The measurement

**0 of 14 changesets name a plan.** Measured 2026-09-06 — worse than the `1 of 42` `DESIGN-release.md` recorded when the question was raised.

**The cost is paid every release, and the rich prose is why.** #706's changeset is two paragraphs naming `pr_merged`, `rules/landed.ts`, `plot-landed.mjs` and `mayRemove`. `/plot-release` step 3 cross-checks changesets against plans by **semantic match over those descriptions** — at Frontier tier, re-derived from scratch, fourteen of them.

**A `plan:` line buys mechanisability, not accuracy.** The match gets it right; a link makes it a lookup a script can do.

## THE RULE EXISTS AND THE GATE DOES NOT USE IT

**`rules/changeset.ts` already exports** `parseChangeset`, `publishedDescription`, `checkChangeset` and `MIN_DESCRIPTION` — the whole validation.

**`scripts/check-changeset-packages.sh` calls none of it.** It runs inline JavaScript from a quoted heredoc (`:62`) and re-implements the same checks. **Two implementations of *is this changeset valid*, and the CI one is what actually gates.**

**So this slice inherits a duplication it did not create, and must not widen it.** The link check goes in the **rule**; the gate reads the rule. That is the layering `plot-approve.sh` already uses through `plot-transition.mjs`.

## Where the field lands

**`ChangesetParts` holds `packages` and `body` and nothing else** — the `bumps:` block CLAUDE.md documents is not parsed either.

**A `plan:` reference and `bumps:` are the same kind of thing**: a structured comment in the body. The parser should learn both or neither.

**THE ORDER RULE IS NOT NEGOTIABLE.** CLAUDE.md is explicit: Changesets publishes the **first line after the frontmatter**, so a comment block written first becomes the release note. Measured: **19 of 169 published entries — 11%** — printed a bare comment-open marker as their whole description. `check-changeset-packages.sh` already refuses that. **A `plan:` line placed first would reintroduce it.**

## Optional, and the cross-check stays

A changeset written by hand, or by a contributor with no plan, must still be valid. **The link is a fast path**: present, it answers directly; absent, the existing semantic match runs as it does today.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `./scripts/check-changeset-packages.sh`.

**A changeset with a `plan:` line must still publish its description**, not the comment — that is the 11% failure, asserted.

## Done when

- a changeset can name a plan in its body
- the cross-check uses it when present and falls back when absent
- a changeset without one is still valid
- a `plan:` line never becomes the published description
- the check reads `rules/changeset.ts` rather than re-implementing it
- the gates above pass

## Do not

- **Do not put the link in the frontmatter.** Changesets owns that: package name and bump level, nothing else.
- **Do not place it before the description.** 19 of 169 published entries is what that costs.
- **Do not add a third implementation of the validation.** The rule exists; the gate should read it.
- **Do not make it required.** 0 of 14 adoption means a gate would refuse every changeset in flight — that is slice 2, and it counts rather than refuses.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.

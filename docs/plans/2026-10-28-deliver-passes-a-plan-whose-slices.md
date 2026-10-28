# Deliver passes a plan whose slices in other repositories are written in a shape the parser does not read

> A plan can read as complete while it names work in other repositories that Plot never checked; slice lines outside the backtick shape must be reported and must stop delivery.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2826
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-deliver` refuses a plan that names branches the parser could not read, and the reconcile scan lists them.

Board impact: `plot-plan-meta.sh` gains one output field; the board reads `unread_*` fields from the same JSON, so it needs a decision on whether to show it.

## Motivation

Plan `ewzkus-3853-build-identitaet` (ewz-kus-portal) had one slice line Plot reads and seven it did not: lines such as `- **ewz-kus-contracts** (dort eigener Branch infra/EWZKUS-3853-monotonie-waechter) — …`. The plan stated that every slice in a foreign repository needs its own branch and PR. None existed, and the `vnull` tag was still present.

- `plot-reconcile-scan.sh` listed the plan under *Merged-but-not-delivered*.
- `plot-deliver.sh --dry-run` reported `verified 1 branch(es) merged` and would deliver.
- Nothing in Plot mentioned the six other repositories.

Only a person reading the plan noticed. The plan was delivered anyway, by decision, with a note. Section 24b of the reconcile scan catches a similar shape (heading-shape list items) for branches in this repository only.

## Design

### Approach

1. `plot-plan-meta.sh` reports slice list items that name a branch but are not in the backtick shape (`(dort eigener Branch X)`, `**repo** … Branch X`) as `unread_branch_items`, beside the existing `unread_branch_headings`, `unread_waits` and `unread_heading_items`.
2. `plot-reconcile-scan.sh` lists them in a new section next to 24b.
3. `/plot-deliver` step 4b ("all plan branches accounted for") refuses or asks while any are present.
4. The plan template and `/plot-idea` document a written form for a slice in another repository (`owner/repo@branch` or `→ owner/repo#N`, which `plot-impl-status.sh` already resolves), so authors have a shape the parser reads.

Whether delivery refuses or asks is an open question below. The deliver decision belongs in the domain, per the layering rule; the shell side is a declared duplicate only if it must be.

### Open Questions

- [ ] Does `/plot-deliver` refuse outright, or ask the person (unattended: refuse)?
- [ ] Which shapes count as "names a branch" without false positives on prose that mentions a branch in passing?
- [ ] Does the board show `unread_branch_items` on the plan row?

## Slices

### Parser and scan

- `bug/deliver-reads-unread-branch-items` — report `unread_branch_items` in `plot-plan-meta.sh` and list them in the reconcile scan

### Deliver and authoring

- `bug/deliver-refuses-unread-branch-items` — step 4b covers unread items; template and `/plot-idea` document the foreign-repository form

## Notes

Source: https://github.com/plot-pm/plot/issues/2826. Created unattended; the design question was not answered in the prompt, so the plan starts in Draft.

# The board answers where the browser asks

> Two defects a user meets before reading anything: a board that refuses the connection while its process is healthy, and one plan rendered as two cards.

## Status

- **State:** Delivered
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-11, jwloka, in-session
- **Started:** 2026-09-12, jwloka, `bug/the-board-answers-on-both-loopback-families`
- **Started:** 2026-09-12, Jan Wloka, `bug/one-plan-is-one-card`
- **Delivered:** 2026-09-12

## Changelog

- The board binds every local address family, so a browser resolving `localhost` to the other one reaches it rather than reporting a refused connection.
- A plan whose own idea branch is checked out renders as one card. The working-tree source and the branch source now agree on which paths each has already supplied.

<!-- Board impact: both slices are the board. Rebuild the artifact. -->

## Motivation

**Both survived the sweep of 2026-09-11, and both are defects rather than open questions.** Of the story's 33 points, 24 are resolved and 9 remain; 7 of those 9 are costs or design questions that a person decides. These two are the ones a user hits.

**The connection refusal was never touched.** `index.ts:49` reads `const HOST = process.env.HOST ?? 'localhost'`, and `git log -S"HOST = process.env.HOST"` returns exactly one commit — `c0cbbc764`, the commit that scaffolded the package. Observed 2026-08-17: the board sat at `ERR_CONNECTION_REFUSED` in the browser while the process was running and healthy, because the server bound one address family and the browser resolved `localhost` to the other.

**The duplicate card survived the refactor of the very code it describes.** PR #469 re-based the board on refs rather than the checkout, which changed the working-tree walk from primary to additive — and did not add a cross-source check. `board.ts:1750` marks ref-absent plans into `localOnlyPaths`; `board.ts:1802` stages `collectBranchPlans(...)`; **`localOnlyPaths` is never consulted at the staging site.** The only exclusion is inside `readBranchPlans` at `:786`, and it compares against `origin/<default>` and other branch plans, neither of which contains a local-only path. So a plan that is in the working tree, pushed to its idea branch, and absent from main enters twice and reaches `readPlanMeta` as two cards.

**The tests avoid the case deliberately.** `discovery.test.mjs:113` and `:126` each check out main and then `rmSync` the working-tree copy, with the comment *"Remove the working-tree copies the branch checkout left behind, so the filesystem walk genuinely cannot see this plan."* The `produces no duplicate cards` test at `:198` covers branch-versus-branch only.

## Design

### Approach

Two slices, independent of each other.

**The address family** is one decision: bind the wildcard rather than a name, so both families reach the server. The name is what introduces the ambiguity — `localhost` resolves differently per machine and per Node version, and the failure is invisible because the process is healthy.

**The duplicate** is one join: the staging site must exclude a path already supplied as a local source, the way `readBranchPlans` already excludes one supplied by the default branch. The rule exists; it is applied against two of the three sources.

### The wildcard must not widen the write surface

`index.ts:141` already carries the warning: `HOST=0.0.0.0` **published every write endpoint**, and the comment says the value was read and never checked. So this slice cannot simply change the default.

The board's write endpoints are same-origin gated, and the gate reads the bound address. Binding both loopback families is not the same act as binding every interface — the first reaches a browser on this machine, the second reaches the network. **The slice binds loopback, dual-stack**, and the `0.0.0.0` path keeps whatever check it has.

### The duplicate is fixed at the staging site, not in the walk

Both sources are legitimate. A plan may exist only in the working tree, and a plan may exist only on a branch; neither reading is wrong, and removing either would make a real plan invisible.

**What is missing is that the second reader does not know what the first supplied.** So the fix passes `localOnlyPaths` to the staging site and skips a path already present — one argument, at the site that already performs exactly this exclusion for the default branch.

### The test must assert the case the suite removes

`discovery.test.mjs` deletes the working-tree copy on purpose, so the regression cannot be caught by the existing fixtures. A new case keeps the copy: check out the idea branch, push it, leave the file, and assert one card.

### Open Questions

- [ ] Does dual-stack loopback need a config key, or is it simply correct? Leaning correct — nobody chose single-family binding; it fell out of a default.
- [ ] Does the duplicate also occur for sprints? `collectSprints` reads the same two sources. Unmeasured, and worth one check before implementing.

## Slices

### The board answers on both families (Branch: bug/the-board-answers-on-both-loopback-families, PR: #894)

Bind loopback dual-stack rather than a name. `index.ts:49` reads `HOST = process.env.HOST ?? 'localhost'`, and `git log -S"HOST = process.env.HOST"` returns exactly one commit — `c0cbbc764`, the scaffold. Node resolves that name to one family, so a browser reaching for the other finds nothing while the process is healthy.

**Measured on the operator's own board, 2026-09-11**, while this plan was being written: `lsof` reported `TCP [::1]:7777 (LISTEN)` and the page reported no contact for 18 polls. The defect this slice fixes interrupted the session that planned it.

**It must not widen the write surface.** `index.ts:141` records that `HOST=0.0.0.0` published every write endpoint, and that the value was read and never checked. Binding both loopback families reaches a browser on this machine; binding every interface reaches the network. This slice does the first, and the `0.0.0.0` path keeps whatever check it has. The same-origin allowlist reads the bound address, so its reading moves with the bind.

### One plan is one card (Branch: bug/one-plan-is-one-card, PR: #895)

Pass `localOnlyPaths` to the staging site so the branch reader skips a path the working-tree reader already supplied.

`board.ts:1750` marks ref-absent plans into `localOnlyPaths`; `board.ts:1802` stages `collectBranchPlans(...)`; the set is never consulted there. The only exclusion lives in `readBranchPlans` at `:786` and compares against `origin/<default>` and other branch plans — neither contains a local-only path. So a plan in the working tree, pushed to its idea branch and absent from main, reaches `readPlanMeta` twice.

**Both sources stay legitimate.** A plan may exist only in the working tree, and a plan may exist only on a branch; removing either reading makes a real plan invisible. What is missing is that the second reader does not know what the first supplied.

**The fixture must keep the copy the suite deletes.** `discovery.test.mjs:113` and `:126` each check out main and then `rmSync` the working-tree copy — *"so the filesystem walk genuinely cannot see this plan"* — and `produces no duplicate cards` at `:198` covers branch-versus-branch only. A new case leaves the file in place and asserts one card. Use `rmTree`, not a raw recursive `fs.rmSync`: CI counts those and the allowance is 1.

## Notes

These two close the defect half of `plot-board`'s open points. What remains after them is a design question and five costs, which is the tail a story is allowed to carry.

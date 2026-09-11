# The board answers where the browser asks

> Two defects a user meets before reading anything: a board that refuses the connection while its process is healthy, and one plan rendered as two cards.

## Status

- **State:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-11, jwloka, in-session

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

- `bug/the-board-answers-on-both-loopback-families` — the bind, and the same-origin gate's reading of it
- `bug/one-plan-is-one-card` — `localOnlyPaths` reaches the staging site, plus the fixture that keeps the working-tree copy

## Notes

These two close the defect half of `plot-board`'s open points. What remains after them is a design question and five costs, which is the tail a story is allowed to carry.

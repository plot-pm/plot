## Implementation brief — the-domain-runs-the-workflows-in-a-sandbox (slice 5: Writing)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md` on `main`
- **Branch:** `feature/a-decision-writes-what-the-script-writes` (base: `main`)
- **Ends as:** one PR to `main`

**Last, and genuinely so.** It applies the `Decision` that Deciding and
Dispatching produce, so both must land first.

### What to build

The sandbox test tier: the domain's `Decision` applied in a temp git repo,
compared against what `plot-approve.sh` and `plot-deliver.sh` produce.

### The decisions the plan settles — do not re-derive them

**The bar is PARSER EQUIVALENCE, not byte equality.** This reverses an earlier
position in the plan, so take the current wording: both outputs go through
`plot-plan-meta.sh` and every field must match.

The concern is unchanged — a transition writing `2026-8-29` where production
writes `2026-08-29` breaks the parser — and parser equivalence catches exactly
that, because the parser is what the difference would break. What it tolerates
is formatting: a trailing newline, a blank line between records, the order of
two independent Status fields. Those are invisible to every consumer, and
gating on them guarantees failures whose fix is re-aligning whitespace.

**The parser is the right oracle because it is the consumer.** Every component
reading a plan reads it through `plot-plan-meta.sh`. The bytes are an encoding;
the parsed fields are the meaning.

**Accepted cost, stated:** a difference the parser ignores today becomes
visible if the parser later reads it.

**The mutation is not optional.** Assert that a deliberately corrupted date
(`2026-8-29` for `2026-08-29`) makes the comparison FAIL. Without it the
assertion is unproven — two parses that both silently returned nothing would
pass, and you would have shipped a test that can never go red.

**The filesystem proves the `Decision` named every write.** Run the script in
the temp repo, take `git status --porcelain` plus an untracked-file listing
before and after, and assert every changed path appears in the `Decision`.
**The filesystem enumerates the writes, not a person** — the failure mode is a
write the author forgot, and an author who forgot it while writing forgets it
again while reviewing. An extra path in the `Decision` that the script never
writes fails too: over-claiming stops the `Decision` describing what happens.

**`plot-approve.sh` and `plot-deliver.sh` are idempotent and already have e2e
coverage** in `test/e2e/lifecycle.test.mjs` — reuse those sandboxes rather than
building new ones.

### Done when

Plan's Writing `Done when`: approve and deliver parse identically by both paths
including transition records, phase and sprint annotation; every filesystem
change named by the `Decision` with no unnamed path; and the corrupted-date
mutation makes the comparison fail.

Repo gates: `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`),
`pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

### The sprint's goal changed on 2026-08-30 — three conditions, not one

**Every existing function replaced by a domain CONCEPT, with full unit and mock
coverage, and production calling it.** Two bear on this slice.

**Coverage is 100% and the threshold applies to you.**
`packages/domain/vitest.config.ts` excludes `src/adapters/**` only; pure
`readings → Decision | Refusal` code is not an adapter, so every branch is
reachable from a plain call. **A refusal you cannot trigger in a test is a
refusal you have not expressed.** Where one needs a port to fail, mock the port
— that is what unit AND mock means here.

**Express concepts, do not relocate functions.** `board.ts` still carries a
`TEMPORARY ALIAS` exporting `allSlicesMerged as allWavesMerged` — that is what
relocation looks like when the vocabulary did not follow: it compiles, it
passes, and the defect survives. A **Slice** holds one branch and belongs to one
plan; a **Wave** is the fleet's cross-plan cohort. Do not add a second alias.

### Scope guard

Owns the sandbox tier. **Nothing here writes outside a temp repo** — that is
the plan's whole premise, and this is the slice with the means to break it.

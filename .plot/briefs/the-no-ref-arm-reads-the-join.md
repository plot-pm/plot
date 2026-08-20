# Brief: bug/the-no-ref-arm-reads-the-join

Implement the single branch of
`docs/plans/2026-08-20-the-no-ref-arm-asks-once-too.md`. Read it first — its
measurements are the specification.

## The change is smaller than the plan implies, and the code says why

`host_pr_state` **already** answers three ways. Its own comment at
`plot-fleet-scan.sh:563`:

> *"Without `--ask` an unjoined branch answers from the list alone: NONE when
> the list arrived…"*

So the three-way logic exists. What does not is a caller that uses it:
`merged_by_host` (~598) passes `--ask` **unconditionally**, so every branch with
no ref costs a host round trip even when the joined list already carries its
answer.

**The work is at the call site, not in the state machine.**

## Why the answer is already in hand

Verified 2026-08-20 against this repo: `pr list --state all` returns PRs for
branches whose refs are gone. #252, #253 and #254 all appear with `MERGED` while
`git ls-remote --heads` returns **0 refs** for each.

Measured with a stubbed `gh` counting invocations: **15 calls, all `pr view`,
one per branch** — and every one of the fifteen is a merged branch the list
already names. Scan total 49.6 s against a 30 s budget.

## What to build

**Ask the join first; ask the host only where the join could not answer.**

| Branch has no ref, and… | Behaviour |
|---|---|
| the joined list names it | use that answer — **no call** |
| the list arrived and does not name it | one call, exactly as today |
| the list never arrived | unchanged — never read as "no PR" |

**The third row is the one that must not regress.** `an-outage-is-not-an-answer`
established the rule and the `.list-arrived` marker (`:533`, read at `:592`)
implements it: a failed list must not become *no PR exists*. Build on that
marker rather than around it.

**Count the calls in a test.** The plan's expected effect is fifteen calls
becoming zero on this repo, and a test asserting timings would be flaky while
one asserting invocation counts is not. `test/reconcile/` already stubs the host
this way — `conflicts.test.mjs` and the `#232` tests are the pattern.

## Definition of Done

- A merged-and-deleted branch costs **zero** host calls when the list carries
  it — asserted by counting invocations of a stubbed host, not by timing
- A branch absent from an **arrived** list still costs one call and reads
  correctly
- A list that never arrived leaves the branch reading exactly as today, never
  as "no PR" — assert this direction explicitly
- The three-way state vocabulary per branch is unchanged
- `merge_detect` in the footer still reports honestly about what was walked
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not raise the 30 s timeout — the plan rejects that explicitly: a budget
  raised to fit a cost that grows with every merge buys weeks, not a fix
- Do not move the terminal cache to disk; that is an Open Point and a cache on
  disk is a record rather than a derivation
- Do not change `plot-host.sh` — the Bitbucket `--state all` fan-out is
  `the-cadence-knows-what-a-refresh-costs`'s territory
- Do not touch the board

## Platform notes

`plot-fleet-scan.sh` took five changes today. **Rebase before you push.** If you
add awk comments, avoid apostrophes: the program lives in a single-quoted shell
string and an apostrophe silently truncates it — that broke the sibling parser
today.

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially. CI
now bounds its own steps, so a hang fails fast rather than blocking.

**Line numbers here may drift** — the plan this branch belongs to already found
one that had moved 1756 lines. Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.

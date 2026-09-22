# Delivery panel moderation — a failed tick must not end the daemon

**Subject:** `docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged as `65071ef52`.
**Commitment:** `Position: supported|refuted` + `Evidence: executed|read`.
**Verdict:** **`refuted`, `executed`** — one lens, both lines gated.

**This is the strongest statement a delivery panel can make**: the juror ran the code rather than reading the diff, and the delivery does not hold.

## What holds

**All four guards the plan named were measured by execution and all four hold.** The juror patched the *shipped artifact* to throw inside the minified `tick`, ran it against a throwaway sandbox, and confirmed `--once` exits 1 with the failure on stderr, the report stays empty, the interval is waited, and the entry `.catch` fires. **The real repository was never the subject.**

## Three findings, each verified in this session

### 1 · The plan's premise was false — `tick` already had a `catch`

The plan says *"`grep -c catch` over the tick path returns zero"*. **Verified false:** `tick` is defined at `packages/board/src/server/entry/registryd.ts:178` and its body opens with `try {` — and `git show 65071ef52~1` confirms the `catch` was there **before** the commit.

The author grepped `registryd-main.ts`, which calls `tick`, and not `registryd.ts`, which defines it. **Third wrong causal analysis in one day**, and the pattern is the same each time: a claim about where something is not, made without reading where it is.

**This does not void the fix.** A `catch` inside `tick` cannot protect the awaiting loop from what `tick` re-throws, nor from what fails outside it — and the guards measure as holding. What it voids is the plan's account of why the daemon died.

### 2 · The promised tests do not exist

The slice promised four pins. **The commit added none.** The juror proved the suite is blind by reverting the change: **123 tests pass with the fix entirely absent** — the same 123 the commit message cited as evidence.

`run` is invoked by no unit test at all, so neither the loop's `catch` nor the entry `.catch` has any coverage. **Per CLAUDE.md's *Gates Over Rules*: this shipped as a rule where the slice promised a gate.**

### 3 · The supervisor is dead again, after the fix

**Verified: `ps` finds no `registryd.mjs` right now.** Same signature as the two deaths the plan was written about.

So the fix did not remove the cause. The plan said so — *"It may not be the only cause … the `catch` makes the difference observable"* — and that hedge is now the finding: a surviving daemon that logs a tick failure has hit this class, and this one vanished without logging one.

## What the moderation recommends

**The plan is not deliverable as it stands.**

1. **Correct the premise in the plan**, which is published and wrong. `tick` had a `catch`; the gap was the awaiting loop and the entry point, which is what the fix actually closed.
2. **Write the four promised tests**, or the slice's claim is false. `run` needs a unit test at all before either `catch` has coverage.
3. **Reopen the cause.** The daemon still dies. The `catch` bought observability and the observation is now available: it died again without a logged tick failure, which rules out the class this fix removed.

**The code stays on main.** It is correct, its guards hold under execution, and reverting it would remove the only instrument now measuring the remaining cause.

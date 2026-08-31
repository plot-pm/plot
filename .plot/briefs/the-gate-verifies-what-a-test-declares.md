## Implementation brief — a-browser-test-serves-its-own-state (slice 2: Deciding)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-gate-verifies-what-a-test-declares` (base: `main`)
- **Ends as:** one PR to `main`

**Second. Needs the Survey's table; every later slice needs this answer.**

### What to build

Two mechanisms in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts`:

1. **Declare-then-verify** for files that legitimately start a board.
2. A count assertion that survives a test **moving between directories**.

### The decision the plan settles — do not re-open it

**A marker alone is not enough, and a list is worse.** The existing gate's
docblock already rejects the list, and its reasoning holds:

> A hard-coded list of file names is a second place to update, and it fails
> open: a new stubbed test simply is not on it.

A bare `// @needs-real-board` marker reintroduces exactly that, one line at a
time — a test joins the exceptions by claiming to belong there.

**So the marker declares and the structure verifies.** A file carrying

```
// @needs-real-board: <reason>
```

must ALSO match a structural predicate — it exercises a write route, or asserts
on process behaviour. **A declaration the structure does not support is an
offence**, reported like any other. The marker supplies the *reason*, which no
predicate can infer; the structure supplies the *entitlement*, which no comment
should be trusted for.

The signal separates today: `lifetime.test.mjs` carries 71 process-shaped
references and 0 write-shaped; the 6 write-route files carry 1–10 `POST` or
`/api/{approve,dispatch,claim,transition}` references each.

**Both failure directions need a test.** A file that starts a board with no
marker must fail. A file that declares the marker while matching neither
structural arm must ALSO fail — without that second test the verification arm is
unproven, and you would have shipped a gate that can only ever check the comment.

### The counts stay exact

`EXPECTED_FILES` and `EXPECTED_TESTS` remain hard-coded, and each later slice
updates them in its own commit against the main it sits on — never by arithmetic
on a stale figure. They fired spuriously once already (main added six tests
mid-flight) and across seven slices that will recur. **That churn is the price of
the tripwire, not a flaw in it:** raising either number costs a visible line in
the diff that raises it, which is the entire mechanism.

What must change is the *scope* of the count, the plan's third Open Question:
today it counts `it(` in `test/integration/` only, so a test moved to
`test/unit/` reads as a deletion. Decide and implement — the plan's stated
preference is to count across the whole browser suite regardless of directory —
and prove it with a test that moves a file and stays green.

Keep the comment-stripping (`codeOf`): a comment explaining an absence must not
fail a grep, and the current counts (48 / 479) are exact under stripping.

### Done when

- A board-starting file without a valid declaration fails the gate.
- A file declaring `@needs-real-board` without structural support fails the gate.
- Both above are asserted by tests, not by reading the code.
- The count assertion survives a test moving directories, proven by doing it.
- The gate still finds a non-empty population — a gate over an empty set proves
  nothing, and the existing `finds the population it is meant to gate` test is
  there for exactly that.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

Mechanism only. **No test migrates in this slice** — moving files while changing
the gate that counts them means a red gate cannot tell you which half broke.

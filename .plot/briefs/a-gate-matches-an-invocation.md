## Implementation brief — a-gate-matches-an-invocation (wave: A gate matches an invocation)

- **Plan (canonical):** `docs/plans/2026-09-17-a-gate-matches-an-invocation.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/a-gate-matches-an-invocation` (base: `main`)
- **Ends as:** one PR to `main`

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

Strip **single-quoted** heredoc bodies before tokenising in
`plot-controller-gate.sh`. Leave the token match otherwise untouched.

A `<<'EOF'` names its terminator literally and the body ends at a line equal to
it — a scan, not a grammar. **Only the quoted form**: `<<EOF` interpolates, so
its body can contain a substitution that is a command.

### Command position was the first answer and a panel REVERSED it

Do not reach for it. Measured:

```
refuses :: for s in a b; do skills/plot/scripts/plot-dispatch.sh $s; done
```

**A loop body is not command position**, and the gate exists for *"five
dispatches in one session"* — which is written as a loop. The fix would have
been blind to the original defect.

### The ratchet is the gate

**No command refused today may be allowed after.** The corpus goes **in the
contract test**, not in prose, and covers at minimum: a plain call,
`./relative`, an absolute path, `bash <script>`, `sh -c`, `env FOO=1 <script>`,
a `for` body, a `while` body, an `if` body, `{ }`, `( )`, `$( )`, `source`, `.`,
`xargs` and `find -exec`.

Every other clause in this slice can be satisfied by changing nothing; this one
cannot.

### What stays broken, on purpose

A `grep` or `cat` reading a gated script **still refuses**. Those are reads and
this estate spells them another way. Trading fifteen missed invocations for two
`grep` calls is not a trade this gate's risk asymmetry permits.

`gh issue create --body "…plot-dispatch.sh…"` **already passes** — the quote
adjacency means the basename is not a bare token. The plan's fourth reported
case was corrected.

### Also verify

`test/reconcile/controller-gate.test.mjs` and `plot-install-hooks.sh:246` both
drive the gate with `bash <script>`; both must behave as today.

### Repo gates

`pnpm run test:contracts`.

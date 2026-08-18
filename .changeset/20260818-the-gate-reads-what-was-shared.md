---
"plot": patch
---

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->

plot: the phase gate reads the plan from the shared ref

Both phase gates parsed the plan file in the **working tree** — the least
trustworthy surface available in a repo with several agents in it. It carries
whatever branch was last checked out, plus whatever is uncommitted, and neither
is a fact anyone else shares. That got the gate wrong in both directions, each
reproduced in a sandbox 2026-08-18.

**It refused work that was approved.** With the plan `Approved` on
`origin/main` and the checkout parked on another branch carrying an older copy:

```
origin/main phase:  Approved
what plot reads:    draft
plot-dispatch: plan '...' is still Draft — nothing may be dispatched.
```

This bit three times in one session. A concurrent agent's `git checkout` moved
the shared checkout, and `/plot-dispatch` refused two correctly-approved plans
whose approvals were sitting on `origin/main` the whole time.

**It permitted work that was not.** With the plan `Draft` on `origin/main` and
an approval committed to a local branch and never pushed, the fan-out ran.

The second is the serious one. Manifesto Principle 2 is *plans are approved
before implementation*, and the gate is what enforces it. A gate that accepts an
approval nobody else can see does not enforce that principle — it enforces
"someone typed Approved in this filesystem". Nothing was reviewed, nothing was
shared, and agents fan out anyway.

Both gates now read the plan blob from `origin/<main>` — `git show
origin/<main>:<path>` — so the question they ask is the one they mean: *has this
been approved where everyone can see it?* Every refusal names the ref and sha it
read; `origin/main@1beb3b97:plans/...` is debuggable in seconds, where "still
Draft" alone sent an operator looking at a file that already said `Approved`.

**They diverge on exactly one case, deliberately.** When `origin/<main>` cannot
be resolved (no remote, fresh clone, offline):

- `plot-dispatch.sh` **refuses**, naming the ref it could not read, and
  `--allow-local` is the explicit escape — named in the refusal so an operator
  learns it exists at the moment they need it.
- `plot-phase-gate.sh` **allows the commit and says so**, emitting
  `plot-phase-gate: cannot read origin/main — phase unverified, allowing the
  commit.` It is a PreToolUse hook; refusing every commit when offline would
  make the repo unusable, and the fail-open is a deliberate property.

The reason for the divergence is blast radius: dispatch refusing costs one
fan-out you can retry; the hook refusing costs every commit in the repository.
An operator who sees that line knows the gate did not run — the whole difference
between failing open and failing silently.

**Neither ever falls back to the working tree**, which would reintroduce the bug
precisely where nothing could catch it. Two implementation details enforce that
rather than merely intending it:

- **The `mktemp` template's `X`s must trail.** BSD `mktemp` (macOS) rejects a
  suffix after them where GNU accepts it. The first version wrote
  `plot-gate-XXXXXX.md`, failed on macOS, and — because the failure fell back to
  the working tree — silently resumed reading the exact surface this fix exists
  to stop reading. There is now no such fallback: an unreadable blob refuses.
- **The hook's `MAIN` resolution needs `|| true` on every step.** Its fail-open
  guard is `trap 'exit 0' ERR`, so a bare `git symbolic-ref` that fails — the
  offline case exactly — exited the hook *before* the "phase unverified" line
  could print. Failing open is correct; failing open without saying so is the
  bug being fixed.

The active index is a directory of symlinks, and git stores a symlink as mode
`120000` whose blob content is the target path — so `git show <ref>:active/g.md`
yields `../2026-01-01-g.md`, not the plan. On a filesystem `[ -e ]` follows the
link and this never comes up; against a ref it is dereferenced by hand, or the
gate parses a one-line path as a plan and reports an unreadable phase instead of
the real one.

Tests cover both directions for both consumers, and the hook's offline behaviour
both ways — that it still allows the commit *and* that it emits the unverified
line. The gate fixtures gained a real bare `origin`: without one they exercised
the fail-open path rather than the gate, so the suite would have kept passing
while testing nothing.

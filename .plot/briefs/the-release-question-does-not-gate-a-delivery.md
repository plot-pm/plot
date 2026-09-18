## Implementation brief — the-release-question-does-not-gate-a-delivery (wave: The release question does not gate a delivery)

- **Plan (canonical):** `docs/plans/2026-09-17-a-merge-commit-is-asked-of-the-host.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-release-question-does-not-gate-a-delivery` (base: `main`)
- **Ends as:** one PR to `main`
- **Issue:** #943

**THIS SLICE SHIPS FIRST**, and the order is a decision. It is the
unconditional half — it unblocks delivery whatever the host answers — while its
sibling depends on a Bitbucket payload this repository cannot exercise.

### What to build

Section 6 (`plot-reconcile-scan.sh:1152`, output at `:1214`) sits **above**
`== blocking sections end ==` (`:1253`). `/plot-deliver` step 7b greps to that
marker (`plot-deliver/SKILL.md:468`):

```bash
sed -n '/^== blocking sections end ==/q;p' … | grep "<slug>.md"
```

On a Bitbucket repository section 6 reports **every** delivered plan as
`has no merge commit → cannot resolve` — 45 findings, `unreleased_delivered=82`
— so the gate can never clear.

Move section 6 **below** the marker. Section 6 asks *which release contains
this*, not *did this delivery land*, and the marker's own documentation
(`:1238-1241`) says that is precisely the distinction it draws.

Also: the `inspect:` line at `:1200` prints `gh pr view …` unconditionally. On a
Bitbucket repo that is a command the operator cannot run. `PR_SOURCE` is a
script-global set at `:483` and in scope there — a one-line `case` fixes it.

### What this does NOT fix, and say so in the PR

**A second gate reads the same findings and the marker does not reach it.**
`/plot-release` step 5b (`plot-release/SKILL.md:431`) runs the scan and reads
`tail -1`: *"`unreleased_delivered=0` clears the gate. Any other number is a
hard stop."* That is the **footer**, unaffected by placement.

So after this slice the reporter can deliver and **still cannot release**. The
sibling slice is the load-bearing fix. Do not claim otherwise in the PR body.

### Out of scope — do not touch

`workflows/reconcile.ts:286` carries `blocking: true` per finding kind, a THIRD
representation of the blocking set. Its TSDoc says it is a property *because*
the scan renumbers. After this move the two disagree. **That is its own plan**:
changing a domain rule to follow a report's layout is the wrong direction, and
which is authoritative is a decision, not a fix. Note it in the PR; change
nothing.

### Done when

Section 6 sits below the marker and step 7b no longer reads it, **pinned by a
test that runs the gate's own `sed` extraction against a fixture carrying a
section 6 finding**. `unreleased_delivered=` still reports its count — the
section reports as before, only its placement changes. The `inspect:` line names
the configured host's CLI. The scan's header comment (`:7-9`) and CLAUDE.md's
description of the blocking set are updated: six sections became five.

### Repo gates

`nvm use` first. `pnpm run test:contracts` must pass. Add a changeset.
**Do not run `pnpm run test:e2e`** — that is CI's gate.

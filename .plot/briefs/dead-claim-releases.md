## Implementation brief — implement-leaves-the-main-checkout-on (wave Release)

- **Plan (canonical):** `docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md` on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2471 merged
- **Branch:** `bug/dead-claim-releases` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `scripts/check-*.sh` gates plus the usual PR review

This branch waits on nothing — its plan annotation reads `<!-- builds: a
domain rule naming an empty claim ref releasable -->`, a forward note on
what it adds, not a dependency. Both earlier slices are merged: `bug/
implement-restores-the-checkout` (PR #2538, "Checkout") and `bug/
implement-pushes-no-held-ref` (PR #2646, "Ref").

### What to build

Slice 2 closed the write-side cause: a `--brief-only` `/plot-implement`
run can no longer push a Started-only commit onto a slice branch in the
first place (`main-checkout-write.ts`'s `gatesMainCheckout` refuses a
mutating git call in the main checkout from an unattended agent that
isn't marked `PLOT_MAIN_CHECKOUT_WRITER=1`, and `implement-run.ts:616`
sets that var only for the deliberate main-checkout write). That stops
*new* dead claims of the #2162 shape.

This slice is the mitigation the plan named for whatever still slips
through — a different code path, a manual run, a race — producing a
claim ref with **no agent and no commits beyond the default branch**.
The fix is a domain rule that names such a ref releasable, called either
by fleetd unattended or offered on the board row; not a human having to
notice `ref_held: true` with `worker: ended` and run `/api/release-claim`
by hand, which is what cost the 90 minutes in the Motivation section.

### The decisions the plan settles — do not re-derive them

**This is not `releaseClaim` (`dispatch-verbs.ts:468`), and don't extend
it.** That function already exists and already runs from
`/api/release-claim` (`release-claim-reader.ts`'s `gatherReadingsAndRelease`,
shared by the HTTP route and the CLI). It answers a *different* question:
given that someone (a human, clicking "release") asked to release this
named branch right now, is it safe? It refuses on a live holder
(`agent-live`) or an open-or-merged PR (`pr-open`), and is a no-op when
the branch was never claimed at all.

What it does **not** answer is the question this slice needs: *of all
claimed branches right now, which ones are dead and safe to release
without being asked?* That is a detection rule over the whole claimed
set, upstream of `releaseClaim` — once a branch is identified as dead,
`releaseClaim`/`gatherReadingsAndRelease` is almost certainly still the
mechanism that performs the release (it already has the no-live-holder
and no-open-PR checks this slice also needs), so the natural shape is a
new rule that *selects* candidate branches, each then run through the
existing `releaseClaim` to actually release. Don't duplicate
`releaseClaim`'s live-holder or PR-state logic in a second place; call it
(or `gatherReadingsAndRelease`) for the branches the new rule names.

**"No commits beyond the default branch" is the detection signal, and it
is narrower than `ref_held`.** `ref_held` (`fleet.ts:378`,
`auto-dispatch.ts:264-267`) is already true for *any* branch whose ref
exists, including a genuinely in-progress one with real commits — that's
what makes a live claim block re-dispatch, correctly. The new rule must
distinguish a ref that holds *nothing but* a Started-record commit (the
#2162 and #2154 shape in the Motivation section — `92111c8f9`-like) from
one that holds real work. A comparison against the default branch's
tip — does the claimed branch carry any commit the default branch
doesn't, besides the Started-record one the implement run itself made —
is the plan's own phrasing ("no commits beyond the default branch").
Reuse whatever this repo already has for walking a branch against its
base (the `wip`-derivation `refBlocksClaim`'s doc comment references, or
`refsGit`'s branch-walking) rather than writing a new git-diffing path.

**"No agent" reuses `liveHolders` from `release-claim-reader.ts:43-60`,**
which already reads the manifests and narrows to `running`/`waiting`
workers — the same shape `gatherReadingsAndRelease` passes into
`releaseClaim` as `holders`. A branch with zero live holders by that same
read is "no agent" for this rule too; don't write a second liveness
check that can drift from the one `releaseClaim` already trusts.

**Automatic vs. offered is the plan's open question, and it is still
open — decide it here, don't presume it.** The plan's third open question
asks: does fleetd release automatically, or does the board offer it on
the row (`release-claim.ts` already exists as the mechanism either way
would call)? An automatic release is a write the fleet makes unattended,
so per the plan it "needs a stated age bound" — mirror the shape
`Claim stale after: 24` (hours) already takes for other staleness
readings in this repo's `## Plot Config`, rather than inventing a new
threshold convention. If you choose "offer on the row" instead, the
`release-claim.ts` HTTP route is already wired for a human click; the new
piece is only the row-level surfacing of "this claim looks dead" as a
button/badge, which per `CLAUDE.md`'s "every rendered state is a domain
property" rule must be a value the domain computes (the detection rule
above), never a decision made inside the `.tsx`.

**Scope stays the detection + wiring; it does not reopen slice 2's
gate.** `main-checkout-write.ts` and `gatesMainCheckout` are merged and
correct — this slice does not touch them. If testing surfaces a case
where a dead claim is *still* being created (the gate from slice 2 not
catching some path), that is a slice-2 regression to report, not
something to patch here by widening the release rule to compensate.

### Done when

The plan's `## Done when` is implicit in its Changelog line: "a claim
ref with no agent and no commits beyond the default branch is released
by the fleet or offered on the row." Concretely:

- A new domain rule (alongside `releaseClaim`, not inside it) takes a
  branch's holders and its commit-vs-default-branch reading and answers
  whether it is a dead claim eligible for release — pure, synchronous,
  no port, matching this repo's domain shape (`reap(readings, input)`,
  not `reap(ports)`).
- A test proves the rule distinguishes the three shapes: (a) a ref with
  only a Started-record commit and no live agent → releasable; (b) the
  same ref but a live `running`/`waiting` holder → not releasable; (c) a
  ref with real work commits beyond the default branch and no live agent
  → not releasable (this is an in-progress branch between sessions, not
  a dead claim). Case (c) is the one a naive "no agent" check alone would
  wrongly release.
- Wherever the rule is wired in (fleetd's pulse, or a board row), the
  actual release still goes through `releaseClaim`/
  `gatherReadingsAndRelease` — prove this with a test that the new path
  produces the same refusal/success shape `/api/release-claim` already
  does, rather than a parallel deletion path.
- If wired into fleetd unattended: the age bound is read from `##
  Plot Config` the way `Claim stale after` already is, not hardcoded.
- If wired onto the board row instead: the row's "offer release" state is
  asserted on a domain value in a unit test, not only visible by
  rendering the board.

Plus: this repo's gates. `scripts/check-shell-lines.sh` refuses a PR
whose shell under `skills/` grows past its merge base — if this fix
touches a `.sh` file, pay for the growth in the same change. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in this repo's `CI suites` config key
run in CI, not locally — don't add them to a local loop.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads which plan names this branch and titles the PR from the plan's
wave heading ("Release"). Once it exists, append `→ #<number>` to this
branch's line under the `### Release` heading in
`docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md`. Push
the first real commit as soon as it exists.

### Scope guard

This branch owns a new release-eligibility rule (new file, alongside
`packages/domain/src/workflows/dispatch-verbs.ts`'s `releaseClaim`, not
edited into it) and whatever fleet/board wiring surfaces it. It does not
own:

- `packages/domain/src/rules/main-checkout-write.ts` — merged in slice 2,
  read-only reference here.
- `packages/fleet/src/shared/implement-run.ts`'s push/claim mechanics —
  also slice 2's, done.
- `releaseClaim` itself (`dispatch-verbs.ts:468`) and
  `release-claim-reader.ts` — called by this slice, not modified, unless
  the investigation finds a genuine shared refactor is needed; report
  that rather than quietly expanding the diff.

No other branch from this plan is in flight — both siblings are merged.
If the investigation finds the dead-claim shape still being produced by
a path slice 2 did not cover, report it by name rather than widening this
slice to patch it silently.

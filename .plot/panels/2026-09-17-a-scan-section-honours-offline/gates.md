# Panel verdict — GATES lens

Subject: `docs/plans/2026-09-17-a-scan-section-honours-offline.md`

Position: amend
gates: amend

The defect is real and I reproduced it. The fix is the right one. **Two of the six
Done-when clauses are satisfiable while leaving a defect in place**, and one of
them is the clause the plan leans on hardest — `byte-identical`. A third clause
names no rule at all. The amendment is to the gates, not to the design.

---

## 1. Is the problem real, and stated correctly?

**Yes, and I reproduced it end to end rather than reading the source.**

The plan's structural claim — no `PR_SOURCE` test between the loop's `while` and
its `pr-state` call:

```
$ sed -n '1135,1160p' skills/plot/scripts/plot-reconcile-scan.sh | grep -n "PR_SOURCE"
NO PR_SOURCE GUARD FOUND -- plan's claim CONFIRMED

$ sed -n '1137p;1156p' skills/plot/scripts/plot-reconcile-scan.sh
while IFS="$US" read -r f st _raw _alt _alt_raw _branches prs ptype _psprint; do
  sha=$("$script_dir/plot-host.sh" pr-state "$last_pr" </dev/null 2>/dev/null \
```

`grep -n PR_SOURCE` over the whole script returns 18 hits, and the nearest either
side of the section-6 loop are `:1064` (section 3) and `:2291` (section 18).
Section 6 spans roughly `:1137`–`:1180` and contains none. **Confirmed.**

Both flags reach the same state, so `--no-pr` is affected identically
(`:501-505`): `if [ "$do_pr" = 1 ]; then load_open_pr_branches; else
PR_SOURCE="off"; fi`. The plan is right to name both.

**I then ran it.** Minimal fixture, three Delivered plans each annotated `→ #N`,
`plot-host.sh` replaced by a stub that appends its argv to a log:

```
########## RUN 1: --offline ##########
exit=0
pr-state calls under --offline: 3
all host calls: 3
   1 pr-state 101
   1 pr-state 102
   1 pr-state 103
```

**Three delivered plans, three host calls, under the flag that promises none.**
The header printed by that very run reads `PR state: skipped (--no-pr) — git
merge-state only; no git-host network call.` The promise and the behaviour
contradict each other in one output. This is not inferred from the source; it is
the call log.

The estate reading re-derives:

```
$ grep -rlE '^\- \*\*(State|Phase):\*\* Delivered' docs/plans/*.md | wc -l
       2
$ ls docs/plans/*.md | wc -l
     292
```

**2 delivered** — the plan says 2. The 292 vs the plan's "109 plans" is the
*reporting* repository, not this one, and the plan says so explicitly. The
property the plan draws from this — the cost scales with the delivered backlog,
not the plan count — is exactly what my fixture shows: 3 delivered plans in a
292-plan checkout would cost 3 calls, and 82 would cost 82.

I could not re-derive the 8.2 s per-call figure (it is a network measurement on
another estate) but I did not need to: the call *count* is the defect and the
count is confirmed. See §4.

## 2. Right fix, or a symptom fix?

**Right fix, and the plan is honest about which half it is taking.**

Two defects sit here. Section 6 ignores `PR_SOURCE` (a correctness bug — the flag
is violated), and section 6 asks per-plan where the rest of the scan asks once (a
cost bug). Fixing only the second would leave `--offline` still calling the host —
one bundled call instead of 82, but still a broken promise. Fixing the first is
therefore the load-bearing half, and the plan takes it.

**Deferring the bundling is correct and correctly argued.** The plan names it,
says why it is not taken, and says what it would need (its own measurement of a
bundled call against the per-plan one). That is a named deferral, not an
omission. `CLAUDE.md` already records the estate's preference here —
`plot-pr-merged.sh` was extracted precisely so two callers could not drift — so
the second fix has a clear home later.

One thing the plan gets right that a symptom fix would miss: it refuses to make
the section silent. `:939` and `:2291` both show the established pattern, and
section 6's own `no PR annotation` arm at `:1147` says the same. Printing a note
is consistent with three existing precedents in the same file.

## 3. Does `Done when` contain a gate that cannot be satisfied by plumbing?

**Yes — one, and it is strong.** The rest are weaker than they read.

Taking the six clauses in order.

**(a) "zero `pr-state` calls from section 6, asserted by counting the calls
against a stub rather than by timing" — STRONG, and the machinery already
exists.**

My lens brief asked whether this requires machinery that does not exist. **It does
not.** `test/reconcile/scan.test.mjs:411` already builds exactly this:

```js
function makeGhStub(dir, mergedLines, { openLines = '' } = {}) {
  const argvLog = path.join(dir, 'gh.argv');
  ...
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
```

and an existing test at `:612` already asserts the offline case against it:

```js
test('scan: --offline makes no host call and says the check was skipped', () => {
  const { out, argv } = runSinglePrScan('40 idea/solo', ['--offline']);
  assert.equal(argv, '', 'no gh call may happen under --offline');
```

There is also a second stub form at `:3138` that replaces `plot-host.sh` outright
— the shape my own reproduction used, and the one section 6 needs, because
section 6 calls `plot-host.sh pr-state` rather than `gh` directly.

This clause cannot be satisfied by plumbing. A `PR_SOURCE` variable read but not
branched on still spawns the process, still appends to the log, and
`assert.equal(callCount, 0)` still fails. **This is the plan's real gate**, and
the plan chose well by specifying *counting* over *timing* — a timing assertion
would pass on a fast stub regardless of the guard.

One caveat the plan should absorb: `runSinglePrScan`'s existing `argv === ''`
assertion covers the `gh` stub, and the existing offline test **already passes
today** even though section 6 calls the host — because that fixture's stub
intercepts `gh` on PATH while section 6 goes through `plot-host.sh`, and that
fixture has no delivered plan with a PR annotation. So the implementer must not
assume the existing test covers this. It must be a new assertion over a fixture
carrying delivered plans, against a `plot-host.sh`-level stub. Worth stating,
because reusing the wrong stub is the easy mistake here.

**(b) "the section prints a note naming what it could not resolve, and that note
is asserted by text so an empty section cannot pass for a clean one" — ADEQUATE.**

The clause explicitly anticipates the empty-section failure and closes it. My
lens brief asked whether the note gate can be satisfied by an empty section: it
cannot, because `assert.match(out, /pr_source=off/)` over section 6's extent
fails on an empty section. The precedent at `:939` is asserted this way already
(`const note = lineMatching(out, /merged-PR heads not consulted/);
assert.equal(note.length, 1)`), so the shape is established.

**This is the defect today.** My offline run printed:

```
== 6. Delivered but already released (candidate /plot-release) ==
  (none)
```

`(none)` on a repository with three delivered plans it never resolved. That is
"silence reads as health", and the plan is right that it would be the worse bug.

**(c) "an online scan's section 6 output is byte-identical to today's over a
fixture carrying a delivered plan with a merged PR" — WEAK AS WRITTEN, AND
VACUOUS ON THE OBVIOUS FIXTURE. This is the amendment.**

Determinism is not the problem. I checked, because the brief asked:

```
########## Is FULL output byte-identical run-to-run? ##########
FULL OUTPUT: byte-identical
########## Is SECTION 6 byte-identical run-to-run? ##########
SECTION 6: byte-identical
```

Two consecutive online runs over one fixture produce identical bytes — no
timestamps, no durations, no ordering instability inside section 6. So the clause
is *assertable*. That is not the objection.

**The objection is that it is satisfiable while the defect stands.** Here is
section 6 online, over a fixture with a delivered plan whose PR has no resolvable
merge commit:

```
== 6. Delivered but already released (candidate /plot-release) ==
  (none)
```

**Byte-identical to the offline output.** A fixture where `pr-state` returns no
`mergeCommit`, or returns one carrying no tag, prints `(none)` in both modes. An
implementer who writes the byte-identical test against such a fixture gets a
green test that pins nothing — it would pass if section 6 were deleted entirely.

The plan does say "a delivered plan with a merged PR", which is the right
instinct. But "merged PR" is not sufficient: the PR must resolve to a merge
commit **that a release tag contains**, or the section stays silent. When I
supplied both, the section finally discriminated:

```
########## ONLINE with resolvable merge commit + tag ##########
== 6. Delivered but already released (candidate /plot-release) ==
  2026-01-01-del1.md — shipped in v1.0.0, plan still Delivered
    consider: /plot-release (records Phase: Released, del1)
  ... (3 findings)
footer: unreleased_delivered=3
```

**Amendment:** the clause must require the online fixture to produce a **non-empty
section 6 naming at least one plan and a tag**. Byte-identity over `(none)` is
not a pin. Suggested wording: *an online scan's section 6 prints at least one
`shipped in <tag>, plan still Delivered` finding and its output is byte-identical
to today's.*

**(d) "a fixture with 3 delivered plans makes 3 calls online and 0 offline,
pinning both directions in one test" — GOOD, and it partially rescues (c).**

This is the best-designed clause after (a). The `3 online` half is what stops the
implementer from "fixing" the flag by disabling section 6 unconditionally — the
one-line wrong fix that would satisfy (a) and (b) and a vacuous (c) all at once.
It is discriminating because the two numbers differ and neither is zero.

It does not fully substitute for (c): it pins call *count*, not output *content*.
A guard that skips the call but also corrupts the online rendering would pass (d).
So (c) still needs the amendment; (d) is not a reason to drop it.

**(e) "`unreleased_delivered` reports a number that a reader can tell apart from a
measured zero" — NOT A GATE. It states a goal and names no rule.**

This is the clause with no checkable condition. It does not say what the counter
should report under `pr_source=off`, so any implementer choice satisfies it by
assertion. Three incompatible readings all fit the words: leave it `0`; report the
unresolved count (`3` in my fixture); or emit a non-numeric sentinel.

**And the choice is consequential, which is why leaving it open is the problem.**
`skills/plot-release/SKILL.md:431`:

> `unreleased_delivered=0` clears the gate. Any other number is a hard stop: show
> section 6's findings and fix them before proceeding.

The estate has already been burned here. From `.changeset/a-docs-plan-stays-exempt.md`:

> Measured 2026-09-16 on this estate, two docs/infra plans were reported as
> `unreleased_delivered` and `/plot-release`'s step 5b gate is a hard stop on any
> non-zero, so a correct release could not be closed out.

That is **yesterday**, on **this same section**. So:

- Report the unresolved count → **every `--offline` scan hard-stops `/plot-release`**,
  reproducing the 2026-09-16 incident by a different route.
- Leave it `0` → a reader cannot distinguish "nothing to release" from "never
  asked", which is the exact confusion clause (b) exists to prevent, merely moved
  from the section body into the footer.
- A non-numeric sentinel → `n_unrel` is arithmetic-only today (`:685`, `:1151`,
  `:1165`, `:1176`) and `test/reconcile/scan.test.mjs:279` asserts the footer as
  one exact string, so this is a wider change than the plan's scope suggests.

**Amendment:** the plan must pick one and state it. My reading of the precedent is
that `0` plus the section-body note is right — the note carries the "never asked"
fact, and `/plot-release` under `--offline` was never a supported gate run
anyway (`SKILL.md:427` runs the sweep with no flags). But the plan must say so
rather than leave the implementer to guess between three options, one of which
breaks the release gate.

**(f) "`pnpm run test:contracts` passes" — a regression guard, not a gate for this
change.** Fine as a floor. It would pass today, before any fix.

**Summary of §3:** (a) is a genuine gate and its machinery exists. (d) is solid.
(b) is adequate. **(c) is vacuous on the fixture an implementer would reach for,
and (e) is not a gate at all.** The answer to the rubric question is yes — (a)
alone carries it — but two clauses need repair before this is safe to hand over.

## 4. Claims I could not verify, or found false

**Nothing found false.** Everything structural re-derived, and the behaviour
reproduced.

**Could not verify — the timing table.** `8.2 s` per `pr-state`, `≈ 11 minutes`
for 82, `exit=124` at 100 s, the 90 s pulse budget, and `0.117 s` per plan parse
are all measurements taken on the reporting repository (109 plans, 82 delivered).
This checkout has 2 delivered plans, so the 82-call loop cannot be reproduced
here and no command available to me re-derives 8.2 s. **I am not calling these
false — they are unfalsifiable from here, and the plan correctly labels them as
the reporting estate's readings rather than this one's.**

They also are not load-bearing for the fix. The defect is *the flag is violated*,
which I proved with a call count; the timings establish severity, not existence.
A juror who could not reproduce them still has a confirmed bug.

**One inherited number I could not check:** `0.61 s` per `pr-state` appears in
`test/reconcile/scan.test.mjs:601`, while this plan says `8.2 s`. Both are
plausible (different estates, different network, different PR sizes) and nothing
turns on the discrepancy, but if the deferred bundling fix is ever measured, it
should not treat either as established.

**A claim that is understated rather than wrong:** the plan says "the pulse then
blames the wrong things", reporting *"2 worktrees, 10 branches"*. I could not
reproduce the pulse's timeout message from here. Accepting it as reported.

## 5. What the plan missed that a GATES reader notices

**(i) The `/plot-release` gate interaction is missing, and it is the highest
consequence thing here.** Covered at length in §3(e). The plan never mentions
`plot-release/SKILL.md:431`, never mentions that non-zero is a hard stop, and
never mentions that the same section broke that same gate on 2026-09-16. Its own
Notes section gets close — it cites `f5d052af` and says "two defects in one loop
in two days" — but draws the lesson as *this section is under-tested* rather than
*this section feeds a release gate, so the counter's value under the new branch is
a decision*. **This belongs in the Design, not just the Done-when.**

**(ii) The existing `--offline` test creates a false sense of coverage.**
`scan.test.mjs:612` is literally named `scan: --offline makes no host call and
says the check was skipped` and asserts `argv === ''` — **and it passes today,
while section 6 calls the host.** It passes because its stub intercepts `gh` and
section 6 goes through `plot-host.sh`, and because its fixture has no delivered
plan with a PR annotation. An implementer reading that test name will reasonably
believe the property is already pinned and write something weaker. The plan should
name this test and say it is insufficient, so the new assertion is written at the
`plot-host.sh` level over a delivered-plan fixture. This is the single most
likely way the implementation ends up green and wrong.

**(iii) The note's own wording is not pinned to a stable substring.** Clause (b)
says "asserted by text", and the Design shows a two-line note. The existing
precedent at `:939` wraps across lines, and section 18 at `:2291` does too. A
regex spanning a wrapped line is how this suite has been fooled before — its own
comment at `:649` says *"Whole-output regexes have fooled this suite three
times"*, which is why `lineMatching` exists. The plan should name the one
single-line substring the test matches (`pr_source=off` on the first note line is
the natural choice) rather than leaving the implementer to regex two wrapped
lines.

**(iv) `--no-fetch` is excluded by name but the exclusion is not gated.** The plan
says it does not touch `--no-fetch`, correctly — that flag leaves `PR_SOURCE`
unset to `off`, so section 6 legitimately calls the host under it. But no
Done-when clause pins that. A guard written as `[ "$do_pr" = 1 ] || continue`
versus one written against `PR_SOURCE` behave identically today; a guard written
carelessly against `do_fetch` would silently change `--no-fetch`. One clause —
*`--no-fetch` alone still makes N calls* — closes it, and the (d) fixture already
has the machinery to assert it.

**(v) Section 6 is inside the blocking set, and the plan does not say what a note
does to `/plot-deliver`.** Section 6 sits above `== blocking sections end ==`
(confirmed in my run output — the marker prints immediately after it), and
`plot-deliver/SKILL.md:526` reads to that marker and greps what came before.
Adding a note line to a blocking section changes what that gate greps. Most likely
harmless, because the gate keys on the footer counters rather than prose — but
"most likely harmless" is the sort of thing this estate measures rather than
assumes, and the plan's own Board-impact comment considers the pulse while
skipping the delivery gate.

---

**What would move me to `proceed`:** amend (c) to require a non-empty online
section 6; replace (e) with a stated counter rule; add the `--no-fetch` clause;
and name `scan.test.mjs:612` in the Design as insufficient coverage. The design is
sound and the premise is proven — the gates are what need the work.

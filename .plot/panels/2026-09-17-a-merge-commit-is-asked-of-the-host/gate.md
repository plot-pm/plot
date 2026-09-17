# Juror: the gate

**Lens:** slice 2 moves a report section below a marker that gates delivery. What does that change, and what does it silently stop catching?

Position: amend

Slice 1 is correct, well-evidenced, and I found nothing to refute in it. Slice 2 is
directionally right and **under-scoped in three places I can demonstrate**, one of
which is a second gate the plan never names and does not clear.

---

## What I verified first: the plan's own claims about the gate hold

Before objecting I checked the plan is not wrong about the mechanism. It is not.

**Section 6 is inside the blocking set.** `plot-reconcile-scan.sh:1152` opens it
and `:1253` is the marker:

```
1152: echo "== 6. Delivered but already released (candidate /plot-release) =="
...
1253: echo "== blocking sections end =="
```

**The marker's own documentation says exactly what the plan says it says**
(`plot-reconcile-scan.sh:1238-1241`):

```
# Everything above this line is a finding that stops a delivery; everything
# below it is a shape for somebody to fix. /plot-deliver's delivery-landed gate
# reads to this marker and greps what came before it.
```

and the file header, `:7-9`:

```
#         `== blocking sections end ==` line separates the findings that stop a
#         delivery from the shapes somebody fixes; /plot-deliver's gate reads to
#         it.
```

**The gate reads to the MARKER, not to a section number**, as CLAUDE.md claims.
It lives in skill prose, `skills/plot-deliver/SKILL.md:468`:

```bash
sed -n '/^== blocking sections end ==/q;p' /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
```

So the mechanism is as described: move the `echo "== 6. …"` block below `:1253`
and `/plot-deliver`'s `sed … q` stops before it. The plan's causal claim is sound.

**Slice 1's premise is exactly right, and I confirmed the key lines.** The
Bitbucket `pr-state` arm at `plot-host.sh:2496` constructs four keys:

```bash
jq -c '{number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href}' <<<"$out"
```

No `mergeCommit`. The miss path at `:2499` is `'{"number":0,"state":"NONE","draft":false,"url":""}'`
— also no key — while **every** GitHub path carries it (`:2447`, `:2461`, `:2468`,
`:2476`, `:2488` all end `"mergeCommit":""` or construct `mergeCommit:(.mergeCommit.oid // "")`).
And `:2654` proves the field is reachable on Bitbucket in the neighbouring op.
The plan is right that #943's "GitHub-only field" diagnosis is wrong. **I have no
objection to slice 1.**

---

## Finding 1 (strongest): a SECOND gate reads section 6, and slice 2 neither names nor clears it

**`/plot-release` step 5b is a hard stop on `unreleased_delivered`**, and it
names section 6 by number. `skills/plot-release/SKILL.md:429-432`:

```
../plot/scripts/plot-reconcile-scan.sh 2>/dev/null | tail -1
```
```
`unreleased_delivered=0` clears the gate. Any other number is a hard stop: show
section 6's findings and fix them before proceeding.
```

That gate does **not** read the marker. It reads `tail -1` — the footer — so
moving section 6 below the marker changes nothing about it. The plan's Done-when
even guarantees this, and treats it as reassurance:

> `unreleased_delivered=` still reports its count, since the section reports as
> before and only its placement changes

**That sentence is true and it is the problem.** The plan's stated goal is that a
Bitbucket operator can work. Slice 2 unblocks `/plot-deliver` and leaves
`/plot-release` refusing on the identical 45 findings, from the identical cause,
via a gate the plan never mentions. The plan's Notes claim:

> **The second slice is what the reporter would have needed on the day.**

On the day, the reporter could not deliver. After slice 2 alone they can deliver
and still cannot release — 45 non-zero in `unreleased_delivered=`, step 5b a hard
stop. The claim is overstated by exactly one gate.

This is not fatal, because **slice 1 fixes the Bitbucket case at the source** and
takes `unreleased_delivered` back to a real number. But it means the two slices
are not independent in the way the plan argues (*"Shipping only the first leaves
any future backend with the same trap; shipping only the second leaves the
release check broken on Bitbucket"*). The true statement is stronger: **shipping
only the second leaves the reporter still unable to release.** Slice 2 is not a
standalone remedy for anyone, and the plan should say so rather than the reverse.

The plan searches for `/plot-release` and finds it only once — line 78, quoting
section 6's own *heading text*. Step 5b is never mentioned.

**Amendment:** state that `/plot-release` step 5b gates on the same findings
through the footer and is unaffected by the move; state that slice 1 is therefore
the load-bearing fix for the reporter and slice 2 alone does not unblock them.

## Finding 2: a THIRD representation of the blocking set is hardcoded in the domain, and it disagrees after slice 2

`packages/domain/src/workflows/reconcile.ts` carries `blocking` as a **property
per finding kind**, not derived from the marker. `:286-293`:

```ts
  if (plan.deliveredNotReleased) {
    findings.push({
      kind: 'delivered-not-released',
      subject: plan.slug,
      evidence: 'the plan is Delivered and its release is tagged',
      repair: `/plot-release ${plan.slug}`,
      blocking: true,
    });
  }
```

`blocking: true` — the same fact section 6 reports, and the field's own TSDoc at
`:86-93` says it is carried as a property *because* the scan renumbers:

```ts
   * Carried as a PROPERTY rather than derived from a section number by the
   * caller. `plot-reconcile-scan.sh` prints an `== blocking sections end ==`
   * marker for the same reason: its gate once read *to section 7*, meaning
   * *the first non-blocking section*, and the scan has been renumbered twice
   * since.
```

And `:155-163` documents a gate reading it:

```ts
  /**
   * How many findings stop a delivery.
   *
   * Counted here rather than by the caller, so a gate reading *only an empty
   * result clears it* asks one field instead of re-deriving the blocking set.
   */
  readonly blocking: number;
```

`reconcile()` at `:548` computes `blocking: ordered.filter((f) => f.blocking).length`.

**After slice 2 the shell says `delivered-not-released` is advisory and the domain
says it blocks.** Two answers to one question, in the exact shape CLAUDE.md's
"A Shell Script Asks The Domain" section forbids as *undeclared* duplication.
Note the irony recorded in `docs/plans/2026-09-09-reconcile-is-a-controller-action.md:105`:

> The gate keeps its shape: the same blocking sections (1–6, to the
> `== blocking sections end ==` marker), the same hard stop

The controller was built to match the shell's 1–6. Slice 2 moves the shell and
leaves the controller behind. The plan's Done-when lists the scan header comment
and CLAUDE.md as the things to update. **`reconcile.ts` is not in that list, and
it is the one that is code rather than prose.**

**Amendment:** slice 2 must flip `reconcile.ts:292` to `blocking: false` in the
same slice, or state in the plan why the domain's answer deliberately differs.
Leaving it is the *"a rule exists and nothing calls it"* defect the same file
warns about, in reverse.

## Finding 3: a test asserts section 6's position by number and slice 2 breaks it

`test/reconcile/scan.test.mjs:2272-2295`:

```js
test('gate: the blocking sections sit above the marker and the advisory ones below', () => {
  // The blocking set is 1-6 — the sections that populate the footer counters
  // /plot-deliver and the /plot hygiene line read. This asserts the marker is
  // where CLAUDE.md says the boundary is, rather than merely present.
  ...
    assert.equal(
      above,
      Number(m[1]) <= 6,
      `section ${m[1]} is on the wrong side of the boundary`,
    );
```

`Number(m[1]) <= 6` is a hardcoded five-or-six. The fixture generator at `:2233-2263`
also inserts its synthetic blocking section **at 6** on purpose (*"IT GOES INSIDE
THE BLOCKING SET, at 6, which is what makes this the real defect"*), and
`:2384-2391` asserts `sectionsRead(report) === 6`.

So slice 2 does not merely "move a section": it renumbers the boundary from 6 to
5 and touches at least three assertions in this file. The plan's Done-when names
one test — *"pinned by a test that runs the gate's own extraction against a
fixture carrying a section 6 finding"* — which is a **new** test, and says nothing
about the existing ones it invalidates. An implementer who adds the new test and
runs `pnpm run test:contracts` will hit these; the plan should name them so the
fix is a decision rather than a surprise.

**Amendment:** name `test/reconcile/scan.test.mjs:2272` and the `<= 6` constant in
slice 2's Done-when.

## Finding 4: the dismissed third direction — the plan is right to reject it, and its reason is not the one it gives

This was flagged as potentially my strongest finding either way. Having checked,
**I think the plan's conclusion is correct and its argument for it is absent.**

#943's third direction:

> **Or emit a different, non-blocking finding when the host has no `mergeCommit`
> field**, so a GitHub repo keeps the strict check and a Bitbucket repo is told
> the question cannot be answered here.

The plan does not adopt it and does not argue against it. I tried to build the
case for it and it collapses on one observation: **after slice 1 there is no such
thing as "a host with no `mergeCommit` field"**, because slice 1's Done-when makes
the key universal —

> so a caller reading `.mergeCommit // empty` can never distinguish backends

A branch-on-backend finding would need a signal slice 1 deliberately erases. The
third direction and slice 1 are mutually exclusive by construction. Implementing
both would mean re-introducing the very distinguishability slice 1 removes, and
the only remaining discriminator would be `$PLOT_HOST_BACKEND` — a vendor branch
in the scan, which the layering rule pushes into the adapter.

**But the argument is still worth losing something over.** What the third
direction buys, and what slice 2 gives up, is this: an empty `mergeCommit` has two
causes that the scan cannot currently tell apart —

- the PR merged and the host reports the commit → resolvable
- the PR merged **outside the host's merge button**, so no `merge_commit` object
  exists → genuinely unanswerable

The plan itself names that second population in its final line:

> that population is not empty: the same object is absent for a PR merged outside
> the host's own merge button.

**After slice 2 both become advisory and neither blocks.** That is fine. What is
NOT fine is that the plan offers no evidence for the population it uses to justify
slice 2 — *"not empty"* is asserted, not measured, and it is the entire load-bearing
claim for weakening the gate. This estate has 8 delivered plans; a count of how
many of their PRs lack a `mergeCommit` on GitHub is one `plot-host.sh pr-state`
loop away and would turn the justification from an assertion into a measurement,
in a repo whose CLAUDE.md says *"Give the number, the name, or the date, and let it
carry the claim. With no fact to give, make the claim smaller."*

**Amendment:** either measure that population on this estate, or shrink the claim
to what is provable.

## Finding 5: what slice 2 silently stops catching, stated plainly

The plan asks the reader to accept that section 6 asks *which release contains
this*, not *did this delivery land*. I agree with the distinction. But the plan
never states the protection being surrendered in its own terms, so here it is.

Today, on a working GitHub repo, section 6 blocks a delivery when it prints:

```
  $base — shipped in $tag, plan still Delivered
    consider: /plot-release (records Phase: Released, ${slug%.md})
```

That fires for a plan that is **Delivered, whose merge commit is inside an
existing release tag, and which was never marked Released** — the sixteen-release
blindness section 6 was written for (`plot-reconcile-scan.sh:1127-1130`):

```
# The fourth phase went unreached for sixteen releases because nothing compared
# these two facts: /plot-release ships a version, and the plans describing that
# version stay at Delivered. Neither side is wrong on its own, so neither side
# complained.
```

After slice 2 this stops blocking **any** delivery, on **every** backend — not
only the unanswerable Bitbucket case. Note this finding is about a *different*
plan than the one being delivered: the gate greps `"YYYY-MM-DD-<slug>.md"`, so it
only ever fires on the delivered plan itself, and a plan being delivered right now
is by definition not already inside a release tag. **So this arm is close to
unreachable through `/plot-deliver`'s gate in practice** — which is a real
argument FOR slice 2 that the plan does not make, and it is a better argument than
the one it does make. The genuinely load-bearing reader of this arm is
`/plot-release` step 5b, which reads the footer and is untouched.

That is the shape of the amendment: slice 2 is defensible, the plan just has not
shown its work, and it has not swept the other two readers.

---

## What would move me to `proceed`

1. Slice 2's Done-when adds `packages/domain/src/workflows/reconcile.ts:292`
   (`delivered-not-released` → `blocking: false`), or the plan argues the
   divergence is intended.
2. Slice 2's Done-when names `test/reconcile/scan.test.mjs:2272`'s `<= 6` and the
   `sectionsRead(report) === 6` assertion at `:2384`.
3. The Design states that `/plot-release` step 5b (`skills/plot-release/SKILL.md:431`)
   gates on the same findings through the footer, is unaffected by the move, and
   that slice 1 is therefore the reporter's actual remedy.
4. The "population is not empty" claim is measured or made smaller.

None of these changes the plan's direction. All four are things an implementer
would otherwise discover mid-slice, and two of them are a second gate and a
second copy of the blocking set — precisely the class of thing this repository
writes CLAUDE.md paragraphs about after the fact.

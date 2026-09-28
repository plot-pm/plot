# Panel — a label override reaches the unit (#1051)

Subject: `docs/plans/2026-09-28-a-label-override-reaches-the-unit.md`
Round 1, 2026-09-28. Two jurors, both gated on both commitments.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |
| estate | amend | executed |

**Unanimous: amend.** Both jurors executed. No hedge, no refusal.

## Where they agree

**The central premise is TRUE, and it was measured rather than read.** The estate juror ran the discriminating experiment: two plists with different filenames and the same `Label` produce ONE job (`Bootstrap failed: 5` on the second, launchd holding the first file); one filename base with two labels produces TWO jobs. The filename is irrelevant and the label is the key. Both jurors then reproduced the defect end to end against the live script: `--start --dry-run` reports `would fill and load <override>`, the written file is named for the override, its `Label` is the default, the placeholder gate passes with 0 survivors, and `plutil` accepts it. Every guard in the path reports success.

**Three test assertions fail and the plan names none.** `test/reconcile/fleetctl.test.mjs:450` asserts by `deepEqual` that the placeholder set is exactly three, iterating BOTH templates; `:459`'s fill is a hardcoded three-way `replaceAll`; `:487` matches the literal default `Label`. The evidence juror executed all three against a patched copy: all three fail.

**The systemd hedge hides a defect of a different shape.** A systemd unit has no `Label` field — its identity IS its filename — so "the same placeholder" is not available there. `PLOT_FLEET_LABEL` is ignored entirely on Linux: eight hardcoded sites (`plot-fleetctl.sh:156 :167 :220 :451 :647 :648 :696 :824`), so two Linux checkouts overwrite one unit file.

## Where they disagree, and it matters

**The jurors name different things as the plan's central failure, and the difference decides the size of the amendment.**

- **evidence** calls the systemd hedge *"the plan's false central claim"* — a claim that, if accepted, makes this a plan to rewrite.
- **estate** holds that the premise is true and correctly argued, and that the failure is **undeclared blast radius**: the plan is right about what it fixes and silent about what it perturbs.

**The moderation takes estate's framing.** The plan's premise is verified by execution, its fix is four characters in a template plus one `sed -e` clause, and no other reader of the override exists. That is a sound plan with gaps in its `Done when`, not a false one. The systemd finding is a real defect the plan must dispose of explicitly — but disposing of it is a sentence, not a redesign.

## The one thing that must not be lost

`Done when`'s last bullet reads *"The systemd unit is checked for the same defect and fixed in the same slice, or the plan records that it has none."* The second arm is **true** — the unit has no identity field — so an implementer can answer it honestly, close the question, and ship a feature that is inert on Linux. The estate juror cites this estate's own precedent for that shape, `fleetctl.test.mjs:523`: *"a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations."*

That bullet is the amendment's reason for existing.

## Evidence the plan should have cited and did not

`~/Library/LaunchAgents/com.plot-pm.registryd.ewz-kus-portal.plist` — a second supervisor, loaded, pid 30516, `working directory = /Users/jwloka/Quatico/ewz/ewz-kus-portal`, whose `Label` matches its filename. `--start` **cannot** produce that file; it was written by hand per `units/README.md:67`. The documented workaround is in production on the author's own machine, which converts the motivation from *an override nobody exercised* into *a manual step two checkouts perform today*.

## The upgrade path claim is false as written

`--stop` resolves the supervisor through `$LABEL`. An operator who sets an override and runs `--stop` gets *"supervisor was not loaded"* while the default-labelled job keeps running — measured: `PLOT_FLEET_LABEL=…NOSUCH --status` prints `not installed` while `launchctl list` shows pid 8411 under the default. `--stop` then `--start` does not migrate the unit, it **orphans** it.

## Amendments required before approval

1. Split the systemd question out of the hedge. State the measured fact and decide **in the plan**: same slice, or a named follow-up. Never "the slice checks".
2. Name `fleetctl.test.mjs:450`, `:459`, `:487` in `Done when`, and say `:450` cannot simply gain a fourth entry — it iterates both templates and only one gains the placeholder.
3. Add a `Done when` bullet for `--start --dry-run` reporting the label it will actually write. That line is the operator-visible lie and no bullet covers it.
4. Correct the upgrade path: the override must equal the label the old unit was loaded under, or state the explicit `launchctl bootout` migration.
5. Make the `launchctl list` bullet honest about being manual. CI is ubuntu-latest only and the suite's own rule (`fleetctl.test.mjs:18-24`) is that it never loads anything.
6. Drop "the label is the one that isn't" — the unfilled `PATH` literal is a counter-example.

## Process note

Both jurors were briefed that every plan this author wrote this week carried a false central claim. Both executed rather than read. The estate juror's cleanup was verified: three `com.plot-panel-test.*` labels booted out, `launchctl list | grep plot-panel-test` empty, and neither live supervisor addressed.

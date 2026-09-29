# Panel — a unit name follows the label (#1053)

Subject: `docs/plans/2026-09-29-a-unit-name-follows-the-label.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

**The premise survives and the failure is worse than the plan described.** The juror drove the real systemd arm on macOS under `stubPlatform` and reproduced the overwrite: two labels, one path, second write replaces the first, no refusal on the path.

## THE FINDING — the documented remedy is refused by the check that enforces it

The plan said *"there is no second job, no refusal"*. **There is a refusal — refusal 4 (`:672-700`) — and on systemd it is actively harmful.** It gates on `supervisor_loaded`, which asks the hardcoded name (`:156`). Executed, checkout B starting under its own label while A's default unit is active:

```
plot-fleetctl: 'com.plot-pm.registryd.ewz-kus-portal' is already loaded, and which
  checkout it serves cannot be determined
  Or, for a second checkout, give it its own label — skills/plot/units/README.md

CALL: --user is-active --quiet plot-registryd
```

**It names label B and reads unit A**, then tells the operator to do what they just did. So the override is not inert on Linux — it is **refused**. `units/README.md:7`'s *"a second checkout needs no hand steps"* is false in both directions.

This converts `Done when` #5 from a nicety into the core of the fix.

## The site table was wrong, and the omission matters

Eight listed, **nine real**. Missing `:786` (a failure message a grep gate would fire on) and **`:913` — `--stop`'s entire `disable --now plot-registryd`**, which `Done when` #5 depends on. The plan's Design said "nine" while its table showed eight, and the table is what an implementer works from.

Also **wrongly included `:731`**, the shipped template's own filename, which must never be derived.

Outside the script: `units/README.md:103-127`, and **`fleetctl.test.mjs:1297` computes the install target the same hardcoded way** — a second copy of the rule that would keep passing after the fix. `packages/` has zero, so *Board impact: none* holds.

## The mapping, decided rather than deferred

The plan left it to the slice. **Three of four candidate derivations fail an existing `Done when`:** `tr . -` and last-segment both break the default, and a bare prefix rule stutters on a dotless label (`plot-registryd-plot-registryd-ewz.service`). Last-segment also **collides** `com.a.portal` with `com.b.portal` — this plan's own defect, one level down.

The surviving rule: strip a leading `com.plot-pm.registryd.`, sanitise to `[A-Za-z0-9:_.-]`, prefix `plot-registryd-`, with the exact default as a named special case. **It lands on README:115's documented shape, so an operator who followed the README gets their file back.** Sanitisation is mandatory — `PLOT_FLEET_LABEL` is unconstrained and systemd's charset is not.

## "Nothing here can test it" was false

`plot-fleetctl.sh:111-117` resolves the platform through `PATH`, and `fleetctl.test.mjs:834-860`'s `stubPlatform` already exploits it — docstring: *"Stubbing them drives the REAL arm … on Linux and macOS alike"*, with a `systemctl` stub at `:853-857`.

**All five `Done when` items are assertable on this Mac.** The plan's Notes told the implementer the opposite, which would have sent a slice to CI for feedback available in seconds.

## #1051 did not overreach

`git log -S 'plot-registryd.service'` → `d80f32e1` (#1051, today 12:40), whose `--stat` does **not** include the `.service` file. The split was honoured; this plan duplicates nothing shipped — the one failure mode the brief warned about, absent here.

## Amendments folded in

1. The nine-site table, with `:913` and `:786` added and `:731` excluded as a non-routing site.
2. The refusal-4 defect, with its execution, promoted into the Motivation.
3. The mapping decided, with the two degeneracies and the sanitisation requirement.
4. `Done when` gains the refusal, `fleetctl.test.mjs:1297`, and `README.md:7`.
5. The testability claim reversed, with the harness named.

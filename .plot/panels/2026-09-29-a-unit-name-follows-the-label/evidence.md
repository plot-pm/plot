Position: amend
Evidence: executed

# The failure is real and under-described; the fix is the right shape and the plan's own site list is wrong

I executed the systemd arm on this macOS machine (it is drivable — see §5), reproduced the
overwrite, and found a **second defect in the same feature that the plan does not name**. The
central claim survives. The site table does not, and one `Done when` item is unachievable as
written.

---

## 1. The site count: the table is wrong, the prose number is right by accident

The plan's table lists **8 rows** while its prose says **"Ten sites hardcode `plot-registryd`"**
(`:38`). The table is missing two. The real list:

```
$ grep -n 'plot-registryd' skills/plot/scripts/plot-fleetctl.sh
 38:#   no plot-registryd.mjs      nothing to start; a broken Plot installation
 97:registryd="$script_dir/board/plot-registryd.mjs"
156:    systemd) systemctl --user is-active --quiet plot-registryd && return 0 ;;
167:    systemd) systemctl --user show plot-registryd -p MainPID --value 2>/dev/null \
191:    systemd) systemctl --user show plot-registryd -p WorkingDirectory --value 2>/dev/null \
280:    systemd) printf '%s' "$HOME/.config/systemd/user/plot-registryd.service" ;;
513:          systemd) echo "    systemctl --user enable --now plot-registryd" ;;
694:          *)       how="systemctl --user show plot-registryd" ;;
731:      template="$UNIT_DIR/plot-registryd.service"
732:      target="$HOME/.config/systemd/user/plot-registryd.service"
785:      systemctl --user enable --now plot-registryd || {
786:        echo "plot-fleetctl: systemctl --user enable --now plot-registryd failed" >&2
913:      systemd) systemctl --user disable --now plot-registryd >/dev/null 2>&1 ;;
```

**Two in-scope sites the table omits:**

- **`:786`** — the failure message beside `:785`. Trivial but it is a site, and a grep gate
  (`Done when` #2) will fire on it.
- **`:913`** — `--stop`'s `systemctl --user disable --now plot-registryd`. **This is not
  trivial.** `Done when` #5 says *"`--status` and `--stop` on systemd resolve the same name
  `--start` wrote"*, and `:913` is the entire `--stop` unload. The plan's table does not
  contain the line its own acceptance criterion depends on.

**Two sites that must stay hardcoded, and the plan does not say so:**

- **`:731`** — `template="$UNIT_DIR/plot-registryd.service"`. This is the **shipped template's**
  filename in `skills/plot/units/`, not the installed unit. It must never be derived.
- **`:97`** / **`:38`** — `plot-registryd.mjs`, the bundle. Unrelated.

So the routing count is **9 systemctl/target sites** (156, 167, 191, 280, 513, 694, 732, 785+786,
913), against the plan's "nine call sites" in the Design (`:67`) and "nine systemctl sites"
(`:98`) — which happens to be right — while the evidence table under it lists 8 and includes
`:731`, which must be excluded. **The table and the Design contradict each other, and the table
is the half an implementer will work from.**

**Sites outside the script.** I checked `skills/plot/units/`, READMEs, tests, and the board:

- `skills/plot/units/README.md` — lines 103, 109, 111, 115–117, 121–123, 126–127 all name
  `plot-registryd.service` / `plot-registryd` in the hand-install and the operator commands.
  The plan's `Done when` #4 already reaches this, but only for `:115`.
- `test/reconcile/fleetctl.test.mjs:455, 506, 538, 566, 1297` — fixtures naming the unit file.
  `:1297` in particular computes the install target the same hardcoded way the script does, so
  it is a **second copy of the rule** that will silently keep passing after the fix.
- Board / `packages/` — **zero**. `rules/supervisor-reading.ts` reads the exit code and the
  `summary:` line, not the unit name. The plan's "Board impact: none" is correct.

---

## 2. THE ONE THE PANEL ASKED ME TO DECIDE: `unit_name()` is sufficient, and the mapping is forced

The plan defers the mapping ("The slice decides the mapping and states it", `:71`). It is
decidable now, and deferring it is the risk.

`$LABEL` defaults to `com.plot-pm.registryd` (`plot-fleetctl.sh:84`). Three candidate derivations,
evaluated against the two hard constraints — **the default must produce `plot-registryd.service`**
(`Done when` #3) and **it must not orphan `units/README.md:115`'s `plot-registryd-<name>.service`**:

| label | A: `tr . -` | B: last segment | C: default-or-`plot-registryd-<last>` |
|---|---|---|---|
| `com.plot-pm.registryd` (default) | `com-plot-pm-registryd.service` ❌ | `registryd.service` ❌ | `plot-registryd.service` ✅ |
| `com.plot-pm.registryd.ewz-kus-portal` | `com-plot-pm-registryd-ewz-kus-portal.service` | `ewz-kus-portal.service` | `plot-registryd-ewz-kus-portal.service` ✅ matches README:115 |
| `plot-registryd-ewz` (no dots) | `plot-registryd-ewz.service` ✅ | `plot-registryd-ewz.service` ✅ | `plot-registryd-plot-registryd-ewz.service` ❌ |

**A and B both break the default**, which `Done when` #3 makes non-negotiable — every existing
Linux install depends on it. So the mapping is **C**, and C is exactly the shape the README
already documents. **An operator who followed `README:115` is not orphaned: they get their file
back.** That is the answer to the panel's question, and it is a *good* answer — but C has a
defect the plan must record:

**C is not injective and it degenerates on a dotless label.** `com.a.portal` and
`com.b.portal` both derive `plot-registryd-portal.service` — the exact collision this plan
exists to remove, reintroduced one level down. And a label with no dot (`plot-registryd-ewz`,
a perfectly legal `PLOT_FLEET_LABEL`) stutters into `plot-registryd-plot-registryd-ewz.service`.

**The fix is cheap and must be in the plan, not left to the slice:** derive from the whole label
with a stated normalisation, keeping the default as a named special case —

```
com.plot-pm.registryd                  -> plot-registryd.service          (exact-match default)
anything else, sanitised [^A-Za-z0-9_.-] -> _   ->  plot-registryd-<sanitised>.service
```

That is injective over legal labels, keeps the default, and still lands on README:115's shape for
the documented `com.plot-pm.registryd.<name>` form (as `plot-registryd-com.plot-pm.registryd.ewz-kus-portal`
— ugly, so the plan should instead state the rule as *strip a leading `com.plot-pm.registryd.`,
then sanitise the remainder*, which is injective **and** pretty). **Whichever it picks, the plan
must state it, because three of the four obvious derivations fail a `Done when` it already
carries.** Sanitisation is not optional: systemd unit names accept only
`[A-Za-z0-9:_.\-]`, and `PLOT_FLEET_LABEL` is an unconstrained environment variable.

---

## 3. Nothing already does this

```
$ git log --oneline -S 'unit_name' -- skills/
(no output)
```

No prior implementation. `git log -S 'plot-registryd.service'` surfaces `d80f32e1`
(*"plot-fleet: fill the launchd Label from PLOT_FLEET_LABEL"*, #1051, today 12:40). Its commit
message ends **"The systemd half is #1053"**, and `--stat` shows it touched
`plot-fleetctl.sh (7+-)`, `units/README.md`, and `com.plot-pm.registryd.plist` — **the
`.service` file is not in the diff.** #1051 did *not* go further than its plan said. This plan
is not duplicating shipped work. That is the one failure mode the panel warned about, and it is
absent here.

---

## 4. THE FAILURE IS REAL — AND WORSE THAN THE PLAN SAYS

I drove the real script with a stubbed `uname`/`systemctl` on `PATH`, two labels, one fake HOME:

```
### LABEL=com.plot-pm.registryd
filled .../home/.config/systemd/user/plot-registryd.service
### LABEL=com.plot-pm.registryd.ewz-kus-portal
filled .../home/.config/systemd/user/plot-registryd.service
--- units on disk:
.../home/.config/systemd/user/plot-registryd.service        <- ONE FILE
```

**Two labels, one path, second write replaces the first, no refusal.** `:732` is the write; the
only guard between it and the disk is the placeholder check at `:753-762`, which inspects the
*content* it just wrote and never asks whether the path was occupied. The plan's premise holds.

### The second defect, which the plan does not name

The plan says *"There is no second job, no refusal"* (`:59`). That is right about the unit file
and **wrong about the refusal** — there IS one, refusal 4 (`:672-700`), and on systemd it is
actively harmful. It gates on `supervisor_loaded`, which on systemd asks the **hardcoded** name
(`:156`). Executed, checkout B starting under its own distinct label while checkout A's default
unit is active:

```
plot-fleetctl: 'com.plot-pm.registryd.ewz-kus-portal' is already loaded, and which
  checkout it serves cannot be determined
  Read it before stopping it: systemctl --user show plot-registryd
  Or, for a second checkout, give it its own label — skills/plot/units/README.md

CALL: --user is-active --quiet plot-registryd
CALL: --user show plot-registryd -p WorkingDirectory --value
```

**The refusal names label B and reads unit A.** It tells the operator to "give this checkout its
own label" — which they just did. On systemd today the override is not merely inert: **the
documented remedy is refused by the check that exists to enforce it.** That is a strictly worse
failure than "does nothing", and it is the strongest argument for this plan. It should be in the
Motivation, and it converts `Done when` #5 from a nicety into the core of the fix — `:156`,
`:191` and `:913` are what make refusal 4 and `--stop` correct.

**This also makes `units/README.md:7` currently false** — it promises "A second checkout needs no
hand steps: `PLOT_FLEET_LABEL` gives it its own label", which on Linux is untrue in both
directions. README:7 belongs in `Done when` #4 beside `:115`.

---

## 5. Testability: the plan's "Nothing on this machine can test it" is FALSE, and that is the biggest amendment

`plot-fleetctl.sh:111-117` resolves the platform through `uname -s` and `command -v systemctl`,
both of which go through `PATH`. `test/reconcile/fleetctl.test.mjs:834-860` (`stubPlatform`)
already exploits exactly this, and its own docstring says so at `:803`:

> `platform` keys off `uname -s` and `command -v launchctl`, and both resolve through `PATH`.
> Stubbing them drives the REAL arm — the state machine, the summary line, and `exit $?` — on
> Linux and macOS alike.

It already writes a `systemctl` stub (`:853-857`). Everything in §4 above **was executed on this
macOS machine** with 12 lines of stub. So:

| `Done when` | testable here? |
|---|---|
| #1 `PLOT_FLEET_LABEL=x --start` writes a derived filename | **yes** — `stubPlatform({kernel:'Linux'})` + fake HOME, assert the path. Proven above. |
| #2 grep gate: no hardcoded `plot-registryd` in the systemd arm | **yes** — pure text, platform-irrelevant |
| #3 unset override still gives `plot-registryd.service` | **yes** — same harness, proven above |
| #4 mapping stated / README reconciled | **yes** — a docs assertion |
| #5 `--status`/`--stop` resolve the name `--start` wrote | **yes** — my §4 run drove `is-active`, `show -p WorkingDirectory`, and the stop arm is the same seam |

**All five are assertable here, in `test/reconcile/fleetctl.test.mjs`, with no Linux machine and
no CI round trip.** The plan's Notes (`:100-103`) tell the implementer the opposite — *"Nothing
on this machine can test it… The slice should say whether it verified on Linux or only by
reading"* — which licenses shipping an unverified slice when a real test is 12 lines away. That
paragraph is the single most damaging sentence in the plan and must be replaced.

It also mis-cites its own authority: `fleetctl.test.mjs:523` is quoted as *"a fleet that assigns
on macOS and not on Linux is a defect reproducing on half the installations"*, but the file's
own `:803` docstring is the line that settles the question, and it says the opposite of the
Notes' conclusion.

One real gap remains and should be stated rather than dropped: the stubs prove Plot **asks for**
the right unit name; they cannot prove **systemd accepts** it. That is what the sanitisation rule
in §2 is for, and `:1297` in the test file must be updated or it will keep asserting the old path.

---

## Against my own position

**The case for `proceed`:** the premise is true, I reproduced it, the fix shape (`unit_name()`,
route the call sites) is correct and matches the launchd arm, and #1051 explicitly deferred this.
Three of my five findings are things a competent implementer would hit in the first hour. If this
estate's bar were "is the plan directionally right", this is a proceed.

I reject that bar for one reason: `Done when` #5 names `--stop`, and the site table does not
contain `:913`. An implementer working the table ships a fix where `--start` writes
`plot-registryd-x.service` and `--stop` disables `plot-registryd` — **a supervisor that cannot be
stopped by the command that started it**, which is worse than today's overwrite because today at
least the names agree. That is not a polish note.

**The case for `reject`:** none that I can make. The work is real, needed, correctly scoped, and
nothing has shipped it. Rejecting would be rejecting for imprecision, and the imprecision is
fixable in four edits.

**Where I am least sure:** my §2 recommendation of the `strip-the-default-prefix, then sanitise`
mapping. C-with-last-segment is prettier and matches README:115 exactly, and the collision I
object to (`com.a.portal` vs `com.b.portal`) is one an operator has to construct deliberately.
A reasonable person could call that acceptable and keep the simpler rule. **What I am sure of is
that the plan must pick one and write it down** — because A and B, the two most obvious
derivations, both break the default that `Done when` #3 declares non-negotiable, and "the slice
decides" is how that gets discovered after the unit is written.

**On the site count:** I resolved the 8-vs-10 discrepancy as "9 to route, 2 to leave alone". I
cannot rule out that the author counted `:731` and `:97` deliberately and miscounted the table.
Either way the table, not the prose, is what gets implemented.

---

## The amendments

1. **Replace the site table** with the 9 routing sites, explicitly including `:786` and `:913`,
   and explicitly excluding `:731` (shipped template) and `:97`/`:38` (the bundle).
2. **Decide the mapping in the plan** (§2): state the rule, state that the default is an
   exact-match special case, and state the sanitisation to systemd's `[A-Za-z0-9:_.-]`.
3. **Delete the "Nothing on this machine can test it" paragraph** and replace it with the
   `stubPlatform` seam (`fleetctl.test.mjs:834`, docstring `:803`). Add `:1297` to the scope as a
   second copy of the target-path rule.
4. **Add the refusal-4 defect to the Motivation** (§4): on systemd, `supervisor_loaded` reads the
   hardcoded name, so a correctly-overridden second checkout is refused with a message naming its
   own label and reading the other checkout's unit. Add `units/README.md:7` beside `:115` in
   `Done when` #4.

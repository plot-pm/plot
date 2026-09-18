# Juror: the operator

Position: amend

Lens: a person looks at the board, sees a banner, and does what it says. The question is whether the states this plan distinguishes are ones a person can act on *differently*.

---

## Finding 1 (strongest) — `--start` is not "the wrong repair". It fixes all three states, and the plan's own source quote says so.

The plan's premise, stated in its subtitle and again in the Design section:

> "a unit launchd was never told about is reported as no unit at all — **and the board prints the repair that cannot fix it**."

and, in the table:

> | `interrupted` | ... | `launchctl bootstrap gui/$(id -u) <unit>` |
> | `not-installed` | ... | `/plot-fleet --start` |

**This is false, and the script the plan is quoting states the opposite three lines below the passage the plan quotes.** `plot-fleetctl.sh:326`:

```
        echo "  Nothing needs re-cutting: /plot-fleet --start also does this, and starts agents too."
```

That line is inside the `interrupted)` arm. The script tells an interrupted operator that `--start` is a valid repair — a *superset* repair, in fact, since it also brings up agents that an interrupted run never cut.

I traced `--start` to confirm the script's claim rather than take it. On an `interrupted` machine (`plot-fleetctl.sh:383-560`):

- **Refusal 1** (`:385`) — `registryd` artifact present. Unaffected by install state.
- **Refusal 2** (`:391`) — node major. Unaffected.
- **Refusal 3** (`:407`) — platform. Unaffected.
- **Refusal 4** (`:416`) — `if supervisor_loaded;` → **refuses only when the supervisor is ALREADY LOADED.** `interrupted` is by definition *not loaded* (`fleet_install_state:204` tests `supervisor_loaded` first and returns `running` if so). **So refusal 4 cannot fire on an interrupted machine.**

Then `:459-462` rewrites the unit unconditionally (`sed ... > "$target"`), `:470` re-verifies the fill, `:487` `plutil -lint`, and `:493`:

```
      launchctl bootstrap "gui/$(id -u)" "$target" || {
```

**`--start` runs the exact command the plan wants the banner to print.** The banner's current text — *"Start it: /plot-fleet --start"* — is correct for `interrupted`. There is no wrong repair to fix.

The plan's central claim rests on a *partial* quote of the comment at `:303-309`. The full comment reads:

```
    # THREE STATES WHERE THERE WERE TWO, AND THE REPAIR IS PRINTED. The two
    # failures read identically to a person and cost differently: an operator
    # who reads *not loaded* and runs `--start` on a machine whose unit is
    # already filled pays for the wrong repair, and on one already running
    # agents may add more.
```

The complaint is **cost**, not **correctness** — "pays for the wrong repair" in the sense of *pays more than necessary*, which is why the very next line the plan omits offers `--start` as valid anyway. The plan reads "wrong repair" as "cannot fix it" and builds two slices on that reading.

**Amend, not reject**, because the *second* half of the comment's cost claim is real and the plan does not check it either — see Finding 2.

---

## Finding 2 — the "may add more agents" cost is largely already handled, so the amended justification is thinner than the plan assumes.

The comment's second cost: *"on one already running agents may add more."* I checked whether `--start` actually over-adds. `plot-dispatch.sh:1865-1880` counts live workers from desks on disk:

```
  start_running=0
  ...
    [ -f "$wt/.plot-worker.pid" ] || continue
    p=$(cat "$wt/.plot-worker.pid" 2>/dev/null) || continue
    [ -n "$p" ] && ps -p "$p" >/dev/null 2>&1 && start_running=$((start_running + 1))
```

with the comment at `:1841`:

> "The count is what `fleetSize` subtracts, so asking for three twice gives three agents rather than six."

And `rules/fleet-size.ts` confirms the subtraction is the rule's first move:

> "**THE COUNT IS A REQUEST AND THE MACHINE HAS THE LAST WORD.** The request is reduced by what is already running and then by what the machine can bear, in that order: a fleet already at its size needs nothing started whatever the load"

**So `--start` on a machine already running three agents starts zero.** The "may add more" cost is bounded by the fleet size rule and is not the runaway the plan implies. What `--start` *does* cost on an interrupted machine that already cut some desks is a unit re-fill and a `launchctl bootstrap` — seconds — plus however many agents are short of the configured size, which is work that *should* happen since the interrupted run didn't finish cutting them.

**This leaves the plan's operator benefit as: "the banner could offer a cheaper repair."** That is a real but small improvement, and it is not what the plan says it is delivering.

---

## Finding 3 — `installed` is the state with a genuine operator problem, and the plan treats it as an afterthought.

The plan says:

> "This is a smaller defect than the missing bit and it is in the same three lines, so it is fixed here rather than filed separately."

I think this is backwards. `installed` means: unit on disk, start marker present, supervisor **not** loaded. How does a machine get there? `--stop` removes the marker only after a successful unload (`plot-fleetctl.sh:635-638`):

```
      echo "  supervisor unloaded"
      # THE MARKER GOES WITH THE SUPERVISOR, and only once it is actually gone.
      ...
      rm -f "$(start_marker)"
```

So `installed` is reached when a `--start` **completed fully** and the supervisor **later died or was booted out** without `--stop` — a crash, a logout, a `launchctl bootout` by hand, an OS update. That is the *unexplained* outage: nothing the operator did produced it.

Today that machine reads *"supervisor: not installed — no unit on this machine"*, which the plan correctly calls "false on its face". For the operator this is the worst of the four messages, because it describes a machine that never had a fleet when in fact one was running and stopped on its own. And the repair genuinely differs in *diagnosis* if not in command: an operator told "not installed" will not think to look at `.plot/logs/registryd.log` for why the daemon died, and a crash-looping supervisor will simply crash again after `--start`.

**The plan's ranking of its two defects is inverted relative to operator harm.** `interrupted` prints a repair that works and merely costs more; `installed` prints a sentence that is factually false about the machine and hides a crash.

---

## Finding 4 — slice 2 contradicts the rule `supervisor-reading.ts` states, and the plan asserts otherwise without arguing it.

The plan claims:

> "A third state keeps that rule: it names a consequence and a repair, not a component."

The rule, `packages/domain/src/rules/supervisor-reading.ts` (the `supervisorVerdict` docblock):

> "`plot-registryd.mjs`, the launchd label `com.plot-pm.registryd` and the internal state `up` describe one process in three machine-side vocabularies, **and the board is the one surface where a reader should meet none of them.**"

Slice 2's Done-when:

> "an interrupted fleet renders a banner naming `launchctl bootstrap` — or the platform's equivalent — rather than `/plot-fleet --start`"

`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.plot-pm.registryd.plist` is **all three** forbidden vocabularies at once: the launchd tool, the launchd label, and a path into the machine's internals. The rule's own worked example is that `unsupervised` was rejected as a *badge label* for naming a component — and this is far past a badge label.

The rule's positive form is equally explicit:

> "A person types `/plot-fleet --start`, `/plot-fleet --status` and `/plot-fleet --stop`. There is no `/plot-supervisor` command, no skill by that name, and nothing a reader can address"

**`/plot-fleet --start` is the only fleet vocabulary the board is permitted to print — and, per Finding 1, it is also a correct repair for the interrupted state.** The banner it prints today satisfies both the rule and the operator. Slice 2 as written would break the rule to print a command that is not needed.

The plan does not engage this. It asserts the rule is kept in one sentence in *What this is NOT*, with no analysis of the raw command it proposes.

---

## What I would amend

1. **Drop the "wrong repair" framing.** It is refuted by `plot-fleetctl.sh:326` and by refusal 4's condition at `:416`. Re-state the defect as what it is: *the board cannot tell three kinds of stopped apart, and one of the three prints a sentence that is false about the machine.*

2. **Promote `installed` to the plan's subject.** It is the state whose banner is factually wrong and whose cause is an unexplained death. `interrupted` is a cosmetic/cost improvement by comparison.

3. **Slice 2 must not print `launchctl`.** If a cheaper repair is worth surfacing, it belongs behind `/plot-fleet --status`, which is a command a reader can address and where machine vocabulary is explicitly permitted ("Those words stay correct where a machine reads them — `plot-fleetctl.sh` and `DESIGN-process.md` are unchanged"). A board sentence like *"The fleet stopped on its own. Check why: /plot-fleet --status"* names a consequence and an addressable repair, and keeps the rule.

4. **Reconsider two slices.** `supervisorVerdict` sets `shown: false` for `up`, so this banner is only visible while a fleet is stopped — and on this machine the fleet is up (`--status` exit 0, `summary: ... supervisor=up`). With the `interrupted` case reduced to a cost optimisation and `installed` needing only a corrected sentence, slice 1's optional `SupervisorRun` field plus one extra `supervisorVerdict` case is plausibly one slice. The plan's own verification burden — a browser test, byte-identical pins on two existing banners — is sized for a defect larger than the one that survives Finding 1.

---

## What the plan gets right

- The diagnosis in **Notes** is honest and correct: every timeout path leads to `unknown`, not `down`, and recording the wrong first diagnosis is the right practice.
- Refusing to fold the latency finding into this plan is correct and well-argued.
- Keeping the exit code unchanged (slice 1) is right — three callers read it, and `supervisorState` treats 0/1 as the contract (`supervisor-reading.ts`, `supervisorState`).
- Carrying the new field as **optional** so an older script behaves as today is the right compatibility shape.

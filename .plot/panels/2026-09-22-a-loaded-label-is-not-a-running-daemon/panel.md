# Panel moderation — a loaded label is not a running daemon

**Subject:** `docs/plans/2026-09-22-a-loaded-label-is-not-a-running-daemon.md`
**Reconciliation:** one lens, `amend`, gated.

## The verdict in one line

> The plan's **diagnosis of the symptom is sound; its account of the mechanism, its chosen reading, and its cited precedent are each wrong in a way that would ship into the code.**

The juror reproduced the defect and endorsed the framing: *"a status command exists to be believed when something is broken, and this one is confidently wrong in exactly that case."* Everything else needed correcting.

## The finding that outranks the rest

**The label under measurement was a leaked test unit.** Verified in this session:

```
launchctl print … path = /private/var/folders/.../plot-fleetctl-start-interrupted-tk8DCK/
                         …/com.plot-pm.registryd.test-start-interrupted-25315.plist
                  runs = 43
leaked directories on this machine: 103
```

Its stub registryd exits 0 instantly with an empty error log — **reproducing every symptom in the plan's evidence table**. And because launchd keys by label, this repository's own `~/Library/LaunchAgents/com.plot-pm.registryd.plist` existed and could never load.

**So the plan's evidence described a test leak, not production.** The symptom it fixes still stands — a status command that reads a loaded label as a running daemon lies whoever loaded the label, and a leaked test unit is one more way to reach that state. But the two measured deaths were not what the plan said they were.

**The leak is a separate defect** and is recorded in the plan's Notes: `fleetctl.test.mjs` should not be able to leave a unit bound to the production label. The leaked unit was booted out by hand.

## Three facts corrected

| the plan said | measured |
|---|---|
| `KeepAlive` did not restart it | **it does** — `runs` 38→39→40 in ~40 s; the deaths were a throttled crash loop |
| `launchctl list`'s `-` means launchd declining | columns are `pid \| last-exit \| label`; the `-` is column one |
| `plot-boardctl.sh` requires two facts to agree | that is `--stop`'s rule; its `--status` reports three facts and reconciles none |

**The third correction changes the design rather than the prose.** Read correctly, the precedent argues for **reporting both readings on separate lines** instead of folding them into one verdict.

## Two things the plan got exactly right

`--status` must not derive liveness from tick age, and must start nothing. Both stated clearly, both correct, both kept.

## What the amendment does

1. **`supervisor_pid`, not `ps | grep`** — it exists, is already called in the arm being changed, is scoped to the label, cannot be flipped by a sibling agent's command line, and does not regress the systemd arm where `is-active` already answers correctly.
2. **Both readings on separate lines**, per the corrected precedent.
3. **`install=` must move with it** — `fleet_install_state` returns `running` for any loaded label; the slice states whether it gains a third state or `supervisorState` gains the matching arm.
4. **The test promise is scoped to what CI can reach** — the launchd arm is unexercisable under `ubuntu-latest`, which the script already concedes.
5. **The stale Notes are corrected**: the cause has its own plan and it merged the same day.

**The plan is amended and stays Draft.** The corrections are in the file; a caller may approve it now or send it back.

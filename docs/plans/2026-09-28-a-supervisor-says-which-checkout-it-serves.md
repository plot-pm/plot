# A supervisor says which checkout it serves

> `--start` refuses when a unit with its label is already loaded and cannot say **whose**. The loaded unit already records the answer in `WorkingDirectory`; nothing reads it.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1048
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- A refusal names the checkout whose supervisor holds the label, and `--status` says which checkout it is serving.

Board impact: none. Fleet control's own reporting.

## Motivation

`plot-fleetctl.sh:47-50` states the refusal and its reason:

> a unit with that label is already loaded — launchd keys by LABEL; a second repository needs a distinct one, and loading over the first would silently supervise the wrong estate.

The reasoning is right. What the operator gets is a refusal naming a label, not a repository — so *"which of my checkouts is that?"* takes a manual `launchctl print`.

**The board already solved this shape.** `plot-boardctl.sh --status` reads `server.repo` from `/api/board` and answers *"serving THIS repository"* or *"serving ANOTHER checkout (…)"* — and that line is what makes a refusal actionable rather than merely correct. Fleet control has no equivalent.

### The fact is already in the unit, and the printed key is not the written one

The installer writes it — `units/com.plot-pm.registryd.plist:39-40`:

```xml
<key>WorkingDirectory</key>
<string>__REPO_ROOT__</string>
```

**`launchctl` prints it under a different name, in a different domain.** Both were measured 2026-09-28 against the live supervisor:

```
$ launchctl print "gui/$(id -u)/com.plot-pm.registryd"
	working directory = /Users/jwloka/Quatico/Agentic-Tools/plot
	environment = {
		PLOT_REPO_ROOT => /Users/jwloka/Quatico/Agentic-Tools/plot
	}
```

Exit 0, no sudo, and the fact is readable twice over. **Nothing needs to be added to the unit — only read from it.**

Two corrections that a builder cannot infer from the XML above, and each produces a silent wrong answer rather than an error:

- **The domain is `gui/$(id -u)`, never `system/`.** The unit is a LaunchAgent — `plot-fleetctl.sh:686` bootstraps it into `gui/`, and `:155`/`:166` already read from there. `launchctl print system/<label>` returns `Bad request. Could not find service … in domain for system`.
- **The printed key is `working directory`** — lowercase, space-separated. `launchctl print … | grep -c 'WorkingDirectory'` returns **0**. Extract it with:

  ```sh
  sed -n 's/^[[:space:]]*working directory = \(.*\)$/\1/p'
  ```

  verified against two live jobs.

**Both mistakes route into *cannot determine*, which this plan calls the safe answer** — so neither would be caught by any assertion below. The written key and the printed key are different strings and the plan must not quote one as evidence for the other.

## Design

### The rule

**A refusal about a loaded label names the checkout that holds it, and `--status` names the checkout it serves.**

Read `WorkingDirectory` from the loaded job, compare it to this checkout's root, and say one of three things: this repository's, another checkout's (named), or not determinable.

### Three answers, not two

The board's `--status` is the model, and the third case matters:

- **this repository's** — nothing to do
- **another checkout's, named** — the operator sees which, and #1051 gives them a way to run both
- **unreadable** — say *cannot determine* rather than guessing either way. The reachable causes are an **exit 113**, which is launchd's answer for a label it does not hold and which `plot-fleetctl.sh:141-151` records having leaked out as an exit code once; a job in another user's domain; and a hand-written unit. *"The job predates this field"* is **not** among them: `git log --diff-filter=A` and `git log -S WorkingDirectory` both return the single commit `f8cb6b03`, so the template has never existed without the field. `launchctl print`'s failure codes are not uniformly 1.

**An unreadable answer must not become "yours".** A refusal that wrongly claims the label is another checkout's is annoying; one that wrongly claims it is yours invites an overwrite of somebody else's supervisor.

### Not a second identity mechanism

`WorkingDirectory` is the identity. Do not add a `PLOT_REPO` env, a sidecar file, or a name in the label — the label is #1051's subject and it is the operator's to choose. This plan reads what the installer already wrote.

### What this does NOT do

- **It does not change the refusal itself.** `--start` still refuses on a loaded label; it says more about it.
- **It does not unload or overwrite anything**, ever, on any answer.
- **It does not make the label unique.** That is #1051.
- **It does not touch `plot-boardctl.sh`.** That command already does this and is the pattern being followed.

### systemd answers differently, and has no second checkout to name

`launchctl print` does not exist on Linux. The counterpart is:

```sh
systemctl --user show plot-registryd -p WorkingDirectory --value
```

**Unverified** — this was read, not run; no Linux machine was available.

**The three-way answer degenerates to two on Linux**, and that is not a wording problem. `plot-fleetctl.sh:156`, `:167`, `:220` and `:648` hardcode one unit name, so two Linux checkouts share one unit file — there is never a second job whose checkout could be named. The *another checkout's, named* answer is unreachable there until #1053 lands.

## Done when

- `--start` against a label held by another checkout names that checkout's path in the refusal.
- `--start` against a label held by **this** checkout says so, and still refuses.
- **An unreadable `WorkingDirectory` answers *cannot determine* and still refuses** — asserted, because the permissive misreading is the dangerous one.
- `--status` names the checkout the loaded supervisor serves, in the shape `plot-boardctl.sh --status` uses.
- Nothing is unloaded or overwritten on any path, asserted through the suite's existing `guardBin` seam (`fleetctl.test.mjs:276`, passed to `run`) rather than a call counter described in the abstract. The suite's own rule is that it never unloads anything (`fleetctl.test.mjs:18-24`), and its baseline is green: 48 tests, 48 pass, measured 2026-09-28.
- **The reading is asserted against `launchctl print`'s real output, not the plist.** A test that greps `WorkingDirectory` passes against the template and finds nothing in the printed job.

## Slices

### A supervisor says which checkout it serves (Branch: bug/a-supervisor-says-which-checkout-it-serves)

Read `WorkingDirectory` from the loaded job, add the three-way answer to the refusal and to `--status`.

## Notes

**This is the half of #1051 that is visible to an operator.** That issue makes two supervisors possible; this makes the collision legible when it happens. Either can ship first **on macOS**, and shipping only this one leaves an operator correctly informed that they cannot proceed.

**On Linux the dependency runs the other way** and the original claim was wrong: two checkouts share one unit file there, so until #1053 gives systemd a per-checkout unit name there is no second job for this command to name.

**The second checkout is live on this machine and makes the hardest assertion cheap.** `com.plot-pm.registryd.ewz-kus-portal`, pid 30516, `working directory = /Users/jwloka/Quatico/ewz/ewz-kus-portal` — installed by hand. A builder can test the *named checkout* answer against a real foreign job without loading anything.

### Round 1, 2026-09-28

One juror, **amend**, **executed**. Moderation: `.plot/panels/2026-09-28-a-supervisor-says-which-checkout-it-serves/panel.md`.

The design premise survives — the fact IS in the loaded job, readable without sudo, on two jobs. **The two lines saying how to obtain it were both wrong**, and both fail silently into *cannot determine*, which this plan calls the safe answer: `system/` is the wrong domain, and the printed key is `working directory` rather than `WorkingDirectory`. The plan quoted its input and described it as its output.

Also folded in: the third answer's stated cause cannot exist (one commit added the template and the field together), the systemd counterpart and its missing second-checkout case, and the `guardBin` seam for the write-count bullet.

`plot-boardctl.sh` is the precedent throughout — it learned on 2026-09-04 that a pid and a port do not identify a board, and the answer was to read what the process serves. The same question, one subsystem over.

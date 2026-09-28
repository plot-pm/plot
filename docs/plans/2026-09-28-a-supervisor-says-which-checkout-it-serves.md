# A supervisor says which checkout it serves

> `--start` refuses when a unit with its label is already loaded and cannot say **whose**. The loaded unit already records the answer in `WorkingDirectory`; nothing reads it.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1048
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- A refusal names the checkout whose supervisor holds the label, and `--status` says which checkout it is serving.

Board impact: none. Fleet control's own reporting.

## Motivation

`plot-fleetctl.sh:47-50` states the refusal and its reason:

> a unit with that label is already loaded — launchd keys by LABEL; a second repository needs a distinct one, and loading over the first would silently supervise the wrong estate.

The reasoning is right. What the operator gets is a refusal naming a label, not a repository — so *"which of my checkouts is that?"* takes a manual `launchctl print`.

**The board already solved this shape.** `plot-boardctl.sh --status` reads `server.repo` from `/api/board` and answers *"serving THIS repository"* or *"serving ANOTHER checkout (…)"* — and that line is what makes a refusal actionable rather than merely correct. Fleet control has no equivalent.

### The fact is already in the unit

`units/com.plot-pm.registryd.plist:39-40`:

```xml
<key>WorkingDirectory</key>
<string>__REPO_ROOT__</string>
```

The installer fills it. A loaded job carries it, and `launchctl print system/<label>` prints it. **Nothing needs to be added to the unit — only read from it.**

## Design

### The rule

**A refusal about a loaded label names the checkout that holds it, and `--status` names the checkout it serves.**

Read `WorkingDirectory` from the loaded job, compare it to this checkout's root, and say one of three things: this repository's, another checkout's (named), or not determinable.

### Three answers, not two

The board's `--status` is the model, and the third case matters:

- **this repository's** — nothing to do
- **another checkout's, named** — the operator sees which, and #1051 gives them a way to run both
- **unreadable** — `launchctl print` failed, or the job predates this field. Say *cannot determine* rather than guessing either way.

**An unreadable answer must not become "yours".** A refusal that wrongly claims the label is another checkout's is annoying; one that wrongly claims it is yours invites an overwrite of somebody else's supervisor.

### Not a second identity mechanism

`WorkingDirectory` is the identity. Do not add a `PLOT_REPO` env, a sidecar file, or a name in the label — the label is #1051's subject and it is the operator's to choose. This plan reads what the installer already wrote.

### What this does NOT do

- **It does not change the refusal itself.** `--start` still refuses on a loaded label; it says more about it.
- **It does not unload or overwrite anything**, ever, on any answer.
- **It does not make the label unique.** That is #1051.
- **It does not touch `plot-boardctl.sh`.** That command already does this and is the pattern being followed.

## Done when

- `--start` against a label held by another checkout names that checkout's path in the refusal.
- `--start` against a label held by **this** checkout says so, and still refuses.
- **An unreadable `WorkingDirectory` answers *cannot determine* and still refuses** — asserted, because the permissive misreading is the dangerous one.
- `--status` names the checkout the loaded supervisor serves, in the shape `plot-boardctl.sh --status` uses.
- Nothing is unloaded or overwritten on any path, asserted by a test that counts `launchctl` write calls as zero.

## Slices

### A supervisor says which checkout it serves (Branch: bug/a-supervisor-says-which-checkout-it-serves)

Read `WorkingDirectory` from the loaded job, add the three-way answer to the refusal and to `--status`.

## Notes

**This is the half of #1051 that is visible to an operator.** That issue makes two supervisors possible; this makes the collision legible when it happens. Either can ship first, and shipping only this one leaves an operator correctly informed that they cannot proceed.

`plot-boardctl.sh` is the precedent throughout — it learned on 2026-09-04 that a pid and a port do not identify a board, and the answer was to read what the process serves. The same question, one subsystem over.

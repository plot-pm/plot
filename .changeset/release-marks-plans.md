---
"plot": minor
---

`/plot-release` records the release in the plans it shipped.

Plot's fourth phase had never been reached — not once across sixteen versioned releases. Step 4 hands off to the project's own release machinery, which is correct, and nothing came back afterwards: the version shipped, the tag landed, and the plans describing that work sat at Delivered forever.

New step 5b closes it. For each delivered plan it resolves the version **from git rather than from dates** — the last `→ #N` annotation, its merge commit, and the release tag containing it. The delivery date records when a plan was *booked*, not when its code merged; those can be months apart, and two tags may share a date, so day resolution cannot separate them even in principle.

Three things it deliberately refuses to do. It **skips docs/infra plans**, because `/plot-deliver` already told their authors they are live on merge. It **leaves unresolvable plans alone** and says so — an invented version in a transition record is a claim nobody re-checks. And it **does not move the symlink**: `delivered/` means "no longer active", not "phase is exactly Delivered".

The step ends with a gate in the shape `/plot-deliver` step 7b established, because this is a multi-file write followed by a push — worse than delivery's, since it touches N plans and a partial write leaves some released and some not with nothing to say which. `unreleased_delivered=0` from the real sweep clears it; anything else is a hard stop.

It reports what it did **not** mark, with the reason. A silently skipped plan looks identical to a plan with nothing to do — precisely the confusion that hid this for sixteen releases.

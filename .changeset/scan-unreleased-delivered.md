---
"plot": minor
---

The reconcile sweep finds delivered plans that already shipped.

Plot's fourth phase had **never been reached** — not once across sixteen versioned releases. Nothing compared the two facts: `/plot-release` ships a version, and the plans describing that version stay at Delivered. Neither side is wrong alone, so neither complained.

Section 6 asks the question git can answer exactly: *which release tag contains this plan's merge commit?* Deliberately **not** a date comparison — the delivery date records when a plan was booked, not when its code merged (one plan here sat five months between the two), and two tags in this repo share a date, so day resolution cannot separate them even in principle. `plot-host.sh pr-state` now carries `mergeCommit` so the adapter, not the caller, owns that lookup.

docs/infra plans are skipped by type: `/plot-deliver` already tells their authors "live on main — no release needed", and reporting them would contradict a message Plot itself sends, on every sweep, forever. A plan with no PR annotation is reported as **unresolvable** rather than skipped — "cannot tell" and "nothing wrong" must not look the same, which is the confusion this whole section exists to end.

The six delivered plans in this repo are back-filled with the versions that actually shipped them (v1.0.0 through v2.2.0, and one correctly still unreleased). `plot-plan-meta.sh` gains `released_raw` so the version is readable rather than re-derivable.

Found while building it: adding a field to the parsed rows leaked the field separator into section 2's output, because one read loop still named seven fields. A test now pins that no report line may contain it — the same class as the tab-collapse bugs this suite has caught twice.

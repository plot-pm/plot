---
"@plot-pm/board": patch
---

plot: the parser reads every documented PR form, and reports the near-miss

`prs` is the field four gates read — `/plot-deliver`'s merged check,
`/plot-release`'s version resolution, the sweep's section 6, the fleet scan —
and until now no test in `parser.test.mjs` took it as its subject. The two
existing mentions are incidental assertions inside `issues` tests. Six tests
now pin it, and they found two defects.

**`→ owner/repo#N` was dropped.** `/plot-deliver` step 4 instructs
implementers to write it for `Impl: other repo` plans and names it again in
its split-home clause, but `prs` matched `→ #[0-9]+` only. A split-home plan
therefore reported `prs: []` beside `impl: other-repo` and `error: null` — a
delivery gate reading "no PRs" for a plan whose only PR was written exactly as
documented. No plan in this repo uses the form yet, so the defect was latent
and would have struck the first adopter. The repo part is matched but not
retained: callers ask which PRs are the evidence, and `plot-host.sh` resolves
where each one lives.

**`→#N` without the space was dropped silently.** The annotation is written by
hand and that is the obvious slip. Accepting it would widen the contract on a
guess about intent; dropping it is worse, because *no annotation* is a claim
the sweep acts on — it prints "cannot resolve a version" and sends a human to
add an annotation the plan already carries. It is now reported in a new
`malformed_prs` field, verbatim, and `prs` stays strict.

**The strictness itself is now pinned as intended rather than accidental.**
Plans cite PR numbers constantly as history — this repo's
`a-plan-row-is-not-a-branch-row` names #175 and #191 in prose as prior art,
and neither delivered it — so a body scan cannot tell a signal from a
citation. The tests assert that `(#101)`, a bare `#102` in prose, and an
arrow outside `## Branches` all contribute nothing.

Measured additive: every one of the 84 plans in `docs/plans/` was parsed
through the old and new script and compared on `prs`. Zero differ.

<!--
bumps:
  skills:
    plot: patch
-->

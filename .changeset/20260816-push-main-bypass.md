---
"plot": minor
---

Plot now reports when a push to the default branch bypassed branch protection.

`/plot-approve`, `/plot-deliver` and the hub's phase-fix sequence push a
disposable branch straight at the default branch. Where protection is
configured but not enforced for the pushing actor, the remote waves the push
through — exit 0, with only a notice on stderr — so the documented "if that
push is rejected" fallback never fired, and bookkeeping commits landed past a
rule requiring a pull request without the required check ever running.

The new `plot-push-main.sh` performs the push and classifies the outcome:
`clean`, `bypassed` (landed, protection waived — it names the rules stepped
over and the checks that did not run), `unknown` (landed, the remote said
something unrecognised — never reported as clean), or `rejected` (exit 1, the
only outcome where the micro-PR fallback applies). The exit code answers one
question: did the commit land?

The plan template also gains an optional `Story:` field, which the plan parser
and the board have always read but the template never offered.

<!--
bumps:
  skills:
    plot: minor
    plot-approve: minor
    plot-deliver: minor
-->

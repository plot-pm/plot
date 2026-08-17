---
"plot": minor
---

A pull request's condition now travels to the board as data rather than as a
sentence, and `conflicts` stops masquerading as `no checks`.

`AgentRow.pr` grew from `{ number, url }` to carry the PR's own state:
`{ number, url, draft, state }`, where `state` is one of `green`, `pending`,
`failing`, `none`, `conflicts` or `unknown`. Everything else about a PR — green,
draft, no checks — used to exist solely inside the row's note, assembled by
different branches of the server's classifier. That is why one row read
`PR #57 green` and the next `PR #116, no checks`: nothing downstream could make
them agree, and nothing could render a badge from a sentence without parsing it
back apart.

**`draft` stays a separate boolean and is deliberately not one of the states.**
It answers a different question — *is this offered for review* — and the two are
independent: a draft has CI like anything else, which `draftNote` already says
("draft, CI running"). Folding it into the enum would move the short-circuit
that kept WAITING ON A MACHINE empty out of the classifier and into the
contract, where it is harder to see and shared by every consumer.

**`conflicts` needed one field from the host.** `plot-host.sh pr-list --rich`
now fetches `mergeable` (with `mergeStateStatus` corroborating), because GitHub
starts no workflow for a branch that does not merge cleanly — so a conflicting
PR reports an *empty* check rollup and read as `no checks`, indistinguishable
from a bot PR whose run awaits a human click. One wants a rebase, the other
wants a click. Measured twice on this repo's own PRs: #149 and #160 both said
`no checks` while GitHub said *this branch has conflicts that must be resolved*.

`conflicts` outranks `none` where both hold, because it is the cause and the
other its consequence. A workflow genuinely awaiting a human still says
`no checks`.

Bitbucket reports `mergeable: "unknown"`, following the precedent beside it:
`bb pr list` carries no mergeability verdict any more than it carries a check
rollup, and the honest gap beats an invented answer. Consumers must not read it
as clean — absent is not false.

Nothing new renders yet: this is the field the row's PR cell will be built from.

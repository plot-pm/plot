---
"plot": minor
---

plot: an issue becomes a Draft plan

The issue row has carried an empty actions cell since #236, with a comment
saying why: an empty menu is better than one offering something that does not
work yet. This fills it with the row's one action.

*Create plan* hands the issue to `/plot-idea` as a problem statement and stops
at **Draft**. That boundary is the design rather than a detail: the row exists
because an issue is *not a plan in an earlier state, it is a signal that has not
become one yet*, and the decision it asks for is *is this worth planning?* An
action that produced an approved plan would answer that question instead of
posing it, so the armed label names the boundary — `Create plan — Draft for
#228?` — and the prompt says it twice more.

**The reference is what makes the row disappear.** The created plan records
`- **Issue:** #<n>` in its `## Status` block, which is the field the board reads
to know an issue has become a plan. Get it wrong and the row survives its own
answer — the exact failure this feature exists to remove — so the round trip is
asserted by parsing a plan built from the prompt's own instruction with
`plot-plan-meta.sh`, never by matching a string. Both plan templates gained the
field as a documented, optional slot; its example `#228` sits inside an HTML
comment, and `strip_placeholder` was verified to drop it rather than have every
new plan silently claim to answer that issue.

**Nothing is written to the tracker.** The one new host op — `issue-view` —
reads one issue's body, and the adapter test asserts against the argv `gh`
actually receives that no `comment`, `edit`, `close`, `label` or `lock` reaches
it. Plot reads the tracker and never writes to it; a plan referencing an issue
is Plot's record, not the tracker's.

`issue-list` deliberately omits bodies because it runs on the 60 s PR timer for
every open issue. `issue-view` asks for the one issue somebody just pointed at,
so its cadence is a human's — one call per click, none per refresh. It reuses
`issue-list`'s exit codes (4 = this host cannot be asked, non-zero = the lookup
failed) so a consumer needs one mapping rather than two.

`POST /api/idea` is the shape `/api/approve`, `/api/continue` and `/api/dispatch`
already established, not a fourth one: the same-origin guard and the bounded body
reader are IMPORTED from `dispatch.ts` rather than restated, because a second
copy of a security decision is a second place for it to be weakened. The request
carries **only a number** — the title and body are read from the host by the
server, so no text a page holds can become the problem statement an agent runs
on — and the statement reaches the repo as a FILE whose path travels in the
environment, because `Idea command` is a shell fragment and an issue body is
written by whoever can file an issue.

A tracker that cannot be asked offers no action, and the guarantee turned out to
be structural: wave 1 renders issue rows only where `issueAnswer === 'answered'`,
so `unsupported` and `failed` produce no row at all — better than a disabled
button, so it was kept. `refusalReason` remains as defence in depth for the day a
row reaches the page on a `failed` answer, which is reachable in principle since
a failed lookup keeps the last good list; its branches are pinned by unit test
rather than left to a page that cannot show them.

`Idea command` is a new agent-runner key, and it is REQUIRED where
`Approve command` is optional. Approving has `plot-approve.sh` to fall back to;
creating a plan has no such script and cannot have one, since every step of
`/plot-idea` is judgement and no script here can invoke a skill. An absent key
therefore refuses and names itself, rather than accepting the click and doing
nothing — and the spawn sets `PLOT_UNATTENDED=1` and states the Type, because
`/plot-idea` unattended stops without one and writes no plan file, which is
exactly the exit-0-having-done-nothing failure `docs/unattended.md` documents.

<!--
bumps:
  skills:
    plot: minor
    plot-idea: minor
-->

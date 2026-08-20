---
"@plot-pm/board": minor
---

board: an eligible row says whether it can actually be started

Reported from the live board on 2026-08-19: nine rows reading *eligible —
nobody has taken it*, and not one of them could be started. Every one was
missing the brief a worker is told to read first.

**The wave arithmetic was right, and that is what made the row misleading.**
`plot-fleet-scan.sh` calls a wave eligible when every non-deferred branch in
every prior wave is merged, and those branches genuinely were next. The row
told the truth about waves and stopped there — so it named a state, implied an
action, and the action did not work: an operator following it runs
`/plot-dispatch`, which starts a worker that reads `.plot/briefs/<slug>.md`, a
file that is not there.

**The fact already existed, in the wrong place.** `ClaimableSchema.briefExists`
has answered it for `/api/attention` since #236, and `fleet.ts` did not mention
it once — so an agent asking the API was told and a person reading the row was
not, because the two answers are built by different code from one repo.
`AgentRow` now carries `brief`, and the row renders it.

**Three values, not two, and the third is the point.** The `/api/attention`
twin is a boolean that returns `false` on any error, which is defensible for a
caller handed a path either way. It is not defensible on a row: *no brief —
write one first* is a claim about the repository, and made on the strength of an
unreadable `.plot/briefs` it sends a person to write a file that already
exists. So `BriefState` is `present` / `missing` / `unknown`, and an unreadable
directory reads as *cannot verify* — the rule `plot-board-probe.sh` already
applies to auth and `conflicts_known` to an unexamined branch.

The order of the two calls is load-bearing rather than an optimisation:
`existsSync` swallows its error and answers `false` both for *not there* and for
*could not look* — measured, on a readable file inside a `0o000` directory.
Asking about the directory with a throwing call first is what makes the second
call's `false` mean the one thing it is allowed to mean. A `.plot/briefs` that
does not exist at all is `missing`, not `unknown`: a repo that has never had a
brief written honestly has no such directory, and every branch in it needs one.

**The phrasing blames the file, never a person.** *nobody has taken it*
supplies the reason nobody has taken it as if it were an accident of attention —
an invitation with a missing actor, when what is missing is a document. The row
now reads `needs a brief · no brief at .plot/briefs/<slug>.md —
/plot-implement writes it`, on its own second line: the shape a stuck row
already uses, and the one the deferral reason took after two bounded cells were
measured failing. It names the command rather than offering it — running
`/plot-implement` is a real write, and whether the board should offer it is an
Open Point the plan recorded and declined to settle.

The note beside it still says *eligible*, and stays the ordinary `click`
colour, because the wave really is open; only the new line is amber, the
`waitingOn: 'you'` colour, because a missing brief is a person's errand that
nothing in git will clear. The fact is added beside the verdict rather than
replacing it — the rule `stuck` follows in keeping a row's group while naming
what holds it.

Cost: one `existsSync` per branch per pulse, measured 2026-08-19 on this repo
at 0.2 ms per pulse for 60 branches, against a scan that takes 14 s. The root
is passed to `rowsFromPulse` and read on the render clock rather than carried
on the pulse, so a brief written between two scans shows up on the next pulse
instead of waiting out the scan's cadence.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. No helper script is
touched, and the `/api/fleet` payload gains a field rather than changing one —
an older client's schema strips what it does not know, and an older server's
payload validates against the new one by the default, which is `unknown`
precisely so that a server that never looked is not read as reporting an
absence.

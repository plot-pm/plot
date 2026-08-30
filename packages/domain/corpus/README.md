# The corpus tier

**Does the adapter feed the domain the same readings production reads, against
this repository's real estate?**

Run it with `pnpm --filter @plot-pm/domain run test:corpus`. It is not part of
the default suite and is not meant to be: it spawns `plot-fleet-scan.sh` twice
and `plot-plan-meta.sh` over every plan, and it runs as its own CI job.

## What it compares, and what it deliberately does not

**Readings, not verdicts.** There is no second implementation of the rules to
disagree with — the board imports the domain's — so a rule with one
implementation cannot disagree with itself. What *can* disagree is an adapter
that drops a field or reads the wrong key, and that failure would otherwise
surface as a domain correct about the wrong facts.

| tier | asks | needs |
|---|---|---|
| unit (`test/`) | does the rule hold? | nothing — fixtures |
| **corpus (here)** | **does it agree with production, on this repo?** | **read-only adapters** |
| sandbox | does the transition write what production writes? | a temp git repo |

## On a disagreement: stop, do not adjust the adapter

Which side is wrong is judgement. The adapter may be wrong, or this may have
found a production bug that gets its own plan. **Adjusting the adapter to make
the comparison pass is the one move forbidden here** — it is the permissive
failure, and it cements a real production bug behind a passing test.

Every failure prints the subject, the field and both readings, which are the
three things a `PLOT-BLOCKED` note has to carry.

## The two live-sample fields

Two fields cannot be compared for equality, because this tier reads production
and the adapter at two different moments:

- **`changed_ago_seconds`** — `now` minus a commit time. Two scans 30 s apart
  agreed on every verdict, state, claim and branch, and differed here by
  exactly the elapsed time. Compared against a tolerance rather than skipped: an
  exemption written for a 30-second difference would also hide the field
  reading zero.

- **`worker_activity`** — a 0.4 s CPU delta over a live process tree
  (`plot-worker-state.sh`, `PLOT_ACTIVITY_INTERVAL`). It varies *within* a
  moment rather than with it, and **the comparison causes the difference**: the
  observed pid is this suite's own worker loop, whose subtree burns CPU while
  production's scan runs (that scan is its child) and then blocks while the
  adapter's runs. Measured 2026-08-30 — five consecutive scans of the same pid
  all read `working`, while the two scans inside this suite read `working` then
  `idle`. Compared for enum membership, not value.

The `worker` state these qualify is **not** exempt, and neither is anything
else.

## The direction an adapter cannot fail by itself

Every comparison above checks fields the port *declares*. None of them notices
a field production reports that the port never carried — which is exactly how a
reading gets dropped silently: the adapter keeps agreeing about what it reads,
while the domain stops being told something it needs.

So both suites also assert that **every key the wire emits is either mapped or
written down as deliberately uncarried**. A key on neither list fails, and the
fix is a decision — carry it, or record why not.

## Verified discriminating

A comparison that can only pass proves nothing. Measured 2026-08-30, each of
these was injected and caught:

| mutation | caught by |
|---|---|
| adapter drops `prs` | 230 disagreements, each naming the plan |
| adapter reads `phase_raw` where production reads `phase` | every plan, `"Released"` vs `"released"` |
| adapter loses the legacy `waves` spelling | every plan reports 0 slices against production's 1+ |
| pulse summary counter zeroed | `pulse.summary :: blocked :: adapter=0 production=3` |
| branch `state` rewritten to `open` | every branch, naming plan, slice and branch |
| production grows an unmapped field | `names every wire field` |

The third is worth keeping: it shows the adapter's tolerance for the parser's
older `waves` spelling is load-bearing rather than defensive. `plot-plan-meta.sh`
emitted `waves` for all 172 plans on 2026-08-30 and `slices` for none.

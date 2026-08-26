# My Jira tickets are in the inbox

> A team whose tickets live in Jira opens the board and sees them, so a ticket
> becomes a plan without leaving the board.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- `plot-host.sh` resolves `issue-list` and `issue-view` through Jira when the
  repo declares `Tracker: jira`, so the board's ticket inbox works for a team
  whose tickets are not GitHub issues.

## Motivation

`Tracker: jira` is a documented `## Plot Config` key. `plot-config.sh` describes
it; grepping the repo for a consumer returns **nothing**. A team can configure
Jira, see the key accepted, and get an empty inbox forever.

The board's ticket inbox is the one section an enterprise team cannot reach any
other way — branches and PRs they can read from Bitbucket, but *which ticket
should become a plan* is the question the board exists to answer.

## Design

### The contract already exists, and it is narrow

`issue-list` emits one JSON object per line: `{number, title, url, createdAt}`.
`issue-view` emits one issue's body. Exit 3 means the host was asked and failed;
exit 4 means it cannot be asked at all. A Jira backend fills that shape and
changes nothing about it.

**`number` is a string for Jira** — `PLOT-412`, not `412`. The field is already
consumed as an opaque identifier for display and for the `Issue:` field; a plan
citing `Issue: PLOT-412` is exactly as valid as one citing `#228`.

### Read-only, like every other issue op

`plot-host.sh`'s two issue operations READ and never write. Plot's record of an
issue is the plan that names it; the tracker is not updated. That rule is
unchanged and this backend must not be the exception that starts writing.

### The plan format does not accept a Jira key yet

**Measured 2026-08-26**: a plan with `- **Issue:** PLOT-412` parses as
`issues=[]`. `plot-plan-meta.sh:349` reads `#N` and nothing else, so the board
would never link a Jira-tracked plan to its ticket, and the inbox could not tell
that a ticket already has a plan — which is the whole point of the inbox.

That makes the parser a **second wave, not an open question**, and the stake is
higher than a display detail. `fleet.ts:1401` defines the inbox as *"open tracker
issues no plan references"*, matched through this field — so a Jira ticket would
sit in the inbox **forever**, under a heading saying nobody has decided about it,
after a plan for it was written and delivered.

### The key form is read only where the tracker says so

`- **Issue:** PROJ-123` is accepted where `## Plot Config` declares a non-GitHub
`Tracker:`; `#228` is read everywhere, as today.

**This gives `plot-plan-meta.sh` its first configuration dependency, and that is
the cost.** Measured 2026-08-26: the script reads no config at all, and eight
callers parse plans through it — the board's artifact, `plot-sprint-candidates.sh`,
four skills and their READMEs. Each inherits *the plan format now depends on
where you are*.

The alternative — accept any `LETTERS-digits` token unconditionally — needs no
config and works for Linear and others for free. It was rejected because the
plan format would then silently reclassify existing prose: a plan whose `Issue:`
line says `WONT-FIX` or `TODO-later` starts reporting an issue reference, and the
inbox would hide a real ticket on the strength of it. **A format that guesses is
worse than a format that asks**, and the tracker key already exists to be asked.

The dependency must therefore be narrow: the parser reads ONE key, treats an
unreadable config as *GitHub* (today's behaviour), and never fails a parse for
want of configuration.

### The REST API, not a CLI

Jira Cloud's REST API with a token from the environment, called the way every
other host op is called — a shell out with `jq` shaping the result into the
existing contract.

**No CLI dependency**, deliberately. `gh` and `bb` are already two binaries an
adopter must install; a third would make the Jira path the hardest to adopt of
the three, for the tracker most likely to be behind a corporate SSO. The API is
testable against any instance, including one this repo does not have.

### Which `jira` (ankitpokhrel/jira-cli) and `acli` are candidates, as is the REST
API with a token. The choice belongs to whoever can test against a real
instance — this repo has none.

## Waves

### Keyed (Branch: feature/a-plan-cites-a-jira-key)

`plot-plan-meta.sh` accepts `PROJ-123` in the `Issue:` field alongside `#228`,
reporting both in `issues`. Independent of the backend and a prerequisite for it
being useful.

### Listed (Branch: feature/jira-issues-reach-the-inbox)

`issue-list` and `issue-view` resolve through Jira under `Tracker: jira`,
emitting the existing contract.

## Done when

1. `issue-list` under `Tracker: jira` emits `{number,title,url,createdAt}` lines,
   with `number` as the Jira key.
2. **A GitHub repo is unaffected.** `Tracker: jira` is opt-in; a repo that does
   not declare it resolves exactly as it does today.
3. **An unreachable Jira exits 3, not 4, and not an empty list.** Exit 4 means
   *this backend cannot be asked*; a configured-but-unreachable Jira was asked
   and failed. An empty list would be the fabricated verdict this adapter
   refuses everywhere.
4. `issue-view` returns one issue's body, and writes nothing to Jira.
5. **Under `Tracker: jira`, a plan citing `Issue: PLOT-412` reports it in
   `issues`**, and one citing `#228` still reports `228`. Measured today: the
   Jira form parses as `[]`.
6. **Without a tracker key, `PLOT-412` still parses as absent.** The default is
   today's behaviour, so no existing repo changes meaning — and a plan whose
   `Issue:` line holds prose is not reclassified as carrying a reference.
7. **An unreadable or missing `## Plot Config` never fails a parse.** The parser
   has no config dependency today and eight callers rely on that; the new one
   must degrade to GitHub rather than error.
8. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Interrogated 2026-08-26

One round. It raised the stake and narrowed the mechanism.

The stake: `fleet.ts:1401` defines the inbox as *open tracker issues no plan
references*, so an unparsed Jira key does not merely fail to display — it keeps
a decided ticket in the inbox permanently. That moved `Keyed` from a convenience
to a prerequisite.

The mechanism: the key form is read only where `Tracker:` declares a non-GitHub
tracker. Accepting any `LETTERS-digits` token was rejected — it would reclassify
existing prose (`WONT-FIX`, `TODO-later`) as issue references and hide real
tickets. The cost is `plot-plan-meta.sh`'s first config dependency, across eight
callers, and the plan states it rather than absorbing it quietly.

### Open Points

- [x] Which CLI or API? **The REST API with an environment token** — no CLI
      dependency, since `gh` and `bb` are already two binaries an adopter must
      install and Jira is the one most likely behind corporate SSO.
- [ ] Exactly which token scheme and env var name. Needs one real instance to
      confirm against; the wave stops rather than guessing (see below).
- [x] Does `Issue:` need to accept `PLOT-412`? **Yes — measured, it parses as
      `[]` today.** Now wave `Keyed` rather than a question.

### Interrogated again 2026-08-26

Round two, on shipping order and the open CLI question.

The plan stays ONE plan. `Keyed` is the unblocker — `Listed` is useless without
it — but the wave order already enforces that, so splitting would add
bookkeeping to express something the plan already says. Both waves are approved;
only `Keyed` is dispatched, and `Listed` waits behind it.

The CLI question is answered: **the REST API with an environment token, no CLI**.
`gh` and `bb` are already two binaries an adopter must install, and Jira is the
tracker most likely to sit behind corporate SSO — a third binary would make the
Jira path the hardest to adopt of the three. What remains open is narrower: the
exact token scheme and env var name, which needs one real instance. `Listed`
stops rather than guessing it.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {
      "q": "How far should the Issue: key form go?",
      "a": "Only where Tracker: declares a non-GitHub tracker; accepting any PROJ-123 would reclassify prose",
      "category": "technical"
    },
    {
      "q": "Should the plan split so Keyed can ship alone?",
      "a": "No \u2014 one plan, approve both, dispatch Keyed only; the wave order already enforces it",
      "category": "tradeOffs"
    },
    {
      "q": "Which CLI or API for Jira?",
      "a": "The REST API with an environment token \u2014 no CLI dependency; gh and bb are already two binaries and Jira is most likely behind SSO",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": true,
      "architecture": true,
      "implementation": false
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": false,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

# plot

## 2.5.0

### Minor Changes

- [#124](https://github.com/plot-pm/plot/pull/124) [`d6d5d8d`](https://github.com/plot-pm/plot/commit/d6d5d8db56e54124d2e0bbe4095d164d7ff8ac3f) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now records a `Started:` entry when it fans out, so a
  dispatched plan reads as started.

  `/plot-implement` has always written that record; dispatch never got the
  equivalent, so a fanned-out plan sat in Design badged _Ready_ while agents
  edited its branches — the board's two tabs disagreeing by construction, because
  the card reads the plan file while the Agents tab reads git refs.

  The record is written **on the default branch**, through a disposable
  `plot/start-<slug>` branch pushed with `plot-push-main.sh`. That is the whole
  difficulty: `plot-dispatch.sh` finds the plan in its local working tree on
  whatever branch the dispatcher is standing on, while the board reads the plan
  from the default branch. Appending to the local file would book the start where
  the board never looks.

  One line per branch the run newly claimed, written **after** the claim push
  succeeds — a `Started:` record for a branch another dispatcher won would be a
  lie in the file. A re-run adopts existing worktrees and books nothing it did
  not newly claim.

  **A failed booking never unwinds a fan-out.** Offline, refused, or beaten to
  the ref: by then the worktrees exist and the claims are pushed, and those are
  the real state. The script reports that the record is missing and carries on.
  `--dry-run` writes no branch, no commit and no push.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

- [#115](https://github.com/plot-pm/plot/pull/115) [`93be66e`](https://github.com/plot-pm/plot/commit/93be66ee6e95a9c64d875b9a5959143d33c00ca0) Thanks [@jwloka](https://github.com/jwloka)! - Plot now reports when a push to the default branch bypassed branch protection.

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

- [#176](https://github.com/plot-pm/plot/pull/176) [`465141f`](https://github.com/plot-pm/plot/commit/465141fdf75f5dc364d05902366e740b9ebe4224) Thanks [@jwloka](https://github.com/jwloka)! - An acting button on the board now carries a spinner while it acts.

  The seeing half of a report from 2026-08-17: _"Click on actions like 'Start
  work' or 'Approve' don't have an activity indicator … User does not see that.
  Action is going to be executed."_ Measured, an indicator did exist — the label
  swaps to `starting…` / `approving…` and `aria-busy` is set — and it is a word
  change in a small text button, easy to miss on a control the reader is not
  looking directly at, and indistinguishable at a glance from a button that did
  nothing. The fix is to make the existing feedback loud, not to add feedback.

  **A spinner, deliberately not the WORKING rows' pulsing dot.** The two claims
  differ by lifetime: a row's `isLive` is `group === 'working'`, so it can pulse
  for hours with no known end, and rotation there would promise a progress
  nothing measures — the reason `working-rows-show-motion` chose a pulse. A click
  resolves in seconds and there is never more than one in flight, so neither
  reason survives the move onto a button. Unifying the two was rejected in both
  directions, and the regression is asserted: the row's dot must stay a dot.

  **`motion-reduce` stops the rotation and keeps the marker** — inherited from
  `working-rows-show-motion` rather than re-decided, because removing the element
  would take the marker away with the motion and leave a reader who prefers
  reduced motion with less information rather than the same information held
  still.

  **The marker is `aria-hidden`** — the state is announced twice already, by the
  label and by `aria-busy`. **The label still changes**, beside the marker rather
  than instead of it: motion is never the only carrier of a fact. **The button
  dims** on the same state that drives the label, never on a timer of its own, so
  three channels — motion, text, contrast — each say it once.

  Last of three waves. The order was deliberate: the double-click guard was
  pinned and latched first, then what the button watches for success was
  corrected — until that landed, a spinner would have been motion over an outcome
  the button was reading wrong.

  <!--
  bumps:
    skills: {}
  -->

- [#177](https://github.com/plot-pm/plot/pull/177) [`4c7e3ca`](https://github.com/plot-pm/plot/commit/4c7e3cab76d9a26a194399e5c4e9778391f8f674) Thanks [@jwloka](https://github.com/jwloka)! - A Draft card shows how hard its plan has been questioned.

  `/plot:challenge-the-plan` records its state in the plan file as a multi-line HTML comment. The parser's standing rule is that multi-line comment interiors are non-content — template guidance blocks live there — so the round it writes was invisible to everything downstream. Measured on 2026-08-17: `plot-plan-meta.sh` returned 22 keys for `docs/plans/2026-08-17-acting-buttons-show-they-act.md`, and `round` was not among them, although the file carries `"round": 2`.

  **The parser reports it.** `plot-plan-meta.sh` gains a `rounds` field, read from the block via its `CHALLENGE-THE-PLAN-METADATA` sentinel rather than by recognising "a comment that looks like JSON". Keying on the sentinel is what keeps the general rule intact: `canonical-comment-block.md` still parses as all-absent, and a guidance comment still contributes nothing.

  **Absent is not zero, and the field is omitted rather than defaulted.** `0 rounds` reads as _interrogated and found nothing_; a missing block means _nobody has looked_. Those want opposite reactions from a reader, so the key is left out of the JSON entirely and carried as `.optional()` through the contract — the same rule, for the same reason, that `claimed` and `eligible` already follow on `WaveSummarySchema`. A recorded `0` survives as `0` and stays distinguishable from both.

  **The badge is Draft-only.** Past Discovery the count is history: approval settled the question it answers, and a number nobody acts on is the crowding this board keeps removing. The split is deliberate — the SERVER carries `rounds` for any plan that records one, and the CLIENT decides where to show it (`roundsBadgeText`), so a display rule stays in display logic rather than making the data field mean different things per column.

  **The agent row does not gain it.** A row is a statement about one branch, and most rows name a plan whose design phase closed long ago; attaching a design-time count there would put it on every one of them. Card-only, the same split `waveSummary` already follows, and pinned by a test asserting the field is absent from `AgentRowSchema`.

  **A malformed block costs only the round.** `plot-plan-meta.sh` is the plan-format contract and every other command depends on it, so a truncated or non-JSON metadata comment must not cost a plan its phase, type or branches. It does not; the round is simply absent.

  The script collects and does not interpret (Manifesto Principle 3): it reports the number it finds, with no judgement about whether two rounds is enough.

  Tests assert against **real plan files** in `docs/plans`, not hand-made fixtures. That is load-bearing here rather than stylistic: a fixture-shaped test would have passed against a format the skill does not emit, which is exactly how the field came to be missing in the first place.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#167](https://github.com/plot-pm/plot/pull/167) [`15a2e06`](https://github.com/plot-pm/plot/commit/15a2e06ce5c16f618a68efd220a679724719af68) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now says in its **summary** why no worker started, and asks
  once — at the first fan-out — how the project runs an agent headless.

  `started=0` was always in the footer. The reason lived in per-branch output,
  printed by `start_worker` after the fan-out had already happened. On 2026-08-17
  that message was printed and missed five times: worktrees sat claimed with
  nobody working on them, and the last line a caller read said `started=0` with
  nothing beside it.

  So the fact now travels twice, both in the summary block:

  ```
  2 worktrees prepared, 0 workers started, no `Worker command` configured
  summary: dispatched=2 reused=0 skipped=0 started=0 brief=missing worker=unconfigured
  ```

  **The footer stays pure `key=value` and stays last**, as every footer in this
  repo is — consumers read that one line, never the prose. The sentence sits above
  it, the way the failed-booking note already does. In the footer it would have
  been readable and unparseable; only in the footer, parseable and unread.

  `worker=` has four values, because collapsing any two re-creates the defect this
  change exists to remove — one label over states whose actions differ:

  | Value          | Means                                                             |
  | -------------- | ----------------------------------------------------------------- |
  | `configured`   | a `Worker command` exists                                         |
  | `unconfigured` | nobody has been asked                                             |
  | `declined`     | `Worker command: none` — asked, and this repo starts them by hand |
  | `suppressed`   | `--no-start`                                                      |

  **`declined` is not `unconfigured`.** `plot-config.sh` returns the default for a
  missing key and an empty one alike, so an empty answer left blank would be
  indistinguishable from never having asked — and the question would come back at
  every fan-out. `none` is the repo's established sentinel for a deliberate
  absence (`Implementation home: none`), and it is what makes _"I start them
  myself"_ a recordable answer rather than a deferral. It is never run as a
  command: a worker per branch failing with `none: command not found` would turn a
  decision into N crashes.

  **The asking belongs to the skill, and to the first dispatch.** A bash script
  cannot put a question to a human inside an agent session — scripts collect and
  report, skills interpret — so the prompt lives in `skills/plot-dispatch/SKILL.md`
  as step 3, after the dry run, with the count in hand. Not at `/plot-init`:
  adoption runs long before anyone fans out work, so the question meets a need the
  answerer does not have, gets a shrug, and writes an empty key nobody revisits —
  an answered-and-wrong config is harder to fix than a missing one, because
  nothing later notices it was never really decided.

  **It asks; it never suggests.** No example command in the prompt. An example
  becomes a template, and then Plot has effectively hardcoded a tool it is not
  supposed to know (Principle 5). The problem was never _which_ command — it was
  that nobody learned the option existed.

  **`--no-start` is untouched and means exactly what it says.** Its zero reports
  as a choice, not a config gap; the inspect-first workflow was never the defect.
  A `--dry-run` explains nothing at all — it starts nothing by construction, so
  the line would be true, useless, and would train the reader to skip it on the
  run where it matters.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

- [#156](https://github.com/plot-pm/plot/pull/156) [`30f40a7`](https://github.com/plot-pm/plot/commit/30f40a7de7ee0c26bb8ccca591af4fe4c3735b6c) Thanks [@jwloka](https://github.com/jwloka)! - `plot-dispatch` now reports what work is already in flight before it fans out.

  Waves are a within-plan ordering, so a correctly eligible branch can still name
  a file an agent has open on a different plan's branch — nothing in the wave
  model represents that. Each candidate line is now followed by what is held:

  ```
  would dispatch feature/agent-view-phase-ui → …
    in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
  ```

  Measured from **local refs and worktrees**, not the remote: the collision that
  blocked a dispatch on 2026-08-16 lived in an unpushed commit, and uncommitted
  work is invisible to refs entirely. That is sound rather than a violation of
  refs-as-truth, because dispatch is inherently machine-specific — it creates the
  worktrees here.

  Each branch is compared against **its own merge-base**, so a rebased branch does
  not report every commit it picked up from main as its own work. The generated
  `board-server.mjs` is excluded: every board branch rebuilds it, so including it
  would make every board pair look like a collision.

  The report is **bounded** — at most 8 branches, at most 6 files each, with the
  remainder counted. Measured against this repo's real state, the unbounded
  version printed 13 branches under one candidate, one of them naming 18 paths.
  Both caps are plain truncation, never a judgment about which branch or file
  matters.

  It **reports and refuses nothing** — nothing on the candidate side is predicted,
  so there is no prediction worth acting on. `git merge-tree` cannot help at this
  moment (dispatch creates the candidate branch, so it is identical to main and
  the comparison is clean for every candidate, forever), and a `Touches:`
  self-declaration would fire on nearly every board pair because the real scope
  guards nest inside one another.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#158](https://github.com/plot-pm/plot/pull/158) [`0cf29ad`](https://github.com/plot-pm/plot/commit/0cf29ad0c5d1a4d34250be6f388cf944030d8631) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now writes a hand-off brief per branch it fans out, by
  invoking `/plot-implement` — the step it has always skipped.

  Dispatch created a worktree, pushed a claim and booked a `Started:` record,
  then stopped. Writing the brief was left to a person, and on 2026-08-17 a
  person supplied it every time: three rows sat in WORKING with a pulsing green
  dot while nobody was working on any of them. The claim was real; the hand-off
  was never made.

  **The caller is the SKILL, not the script.** No script in this repo invokes a
  skill, and bash cannot reach one at all — skills exist inside an agent session.
  That is the Manifesto's direction rather than an omission (_skills interpret and
  adapt; scripts collect and report_), and a brief is interpretation: what it adds
  over the plan is the alternatives already rejected and the measurements that
  killed them. `skills/plot-dispatch/SKILL.md` is the session-level layer that
  already drives the script through its phases, so the brief step lives there.
  `plot-dispatch.sh` keeps doing exactly what it did.

  **One definition of what an implementer needs to know.** A template string in
  the dispatcher would be a second one, and it would drift from the first the way
  every duplicated rule here has.

  `plot-implement`'s brief template grew from 8 lines — a shape nobody had ever
  used — to the shape the briefs written by hand actually take: a _what to build_
  narrative, the settled decisions each with the measurement that killed the
  obvious alternative, the assertions a naive implementation would pass without, a
  bookkeeping duty and a scope guard naming the branches in flight. Real briefs
  run 111–127 lines, and the difference is not padding. The brief lands at
  `.plot/briefs/<branch>.md`, committed to the default branch, so a resumed or
  replaced agent can read it without the dispatching session.

  The brief step is Frontier tier in both skills' Model Guidance: naming which
  alternatives a plan rejected is judgment, not template filling.

  **A direct script call reports the gap rather than refusing.** The summary gains
  a constant `brief=missing` field — the script cannot write a brief and never
  will, so it says what it left undone instead of leaving a claimed worktree
  looking handed over. It does not refuse: `--dry-run` and `--status` are the
  normal way to look before leaping, and a gate that blocks looking is a gate in
  the wrong place. `--no-start` suppresses workers, not briefs.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-implement: minor
  -->

- [#186](https://github.com/plot-pm/plot/pull/186) [`6aff2c3`](https://github.com/plot-pm/plot/commit/6aff2c386ac414fc1cfa5d06e8ea8f056f31ac47) Thanks [@jwloka](https://github.com/jwloka)! - The board now repairs an artifact-only merge conflict by itself — the **one**
  automatic write this system grants.

  `skills/plot/scripts/board/board-server.mjs` is generated output, and two
  branches touching entirely disjoint sources still collide in it. On 2026-08-17
  that happened twice in one afternoon, and both times a human did the same five
  fixed steps: merge, take a side, `pnpm build:board`, `pnpm run test:board`,
  push. About five minutes each, with no decision anywhere in it.

  **The permission rests on three verified properties and on nothing else.**
  `.gitattributes` marks the artifact `-merge`, so git keeps one side whole and
  writes no conflict markers — the file stays buildable JavaScript _through_ a
  conflict. `build.mjs` embeds no timestamp and no randomness, so the rebuild's
  output does not depend on which side was kept. And CI's no-diff gate fails the
  build if the committed artifact does not match a fresh rebuild. Together they
  make this the one repair whose correctness is checkable **without judgement**.
  No other failure has those properties, and none may be added to this path.

  **It is a script, not an agent.** The sequence is fully determined and nothing
  between its steps is a decision — which is precisely what licenses the
  automation. Handing it to an agent would introduce judgement exactly where its
  absence is the permission.

  **Tests run before the push.** CI's gate runs only _after_ a push, so a
  resolver that pushed and waited would manufacture the very state this plan
  defines as stuck: a red PR in the queue. The sequence ends on `test:board`
  green in the branch's own worktree, and a failing suite pushes nothing and
  leaves the branch reported as a conflict a human owns.

  The fences are the design, and each has a test aimed at an implementation that
  would satisfy the happy path without it: the entry condition is _exactly_ the
  artifact-only conflict set (never _is the artifact among the conflicts_), a
  host verdict with no observed conflict set is refused, two repairs never run on
  one branch at once, and every repair is reported on the row — running, pushed,
  or abandoned. A silent automatic write is indistinguishable from a defect,
  which is the failure mode this whole plan exists to remove.

  The localhost guard on `/api/dispatch` and `/api/approve` is untouched: the
  resolver rides the scan timer and is not a route at all.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#183](https://github.com/plot-pm/plot/pull/183) [`29f0bd0`](https://github.com/plot-pm/plot/commit/29f0bd08c65c335390671e9cc48826c70f2a9000) Thanks [@jwloka](https://github.com/jwloka)! - The scan reports that a branch cannot MOVE, not only what it is

  `plot-fleet-scan.sh` has always reported what a branch _is_ — claimed, eligible,
  blocked, in progress. Five branches got stuck in one afternoon on 2026-08-17 and
  not one of them showed up as anything but normal:

  | Incident                                                                | What it cost                                       |
  | ----------------------------------------------------------------------- | -------------------------------------------------- |
  | [#176](https://github.com/plot-pm/plot/issues/176) artifact conflict    | recreate worktree, take a side, rebuild, 547 tests |
  | [#177](https://github.com/plot-pm/plot/issues/177) artifact conflict    | the same again                                     |
  | [#177](https://github.com/plot-pm/plot/issues/177) rebase never pushed  | noticed by accident; 30 minutes of dead CI         |
  | [#179](https://github.com/plot-pm/plot/issues/179) Playwright CDN `403` | read the log, compare run history, rerun           |
  | [#172](https://github.com/plot-pm/plot/issues/172) fixture regression   | add the missing field                              |

  The [#177](https://github.com/plot-pm/plot/issues/177) case is the sharp one: from outside, a rebase that stayed local is
  indistinguishable from an agent that stopped.

  **Four stuck states, each named separately, each with its evidence.** _Stuck_ as
  one label would be the one-label-many-states defect this repo keeps removing —
  the four differ in the only way that matters, which is what a person does next:
  an artifact-only conflict, a real conflict, unpushed work, and a failing check.

  **Artifact-only is not artifact-among.** The mechanically resolvable case is a
  conflict set of _exactly one file_, that file being the board artifact. A
  conflict touching the artifact _and_ anything else needs judgement as a whole,
  even though one of its files does not. An implementation asking _is the artifact
  among the conflicts?_ passes the artifact-only case and silently misclassifies
  every mixed one, so the set — not the artifact's presence in it — decides.

  **A failing check is reported as evidence and never judged.** The row carries
  the failing check names, the branch's changed paths, and the branch's own recent
  run history; a human concludes. A heuristic mapping failing steps to changed
  paths was rejected: that table is unmaintained by construction and goes silently
  wrong the first time a workflow is restructured (Principle 3).

  **Unpushed work is reported and never fixed.** Pushing someone else's
  uncommitted judgement is not mechanical, and the count is true only on the
  machine doing the looking.

  **A branch that is not stuck produces nothing.** A watcher that flags everything
  flags nothing.

  Read-only and stateless throughout. `git merge-tree --write-tree` computes the
  merge entirely in memory, so a conflict is _foreseen_ rather than present, and
  every state is re-derived from git and the host on each run — there is no
  watcher state to become stale.

  New in the pulse: `conflicts`, `conflicts_known` and `changed_paths` per branch.
  `conflicts_known` is what keeps an empty list from meaning two things, since
  _merges cleanly_ and _nobody could ask_ arrive in the same shape. New on the
  host adapter: `failing_checks` on `pr-list --rich` (same response, no extra
  call) and a `runs <branch>` op, metered and asked only where a failure has
  already been observed.

  The display is a separate wave, and the one granted repair another: this writes
  nothing, pushes nothing and resolves nothing.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#169](https://github.com/plot-pm/plot/pull/169) [`2432cdf`](https://github.com/plot-pm/plot/commit/2432cdf18835dee8bc6e60ca57bc0d7d1853073d) Thanks [@jwloka](https://github.com/jwloka)! - The board's `Approve` button no longer needs a configuration key.

  **Two controls on one surface asked different questions.** `Start work` called `plot-dispatch.sh`, a script Plot ships, and worked out of the box. `Approve` beside it called `sh -c '<Approve command> "<prompt>"'` and did not — it rendered dimmed on every card in this repo, naming a key nobody had set. The board reported it plainly: `"available": false, "reason": "no `Approve command` in this project's Plot Config"`.

  **The justification did not survive the comparison.** `Worker command` is per-project because dispatch starts an agent that writes an _implementation_ — genuinely unknowable to Plot. Approving under `Review: pr` merges a PR whose number the plan already records and writes a dated line into a known field. The real difference was never _approve needs an agent_; it was **approve had no script**, and the board reached for an agent because there was nothing else to reach for. `plot-approve.sh` now exists, so `approveAvailability()` asks exactly what `dispatchAvailability()` asks: is this a local, same-origin request.

  **`Approve command` is demoted, not removed** — and the two entrances are not two implementations. A project that wants the full skill (the ceremony questions, the tracer-bullet heuristic, the `in-session` walkthrough) still declares one, and the board prefers it when present. The skill itself calls `plot-approve.sh`, so the seven mechanical steps go through one implementation either way:

  ```
  no Approve command:    board → plot-approve.sh
  with Approve command:  board → agent → SKILL.md → plot-approve.sh
  ```

  Without that, demoting rather than removing would leave two paths to one outcome, free to drift — the duplication this change exists to remove, reintroduced as a configuration option.

  **Over a non-localhost binding the button stays disabled, and that is correct.** The binding is the authorisation, and a Tailscale address is deliberately not localhost. The phone that reads the board perfectly well does not approve from it: approving merges a PR and writes to the default branch, which is a different decision from reading a status away from the desk. `Start work` behaves identically for the same reason, and a future reader finding both disabled on a phone should find this paragraph rather than a bug.

  **`ApproveButton` moves off the native `disabled` attribute to `aria-disabled`.** A natively disabled control leaves the tab order and takes its `title` explanation with it, out of reach of exactly the reader who cannot see that it is dimmed. `StartWorkButton` settled that in an earlier change; the two were built in parallel and this one did not see the decision. The refusal is now stated twice on purpose — the attribute is what assistive technology reads, and a guard in the click handler is what makes it true.

  Also: the test harness now stubs `plot-approve.sh` alongside `plot-dispatch.sh`. It is what `/api/approve` spawns where no command is declared, and a real run merges a plan PR on the git host — a symlink to the real script would have put that one `git rev-parse` away from CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#168](https://github.com/plot-pm/plot/pull/168) [`3e511de`](https://github.com/plot-pm/plot/commit/3e511de91915efcd676cf4860089a1f7108286c5) Thanks [@jwloka](https://github.com/jwloka)! - `plot-approve.sh` — approving no longer needs an agent

  `Start work` on the board calls a script Plot ships and works out of the box;
  `Approve` beside it called a per-project `Approve command` and did not, because
  no such script existed. The justification did not survive the comparison:
  `Worker command` is per-project because dispatch starts an agent that writes an
  _implementation_, while approving under `Review: pr` is seven writes with no
  judgement in any of them — merge the plan PR, flip the phase, fill `Approved:`,
  clear the `.plot/hold` entry for each branch the plan names, update the sprint
  annotation, push via `plot-push-main.sh`.

  The script is **idempotent**, because step 2 merges the PR and that write cannot
  be undone while everything after it is local. Every step tests the source it
  would have written — `pr-state`, `plot-plan-meta.sh`, the hold file, the sprint
  file — never a progress file of its own, so a run interrupted between the merge
  and the push is repaired by running it again.

  It refuses, with the reason reaching the caller, a plan that is not Draft, a
  `Review:` other than `pr` (`in-session` and `ballot` need a human in the room),
  and a PR that is draft, closed, or absent.

  `plot-approve/SKILL.md` now calls it instead of describing it, and keeps only
  what needs a reader: whether a draft is ready, the in-session walkthrough, the
  ballot tally, the ceremony questions, and the tracer-bullet heuristic.

  <!--
  bumps:
    skills:
      plot: minor
      plot-approve: minor
  -->

- [#161](https://github.com/plot-pm/plot/pull/161) [`e60645a`](https://github.com/plot-pm/plot/commit/e60645a172e851531cc7593dbf47f836ab95c07f) Thanks [@jwloka](https://github.com/jwloka)! - A Draft plan card can now be approved from the board, behind one confirmation.

  **A Draft plan in Discovery offered nothing to do.** Since the Discovery column existed, a plan under PR review renders as a card — and the obvious next step from looking at it is approving it, which the card had no affordance for. The reader had to remember the slug and switch to a terminal. Eight plans were approved in a single evening this way, each through the identical sequence.

  **Approve ACTS; it does not copy a command.** An earlier design had it merely show and copy `/plot-approve <slug>`, on the grounds that the command merges the plan PR, rewrites the phase, writes the `Approved:` record and clears `.plot/hold` — writing to the git host, undoable only by more git, where `Start work` merely creates a worktree and a wrong click costs a `git worktree remove`. That asymmetry is real and it is not the whole picture: the same irreversibility exists when the command is typed in a terminal, where nothing confirms anything, and it gets typed _by rote_. A button is not more dangerous than a command someone runs without thinking; it is the same act with less friction. A copy-a-command affordance would also have put two buttons side by side — one acting, one merely offering text, indistinguishable by looking — onto a surface that had exactly one action vocabulary.

  **One confirmation, in the button itself.** The first click turns `Approve` into `Approve — merges PR #<n>?`; the second runs it; a click anywhere else, or Escape, cancels. No dialog, no modal above a modal, no new pattern. The armed label names the **consequence** rather than repeating the verb, which is the part a reader needs before committing. A failed attempt re-arms rather than re-running, so the confirmation is required every time rather than once ever. The first click is asserted to make **no request at all** — a single-click implementation passes every test that only checks the end result, and fails exactly there.

  **It appears on every Draft card, and only on Draft cards.** Only: an approved plan has nothing to approve, and offering it would invite a second approval whose one effect is a confusing error. Every: including plans whose PR is not yet marked ready, a state that occurred repeatedly in one evening. Hiding the button there would mean the board knew Approve's preconditions and had to keep them in step with the skill — the same rule in two places. The command refuses in its own words instead, and the card shows them. The board's whole test is the column: `Discovery` **is** Draft, one-to-one.

  **A failure shows the command's own message.** `/plot-approve` already explains itself — _"Plan is still a draft. Mark it ready for review first."_, a closed PR, a rejected push. Surfacing that beats replacing it with "failed": a failure without a reason sends the reader to a terminal, and then the command could have been typed there in the first place. Because the route spawns detached and answers before the command finishes (the same constraint `/api/dispatch` lives under, on a single-threaded server that must not freeze every viewer's board for one person's click), the reason cannot ride on the 202 — so it is read back from `GET /api/approve/<slug>`, which reports `unknown`, `running`, `done` or `failed` with the command's last words. `unknown` is not a degraded `failed`: nothing has been attempted for that plan, and a red message on a card whose button was never pressed would be the board asserting something it does not know.

  **It runs through the same door as `Start work`** — `POST /api/approve`, with the localhost binding, the same-origin check and the slug validation **imported** from `/api/dispatch` rather than restated, because a second copy of a security decision is a second place for it to be weakened. The load-bearing test is the same one that route has: a refused request ran **nothing**, which matters more here, since a wrong dispatch costs a `git worktree remove` and a wrong approval merges a PR.

  **What the plan did not anticipate: there is no `plot-approve.sh`.** The design assumed a symmetry with `/api/dispatch` spawning `plot-dispatch.sh`, and `/plot-approve` is a _skill_, not an executable — it branches three ways on the plan's declared review channel, asks the two ceremony questions on a pre-Plot-2 plan, weighs a tracer-bullet heuristic, and merges only in the `pr` case. Writing a script that did all that would put the approval rules in exactly the two places the plan forbids. So the board asks for the skill **by name** and lets the adopting project say what runs it, through a new optional `Approve command` config key — the same shape `plot-dispatch.sh` already uses for `Worker command`, and for the same reason: how to run an agent headless is a per-project answer Plot must not hardcode.

  That gives approve its **own** availability, separate from dispatch, which the plan also did not anticipate. A board on localhost can always dispatch, because `plot-dispatch.sh` ships with Plot; it can approve only where the project has declared a command. One shared flag would be wrong for one of the two whichever way it was set, so `/api/board` reports both — and an unavailable Approve **names the config key** rather than saying "unavailable", since not configured is a next step, not a fault.

  **Also found, and deliberately not fixed here:** the `tiny-garden` test fixture's own `CLAUDE.md` is shadowed. `plot-config.sh` locates configuration via `git rev-parse --show-toplevel`, so a fixture nested inside the plot checkout has every key read from plot's own config instead — unnoticed until now because the two agreed on the keys that existed. The Approve browser tests run against a copy of the garden outside the repository rather than papering over it; the shadowing is a real finding and belongs in its own change, where whatever else depends on it can be examined.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#114](https://github.com/plot-pm/plot/pull/114) [`ff4b419`](https://github.com/plot-pm/plot/commit/ff4b419eac8604c8113d6be4816b58a5365e94a5) Thanks [@jwloka](https://github.com/jwloka)! - The board links to what its rows and cards name: the plan, the pull request, and the story.

  Every one of those was a dead end. To see the PR you left for the browser, to read the plan you left for the editor — on a view whose whole job is telling you where work stands.

  **The href had to come from somewhere, and it could not come from the board.** `pr-list --rich` projected `number, title, state, head, draft, checks, review` and dropped the URL on both backends, so the board had PR _numbers_ and no way to turn one into a link. It must not learn one: nothing under `packages/board/src` distinguishes github.com from a self-hosted Bitbucket, and templating an address from a config key produces a plausible link and a wrong one for GitHub Enterprise. So `pr-list --rich` gains `url` — one jq field per backend, read from the same places `pr-state` already reads — and `plot-host.sh` stays the one thing that knows what a host URL looks like. Where the adapter reports no URL, the number renders as plain text. Inventing one where the adapter has the real one is how a link becomes confidently broken.

  **PR numbers were parsed and dropped without anything in between.** `PlanMetaSchema` read `prs` as `z.array(z.number())`, `CardSchema` had no such field, and `board.ts` contained no occurrence of the string `prs` at all. Cards now carry them, each paired with the URL the host gave us or an empty string.

  **`--state all` needed `--limit` to mean anything.** Both host CLIs page at 30. That is invisible with `--state open` — few repos have thirty open PRs — and bites the moment the board asks for merged ones too, where the newest thirty crowd out every older PR and leave exactly the finished work unlinked. `pr-list` takes `--limit` now; without it the host's own default stands, so no existing caller's result changes. The single fetch serves both indexes, and the by-head map the fleet classifies from is filtered back down to open, so a merged PR can never answer for a branch whose merge already answered.

  Agent rows carry the plan's **filename** beside its display name. Stripping the date prefix is lossy on purpose (it is noise in a column), which is why the filename travels separately rather than being reconstructed by whatever needs to build a `/plan/` href.

  Anchors throughout, following the card's existing convention: cmd/ctrl/shift/middle-click open natively and only a plain primary click is intercepted. A story badge is the one that needs help — lanes are what render a story as a row, so the jump turns lanes on first and scrolls on the next frame, once the row it aims at exists.

- [#123](https://github.com/plot-pm/plot/pull/123) [`16f3427`](https://github.com/plot-pm/plot/commit/16f342756f1be0b8af3fed817ba3da1a15244511) Thanks [@jwloka](https://github.com/jwloka)! - The board asks git how much work is in flight, instead of asking the plan file about facts that live in git refs.

  **A card's `claimed` count was always 0, and could never have been anything else.** It came from `summariseWaves`, which counted `b.claimed` — a field `plot-plan-meta.sh` parses from a plan-file annotation _nobody writes_. Claims are taken by pushing a ref (an empty `plot: claim <branch>` commit), which is Principle 1 working exactly as designed, so the annotation is a note _about_ a claim that no command produces. The number was therefore not stale but permanently wrong, and the Agents tab — reading the same refs through the fleet scan — showed the claim the same second the card denied it. `summariseWaves` is deleted rather than left beside its replacement: a function that reads a field nobody writes is a trap for the next reader.

  **Cards gain `eligible`, a number `WaveSummary` could not carry at all.** The fleet scan has computed it all along (`verdict=eligible` per wave); the card simply never asked. It counts branches that could be started _now_ — still `open`, in an eligible wave — which is deliberately narrower than "outstanding": a blocked wave's open branches are real work but not startable work, and conflating them would tell someone to begin a branch whose seam has not landed.

  **Absent is not zero, and the two must not render alike.** Both counts are optional in the contract. The fleet cache is empty for the first seconds after start-up and a scan can fail, so a card built without a pulse omits them rather than showing zeros — `claimed: 0` and _"I have not looked"_ rendering identically is the very confusion being removed, and re-creating it one layer over would be no improvement. The wave and branch counts stay plan-derived and keep rendering: those genuinely do come from the plan file, and they are still true when git is unreadable.

  **Single-wave plans get a summary too.** The card builder guarded with `if (meta.waves.length > 1)`, which would have withheld the new numbers from exactly the plans this repo has most of. That guard was right about _"waves · branches"_ — noise when there is one of each — and wrong about occupancy: whether someone is working on a single-wave plan's one branch is the same question, and just as worth answering. The summary is computed for every plan; what the tile renders stays a display decision, and a card with nothing in flight shows no badge rather than an empty one.

  The route was already proven: `board.ts` reaches into the fleet cache for PR links via `prsByNumber(opts)`, synchronous and `| null` on a cold cache, so `pulseFor(opts)` is a second export of that shape rather than a new mechanism. `buildBoard` stays synchronous — awaiting a scan would block `/api/board` for 0.5–1.05 s on a single-threaded server, which is the reason the cache exists at all.

  **The board also stops asking the git host for PR state every five seconds.** `refresh()` fired both a `plot-fleet-scan.sh` (git, local, free) and a `pr-list --rich --state all --limit 300` (GitHub GraphQL, metered) on one 5 s timer. At 720 calls an hour that exhausts a 5000/hour budget in well under a working day — and did, on this repo, while the plan for this change was being written (`remaining 0/5000, used 5007`). PR state does not change on a five-second horizon; a review or a check landing is a minutes-scale event. Git now refreshes at 5 s and PRs on their own 60 s timer, backing off to the reset the host names — or to two minutes when it names none. `refreshPrs` already had its own timestamp, its own error, and a comment stating the two sources are independent, so this separates a cadence that was never deliberately joined.

  `--limit 300` stays: without it the board sees only the newest 30 PRs and exactly the finished work goes unlinked. The defect was the frequency, never the page size. An ordinary failure — a VPN blip, a missing CLI — keeps the normal rhythm rather than buying two minutes of silence, so only a genuine quota slows the board down.

  Verified against a real repo rather than a fixture object: a git repo with a bare local remote and an actual pushed `plot: claim` ref, served by the built artifact, reports `claimed: 1` for the taken branch and `eligible: 1` for the free one — while the plan file on disk carries no claim annotation at all.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#155](https://github.com/plot-pm/plot/pull/155) [`ea1829f`](https://github.com/plot-pm/plot/commit/ea1829fa4b6c13828ea3d9d4f937b65120428603) Thanks [@jwloka](https://github.com/jwloka)! - Long board columns now show their most recent cards and offer the rest.

  **`Released` only ever grows.** Thirteen delivered plans today, and every one of them was worth seeing once; none is worth scrolling past forever. A column past the threshold now renders its most recent cards plus a control for the remainder — not a scrollbar, which hides the count, and not a hard cut, which hides the work.

  **The threshold is five, and it is measured rather than chosen.** The plan deliberately named no number, on the grounds that the right one depends on how tall a column gets before it stops being scannable — a question for a browser, not for a plan file. Measured against the live board at 1440×900, 1728×1117 and 1920×1080: a plan card renders 161–226px tall (median 176) and the columns begin 110px down the page, so the number of cards fully visible without scrolling is **four** on a 900px laptop and **five** on a 1080p display, at every width tried. Six overruns the fold on all three. Five is therefore the largest number that costs nothing on the common desktop, and it takes the page from 1.8–2.2 viewports tall to roughly one.

  **Recency is by the phase's own date**, which is the part that makes the cut honest: a column claiming to show the latest five while showing five arbitrary ones is worse than showing all thirteen, because the reader cannot tell the difference. `Released` sorts by its release date, `Endgame` by its delivery date, `Design` and `Development` by approval. `Discovery` has none — a Draft plan has recorded no transition, so there is nothing it is recent _by_ — and those cards keep the order they arrived in.

  Cards gain a single `phaseDate` field rather than four date fields, and the server picks which record fills it. One field per phase would put the phase→record mapping in every consumer, and a column would then quietly sort by a clock that is not its own — a failure that looks exactly like a sorted column. There is deliberately **no fallback** down to the filename's date prefix: that prefix is when a plan was _written_, which for the plans in `Released` today is months from when they shipped. `""` is the honest answer, and a card carrying it sorts last rather than sorting wrong. The same rule the fleet's row sort follows for an unknown age: _we do not know_ is not _newest_.

  **The header count keeps counting the whole column.** `Released (13)` above five cards states plainly that eight are hidden; a header that counted the five would read as _there are five_, which is the exact failure truncating must not introduce. The control below says the number too — `Show 8 older`, not `Show more` — because that is the fact a reader deciding whether to click actually needs, and _older_ is what tells them the eight are the oldest rather than an arbitrary remainder. This matches how the Agents tab's collapsing groups word the same idea (`QUIET (7)`) rather than inventing a second vocabulary for "how many are hidden".

  **It applies to any column past the threshold, not to `Released` alone.** `Endgame` holds ten and will reach it next, and a rule with one hard-coded exception is a rule someone has to remember — and has to remove the week the exception stops being true.

  **A highlighted card is never truncated away**, which the plan did not anticipate. The board scrolls to `#plan-<slug>` when a reader arrives via `?plan=` or the plan modal's _Show in board_, and a card the cut removed is not merely un-scrolled-to: `getElementById` returns null and the arrival lands nowhere, silently. That is reachable today — _Show in board_ on a plan delivered in July aims at a card the newest five would not include. The highlighted card is kept **in addition** to the limit rather than in place of one of them, so following a link never costs the reader a card they would otherwise have seen.

  Expansion is component state, not the URL and not `localStorage`. The query string holds what is worth _sending_ to someone — `?tab`, `?lanes`, `?plan` — and "I unfolded Released" is not; nor is it worth persisting, since it is opened to answer one question and the truncated view is the one worth returning to.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#130](https://github.com/plot-pm/plot/pull/130) [`90c5259`](https://github.com/plot-pm/plot/commit/90c525924d4b6b13aa77fb021e98cf52819a73f2) Thanks [@jwloka](https://github.com/jwloka)! - The Discovery column can finally hold something, and what it holds is the work a person is actually doing.

  **One of the board's five columns could never contain anything.** `Board.tsx` renders every column the API returns, so Discovery was a real column with a real count — but `toBoardPhase` mapped `draft → Design`, `approved → Design | Development`, `delivered → Endgame`, `released → Released`. No plan phase mapped to Discovery, ever. The column was not empty because nothing was happening; it was empty because nothing _could_ be.

  **Draft is the discovery phase, and no new vocabulary was needed to say so.** What sits in a Draft plan is not a transcription of a decision already made — it is the investigation deciding whether there is one. The two plans under review while this was written had five commits and 545 lines between them and zero lines of code: throwaway fixtures built, a first-parent filter measured and discarded, a second-parent check tested and discarded, 197 ms weighed against 79 ms, a design found to break under GitFlow. That is a spike, merely carried in a plan file, and approval is the moment it ends. So `draft` now maps to `Discovery`, and Design means exactly one thing — designed, not yet started — which is what its cards already were: two plans waiting for capacity, one for three weeks and one for six months, neither being designed by anyone.

  **The swimlane view drops its Discovery filter in the same change**, because it has to. `Swimlanes.tsx` used Discovery as the row header and removed it from the plan columns (`BOARD_PHASES.filter((p) => p !== 'Discovery')`). That was coherent only _while the column held nothing_ — the filter hid nothing because there was nothing to hide. Once Draft plans land there, a row header that silently drops them is the same bug wearing different clothes, so the two renderers are now pinned against one board payload rather than trusted to agree.

  **Remapping alone would have changed nothing visible, because a Draft plan under review is not on the default branch at all.** `collectPlanFiles()` walks `docs/plans/{active,delivered,}` on the filesystem — one branch's working tree — and of every plan file on the default branch, not one is in phase Draft. Draft was not rare there; it was unreachable. So plan files are now additionally sourced from branches under the configured `Branch prefixes` that are **not** on the default branch. That set _is_ the Draft plans, and it needs no new convention: a plan under review lives on its own branch until its PR merges, and everything else on that branch matches the default branch because the branch was cut from it. Nothing is inferred from the branch _name_ beyond where to look — the phase is still read out of the file by `plot-plan-meta.sh`, exactly as for a working-tree plan. Searching the whole prefix list rather than `idea/` alone is deliberate: an `Impl: same branch` plan rides `feature/<slug>`, so its Draft phase was invisible for the identical reason.

  **The local ref mirror, never the network.** Measured: `git ls-remote --heads origin` costs 459 ms against 8 ms for `git for-each-ref refs/remotes/origin/*`. The board's plan walk runs on every request and the client polls, so the wire call would quietly make a poll loop depend on the git host being reachable — and the local answer is already correct, because the fleet scan fetches on its own timer. Timing assertions would not have caught the wrong call, since ~450 ms passes any generous threshold, so the choice is pinned in a test that reads the source: no `ls-remote`, no `fetch`, and `for-each-ref` present rather than merely absent.

  **A plan's identity is its canonical path, not wherever it was staged.** `plot-plan-meta.sh` takes paths rather than content, so a git-sourced plan must be written somewhere before it can be parsed — and the `file` field it returns is then that staging path. `PlanCard` renders `card.path` verbatim, so a Discovery card would have displayed `/var/folders/…/probe.md`. The repo-relative path is restored before anything is derived from it, and the exact string is asserted, because this fails silently and looks merely untidy rather than wrong. Only regular blobs are read, never the `active/` symlinks git reports beside them: a symlink entry holds its target's path as content, which would both feed the parser a line of text and double-count every indexed plan.

  **The branch read is cached on the tips it read.** Each `git` invocation costs ~55 ms of process spawn no matter how little work it does, so reading a dozen branches' plan trees is around two seconds — on a path the client polls every few seconds. The refs barely move, though: a plan branch changes when someone pushes to it. So the tip SHAs, which `for-each-ref` already returns in the one call that has to happen anyway, are the cache key; an unchanged fleet of branches costs exactly that call, and any branch moving, appearing, or disappearing re-reads everything. Pinned by a test that pushes a plan to a new branch after the first read and requires it to show up — a cache that never invalidated would be worse than no feature, since the board would show a stale picture and look right doing it.

  **A repo with no prefixed branches behaves exactly as before** — additive and silent when empty, which is the common case for an adopting project — and a repository is only read when the board's root _is_ the repository. git resolves upwards from the cwd, so a plans directory nested inside an unrelated checkout would otherwise inherit that checkout's branches and raise cards for a different project entirely. That is not hypothetical: this repo's own test fixture lives inside the plot checkout, and without the containment check the board read plot's eight prefixed branches on every request in order to serve a garden.

  Verified against a real repo rather than a fixture object: a git repo with a bare local remote whose Draft plans exist _only_ as blobs on prefixed branches — with the working-tree copies deleted, so the filesystem walk genuinely cannot see them — served by the built artifact, renders both in Discovery, with repo-relative paths, no duplicates across branches cut from the same point, and no staging directory left behind over repeated requests.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#119](https://github.com/plot-pm/plot/pull/119) [`c1ae02c`](https://github.com/plot-pm/plot/commit/c1ae02c28efdc50ac3a3c93af31b2ebf639b278a) Thanks [@jwloka](https://github.com/jwloka)! - The board acts through Plot: a **Start work** button on an approved plan card, which runs `plot-dispatch.sh` exactly as `/plot-dispatch` does.

  The board expresses an **intent about a plan**, and the existing chain decides everything else — which branch, whether the wave is open, whether the claim wins its race, whether the phase gate allows it. The board cannot bypass a rule it never evaluates. That is also why the button sits on the plan card rather than an agent row: `plot-dispatch.sh` takes a _slug_, then asks `plot-fleet-scan.sh --next` which branch is eligible, so a button on a branch row would promise "start this one" and deliver "start whichever is next".

  **The board gains its first non-GET route, which is a change in kind rather than degree.** `handleRequest` opens with a blanket `if (req.method !== 'GET') return 405`, which is why no existing route has ever had to think about verbs. Rather than remove that guard, `POST /api/dispatch` is allow-listed _ahead_ of it: `/api/board`, `/api/fleet` and `/plan/*` stay protected exactly as today, and precisely one path-and-verb pair slips past. Per-route method checks would be the conventional shape and are rejected for the reason this repo rejects prose MUSTs — a check every future route has to remember is a rule, while a default that refuses is a gate.

  **The binding is the authorisation, and the browser is not a network question.** The route exists only while the server listens on localhost; with `HOST=0.0.0.0` it returns 403 and the button renders disabled with the reason. That is a deliberate refusal to invent an auth scheme — whoever reaches `localhost:7777` is sitting at the machine that owns the worktrees. But binding answers _reachability_: any website the user visits can `fetch('http://localhost:7777/api/dispatch', {method:'POST', mode:'no-cors'})`, and the attacker cannot read the reply and does not need to — the worktree exists and the claim is pushed before the response is written. So the route also requires `Sec-Fetch-Site: same-origin` / a matching `Origin`, both browser-set and unforgeable by page JavaScript.

  **The 202 is a real 202, and cannot carry a result.** A dispatch creates a worktree and pushes a claim — a network write, strictly slower than the scan that already forced the fleet cache to exist on this single-threaded server. Awaiting it would freeze every viewer's board for the duration of someone else's click. The server therefore picks the log path _before_ spawning, keyed by slug (`<repo>/../plot-dispatch-<slug>.log`), because it cannot know the branch: `--max 1` asks `--next` at runtime. Where no `Worker command` is configured, `start_worker` returns 1 and **that is not an error** — it creates the worktree, pushes the claim, and prints a `cd <path>` plus a config hint. Those lines land in the log verbatim rather than being paraphrased into a second copy that can drift.

  **Feedback is derived, never asserted.** The button does not move the row; the pulse re-reads git and the row travels on its own. After about three pulses with no change it says **"no change — see log"** with the path, and does _not_ guess which of the failure modes occurred — the claim lost its race, no branch was eligible, the script failed. The script already wrote the truth to the log. An optimistic update would be faster and would make the board display something it does not know.

  The button condition is the gate's condition, `phase === approved` — not a board column. "Development" means approved _and_ started, so an approved-but-unstarted plan renders under Design, which is the first-dispatch case the button is most for. It reuses the exact expression the **Ready** badge already computed, so the badge and the button cannot disagree.

  Only start, never stop: a start is reversible for the price of `--stop`, while a stop kills a running session and whatever it had not committed. `--status` and `--stop` stay in the terminal.

  The route's tests never run a real dispatch — a stub script via `PLOT_SCRIPTS_DIR` stands in, so no worktree is created and nothing is pushed from CI. The assertion that matters most is that a **refused request spawned nothing**, since every other one can pass while the side effect still happened.

- [#151](https://github.com/plot-pm/plot/pull/151) [`f58340c`](https://github.com/plot-pm/plot/commit/f58340cf32ea7bfa0f5c459a7fdb8195e7fb86c2) Thanks [@jwloka](https://github.com/jwloka)! - A story is now an artefact you can open from the board.

  **Stories were the board's axis and its dead end.** A plan card names its story as a badge, the swimlane view uses stories as row headers — and neither led anywhere. `StoryCardSchema` carried `slug`, `title` and `status` and **no path**, and the server had a `/plan/<file>` route but no `/story/`. The one concept that spans months, the thing plans belong to, was the only artefact the board could not open.

  **Both viewer routes share ONE hardened resolver, rather than the second copying the first.** `/plan/` defends against two attacks and only the first is obvious. Traversal is handled structurally: a name resolves against the documents the board itself collected, never joined into a path — which matters more for a story than for a plan, since a story slug is a directory name _and_ part of the filename (`<slug>/STORY-<slug>.md`), so a `../` has two positions to land in. The second attack is one line: `decodeURIComponent` **throws** a `URIError` on a malformed `%` escape (`/story/%E0%A4%A`), and an uncaught throw inside the request listener takes the single-process server down. A `/story/` route written from scratch would very plausibly get the allowlist right and that wrong, and one malformed URL would then kill the board. So the decode, the try/catch, the 400-vs-404, the CSP and the `?embed=1` handling are one code path; the routes differ only in which allowlist they consult, and that difference is a two-line table. The malformed-escape case is asserted for both routes **in one test**, because a test that checked each alone would still pass the day someone forked the handler.

  **`StoryCardSchema` gains the resolved path**, for the same reason `planFile` exists on a fleet row: the consumer must not reconstruct it, because stripping and rebuilding a path is where the mistakes live. **A story with no file gets an empty path and renders no link** — the rule plan rows already follow for `planFile: ''`. The card keeps its title and status, which are true regardless; hiding it would lose real information to avoid a broken link, when not linking suffices.

  **The plan modal gains an `Open story` button, and the badge becomes a link.** Both, not either — they answer different questions. The badge is where the story is _named_, on the card, at triage time; the button is where you _go_, in the modal, once you have stopped triaging. That is the same split the worktree path already makes. An earlier draft had only the badge, which satisfies "a story can be opened" while leaving the action invisible to anyone scanning the header for something to do — so the button is asserted as a `<button>`, not merely as reachable. It appears only when the story resolves to a file, rather than offering an action that 404s.

  The badge no longer jumps to the story's swimlane row. A badge that sometimes opens a document and sometimes moves the page teaches a reader nothing about which it will do; the name refers to an artefact, so it points at the artefact. The `Story lanes` toggle still reaches every lane, and the story overlay's own _Show in board_ lands on the row when lanes are on.

  **The swimlane row header opens its story too** — the lane view is the other place a story is named and led nowhere. Both surfaces follow the same rule: a header naming a story with no file (the orphan and catch-all rows) stays plain text.

  **The overlay's header mirrors the plan modal's exactly** — _Show in board_, _Open in new tab_, _Close_. Three, not two. Symmetry matters more than novelty: a reader who has learned the plan modal should not have to learn a second set of controls. They are the same component, which makes "they match" a fact rather than a promise — and the test asserts it by **comparing the two headers** rather than listing three names in both places, since a listing would still pass the day one modal grew a fourth control.

  **The body is the story's own.** The header answers _where do I go_; the body answers _what now_, and a story has no worktree. What belongs there is the thing the story card cannot say: **which plans make it up, and what phase each is in** — derived from the board's own cards, which already carry `story` and `phase`, rather than parsed from the STORY file's hand-maintained "Current Plan" prose. Hand-maintained is precisely the problem: nothing marks an item resolved when its plan lands, and four of twelve open points in one story were stale when swept. A derived list cannot drift. Asserted against a fixture whose hand-written section names a plan that does not exist and omits both that do — the derived list must win, and the stale prose is confirmed present in the rendered document below it, so the assertion is a disagreement rather than an absence.

  **Opening a story from an open plan modal replaces it, and does not stack.** An overlay above an overlay gives two Close buttons and an ambiguous Escape, for the sake of keeping context the header already names. Replacement is predictable, and the way back is the same click in reverse — a plan opened from the story overlay replaces it in turn.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#132](https://github.com/plot-pm/plot/pull/132) [`7af7d0a`](https://github.com/plot-pm/plot/commit/7af7d0ae3a32c25ed69db1f3dcdf4cc020832704) Thanks [@jwloka](https://github.com/jwloka)! - The agent view stops making you work out what it already knows.

  Three frictions in the Agents tab, all of the same kind: the view held the information and left the reader to reconstruct it.

  **The footer counted up, not down.** `scanned 2s ago · PR data 74s ago` is honest about staleness and silent about the thing that matters while you watch a fan-out — _when does this change next?_ Both ages now carry a countdown, and the pair is the point: how old is this, and when does it move. The git countdown is derived from `FLEET_POLL_MS`, which the client owns, and it answers _when can this display change_ rather than _when does git get re-read_ — `/api/fleet` reads a cache the server rescans on its own timer, and that is the only question the client can answer honestly.

  **The PR countdown needed a field, and must not guess without it.** `PR_REFRESH_MS` is 60 s and backs off to 120 s when the host reports a rate limit, so a client assuming 60 s would count to zero and sit there through the wait — rendering _"I don't know"_ as _"any moment now"_, which is the exact failure this view exists to remove. `FleetSchema` gains one optional field carrying the server's own intention, read from `prNextAt` — the single gate the fetch obeys, so it reports the truth rather than a second copy of the cadence that could drift from it. **Absent, no PR countdown is shown at all**: an older server, or a board built before this change, still tells the truth with the age alone. Both counters stop when the agents tab is not open, because `App.tsx` already stops polling and a counter ticking toward a refresh that is not coming is the same false statement.

  **The groups were ordered errand-before-opportunity.** `QUIET` sat above `NOT STARTED`, so a reader with ten minutes met "go check whether this died" before "here is work nobody has taken". Actionable now precedes diagnostic — the same _workable top to bottom_ principle the ordering always claimed, applied to the one pair that had it backwards. The order lives in two arrays (one sorts, one renders) and a test pins them equal, because a disagreement there would not read as two lists drifting apart; it would read as rows landing in the wrong group.

  **An unstarted row now says how long it has been waiting.** It rendered `—`, because `ageMinutes` dates a branch tip and there is no branch — while the age that matters, how long the plan has been waiting to be _started_, sat unused in the `Approved:` record. It is a **different clock** from every other row's age: days rather than minutes, approval rather than commit. So it rides in its own field and is labelled (`waiting 22d`) rather than folded into `ageMinutes` — overloading one field with two meanings is exactly what would make "22d, no commits for three weeks" indistinguishable from "22d, never begun". Only branches with no tip carry it; a branch that exists has a real age, and a second beside it would only compete. **No recorded date shows nothing** — not zero, not "just now" — which is the common path rather than the edge: this repo's only unstarted plan predates the `Approved:` field entirely.

  **Rows were grouped only by waiting-state.** Fifteen branches across seven plans put six slices of _one_ plan in `QUIET (6)` while three rows of another sat apart in `DONE`. The plan name was on every row, so the grouping existed in the data and was left for the eye to do. Rows now group by plan inside each waiting-group — by plan and not by story, because the waiting-groups answer _what needs me next_ and the useful unit within that is the thing whose waves are being worked. Plans are ordered by their most urgent row, so a plan holding one stale branch cannot outrank one whose branch just moved, and rows keep their age order inside a plan. **A group with one plan gets no sub-heading** — chrome that never varies is noise — and `DONE` is grouped like every other group, because a rule with an exception for the group nobody reads is a rule someone has to remember.

  **The row reads plan, then branch** — what this belongs to, then which slice of it. Not merely preference: with the branch first, six rows of one plan carried the plan name to the right of six branch names of differing length, so the plan column frayed exactly where the grouping says those rows belong together. Plan first makes them a visible column, reinforcing the grouping rather than duplicating it.

  **Every link now goes where its text says.** One link per row, on the wrong word: the branch name opened the PR while `PR [#130](https://github.com/plot-pm/plot/issues/130)` beside it was plain text. Both halves were surprising. The branch name links to the branch, `PR #<n>` links to the pull request, and a test asserts the two targets _differ_ — "a link exists" passes on the bug.

  **The branch URL is read from the origin, not derived from the PR URL.** That derivation was rejected because it only works for rows that _have_ a PR, and `not-started`, `quiet` and fresh claims — where "go look at the branch" is most useful — have none. `git remote get-url origin` is read once per scan, beside the branch ages, never per row, and the host's own word for the page is used (`/tree/` on GitHub, `/branch/` on Bitbucket Cloud), keeping the host verbatim so a GitHub Enterprise install links to itself. An origin whose shape the board does not recognise — a self-hosted Bitbucket, whose branches live under `/projects/KEY/repos/name/branches` — yields no link at all rather than a guessed URL shape. **A merged branch gets no branch link**: its remote page is gone, and the standing rule in this contract is that a missing address renders as plain text rather than an invented one. `green` stays plain text and that is a deliberate stop — the row carries no checks URL, and adding one is a change through `plot-host.sh` and the pulse rather than a display change.

  **Clicking a plan opened the rendered markdown and left the board.** The Agents tab is a live view that polls every 4 s; navigating away costs the reader the thing they came to watch. The plan now opens in `PlanModal` in place, and the modal gains a **Show in board** button that closes it, switches tabs, filters to the plan's story and lands on the card.

  **The filter alone is not the feature.** `plot-board` has nine plans, so filtering to a story still leaves you scanning a column. The button also names the plan in the URL — `?plan=<slug>`, the same sync the story and sprint filters use — and the matching card scrolls into view with a highlight ring. Naming it in the URL is what makes the landing shareable and survivable: a reload keeps you on the card. The highlight is transient, clearing on the next interaction rather than persisting as a second kind of filter, and `prefers-reduced-motion` suppresses the scroll _animation_, not the scroll — arriving at the card is the point. A `?plan=` matching nothing is **ignored**, because an empty filtered column would read as "this story has no plans".

  A fleet row is not a card — it carries `planFile`, and `PlanModal` takes a `Card` — so the card is looked up from the board data. **Where the board has no matching card the plan name stays a plain link to `/plan/<file>`** rather than opening an empty modal; a plan outside the walked directories has a row and no card. "The board has not loaded yet" is deliberately not the same answer: against a real repo `/api/board` takes seconds, so a click made in that window is held and resolved once the cards land, never spent navigating away from a live view.

  Verified by running the built board against this repo, not only against the fixture: sixteen rows over eight plans, countdowns ticking, `DONE` carrying five plan sub-headings, every live branch linked to `github.com/plot-pm/plot/tree/<branch>` and every merged one plain, the modal opening in place and its button landing on the highlighted card.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#140](https://github.com/plot-pm/plot/pull/140) [`b12af2c`](https://github.com/plot-pm/plot/commit/b12af2cd02b366a7d8a10d3e6dbc4e550a9d9b1a) Thanks [@jwloka](https://github.com/jwloka)! - Every fleet row carries the **phase** its work is in, the pulse keeps a rolling day of finished work, and a draft PR with red CI finally says so.

  **The Agents tab decided everything by TIME and could not say what the time was about.** `classify()` asks whether a commit landed inside the quiet window and nothing else — the right answer for _is anything moving_, and structurally unable to answer _moving on what_. Two consequences shared that one cause. WORKING could not tell a human drafting from an agent building: `board-ui-polish` was written, interrogated over several rounds, and approved **on the branch an agent then built on**, so one row passed through three phases in sequence and the tab showed the same thing for every one of them. And NOT STARTED could not say what kind of not-started — it should mean _discovered, planned, ready to pick up_, and meant only "no branch tip we can date".

  **The phase is derived from the PAIR — the plan's phase AND the branch's git state — never from the plan file alone.** The obvious implementation carries the plan's phase onto its rows and maps it with `toBoardPhase`; that produces rows that contradict themselves, and the repo had the example sitting in it. `opus5-longhorizon-hardening` is `Phase: Approved` with **zero** `Started:` records while six of its branches carry real commits: the board reads the file and says _Design_, the pulse reads git and says _in progress_. A row labelled _Design_ beside a note reading _no commit for 22 days_ is two statements about one branch that cannot both be true, and that is the exact defect class this board has hit three times (`merged` vs a deleted ref, `claimed` vs resumed, `open` vs merged-and-deleted). Git supplies the started half, so those rows read **Development** while the card keeps saying Design until someone records the start — and that divergence is _itself information_, meaning the plan's bookkeeping is behind.

  **Per branch, not per plan.** A row is a statement about one branch, so the plan's `Started:` count deliberately does not travel with it: a three-branch plan with one branch built and two untouched is in Development _as a plan_, while its untouched rows are the hand-off point, which is what Design means. Carrying the count onto them would print `Development` beside _eligible — nobody has taken it_.

  **"git wins" applies to an ABSENT record, not to a recorded decision, and the asymmetry is the point.** A missing `Started:` line is nobody having written something down, and a commit outranks it. A commit landing under a plan already marked `delivered` is a **contradiction of something a human wrote**, and a follow-up fix does not repeal it — so the row stays at Endgame and its age shows that something moved. Treating every late commit as a phase reversal would send a plan visibly backwards for a typo fix, which teaches readers to distrust the column. The symmetric implementation passes every other assertion in this change and fails only that one, so it has its own test.

  **`deferred` sends the row back a phase, and stops displacing the note.** The annotation is not "paused, resuming later": the vocabulary says the branch _isn't needed_ and was _given up deliberately_, and `plot-deliver` skips deferred branches in its completeness gate — a plan delivers without them. So a branch with real commits under an approved plan reads **Design**, not Development (nobody is working on it) and not silently-Design (indistinguishable from never-begun — `state` still says `deferred`, which is what a badge renders from). It can never read WORKING even with a minutes-old commit; that is the one place intent outranks git, because the group is about the claim the row makes rather than the age of a commit. And `classify()` no longer answers `{ note: 'deferred' }` unconditionally, which used to erase whatever else the row had to say: the fact rides beside the note instead of replacing it, the same shape as the `no story` badge on a plan card.

  **DONE lost the work at the moment it finished.** Measured rather than guessed: `plot-fleet-scan.sh` read `docs/plans/active/` only, and delivering a plan moves its symlink to `delivered/` — so the plan left the pulse in that instant, taking every branch with it. Five plans delivered in one day named eight branches between them and DONE showed **one**, because merge and delivery are minutes apart and only whichever branch happened to sit in the gap survived. A group that is full by accident is worse than one that is empty by rule. The pulse now also reads recently delivered plans, **bounded by time rather than by count** — "what finished today" empties itself as the day passes, while "the last five" shows five whether the newest is an hour old or six months.

  **A rolling 24 hours, and a bare date anchored at the END of its day.** Literally "delivered today" is easier to explain and wrong at exactly the wrong moment: a plan delivered at 23:50 vanishes ten minutes later, mid-session, while the branches it names are still on screen. 24 is also the one freshness bound this repo already uses (`Claim stale after`). The anchor is what makes _rolling_ true rather than merely stated — every `Delivered:` record here is a bare date, which names no time, so measuring from 00:00 would start the clock up to a day **before** the delivery and collapse the window straight back into the calendar boundary. Anchoring at 23:59:59 over-admits by at most the delivery day, which is the safe direction; a record that carries a time is honoured exactly.

  **The window filters before the parse.** Measured: ~57 ms per plan through `plot-plan-meta.sh` against a scan that already runs 500–1050 ms, so parsing all fourteen delivered plans to discard thirteen would roughly double the pulse — and that cost grows with the archive, which only ever gets larger, while the answer it produces stays the size of a day's work. So the cheap signal comes first (the delivered symlink's own mtime) and only the candidates it admits are parsed. The pre-filter may **over-admit and pay a parse, never exclude**: a checkout can freshen an old file, so the `Delivered:` record keeps the last word. On a fresh clone or a CI worktree every file shares one checkout timestamp and everything is admitted — correct, merely slower, once. Reaching for `git log` per plan to avoid that would spend a git call to save a parse.

  **No date, no row.** `docs/plans/delivered/reconcile-scan-accuracy.md` sits in the delivered index today with an empty `Delivered:` record, and it must not appear: no date means no membership in any window, the same rule the waiting age already follows. Showing it always creates the one row that can never age out of DONE, and the missing record is a bookkeeping fault `plot-reconcile-scan.sh` exists to report — a view that quietly compensates for it makes the fault harder to see. `--next` and `--list-eligible` skip delivered plans entirely rather than filtering afterwards: their question is _what may a worker claim_, and a delivered plan answers nothing to it.

  **A draft PR's red CI was invisible.** Found on this plan's own PR — `[#131](https://github.com/plot-pm/plot/issues/131)` reported `checks: failing` and the board rendered `PR [#131](https://github.com/plot-pm/plot/issues/131), draft`. The cause was an ordering rather than an omission: the row asked `pr.draft` **before** anything asked about checks. Both halves were right about their own question — `classify` declines to claim a _green_ draft ("a draft is still the author's, not yours"), and the shortcut is right that a draft belongs in `waiting-on-you` regardless, since the author is the reader — but neither noticed that the shortcut answered for **every** draft, so a green draft and a red one produced the identical row. The group happened to be correct; the note lost the only fact that changes what the author should do next. The checks now speak inside the draft framing (`PR [#131](https://github.com/plot-pm/plot/issues/131), draft, checks failing`) and the group stays put, since moving a failing draft would claim a review nobody asked for. A green draft says nothing extra: "draft" already means _not ready for you_, and appending "checks green" would put the reassuring word on the row whose whole point is that it is unfinished.

  **`plot-plan-meta.sh` reports `delivered_raw`.** The delivery record was the one transition the parser did not carry, so the board could read `phase: delivered` but never _when_ — and "delivered with an empty record" is a real state here that a phase alone cannot distinguish from a dated delivery.

  The pulse carries the plan's `phase` verbatim and interprets nothing: which column a row reads is judgment, and it belongs one layer up (Manifesto Principle 3). `toBoardPhase` stays the single definition of the mapping and gains no second implementation — the row derivation composes it, and a test asserts the agreement across every phase and state rather than trusting inspection, because a second copy is how the two views drift apart.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#137](https://github.com/plot-pm/plot/pull/137) [`ad2b369`](https://github.com/plot-pm/plot/commit/ad2b3696bcf97efe4c3b7ab6499c04b464effcd7) Thanks [@jwloka](https://github.com/jwloka)! - A branch whose local worktree has uncommitted changes reads as **working** rather than quiet, with a note saying the evidence is local.

  **Three agents were dispatched and all three were working; the board showed two.** The third branch had been claimed a day earlier and _resumed_, so its claim commit was 21 hours old while its work was minutes old. The row read `quiet · no commit for 21 hours` — a true note under a wrong heading, and the heading is the thing this tab does. QUIET carries an instruction: _go check whether it died._ Following it found a live agent with three modified files. That is the same mis-answer already fixed twice — merged branches reading as quiet, fresh claims reading as quiet — but with one difference: the earlier two were fixed with data the classifier already had, and here the refs genuinely do not know. An agent that has edited files and not committed has written nothing git can see.

  **The scan already stands where the answer is.** `git worktree list --porcelain` names every worktree and its branch, and `git -C <path> status --porcelain` says whether the tree is dirty. Both are local, and `plot-fleet-scan.sh` runs on the machine that owns them. Its `--json` output gains two per-branch fields — `local_dirty` and `local_worktree` — and `classify()` uses the first for exactly one thing: to _lift_ a branch out of quiet. The prose report is unchanged; it is a human interface, and the row this feeds lives in the board.

  **Absent is not false, and that is what makes it additive.** On a machine with no worktree for a branch — every detached worker, every teammate's laptop, every CI run — the field is false and the branch answers from refs exactly as before. The signal is strictly one-directional: it may _add_ an answer where this machine knows more, never downgrade one. Two people looking at the same fleet from different machines will see different notes on the same row, and that is correct, because they genuinely know different things. The fleet derives state from refs _precisely so_ it works for workers elsewhere; keeping local knowledge one-directional is what lets both hold at once.

  **The note says local, because a reader has to be able to judge it.** Work that has not been committed is also work nobody else can see, and a row claiming _working_ on grounds the next person cannot verify would be its own kind of lie. It also declines to say _who_: git records no author on an uncommitted change, and on an `Impl: same branch` plan the person and the agent share one branch by design. So the note reports what was observed and where — _uncommitted work in a local worktree_ — and a reader who recognises their own editor is not misled, where "agent working" would have misled them.

  **Dirty, not present.** A worktree that exists but is clean is equally consistent with an agent that finished and one that never started, so it lifts nothing and shows nothing in the row. **Any state that would otherwise read quiet**, not only `claimed`: the motivating case was a resumed claim, but every quiet row on the board that day was `wip` with a three-week-old commit, and a dirty worktree means the same thing whatever put the branch there.

  **Empty had to stop meaning two things.** A worktree directory can be deleted without `git worktree remove`, and the entry survives in `git worktree list`. `git status` there exits **128 and prints nothing** — so a check written as _"is the output non-empty"_ reads "clean" and is right _by accident_. Two guards make empty mean one thing: `prunable` entries are skipped (the list already marks them, so running `git status` on a directory known to be gone asks a question answered a line earlier), and the **exit code** is read rather than the emptiness, because a failure to observe is not evidence of cleanliness.

  **No cap, and the measurement is the reason:** 6.6 ms per worktree, so twenty cost ≈133 ms against a scan that already runs 500–1050 ms. A cap would be stock against a problem the numbers rule out, and caps drop results silently unless they also report saturation. The worktree list is read once per run, not once per branch — the same bundling the merge walk uses, for the same reason: the board polls every 5 s.

  **The plan modal shows the local worktree path.** `git worktree list --porcelain` returns it beside the branch and the scan previously dropped it; keeping it costs nothing and answers a question the row cannot — _where is this checked out on my machine._ In the modal rather than the row, because a row is a triage line and already full, while a path is what you want once you have decided to go look. Shown for **clean** worktrees too: that is the one place the clean/dirty distinction inverts, and consistently so — dirtiness is evidence of _work_, presence is evidence of _location_, and the modal asks about location. A modal opened on a teammate's laptop shows no path rather than one that does not exist there.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#149](https://github.com/plot-pm/plot/pull/149) [`eee81f5`](https://github.com/plot-pm/plot/commit/eee81f5afe8c00bcdc2c9df503561f4da8fd05bd) Thanks [@jwloka](https://github.com/jwloka)! - A branch holding commits nobody has pushed reads as **working** rather than quiet, and the row says how many.

  **`local_dirty` cannot answer this case, by construction.** It reports _someone is editing_, and committing **clears** it. So the moment a worker finishes tidily and pauses before pushing, the worktree is clean, the flag is false, and the board reads **"claimed, no commits yet"** for a branch holding a complete implementation. That is not hypothetical: it happened on 2026-08-16 on `bug/fleet-sees-local-work` — the very branch that fixed the other half of this blindness — at 3 commits ahead, 0 dirty files, no PR. The gap opens **exactly when the work is most complete**, and complete-but-unpushed work is also work with no backup and nothing for a merge-queue check to inspect. That day it also blocked a dispatch: a branch could not start while the collision it had to avoid existed only on one machine's disk.

  **It is a ref question, not a worktree question** — and getting that wrong was this plan's own first draft. `local_dirty` has to go through the worktree list because dirtiness is a property of a _working directory_: only the checkout knows whether files were edited. Aheadness is not. Worktrees share one ref database, so `refs/heads/<branch>` answers from the main repo for a branch checked out in a _different_ worktree, and the comparison needs no `git -C` at all. Binding it to the worktree list would have been _consistent_ with `local_dirty` and wrong: a local branch with no worktree — checked out once and moved away from, or fetched from a colleague — still holds commits nobody else can see, and the worktree-shaped version would silently skip exactly those. Two signals that answer different questions read from the sources that actually hold the answers.

  **Ahead only; divergence is not this question.** `rev-list --count A..B` counts one direction, and that is the right one. The question is _does work exist here that nobody else can see_, and unpushed commits are exactly that whether or not the branch also trails the remote. Being _behind_ is not an invisible state — it is sitting in the remote for anyone to read — and reporting it would answer a second question with no action attached.

  **It obeys the same rules as the signal it joins**, which is the argument for adding it here rather than designing something new. _Absent is not false_: a branch with no local ref answers from refs exactly as today, so every detached worker, every teammate's laptop and every CI run is unaffected. _One-directional_: it may lift a branch out of quiet and may never downgrade a group, and a branch with an open PR still answers about its PR. _Read the exit code, not the emptiness_: a missing upstream exits **128 with empty output** — bit-identical to the deleted-worktree signature the shipped code already handles — so empty output must not read as "zero ahead", for exactly the reason empty `git status` output must not read as "clean". _No cap_: 5.2 ms per call against the 6.6 ms per worktree the scan already accepts, so twenty branches cost ≈104 ms on a scan that runs 500–1050 ms, and the count follows the plans rather than the checkout.

  **Dirty and ahead are different facts, and the row says both, unpushed first.** `local_dirty` means _someone is editing_; `local_ahead` means _finished work exists that nobody else can see_. An earlier draft reported only the unpushed commits, on the grounds that they are the more urgent fact. That is true and not a reason to drop the other: suppressing a true fact because a second one outranks it is precisely the displacement `deferred` used to cause to the note text. The two together also change the advice — _push this_ versus _push this, and someone is still working_ — which is the whole reason to distinguish them. A branch whose only local evidence is uncommitted edits reads exactly what it read before.

  **An unpushed count is not an age, and is not shown as one.** _"2 commits not pushed locally"_ answers a question no timestamp can: it names an action, and the action belongs to a specific machine.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#159](https://github.com/plot-pm/plot/pull/159) [`cca0c29`](https://github.com/plot-pm/plot/commit/cca0c2978bf00eeda6ae3cc025e2e3f65bd6a368) Thanks [@jwloka](https://github.com/jwloka)! - The fleet pulse now says whether a claimed branch actually has a **worker**, and the row says so. A claim is a push — it means a dispatcher _took_ the branch, and nothing more. On 2026-08-17 three rows sat in **WORKING** with a pulsing green dot while nobody was working on any of them: the claim was real, the worker was never started, and the row had no word for the difference.

  **The states already existed and nothing read them.** `worker_state()` in `plot-dispatch.sh` has distinguished **five** outcomes since the day it was written — `running <pid>`, `finished <pid>`, `failed <pid> (exit N)`, `ended <pid> (status unknown)` and `no worker` — and it already handles the traps, including rejecting a pid of `0` explicitly. Measured against the board: `grep -rn "plot-worker.pid" packages/board/src` returned **nothing**. The information was richer than the board assumed and reached no screen. So this adds no liveness check; it reports the one that exists.

  **All five travel, because collapsing them re-creates the very defect being fixed.** `failed (exit 1)` and `finished` are **opposite actions** — a crashed worker needs restarting, a finished one needs reviewing — and a row that says "ended" for both leaves the reader to open a log to find out which. That is the same one-label-two-states shape as `no commits yet` covering both an idle branch and a finished-but-unpushed one. A failed worker is also not a _working_ row: it goes where its action is, `waiting-on-you`, because a person has to decide whether to restart it. A crashed worker wearing a pulsing dot is the exact misreport this removes.

  **A missing pid means _unknown_, not _nobody_.** `plot-dispatch` writes `.plot-worker.pid` only where it started the worker itself, so a hand-started agent leaves none — and hand-starting is the normal case for as long as `Worker command` is unset. **Five agents were started that way in one session**; reading a missing pid as "nobody is working" would have reported every one of them dead. So the group does not move, and only the sentence changes: the row says _claimed, no known worker_ instead of promising commits are on the way. Absent is not false, the rule the scan already applies to every other missing signal.

  **A branch with no worktree here is a third state, not the second one.** The pid lives _in_ the worktree, so a branch claimed and started on another machine has no path to look at — this machine cannot answer the question at all, which differs from looking and finding nothing:

  | claim | worktree | pid | row says                                                        |
  | ----- | -------- | --- | --------------------------------------------------------------- |
  | ✓     | ✓        | ✓   | `worker running (pid N)` — or the finished/failed/ended variant |
  | ✓     | ✓        | —   | `claimed, no known worker`                                      |
  | ✓     | —        | n/a | `claimed elsewhere`                                             |

  The actions differ, which is what earns the third string: _look in this checkout_ versus _ask the machine that took it_. Same split as `local_dirty` and `local_ahead` — two questions answered from the sources that hold the answers, rather than one signal stretched across both.

  **A pid of `0` never reads as running.** `kill -0 0` signals the whole process **group** and succeeds, so a naive liveness check reports it alive forever. The scan rejects it exactly as `worker_state()` does, and the verdict travels to the board as a value rather than being re-derived there — re-deriving liveness on the far side would spring the same trap a second time. Its test spawns a **real** process for the running case, because `kill -0` is a real syscall and a fabricated pid would agree with a broken implementation by luck.

  **The read costs one file check at a stop the scan already makes.** `worktree_rows()` visits every worktree and already knows which branch each holds, so there is no new traversal and the no-worktree case falls out of the existing structure rather than needing a guard. It obeys the same rules as the local signals it joins: git-only (no host call, so the board can keep polling every 5 s), one-directional — a stopped worker may lift a row up to `waiting-on-you`, and `none`/`elsewhere` move no group at all — and the human report is left byte-identical, because the worker fact belongs to `--json` and the row it feeds.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#165](https://github.com/plot-pm/plot/pull/165) [`a53f443`](https://github.com/plot-pm/plot/commit/a53f4435a20d60007451b9c266fcd4ad444f736e) Thanks [@jwloka](https://github.com/jwloka)! - A pull request's condition now travels to the board as data rather than as a
  sentence, and `conflicts` stops masquerading as `no checks`.

  `AgentRow.pr` grew from `{ number, url }` to carry the PR's own state:
  `{ number, url, draft, state }`, where `state` is one of `green`, `pending`,
  `failing`, `none`, `conflicts` or `unknown`. Everything else about a PR — green,
  draft, no checks — used to exist solely inside the row's note, assembled by
  different branches of the server's classifier. That is why one row read
  `PR [#57](https://github.com/plot-pm/plot/issues/57) green` and the next `PR [#116](https://github.com/plot-pm/plot/issues/116), no checks`: nothing downstream could make
  them agree, and nothing could render a badge from a sentence without parsing it
  back apart.

  **`draft` stays a separate boolean and is deliberately not one of the states.**
  It answers a different question — _is this offered for review_ — and the two are
  independent: a draft has CI like anything else, which `draftNote` already says
  ("draft, CI running"). Folding it into the enum would move the short-circuit
  that kept WAITING ON A MACHINE empty out of the classifier and into the
  contract, where it is harder to see and shared by every consumer.

  **`conflicts` needed one field from the host.** `plot-host.sh pr-list --rich`
  now fetches `mergeable` (with `mergeStateStatus` corroborating), because GitHub
  starts no workflow for a branch that does not merge cleanly — so a conflicting
  PR reports an _empty_ check rollup and read as `no checks`, indistinguishable
  from a bot PR whose run awaits a human click. One wants a rebase, the other
  wants a click. Measured twice on this repo's own PRs: [#149](https://github.com/plot-pm/plot/issues/149) and [#160](https://github.com/plot-pm/plot/issues/160) both said
  `no checks` while GitHub said _this branch has conflicts that must be resolved_.

  `conflicts` outranks `none` where both hold, because it is the cause and the
  other its consequence. A workflow genuinely awaiting a human still says
  `no checks`.

  Bitbucket reports `mergeable: "unknown"`, following the precedent beside it:
  `bb pr list` carries no mergeability verdict any more than it carries a check
  rollup, and the honest gap beats an invented answer. Consumers must not read it
  as clean — absent is not false.

  Nothing new renders yet: this is the field the row's PR cell will be built from.

- [#170](https://github.com/plot-pm/plot/pull/170) [`9adf0ca`](https://github.com/plot-pm/plot/commit/9adf0ca7e66cc447c0cbd972896daf875597e8c2) Thanks [@jwloka](https://github.com/jwloka)! - A worktree holding `.git/index.lock` reads as **working** — a write is in progress this instant — rather than being skipped in silence.

  **The function that makes agents visible was the one that tripped over them.** Since [#137](https://github.com/plot-pm/plot/issues/137) `plot-fleet-scan.sh` runs `git status` inside every worktree on the machine. When that call could not answer, the loop hit `continue`: the worktree was not reported at all, and the branch fell back to answering from refs exactly as though this machine had no checkout for it. The row then read _claimed, no commits yet_ while an agent was committing to it. The branch that looked least active was the one being written to.

  **Absent was the right instinct applied to the wrong question.** An earlier draft of the plan had the defect wrong and the measurement corrected it: the scan does _not_ read a failed `git status` as clean. It already reads the exit code, and the file argues the rule at length — _a failure to observe is not evidence of cleanliness_. That half was shipped and correct. What was wrong is that a lock is **not a failure to observe**. It is the most informative state a worktree can be in: `.git/index.lock` means _an agent is writing here, right now_, which is precisely what the fleet view exists to show. The fact was computed, discarded, and replaced by silence.

  **A third signal, because it answers a third question.** `local_locked` joins `local_dirty` and `local_ahead` under the same five rules, and none of the three is a flavour of another: _someone is editing_, _finished work nobody else can see_, _a write is in progress this instant_. Collapsing any pair would repeat the one-label-two-states defect this story keeps finding. Like its two neighbours it is strictly **one-directional** — it may only _lift_ a branch out of quiet, never downgrade an answer — so a branch whose PR already answers keeps that answer, and `false` is what every branch on every other machine reports.

  **The lock is observed directly, and that corrects the plan.** The plan expected a lock to announce itself by _failing_ `git status`, so that reading the exit code would be enough. Measured on 2026-08-17, it does not: `git status --porcelain` exits **0** under a held lock in every ordinary condition — clean tree, modified file, staged change, untracked file, stale stat info. Git takes the index lock only when it decides to _write_ a refreshed index back, which it skips whenever cached stat info already answers. The failure the plan was written from is real and **racy** — it reproduces when the index is stale enough to force a refresh-and-write, and not otherwise. Keying the signal on that exit code would report a lock on some runs and not others for the same worktree in the same state, and a flaky signal is worse than none: it teaches the reader to disbelieve the row. So the question is asked of the filesystem, where the answer is unambiguous.

  **Locked stayed distinguishable from missing**, which is what the direct check buys. Both would otherwise fail `git status` with identical empty output, and collapsing them would recreate the very absence ambiguity the exit-code rule exists to remove — one label over two states, in a new place. They are now two independent observations: a vanished directory has no git dir to look in and reports nothing at all, exactly as before.

  **No git call, because the filesystem already states it.** A linked worktree does not keep its index beside the repository's — `.git` there is a file reading `gitdir: <repo>/.git/worktrees/<name>`, and that is where its `index.lock` lives. Testing `$wt/.git/index.lock` would answer for the main checkout only and report every dispatched agent's worktree unlocked, which is the whole population this signal is about. `git rev-parse --absolute-git-dir` would answer both shapes and costs **14 ms** measured — against the 6.6 ms per worktree the sweep already accepts, so asking it per worktree would roughly triple the cost of the local signals to learn something a stat and a 50-byte read already say.

  **It never retries and never waits.** A lock held through a rebase can last seconds, the next poll is 4 s away and will find it unlocked, and a scan that blocks on one worktree makes the pulse late for every branch on the board — a worse version of the defect being fixed. Reporting beats blocking, and the test asserts it by counting status calls rather than by timing, because a timing assertion cannot tell a retry that happened to be fast from no retry at all.

  **The note says the lock alone.** Under a lock the reader is being told to _wait_, where _2 commits not pushed_ tells them to act; saying both would give one row two opposite instructions. The other signals keep their own evidence — a locked worktree that is also dirty still reports both facts in the JSON, each on its own observation, because neither is derived from the other.

  <!--
  bumps:
    skills:
      plot: minor
  -->

### Patch Changes

- [`de4e660`](https://github.com/plot-pm/plot/commit/de4e660ba6104441c5b8261282d2f1d97ddfa8bd) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch` now writes its `Started:` record into the empty
  `- **Started:**` placeholder the plan template ships, instead of appending it
  after the last item in `## Status`.

  The old rule found the last list item under the heading, which is correct only
  if `Started:` is the final field — it is not, `Delivered:` is. So the record
  landed below `Delivered:`, leaving a Status block that listed a start after a
  delivery. Nothing failed loudly, because the parser reads the record wherever
  it sits; both plans dispatched on 2026-08-16 had to be tidied by hand.

  Plans with no placeholder (pre-Plot-2 files) keep the old append behaviour.

- [#154](https://github.com/plot-pm/plot/pull/154) [`9226c29`](https://github.com/plot-pm/plot/commit/9226c29e5510a310a3f0a608dde61ce5e837bea2) Thanks [@jwloka](https://github.com/jwloka)! - A drafted plan's branches stop reading `eligible — nobody has taken it`

  NOT STARTED means _discovered, planned, ready for an agent to pick up_. A plan
  still under review has not reached that point, and `plot-dispatch` refuses its
  branches — so the row was offering an action the tool declines, which is the
  same mismatch the Start button already avoids by appearing only on eligible
  rows.

  Seen live twice: a plan drafted minutes earlier, its plan PR still in CI, its
  branches immediately indistinguishable from work that had been waiting since
  February. Such a row now reads `plan not approved yet — still in review`,
  naming the review rather than merely saying _blocked_ — and loses its Start
  button by construction, since the button matches the eligible sentence.

  Derived, never stored: the pulse has carried each plan's phase since [#140](https://github.com/plot-pm/plot/issues/140),
  deliberately as data, and the row re-derives from it on every scan. Approving
  the plan flips the note on the next scan with nothing to clear.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#144](https://github.com/plot-pm/plot/pull/144) [`3d69fd7`](https://github.com/plot-pm/plot/commit/3d69fd7ba447c6ec7d37c6b4cb920a41513ac317) Thanks [@jwloka](https://github.com/jwloka)! - Conflicts in the board bundle are settled by rebuilding, not by reading.

  `skills/plot/scripts/board/board-server.mjs` is generated output: **177 lines holding 796 KB**, roughly 4,500 characters each. Git merges line by line, so every board change — whatever source file it came from — lands in the same handful of enormous lines. Two branches touching entirely disjoint sources still collide there, and the diff cannot be meaningfully read.

  That was the binding constraint on parallel board work, three times on 2026-08-16. PR [#141](https://github.com/plot-pm/plot/issues/141) demonstrated it while the plan was being written: `merge-tree` named exactly one conflicting file, this one, with zero source conflicts. `App.tsx` and `AgentList.tsx` merged cleanly; the generated bundle did not.

  **A conflict in a reproducible file is not information.** `pnpm build:board` regenerates the artifact from sources that merged cleanly, so any version of it is exactly as good as any other. `.gitattributes` now marks it `-merge`, and git stops trying to reconcile it.

  The measured difference is sharper than "no conflict". Without the attribute, git splices conflict markers **into** the bundle, leaving 796 KB of unparseable JavaScript that a rebuild cannot even run against. With it, git keeps one version whole and reports the conflict, so the file stays valid and buildable:

  ```bash
  git checkout --ours skills/plot/scripts/board/board-server.mjs   # either side
  pnpm build:board
  git add skills/plot/scripts/board/board-server.mjs
  ```

  **An attribute, not a custom merge driver.** `merge=rebuild` invoking the build is the more elegant idea and the more dangerous one: `.gitattributes` is versioned and travels with the repo, but a driver _definition_ lives in each clone's `git config`. On CI and fresh clones the attribute would name a driver that does not exist, and git falls back to a normal merge **silently** — a rule that works only where someone remembered to install it.

  **The resolution names no side, and that is load-bearing.** Measured on the real artifact: a `git merge` keeps the branch being merged into, a `git rebase` keeps the upstream. "Ours" inverts between them, and agents here rebase routinely, so a side-named instruction is right in one flow and wrong in the other. Since the rebuild overwrites whatever was kept, the instruction is _take either version, then rebuild_.

  **The file stays in git and the CI gate is untouched.** `pnpm board` starts it with no build step and the plugin ships it; CI runs `pnpm run build:board` itself and byte-diffs, so the committed file is an expectation rather than an input. The gate is what keeps this honest — resolve by keeping a stale artifact and forget to rebuild, and the no-diff check fails. The strategy removes the _conflict_; the gate still enforces _correctness_.

  `test/reconcile/artifact.test.mjs` asserts this against the real artifact rather than a fixture, since the 177-line shape is what causes the failure: that disjoint-source branches leave the bundle whole and marker-free, that a merge and a rebase commit byte-identical artifacts, that it works in a clone which configured nothing, and — as a control — that without the attribute the same merge corrupts the file.

  One thing this deliberately does **not** change: `git merge-tree` still predicts the conflict, because `-merge` governs how git _resolves_ the file rather than whether it _reports_ one. `plot-merge-queue` therefore goes on flagging every board pair — now over-cautious rather than wrong, since what it names costs a rebuild instead of an afternoon of reading. Prediction is this plan's second wave; the behaviour is pinned in a test so it is recorded rather than rediscovered.

  The procedure is documented in `docs/definition-of-done.md`, with the short form in `CLAUDE.md` and `AGENTS.md` where an agent hitting the conflict will already have it in context.

  <!--
  bumps:
    skills: {}
  -->

- [#143](https://github.com/plot-pm/plot/pull/143) [`eed6880`](https://github.com/plot-pm/plot/commit/eed6880a9621575bec1e0ca8f26140b49fde8e71) Thanks [@jwloka](https://github.com/jwloka)! - The board binds its port once and reports the port it bound.

  A port was chosen at one moment and used at another, with nothing carrying the
  answer between them. On 2026-08-16 that cost three separate incidents: a CI
  flake on PR [#131](https://github.com/plot-pm/plot/issues/131) (`a plans dir NESTED in an unrelated repo borrows nothing from
it`, passing on rerun with the identical commit), a `pnpm board` that refused to
  start with a raw `EADDRINUSE` stack trace, and a tab bookmarked on a port whose
  server had died.

  **`PORT=0` binds zero and reports what the OS assigned.** The default stays
  7777 — a development board on a random address is not bookmarkable, and
  `pnpm board` would land somewhere new every time.

  **The bound port reaches the same-origin check.** `const PORT` was evaluated at
  module load, before `listen()`. Under `PORT=0` the constant stayed `0` while the
  real port was something else, so `/api/dispatch`'s allowlist would have read
  `http://localhost:0` and refused **every** browser origin — silently disabling
  Start work, the one endpoint that spawns processes. The port now comes from
  `server.address()` inside the listen callback. That inconsistency existed
  already; `PORT=0` only made it impossible to ignore.

  **`findFreePort` is deleted**, and all 28 call sites across 8 test files read
  the started server's port instead. The helper bound port 0, read the number,
  **closed**, and handed it to a different process to bind later — a
  time-of-check-to-time-of-use race that CI, running test files in parallel on one
  machine, lost often enough to gate a plan PR. `startServer` already parsed the
  port out of the readiness line it waits on and discarded it. It is not fixed
  with a retry loop: a test that fails once in fifty runs is harder to diagnose
  than one that never does.

  **A second `pnpm board` names the running one and exits 0.** The failed
  `listen()` is the check — probing beforehand would rebuild the very race being
  removed. It reports and stops; it never kills the running board, because several
  worktrees run side by side and a `pnpm board` in one terminal shooting down
  another's is a worse failure than the one being fixed. Seven board servers
  accumulated on 2026-08-16, at 80 GraphQL calls/hour each, because nothing
  connected a new invocation to an existing one.

- [#129](https://github.com/plot-pm/plot/pull/129) [`d726385`](https://github.com/plot-pm/plot/commit/d7263858b83b0516eb3a39eebae42c8d6bf16fe2) Thanks [@jwloka](https://github.com/jwloka)! - `plot-fleet-scan.sh` tells _merged and deleted_ apart from _never started_.

  `branch_state()` opened with one question — does `refs/remotes/origin/<br>` exist? Absence carries two meanings and the script silently picked one: a branch that never existed and a branch whose PR merged with its ref deleted at merge are the same missing ref, and both answered `open`, which the wave arithmetic reads as **outstanding**. A finished wave never completed, and the branch downstream of it stayed blocked.

  That stopped being cosmetic when the gate got an automated reader. On plot's own repo, with both of `board-reads-git`'s PRs merged and both refs deleted:

  ```
  $ plot-dispatch.sh --dry-run board-reads-git
  summary: dispatched=2 reused=0 skipped=0 started=0
  ```

  The entire completed plan would be re-dispatched. Nothing downstream stops it either — `plot-dispatch.sh`'s `exhausted` guard has exactly two triggers, both _contention_ conditions, and neither fires here: the refs are gone, so each claim push **succeeds**, recreating the deleted ref and handing an agent a worktree whose diff is already on main. After the fix that same command reports `dispatched=0`.

  Nothing local survives the ref — no reflog, no packed remnant. What survives is the merge commit on the default branch, so `branch_state()` asks one question before answering `open`: did this branch land? Candidates are what is **reachable** from the configured default branch, matched by an anchored subject:

  ```
  ^Merge pull request #[0-9]+ from [^/]+/<branch>$
  ```

  A hit returns `merged` — already the state that settles a wave, so the arithmetic is untouched and no new state enters the vocabulary. Absence keeps `open`: the fix can only move a branch from `open` to `merged`, and only on positive evidence.

  **The anchoring is the whole mechanism.** Of this repo's 119 reachable merges, eleven are _backward_ merges (`Merge remote-tracking branch 'origin/main' into <branch>`) — subjects that also name a branch, with the opposite meaning. A name-only grep would read all eleven as merge evidence and report unfinished work as finished, opening the next wave on an unlanded seam. That inversion is worse than the bug being fixed. Measured: 0 of the 11 match the anchored pattern.

  **Two structural filters were tested away, and tests now keep them out.** A second-parent counter-check does not discriminate — PR merges and backward merges both have a distinct second-parent tip, so it would have passed on all eleven traps. A first-parent filter measured well at "119 merges → 109 on the chain" but against the wrong baseline; compared with the anchored pattern it scores 108 to 108, catching nothing extra, and it breaks GitFlow — a feature merged via `develop` is not on the first-parent chain and would read `open` while its work is an ancestor of main.

  The history is read **once per run**, not once per branch: `branch_state()` runs per branch and the board polls every 5 s, so the naive shape is O(history × branches) where O(history + branches) is available (197 ms vs 79 ms on a 2000-merge fixture). `MERGE_SCAN_LIMIT` is 2000 and **saturation is reported** — a blind cap re-creates this very bug, since at 300 against 2000 merges an early merge is not found and reads `open`.

  The footer gains `merge_detect=pr-merge|truncated|none`, in the shape `plot-reconcile-scan.sh` already uses for `pr_source`. `open` must stop meaning both "never started" and "I could not tell", and `truncated` is its own value because a capped walk detected but not exhaustively. `none` marks a squash/rebase repo, where `open` says nothing about merging at all.

  **The ref check stays in front, and a test pins it.** A branch name can be reused — merge `bug/flaky`, delete it, recreate it for a second attempt — and the first attempt's merge subject is still on main. That is stale evidence, and it is harmless only _by placement_: the lookup lives in the no-ref arm, and a recreated branch has a ref. Hoisting the merge check to the top of `branch_state()` is a natural tidying move that would silently report in-flight work as `merged`.

  Detection reads git and nothing else — no plan `→ #<n>` annotations (the missing annotation and the missing delivery have the same cause; `board-reads-git` had both branches merged and neither annotated) and no host calls, which is what keeps the scan free enough to poll every 5 s.

  <!--
  bumps:
    skills:
      plot: patch
      plot-fleet: patch
  -->

- [#125](https://github.com/plot-pm/plot/pull/125) [`12bc6d1`](https://github.com/plot-pm/plot/commit/12bc6d1fc12bf13925b2f27fb0355c5cc7eb9890) Thanks [@jwloka](https://github.com/jwloka)! - `plot-reconcile-scan.sh` tells _contained in an open PR_ apart from _orphaned_.

  Section 3 asked one question about open PRs — is this branch the **head** of one? A branch sitting below the head of an open PR answered no and fell through to `else`, which calls it an orphan. Stacked work is ordinary, so the section described perfectly live branches as abandoned: on plot's own repo seven of eight `stale=` entries were the `opus5-hardening` branches, all ancestors of the head of PR [#57](https://github.com/plot-pm/plot/issues/57). That is enough false noise to make a person stop reading the section, which costs the true finding hiding among them.

  The scan now also asks whether an unmerged branch is an ancestor of any open PR's head. A hit is reported in its own block and does **not** count toward `stale=`:

  ```
    -- contained in an open PR (work in flight, not stale) --
    origin/feature/stack-base — contained in open PR [#200](https://github.com/plot-pm/plot/issues/200) → not orphaned
  ```

  Printing rather than staying silent keeps the section honest about what it examined and rejected — a scan that quietly drops findings is the defect this whole plan was written to fix.

  Two ordering constraints, both load-bearing and both easy to get backwards.

  **The claim check comes first**, and the obvious justification for that is wrong. An empty claim is an ancestor of _nothing_: its claim commit puts it one commit **ahead** of the branch point, so the ancestry runs the other way. The real case is the reverse — once a worker builds on its claim, the claim commit becomes part of the working branch, which is typically the head of the PR it opens. Such a claim is legitimately contained in an open PR, and must still be reported as a **claim**, because that is the more specific fact. Inverting the two silently drops `claims=` to zero.

  **Containment is only asked for unmerged branches.** A merged branch is an ancestor of the main branch, and therefore of every open PR branched from it; asking before the merged check would swallow the entire deletion-candidate class.

  The open-PR list now carries each PR's number alongside its head branch, since the report names the PR a branch is contained in. That rides along on the bundled call already being made — still one `--state open` call per run, one extra JSON field.

  Cost is one `git merge-base` per candidate per open PR, bounded by branches × open PRs, and only reached by branches that already failed the head test. Where PR state is unavailable (`--offline`, `--no-pr`, or no host CLI) there is no list to test against, so containment is skipped rather than guessed and the branch keeps its previous verdict.

  <!--
  bumps:
    skills:
      plot: patch
      plot-reconcile: patch
  -->

- [#122](https://github.com/plot-pm/plot/pull/122) [`7ab8b05`](https://github.com/plot-pm/plot/commit/7ab8b0568bf5e29045cf99896571f94939858fc8) Thanks [@jwloka](https://github.com/jwloka)! - `plot-reconcile-scan.sh` finds plans whose implementation rode a single PR.

  Section 2 asked one question — is a branch this plan names present in `git branch -r --merged`? In single-PR mode the plan and its implementation share one idea branch, and that branch is deleted at merge. The ref is gone, so the answer was always no, and the plan sat in Approved unreported. `kanban-board-v1` hung that way for five weeks while the scan called the repo clean. The check was looking for the right thing in a place where it could not be.

  The scan now also matches each plan's named branches against the heads of merged PRs, fetched once per run beside the existing bundled open-PR list. A plan is merged-but-not-delivered if **either** signal fires. The two are OR-ed rather than swapped: fan-out plans keep being caught by the branch check, since their per-branch PRs merge at different times.

  The obvious fix — read the plan's own `prs` field and ask the host about it — was rejected because it misses its own motivating case. `kanban-board-v1` carried no PR annotation at all while it hung; `→ [#40](https://github.com/plot-pm/plot/issues/40)` was back-filled at delivery. The missing annotation and the missing delivery share a cause, so an annotation-keyed check is blind to exactly the sloppy plans it exists to catch. Matching branch names against merged PR heads needs neither a surviving ref nor a recorded number.

  Cost stays constant in plan count: one bundled `--state merged` call per run, not one `pr-state` call per plan. The list is fetched with `--limit 500`, because gh's default page of 30 reaches back only to [#90](https://github.com/plot-pm/plot/issues/90) on plot's own repo — [#40](https://github.com/plot-pm/plot/issues/40) is invisible at the default, and silently missing old plans is this check's own failure mode. Measured on that repo, 200 and 500 both cost ~0.8-1.1 s; the round trip dominates, so the headroom is nearly free.

  Both degraded paths now say so instead of printing a bare `(none)`: `--offline`/`--no-pr` note that merged-PR heads were not consulted, and a saturated list reports that older PRs went unexamined. A check that quietly skipped used to be indistinguishable from a check that found nothing, and silence reading as health is the defect this section was fixed for.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#166](https://github.com/plot-pm/plot/pull/166) [`8eeacb9`](https://github.com/plot-pm/plot/commit/8eeacb9b557aef16141b690dfd7736facb2707c6) Thanks [@jwloka](https://github.com/jwloka)! - A board server started by the test harness exits when the run that started it is gone.

  Measured on 2026-08-17 at 02:00: four `board-server.mjs` processes, two of them
  on random high ports — which only `packages/board/test/helpers.mjs` asks for,
  via `PORT=0` — with **PID 1 as their parent**. The test runs that spawned them
  were long gone, eighteen seconds apart, and both were still answering
  `/api/fleet` with 200 and still polling. That accumulation is why the Agents tab
  reported `0 branches across 0 plans` during a five-agent run: the fleet view
  exists to make parallel work visible, and the more parallel work ran, the less
  reliable the view of it became.

  **This was not a discipline problem.** 26 `startServer(` calls against 24
  `.kill()` calls in `after()` hooks — the tests clean up correctly. But
  `startServer` _returns_ a `kill` function for the caller to invoke, which makes
  cleanup a **rule** in this repo's vocabulary: you can answer "did I clean up?"
  without having done it, because `after()` never runs when the runner is killed
  rather than finishing. Ctrl-C, a dying agent, a `SIGKILL`: no hook fires, and
  POSIX hands the child to PID 1.

  **The server now measures its launcher rather than trusting one.**
  `process.ppid` becomes `1` the moment a parent dies, **however it dies** —
  measured with a probe: parent killed by `SIGKILL` (exit 137, so no handler of
  its own could run), child observed `ppid changed 20996 -> 1` within 200 ms. A
  1 s interval polls it. That is a gate rather than a rule, it needs no
  cooperation from the caller, and it survives the exact case that produces
  orphans: the one where no cleanup code runs at all. It also fails safe — a check
  that never runs leaves behaviour exactly as it was.

  **It is gated on a new variable, `PLOT_EXIT_WITH_PARENT`, and the distinction
  cannot be the ppid change itself.** The operator's board runs under
  `node --watch`, whose supervisor _replaces its child on every restart_ — so "my
  parent changed, therefore exit" is true for both, and the operator's board would
  be the one that dies. A board in a terminal the operator then closes is likewise
  meant to keep running. `helpers.mjs` already passes `PLOT_REPO_ROOT` and
  `PORT=0` to every server it starts and the operator's board has neither, so
  either could serve as a tell; neither should. `PLOT_REPO_ROOT` answers _where
  the repo is_ and `PORT=0` answers _pick a port for me_ — inferring from either
  would work by accident today and surprise whoever sets them for their actual
  meaning tomorrow. One variable, one question.

  One variable covers the agent case with no second mechanism: agents run
  `pnpm test`, which goes through this same `helpers.mjs`, so their servers
  inherit it exactly as a human's do — the case producing the most orphans is the
  same case.

  **Two neighbouring answers were checked and rejected.** A global teardown runs
  only when the suite ends **in order**, which is precisely what the per-suite
  `after()` hooks already cover; the orphans measured at 01:54 came from a run
  that did not end in order, and a teardown would have missed both. And
  `helpers.mjs` spawns _without_ `detached: true`, so these were ordinary children
  that got orphaned — adding it would have made the problem deliberate.

  Tests assert against `SIGKILL`, never `SIGTERM`: a handler-based cleanup passes
  the polite case and leaves exactly the orphans this exists to remove.

- [#128](https://github.com/plot-pm/plot/pull/128) [`ca85b5e`](https://github.com/plot-pm/plot/commit/ca85b5e4f9d085d4c9fd2d06e1152bca28e9bfb6) Thanks [@jwloka](https://github.com/jwloka)! - `plot-update-board.sh` gains a test.

  It had none, which is why a missing transition — new implementation PRs never reaching _Ready_ — survived five months before [#98](https://github.com/plot-pm/plot/issues/98) closed it. A board update that never happens is indistinguishable from a board nobody configured: nothing fails loudly, so nothing but a test could have caught it.

  The happy path needs a real GitHub Project, so the suite pins everything around it, which is where the failure actually lived. `gh` is PATH-stubbed per subcommand and every run happens in a throwaway git repo, so the tests are fully offline and never touch the host repo's board cache.

  **Argument handling.** Zero through three arguments exit 1 with the usage string, and never reach `gh`; four arguments do not exit 1 and drive the full `view → item-add → field-list → item-edit` sequence, with the status argument selecting the matching option id.

  **Graceful degradation.** All six unreachable-board paths — unresolvable project, failed `item-add`, failed `field-list`, a project with no Status field, an unknown status option, a failing `item-edit` — exit **0** with their warning on stderr rather than stdout. So does a `gh` that is missing from PATH entirely, and so does a run from outside any git repo. This is the load-bearing behaviour: the script is called from skills that must not fail when no board is configured, and it is exactly why the missing call was silent.

  **Every status has a caller.** Each of `Planning`, `Ready`, and `Done` appears in some `plot-update-board.sh` invocation under `skills/`. This is deliberately a test about skills rather than about the script — the defect was never in `plot-update-board.sh`, it was in nobody calling it. Deleting the `Ready` caller reproduces [#98](https://github.com/plot-pm/plot/issues/98) and fails exactly this test and no other.

  It asserts the status **set**, not skill-to-status pairs. Pinning `plot-approve → Ready` would be stricter and would also catch "the wrong skill calls it" — but it would break on exactly the kind of restructuring that caused the gap: Plot 2 moved branch creation from `/plot-approve` to `/plot-implement`, and a pair-based test would have gone red for a legitimate move while staying silent about the transition actually disappearing. A companion test guards the three against passing vacuously if the grep or the argument shape ever drifts.

  Two further properties ride along because they are cheap and were never pinned: project metadata is cached under `.git/` rather than into the working tree (and a second run reuses it, skipping `view` and `field-list`), and the script uses no bash-4-only constructs, since macOS ships bash 3.2.

  Assertions are per line rather than whole-output regexes — this suite has been fooled three times by patterns matching across report lines. Each test was verified to fail under a targeted mutation of the behaviour it claims to pin.

  No skill version bump: this adds coverage only — `plot-update-board.sh` and every skill that calls it are unchanged.

## 2.3.0

### Minor Changes

- [#108](https://github.com/plot-pm/plot/pull/108) [`576bde8`](https://github.com/plot-pm/plot/commit/576bde8d50d152eee8a179989a51700a7b7247a4) Thanks [@jwloka](https://github.com/jwloka)! - The board shows the four workflow phases instead of the four plan states.

  Columns are now **Discovery · Design · Development · Endgame · Released**, which asks _who leads_ rather than _what has happened_: three phases are human-led and exactly one — Development — is agent-led.

  **`Approved` spans a phase boundary**, and that is the substantive change. A plan with no `Started:` record sits at the end of Design, waiting for a person to begin; one with a record is in Development, where an agent is working. The board already carried that data as a Ready/In-progress badge and simply did not read it as a phase change. The badge stays only for the waiting half, since a card in Development is started by definition.

  **Development ends at the merge.** A column is a partition, so Delivered belongs to Endgame alone: the code landed, the agents are done, and what remains — verification and signoff — is human-led.

  Endgame cards carry the release checklist count (`22/27`), parsed from the newest `docs/releases/*-checklist.md`. "Delivered" does not answer what the column asks. A missing or unparseable file yields no badge rather than a guessed number, and the parser is pinned by tests over nested, malformed and prose-mentioning-brackets cases.

  Leadership is carried by a **symbol and a word**, with colour only repeating it — roughly one man in twelve distinguishes red from green poorly, and boards turn up in greyscale screenshots.

  `BOARD_PHASES` changes shape, which is a breaking change for `/api/board` consumers. All four inside this repo move with it: the client, both test suites, and the dev-server middleware.

- [#109](https://github.com/plot-pm/plot/pull/109) [`a2d67f5`](https://github.com/plot-pm/plot/commit/a2d67f5e32faf684b914db3f9d6c1339dcbd1ad4) Thanks [@jwloka](https://github.com/jwloka)! - Stories become swimlanes — one row per story, plans in the column their phase puts them in.

  Off by default and offered only where it can show something: with no stories, lanes would render a single "(no story)" row, which is the board with a wasted column. It is a **layout of the same board**, not a third tab — the question is still "where does this work stand", grouped by story as well as phase.

  The Discovery column doubles as the row header, carrying the story's title, slug, status and plan count. A story with no plans keeps its row: "shaped, nothing planned yet" _is_ the Discovery phase, and hiding the row would hide the one thing the header exists to show.

  Two cases the lane builder refuses to lose. A plan naming a story with **no file** — a typo, or a story not yet written — gets its own row labelled as such, because dropping it would make work vanish from the board. And a test pins the invariant that lanes **partition** the cards: counted twice would double-report work, dropped would hide it.

  Found by looking at the result: a row is as tall as its fullest cell, and the rest stay empty. Harmless in columns, multiplied across rows — one lane with four Endgame cards pushed the next story below the fold. Cells now cap and scroll internally, so every lane stays reachable without collapsing what it holds.

- [#106](https://github.com/plot-pm/plot/pull/106) [`f52fd43`](https://github.com/plot-pm/plot/commit/f52fd43573789975155558f486e751aaba245acf) Thanks [@jwloka](https://github.com/jwloka)! - The Agents tab fills its two empty groups: PR state now says whether a person or a machine is the blocker.

  `plot-host.sh pr-list --rich` carries check status and review decision, so the board never talks to the host itself — Principle 3 keeps that knowledge in one place, and a board shelling out to `gh` would silently become GitHub-only.

  **Check state has four cases, and two of them mean a person is the blocker.** A PR with an _empty_ rollup is neither green nor running: GitHub starts no workflow for a bot PR until a human approves the run, which happened in this repo today. Reporting that as pending would show "CI running" indefinitely while nothing ran, and nobody would look — so it lands in _waiting on you_ with the note **no checks**, saying why it is not green rather than implying it is. `ACTION_REQUIRED` is the same situation from the other side and is likewise not pending. One red check among green ones counts red.

  Where the host cannot report checks at all (Bitbucket), the answer is `unknown` and the row says _unavailable_. An honest gap beats an invented verdict.

  **Review state is shown and never gates.** A row carries _awaiting review_, _changes requested_ or _approved_ as a note beside its age, because an agent waiting on a review is exactly what the person reading the tab can resolve. But membership comes from checks alone: approved is approved with or without a review — a recorded approval is the plan's `Approved:` record, not a host review — and nothing downstream may treat the note as a condition.

  **The two sources cache separately, each with its own age and error.** Git and the host fail independently, so a `gh` hiccup must not stale git data that was available the whole time. The footer reports both ages; a failed PR fetch keeps the last good map rather than blanking it, which would look like state changing instead of data missing.

- [#112](https://github.com/plot-pm/plot/pull/112) [`4dd8699`](https://github.com/plot-pm/plot/commit/4dd8699a35f8cd196e7f0d08811327b0dc43da13) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-release` records the release in the plans it shipped.

  Plot's fourth phase had never been reached — not once across sixteen versioned releases. Step 4 hands off to the project's own release machinery, which is correct, and nothing came back afterwards: the version shipped, the tag landed, and the plans describing that work sat at Delivered forever.

  New step 5b closes it. For each delivered plan it resolves the version **from git rather than from dates** — the last `→ #N` annotation, its merge commit, and the release tag containing it. The delivery date records when a plan was _booked_, not when its code merged; those can be months apart, and two tags may share a date, so day resolution cannot separate them even in principle.

  Three things it deliberately refuses to do. It **skips docs/infra plans**, because `/plot-deliver` already told their authors they are live on merge. It **leaves unresolvable plans alone** and says so — an invented version in a transition record is a claim nobody re-checks. And it **does not move the symlink**: `delivered/` means "no longer active", not "phase is exactly Delivered".

  The step ends with a gate in the shape `/plot-deliver` step 7b established, because this is a multi-file write followed by a push — worse than delivery's, since it touches N plans and a partial write leaves some released and some not with nothing to say which. `unreleased_delivered=0` from the real sweep clears it; anything else is a hard stop.

  It reports what it did **not** mark, with the reason. A silently skipped plan looks identical to a plan with nothing to do — precisely the confusion that hid this for sixteen releases.

- [#111](https://github.com/plot-pm/plot/pull/111) [`4e97318`](https://github.com/plot-pm/plot/commit/4e9731830d9918fd7e26eaf50c7d7a566c177682) Thanks [@jwloka](https://github.com/jwloka)! - The reconcile sweep finds delivered plans that already shipped.

  Plot's fourth phase had **never been reached** — not once across sixteen versioned releases. Nothing compared the two facts: `/plot-release` ships a version, and the plans describing that version stay at Delivered. Neither side is wrong alone, so neither complained.

  Section 6 asks the question git can answer exactly: _which release tag contains this plan's merge commit?_ Deliberately **not** a date comparison — the delivery date records when a plan was booked, not when its code merged (one plan here sat five months between the two), and two tags in this repo share a date, so day resolution cannot separate them even in principle. `plot-host.sh pr-state` now carries `mergeCommit` so the adapter, not the caller, owns that lookup.

  docs/infra plans are skipped by type: `/plot-deliver` already tells their authors "live on main — no release needed", and reporting them would contradict a message Plot itself sends, on every sweep, forever. A plan with no PR annotation is reported as **unresolvable** rather than skipped — "cannot tell" and "nothing wrong" must not look the same, which is the confusion this whole section exists to end.

  The six delivered plans in this repo are back-filled with the versions that actually shipped them (v1.0.0 through v2.2.0, and one correctly still unreleased). `plot-plan-meta.sh` gains `released_raw` so the version is readable rather than re-derivable.

  Found while building it: adding a field to the parsed rows leaked the field separator into section 2's output, because one read loop still named seven fields. A test now pins that no report line may contain it — the same class as the tab-collapse bugs this suite has caught twice.

## 2.2.0

### Minor Changes

- [#103](https://github.com/plot-pm/plot/pull/103) [`06cd57f`](https://github.com/plot-pm/plot/commit/06cd57f649884b9dc3adcd98dd5a247a95041463) Thanks [@jwloka](https://github.com/jwloka)! - The board serves `/api/fleet`: what agents are doing, and what they wait for.

  Branch state was only ever visible as terminal output — real, but gone the moment the scrollback rolled. The endpoint turns `plot-fleet-scan.sh --json` into rows grouped by **the reason each one is waiting**, because each group implies a different action: review it, nothing, nothing, go check whether it died, decide whether to start it. Sorted that way the list is workable top to bottom, and when only _working_ is populated you can walk away.

  **It never runs the scan.** Measured: 0.5–1.05 s per scan against a 4 s client poll, on a single-threaded server — that would block the event loop roughly a quarter of the time. The server refreshes a cache on its own timer using the async `execFile`, and every request reads the cache plus its age. Client poll rate and scan duration are decoupled, so twenty plans give you a _staler_ tab, not a _slower_ board.

  Two failure modes are handled as deliberate design rather than as edge cases. Until the first scan lands the endpoint reports `ready: false` — "not ready yet", never an empty fleet. And a failed refresh **never overwrites a good result**: the tab keeps the last pulse, its age, and the error. Replacing real state with emptiness because one scan failed is what makes a monitoring view untrustworthy.

  The `waiting-on-machine` group is defined but empty at this step — it needs PR data. It is still rendered, because an absent group reads as "nothing is waiting on CI", a claim this step cannot make.

  **Known limit, worth stating:** this is git-only, so unpushed local work is invisible. An agent editing files without pushing shows as `not-started`.

- [#102](https://github.com/plot-pm/plot/pull/102) [`b11ddbe`](https://github.com/plot-pm/plot/commit/b11ddbec1b9353c37b8c256e6261ed2f51e60a35) Thanks [@jwloka](https://github.com/jwloka)! - `plot-fleet-scan.sh --json` emits the pulse as one machine-readable object.

  The scan's prose is a **human** interface — mechanical enumeration a person reads, per Principle 3. That is precisely why it is not a contract: anything consuming lines like `  Tracer — eligible` breaks the day someone improves the wording. The board is about to consume exactly this data, so the scan gains a second rendering rather than a second reader.

  `--json` serialises the derivation the script already performs. Wave verdicts, per-branch state, claim notes and the summary counters come out as they exist internally: `open` · `wip` · `merged` · `claimed` · `deferred`, and `complete` · `eligible` · `blocked`. Deliberately **not** the prose labels — no consumer should parse `in progress`, a string that exists only to be read. Field names follow `plot-plan-meta.sh` (`branch`, and `""` rather than `null` for an absent claim), because two JSON conventions in one repo is worse than either.

  It is an output mode and nothing more: it composes with `--offline`, `--no-fetch` and `--loose` rather than implying any of them, so the data depends on what the caller asked for rather than how. `--next` still wins — a different question with a one-line answer.

  The test that matters here is not the one that parses the JSON. It is the one asserting the **human report stays byte-identical**: a machine mode is worth adding only if it leaves the thing people read untouched, and that is verifiable rather than assertable — the prose was diffed against its pre-change output, not merely against itself.

- [#104](https://github.com/plot-pm/plot/pull/104) [`12310cb`](https://github.com/plot-pm/plot/commit/12310cba677be3c8755a10af6058c5e4d2e6f747) Thanks [@jwloka](https://github.com/jwloka)! - The board has a second tab: **Agents** — what each branch is waiting for.

  Artifacts move in days, agents in minutes. Forcing both onto one surface answers each question halfway, so they become two tabs — which also lets them poll at different rates: the board every 30 s, the fleet every 4 s, and only while its tab is open. That poll is cheap because `/api/fleet` reads a server-refreshed cache rather than running a scan per request.

  Rows are grouped by **the reason each one waits**, because each group implies a different action: review it · nothing · nothing · go check whether it died · decide whether to start it · nothing at all. Sorted that way the list is workable top to bottom, and when only _working_ is populated you can walk away.

  Every group renders even when empty, `waiting on a machine` included — it needs PR data that does not exist yet, and an absent group would read as "nothing is waiting on CI", a claim this step cannot make. The footer carries the pulse age, so a stale view says so rather than looking live.

  Two things were wrong the moment the tab was first rendered, and neither would have failed a test that was not looking at a screen:

  - **Merged branches sat under _quiet_.** Technically right — no recent commit — and the wrong answer: "go check whether it died" is not a prompt for work that landed. Merged work now has its own **done** group, which asks nothing of you.
  - **A note read `no commit for 30300 min`.** Minutes are the right unit for the first hour and arithmetic the reader has to do after that. Ages now scale to hours and days.

- [#98](https://github.com/plot-pm/plot/pull/98) [`9d5521c`](https://github.com/plot-pm/plot/commit/9d5521c04dbf9c1ca1586051758ea65b000b1e96) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-implement` sets new implementation PRs to **Ready** on a project board.

  The board-sync plan promised a five-step mapping from Plot events to board columns. Four were built; the third — _new implementation PRs land in Ready_ — was not, so those PRs sat in whatever column GitHub assigned them until `/plot-deliver` moved them to Done. The middle of the lifecycle was invisible on the board, which is the part a board exists to show.

  It was missed for a structural reason worth recording. The plan was written for Plot 1, where `/plot-approve` created the implementation branches itself, so the mapping table put the Ready transition there. Plot 2 split that apart: approval only records the approval, and `/plot-implement` starts the work. The step did not go missing so much as its home moved out from under it — and nothing failed, because a board update that never happens looks exactly like a board nobody configured.

  The status is set at the one moment the PR both exists and has not been worked on: when the implementing session creates it. That is already the moment the brief asks for the `→ #<number>` annotation, so it is one more line of bookkeeping at a point the session is stopping anyway, rather than a new obligation somewhere else.

  <!--
  bumps:
    skills:
      plot-implement: minor
  -->

## 2.1.0

### Minor Changes

- [#83](https://github.com/plot-pm/plot/pull/83) [`37f06ea`](https://github.com/plot-pm/plot/commit/37f06ea6270a2cfaf39b38e0107b137d6b034c6b) Thanks [@jwloka](https://github.com/jwloka)! - Harden the fleet commands for first real use.

  Probing the new commands from outside this repo surfaced defects that only appear in a fresh project. All are fixed:

  **`/plot-dispatch` now gates on phase and ceremony, in the script.** It refuses a plan that is not Approved, and one whose `Impl:` answer is not `own branches`. Previously that check lived only in the skill's prose — a rule an agent can rationalise around and a human calling the script directly bypasses entirely. It **fails closed**: if the phase cannot be read, it refuses. That is the opposite of `plot-phase-gate.sh`, which is a PreToolUse hook and must fail open so a broken gate never locks a repo; here the user invoked the command, and starting several agents on unapproved work is the costly mistake.

  **Workers are inspectable.** `--status` lists every fleet worktree with its worker pid, whether that process is alive, and the last line of its log; `--stop <branch>` stops one. Both work regardless of plan phase — work already running must stay reachable. `--stop` requires an explicit branch name; there is deliberately no "stop everything".

  **Claims now age.** The reaper could tell a deliberately abandoned claim from a bare one, but not a worker that is thinking from one that died days ago. A claim older than `Claim stale after` (hours, default 24) is reported as stale with its age. Still no deletion command: staleness is evidence, not permission.

  `Claim stale after` is a new key rather than a reuse of `Sprint stall limit`, which counts iterations without a deliverable in a serial run — a different quantity. Reusing it would have silently read "3 iterations" as "3 hours".

  **`/plot-merge-queue` checks its git version.** `merge-tree --write-tree` needs git ≥ 2.38. Older git has a `merge-tree` with entirely different semantics that succeeds while answering a different question, so every branch would read as conflict-free. A false all-clear is worse than a refusal.

  **Two loops and an exit code fixed.** `--next` returned 0 in a repo with no plans, so the caller pattern the skill itself recommends would accept an empty branch name as valid work — in any repo on day one. And `plot-dispatch` spun forever when a worktree could not be created, because `--next` has no memory and kept offering the same unclaimable branch.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-fleet: patch
      plot-merge-queue: patch
      plot-reconcile: minor
  -->

- [#88](https://github.com/plot-pm/plot/pull/88) [`0810f02`](https://github.com/plot-pm/plot/commit/0810f02d8c06b1ce970a2471fe8b4be281ecd4d1) Thanks [@jwloka](https://github.com/jwloka)! - Fix everything a reality-check audit found — including one silent correctness bug.

  An adversarial audit ran every documented claim in throwaway repos instead of reading the code. It found that the fleet's central promise did not hold.

  **Claim-by-ref provided no mutual exclusion.** An empty claim branch points at `origin/main`, so a second dispatcher pushing the same branch pushed what was already there: "Everything up-to-date", exit 0. Both sides believed they owned it, and two real dispatchers each reported `dispatched=1` for the same branch. The `skipped (claimed by another session)` path was unreachable — dead code — and **no test exercised a contested claim**, which is how 135 green tests coexisted with the bug.

  Claims now carry an empty commit, so two independent claims diverge and the loser is rejected as non-fast-forward. Claim detection follows: a claim is a branch whose only commits beyond main are claim markers. The old shape (no commits of its own) is no longer treated as a claim — it is indistinguishable from merged work, and treating it as one hid real deletion candidates.

  **`--loose` was weaker than promised.** The plan promised "the prior wave's PRs are green and ready"; the code accepted any pushed commit, so red CI or a draft PR opened the next wave — building on a seam that was not merely unlanded but possibly broken. It now verifies PR readiness through the host adapter, and where readiness cannot be established it degrades to strict and says so. An unverifiable claim of readiness is not readiness.

  **The merge queue was wave-blind**, ordering purely by footprint, so a small wave-2 branch could be recommended ahead of a larger tracer — inverting the premise that an earlier wave proves the seam. Wave order now dominates size.

  **`declare -A` had crept in** with that fix, breaking the queue outright on stock macOS (bash 3.2). A new test now rejects bash-4-only constructs across every script — CI runs bash 5, so no fixture would have caught it.

  Also: the stall-threshold key named in the fleet skill was one no script reads; `plot-fleet-scan.sh`'s header claimed in caps that it never writes a repo file, in the `--log-pulse` mode its own skill mandates every run; `dry_seen` was unbound dead code; `--max` silently accepted non-numbers; `--help` printed a truncated range; and branches sharing a last path segment (`feature/api`, `bug/api`) collided on one worktree, so `--stop` could stop the wrong worker.

  Docs describing the claim mechanism (README, MANIFESTO, intro) are corrected to match.

- [#92](https://github.com/plot-pm/plot/pull/92) [`2171e31`](https://github.com/plot-pm/plot/commit/2171e31e46debccc7f928f44f246ff59fb79d810) Thanks [@jwloka](https://github.com/jwloka)! - Name the four phases, and state evidence over assertion as a principle.

  Plot's four phases have always been _states of a plan_ — Draft, Approved, Delivered, Released. Cutting across them are four _activities_, each turning one durable artifact into the next: Discovery makes a story, Design makes a plan, Development makes merged branches, Endgame makes a verified release. Everything needed for all four already existed; what was missing was the map. Discovery is the one that predates Plot's own states, and it is optional — small, well-understood work goes straight to Design.

  A fifth artifact runs alongside rather than between: the **session log**, recording how something was decided, including the alternatives that were rejected. The line against a plan is now written down: if it must be true _before_ building starts it belongs in the plan; if it answers "why not the other way?" it belongs in a log. Plot does not write session logs — session-scoped tools do that better, because they can reconstruct compacted history and classify session types. The new `plot-context.sh` supplies them the plot-shaped facts instead (governing plan, phase, wave, PRs), and `/plot-init` offers a `## Session Wrap Up` section wiring the two together.

  **Principle 12, "Evidence over assertion"**, states what Plot's gates already do: `/plot-deliver`'s landed check demands the scan's actual footer line rather than the word "verified", and sign-off stays human. The reasoning is specific to how agents fail — reading code and judging it uses the same mental model that wrote it, so only execution can contradict that model. Two consequences are spelled out: passing tests prove only what they test (a suite can be entirely green while the central mechanism is broken, if the untested case is the one the mechanism exists for), and verification wants a separate adversary, because checking your own work shares the blind spot that produced it.

  `/plot-deliver`'s completeness check now acts on that. Its subagents are asked to **refute** each deliverable rather than confirm it, and to report what they _executed_ versus what they only _read_ — a behaviour claim confirmed by reading a PR body is not confirmed. This is the check that catches a changelog entry written at planning time describing intent nobody built.

- [#75](https://github.com/plot-pm/plot/pull/75) [`b14113c`](https://github.com/plot-pm/plot/commit/b14113c745830bcb6a41324d916e07438ced4f20) Thanks [@jwloka](https://github.com/jwloka)! - Claim-by-ref: two sessions can no longer take the same implementation branch.

  `/plot-implement` now asks `plot-fleet-scan.sh --next` which branch to take instead of walking the plan's branch list in file order, and **claims it by pushing an empty ref before starting any work**. A ref push that would overwrite an existing branch is rejected, so a race has exactly one winner — git is the lock, and no lock manager exists or is needed. The loser asks again and takes the next free branch.

  Because `--next` only ever offers branches from an eligible wave, a session can never be handed work that builds on a seam an earlier wave has not yet proven.

  This replaces the old "create the first, list the rest — parallel sessions create theirs on pickup" instruction, which named parallelism without providing any way to coordinate it.

  Giving a branch up is annotate-and-leave: a worker that finds the work unnecessary or wrongly cut records `deferred:` / `split-from:` / `moved:` in the plan and leaves the ref alone. Cleanup belongs to `/plot-reconcile`, which needs that annotation to tell deliberate abandonment from a dead worker — both leave an identical empty branch.

  <!--
  bumps:
    skills:
      plot-implement: minor
      plot-fleet: patch
  -->

- [#76](https://github.com/plot-pm/plot/pull/76) [`1405267`](https://github.com/plot-pm/plot/commit/1405267ed73d1343864f9c0f0aaef5f56a2756ba) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-dispatch`: fan one approved plan out across several agents at once.

  One git worktree and one detached worker per eligible branch, each branch claimed atomically by a ref push. This is the point where Manifesto Principle 4 — "one plan, many branches; different people, different agents, different worktrees, all working on the same plan in parallel" — stops being a description and becomes a command.

  Workers are **detached**, so the fleet outlives the dispatching session: start a fan-out, close the laptop, work continues. The command that runs them is configuration (`Worker command` in Plot Config), because how to run an agent headless is a per-project answer Plot must not hardcode. Without that key, worktrees are prepared and claimed and you start them yourself.

  Fanning out is **human-paced**: `--dry-run` first, then a count, then `--max N`. Each worker costs tokens and produces a PR someone must review, so "all eligible" is never assumed.

  Everything the dispatcher writes is idempotent or refused — a claim that would overwrite an existing branch is rejected (that rejection is the lock), existing worktrees are adopted rather than duplicated, and nothing is ever deleted. A dispatcher that dies halfway through a fan-out is safe to re-run.

  `plot-fleet-scan.sh` gains `--list-eligible` for callers that need the whole claimable set rather than one branch.

  `ralph-plot-sprint`'s "finish before starting" rule is restated, not weakened: it governs one runner's own attention. Several runners may work several branches concurrently, provided wave eligibility allows it.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
      plot-fleet: patch
      ralph-plot-sprint: minor
  -->

- [#80](https://github.com/plot-pm/plot/pull/80) [`9a71dc5`](https://github.com/plot-pm/plot/commit/9a71dc5e8739c2d4969017fab44b320af733bda8) Thanks [@jwloka](https://github.com/jwloka)! - Close the three gaps between what the fleet plan promised and what it shipped.

  Delivery verification compared the plan's changelog against the actual diffs and found three entries the implementation had not backed. Rather than soften the changelog, the work was finished:

  **Wave eligibility is now genuinely configurable.** `--loose` lets a prior wave count as satisfied when its branches carry pushed work rather than merged work. Strict stays the default, because loose buys throughput and pays in rebase risk — the next wave builds on a seam that has not landed. Using it wants a stated reason; this is the one place where _less_ safety is what needs justifying.

  **The pulse can write a pulse line.** `--log-pulse` appends one line per plan to its `## Notes`, clean pulses included — without a record of quiet pulses an idle fleet and a dead fleet look identical. It stays a log rather than state: deleting the whole log changes no behaviour, because the next pulse re-derives everything from git. Without the flag the scan remains strictly read-only.

  **The board shows wave state.** Cards carry a `waveSummary` — waves, outstanding branches, claimed branches — rendered as a badge. It is a summary rather than the nested wave structure because a tile answers "how much is left, and is anyone on it?", not "which branch sits in which wave". Deferred branches are excluded from the outstanding count; counting them would make a finished plan look unfinished. Plans with one wave or none carry no badge, so pre-wave plans are untouched.

  <!--
  bumps:
    skills:
      plot-fleet: minor
  -->

- [#78](https://github.com/plot-pm/plot/pull/78) [`d3c8956`](https://github.com/plot-pm/plot/commit/d3c8956fca46e240c03292f411106ae45c5b1dfb) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-merge-queue`: a safe merge order, and which branches will collide.

  When several agents finish at once their PRs land in a burst, and **each merge invalidates the others' bases** — the second PR was green when it was opened and is broken by the time anyone reaches it. Serial work never hits this; a fleet hits it constantly.

  The queue answers, before any of that: in what order is it safe to merge, and what will break? Per branch it asks two questions, both computed with `git merge-tree --write-tree` (a merge computed entirely in memory — no working tree, no index, nothing touched):

  1. Does it merge cleanly into main right now?
  2. **Does it conflict with a branch ahead of it in the queue?** This is the burst case, and the one that is invisible without a queue: every branch can be independently green while being pairwise incompatible.

  Branches are ordered by footprint, fewest changed files first — the smallest clean branch merged early invalidates the fewest other bases.

  **It merges nothing.** That is the design: most of the value is in knowing the safe order, and knowing it requires no merge rights at all. Merge authority stays with the human until the ordering has proven itself.

  Predictions are exact for textual conflicts and say nothing about semantic ones — two branches can merge cleanly and still break the build together. CI remains the arbiter.

  Requires git ≥ 2.38.

  <!--
  bumps:
    skills:
      plot-merge-queue: minor
  -->

- [#77](https://github.com/plot-pm/plot/pull/77) [`ec86196`](https://github.com/plot-pm/plot/commit/ec8619673392a296e68af5b655983aa3551179fc) Thanks [@jwloka](https://github.com/jwloka)! - The reaper: `/plot-reconcile` now tells an abandoned claim from a dead worker.

  Claim-by-ref means a worker takes a branch by pushing an empty ref. Two very different situations then leave an **identical** artifact in git — the worker deliberately gave the branch up, or the worker died. Before this change both fell into the stale-branch sweep's "ahead of main → orphan" verdict, which was doubly wrong: an empty claim is not ahead of anything, and calling it an orphan hides that someone may still be working there.

  Empty claims are now classified before that verdict, using the plan annotation as the only available signal:

  - **`deferred:` / `moved:` present** → the branch was given up on purpose. Reported as a deletion candidate, with the command.
  - **a bare `claimed:`, or nothing** → the worker may be thinking, or may be dead. Reported as needing judgment, and **no deletion command is offered** — a slow worker looks exactly like a dead one, and deleting its branch destroys work in progress.

  Reading the annotation here is the one deliberate exception to "git is the truth, the annotation is only a reflection". It is safe because this gate decides _cleanup_, not _work_: a wrong annotation costs at most a missed cleanup, never lost or duplicated work.

  The summary footer gains a `claims=N` count. Consumers that parse it (`/plot`'s hygiene line, `/plot-deliver`'s landed gate, `/plot-reconcile`'s Automation Output) see the new field in the documented position.

  This closes the gap opened by Stage 3: detached workers die without telling anyone, so the reaper is load-bearing rather than a nicety.

  <!--
  bumps:
    skills:
      plot-reconcile: minor
      plot: patch
      plot-deliver: patch
  -->

- [#72](https://github.com/plot-pm/plot/pull/72) [`95b8576`](https://github.com/plot-pm/plot/commit/95b857607b8f9b92c07d36fc0092c5cae542e893) Thanks [@jwloka](https://github.com/jwloka)! - Branch waves and the fleet pulse — the first step toward running several agents on one plan.

  Plans can now group their implementation branches into **waves** using `### ` subheadings under `## Branches`. Branches in a wave may run concurrently; a wave becomes eligible once every non-deferred branch in every prior wave is merged. The existing `### Tracer` / `### Implementation` convention is exactly this, now given meaning: the tracer proves the seam before the rest fan out. A plan with no subheadings is one wave, so every existing plan behaves as before.

  The new `/plot-fleet` command reports that state — which waves are complete, eligible, or blocked, and which branches are claimed. It is read-only and stateless: every fact is re-derived from git refs on each run, so there is no fleet database to drift, and a dead worker or killed pulse costs nothing.

  `plot-plan-meta.sh` gains a `waves[]` field (with per-branch `deferred` and `claimed` state) alongside the unchanged flat `branches[]`, and now ignores a second `## Branches` heading appearing in prose — a plan that documents the plan format no longer poisons its own branch list.

  <!--
  bumps:
    skills:
      plot-fleet: minor
      plot: patch
  -->

- [#91](https://github.com/plot-pm/plot/pull/91) [`98d8ef5`](https://github.com/plot-pm/plot/commit/98d8ef579b8fde11c191e27a997895d58c1153c5) Thanks [@jwloka](https://github.com/jwloka)! - `/plot-init`: adopt Plot in a repository without writing the config by hand.

  Adopting Plot has meant reading `## Plot Config` documentation and composing the section yourself — or, in practice, pasting a long prompt that hardcoded one organisation's parameters and went stale with every release.

  `/plot-init` probes instead of interviewing. `plot-detect-repo.sh` reads what is already visible — git host from the remote, quality-gate scripts from `package.json`, a ticket scheme from commit subjects, the commit notation, which planning directories already exist, which hub doc is present — and the skill presents a complete proposal for the user to correct rather than compose. Exactly one thing is always asked: which of the candidate scripts actually gates a merge, because only a human knows that.

  Detection is deliberately conservative, since a guess dressed up as a fact costs more than a wrong proposal. A ticket prefix must **recur** before it counts (one stray `ONEOFF-1` is not a scheme), and only recognisable gate names are offered as Definition-of-Done candidates — a repo's `deploy` script is not a quality gate.

  Adoption is additive: nothing is moved, rewritten, or deleted. A repo with four overlapping planning systems keeps all four, and the skill offers to _describe_ the boundary rather than migrate anything.

  House rules are optional extensions, each gated on a detected signal — a Bitbucket repo is offered the `bb`-not-`gh` note, a GitHub repo never hears about it. And one blocked step never sinks the adoption: an unwritable `.claude/settings.json` costs slash-command convenience and nothing else, so the skill prints the block, asks, and continues.

  `docs/sprints/` and `docs/stories/` are **not** created by default, and posture keys appear only where the answer is not the default — a new adopter should not start with directories and settings nobody chose.

### Patch Changes

- [#89](https://github.com/plot-pm/plot/pull/89) [`94d5b95`](https://github.com/plot-pm/plot/commit/94d5b95cc38245d64d81f6083a08c61406297284) Thanks [@jwloka](https://github.com/jwloka)! - Claim detection no longer trusts a commit subject alone.

  A second audit — this time of the fixes themselves — found that classifying a claim by commit subject was unsafe. A human commit titled `plot: claim handling refactor`, carrying real files, counted as an empty claim; with a `deferred:` annotation on that branch, the reaper then offered to **delete a branch holding real, unmerged work**.

  A claim marker is now required to be both titled `plot: claim …` **and** empty (its tree equals its parent's). The impostor is correctly demoted to "orphan (needs judgment)" with an inspection command instead of a deletion command, while genuine claims are still detected. Both detectors — `plot-fleet-scan.sh` and `plot-reconcile-scan.sh` — share one rule.

  Two untested surfaces are now covered. `--loose`'s positive path was unreachable in tests because every invocation passed `--offline`, which disables the fetch and so made readiness unverifiable — only the degraded path was ever exercised. A stubbed host now covers ready, draft, and unavailable. And `--max` validation had no test at all: reverting the guard left the whole suite green.

  Four doc passages still described the superseded mechanism ("an empty branch with no commits of its own is a claim"). They now describe what the code does, and `plot-fleet/README.md` records why the empty-branch design failed — it is the kind of mistake worth leaving a marker for.

- [#93](https://github.com/plot-pm/plot/pull/93) [`7cf4360`](https://github.com/plot-pm/plot/commit/7cf436099a501665fc3e66ef5dc401792ebba936) Thanks [@jwloka](https://github.com/jwloka)! - Report ambiguity instead of guessing, and pin the resolution path that no test covered.

  A second adversarial audit — this time of the recent additions — found two things worth blocking a release for.

  **`plot-context.sh` picked a plan by filename order.** When two active plans listed the same branch, the lookup broke on the first glob hit, so the "governing plan" was whichever symlink sorted first alphabetically. Renaming a file changed the answer while nothing about the work changed, and nothing signalled that a choice had been made. The script's own header promises the opposite — "a durable decision record attributed to the wrong plan is worse than one with no attribution" — and a silent pick produces exactly that. It now reports `ambiguous: true` with the candidate list and leaves `plan_slug` empty.

  **The `idea/` fast path had no test.** Disabling it left every test green, yet it is the only route that resolves a plan sitting on its own idea branch before any Branches section names it — the primary path, invisible to CI. Now pinned, and verified by sabotage in both directions.

  Three smaller findings from the same audit: `plot-detect-repo.sh` matched hosts by substring, so `git.mybitbucket.internal.example.com` read as Bitbucket and a path segment could spoof GitHub entirely — the globs are now anchored to the host position. It also read only the root `package.json`, reporting "no quality gates" for a monorepo, which is the worst possible miss given that the Definition of Done is the one question `/plot-init` insists on; workspace packages are now read too. And the RC checklist cited the wrong test count.

- [#86](https://github.com/plot-pm/plot/pull/86) [`a29b06a`](https://github.com/plot-pm/plot/commit/a29b06a37f4fdd98ba0ecdeb910e117f9284328a) Thanks [@jwloka](https://github.com/jwloka)! - Document the fleet: motivation, a 101 walkthrough, and the design anchored in the manifesto.

  The commands shipped before the prose did. `intro-to-using-plot.md` had promised since long before any of this that "different people, different agents, different worktrees can all work on the same plan in parallel" — a description of something that did not exist yet. It now explains how.

  **Intro** gains _Working several branches at once_: what waves are and why the tracer goes first, why claiming is a `git push` and nothing more, what `/plot-dispatch` does with worktrees and detached workers, how to read the merge queue, and what to do when something goes quiet. Written for someone who knows Plot and is meeting the fleet for the first time.

  **README** gains a _Several agents, one plan_ section stating the case: two questions hand-coordination answers badly, answered without adding a database.

  **MANIFESTO** anchors the design decisions that until now lived only in a plan file and commit messages. Principle 4 gains waves and claim-by-ref as its mechanism — both derived from Principle 1 rather than added alongside it, which is why fleet state is derived and never stored. Pacing gains the sort that is not obvious: watching a fleet is automate-ASAP, fanning one out is human-paced because it commits scope, and merging stays human-paced _even once the order is computed_ — automating the ordering removes guesswork, automating the merge would remove the last review point in a workflow that just multiplied its throughput.

- [#84](https://github.com/plot-pm/plot/pull/84) [`565166a`](https://github.com/plot-pm/plot/commit/565166a5464e7ffc9c76a2172e10e73a1b137e11) Thanks [@jwloka](https://github.com/jwloka)! - End-to-end flow tests for the parallel fleet.

  The unit tests check each fleet script against a hand-built fixture. These five flows check that the scripts actually feed each other on real refs in sandbox repos: a wave-structured plan is read with its waves, `--next` names a branch from it, `plot-dispatch` claims that exact branch, the pulse then reports it as claimed, and the merge queue orders what comes out.

  The wave transition is the part no unit test can reach — "wave 1 merges, wave 2 becomes eligible" is a property of git state changing _between_ two runs of a stateless command, which only a flow test can stage. It was previously verified only by hand.

  Also covered: a second dispatcher cannot steal a claimed branch or duplicate its worktree; the phase gate refuses a Draft plan before anything is created (including when the script is called directly, which is how skill prose gets bypassed); and the merge queue reports a collision against the branch _ahead of it in the queue_ rather than against main, without advancing `origin/main`.

- [#87](https://github.com/plot-pm/plot/pull/87) [`914e12e`](https://github.com/plot-pm/plot/commit/914e12e5ce37357aa0d2aed5637f070cdd0bafa9) Thanks [@jwloka](https://github.com/jwloka)! - Sharpen the fleet's positioning, and make clean pulses the default.

  Re-checking the README against the two designs that shaped the fleet surfaced one real behavioural gap and two weak arguments.

  **Clean pulses are now the norm.** The Lloyd pattern names "silent agent death" as a failure it prevents by logging every heartbeat, including the quiet ones. Plot had the capability behind `--log-pulse` and defaulted it _off_, so an idle fleet and a dead fleet still looked identical. `/plot-fleet` now passes the flag on every run.

  The _script_ still defaults to writing nothing, and that tension is worth naming: `/plot-implement` and `/plot-dispatch` call it internally to ask what to work on, and claiming a branch must never amend a plan as a side effect. So the default lives in the human-facing command rather than the script — both invariants hold, and a test now pins the script's silence.

  **Two arguments were being undersold.** That every step is doable by hand — claiming is `git push`, isolating is `git worktree add` — is Plot's strongest distinction from tools that need an app or a database running, and it was only in the manifesto. And "no database" read as a missing feature rather than the point: an orchestrator needs one when its tickets have no home, whereas Plot's plans _are_ the work table and its branches _are_ the claims.

  **New: a short comparison section**, naming Scape and the Lloyd pattern, what was taken from each, and what was deliberately left out (autonomous merging, agent-to-agent messaging, a general automation layer). Being explicit about the boundary is more useful than implying Plot competes on scale — it competes on how many agents can safely work one reviewed plan.

- [#94](https://github.com/plot-pm/plot/pull/94) [`e4f6338`](https://github.com/plot-pm/plot/commit/e4f633876bc0696c413b52c7ff62baac42fd676f) Thanks [@jwloka](https://github.com/jwloka)! - `--status` tells a finished worker from a crashed one.

  Found by running a real worker for the first time. Every automated test uses `--no-start`, so nothing had ever exercised the path that starts a process — and a worker that completed its job was reported as **`dead`**, which reads as a crash. A user would see a healthy fleet and assume failure.

  `kill -0` can only separate running from not-running; whether a stopped worker succeeded or crashed is gone unless the exit code was recorded. The wrapper now records it, and `--status` reports four states instead of two: **running**, **finished**, **failed (exit N)**, and **ended (status unknown)** for workers started before this existed or killed outright. Unknown stays its own answer — guessing "finished" would be the same mistake in the other direction.

  Two traps surfaced while fixing it, both now pinned by a test that starts an actual process:

  - A `Worker command` ending in `exit 0` terminated the wrapper shell _before_ the exit code could be written. The command now runs in a subshell, so its `exit` confines itself.
  - `$?` inside a double-quoted `sh -c` string was substituted by the _outer_ shell before `sh` ever saw it. The wrapper is single-quoted and the exit-file path travels as an environment variable, so no quoting level can mangle it.

  Also: a pid of `0` read as running forever, because `kill -0 0` signals the caller's whole process group and succeeds.

## 2.0.0

### Major Changes

- [#61](https://github.com/plot-pm/plot/pull/61) [`3712eea`](https://github.com/plot-pm/plot/commit/3712eeae5c4cc831314cb23616394a950af63549) Thanks [@eins78](https://github.com/eins78)! - **Plot 2** — ceremony matched to the plan's weight.

  If plot ever opened a pull request in a repository that never wanted one, this is the release that stops it. Every plan now records two choices — who reviews it, and where the work happens — and plot defaults to the lightest path the repository allows.

  **Ceremony is a recorded choice, not a default.** `/plot-idea` asks two questions and writes the answers into the plan: `Review:` (a pull request, an in-session walkthrough, or an async ballot) and `Impl:` (own branches, the same branch, another repository, or nowhere). Repositories declare their bounds once in `## Plot Config` — `Plan PRs`, `Implementation home`, `Hosts plans`, `Tracker`, `Git host` — and `Plan PRs: never` and `Hosts plans: no` are enforced gates, not guidelines.

  **Approval is no longer a starting gun.** `/plot-approve` only records the approval through the declared channel. Implementation starts when the new `/plot-implement` says so: it checks the plan for staleness, sets up branches per the recorded answers, and writes a hand-off brief so the implementing agent never guesses. The board splits Approved into Ready vs In progress, and a PreToolUse phase gate blocks implementation commits on Draft plans — including the explicit `.plot/hold` review hold.

  **Bitbucket and split-home setups are first-class.** The Git-host adapter `plot-host.sh` (gh/bb) makes every spoke host-neutral, and `plot-impl-status.sh` follows cross-repository `owner/repo#N` references, the `Plan directory` key, and the remote default branch.

  **The companion skills grow a discipline layer.** story-tracking gains a triage front door: the ticket (or an existing story, or a plain plan) is the umbrella until knowledge genuinely overflows it — with named overflow signals, late promotion with guided backfill, and an ask-and-advise stance where the human always has the last word. Add mirror-resistance ("reference, never copy") and one-home-for-narrative rules, a richer status vocabulary, the new `plot-story-lint.sh` for story-estate drift, and `/plot-sprint` declining where an external tracker owns sprints. The "Plot in the Pipeline" doc draws the boundary between plot (plan mechanics) and the skills that write plan content or implement it.

  **Upgrading**: no action required — repositories without posture keys keep the classic behavior, and pre-2.0 plans (without `Review:`/`Impl:`) keep working. Declare `## Plot Config` posture keys when you want the gates. Update with `/plugin update plot`.

  **Validated before release**: a deterministic e2e harness (`pnpm test:e2e`, in CI) drives four full lifecycles in sandbox repositories, and promptfoo eval suites — run against the release candidate before merge — caught two skill-text defects that were fixed in this release.

  <!--
  bumps:
    skills:
      plot: major
      plot-idea: major
      plot-approve: major
      story-tracking: major
      plot-sprint: minor
      plot-deliver: minor
      plot-release: patch
      plot-reconcile: patch
  -->

## 1.8.1

### Patch Changes

- [#59](https://github.com/plot-pm/plot/pull/59) [`bfb66a7`](https://github.com/plot-pm/plot/commit/bfb66a7e14c0dc7b978c5aabe228e9c75b108a35) Thanks [@eins78](https://github.com/eins78)! - story-tracking, plot: two leftover `docs/stories/` hardcodes in instructions

  v1.8.0 made the story directory configurable, but two places still stated the
  old default as fact rather than offering it as a default:

  - `STORY-template.md` told the author to move an archived story to
    `docs/stories/archived/` — wrong in any repo that declares a different
    `Story directory`, which is now the whole point of the key.
  - The `plot` hub skill described stories as living at `docs/stories/{slug}/`.

  Both now name `<story directory>/` and point at the key. No behaviour change;
  the default itself is unchanged.

  <!--
  bumps:
    skills:
      plot: patch
      story-tracking: patch
  -->

## 1.8.0

### Minor Changes

- [#58](https://github.com/plot-pm/plot/pull/58) [`6c36ddf`](https://github.com/plot-pm/plot/commit/6c36ddfc0f6a30b177ef2299d425297f67b15924) Thanks [@eins78](https://github.com/eins78)! - story-tracking resolves its directory from `## Plot Config` instead of
  hardcoding `docs/stories/`, and supports one story home per sub-unit in
  aggregating repos. `Story directory` and `Story index` are now documented in
  Setup — `Story directory` was already read by the board but never listed, so a
  project that configured it got a board and a skill that disagreed about where
  stories live. Story creation names its intended home and confirms before
  creating; archiving derives the home from the story's own path so a sub-unit
  story archives beside itself. The paste-in CLAUDE.md snippet no longer emits a
  hardcoded path.

  <!--
  bumps:
    skills:
      story-tracking: minor
      plot: patch
  -->

- [#48](https://github.com/plot-pm/plot/pull/48) [`649cd17`](https://github.com/plot-pm/plot/commit/649cd17f794d2e1b0ac9baa2937f1b2c28e80f5f) Thanks [@jwloka](https://github.com/jwloka)! - Plan: harden Plot against documented Claude Opus 5 long-horizon failure modes. Bounds the `ralph-plot-sprint` loop (wall-clock budget, per-iteration deliverable checkpoint, ship-partial fallback, heartbeat), bounds `challenge-the-plan` (question budget, material-vs-marginal filter, falsifiable stopping rule), tightens `plot-deliver` gates so subagent claims must cite file-path evidence, states `plot-reconcile` read-only-ness as a design invariant, promotes tracer bullets to the default recommendation in `plot-approve`, adds Manifesto Principle 10 ("an agent that has gone quiet has failed, not finished"), and records model provenance for the skills. Adds three optional `## Plot Config` keys with documented defaults: `Sprint wall clock`, `Sprint stall limit`, `Challenge question budget`.

  <!--
  bumps:
    skills:
      plot: minor
  -->

## 1.7.1

### Patch Changes

- [#46](https://github.com/plot-pm/plot/pull/46) [`075ae62`](https://github.com/plot-pm/plot/commit/075ae62d5310e86695b6da0d1f2fb52230380713) Thanks [@eins78](https://github.com/eins78)! - `plot-config.sh` now falls back to `AGENTS.md` when the repo-root `CLAUDE.md` has no `## Plot Config` section. `CLAUDE.md` is still checked first for backwards compatibility; `AGENTS.md` is the fallback for repos that have migrated to a hub-and-spoke agent-rules layout. ([#45](https://github.com/plot-pm/plot/issues/45), thanks @damoeb)

## 1.7.0

### Minor Changes

- [#40](https://github.com/plot-pm/plot/pull/40) [`21070f0`](https://github.com/plot-pm/plot/commit/21070f054a038f063ec4ba3b1eda329699121271) Thanks [@eins78](https://github.com/eins78)! - Graduate the local Kanban board to a first-class Plot component. The board is now its own TypeScript package (`@plot-pm/board`, vite + react + shadcn + zod) built into a single self-contained artifact the plugin ships; `pnpm board` runs it with no install step. It reads plans through `plot-plan-meta.sh` (so front-matter plans render too), adds multi-select sprint **and** story filters, and its health is part of the Definition of Done, gated in CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

### Patch Changes

- [#40](https://github.com/plot-pm/plot/pull/40) [`5005532`](https://github.com/plot-pm/plot/commit/50055323aa811f784ddd847ac667c82790f5c456) Thanks [@eins78](https://github.com/eins78)! - Support a project-local plan-template override through the existing config
  mechanism: a `Plan template` key in `## Plot Config`. `/plot-idea` resolves the
  template with `plot-config.sh get "Plan template" skills/plot/templates/plan.md`
  — a project that declares `Plan template:` (a repo-root-relative path) uses its
  own template; otherwise the shipped template is used. Reuses `plot-config.sh`
  (plot's one adopter-config reader) rather than adding a bespoke resolver, so the
  shipped plan template stays generic and projects opt in explicitly.

  <!--
  bumps:
    skills:
      plot: patch
      plot-idea: minor
  -->

- [#40](https://github.com/plot-pm/plot/pull/40) [`8ecc02a`](https://github.com/plot-pm/plot/commit/8ecc02a570e7b42892e82be91a1f9f9da0654528) Thanks [@eins78](https://github.com/eins78)! - Fix `plot-config.sh` to tolerate real-world `## Plot Config` values written as
  backtick-quoted markdown with trailing prose (e.g. `` **Plan directory:** `docs/plans/` (note) ``),
  and multi-value lists whose items are backticked and annotated (e.g. branch
  prefixes) — without truncating the list to its first backtick span. Backticks
  and parenthetical prose are stripped from the extracted value.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#41](https://github.com/plot-pm/plot/pull/41) [`e5d8cf7`](https://github.com/plot-pm/plot/commit/e5d8cf754d816489b861c8fd3c6321aa08443d10) Thanks [@michaelaemisegger](https://github.com/michaelaemisegger)! - Rename the "Open Questions" section to "Open Points" across the planning workflow — the plan and story templates (`plan.md`, `STORY-template.md`, plus story-tracking's SKILL.md reference) and the challenge-the-plan skill, whose tracking section, phase name and container references now read "Open Points". "Open Points" reads as more decisive and action-oriented for an unresolved-items list. Individual deferred _questions_ keep their "question" wording — a deferred question is genuinely a question; it is just filed under the Open Points section.

  <!--
  bumps:
    skills:
      plot: patch
      story-tracking: patch
      challenge-the-plan: patch
  -->

## 1.6.0

### Minor Changes

- [#34](https://github.com/plot-pm/plot/pull/34) [`c138ee4`](https://github.com/plot-pm/plot/commit/c138ee4f3c67e25ba6cae05a86454ec1ce98f064) Thanks [@jwloka](https://github.com/jwloka)! - Add `/plot-reconcile` — a read-only plan/branch reconciliation sweep — plus the shared plan parser and Plot Config accessor it is built on.

  A new spoke command that surfaces drift that per-delivery attention misses and only becomes visible in aggregate: a plan's phase disagreeing with which index dir (`active/` vs `delivered/`) its symlink lives in; an `Approved` plan whose impl branch already merged; merged-but-undeleted branches; and malformed plans (missing phase, front-matter `status:`/`phase:` disagreement).

  - **plot-reconcile** (new skill, v1.0.0) — two-stage Scan→Act command. Stage 1 runs `plot-reconcile-scan.sh`, a deterministic five-section report where each finding carries its exact remediating command as copy-paste text. Stage 2 is the human's judgment on what to run. Read-only by construction — the only writes are `git fetch` and (when unset) the local `origin/HEAD` ref.
  - **plot** (dispatcher) — add `/plot-reconcile` to the spoke command list, plus two new shared helpers all tooling should build on: `plot-plan-meta.sh` (plan metadata as JSON — parses both the canonical `## Status` body format and YAML front matter; the plan-format contract, specified by example in `test/reconcile/`) and `plot-config.sh` (the `## Plot Config` reader).

  Forge-aware: open-PR enumeration binds to the forge of the `origin` remote — `gh` on GitHub, `bb` on Bitbucket — and degrades to git merge-state alone otherwise. The main branch is detected from `origin/HEAD` (override with `- **Main branch:** <name>` in `## Plot Config`); plan directory, indexes, and branch prefixes are read from `## Plot Config` too.

  Proven twice in a downstream monorepo (each run caught genuine drift a human then fixed) before being contributed upstream; contract-tested end-to-end in CI.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#35](https://github.com/plot-pm/plot/pull/35) [`ade7164`](https://github.com/plot-pm/plot/commit/ade7164f325023651a4d89c9c02e02046c97bbb0) Thanks [@eins78](https://github.com/eins78)! - Close the drift loop: `/plot` hygiene line + `/plot-deliver` verification gate.

  - **plot** (dispatcher) — step 1 now runs the reconcile scan and reads its one summary line; when findings exist, the Status Summary gains a single `⚠ N hygiene findings — run /plot-reconcile` line (nothing when clean). To make that ambient-cheap, `plot-plan-meta.sh` parses any number of plan files in one awk pass (measured: 3.4s → 0.6s on a 12-plan repo; the old per-file subprocess chain would have cost ~15s at 90 plans) and the scan parses each plan once, reusing the rows across sections.
  - **plot-reconcile** — the report now ends with a machine-countable summary footer (`summary: drift=… merged_not_delivered=… stale=… attention=… concurrent=… pr_source=… main=…`); the dispatcher hygiene line and the Automation Output read it instead of parsing section bodies.
  - **plot-deliver** — new step 7b: after the delivery push, re-run the reconcile scan and grep for the delivered plan's dated basename. A hit means the delivery half-landed (phase flipped but symlink not moved, or vice versa) — the finding and its fix surface immediately instead of weeks later. Supersedes the opt-in post-deliver nudge idea from [#33](https://github.com/plot-pm/plot/issues/33): a targeted post-condition needs no config key and no prompt.

  <!--
  bumps:
    skills:
      plot: minor
      plot-deliver: minor
      plot-reconcile: patch
  -->

### Patch Changes

- [#37](https://github.com/plot-pm/plot/pull/37) [`68ce035`](https://github.com/plot-pm/plot/commit/68ce035d7b67e8db6f4135552af88853f0786e7b) Thanks [@eins78](https://github.com/eins78)! - Follow-up fixes to the reconcile drift loop ([#34](https://github.com/plot-pm/plot/issues/34)/[#35](https://github.com/plot-pm/plot/issues/35)), from review of the combined set:

  - **plot-deliver** — step 7b recast from a rule into a real gate: progression is gated on the reconcile scan's actual output (the grep result / `summary:` footer), not a self-asserted "Verified" bullet (which was emittable without running the scan). Also `mkdir -p docs/plans/delivered` before the symlink move, so the first-ever delivery in a fresh adopter repo can't half-land.
  - **plot** — the reconcile scan now (1) fails loudly with a `command -v jq` guard instead of silently reporting `drift=0` when jq is absent; (2) routes terminal-state (`Superseded`/`Rejected`) symlinks to the `delivered/` terminal index instead of the wrong `active/` default, and flags a terminal plan still symlinked in `active/` as §1 drift; (3) gains `--no-pr`/`--offline` flags, and the `/plot` hygiene line uses `--offline` so it makes no forge network call (previously `--no-fetch` still ran `gh/bb pr list` on every `/plot`). `pr_source` reports `off` for the deliberate skip.
  - **docs** — `CLAUDE.md` Helper Scripts table lists `plot-plan-meta.sh`, `plot-config.sh`, and `plot-reconcile-scan.sh`.

  <!--
  bumps:
    skills:
      plot: patch
      plot-deliver: patch
      plot-reconcile: patch
  -->

## 1.5.0

### Minor Changes

- [#29](https://github.com/plot-pm/plot/pull/29) [`852d2fc`](https://github.com/plot-pm/plot/commit/852d2fcfe366a931b85bdfb53207700033eaa295) Thanks [@eins78](https://github.com/eins78)! - Address remaining points from plot-pm/plot#1:

  - **plot-approve** — set project-board status to "In Progress" (not "Ready") when the impl PR is created; approved work is actively being implemented. Add a "Finishing an impl branch" subsection so the agent knows to run `gh pr ready <number>` when work is done. Reviewers filter by PR state, not by chat messages.
  - **plot** (dispatcher) — replace the single >7-day "stale drafts" heuristic with two distinct signals: **Completed drafts** (draft PRs with real commits — suggest marking ready) and **Abandoned drafts** (>7 days idle — surface for cleanup).
  - **plot-release** — reframe as a participant in the project's release process, not the driver. Step 4 is now "Hand-off to Project Release Process" — version bump, tag, and push belong to the project's release tooling (changesets, CI, or manual), not to plot-release. Summary no longer frames release mechanics as "what remains" for plot to do.

  <!--
  bumps:
    skills:
      plot-approve: patch
      plot: patch
      plot-release: minor
  -->

## 1.4.0

### Minor Changes

- [#25](https://github.com/plot-pm/plot/pull/25) [`e0d5bcb`](https://github.com/plot-pm/plot/commit/e0d5bcb73fcb668799194c871e6f95bc0a7ab580) Thanks [@eins78](https://github.com/eins78)! - story-tracking: define how to archive a completed story. Adds an "Archiving a Story" section (set `status: done` + `archived:` date, `git mv` the folder into `docs/stories/archived/`, repoint inbound links, update the index) plus a matching `archived:` frontmatter field in the template. Previously the skill had no defined end-of-life step for a story. Ported from quatico-solutions/agent-skills#13, which was stranded by the skill's move to this repo.

  <!--
  bumps:
    skills:
      story-tracking: minor
  -->

## 1.3.0

### Minor Changes

- [#23](https://github.com/plot-pm/plot/pull/23) [`08999f8`](https://github.com/plot-pm/plot/commit/08999f81b484e52a0524059bad72002deb59f222) Thanks [@eins78](https://github.com/eins78)! - New skill: challenge-the-plan — deep plan interrogation via adaptive interviews, adopted from quatico-solutions/agent-skills. The design-phase companion: idea → challenge → optional tracer → approve. Plot's companion pool now covers the full design loop (challenge-the-plan, tracer-bullets) plus long-running tracking (story-tracking).

  Also ships the `/challenge-the-plan` command (`commands/challenge-the-plan.md`) — the plugin's first command.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#22](https://github.com/plot-pm/plot/pull/22) [`dd3737a`](https://github.com/plot-pm/plot/commit/dd3737a8a370a61902eeb269f5092d53a45b5357) Thanks [@eins78](https://github.com/eins78)! - New skill: story-tracking — multi-session work tracking in markdown folders, adopted from quatico-solutions/agent-skills. Stories are the long-running umbrella (research, decisions, session narrative); plans remain the approved, actionable units — sibling concepts, now one plugin. Cross-plugin references softened (markdown/bye skills now optional mentions); provenance noted in the skill README.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0).

- [#20](https://github.com/plot-pm/plot/pull/20) [`aa22711`](https://github.com/plot-pm/plot/commit/aa22711ebf167b0237b7c77deb55d5c8df1f1529) Thanks [@eins78](https://github.com/eins78)! - New skill: tracer-bullets — thin vertical slice strategy, adopted from eins78/agent-skills. It returns home: the skill was designed in the Plot workflow family (part of the pre-split 1.0.0 lineage) and `/plot-approve`, the plan template, and the quickstart already reference it as a sibling. Those references now resolve in-repo. Repo-level docs (README, CLAUDE.md, plot SKILL.md sibling section) updated to reflect bundling.

  No `bumps:` block — the skill is new to this repo and ships at its authored version (1.0.0-beta.1).

### Patch Changes

- [#21](https://github.com/plot-pm/plot/pull/21) [`f33b1ef`](https://github.com/plot-pm/plot/commit/f33b1ef3f8685d029cda4858c33917c75ed182ba) Thanks [@eins78](https://github.com/eins78)! - Repo moved to the plot-pm org: github.com/plot-pm/plot (old eins78/plot URLs redirect). All live references updated — README install instructions, CLAUDE.md, package.json, plugin manifest, changeset changelog config, and `metadata.repo` in every SKILL.md. CHANGELOG and sessionlogs left as historical record.

  <!--
  bumps:
    skills:
      plot: patch
      plot-idea: patch
      plot-approve: patch
      plot-deliver: patch
      plot-reject: patch
      plot-release: patch
      plot-sprint: patch
      ralph-plot-sprint: patch
  -->

## 1.2.0

### Minor Changes

- [#18](https://github.com/eins78/plot/pull/18) [`adc77c7`](https://github.com/eins78/plot/commit/adc77c782ab238822513bb5def9c3d3c0cb48c59) - Add local Kanban status board (`pnpm board`) to the plot skill

  <!--
  bumps:
    skills:
      plot: minor
  -->

## 1.0.1

### Patch Changes

- [#15](https://github.com/eins78/plot/pull/15) [`66c6d6c`](https://github.com/eins78/plot/commit/66c6d6ca6555c80c8114345a8581fb1dee689aca) - Add a narrative tutorial for new users, and clarify how Plot relates to GitHub Issues.

  `skills/plot/intro-to-using-plot.md` is a new second-person walkthrough of the lifecycle (Draft → Approved → Delivered → Released), modeled on [changesets' `intro-to-using-changesets.md`](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md). It closes the gap between the high-level `README.md` and the AI-facing reference manual in `SKILL.md`. Linked from both.

  The MANIFESTO's "Not an issue tracker" bullet is reframed to match. Previously it said GitHub Issues "overlap and conflict" with Plot. The updated wording keeps the strong stance that Plot replaces issue trackers for _planned implementation work_, while acknowledging that issues remain useful **upstream** of the workflow — as the inbox for external feedback (bug reports, user-submitted feature requests, high-level user stories or business goals) that may eventually become plans. The boundary: issues are signals; plans are commitments.

  <!--
  bumps:
    skills:
      plot: patch
  -->

## 1.0.0

### Minor Changes

- [#9](https://github.com/eins78/plot/pull/9) [`230a981`](https://github.com/eins78/plot/commit/230a98185ac5c7d0d70ee2acb9f4ea5b2d7a9ccb) - `plot-sprint`: detect false-positive completions at close. Step 2 of `/plot-sprint <slug> close` now verifies, for each `[x] [slug]` item, that the referenced plan lives in `docs/plans/delivered/` (not `active/`). If any are still in `active/` or missing, close is blocked until resolved via `/plot-deliver`, unchecking the box, or an explicit override that logs a one-liner reason in `## Notes > ### Scope Changes`. The same flag also surfaces in `/plot-sprint status` so the discrepancy is visible during routine checks. Adds a `## Common Mistakes` section. Closes the gap surfaced in [issue #2 / observation 5](https://github.com/eins78/plot/issues/2#issuecomment-4057881195).

- [#11](https://github.com/eins78/plot/pull/11) [`2da3da9`](https://github.com/eins78/plot/commit/2da3da9fde1ba95e130c49359ea54c08514ce851) - `plot-sprint`: optional PR-aware lifecycle for sprint planning.

  After the initial skeleton lands on main (unchanged), Planning-phase refinement may now optionally happen on a `sprint/<slug>` branch with a draft PR. Use a PR when multiple stakeholders need to review scope, when readiness/deferral decisions deserve their own commits, or when scope conversations benefit from inline comments.

  `/plot-sprint <slug> commit` is now PR-aware:

  - If a `sprint/<slug>` PR exists and isn't merged: bump phase to Committed on the PR branch, push, mark ready, and merge with `--merge` (planning history preserved).
  - Otherwise: direct main commit, unchanged from before.

  Default merge strategy is `--merge` (mirrors `plot-approve` for plan PRs). Squash is explicitly forbidden by default — it collapses readiness/defer/date commits into one and erases reasoning. Adds an entry in the new `## Common Mistakes` section.

  Frontmatter `compatibility:` line and intro paragraph updated to reflect the optional PR path. Closes [issue #2](https://github.com/eins78/plot/issues/2) observations 2, 3, 5, and 6 — the "Theme A: Sprint PR lifecycle" bundle from the plot-skills-improvement plan.

### Patch Changes

- [#10](https://github.com/eins78/plot/pull/10) [`c4a9b6c`](https://github.com/eins78/plot/commit/c4a9b6c47bcee44ae5d66ed28a38a5b8cdf74f71) - `plot-sprint`: make the phase-transition rule explicit, and document multiline create input.

  Renames `## Guardrail` → `## Guardrails` and adds a `### Phase Transitions` sub-section stating that the `Phase` field is updated only by named subcommands (`commit`, `start`, `close`). All other actions — opening a PR, refining items, fixing typos — leave the phase unchanged. Closes the gap behind [issue #2 / observation 1](https://github.com/eins78/plot/issues/2) where "start a PR for the sprint" was misread as `/plot-sprint <slug> start`.

  Also adds a one-paragraph note on multiline `$ARGUMENTS` to the Create step 1 (Parse Input): subsequent lines after the first become the body of `## Sprint Goal`, not the one-line headline. Closes [issue #2 / observation 4](https://github.com/eins78/plot/issues/2).

- [#13](https://github.com/eins78/plot/pull/13) [`93152ad`](https://github.com/eins78/plot/commit/93152adaf631fdc00b20d4765136ac8b987baefc) - Release pipeline cleanups:

  - **CHANGELOG.md**: rename `## 1.0.0` heading to `## 1.0.0 — Initial release (pre-changeset history)` to prevent a duplicate heading when changesets generates the real `## 1.0.0` stable-release entry in the future.
  - **ralph-plot-sprint version drift**: bump `skills/ralph-plot-sprint/SKILL.md` from `1.0.0-beta.2` → `1.0.0-beta.3` to align with the rest of the skill versions (pre-existing drift; no content change).
  - **RELEASING.md**: create release guide with a `## Downstream: plot-marketplace` section documenting the manual post-release step and open questions for the maintainer.

## 1.0.0 — Initial release (pre-changeset history)

### Features

- Add Plot skill: git-native planning workflow with hub-and-spoke architecture
- Add `plot-idea`: create plan branches with plan files and draft PRs
- Add `plot-approve`: merge approved plans and fan out implementation branches
- Add `plot-deliver`: verify implementation PRs and deliver plans
- Add `plot-release`: cut versioned releases with changelogs
- Add `plot-sprint`: time-boxed sprint management with MoSCoW prioritization
- Add `ralph-plot-sprint`: automated sprint runner with shell loop wrapper
- Add `tracer-bullets`: standalone thin-vertical-slice skill with plot integration
- Add MANIFESTO.md: founding principles and design boundaries
- Add helper scripts (`plot-pr-state.sh`, `plot-impl-status.sh`, `plot-review-status.sh`) for structured JSON output
- Add model tier guidance (Haiku/Sonnet/Opus) to all skills and scripts
- Add batch mode, automation output mode, and sprint item annotations
- Add quickstart guide and troubleshooting section
- Externalize plan, sprint, and retrospective templates
- Add review tracking with SHA comparison
- Add self-improvement rules to technical skills

### Bug Fixes

- Fix phase mismatch in `plot-approve` — update phase to Approved on main
- Fix `ralph-sprint` worktree staleness and RC re-tag detection
- Fix CSO violation handling and AUTOMERGE=false stall case in `ralph-plot-sprint`

### Refactoring

- Split plot skills into standalone repo from eins78/skills
- Rewrite CLAUDE.md as Plot-specific contributor guide
- Standardize tooling discovery format, third-person voice, and sync comments

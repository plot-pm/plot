# @plot-pm/board

## 0.5.2

### Patch Changes

- [#234](https://github.com/plot-pm/plot/pull/234) [`a06f0d2`](https://github.com/plot-pm/plot/commit/a06f0d26b55ba8a37b23454f499b448e3a388875) Thanks [@jwloka](https://github.com/jwloka)! - board: a deferred row answers to the phase too

  Wave 2 of the same rule, and it exists because the rule had two doors and [#231](https://github.com/plot-pm/plot/issues/231)
  put a guard on one of them.

  Measured on the live board 2026-08-18, minutes after [#231](https://github.com/plot-pm/plot/issues/231) merged:

  ```
  NOT STARTED: 20 rows — 17 open, 3 deferred
    feature/the-pulse-repairs-the-artifact   plan phase: NONE
    feature/a-repaired-row-says-so           plan phase: approved
    feature/plot-sprint-support              plan phase: RELEASED
  ```

  The `open` rows moved as designed — `a-squashed-branch`, `bb-state-vocabulary`
  and `the-gate-reads-what-was-shared`, all Released, left the section. The
  `deferred` rows did not.

  `classify` answers a deferred branch in an arm **above** the one the phase check
  sits in, so those rows reached NOT STARTED by a route that never met the guard.
  Two doors into one room, and a rule guarding one of them is not the rule.

  `feature/plot-sprint-support` is the case in full: annotated `deferred` because
  the branch was **never created** — February's work landed directly on main — and
  its plan has read `Released` since v1.0.0-beta.3, four months ago. The board
  offered it as available work throughout.

  **The phase now answers first for every row in the section, whatever route
  brought it there.**

  ## The narrowing is exactly the terminal phases

  The deferred arm is not removed, and its `'you'` answer is not replaced — it is
  **bounded**:

  | Plan phase   | A deferred branch of it         | Why                                                                                 |
  | ------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
  | Draft        | NOT STARTED, waiting on **you** | not finished — a shelved branch of a plan under review waits on a person twice over |
  | **Approved** | **NOT STARTED, waiting on you** | **unchanged** — somebody shelved it, somebody may un-shelve it                      |
  | Delivered    | DONE                            | the work is done; nothing on the shelf waits for anyone                             |
  | Released     | DONE                            | the plan shipped, and the shelf is part of its history                              |

  `deferred` keeps its meaning _within_ a plan that can still move. It stops being
  a waiting state once the plan is finished.

  The check sits **above** the arm's three exits — a PR, a commit age, no commits
  — rather than beside one of them. Those distinctions refine what a live plan's
  shelf says, and a finished plan has nothing for them to refine.

  An unrecognised phase is placed with its name said aloud, as in the `open` arm
  and by the same allowlist argument. `''` falls through untouched:
  `feature/the-pulse-repairs-the-artifact` rendered `plan phase: NONE` in the same
  measurement, its plan unresolvable from the branch name — and filing that under
  DONE would be the same guess in the opposite direction.

  `waitingOnFor` is unchanged. Its comment said the deferred row was _the one row
  here that a phase check does not account for_; that was true, and was the
  defect. The line is now correct because the route is guarded rather than in
  spite of it, and the function still derives its answer from the group rather
  than repeating the phase test — a second copy of the rule there is the drift its
  shape exists to prevent.

  `FINISHED_PLAN_NOTE` covers both routes with one sentence. A finished plan's
  branch reaches the section as `open` when git has no ref for it and as
  `deferred` when the plan shelved it; the reason is identical either way — the
  work landed elsewhere, so no branch was needed.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content. The `/api/fleet` payload is
  unchanged — this decides differently with data the pulse already carried.

- [#231](https://github.com/plot-pm/plot/pull/231) [`c0ad490`](https://github.com/plot-pm/plot/commit/c0ad4903cc8d099867144bc071d5b74518233a60) Thanks [@jwloka](https://github.com/jwloka)! - board: the plan's phase answers first, in NOT STARTED and in WORKING

  The section groups by **branch state** and never asked the plan's **phase**. A
  branch with no ref reads as "never started" — which is true of a branch nobody
  created and equally true of one deleted at merge four months ago.

  Measured on this board 2026-08-18, ten plans in NOT STARTED:

  ```
  approved   3   ← the only ones /plot-dispatch will start
  draft      7   ← refused with "plan not approved yet"
  released   1   ← plot-sprint-support, shipped in v1.0.0-beta.3
  ```

  Measured again after a plan-hygiene sweep set 39 delivered plans to `Released`
  — **20 rows, ten of them Released**, each offering a merged branch:

  ```
  Released  a-squashed-branch-is-…  bug/a-squashed-branch   eligible — nobody has taken it
  Released  bb-state-vocabulary     bug/bb-state-vocabulary eligible — nobody has taken it
  Released  the-gate-reads-what-w…  bug/the-gate-reads…     eligible — nobody has taken it
  ```

  All three shipped in v2.5.1 the same day. **The board was advertising released
  work as available**, and the sweep did not cause that — it multiplied a defect
  that had been hiding behind a single row.

  The section is now filtered on the plan's phase FIRST:

  | Phase        | May an agent take it?  | Section         |
  | ------------ | ---------------------- | --------------- |
  | Draft        | no — waits on approval | WAITING ON YOU  |
  | **Approved** | **yes**                | **NOT STARTED** |
  | Delivered    | no — work is done      | DONE            |
  | Released     | no — shipped           | DONE            |

  **This is not a rule layered on top of the phase model — it is the phase
  model.** `Approved` is precisely the phase meaning _decided, not yet done_, and
  the only one in which `/plot-dispatch` hands a branch to an agent. Stated as one
  inclusion rather than three exclusions because that is what it is.

  A `Draft` plan moves to WAITING ON YOU and **names what it waits on** —
  approval — rather than offering a branch nobody may claim. A `Delivered` or
  `Released` plan lands in DONE, with a note accounting for the missing ref:
  `plot-sprint-support` has no branch because the change went straight onto main.

  **The phase is read from the plan, never inferred from the branches.** Inferring
  is the defect: a Released plan whose branch has no ref is bit-identical in git
  to an Approved plan nobody has started, and only the plan says which it is.

  **Within `Approved`, nothing changed.** Branch state is still what refines the
  answer there, and an Approved plan with unclaimed branches renders exactly as
  before — the phase is the first question, not a replacement for the second.

  ## WORKING had the same gap, mirrored

  Measured minutes after the case above:

  ```
  WORKING (2)
    Released  not-yet-asked-is-not-not…  bug/a-refresh-that-nev…  uncommitted work in a local worktree
    Released  one-place-for-what-a-ro…   bug/a-rows-actions-live-in-its-menu  uncommitted work in a local worktree
  ```

  Both PRs ([#220](https://github.com/plot-pm/plot/issues/220), [#224](https://github.com/plot-pm/plot/issues/224)) merged and shipped in v2.5.2. **Both workers were dead.**
  What the board read as _someone is working here_ was leftover scratch files —
  `agentlist_temp.tsx`, `.fleet_part1.js` — that the workers wrote after pushing
  and never cleaned up.

  So the rule is not "the phase decides NOT STARTED". The phase answers **first in
  every section**, and the local facts refine within it. Each section asks _what
  would move this forward_, and for a finished plan the answer is _nothing_ — it
  is done. **Local debris is not work.**

  ## The ordering, in two halves

  The split is by whether a phase can honestly say _nothing would move this
  forward_:

  - **Terminal phases (`delivered`, `released`) answer first**, above even the
    local-worktree check. Only _finished_ outranks the sight of somebody typing.
  - **`draft` and an unrecognised phase answer below it.** A plan under review
    whose branch is being edited right now has someone working on it — the review
    is what is outstanding, not the work — and a phase the board cannot read is
    not evidence of anything.
  - **Both sit above the wave verdict.** A wave's ordering is a question about an
    approved plan, and neither of these is one.
  - **Only `open` branches are affected.** A finished plan whose branch carries
    commits, a claim or a PR keeps its git answer — drift between a plan's records
    and its git state is worth seeing rather than smoothing over, the same rule
    `rowPhase` already follows.

  **An allowlist, not a blocklist**, matching `prAsksNobody` in the same file and
  for its reason: a blocklist of finished phases would silently start claiming _an
  agent may take this_ the first time a phase is added. An unrecognised phase
  lands in DONE and names itself, so the plan file is where the reader is sent.

  **A pulse reporting no phase is unchanged.** Absent is not a guess — a scan
  predating the field says nothing about the plan, and reading that as unstartable
  would empty the section wholesale against an older scan.

  Derived, never stored: a plan that becomes Approved changes section on the next
  pulse with nothing to clear and no restart, which is asserted by scanning one
  fixture twice.

  `waitingOnFor`'s draft arm is **deleted** rather than left unreachable. It
  answered `you` for a Draft plan's first wave because those rows used to sit in
  this section; they no longer arrive, so a dead arm there would be a second rule
  asserting they belong — exactly the drift that function's derive-from-the-group
  shape exists to prevent. The concern it answered is answered better by the move:
  a four-wave Draft plan no longer puts four loud rows on the board for one
  pending approval, because it puts none.

  The Start button needed no change, and that is the check that the split is in
  the right place: `isStartable` reads `waitingOn === 'click'`, which is null
  outside `not-started` by construction, so Draft and Released rows lose their
  button without a second rule anywhere.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content. The `/api/fleet` payload is
  unchanged — `phase` has travelled on the pulse since [#140](https://github.com/plot-pm/plot/issues/140), reported and unread;
  this decides with it. No skill documents which section a plan's rows land in.

## 0.5.1

### Patch Changes

- [#224](https://github.com/plot-pm/plot/pull/224) [`5bf408e`](https://github.com/plot-pm/plot/commit/5bf408e478d1bce283e20aaac4fbb21116e34fcf) Thanks [@jwloka](https://github.com/jwloka)! - board: every action a row offers lives in its menu

  Four actions, two homes, and no rule telling them apart. _Open failing run_
  and the conflict dispatch rendered inline in the row; _Start work_ and
  _Approve_ rendered in the `⋯` menu. The split followed the order the four
  were built in, and nothing else.

  Reported while a row showed a CI failure — _why is "Open failing run" not in
  the `⋯` menu?_ The honest answer was that nobody had decided.

  The rule now: **the row says what IS, the menu says what you can DO.** Both
  inline actions moved into the menu as items with their own conditions.
  Navigation to a thing the row NAMES — its plan, its branch, its PR — stays
  inline, because a `cmd`-click on a real link is worth more than a tidier
  line. _Open failing run_ names none of those; it addresses a run, which the
  row reports on rather than is.

  Two measured costs, both gone:

  **The run was reachable only while the row was red.** The link rendered on
  `stuck.state === 'ci-failing'`, so the route to a run existed exactly as long
  as the failure did, and a reader wanting the last run of a green branch had
  no control at all. Its condition is now _a run URL exists_. The label
  followed the condition — a green row offering _Open failing run_ would
  promise a failure that is not there, so the item reads **Open last run** and
  the row's own stuck cell keeps the word _failing_ for when it is true.

  **The menu opened on nothing.** It rendered on every row, dimmed, on a layout
  argument: rendering nothing would leave the right edge ragged and moving as
  the five-second pulse gave and took actions. A later wave answered that — the
  cell has a fixed `1.25rem` track, so the column holds still whether or not a
  button is in it. What remained was a control that lies, measured lying on two
  of six WAITING ON YOU rows. A row with no items now renders no button. **A
  refusal is not an absence**: a row whose act the server declines still shows
  its button and names the reason on it.

  **The stuck cue did not move.** It is state rather than an action — it points
  at something being wrong, and a signal reachable only by opening a menu is
  not a signal. It renders in the row beside the word and the evidence it
  describes.

  Found on the way, and fixed here because the move exposed it: the
  close-on-outside-click listener closed the menu on **capture**, while the
  container that was supposed to stop it did so on React's **bubble** phase. The
  close always won, so React 19 — which delegates to the root — unmounted the
  menu before any handler inside it ran. The run link's click followed its href
  and never fired `onTaken`, leaving the cue animating at an answered request.
  It now hit-tests the target against the menu's own box.

  The rule is a gate rather than a comment: a structural test scans every
  component reachable from the row body, skips the menu, and fails on any `<a>`
  or `<button>` that is not one of the row's three named-thing links. Verified
  by putting the removed link back and watching it fail.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content, and no skill documents what
  a row's `⋯` menu holds — so no skill's behaviour changed.

- [#219](https://github.com/plot-pm/plot/pull/219) [`a4ecf36`](https://github.com/plot-pm/plot/commit/a4ecf3632db03b9c40f7062a304eabcd742f481e) Thanks [@jwloka](https://github.com/jwloka)! - <!--
    bumps:
      skills:
        plot: minor
        plot-dispatch: minor
        plot-fleet: minor
    -->

  plot: `finished` is not a verdict

  Every worker exits 0 — the one that opened its PR and reported cleanly, the one
  that stopped rather than claim a test run it had not seen, and the one that
  stopped to ask which retry semantics were wanted. Measured across seven
  worktrees during a four-agent fleet run. All three read `finished`, whose
  documented move is _review it_, and two of the three needed an answer instead.

  The process reports how it TERMINATED, never whether the task is DONE. So a
  clean exit is now refined by the tree, which is where the difference lives:

  | Condition                    | State                                  |
  | ---------------------------- | -------------------------------------- |
  | process alive                | `running`                              |
  | an open or merged PR         | `finished` — the work reached review   |
  | a blocked marker in the tree | `waiting` — a person owes it an answer |
  | uncommitted or unpushed work | `stalled` — work on the floor, no PR   |
  | otherwise                    | `finished`                             |

  Added **once**, to `plot-worker-state.sh`, which is the whole reason wave 1
  merged the duplicate first. `failed`, `ended` and `none` are untouched: each
  already says something specific about the process, and none of them is the
  `finished`-means-everything blur this splits.

  `waiting` and `stalled` are as opposite as `failed` and `finished` — _answer it_
  sends a person to a question, _resume it_ sends a worker back to work. A marker
  therefore outranks work on the floor: a worker that stops to ask has almost
  always left its work uncommitted beside the question, and reporting that as
  stalled invites a restart into the same wait. Measured happening twice to one
  branch, the second restart re-running what the first had finished.

  **Plot now names the marker: `PLOT-BLOCKED:`.** `TODO(you)` emerged from workers
  and was documented nowhere, so it could drift into `TODO(human)` — which it
  already had, in the same session — or into `ASK:` or prose, and a marker the
  classifier cannot find is a `waiting` reported as `stalled`. Both emergent
  spellings stay recognised beside the defined one: they exist in trees right now,
  and dropping them would silently regress every worker already running. The
  defined marker is what Plot **asks** for; the emergent ones are what it still
  **accepts**.

  The marker is read from the TREE, never the log. The log records that a question
  _was asked_; only the tree records that it is still _unanswered_, and only the
  tree clears when someone writes the answer.

  **`stalled` carries what is on the floor** — the count and the file names, not
  just a number. The names make the row actionable without a second command,
  which is the point of reporting it at all.

  **The PR fact travels as an argument**, supplied by each caller. The scan caches
  one host reply per branch per run behind its `--offline` gate; `plot-dispatch
--status` asks per branch when a person types it. A lookup inside the classifier
  would fork a `gh` per branch on a scan the board polls every 5 s, or break
  `--offline`'s promise of no network. Unanswerable is never a yes — offline, no
  backend, or a host returning 503 falls through to the local signals and reads
  `stalled`: _go and look_, rather than _stop looking_.

  **Editor leftovers are not work** (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) —
  a guard restarted a branch over an orphaned `plot-dispatch.sh.tmp1` while its
  worker was making progress. Nor is Plot's own bookkeeping: `.plot-worker.pid`,
  `.plot-worker.exit` and `.plot-worker.log` are untracked files the fleet writes
  into the worktree, and counting them made every tidily-finished worker read
  `stalled`. The exclusion stays narrow otherwise — an uncommitted source file is
  exactly the case this detection exists for.

  Two silent failures were caught while building this, both in the reassuring
  direction and both invisible behind `2>/dev/null`. `git grep --no-index
--untracked` is a fatal error (the flags are mutually exclusive), and `git grep
-qIE <pattern> --untracked` parses `--untracked` as a revision — each exits 128
  having matched nothing, so every waiting worker would have read `stalled`. And
  an unpushed-count fallback against `origin/main` reported every clean branch
  `stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with an
  empty left side counts the whole history from the root. Only the branch's own
  `@{upstream}` answers that question; with no upstream it is unanswerable, and an
  unanswerable question licenses no verdict.

  The board reports both states in `waiting-on-you` with distinct notes — _waiting
  on an answer from you_ versus _stopped with work unfinished — resume it_.

  **Nothing is restarted.** The scan is read-only (Manifesto Principle 1); a
  `stalled` row names the branch and what is on the floor, and the decision to
  relaunch stays in `/plot-dispatch`. The reaper is untouched: it classifies
  _empty_ claims and answers a different question, and a stalled worker has work
  worth keeping.

  The prototype `.dev/scripts/fleet-pulse.sh` — corrected three times by watching
  it act — is deleted. Two things computing verdicts from one dataset is how they
  drift, which is the defect wave 1 removed.

- [#221](https://github.com/plot-pm/plot/pull/221) [`b54bcf3`](https://github.com/plot-pm/plot/commit/b54bcf3cea96c188745f533f0c3fdfd192834101) Thanks [@jwloka](https://github.com/jwloka)! - board: `none` is an observation, so it is only printed where one was made

  `WAITING ON A MACHINE — none` was printed in two opposite situations: after
  the host had answered and reported nothing pending, and before the host had
  been asked at all. They want opposite responses from the reader, and the
  reassuring one was the default.

  Measured 2026-08-18 from two screenshots of one board 22 seconds apart. At
  `PR data 22s ago` the section read `none` and no row carried a status. At
  `PR data 4s ago` the same board reported [#57](https://github.com/plot-pm/plot/issues/57) `conflicts`, [#196](https://github.com/plot-pm/plot/issues/196) `checks
failing` since the previous day, and [#203](https://github.com/plot-pm/plot/issues/203) `CI running`. Nothing changed on
  the host between them. **A branch whose CI had been red overnight presented
  as unremarkable**, and a branch the host reports as unmergeable presented the
  same way. The operator's reading was that the board had lost its state; it
  had not yet fetched it.

  This is the rule `2026-08-17-an-outage-is-not-an-answer` established — a
  failure to observe must not be reported as an observation — at the one
  boundary that plan did not cross. An outage at least produces an error to
  carry. A first fetch that has not happened produces nothing at all, which is
  how it survived a plan written to catch exactly this shape.

  The section now says which clock it was read from. Four states:

  | Situation                  | Shown as                   |
  | -------------------------- | -------------------------- |
  | fetched, something pending | the rows, as today         |
  | fetched, nothing pending   | `none` — unchanged         |
  | not fetched yet            | `not checked yet`          |
  | first fetch failed         | `could not reach the host` |

  **A failed call is its own state, not a fourth spelling of the third.** Both
  mean no host fact is on the board, so one label would have been defensible —
  but `not checked yet` clears itself within seconds and asks the reader for
  nothing, while an outage waits for somebody to read the error. Folding them
  together would re-file a standing fault as a passing one, which is the
  opposite of what `an-outage-is-not-an-answer` was for. The distinction costs
  nothing to compute: `refreshPrs` already leaves `prAt` untouched when the
  call throws, so a null age beside an error is a first fetch that FAILED
  rather than one not yet made — and the footer has read the pair that way all
  along.

  **Header and body, not one or the other.** The header's hint is what a reader
  sees while scanning, and QUIET and DONE prove a header can be the only part
  of a section on screen; the empty-grid cell is what they see after opening
  the section to look for rows. A single site would leave one of those two
  readings unlabelled.

  **A first-load state, not a staleness display.** Once the host has answered,
  every later answer is an answer no matter how old: ordinary ageing is what
  the footer already reports (`PR data 111s ago`), and re-labelling the section
  every 60 s would trade one misreading for a flicker. The age is tested
  against null and never against a threshold.

  The two clocks stay separate, which was the point. `hostAnswer` takes
  `Pick<Fleet, 'prAgeSeconds' | 'prError'>` rather than the whole fleet, so a
  later edit reaching for the git scan's `ageSeconds` is a compile error rather
  than a review comment — the window where rows are git-fresh and host-unfetched
  is not an edge case, it is most of every minute.

    <!--
    bumps:
      skills:
    -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` reads or documents what the Agents tab prints in an empty section,
  and the `/api/fleet` payload is unchanged — every field this distinction is
  drawn from (`prAgeSeconds`, `prError`) was already in the contract and already
  in the footer. Only the rendering conflated them.

- [#222](https://github.com/plot-pm/plot/pull/222) [`8d96491`](https://github.com/plot-pm/plot/commit/8d964916c8d06915c7df0e17bc73f316e4ee10b2) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: the scan prunes what it fetches, so a stale ref stops outranking the host

  A branch squash-merged and deleted at merge reported `in progress` for as
  long as one local ref nobody pruned still pointed at it. Measured
  2026-08-18, minutes after PR [#218](https://github.com/plot-pm/plot/issues/218) merged: the host answered `MERGED`, the
  remote had no such branch, no worktree and no claim remained — and
  `--list-eligible` returned nothing, so wave 2 could not be dispatched at
  all. `git fetch --prune` by hand cleared it and the wave opened
  immediately.

  `git fetch` does not remove remote-tracking refs for branches deleted
  upstream; only `--prune` does, and the scan's fetch did not pass it. So
  every branch merged with `--delete-branch` left one behind on every machine
  that had fetched it, surviving until an operator pruned for unrelated
  reasons — which is what made this look intermittent.

  **The stale ref did not add noise; it disabled the check that would have
  been right.** `branch_state()` picks its arm on the ref's PRESENCE: with
  the ref there the scan takes the ancestry path, which a squash merge breaks
  by construction (the squash commit does not contain the branch tip), so the
  branch fell to `wip` — and the host lookup that would have answered
  `merged` lives in the other arm and was never reached. Under a merge commit
  the ancestry test is true anyway, which is why only squash merges expose
  it; this repo squash-merges by default.

  The fetch at the top of the scan now prunes, on the connection it already
  opens. No new host call and no new logic: the stale ref never exists, the
  no-ref arm is entered, and the host lookup added in [#216](https://github.com/plot-pm/plot/issues/216) answers.

  **The merge lookup did not move.** It is safe only by placement — a branch
  someone _recreated_ has a ref and takes the ancestry path deliberately, so
  hoisting the lookup would report in-flight work as `merged` and open the
  next wave onto work still being done. Pruning is safe precisely because it
  reorders nothing: it makes the local view match the remote, and the
  existing arms then apply as designed.

  One detail is load-bearing and easy to get wrong. **The explicit refspec is
  required.** `git fetch --prune origin <main>` prunes _nothing_ outside
  `<main>`: naming a refspec scopes the prune to that refspec's destination
  namespace. The obvious fix — a bare `--prune` on the narrow fetch the scan
  already made — is therefore a no-op for exactly the branches it exists to
  clear, and it looks correct. Restating the default heads refspec alongside
  `<main>` widens the prune back to the whole mirror, still in one connection.
  A test pins this against git directly, so the refspec is not later read as
  redundant and removed.

  Nothing depended on a stale ref surviving. `local_ahead_of()` reads
  `refs/remotes/origin/<br>..refs/heads/<br>`, and already answers 0 on a
  missing ref by exit code rather than by emptiness — the same answer it
  gives for every branch living on another machine, so the count degrades to
  absent rather than to a wrong number. `local_dirty`, `local_locked` and
  `local_worktree` read the worktree rather than the mirror, so uncommitted
  work stays visible; conflict prediction is gated to `wip|claimed`, which a
  pruned branch is not; and `--prune` removes only remote-tracking refs, so
  no local branch or work is touched.

  `--offline` is decided and stated rather than left to be discovered: it
  skips the fetch, so it cannot prune, and a surviving ref may keep a merged
  branch reading `wip` and hold its wave blocked. That is the honest answer
  for a scan that asked nothing — but the symptom looks nothing like "you
  passed `--offline`", so the footer now says so, and a failed fetch says
  that it failed to prune too.

  <!--
  bumps:
    skills:
      plot-fleet: patch
  -->

## 0.5.0

### Minor Changes

- [#212](https://github.com/plot-pm/plot/pull/212) [`97e6eaa`](https://github.com/plot-pm/plot/commit/97e6eaae0f494af77f96023afcd520ac0c625f64) Thanks [@jwloka](https://github.com/jwloka)! - plot-board: `/api/fleet` names the ref it read

  The read path renders staleness honestly for an eye — "scanned 10s ago" — and
  said nothing equivalent to a machine. The gap has a measured cost. During a live
  two-agent dispatch on 2026-08-18 an operator read current-looking data while
  their local `origin/main` was behind other agents' pushes. Three wrong diagnoses
  followed, including "the fleet endpoint is broken" and "the scan exceeds the
  board's timeout" — neither true. The board was right every time; it simply could
  not say WHICH WORLD it was right about.

  The response now carries three fields:

  - `readRef` — the commit the scan actually read
  - `readRefAge` — how old that read is, in seconds
  - `localHead` — the local checkout, which may differ, and when it differs that
    difference is the whole answer

  **The fallback runs in one direction, and the asymmetry is the design.**
  `plot-fleet-scan.sh` emits only `head` today; a sibling branch adds `read_ref`
  and `local_head` while keeping `head` as an alias for one release. Both shapes
  are tolerated, because the two branches were deliberately made independent — but
  `head` is `git rev-parse --short HEAD`, the local checkout under a name that
  implies more. It is a sound fallback for `localHead`, which is the same fact,
  and an unsound one for `readRef`, which is a different commit whenever the
  operator is not standing on a freshly fetched main.

  So a scan that emits only `head` yields `readRef: null`. Filling it in would
  manufacture the precise false statement the field exists to end — a report
  signed with the name of a commit it never read — silently, on every consumer.
  Null says "the scan did not tell me", and a consumer can act on that. The
  string `unknown` is passed through distinctly: the scan looked and could not
  resolve the ref, which is a different fact from a scan that predates the field.
  Neither reads as a confident claim.

  `readRefAge` is null rather than 0 before any scan lands, following the absent
  value convention `prNextInSeconds` and `mergeable` already set in this file: one
  absent-value shape per field, and an absent value never reads as a confident
  claim. 0 would assert a read that just happened.

  The fallback path is exercised by a test that plants a pulse of each shape
  against a scan that cannot succeed, so what comes back is attributable to the
  fixture rather than to whatever the script happens to emit today.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. `plot-fleet-scan.sh`
  is deliberately untouched — it belongs to the sibling branch
  `bug/pulse-names-the-ref-it-read` and two more queued behind it — and no skill
  documents the HTTP API, so no skill's behaviour changed.

### Patch Changes

- [#206](https://github.com/plot-pm/plot/pull/206) [`ca45361`](https://github.com/plot-pm/plot/commit/ca45361522f6b41eb034ac4655d11ff18bbf39c3) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: a running check reports pending, not green

  WAITING ON A MACHINE was empty every time it was looked at, and the
  reason was a mistranslation pointing the reassuring way.

  GitHub sends `conclusion: ""` for a check still running — an EMPTY
  STRING, not null — and the reader was `(.conclusion // .state)`. jq's
  `//` substitutes only null and false, so `$c` stayed `""`, matched none
  of the three tests, and fell through to `green`. **A running CI read as
  a passed CI**, permanently rather than occasionally.

  Measured on the release PR while its `validate` job was in progress: the
  adapter said `green`, GitHub's own rollup said `IN_PROGRESS`.

  The field is `status` besides; `state` never existed on a rollup entry,
  so the fallback pointed nowhere even when it fired. Both are corrected at
  all three sites that read the rollup, and the conclusion still wins
  wherever it says anything — a fix that simply preferred `.status` would
  report every finished check by its lifecycle word (`COMPLETED`) and turn
  failures green.

- [#211](https://github.com/plot-pm/plot/pull/211) [`f5560c3`](https://github.com/plot-pm/plot/commit/f5560c389efa20ae4752e56ba893edef0161a9f9) Thanks [@jwloka](https://github.com/jwloka)! - board: a successful scan that describes less says so

  Rows vanished from the Agents tab and returned seconds later — including
  WORKING rows for agents that were demonstrably running — with no error and
  no staleness marker.

  The cache already refuses to let a FAILED refresh overwrite a good result,
  and the comment says why: replacing real state with emptiness because one
  scan failed is what makes a monitoring view untrustworthy. That rule
  carried an unstated assumption underneath it — _any success is
  authoritative_ — and it is false. A scan can exit 0, emit schema-valid
  JSON, and describe fewer plans than the scan before it. Measured in a
  sandbox 2026-08-18: `origin/main` genuinely carried three plans, the scan
  reported two, because it enumerates the working tree rather than the ref it
  names. Nothing treated the smaller answer as suspicious, so it was cached,
  rendered, and replaced by the next full one.

  `pulseShrink` now compares each incoming pulse against the cached one
  before it is accepted, and a loss rides beside the pulse as `shrink` — a
  field distinct from `error`, because the two are opposites in the way that
  matters: `error` means the scan failed and its result was discarded, this
  means the scan SUCCEEDED and its result was kept. The tab marks the view
  instead of swapping it without comment.

  The smaller pulse is deliberately ACCEPTED rather than rejected. Plans
  really do get delivered, and a monitoring view that cannot shrink keeps a
  dead row forever — a different kind of lie. _Degrade, do not hide_, the
  rule the bridge already follows for staleness.

  Two details are load-bearing:

  - **Identities, not counts.** "3 plans became 2" cannot tell an operator
    whether the plan that vanished is one they just delivered or one another
    agent pushed a minute ago. Counts also miss a shape the set difference
    catches: one plan arriving as another leaves nets to zero, so a count
    comparison passes it in silence while a row really did vanish.
  - **Branches are compared even when their plan survives.** A plan that keeps
    its file but loses a wave's branches produces no plan-level difference at
    all — and that is precisely the reported symptom.

  This is the symptom fix, and it is valuable on its own: the cause — the scan
  globbing the working tree instead of the ref it claims to read — is a
  separate branch against `plot-fleet-scan.sh` and is untouched here.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#216](https://github.com/plot-pm/plot/pull/216) [`9988157`](https://github.com/plot-pm/plot/commit/9988157d1b5419b2c5d1672b742576732b2fb413) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: a squash-merged branch is merged, not open

  Squash-merge a branch and delete it, and the fleet reported it as `open` — the
  same word it uses for work nobody has started. Two individually reasonable
  facts combined into a wrong answer.

  A branch's state comes from its ref, and `--delete-branch` removes it. And
  `pr-merge` detection walks merge commits, which a squash merge never produces.
  Measured on the merge of PR [#209](https://github.com/plot-pm/plot/issues/209):

  ```
  $ git log -1 --format="%h parents=%p %s" a263711
  a263711 parents=c3b2dda plot: board verification ... ([#209](https://github.com/plot-pm/plot/issues/209))
  ```

  One parent, and a subject naming `[#209](https://github.com/plot-pm/plot/issues/209)` rather than the branch. The exhaustive
  merge-commit walk has nothing to match.

  **It was live in two shapes.** `2026-08-18-plot-board-setup` had both wave-1
  branches merged ([#208](https://github.com/plot-pm/plot/issues/208), [#209](https://github.com/plot-pm/plot/issues/209)) and still read `Scripts — eligible` with `Skill`
  blocked — and a wave that cannot complete blocks its successor permanently, so
  the fan-out `/plot-dispatch` exists to perform could not get past wave 1 under
  this repo's own merge convention. Separately, the board advertised delivered
  work as available: `bb-state-vocabulary` sat under NOT STARTED, "eligible —
  nobody has taken it", while its plan read `Phase: Delivered` and PR [#210](https://github.com/plot-pm/plot/issues/210) was
  `MERGED`. "No ref" defaulted to _start this_ rather than _cannot tell_, which
  is the reassuring direction and therefore the worst one.

  The data was never missing — only not local. When a branch has **no ref**,
  there is nothing left to read locally, so the host is asked: one call per
  absent branch, not per branch, and none at all where refs exist.

  | `pr-state` says           | Branch reads                     |
  | ------------------------- | -------------------------------- |
  | `MERGED`                  | `merged` — the wave can complete |
  | `OPEN` / `CLOSED`         | its existing meaning             |
  | `NONE`, or the call fails | `open`, exactly as before        |

  **The last row is load-bearing.** `plot-host.sh` already separates a lookup
  miss (exit 0, state `NONE`) from a transport failure (non-zero) — the
  distinction it grew on 2026-08-17, when GitHub returned 503 all afternoon and
  every branch read as having no PR. Only an explicit `MERGED` may move a branch
  off `open`, because `merged` settles a wave and opens the next one; an
  unreachable host that manufactured a `merged` would open a wave onto a seam
  that never landed. A test asserts that failure direction, not merely the happy
  path.

  The lookup is placed inside the no-ref arm, which is what keeps the reused-name
  case correct: merge `feature/retry`, delete it, recreate it for a second
  attempt, and the host still answers `MERGED` about the _first_ attempt. A
  recreated branch has a ref, so it never reaches the lookup — pinned by its own
  test.

  **Cost, under a 5-second board poll.** Gated once per run on both a real
  backend and `--offline`/`--no-fetch`, so the ambient pulse the board relies on
  still makes no host calls whatsoever. Answers are cached per branch for the
  length of one scan — on disk rather than in a variable, because `branch_state`
  runs inside a command substitution and a subshell's assignments are discarded
  the moment it closes. The cache directory is created per run and removed on a
  trapped exit, so no answer outlives the scan that fetched it: a stale `merged`
  read from a previous run is exactly the fabricated verdict the failure
  direction forbids. A test asserts the call count — one for the absent branch,
  none for the branch whose ref is still there.

  **One number the plan did not have, and it belongs in the open.** The board
  refreshes every 5 s without `--offline`, so it takes the host path: 720 scans
  an hour. The within-run cache bounds a scan to ONE call per absent branch, but
  across runs the arithmetic is 720 x (absent branches) — ~720 calls/hour for a
  single squash-merged branch, ~3600 for five. `gh pr view --json` is GraphQL, so
  these draw on the same 5000/hour budget this board exhausted on 2026-08-16.

  Measured worst case: 20 absent branches against a host that fails every lookup
  costs 4.1 s per scan versus 1.2 s offline — about 150 ms per absent branch. The
  board's refresh is off the request path, guarded against overlap, and capped at
  30 s, so nothing stalls; the cost is quota, not latency.

  That is bounded by the count of absent branches in ACTIVE plans, which is small
  in practice and shrinks as plans are delivered. It is left as measured rather
  than pre-optimised — the plan's own fallback, matching the PR number in the
  squash subject, is the offline answer worth reaching for if this proves too
  expensive, and it should be chosen against real numbers rather than this
  estimate.

  The cache key is injective rather than a plain slash-to-underscore mapping:
  `feature/a_b/c` and `feature/a/b_c` are both legal refs that collapse to one
  key under the naive form, and the branch asked second would inherit the first's
  answer. A `merged` arriving that way settles a wave on a branch nobody looked
  at — the same fabricated verdict, reached through the cache instead of the
  host. Pinned by a test that fails against the naive mapping.

  <!--
  bumps:
    skills:
      plot-fleet: minor
  -->

  `plot-fleet` minor: the scan gains a source it did not have, and the skill's
  `merge_detect` table documented `open` under a squash/rebase repo as saying
  nothing about whether work merged — now true only when the host cannot be
  asked. Behaviour and documentation both changed; nothing was removed.

## 0.4.0

### Minor Changes

- [#189](https://github.com/plot-pm/plot/pull/189) [`30f7294`](https://github.com/plot-pm/plot/commit/30f7294538e814a565350a59623a6245e6dbadab) Thanks [@jwloka](https://github.com/jwloka)! - The activity mark becomes a glowing bar down the row's left edge — prominent enough to spot from across the board, and **static**.

  **The wave before this one made the mark honest; this one makes it loud.** `isActive` reads `localLocked || localDirty`, so there is finally something true to make prominent — and the order was paid for: a glow over `group === 'working'` would have been _a livelier lie_, which is why the quiet rendering shipped first.

  **It does not animate, and that reverses two-thirds of what was asked for.** The report asked for _pulsing, left-right movement, and a glow_; only the glow is adopted. The plan settled this when two elements on a row animated. Measured on `main` before this branch, there are now **four** — so the argument is stronger rather than weaker:

  | Selector                           | Animation       | Means                   | Lifetime       |
  | ---------------------------------- | --------------- | ----------------------- | -------------- |
  | `[data-live-dot]`                  | `animate-pulse` | in the WORKING group    | hours          |
  | `[data-change-mark]`               | `animate-pulse` | a PR state just changed | ~3 s           |
  | `[data-stuck-cue]`                 | `animate-ping`  | an unanswered request   | until acted on |
  | _(the change-mark's dark variant)_ |                 |                         |                |

  A fifth at a fifth scale competes rather than adds. The ordering principle that settles it: **a fact true for hours has less claim on motion than a fact true for three seconds.** Motion is the scarce channel and the transient marks hold it. Activity is persistent by nature — someone is writing, and will be for a while — so it takes **presence**, with its appearance and disappearance carrying the change. The travelling motion is refused for a second reason of its own: motion that traverses implies a destination, and this has none.

  **A bar rather than a bigger dot**, because the reported problem is spotting it _from a distance_: a vertical stroke at a fixed x reads as a mark down the side of the list, where a dot must be hunted among the row's words. `h-3 w-0.5` becomes `h-5 w-1` — a stroke spanning nearly the row's full height rather than a tick beside it. It also scales to the group heading a later wave adds: a heading can carry the same stroke, where a dot would read as a bullet.

  **The glow is what carries the prominence the motion was asked to carry**, and it is an explicit emerald `shadow-[…]` rather than a step on the neutral shadow scale — those are greys for lifting a surface off the page, and a grey blur around a 4 px bar reads as a smudge rather than a light.

  **`motion-reduce` leaves the mark and its glow completely unchanged**, because nothing here animates. The repo's rule — _keep the mark, stop the movement_ — has no movement to stop, and what it must not do is strip the glow: the glow is the channel that will separate this mark from the unpushed mark a later wave adds (_glow means someone is here_). A reduced-motion rule that removed it would take that distinction with it before it is built.

  **It keeps its left-padding home**, hanging beside `LiveDot` via `sm:absolute`, deliberately outside the six grid tracks so the columns do not move in from the edge on every row in the fleet to reserve room for a mark most rows never carry. Asserted in pixels: a row without the mark renders its columns at the same x as one with it.

  **`aria-hidden`, and the `title` keeps its limit.** Every signal behind the mark is local — `fleet.ts` is explicit that these are _"true only on the machine doing the looking"_ — so an agent on another machine produces no mark here, ever, and that absence means **not visible from here**, never _not happening_. The mark goes on saying _A write is in progress in this checkout_ rather than letting absence speak for itself.

  **`isActive`, the lock echo, and the contract are untouched**, as are `[data-live-dot]`, `[data-change-mark]` and `[data-stuck-cue]`: four marks, four meanings, and no mark implemented by modifying another.

  The claims are pinned in two places, split by what each can actually answer. The class list — no `animate-*`, no `motion-reduce:` variant, an emerald `shadow-[…]`, a bar rather than a dot — is read out of the source in `test/unit/agent-list.test.ts`. What only a page can state moves to a new `test/integration/activity-mark.browser.test.ts`: that the glow is a _computed_ `box-shadow` and not a class Tailwind never emitted, that reduced motion renders the mark byte-identically, and that the six tracks do not move.

  Two of those assertions were written weaker first and strengthened by mutating the implementation to check they went red. `boxShadow !== 'none'` passes on a glow stripped by `motion-reduce:shadow-none`, because Tailwind v4 resolves that to five transparent shadow slots rather than to the literal string `none`; the assertion now names the emerald layers. And a source-reading helper that walked forward from `data-live-dot` landed in the wrong element's class list, because every mark names the other three in its doc comment — it now anchors on the JSX attribute.

  <!--
  bumps:
    skills: {}
  -->

- [#185](https://github.com/plot-pm/plot/pull/185) [`4d6d77c`](https://github.com/plot-pm/plot/commit/4d6d77c4d828e5277a1c39d9dece5d6b919bd776) Thanks [@jwloka](https://github.com/jwloka)! - A stuck branch now says so in its row, names which of the four states it is in, carries the evidence, and — for the two the pulse cannot fix — offers its action on the row with an animated cue.

  **The facts reached the row and stopped.** The previous wave landed the detection and put `stuck` on `AgentRow`; measured on `main`, `AgentList.tsx` rendered zero occurrences of it. Closing that gap is the whole of this change.

  **Four states, four words.** _Stuck_ as one label would be the one-label-many-states defect this board keeps removing: `artifact conflict`, `conflict`, `CI failed` and `unpushed work` differ in the only way that matters, which is what a person does next. `artifact-conflict` and `conflict` in particular are not degrees of one thing — the first has a resolution a rebuild and a CI no-diff gate can prove without anyone reading a diff, and the second does not.

  **Evidence travels with the state, always.** A row that says _stuck_ and makes the reader go find out why has moved the ten minutes of log-reading rather than removed it. A conflict prints its conflicting paths, unpushed work prints its commit count, and a failing check prints three lines — the failing step, the branch's changed paths, and the branch's own recent run history:

  ```
  CI failed — step: Install Playwright browser
  this branch changes docs/plans/a.md
  recent runs: failure at 10:19, success at 10:17
  ```

  Nothing compares those runs and nothing classifies the failure. A heuristic mapping failing steps to changed paths was rejected: that table is unmaintained by construction and goes silently wrong the first time a workflow is restructured (Principle 3). An empty evidence field says _unavailable_ rather than vanishing — `runHistory: []` is _this host has no run listing_, never _this branch has never failed before_.

  **The action goes on the row, not in the three-dot menu**, and that is measured rather than preferred: `RowActions` hides its action behind a menu that only opens if something inside could act, so a row with a waiting action looks identical to a row with none until you click it. A cue nobody finds is not a cue.

  **The cue animates, and this is the one place on this board where motion is right.** A neighbouring wave settled the opposite for the activity mark — _a thing true for hours has less claim on motion than a thing true for three seconds_ — and a stuck branch is neither: it is true **until someone acts**, and the acting is the point. Motion here marks an unanswered request, not a state.

  It is bounded so it cannot become wallpaper:

  - **Only where an action is offered.** `unpushed` is reported in words — the fix is a push, and pushing someone else's judgement is not ours to make. `artifact-conflict` offers nothing in this wave; the repair is a separate one.
  - **It stops when the action is TAKEN**, not when the branch unsticks. The request has been answered; whether the answer worked is what the row's other marks report.
  - **`motion-reduce` keeps the cue and stops the animation.** Both halves — hiding the element would take the marker along with the movement.
  - **Never motion alone and never colour alone.** The action carries a word, the reason reaches the accessible name, and the cue is `aria-hidden`.
  - **A healthy row carries no cue.** A cue on every row makes the stuck ones invisible.

  **Over a non-localhost binding the cue shows and the action refuses, naming the reason.** `/api/dispatch` is localhost-only — _whoever reaches localhost:7777 is sitting at the machine that owns the worktrees_ — so over Tailscale the board is a reading surface. The information is true everywhere, so hiding the cue would let a phone report a healthy fleet while branches sit stuck: a worse lie than an action you cannot take from where you are.

  **A stuck branch keeps its group**, and a row with `stuck: null` renders exactly as before. No row moves, no section is added, and the common case costs nothing.

  **No write path was added and no route was widened.** The conflict action dispatches through the existing guarded `/api/dispatch`, with `plot-dispatch.sh` deciding everything it already decides. There is no rerun route on this server, so a failing check offers a **link to the failing run** rather than a rerun — navigation to where the rerun button already lives, on the host. `[data-live-dot]`, `[data-change-mark]` and `[data-activity-mark]` are untouched: four marks, four meanings, and no mark implemented by modifying another.

  <!--
  bumps:
    skills: {}
  -->

- [#192](https://github.com/plot-pm/plot/pull/192) [`ee3c4c8`](https://github.com/plot-pm/plot/commit/ee3c4c8818ca389cd1ab05f316a4bf175efdf2ea) Thanks [@jwloka](https://github.com/jwloka)! - A green check no longer outranks an unknown merge: `prState` returns `unknown` when the host could not say whether a branch merges, before consulting `checks` at all.

  **Measured, live, from a screenshot.** On 2026-08-17 PR [#57](https://github.com/plot-pm/plot/issues/57) read `green` in the agents row while the host said the branch could not merge:

  ```
  plot-host:  checks="green"   mergeable="conflicting"
  gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
  ```

  A branch unmergeable for 22 days wearing the one word a reader acts on without checking. A minute later the same row read `conflicts`, correctly — so the defect is real, intermittent, and repairs itself, which is why nobody reproduced it on request.

  **The fold was right; its input was not.** `prState` handled `conflicting` correctly and had no case for `unknown`, so control fell through to `checks`. GitHub computes mergeability lazily and its API returned `503` at least four times that afternoon; under that load `mergeable` comes back `UNKNOWN` while `statusCheckRollup` — a plain stored field — still answers `green`. The function's own comment already stated the rule it needed — _a new word from a future host must read as cannot say, never as the reassuring end of the range_ — and applied it to `checks` while letting `mergeable` bypass it.

  `conflicting` still outranks everything and the new line sits below it, so a host that knows the branch conflicts still says so. **`checks` is not consulted to break the tie**, and that is the point rather than an omission: the two fields answer different questions, and a green check says nothing about whether a branch merges. Twenty-two days of green on a conflicting branch is the proof.

  **The note now says WHICH fact is missing**, because only one of the two is actionable: _cannot say whether it merges_ sends a reader to check for a rebase, _cannot read the checks_ sends them nowhere but back later. `classify` and `draftNote` carry the same precedence as `prState`, so a row's word and its sentence cannot disagree — a draft whose mergeability could not be read no longer gets the silence that means _not ready for you, but otherwise fine_.

  **A transition into or out of `unknown` does NOT flash the change marker.** With the fix, a 503 turns `green` into `unknown` and the next pulse turns it back — two flashes per row per outage, and there were four outages in one afternoon. `unknown` is a fact about the _observation_, not the world, and the marker reports changes in the world; this is the marker's own rule — _absent is unknown, never a value_ — applied one level up, the same reason it already refuses to flash on a first sighting. The memory carries the last known value across the unreadable pulse rather than storing `unknown`, so `green → unknown → failing` still flashes when `failing` becomes visible: the marker misses the moment, never the fact.

  **Where no PR on the board could be read, the empty WAITING ON A MACHINE section names the host's limit** instead of promising _CI will finish_. Measured: the Bitbucket adapter emits a literal `checks:"unknown", mergeable:"unknown"` on every row because `bb` has no run listing. That is the CLI's limit rather than deferred work, so that section is permanently empty there — and an unexplained empty section reads as _nothing is running_ rather than _this host cannot tell me_. The condition is ALL and not ANY: one unknown row among readable ones is a single PR mid-outage, and an empty board claims nothing at all.

  **One consequence is a real cost and is asserted rather than left to be found.** `stuck.ts` reads `prState`, so a branch whose checks are `failing` while its mergeability is unreadable no longer reports `ci-failing` — it reports nothing until the next readable pulse. That is the correct trade: a stuck verdict derived from a pulse the host could not answer is a guess, and `stuck` is the one field a later wave is licensed to act on. The row still _says_ _cannot say whether it merges_, so nothing is hidden from the reader; only the machine-actionable claim is withheld. Locally-observed evidence — a `merge-tree` conflict, unpushed commits — is unaffected, and asserted so.

  No contract change and no new field: `prState` remains a pure function over the two facts it already received.

  Two test factories omitted `mergeable` and now state it. That is load-bearing rather than cosmetic: unreadable mergeability outranks every `checks` verdict below it, so an omitted field would send every case in those blocks down the new arm and assert nothing about the checks each was named for. One assertion is replaced rather than added — it read `.toMatch(/no checks/)` for `mergeable: 'unknown'`, which encoded the defect.

  <!--
  bumps:
    skills: {}
  -->

- [#199](https://github.com/plot-pm/plot/pull/199) [`07b5f12`](https://github.com/plot-pm/plot/commit/07b5f12dae7b9b2458bd31ac01338346aca91245) Thanks [@jwloka](https://github.com/jwloka)! - A group heading on the Agents tab now carries the same activity mark its rows carry, so a **collapsed** section says whether anything inside it is moving instead of only how many rows are in there.

  **A folded group reported its stock, not its motion.** The heading renders `(4)`, and the comment above it says why that number exists at all: _"a folded header with no number reads as nothing here"_ — it was introduced to separate **absent** from **empty**, not to report change. It is the same shape as the live dot: a count reporting membership where the reader is looking for activity. And this is not hypothetical. **QUIET and DONE start collapsed** by default and the choice is persisted in `localStorage`, so they stay folded across sessions — while QUIET's own comment names its purpose exactly: _"go check whether this died"_. A group whose entire job is to surface possible deaths was folded shut showing a stock count. The rows are **removed from the tree** when folded, not merely hidden, so the heading is the only thing on the page that can say anything about them.

  **Binary, and no second number.** At least one row is active, or none is. `(4, 2 active)` was the alternative and is rejected: `(4)` exists to separate absent from empty, a distinction this board paid for, and a second figure beside it dilutes the one job that number has. The reader opening a group does not need to know whether it is one row or three — they need to know whether opening it is worth it.

  **The strongest pace its rows state, never stronger.** A group holding one written-to row among three merely-claimed ones travels **fast**; a group holding only claimed rows travels **slow** — the same _unknown, never nobody_ ordering every mark on this board keeps. **The pairing that matters:** an implementation returning the weakest pace, or keeping the last row's answer, passes every assertion that only checks _the heading has a mark_ and lets one measured write hide behind three unobserved claims — when that measured row is precisely the reason to open the group. The test puts the written-to row **last**, so an implementation stopping at the first live row it meets fails rather than passing by luck.

  **It reads both entry paths, because a row has two.** `active` is the fleet's answer for the whole list at once — `isActive` in this pulse, or a lock still echoing from a recent one — and `isLive` adds the rows the fleet places in WORKING while observing nothing local. A heading computed from `isActive` alone would go dark for a group whose rows still carry marks, which is the heading disagreeing with the rows beneath it.

  **It cannot disagree with its rows, and that is structural rather than tested.** The heading is `groupPace(rows, active)` computed at render, from the same set the rows are rendered from. No new field, no stored count, nothing to drift — the way a separately-maintained figure would. It reads only the rows it was given: `active` answers for the whole fleet, so a heading asking _is anything in the fleet active_ would light every section on the board from one busy row in one of them.

  **The heading keeps the mark when expanded.** Hiding it on expand was considered — the rows show it themselves, so the heading repeats them — and rejected because the marker would then vanish at the moment of opening, which reads as _it stopped_. A marker that disappears when you look closer is worse than one that repeats itself.

  **The mark gained a placement, not a second design.** Everything it _is_ — the track, the travelling dot, the glow, the two paces, the titles, `aria-hidden` — is shared with the row, because a group heading says what its rows say and must say it in the same marks. Only where it hangs differs, and that difference is load-bearing: the row's placement is `sm:absolute`, which positions against the nearest positioned ancestor, and an `<h2>` **has none**. Reusing the row's class list would not have sat the mark slightly wrong — it would have hung it off whatever ancestor happened to be `relative` and landed it elsewhere on the page, a failure no class-name assertion can see. The two placements are a named table, the row's pinned whole so a shared component gaining a second caller cannot quietly change the first caller's geometry.

  **`aria-hidden` earns its keep twice here.** The mark renders _inside_ the collapse toggle, so without it the button's accessible name would become "quiet (2) a write is in progress in this checkout". The heading's words and the row's note still carry the fact.

  **`(4)` still means what it meant**, and the heading does not grow a second line: asserted against an unmarked section's heading height.

  <!--
  bumps:
    skills: {}
  -->

- [#191](https://github.com/plot-pm/plot/pull/191) [`128cd67`](https://github.com/plot-pm/plot/commit/128cd6703d8094c285be19bac8fccadbeb697ee4) Thanks [@jwloka](https://github.com/jwloka)! - NOT STARTED now counts **plans**: one row per plan, carrying the plan's own clock and a summary of its waves, with the branches folded beneath it and expandable. The section sorts by how long each plan has waited, oldest first.

  **Its rows were never branches.** Measured live on 2026-08-17, every row in that section carried `pr=—` and `age=—` — the branch name came out of the plan's `## Branches` section and no branch was ever created for it. **Six rows for four plans**, with `activity-shows-itself` appearing three times for one waiting plan, the two extra rows carrying nothing the first did not. Compare WAITING ON YOU in the same pulse: four rows, all four with a real PR and a real age. There the branch is the subject because it holds work that exists.

  So this is one row shape carrying two meanings — the defect this board keeps finding, this time not in a field but in the identity of a row.

  **Folded, not summarised away.** The branch names are the plan's own words for what it will do, and a reader who wants them must not have to open the plan file to get them back. They are collapsed by default behind an expander and come back whole. A plan with only one branch beneath it gets **no** expander: a control that reveals a row it already shows is noise.

  **The wave summary is derived from the group's own rows — no contract field was added.** `waveSummary` on the schema lives on the card, and a fleet row knows only its own wave; but the view already holds every row of the plan in this section, so counting them and reading their notes answers _how many, and is the first one startable_. `first eligible` reads the same `isStartable` predicate the row menu does, so the summary cannot promise an action the menu then refuses.

  The limit is recorded rather than hidden: this counts the waves **in this section**. A plan whose first wave already merged has that wave in DONE, so the row reports the remainder — two where the plan file lists three. That is the honest number for the question the section asks, and the plan link on the row carries the full arc.

  **The section's sort was broken, and this fixes it.** The group order came from `Math.max(...rows.map((r) => r.ageMinutes ?? -1))`, and `ageMinutes` is `null` on every row here — so every group scored `-1`, the comparator returned 0 for every pair, and the sort did nothing at all. `plot-sprint-support`, approved 187 days ago, sat wherever insertion order put it, beside a plan from that afternoon. It now sorts by `waitingDays`, **oldest first**, because that is the only clock that ticks in this section. Sorting startable-first was rejected: the startable plans are already marked by their own note, and burying a six-month-old plan under a fresh one hides exactly the drift this section exists to surface. An undated plan sorts last — `-1` would assert a wait nobody measured.

  This is the **group** order and deliberately not the same question as `compareWithinGroup` in the server, which orders the rows _inside_ a group newest-first on the reasoning that six months of availability is evidence nobody wants a branch. That answers _which branch do I pick up_; this answers _which plan has been ignored longest_, which is what a reader scanning section headings asks. The server's row order survives untouched inside each fold.

  **A deferred branch keeps its own row**, with its own PR and its own age, beneath its own plan row. Those branches _were_ started and were then shelved, and the server records what flattening them costs: an earlier version wrote `deferred` as the note, and _"a branch started and then shelved read as never begun, with its age and its PR erased."_ A separate "shelved" section was rejected — it cuts a branch from the plan that explains it.

  **The indicator sits with the plan** on a plan row, and with the branch on a deferred row. Same rule every other section follows — the marker belongs to whatever is waiting — applied to a different subject.

  **The grid tracks do not move.** A plan row is laid on the same `ROW_TRACKS` as a branch row, so every column keeps its x and the section boundary does not break alignment. The plan takes the plan track; the wave summary takes the branch track, which is where a reader looks for _which slice of it_. The PR track is empty on purpose: a plan has no pull request of its own, and inventing one from a branch beneath it would state something no field says.

  **Every other section is unchanged** and still renders branch rows. The six sections stop sharing one row shape, and that is the real cost — but it is the one section whose rows are not the same kind of thing as the others', and forcing them into the shared shape is what produced `pr=—`, `age=—`, and three rows for one plan.

  The inner fold is **not persisted**, unlike the section-level collapse. Folding QUIET is a standing preference about a section a reader has decided not to watch; opening one plan's waves is a momentary question — _what were the three branches again_ — asked and answered. Restoring it on a board reloaded several times an hour would rebuild the crowding the fold removes.

  <!--
  bumps:
    skills: {}
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: NOT STARTED says what each row is waiting for

  Three rows in that section can look identical and mean opposite things:
  one waits on a person, one is free to take, one cannot move until a
  predecessor lands. The notes said so and were invisible until read.

  The waiting-state now travels as a **field** (`waitingOn: you | click |
time`), computed server-side where the wave verdict and the plan phase
  are both in hand — the row carries only its own wave name and could
  never have derived it. The blocking wave travels with it (`blockedBy`),
  so _blocked by an earlier wave_ becomes **blocked by `Truth`**: _by which
  one?_ is the reader's unavoidable next question and it costs one string.

  **Only `needs you` is loud.** `ready to start` keeps the ordinary note
  colour — available, and taking it is optional — and `waiting its turn` is
  quieter still. A section where every row is coloured has coloured
  nothing, and blocked rows outnumber eligible ones two to one in a
  multi-wave plan.

  **A Draft plan colours only its FIRST wave.** The later ones would still
  be blocked the instant the approval landed, so they read as _waiting its
  turn_. This falls out of testing the wave verdict before the phase rather
  than from a special case.

  Nothing animates. Motion marks an unanswered request; a plan drafted
  minutes ago is the ordinary state of a plan just written.

  `isStartable` now reads the field instead of comparing the note against
  `ELIGIBLE_NOTE` — the shape that fails silently, and would have failed
  here, because this same change reworded a neighbouring note. The client
  no longer imports any note constant.

        <!--
        bumps:
          skills:
            plot: patch
        -->

- [#182](https://github.com/plot-pm/plot/pull/182) [`07eeceb`](https://github.com/plot-pm/plot/commit/07eecebe6b1d915e1d05fe8d35391c1bbb02f903) Thanks [@jwloka](https://github.com/jwloka)! - A row on the Agents tab now marks itself when something is actually being written to it, rather than when it happens to sit in the WORKING group.

  **The dot was not too quiet; it was too uninformed.** `isLive` was the whole of `row.group === 'working'` — which is an _address_, not a pulse. A row keeps that address for **hours**: while an agent works, while an agent has crashed, and while it waits on a human. Nothing measures the end. Six rows carried the claim simultaneously during the session that reported this, and making it louder would only have amplified a statement the board cannot support.

  Meanwhile the scan already produced the answer and threw it away. `local_dirty`, `local_locked` and `local_ahead` have been in the contract since [#167](https://github.com/plot-pm/plot/issues/167) — `local_locked` reads `.git/index.lock` and was fought for the same day in `board-survives-its-agents`, on the argument that a locked worktree must become **its own signal rather than silence**. All three reached `classify()` inside `rowsFromPulse` and were dropped there. Producing a signal and never rendering it is a quieter version of the defect that plan fixed.

  **A row is active when `local_locked || local_dirty`** — someone is writing, or has written and not committed. `local_ahead` is deliberately **not** part of it: unpushed commits are finished work sitting _still_, a real condition with a real remedy (push it) and no motion behind it. An implementation OR-ing all three passes every positive assertion this change makes and reports a branch nobody has touched for hours as though someone were typing into it. It earns a static mark of its own in a later wave.

  **A seen lock echoes for 6 s.** Measured tension: `.git/index.lock` lives from a fraction of a second to a few seconds, and `FLEET_POLL_MS` is 4 s — so most locks are born and die _between_ two pulses, and the sharpest signal the board has is the one it most often misses. Six seconds is longer than one poll (so a seen lock survives the next pulse, which is the entire point) and shorter than two (so it always clears). This is the one place the board lets a marker outlive its fact, and it is bounded by three rules, each with its own test: the echo **only ever adds**, so a pulse finding nothing neither clears it early nor extends it; a lock **never resurrects**, because the echo starts only where a lock was _seen_; and it is **a marker, not a state** — the row's note goes on reporting whatever the last pulse actually found, and each echo clears itself on its own timer rather than waiting for a pulse, which is what keeps a board whose server died from sitting lit.

  **Absent is not false.** Both fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness. So `false` yields **no mark** — never a mark reading _idle_. The strongest statement licensed here is _unknown, never nobody_.

  **The marker names its own limit**, because a technically-correct marker can still mislead. Every signal behind it is local — `fleet.ts` is explicit that `local_dirty` is _"true only on the machine doing the looking, and false is what every branch elsewhere reports"_ — so an agent on another machine produces **no mark here, ever**. Its branch is not idle; it is unobservable from this checkout. The marker says _a write is in progress in this checkout_ rather than letting absence speak for itself.

  **No existing mark was modified.** `isLive` and `[data-live-dot]` are untouched and still mean _in the WORKING group_; `[data-change-mark]` keeps its full-row amber wash. Three marks, three meanings — the standard [#180](https://github.com/plot-pm/plot/issues/180) set when it shipped beside the dot rather than over it, and a row can carry all three at once. The activity mark is rendered minimally here on purpose: it reads the right thing before it is made prominent, because a glow over `group === 'working'` would have been a livelier lie.

  The two fields had to be **forwarded onto `AgentRow`** to reach a component at all — they existed only on `FleetBranchSchema`, the raw scan document. Additive, both `.default(false)`, forwarded rather than re-derived so the group and the marker always answer from one reading of one scan. `classify()`, grouping and the scan itself are unchanged.

  <!--
  bumps:
    skills: {}
  -->

- [#180](https://github.com/plot-pm/plot/pull/180) [`3f4179f`](https://github.com/plot-pm/plot/commit/3f4179f1620d9e25f8cdcb77ac6fae0e3569d165) Thanks [@jwloka](https://github.com/jwloka)! - The Agents tab's status column now has room for what it holds, and a row marks itself for about three seconds when its PR status changes.

  **The space was not missing; it was misallocated.** `ROW_TRACKS` gave the branch `1fr` and the status `9rem` — and `1fr` does not mean _take what you need_, it means take everything left over. So on a wide window every spare pixel collected between the branch name and the status cell as a gap that belongs to the branch column and draws nothing, while `⑂116 no checks` was the widest thing 144px could render. The status track is now a fixed `14rem` and the branch keeps `1fr`: 80px comes back from a gap that displayed nothing, and every column edge stays where it was.

  Two wider-looking shapes were rejected for the same reason. `minmax(9rem, auto)` on the status sizes it to content, so its edge wanders between rows; `max-content` on the branch sizes it to the longest name _in that section_, so two groups disagree about where the branch starts. Either gives back at one column what fixed tracks establish at all of them. The honest cost is that a narrow-but-not-mobile window elides the branch sooner — middle elision keeps both ends and `title` keeps the whole name. Below 640px nothing changes; the row is a stacked card there and tracks do not apply.

  **And a status could say what is true, but not what just changed.** `⑂57 conflicts 22d` and `⑂177 conflicts 5m` are the same status meaning opposite things — a standing decision nobody has taken versus something that broke minutes ago — and Age does not separate them in general, because it is the _PR's_ age and not the _state's_. A three-week-old PR that broke this morning still reads `22d`.

  So a row whose watched value changes now tints itself for ~3s. The watched value is `pr?.state ?? null`: **seven possibilities, not six**, because `pr` is nullable and most rows carry none. `null → pending` (a PR opening, often the most interesting transition a branch has) marks, and so does `pending → null`.

  **Three seconds, and the measurement decides it.** `pr.state` comes from the 60s PR refresh, not the 4s fleet pulse — and 120s under rate-limit backoff. A transition is a _rare_ event, so a 300ms flash calibrated for something frequent would be missed nearly every time.

  The memory distinguishes a **missing key** from a stored **`null`**: _never observed_ and _observed with no PR_ look alike in JavaScript and mean opposite things, and collapsing them passes the first-pulse assertion while silencing every branch's first PR forever. The first pulse after a load or restart therefore marks nothing, and a row returning after absence starts silent.

  A changed row marks itself **wherever it now sits, including a new section** — `pr.state` helps decide the group, so the changes worth marking are frequently the ones that move the row. A second change while lit **restarts** the timer rather than letting the first expire and imply nothing further happened. Ten rows changing means ten marks: no threshold, no suppression.

  Under `motion-reduce` the mark **stays** and only the animation stops; it is `aria-hidden` with no live region, because the cell's text already changed and a reader reaches it by reading the row. The `LiveDot` on WORKING rows is untouched — _something is alive, end unknown_ and _this just changed_ are two meanings that keep two marks.

  **The memory is per client and one value deep.** Nothing is persisted, no contract field is added, and neither clock moves: a reload starts silent, two tabs mark independently, and a backgrounded tab accumulates nothing. The marker is not a log.

  <!--
  bumps:
    skills: {}
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`120a9bc`](https://github.com/plot-pm/plot/commit/120a9bc42344ba4b27737fc0e246cce6ce4e6db8) Thanks [@jwloka](https://github.com/jwloka)! - board: the Agents tab can approve, and the marks get a column

  **Approve was unreachable from a row.** `board.approve` has existed since
  `board-becomes-operable` and reached the CARDS only — `Board.tsx` and
  `Swimlanes.tsx` pass it to `PlanCard`, the Agents tab was never given it.
  So a plan PR sitting green and ready showed a dimmed three-dot menu on
  its row while the same plan's card offered the button: one board, two
  answers about the same act.

  Three layers were in the way, and fixing one alone would have changed
  nothing:

  - `App.tsx` never passed `approve` to the tab
  - the menu's gate read `canStart && serverWillAct` — one named action, so
    a Draft plan's row was dead by construction, since such a row is never
    startable
  - the menu BODY required `dispatch`, which a Draft row does not have

  The gate now asks whether **any** act is available, and each item asks
  for its own precondition. Written as two independent items rather than an
  if/else: should the two ever overlap, the menu shows both instead of
  silently picking one.

  **The marks get a track of their own.** They hung in the row's left
  padding on the argument that six columns should not move for a mark most
  rows never carry — which held while there was one mark. There are five
  now, and a row can wear several: measured on screen, the activity track
  and the unpushed bar overlapped, and `left-0` is the ROW's edge, which
  sits outside the section's border, so every mark straddled the panel.

  The cell is unconditional while its contents are not, so a markless row's
  six other cells do not shift. A seventh track costs its width AND a sixth
  gap, which crossed the 640px card breakpoint — the phase column gave up
  1rem to pay for it. The test that caught this predicted the day in its
  own comment; its gap constant is now derived from the track count rather
  than hard-coded, because `84` was right for six tracks and silently wrong
  for seven, in the reassuring direction.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#204](https://github.com/plot-pm/plot/pull/204) [`aa8874b`](https://github.com/plot-pm/plot/commit/aa8874b9b64d150548044150ae2c643c7e243f42) Thanks [@jwloka](https://github.com/jwloka)! - board: a row flashes on any observed fact that changed, not only its PR

  `watchedState` watched one thing — `pr.state` — so a row that changed
  section, gained unpushed commits, became dirty or got stuck did it
  silently. The marker existed to say _this just changed_ and only ever
  answered about the git host.

  It now watches every **observed** fact on the row: PR state, number and
  draft flag, git state, group, wave, phase, the three local signals, and
  stuck. Derived time is deliberately excluded — a ticking clock is not
  news, and including `ageMinutes` would flash every row on every pulse.

  **The unreadable case is the hard one, and it is settled per slot.** A
  PR whose host could not answer reports `unknown`, and `unknown` is not a
  value: it is the absence of one. So the memory carries the last KNOWN
  state forward across an outage — `green → unknown → failing` still
  flashes, because the memory still holds `green` when `failing` arrives —
  and only the moment is skipped, never the fact.

  Per slot rather than per row: a GitHub 503 says nothing about whether a
  worktree is dirty, and freezing the whole record for a remote host's
  reason would silence an agent's edits exactly while it writes.

  For a row first seen while the host was down there is nothing to carry.
  It is recorded honestly as `unknown`, and `sameWatched` treats `unknown`
  on either side as **not comparable** rather than as different — a
  sentinel chosen to compare as changed would flash the host's _recovery_,
  which is news about GitHub rather than about the branch. The stated cost:
  such a row does not flash on the first state it is finally seen in;
  `prNumber` going from null to a number covers most of it.

  `isObservation` is renamed `isUnreadable`. It returned true for
  `unknown` — the one value that is _not_ an observation — so it read as
  its own opposite at every call site.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#201](https://github.com/plot-pm/plot/pull/201) [`4947c87`](https://github.com/plot-pm/plot/commit/4947c87cb446dbc52d1ff4395d513962a9aa637b) Thanks [@jwloka](https://github.com/jwloka)! - board: unpushed commits get a mark of their own

  `local_ahead` reached the contract and stopped there — the row could not
  say _this checkout holds finished work nobody else can see_. On
  2026-08-17 that silence cost PR [#177](https://github.com/plot-pm/plot/issues/177) half an hour of dead CI: a rebase
  that stayed local read from outside exactly like an agent that had
  stopped.

  It gets a static bar at the same left edge as the activity mark,
  separated from it by **form and the absence of the glow** rather than by
  motion. Stillness is the message: the activity mark says _someone is
  writing here_ and travels and glows to say it; this says the opposite,
  so it does neither. It is the only one of the five marks with nothing
  animated, which is why `motion-reduce` needs no clause.

  `localAhead` is a count on the row (additive, defaults to 0, where 0
  means _not observed_ rather than _clean_) and is deliberately NOT part of
  the activity predicate: OR-ing it in would render a branch nobody has
  touched for hours as motion.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#194](https://github.com/plot-pm/plot/pull/194) [`6f24402`](https://github.com/plot-pm/plot/commit/6f2440294ac4c4deb8492572091d6f7fd0dab3af) Thanks [@jwloka](https://github.com/jwloka)! - The activity marker on the Agents tab now aligns to the row's first line and travels: a short track with a glowing dot moving out and back, fast where a write was observed and slow where a branch is merely claimed.

  **The marker was centred on the row, and the row stopped being one line tall.** It carried `sm:top-1/2 sm:-translate-y-1/2`, resting on an assumption its own comment stated: _"the row is `py-2` around one line of `text-sm`, so 20px spans nearly its full height."_ Under that assumption, centring on the row and centring on the line are the same pixel. The stuck cell then landed as its own line beneath the six columns (`sm:col-start-2 sm:col-end-[-1]`), so a row carrying a status line is roughly twice as tall — and `top-1/2` put the marker **between the two lines** instead of beside the branch name it belongs to. This was the third consequence of that one change: the stuck cell also started at the wrong x, and its cue survived at a dead end, both fixed the same day.

  The marker belongs to the **branch**, and the branch is on line one whatever else the row grows beneath it. So the mark is now given the first line's own box to sit in — `sm:top-2` where the first line begins, `sm:h-5` for one line box of `text-sm` — and the track centres itself inside it. Measured rather than assumed: the first line box begins **18.6 px** below the row's top edge on a real page, not the 8 px a reader would derive from the padding, so a hand-computed offset would be right today and wrong the moment the type scale moves. **The pairing that matters:** `top-1/2` looks correct on every single-line row and is wrong on exactly the rows carrying the most information, so a single-line assertion passes on the defect. The browser suite states it with a pair — one row on one line, one on two — and first proves the tall row really is taller.

  **The bar became a track with a travelling dot, and the dot must never arrive.** Rotation and travel were refused twice in this repo, both times for one reason: they _"imply progress toward completion, which nothing here measures."_ An agent in WORKING may finish in five minutes or five hours. A dot that goes out and comes back promises no destination — it reports a **rate**, not a distance, and that is the only reason travel is acceptable where those were not. The keyframes end where they began and the track has no far marker to reach; anything that fills, completes or arrives reintroduces exactly what was refused. Asserted on the browser's own resolved `@keyframes`, and on the absence of `width`, `scaleX` and `stroke-dash` in them.

  **Two speeds, and the speed is a fact rather than a decoration.** Fast where `local_dirty` or `local_locked` — someone is writing, measured. Slow where the row is merely in WORKING with neither signal — claimed, and the board does not know whether anyone is there. Both states were live on the board the day this was asked for: `feature/not-started-counts-plans` reported `dirty=true` against `bug/green-never-outranks-unknown` with `dirty=false` and the note _claimed, no known worker_. The two are separated by a factor of three so the difference reads rather than merely computes, and each pace carries its own `title` — _a write is in progress_ against _claimed, and no write observed_ — so the distinction is never carried by motion alone.

  **`isActive` is untouched, and the widening is visible at the render.** The predicate `activity-shows-itself` settled still means _someone is writing here_ and is now the **fast** half; the slow half is WORKING membership, added where the mark is rendered rather than by loosening the predicate. That keeps the second statement legible as a second statement. The slow dot says **unknown, never nobody**: both local fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness — which is why the slow case is bounded by WORKING rather than applied to every row.

  **`motion-reduce` keeps the track, the dot and its glow, and stops only the travel.** All three halves, the fifth time this repo has written the rule: hiding the element under reduced motion passes a motion-only assertion and takes the marker along with the movement. The dot rests at the track's start rather than mid-flight, because a dot frozen halfway reads as a paused progress bar. Under reduced motion the two speeds collapse into one appearance and that is correct — _speed_ is what is being removed, so it cannot be the only carrier; the row's note still says which state it is in, in words.

  **`aria-hidden`, and a screen reader never hears a speed.** The note carries the fact in words, and the accessible text of the row contains neither _fast_ nor _slow_.

  **No third speed.** No gradient keyed to commit freshness: a scale nobody can read (_was that four minutes or forty?_) changing continuously is motion in place of information. `activityPace` reads the two local signals and nothing else, asserted by varying the age and the group and getting one answer.

  **No mark is implemented by modifying another.** `[data-live-dot]` keeps its own `animate-pulse` — asserted as _not `travel`_, since _not none_ would pass on a dot that had been handed this wave's animation — and `[data-change-mark]` and `[data-stuck-cue]` are untouched. The board's first hand-written keyframes arrive with this change, because no Tailwind utility travels: `pulse` changes opacity and `ping` scales, and both stay where they are.

  <!--
  bumps:
    skills: {}
  -->

- [#153](https://github.com/plot-pm/plot/pull/153) [`6550adc`](https://github.com/plot-pm/plot/commit/6550adc0de0b5e9fb923857dbd647241546a0619) Thanks [@jwloka](https://github.com/jwloka)! - Dormant groups on the Agents tab now start collapsed, NOT STARTED sorts by how long it has waited, and row actions move into an overflow menu.

  **The quietest groups were pushing the status line off the screen.** Seen on the live board: `QUIET (7)` and `DONE (13)` rendered twenty rows between them, six of which had said _no commit for 22 days_ for three weeks — and the footer reporting when the last scan ran, and when the next one is due, had scrolled out of view. The group order already encoded the intent (`waiting-on-you`, `working`, `waiting-on-machine`, `not-started`, `quiet`, `done`, deliberately actionable before diagnostic); what an ordering cannot do is stop a group at the bottom from consuming full vertical space anyway.

  **`quiet` and `done` now start collapsed; every other group starts open.** That default is not a preference — it is the existing order made effective. Those two are the diagnostic end: one means _go check whether this died_, the other _this is finished_, and neither needs reading on arrival.

  **A collapsed header keeps its count.** `QUIET (7)` states plainly that seven rows are hidden; a folded header without a number reads as _nothing here_, which is worse than the crowding it fixes. **An empty group never collapses at all** — its header renders the group's hint (_still thinking, or dead?_) rather than `(0)`, and that hint is the explanation for the emptiness and exactly what a reader wants when there is nothing to list. A control on a group with nothing to hide is an offer that leads nowhere.

  **A row falling into a collapsed group changes the count and nothing else.** No flash, no auto-expand: the pulse re-scans every five seconds, `quiet` is by construction the group whose changes are least urgent, and whoever folded it was asking not to be interrupted by it. Collapsing is manual in both directions — a view meant to sit beside your work must not move its own furniture.

  **The state persists in `localStorage`, and that is a deliberate departure.** The board's convention for view state is the URL — `?tab=agents`, `?lanes=1`, `?plan=…` — and there was no `localStorage` anywhere in the app, so this introduces a second mechanism for what looks like the same kind of state. The distinction that justifies it: **a URL is shareable, and collapse state should not be.** Everything in the query string is worth sending to someone; a link carrying `?collapsed=quiet,done` would rebuild the recipient's view as a side effect of "have a look at this". Persistence itself is not optional — this board is left running and reloaded several times an hour, and without it the reader re-configures the view every time.

  **NOT STARTED now sorts by waiting age, freshest first.** The row sort ordered every group by **commit** age and coerced a missing age to `-1`. NOT STARTED rows have no commit — their clock is `waitingDays`, from the plan's `Approved:` record, which the sort never consulted — so every row in the group tied at `-1` and the order was whatever the scan happened to produce: `feature/plot-sprint-support`, waiting since February, sat among branches approved minutes earlier.

  The direction **inverts for this group only**. Elsewhere old means neglected and belongs on top; here it means _nobody wants it_ — six months of availability is evidence of that, not urgency — while a plan approved minutes ago is the one still in the reader's head and the one a dispatch is likely to pick up. Undated rows lead: they have just arrived and have not yet been ignored by anyone. The inversion is confined rather than made general, because a rule that flips direction depending on where it is applied is two rules wearing one name — and applying it globally would silently reverse `quiet`, the group that most needs oldest-first.

  **Row actions move into a three-dot overflow menu** at the right edge. `Start work` sat at the far right _after the age_, so the line read _what · state · age · act_, with the action behind the quietest number on it — and it is about to stop being alone. The menu holds only things that **change** something; navigation stays in the row, where the thing is named, because a `cmd`-click on a real link is worth more than a tidier line.

  **A row with no available action renders the menu disabled**, a deliberate exception to this estate's rule against greyed-out controls. The distinction is what a control _claims_: a dead `Start work` lies about an action that does not exist here, while a dimmed three-dot menu says only _this is where actions would be_, which is true on every row. The layout argument decides it — with most rows carrying no action, rendering nothing would leave the right edge ragged **and moving**, since the pulse re-scans every five seconds. It uses `aria-disabled` rather than the native attribute, so the control stays focusable and the `title` explaining why — in the row's own words, _blocked by an earlier wave_, _no commit for 22 days_ — stays reachable without a mouse.

- [#147](https://github.com/plot-pm/plot/pull/147) [`6d7fd59`](https://github.com/plot-pm/plot/commit/6d7fd595fdbb091e6d98f26261af3e650ebb5953) Thanks [@jwloka](https://github.com/jwloka)! - An agent row now says which phase its work is in, and a shelved branch says it was shelved.

  The Agents tab grouped rows by what they _wait for_ — and every one of those groups is decided by time. That answers _is anything moving_ and cannot answer _moving on what_. A human still drafting a plan and an agent building against it read identically, and NOT STARTED could not tell _ready for someone to pick up_ from _no branch tip we can date_.

  **The phase replaces the repo cell.** Not a seventh cell: the row already wraps on a branch called `feature/opus5-hardening-challenge-budget`. The repo is the right thing to give up — constant in a one-repo board, rendered nowhere else in the app, and a column showing the same word on every row is chrome that never varies. Wider than the repo's `w-16`, which fits 8–9 characters: "Development" is 11 and would have rendered "Developm…".

  **The word is spelled out.** Initials cannot carry it — Discovery, Design and Development all begin with D, and `DE` covers two of them — and neither can the existing phase icons: `PHASE_LEADERSHIP` maps 👤 to three of the five phases, because it encodes _who leads_ rather than _which phase_. The cell also carries an `sr-only` label, because this list is a `<li>` of `<span>`s with no table semantics: column position conveys nothing to a screen reader, and `Development` does not announce itself as a phase the way `plot` happened to read as a repo name.

  **A `deferred` badge, beside the state rather than instead of it.** The phase has already fallen back a step for a handed-back branch, and a bare _Design_ row is indistinguishable from one nobody ever started. The badge carries the half the phase cannot: this did not fall back because nobody began it, but because someone gave it up.

  **Start work reaches the rows that can actually be started.** The button already existed on plan cards; nothing new is built. It appears only on `not-started` rows an earlier wave does not block — a button on a blocked row would offer to skip the ordering waves exist to express, and `plot-dispatch` refuses that branch anyway, so the board would be inviting an action the tool declines. No greyed-out control either. A row whose plan has no board card gets no button rather than a broken one.

- [#175](https://github.com/plot-pm/plot/pull/175) [`5ab8463`](https://github.com/plot-pm/plot/commit/5ab8463b073eb14494ffb059ecfbd4eb77205a05) Thanks [@jwloka](https://github.com/jwloka)! - The agent row becomes a real grid, and the PR cell renders from fields rather
  than from a sentence.

  Four rows in WAITING ON YOU, and no two of them agreed on where anything sat.
  Only three cells had a width — phase, age and the action menu — while plan and
  branch were content-sized and `ml-auto` on the note shoved everything from there
  to the right edge. So the slack collected _between_ branch and PR, and the
  branch started wherever the plan cell before it happened to end.

  **Six fixed tracks: phase, plan, branch, PR, age, menu**, with the branch on
  `1fr` because it is the longest and most variable value and the one worth
  reading in full. **An empty cell now leaves a gap rather than shifting its
  neighbours** — which is the whole point: a row with no phase aligns on branch
  with one that has a phase, and a row whose plan name sits in the group heading
  aligns with one whose does not. That second case is the one `showPlanHeading`
  introduced an hour earlier, where two rows in the same section differed by a
  whole cell.

  **Overflow elides the MIDDLE, keeping both ends.** Branch names here share long
  prefixes and differ at the tail — `feature/opus5-hardening-…` covers six
  branches — so end-truncation renders all six identically, which reads as six
  duplicate rows rather than as truncation. The head clips and the last twelve
  characters are pinned, so the browser decides where the fold falls at whatever
  width the column has; the full name stays in `title` and in the accessible name.

  **Table semantics, without a `<table>`.** `role="grid"` on the list, `role="row"`
  and `role="gridcell"` on the cells, and an `sr-only` header row carrying
  `role="columnheader"`. The rows carry interactive controls and sit inside a
  collapsible group structure with per-plan sub-headings, which table markup would
  fight rather than serve. The phase's `sr-only` prefix goes with it: it existed
  because _"column position conveys nothing and each row is heard as a run of
  words"_, and that stops being true. It survives below `sm` and only there, where
  a card has no columns for a header to name.

  **The PR cell reads `{ number, url, draft, state }`** — the fields wave 1
  delivered — instead of searching `row.note` for `PR #<n>`. That search was a
  parser for a format nobody declared: it silently rendered an unlinked note the
  moment the server's wording drifted, and could not produce a badge without
  taking the sentence back apart. `draft` and `state` render as two badges, never
  one folded into the other. The git host's own PR glyph replaces the word `PR`,
  never the state — the number stays, the state stays as a word, and the glyph
  carries an `aria-label`, since a bare `157` announces nothing. `unknown` renders
  nothing at all: a word saying only _this board could not find out_, stamped on
  every row of a host that carries no rollup, is noise.

  **The note keeps everything a PR state cannot say** — _uncommitted work_,
  _blocked by an earlier wave_, _claimed elsewhere_. It is relieved of one duty,
  not replaced. The server still composes `PR [#158](https://github.com/plot-pm/plot/issues/158), conflicts · awaiting review`,
  so the row drops the leading PR clause when the fields already carry that same
  number; a note it does not recognise is printed in full, which costs a duplicated
  word rather than a lost link.

  **Below 640px the row becomes a card**, because this is what the grid takes
  away. The tab had zero responsive breakpoints and its only concession to a
  narrow window was `flex-wrap` — which works precisely because _nothing depends
  on the position_. A grid inverts that. Measured: the fixed tracks need 544px
  before the branch gets a single pixel, and a 375px phone is 169px short. So each
  row becomes a small block, branch on its own line with plan, phase, PR and age
  wrapped beneath. **Nothing is dropped and nothing is elided** — dropping the
  plan name was the cheaper answer and would re-open, at one width, the defect
  `showPlanHeading` closed at every width.

  The branch name carries an explicit `aria-label`, which the plan did not
  anticipate. The fold renders as two flex items, and the accessible-name
  algorithm joins adjacent boxes with a space: the row announced
  `feat ure/reviewed`, a branch name no host would recognise and no reader could
  search for. The fold is a fact about the column's width, so it belongs to the
  visual channel alone.

  <!--
  bumps:
    skills: {}
  -->

- [#172](https://github.com/plot-pm/plot/pull/172) [`3a1e9ac`](https://github.com/plot-pm/plot/commit/3a1e9acc568be59c37b97df6dce018030b704cd5) Thanks [@jwloka](https://github.com/jwloka)! - **The last good pulse now survives a restart.** Until now a restarted board
  served `0 branches across 0 plans` — an empty view, not a stale one.

  Measured on 2026-08-17 with five agents in flight, three of them editing files
  under `packages/board/`. The operator's board runs under `node --watch`, so
  every save restarted the server, and the Agents tab reported _"Last scan
  failed"_ over zero rows. The fleet view exists to make parallel work visible,
  and the more parallel work ran, the less it could show.

  **The cache was never the problem.** `fleet.ts` already keeps one entry per
  repo, every request reads it, and the scan refreshes it asynchronously — which
  is why the tab polls at 4 s without running a scan per request. That design is
  right and is unchanged. It is _process memory_, and a `--watch` restart takes it
  with the process: a freshly started board has no cached pulse, so the _degrade,
  do not hide_ behaviour from [#141](https://github.com/plot-pm/plot/issues/141) has nothing to degrade **to**. The banner
  worked perfectly and named the exact failing command; there was simply no
  last-good payload behind it.

  So the in-memory cache gains a copy on disk at `.plot/state/last-pulse.json`,
  written on each successful scan, read once at startup, and served through the
  rendering that already exists — the banner, the `(frozen)` footer, the stopped
  clocks from [#141](https://github.com/plot-pm/plot/issues/141), the dimming from [#160](https://github.com/plot-pm/plot/issues/160). No second vocabulary for _these
  numbers are old_.

  **The file is read AND a scan is issued at once**, because neither closes the
  window alone. A scan costs 500–1050 ms (21.2 s measured on a cold boot), so
  rescanning at startup narrows the empty window without closing it — and a
  restart storm reopens it on every save. The file alone is the mirror failure: it
  would leave the board stale until the next poll. The file covers the gap, the
  scan ends it, and a completed scan overwrites every bridged field.

  **A bridge, not a store, and the distinction is load-bearing.** Plot derives
  state from git (Principle 1), and a JSON file that outlives its usefulness is a
  second source of truth that can disagree with the repository. Past fifteen
  minutes the honest answer is _no data_ — which is what the board says today and
  is correct once the numbers describe a repository state that has moved on. A
  payload stamped in the future is refused for the same reason: a clock that ran
  backwards would otherwise read as the freshest possible answer.

  **One-directional, like every other signal here.** A scan that succeeds replaces
  the file immediately; a scan that FAILS does not touch it. A failure must not
  destroy the last good answer, which is the only thing standing between a restart
  and an empty board.

  The file is machine-local by construction — it describes this machine's refs and
  worktrees — so `.plot/state/` is gitignored while the rest of `.plot` (briefs,
  templates, the review hold) stays committed. It is re-validated through
  `FleetPulseSchema` on read rather than trusted, because it may have been written
  by a different build; anything unreadable, unrecognised or expired reads as no
  bridge at all, which is exactly today's cold start.

  Asserted across an **actual process restart**, never a cleared in-memory map:
  the map is already correct, and its loss on restart is the entire defect.

  <!--
  bumps:
    skills: {}
  -->

- [#160](https://github.com/plot-pm/plot/pull/160) [`028af50`](https://github.com/plot-pm/plot/commit/028af5074dd4034e12fa879e12d07ea225232f35) Thanks [@jwloka](https://github.com/jwloka)! - **A frozen board now stops inviting, not just lying.** `board-shows-staleness` made the page admit its numbers were old — a banner, `(frozen)` in the footer, stopped clocks. It did not finish the job: rows kept full contrast, links kept their affordance, and the row action menu kept offering `Start work` on data minutes old. A reader who scrolled past a single banner was looking at a control surface behaving exactly as it does when everything is fine.

  The distinction is between **information** and **posture**. The banner says _these numbers are old_. What was missing is _do not operate this right now_.

  **Two escalating states.** The banner still comes first and alone. After a sustained silence the page dims, blocks interaction with the board, and names the way out.

  **Counted in missed polls, not seconds.** The two tabs poll 7.5× apart — `POLL_MS` 30 s against `FLEET_POLL_MS` 4 s — so one seconds-threshold means _seven and a half missed polls_ on one tab and _a single one_ on the other: it would dim on the first hiccup in one place and only after a real outage in the other. Counting consecutive failures keeps the statement identical on both, and survives someone changing an interval later.

  **The threshold is eight, and it was measured rather than guessed.** `pnpm board` runs under `node --watch`, so an ordinary edit restarts the server and the tab loses contact several times an hour. Five real restarts were timed on the implementing machine by touching the watched artifact and polling every 50 ms: the server was unanswerable for 3.1 s, 4.5 s, 5.1 s, 5.8 s and 9.1 s (median 5.1 s), and a cold boot took 21.2 s. At the fleet's 4 s poll those cost at most 3 and 6 consecutive failures. Eight clears the worst of them, so the case that happens several times an hour never triggers the case that means something.

  **Both tabs, which meant unifying two error models** — the largest part of this, and a behaviour change rather than an addition. Silence was measured for the Agents tab only, and the two tabs answered the same outage in opposite ways: Agents kept its rows, while the Board tab set an `error` string and **replaced its cards** with a red message, discarding a payload it still held. The Board tab now gets the newer _degrade, do not hide_ treatment. One outage no longer produces two different stories depending on which tab is in front.

  Five further decisions, each reached by discarding the obvious answer:

  - **A server that answers badly does not dim.** HTTP 500, malformed JSON, `{ error: … }` — it is alive and speaking, so _no contact_ would be plainly wrong and a restart hint would be the wrong advice. The existing error path keeps that case, and a bad answer resets the silence count rather than accumulating toward an overlay telling the reader to restart something already running.
  - **Blocked means interaction with the BOARD.** Reading needs no clicks, so reading never stops: scrolling, selecting and copying a branch name keep working, and the rows stay legible underneath. The overlay's own message and command stay usable, because blocking the way out would be a dead end with a lock on it. An already-open plan modal stays usable — it is a layer above the board and has its own error path; opening a _new_ one is board interaction and stops.
  - **Blocked actions stay visible and `aria-disabled` with the reason**, never removed. Vanishing buttons make the layout jump twice, on loss and again on recovery. `StartWorkButton` moved off the native `disabled` attribute for this: a natively disabled button leaves the tab order, taking the control _and_ its explanation out of reach of exactly the reader who cannot see that the page has dimmed. The row action menu also now refuses to **open** when the server will not act — it previously keyed only on whether the row was startable, so on a frozen page the three-dot menu still opened and still offered `Start work`. A scrim cannot cover that gap, because a keyboard reader never touches a scrim.
  - **The command and port come from the server**, travelling with the last successful poll via a new `server` field on the board document, read from the project's own `## Plot Config` under a new `Board command` key. `pnpm board` is _this_ repo's convention and Plot hardcodes no project conventions (Principle 5) — an adopting project would otherwise be handed advice that does not work. A project declaring none gets no command rather than a guessed one. The overlay names the port _this page was served from_ and never probes others: a page that guessed could attach itself to a different project's board.
  - **Returning to a backgrounded tab re-checks rather than counts.** Browsers throttle hidden timers, so a minimised window would otherwise come back holding a count assembled from however often it was allowed to wake. Visibility returning issues a poll: it either succeeds and the overlay goes, or it fails and the overlay is honest.

  Pinned by 25 browser tests against the shipped artifact, each written against an assertion a weaker implementation passes without — one failed poll dimming nothing, both tabs dimming after the same _number_ of failures, the Board tab reaching the state at all, the 500 and malformed-JSON cases staying clear, the overlay's own command being clickable and selectable while the board's controls are not, and the command and port round-tripping from a payload that names neither of this repo's defaults.

  **A plan heading is now earned per group, not per section.** Unrelated to the dimming and folded in because it lives in the same file: `showPlanHeadings(rowCount, planCount)` asked _should this section have headings at all_, so once any group in a section earned one, **every** group got one — including a plan holding a single row, whose heading labelled the one line beneath it and charged a line of height to repeat what that line already said. A section of one-row plans became a stack of alternating headings and rows.

  `showPlanHeading(group)` replaces it and asks the narrower question: a heading pays for itself by saving repetition, so it appears above two or more rows of one plan and nowhere else. Both clauses of the old rule are subsumed — the second IS this rule counted per group instead of summed across the section, and the first (two plans, one row each) turns out to be a case where headings are not wanted at all.

  The half that is easy to lose: a group without a heading has nowhere else to name its plan, so **its rows print the name themselves**. Heading and row now read one shared answer per group rather than computing it twice, which is how they would drift — a heading rendering while its rows also print the name says it twice; the reverse loses the name entirely. Pinned by a mixed-section test (one plan with several rows beside a plan with one), the case a section-wide answer cannot express, asserting both that the lonely row carries its plan name and that the headed rows do not repeat it.

  **Not covered, deliberately:** the IPv4/IPv6 case, where the server listens on `[::1]` and the browser resolves `127.0.0.1`. No overlay helps there — the document never loads — and it is recorded as a separate finding.

  <!--
  bumps:
    skills: {}
  -->

- [#148](https://github.com/plot-pm/plot/pull/148) [`6bd1804`](https://github.com/plot-pm/plot/commit/6bd1804b8571b3aebc62d2cbdb7fcd39dce851bb) Thanks [@jwloka](https://github.com/jwloka)! - A `working` row now shows that it is working — the board's first animation.

  **The Agents tab exists to show work in flight and rendered like a table of records.** A branch an agent was editing right now looked exactly like one nobody had touched for 22 days: same weight, same stillness, different text. The reader had to _read_ to find out that anything was happening. Measured before changing anything: the board contained **no animation at all** — not a transition, not a pulse, no `prefers-reduced-motion` block — so there was no existing convention to follow, and this becomes the first one.

  **One animation for the whole group, never graded by confidence.** `WORKING` has three entrances of differing strength — `uncommitted work in a local worktree` (files edited on this machine, the strongest evidence there is), `last commit 3 min ago`, and `claimed, no commits yet` (an agent reading the plan, or one that never started). Grading the animation by which one applied was considered and rejected: **group membership IS the statement, and it is true for all three.** Each is a reason the fleet considers the branch live, and the note beside the row already says _which_ reason — so a second vocabulary made of speeds would encode in motion what the text states plainly, while being unreadable in isolation and invisible in a screenshot, which this board takes seriously enough to have written into its rule for colour. A confidence-graded implementation passes a test that checks only one of the three notes, so all three are asserted to render _identically_ — same animation, same duration, same box.

  **A pulsing dot, not a spinner**, on a plain count: `WORKING` regularly holds several rows (four agents ran in parallel on 2026-08-16), and four rotating spinners in a column is flicker, not information. Rotation also implies _progress toward completion_, which nothing here measures; a pulse implies _aliveness_, which is exactly the claim being made. It sits **before** the row rather than inside the note, because the note is where the row states its facts and motion there competes with reading them — a leading dot needs no column of its own and scales from one row to eight.

  **What the animation claims is narrow and true by construction:** that the row is in `WORKING`, re-derived every scan. It stops the moment the row leaves the group, which is exactly when the work stopped or moved on — asserted across a state change rather than on a static fixture, because that self-stopping is the whole honesty of it and a fixture-only test passes on an implementation that never re-evaluates. This is deliberately unlike the countdown that kept ticking after its server died (fixed in `board-tells-the-truth`): that asserted a _specific future event_ that was not coming.

  **Reduced motion is built in, not retrofitted, and both halves matter.** `prefers-reduced-motion: reduce` disables the animation and **leaves the dot visible** — removing the element would satisfy "no motion" and lose the marker along with it. The reason is not politeness: motion triggers nausea for some readers, and this view is meant to be left open on a second screen. Tailwind's own `animate-pulse` with `motion-reduce:animate-none` carries it — no new CSS file, no keyframe of our own, and the reduced-motion variant arrives with the utility rather than needing its own media query. Smallest possible way to introduce a first animation.

  **No visibility handling.** A pure CSS animation costs effectively nothing and browsers already throttle background tabs; pausing it through the Page Visibility API would add a mechanism for a problem the platform solves — and the poll cycle, which is the expensive part, keeps running anyway.

  **The dot is `aria-hidden`.** A screen reader already gets the group heading and the row's own text, so the animation is decoration on top of information and never the carrier of it — the same rule the contract sets for colour (_carried as a symbol AND a word, never as colour alone_). The row is asserted to stay fully legible with motion off: group, note and age all unchanged.

  Two negatives are pinned because a naive implementation passes without them: rows in **every other group hold still** — including a `quiet` row that also carries a fresh claim, since the group is what decides and not the note or the age — and an **empty `WORKING` group animates nothing**, trivial by construction today but asserted so nobody later moves the animation to the group header, where it would run against zero rows.

  <!--
  bumps:
    skills: {}
  -->

### Patch Changes

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: a live worker keeps its row in WORKING

  Measured 2026-08-17: two agents ran for a quarter of an hour with WORKING
  empty, while WAITING ON YOU showed their branches. Both sections were
  lying, in opposite directions.

  Two rules were responsible, and neither was wrong on its own:

  - The running-worker verdict lived inside the `state === 'claimed'` arm.
    A worker's first real commit takes its branch out of `claimed` — so the
    row **lost its place in WORKING at the moment it proved it was
    working**. It now sits beside the other three worker verdicts, covering
    every unmerged state. `merged` still excludes itself: a branch that
    landed is done whatever its worktree holds.

  - The PR arm answered before any worker question. Right for a PR that is
    a person's errand — conflicts, failing checks, no checks, a state the
    host cannot read — and wrong for the rest: an agent that opened its PR
    and kept working was pulled out of WORKING by a green PR that asks
    nothing of anybody. A running worker now overtakes that arm **only**
    where `prAsksNobody` holds.

  `prAsksNobody` is an allowlist — `green` or `pending`, plus a draft,
  which is still the agent's own. A blocklist of errand-states would
  silently start claiming "nobody is blocked" the first time a state was
  added, which is the direction that fails quietly.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#173](https://github.com/plot-pm/plot/pull/173) [`ecb8351`](https://github.com/plot-pm/plot/commit/ecb835199e4d93fb63980814195faf6c7655c05c) Thanks [@jwloka](https://github.com/jwloka)! - `Start work` and `Approve` now really do refuse a second click inside one tick — and there is finally a test that says so.

  **The test came first, and it came out RED.** Both buttons carried a comment claiming a double click could not fire two runs, and both implemented it by reading a value derived from `useState`: `const blocked = starting || !dispatch.available`, checked in `onClick`. `setState` does not take effect until the next render, so two clicks in one tick both read `idle` and both called `fetch`. Nothing in this repo had ever checked that, on either button — so the first thing written here was the assertion, not the latch, and it failed with **two POSTs where one was asserted, on both buttons**. Writing the fix first would have made a green run unreadable: it could not distinguish a real defect caught from React's batching having covered it all along.

  **Two clicks in ONE TICK, not two awaited clicks.** Playwright's `locator.click()` waits for actionability between calls, which hands React a render in between and makes `blocked` true by the second — the defect is invisible that way, which is very likely why it survived this long. The test dispatches both events from a single synchronous block inside the page, which is what a fast physical double click delivers to the handler.

  **A `useRef` latch, because a ref changes synchronously.** The second click of a same-tick pair sees the flag already set. `blocked` **stays**: it carries the _other_ refusals — no dispatch binding, a non-localhost host — and those answer _may this act at all_, a different question from _is one of mine already running_. Both are asserted: a board bound to `0.0.0.0` still refuses every click on both buttons, and posts nothing.

  **The latch releases where the STATE does, never in a `finally` beside the fetch.** The button stays pending until the pulse confirms or the poll answers; a ref released when the request returned would re-arm it while it still reads `starting…` — clickable again behind a label saying it is busy. Pinned as its own assertion, since a `finally` passes the same-tick test and reintroduces the defect one beat later.

  **On `Approve` the guarded click is the SECOND one.** The first click arms and posts nothing by design, so the pair that fires two merges lands on the _armed_ label. A latch on the idle click would guard the wrong transition and pass a test that only clicked twice from idle.

  **Local only, no server-side in-flight registry.** A second browser tab is a different question with a different answer — git holds the claim for dispatch, and the host refuses a second merge — and an in-flight registry would be state the board does not otherwise keep. This fixes the case that produced the report: one person, one tab, two clicks.

  The pairing that matters is asserted too: **a slow single click still works.** A latch that never releases passes every same-tick assertion above and breaks the button completely.

  <!--
  bumps:
    skills: {}
  -->

- [#198](https://github.com/plot-pm/plot/pull/198) [`944f2bb`](https://github.com/plot-pm/plot/commit/944f2bb5590ea2722524c6f7aede441a6ab82716) Thanks [@jwloka](https://github.com/jwloka)! - The artifact resolver now distinguishes _nothing observed_ from _other files_, merges only in a worktree that is idle, and does not repeat a `not-observed` refusal every pulse.

  **An empty conflict set is not a small one.** Measured live on 2026-08-17: a row read `artifact conflict — conflicting: skills/plot/scripts/board/board-server.mjs`, and beneath it `repair refused — not-artifact-only`. The classification and the refusal contradicted each other, and the classification was right — one file, and it was the artifact. The resolver's log said why: it reused a worktree in which no merge was running, so `git diff --diff-filter=U` returned nothing. It found zero paths, compared zero against one, and concluded _not artifact-only_.

  Formally correct; factually inverted. **Empty there does not mean "other files", it means "I did not look."** The rule that produced it was correct and deliberate — that wave was told never to act on a host verdict without an observed conflict set — and the same test, applied to a set it never gathered, refused the one repair it was built to perform.

  So the two refusals are named apart, because `not-artifact-only` asserts something about the files that conflicted and a set of zero has none to assert it about:

  | Conflict set         | Meaning              | Resolver                    |
  | -------------------- | -------------------- | --------------------------- |
  | exactly the artifact | the licensed case    | repair                      |
  | other files present  | needs judgement      | refuse, `not-artifact-only` |
  | empty, no merge ran  | nothing was observed | refuse, `not-observed`      |

  A conflict is not the only thing that ends a merge non-zero: a merge that never _started_ — blocked by a dirty worktree, by a merge already in progress, by a ref that would not resolve — exits non-zero too and leaves nothing behind. The assertion is on the reason string rather than on the refusal, since a refusal naming the wrong cause sends the reader to look for files that were never examined.

  **The resolver no longer merges in a worktree someone else is working in.** Measured at the same moment as the refusal above: zero unmerged paths, three modified files, an agent working in it — and the resolver ran `git merge` inside it anyway. It refused before writing anything, but that was luck rather than design. Reuse is right when a worktree is idle, and the name alone does not say so; a worktree carrying modifications now refuses as `worktree-busy`, which the plan names the honest minimum. Untracked files are deliberately not counted: a stray log is not work in progress, and `merge` does not touch it — a fence counting every difference would refuse repairs for no reason.

  **Retry when the input changes, not when the clock ticks.** The pulse fires every 5 s and the branch stays `artifact-conflict` throughout, so a refusal leaving the input untouched was restarted by the very next pulse — five identical log entries, one per pulse, each reaching into the same worktree, none carrying information the one before it lacked. A `not-observed` refusal is now remembered against the input that produced it and not retried until that input changes.

  Scoped to `not-observed` alone, and the scope is the argument rather than a convenience: `tests-failed` and `build-failed` depend on a suite, `push-failed` on a remote that moves, `worktree-busy` and `already-in-flight` on state that clears the moment their owner finishes. Suppressing any of those would be a repair never retried after the world fixed itself. `not-observed` is the one whose cause lies entirely inside its input — nothing was read, and re-reading the same input reads nothing again. A run whose log could not be read is never suppressed either: the exit code cannot tell one failure from another, and suppressing on that guess would silence repairs that should retry.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: NOT STARTED reads as a tree, not as a list of rows

  Three reported defects, one cause: a plan and its branches are one block
  on this board, and the markup treated every row as its own unit.

  **The separator divided the wrong pair.** Every row drew its own rule —
  the plan row included — so the line fell between a plan and its first
  branch, and no line fell between one plan and the next. Each visual
  block therefore held one plan's branches and the _following_ plan's
  heading. `last:border-0` could not save it: a plan row is never the last
  child of its own group. The rule now belongs to the group.

  **The phase was on the wrong row.** It is a property of the PLAN that a
  branch inherits, so the branches repeated one word down a column while
  the plan row left the cell empty. That emptiness rested on an argument
  that has expired — _"Approved for everything in this section"_ — which
  stopped being true when the section learned to hold Draft plans:
  `Discovery` and `Design` now sit side by side, and they are the
  difference between _needs your approval_ and _ready to start_.

  **So did the waiting clock.** Every branch of one plan shares one
  `waitingDays` — it dates the plan's own `Approved:` record — and
  repeating it says one number three times.

  Only the INHERITED clock is suppressed. A deferred branch keeps its own
  `ageMinutes`: an earlier version of this section erased a shelved
  branch's age and PR, and `fleet.ts` still carries the warning. A property
  of the plan is repetition; a property of the branch is information.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#200](https://github.com/plot-pm/plot/pull/200) [`75d15a1`](https://github.com/plot-pm/plot/commit/75d15a103bc038b8c4da2e869b1100962d05e6c3) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: a transport failure exits non-zero instead of answering NONE

  `gh` exits 1 both when a branch has no PR and when the host cannot be
  reached, and the adapter caught both with one `|| echo '{"state":"NONE"}'`
  — so a caller could not tell _this branch has no PR_ from _I could not
  ask_. On 2026-08-17 GitHub returned 503 for an afternoon and every branch
  read as having no PR: wrong in the reassuring direction.

  The exit code cannot separate them (measured: both are 1), so the CLI's
  own stderr decides. A recognised miss phrasing — or no message at all,
  which is what a miss looks like through a CLI that does not explain
  itself — answers `NONE` and keeps exit 0. Everything else prints the
  host's words on stderr and exits 3, with nothing on stdout.

  An allowlist of miss phrasings rather than a blocklist of failures: a
  blocklist goes stale into silence the first time the CLI rewords itself,
  and silence here is indistinguishable from a branch that has no PR.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#174](https://github.com/plot-pm/plot/pull/174) [`9e22819`](https://github.com/plot-pm/plot/commit/9e22819d3abea138825e3e66e17c2e95b7e86f91) Thanks [@jwloka](https://github.com/jwloka)! - `Start work` now watches the count its own click moves, so a dispatch on an already-started plan reads as success instead of _no change — see log_.

  **The click always worked; the report on it did not.** A user said _"Start work on `feature/agent-rows-line-up` doesn't do anything"_, and every signal said otherwise: `dispatch.available` was `true`, the fleet scan said the wave was _eligible_, and `plot-dispatch --dry-run` said _would dispatch_. What failed was the success check. The button watched `card.started` — and **that flag describes the PLAN while the action starts a BRANCH**. A three-wave plan is `started: true` for ever after its first dispatch, so the flag the button was waiting on could never change again; three pulses later it reported _no change — see log_ about a dispatch that had prepared a worktree and pushed a claim.

  **The button is on that card deliberately, which is why the defect was permanent rather than occasional.** `isReadyToStart` demands Design-and-unstarted, but a second condition admits started Development cards: the button exists to start the **next** wave as well as the first. Two jobs, and a success check that served only the first — so every plan with more than one wave broke from the second click onward.

  **It now watches `waveSummary.claimed`.** Claiming a branch is exactly what a dispatch does, and unlike `started` the count moves on every wave. The comparison is `>`, not `!==`: claims are reaped when a branch merges, so a falling count is normal operation and not a success.

  **Still DERIVED, never asserted.** What changed is _which fact is read_, not whether git confirms it. The pulse still re-reads the refs and the row still travels on its own — an optimistic update would make the board display something it does not know.

  **`no change — see log` gets its meaning back.** It used to fire whenever a plan was already started, which was most of the time, so a message meant for _the dispatcher declined and here is why_ had been reporting successful dispatches instead. It is rare again, and rare is what lets it be believed — asserted in both directions, because a fix that simply stopped showing the message would pass every success test and delete a true signal.

  **A plan with `eligible: 0` refuses before the click**, naming the reason, rather than accepting and going quiet for three pulses. Same rule the row action menu already follows.

  **Without a pulse the button refuses rather than guesses.** Both counts are `.optional()` in the contract — _"Absent when there is no pulse"_ — so swapping `started` for `claimed` trades an always-present fact for a sometimes-present one, and the gap falls exactly where someone opens a freshly restarted board. It dims and says it is waiting for the first fleet scan: without a scan the board does not know which wave is eligible, so a dispatch would be a click into the dark that it could not report on afterwards either. Absent is treated as **unknown, never zero** — a first scan arriving with `claimed: 5` is the board learning what was already true, not five branches claimed by one click.

  **It deliberately does NOT fall back to `card.started` when the counts are missing.** That was the tempting fix and the worse one: it keeps the defect alive in precisely the window where it is most likely, hidden behind an apparently-working button. Asserted as its own test, because a fallback passes every other assertion here.

  A plan with no waves at all still lets the click through — no `waveSummary` is a pre-wave plan rather than a missing pulse, and `plot-dispatch.sh` is the authority there, refusing in its own words rather than having the board keep a copy of its preconditions.

  The `useRef` latch that pins the double click is untouched: it answers _is one of mine already running_, a different question with a different answer.

  <!--
  bumps:
    skills: {}
  -->

- [#202](https://github.com/plot-pm/plot/pull/202) [`11da9ea`](https://github.com/plot-pm/plot/commit/11da9ea5b899c21f93390558d7e1fb7950a52535) Thanks [@jwloka](https://github.com/jwloka)! - board: the PR error shows the whole path

  `slice(0, 80)` cut the failure message mid-path, and cut it **silently**:

  ```
  Command failed: bash /Users/…/plot/skills/plot/script
                                                      ↑ no ellipsis
  ```

  `…/skills/plot/script` reads like a filename and names a file that does
  not exist, so a message whose only job is to point at a cause pointed at
  a fiction. Measured cost: one wrong lookup before finding
  `plot-host.sh`.

  The limit is removed rather than raised — any limit moves the same defect
  to the next longer path — and the footer wraps instead. It costs a line
  of height on the rare occasion the board cannot reach the host, which is
  the one moment the reader is owed the whole sentence.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#133](https://github.com/plot-pm/plot/pull/133) [`091c91e`](https://github.com/plot-pm/plot/commit/091c91e7204ae0f126b7b138c37b84042ea99e34) Thanks [@jwloka](https://github.com/jwloka)! - Two display bugs in the Agents tab, both found by looking at the board rather than by a test.

  **`next in 0s`, permanently.** The git countdown subtracted `ageSeconds` from the client's poll interval — but `ageSeconds` dates the _server's_ scan (5 s timer) while the client polls every 4 s. One clock's age against another clock's interval is reliably negative, and the clamp turned that into a fixed zero. The server now reports `scanNextInSeconds` from the timer it actually obeys, exactly as it already did for the PR side; absent, no countdown is shown at all.

  While fixing it: both countdowns now test with `== null`, since a payload that never passes through the schema sends `undefined` and `undefined - tick` renders `next in NaNs`.

  **A plan name printed on every row.** `plans.length > 1` suppressed the sub-heading for six QUIET rows of one plan, so its name appeared six times down the column — more chrome than one heading above six shorter rows. But `rows.length > plans.length` alone breaks the mirror case: two plans with one row each separate nothing and would run together unlabelled. A heading earns its place when it **separates** plans _or_ **saves** repetition, so it needs both counts. Where a heading names the plan, the rows below no longer repeat it.

  The rule is now a named function with unit tests for all four shapes, and the countdown gained the negative test its PR counterpart already had.

  <!--
  bumps:
    skills: {}
  -->

- [#141](https://github.com/plot-pm/plot/pull/141) [`731f6c5`](https://github.com/plot-pm/plot/commit/731f6c5bf21b407ae477faeb20f67a96d9c97419) Thanks [@jwloka](https://github.com/jwloka)! - **A board whose server has died now says so.** Until now it looked exactly like a working one.

  The Agents tab had no rendering at all for a failed fetch. `AgentList` read `fleet.error` only to choose the pre-first-scan message; after the first successful scan the error state was unrepresented, and the tab kept drawing its last payload — with a countdown clamped at `next in 0s`, which reads as _about to refresh_, and ages that went on advancing against a scan that had stopped happening. The sibling Board tab reported the outage while Agents hid it.

  It cost a real misdiagnosis on 2026-08-16: two screenshots were reported as regressions ("the heading is still there", "the plan link is still missing"), and neither was true on the live board — both were the frozen last render of a page whose server had stopped. Three hypotheses (stale bundle, JSX guard, minification) were spent before anyone checked what was actually running.

  **The failure that had no vocabulary.** `fleet.error` is the server _answering_ to say its own scan failed — a payload arrived, saying so. A dead server answers nothing, and no field inside a document the client never received can report that. So the signal now comes from where the fetch happens: `App` records when `/api/fleet` last answered and whether it has failed since, and passes the silence to the tab as `staleSeconds`. The two failures render as separate banners, because they send the reader to check different things and both can be true at once.

  Four decisions, each reached by discarding the obvious answer:

  - **The first failed fetch is enough** — no two-strikes rule. The outcomes are not symmetric: a hiccup shows a banner that clears itself four seconds later, while a dead server that looks healthy for two poll intervals costs a diagnosis.
  - **It recovers by itself** on the next successful fetch, with no reload. The polling never stopped, so the page can observe its own recovery; with a first-failure threshold, a "stale until reload" rule would strand the view on every hiccup.
  - **The first-load message stays separate.** _Waiting for the first fleet scan…_ is a different statement from _this data is old_ — one has never had an answer, the other has one it no longer trusts. Merging them would let an empty view claim staleness it cannot have.
  - **Degrade, do not hide.** The last payload stays on screen; it is still the best information available. What changes is the confidence around it — the countdowns disappear rather than freezing (a held number is still a prediction), the ages stop advancing and say they are frozen, and the banner reports how long ago the last answer arrived.

  Pinned by seven browser tests driving the shipped artifact, six of which fail against the old code on their own assertion — including the ones the plan called out as the ones a naive test passes without: on **one** failure, on the **recovery** and not only the failure, on the ages actually **freezing**, and on the first-load message staying distinct.

  <!--
  bumps:
    skills: {}
  -->

- [#136](https://github.com/plot-pm/plot/pull/136) [`85ac6fb`](https://github.com/plot-pm/plot/commit/85ac6fb1137ec9c5703276c86833f245a346ef31) Thanks [@jwloka](https://github.com/jwloka)! - An open PR whose branch no plan names now appears in the Agents tab.

  The pulse walks the branches a plan lists under `## Branches` — that is what makes it a fleet view rather than a branch listing, keeping `main`, release branches and stale worktree refs out. But a fix branch opened outside a plan carries the one thing the tab exists to surface, and could not show it: two PRs sat waiting to be merged while `WAITING ON YOU` read _none_, and the pulse reported 8 branches where origin had 20.

  Open PRs only. A merged PR with no plan is finished work, and admitting it would fill `done` with housekeeping nobody reads. No new host call either — the board already fetches every PR on its own slow timer, keyed by head branch.

  This also fills `WAITING ON A MACHINE`, which had never once been populated since the tab shipped. Its only entry is an open PR whose checks are running, and the branches carrying PR state were exactly the ones missing from the row set.

  <!--
  bumps:
    skills: {}
  -->

- [#164](https://github.com/plot-pm/plot/pull/164) [`12f424e`](https://github.com/plot-pm/plot/commit/12f424e9a73b8b5ab05e70e8af00e1f8c4ddf850) Thanks [@jwloka](https://github.com/jwloka)! - **Pins the mixed-section case for plan headings in a browser.** `showPlanHeading(group)` is already asserted per group in `test/unit`, but it is a pure function of a group — it cannot observe the row half of the same rule, and the row half is where a weaker implementation fails.

  The rule has two halves that must agree: a group of two or more rows earns a heading and its rows stay bare, while a one-row group earns none and its row must then carry the plan name **itself**. Decide the second half section-wide instead of per group — the obvious shortcut, since the heading half looks like it could be summed — and the lonely row loses its plan name with nothing replacing it. The unit test still passes; the reader is left looking at a branch with nothing saying what it belongs to.

  The new browser test holds one section containing both shapes at once (`beans` with three rows beside `lonely` with one) and asserts both halves together: exactly one heading, reading `beans(3)`; the lonely row carrying `lonely` as its own link; and the headed plan's rows not repeating the name. Verified to fail against the section-wide implementation, on the assertion that the lonely row keeps its name.

  Asserted on the plan **cell** rather than the row's text, because the branch is named `feature/beans-1` — a substring search for the plan name finds the branch and passes for the wrong reason.

  <!--
  bumps:
    skills: {}
  -->

- [#134](https://github.com/plot-pm/plot/pull/134) [`a93b906`](https://github.com/plot-pm/plot/commit/a93b9064947bec6ace806694e183bd9564d2d93b) Thanks [@jwloka](https://github.com/jwloka)! - `fleet.ts` no longer carries a literal NUL byte.

  It was the cache-key separator, and the choice is right — NUL cannot occur in a path, so it can never be ambiguous. Writing it as a raw byte rather than the `\0` escape is what cost: every line-oriented tool classifies the file as binary and then **answers nothing**. `grep` reports no matches without saying why; only `rg` names the reason. That cost three searches in one session which read as "not there" for constants present all along — and the obvious next move after such a search is to add code that already exists. Diffs and review views are blinded the same way.

  Behaviour is unchanged (`node` confirms the escape produces the identical byte), and a test now walks `src/` and `test/` for raw NULs. The gate was proven by putting the byte back and watching it fail.

  <!--
  bumps:
    skills: {}
  -->

- [#135](https://github.com/plot-pm/plot/pull/135) [`3a5f124`](https://github.com/plot-pm/plot/commit/3a5f1249fa3faaf122d45111dbc4d47070db19ab) Thanks [@jwloka](https://github.com/jwloka)! - Opening a Discovery plan no longer answers `Failed to load plan: HTTP 404`.

  Cards gained a second source when the board learned to read plans from prefixed branches, so a plan under PR review renders in the Discovery column. `/plan/<file>` kept resolving against the working tree alone — one consumer, two sources, and it saw half of them. The card sat on screen while clicking it failed.

  The plan viewer now reads either source. Branch plans come from git rather than a staged copy, since `collectBranchPlans` already carries the content and a request path has no business creating temp files. Traversal and unknown names stay 404, which the widened lookup makes worth re-asserting.

  <!--
  bumps:
    skills: {}
  -->

## 0.3.0

### Minor Changes

- [`f65e506`](https://github.com/plot-pm/plot/commit/f65e506c5ee16cdcc7e7a4efd9b8cd62c0de97d8) Thanks [@eins78](https://github.com/eins78)! - The Approved column splits into **Ready** (approved, no `Started:` record) vs **In progress** (has one) — Approved cards carry a `started` flag and render the matching badge. The plan-meta ceremony fields (`review`, `impl`, `approved_raw`, `started_raw`) enter the board's zod contract, and the story status vocabulary widens (`ready`, `in-review`).

## 0.2.1

### Patch Changes

- [#44](https://github.com/plot-pm/plot/pull/44) [`cee4d94`](https://github.com/plot-pm/plot/commit/cee4d94efbac12d56f5ed53aab250ce838580ba3) Thanks [@eins78](https://github.com/eins78)! - `@plot-pm/board` is now a self-contained npm package. It vendors Plot's plan-parser scripts (`plot-config.sh`, `plot-plan-meta.sh`) into the published tarball and bundles `zod`, so it declares zero runtime dependencies. You can now install and run the board with `npx @plot-pm/board` or `pnpm dlx @plot-pm/board` in any repository — including one pointed at a private or authenticated registry — instead of only from a Plot checkout.

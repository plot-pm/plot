# Safety lens — a complete page is not truncated (#912)

**Lens:** this plan makes a warning fire LESS often. The question is what breaks when it is wrong.

## Summary

The plan's *code* claims are true. Its **causal claim is false**, and that is the finding: the
warning this plan narrows **has no consumer at all**. Neither the board nor the scan reads it.
So narrowing it cannot fix the measured symptom on `quaweb-website`, and the plan's own
justification — *"the board discards the whole page"* — describes a mechanism that does not
exist on main. The real cause is a **second, independent** truncation rule in
`plot-fleet-scan.sh` that this plan does not touch.

The trade is therefore not "less noise for slightly more risk". It is "a real reduction in
one safety signal, for zero benefit, while the actual defect stays open".

## 1. Is every factual claim TRUE on main?

**TRUE, verified line by line:**

- `plot-host.sh:1818-1827` — the cited block is exact. `:1818` empty-page early return,
  `:1819-1822` the github arm, `:1823-1826` the bitbucket fall-through. The plan's quoted
  snippet matches the source.
- `plot-host.sh:1787-1790` — the GitHub reasoning is quoted correctly: *"a state is possibly
  truncated when it returned AT LEAST the requested limit… Fewer rows than the limit PROVES
  completeness."*
- `:1791-1795` concludes *"it can NEVER prove completeness"* — correct, and the plan's reading
  that this is true of the requested `--limit` and not of the host's page size is fair.
- The warning text does name a page size: *"bitbucket ignores --limit; bb returns a fixed page
  (50 at 1.0.0)"* — confirmed in `#333`'s body.
- "It does not touch the GitHub arm" — correct as scoped.

**FALSE / UNVERIFIED — the load-bearing claim:**

> **"The board discards the whole page rather than the rows it doubts, so a complete answer
> becomes no answer."**

This is **false on main**, and it is the plan's entire motivation.

`pr_list_report_truncation` (`plot-host.sh:1815-1827`) is a bare `echo … >&2`. It never
changes the exit code and never writes stdout. Both consumers then discard it:

- **The board.** `fleet.ts:2477` calls `hostSaid(['pr-list', …])`. The adapter at
  `packages/domain/src/adapters/scripts/scripts-shell.ts:88` reads:
  `if (run.code === 0) return { answer: 'answered', stdout: run.stdout };`
  **stderr is not in the returned object on the success path.** `fleet.ts:2483` branches only
  on `said.answer !== 'answered'`. The truncation line is unreachable to the board.
- **The scan.** `plot-fleet-scan.sh:675-676` captures stderr into `host_err`, but `:678`
  gates *all* use of it behind `if [ "$rc" -ne 0 ]`. On exit 0 the scan falls to `:746`
  `HOST_VERDICT=ok` and never inspects `host_err`.

`#333`'s own body says the same thing: *"the failure is quiet: **a stderr line the board never
surfaces**, then wrong rows."* The plan asserts the board consumed it and acted on it. The
issue it cites as its lineage says it does not.

**The plan's `<!-- Board impact -->` note — "the board consumes the warning this changes" — is
therefore wrong**, and it is the note a reviewer would rely on to skip checking.

## 2. Is the core inference sound?

**The abstract inference is sound. The applied one is not.**

Sound: *if* the backend's page size is known to be 50, then a page of 3 proves completeness by
the identical argument the GitHub arm makes. That reasoning is valid.

Unsound as applied: the plan infers that making this warning fire less will fix the measured
board symptom. It will not, because the warning feeds nothing. The symptom has a different
cause, and I found it:

`plot-fleet-scan.sh:867` holds a **second truncation rule that never calls
`pr_list_report_truncation`**:

```sh
if [ "$_pr_rows" -gt 0 ] && [ "$_pr_rows" -lt "$PR_LIST_LIMIT" ] 2>/dev/null; then
  printf '1' > "$HOST_STATE_CACHE/.list-complete"
fi
```

with `PR_LIST_LIMIT=1000` (`:620`). Its consumer is `:940-947`:

```sh
if [ "$ask" = "--ask" ] && … && [ -f "$HOST_STATE_CACHE/.list-complete" ]; then
  printf '%s' 'NONE'; return        # "Not in a complete list = no PR"
fi
```

Note the direction. On the measured repo, 3 rows < 1000, so `.list-complete` **is** written,
and branches missing from the page are declared `NONE` — *"commits, no PR ever opened"*. That
is the reported symptom, produced by a rule that is **already as permissive as this plan wants
to make the other one**. This plan's change is orthogonal to it.

So the two open PRs reading as "no PR" is most likely a join defect (head-name mismatch, a
state filter, `pr.state === 'OPEN'` at `fleet.ts:2510`, or the `--rich` bb arm at
`plot-host.sh:3025` mapping `head:.source.branch.name`), not a truncation warning. **The plan
diagnoses the wrong component.** Under the repo's own standard — *"six plans this week had
false premises"* — this is the seventh.

## 3. What does `Done when` fail to pin?

The `Done when` is unusually thorough about the *rule* and pins **nothing about the outcome**:

- **It does not pin the reported symptom.** Nothing asserts that a branch with an open PR stops
  reading `commits, no PR ever opened`. Every listed criterion can pass with the
  `quaweb-website` board unchanged — which, per §2, is what will happen. This is the
  "Can you answer 'did I complete this?' without doing the work?" test failing.
- **It does not pin a consumer.** It never asks whether anything reads the warning. Had it
  done so the plan would have been withdrawn at step one.
- **"the page size is read from the backend rather than hardcoded"** does not say *from where*.
  There is no page-size source on main. `bb` exposes no `--page-size` and no total; `#333`
  says *"cannot report a total or a cursor"*. So the implementer must invent a source —
  a hardcoded table keyed by `bb --version`, or a new config key. A version table **is** a
  hardcoded 50 wearing a lookup, and it satisfies the letter of this criterion while breaking
  its intent. "A different declared size moves the threshold" is satisfied by a test stub and
  proves nothing about the real `bb`.
- **It does not pin what happens when `bb --version` is unreadable or unparseable** —
  distinct from "page size unknown", and the likeliest real-world state.
- **It does not pin the existing test it must overturn.** `test/reconcile/host.test.mjs:2801`
  exists specifically to forbid this: *"a detector keyed to 50 would report it complete — this
  plan's own defect restored."* The plan does not name it, does not argue against it, and
  `pnpm run test:contracts` will fail on it. Per the repo's corpus rule, adjusting a test to
  make a comparison pass is the one move forbidden — and the plan silently requires exactly
  that.

## 4. Strongest argument AGAINST doing this at all

**The warning has no consumer, so there is no noise to remove — only a signal to weaken.**

The plan's stated benefit is that the board stops discarding complete pages. That benefit does
not exist: the board never saw the warning. What remains is cost only:

1. **The only benefit is to a human reading stderr** — and that human is exactly the one #333's
   third "possible direction" wants to keep: *"make the truncation visible on the board rather
   than only on stderr."* This plan moves the opposite way, reducing what is available to
   surface before anyone surfaces it.
2. **It introduces a page-size dependency where main deliberately has none.** `plot-host.sh:1776`
   is explicit: *"THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50. A future
   `bb` page size of 100 must not make a truncated 100-row list report complete — this plan's
   own defect restored."* That comment was written against this exact change. The plan quotes
   the file's *other* comments and never engages this one.
3. **The mitigation is weaker than it reads.** *"Where the page size is not known, the current
   behaviour stands"* is only safe if unknown-ness is detected reliably. The dangerous case is
   not *unknown* — it is **confidently wrong**: a `bb` that reports 1.0.0 while paging at 25.
   Then a 20-row page is "proven complete", the warning is silenced, and 5 PRs are invisible
   with nothing saying so. That is #333's failure, at a page size below 50, now **silent**.
   The plan's "It does not fix #333 … a genuine truncation still warns" holds only under the
   assumption that the declared size equals the actual one — which is the single assumption
   the whole design rests on and the one nothing can verify.

### The safety trade, stated directly

The two errors are not symmetric, and this repo has already ruled on which way to fail.

- **Over-firing** costs a stderr line nobody reads. Measured cost today: **zero**, because
  nothing consumes it.
- **Under-firing** means stale, partial data read as complete. `plot-fleet-scan.sh:846` names
  this: *"Deriving absence from a partial list would report a real PR as having none — strictly
  worse than the per-branch cost being removed."* `plot-pr-merged.sh` follows the same rule:
  *"An unreachable host answers not merged, so silence is never permission."*

**This plan trades toward under-firing, for a benefit that does not exist.** Even if the causal
claim were true, the trade would need argument. With the claim false, there is nothing on the
other side of the scale.

### On whether narrowing could let #333's failure through

Partly, yes — and the plan's containment argument is thinner than it states. The plan says
#333 is *"past the page size"* and this is *"below"*, so the two cannot meet. They meet
whenever the **declared** size exceeds the **actual** one. A bb declaring 50 and paging at 25
puts every real truncation between 25 and 50 into the "proven complete" band, and it is
precisely those cases that stop warning. The plan's honest caveat — *"`bb` reported 50 at 1.0.0
and a later version may page differently"* — identifies this risk and then answers only the
*unknown* branch of it, never the *wrong* branch.

## What I would want instead

The finding is more valuable than the fix. In priority order:

1. **Establish why the two open PRs were dropped**, with the join instrumented on the real
   repo. Suspects, in order: `.list-complete` at `plot-fleet-scan.sh:867` combined with the
   `NONE` derivation at `:940-947`; the `pr.state === 'OPEN'` filter at `fleet.ts:2510`; the
   `head:.source.branch.name` mapping at `plot-host.sh:3025`. Truncation is the one suspect
   already eliminated: 3 rows is far below every threshold in the path.
2. **File the real defect**: the warning has no consumer, on either path. That is worth its own
   issue, and it is a plain prerequisite to #333's third direction.
3. **Note the two-rules split** — `plot-host.sh:1815` and `plot-fleet-scan.sh:867` answer
   "is this list complete?" with different thresholds and no corpus test between them. This is
   exactly the undeclared duplication `docs/shell-and-domain.md` forbids.

## Citations

- `skills/plot/scripts/plot-host.sh:1815-1827` — the rule under change; stderr only, exit code untouched
- `skills/plot/scripts/plot-host.sh:1776-1779` — *"NEVER the constant 50 … this plan's own defect restored"*
- `skills/plot/scripts/plot-host.sh:2993, 3022, 3031` — the three bitbucket call sites
- `packages/domain/src/adapters/scripts/scripts-shell.ts:88` — stderr discarded when `code === 0`
- `packages/board/src/server/fleet.ts:2477-2483` — board branches on `answer`, never stderr
- `packages/board/src/server/fleet.ts:2510` — open-only head filter, a live suspect
- `skills/plot/scripts/plot-fleet-scan.sh:675-678, 746` — `host_err` read only when `rc != 0`
- `skills/plot/scripts/plot-fleet-scan.sh:620, 867-869, 940-947` — the second, untouched truncation rule
- `skills/plot/scripts/plot-fleet-scan.sh:846` — *"report a real PR as having none — strictly worse"*
- `test/reconcile/host.test.mjs:2801-2817` — the existing test this plan must overturn and does not name
- GitHub issue #333 — *"a stderr line the board never surfaces"*

Verdict: reject

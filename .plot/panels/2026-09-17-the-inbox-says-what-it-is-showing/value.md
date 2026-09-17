# VALUE lens — the inbox says what it is showing

Position: amend

The symptom is real and the plan's remedy is the weaker half of a pair the estate already built. Two facts the plan asserts are false as written, and one of them is not a nit — the setup skill's live Jira text currently tells an adopter the *opposite* of what the code does, and this plan proposes to add a step next to it without touching it.

---

## 1. Is the problem real, and stated correctly?

**The query line: verified byte-for-byte.**

```
$ sed -n '3376p' skills/plot/scripts/plot-host.sh
      jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY${scope} ORDER BY created DESC}"
```

Identical to the plan's quotation. Two narrowings compose — `assignee = currentUser()` and `${scope}`, which `:3367-3371` fills with `AND project IN (…)` from `Ticket prefixes`. The composition claim is correct.

**The Jira measurement I cannot re-derive**, and say so plainly: `project = QUAWEB AND statusCategory != Done` → 10+, the default → 0, `GET /rest/api/3/myself` → 200. These ran against a reporter's Jira instance with their credentials. No command available here reaches it. I take the shape of the report as plausible — it is exactly what the code produces for a person with no assigned tickets in a scoped project — but the panel should record it as **operator-reported, not re-derived**.

**The `#850` precedent: verified.** `2026-09-09-jira-inbox-is-instance-wide-the.md:20` shipped the project narrowing and deliberately left the assignee clause; `CHANGELOG.md:341` confirms it shipped as #862. The plan's reading of the precedent is honest, and its refusal to re-argue the default is right.

**So the problem is real.** What is stated incorrectly is its *extent*, which §4 covers.

---

## 2. Is the proposed change the right fix, or does it fix a symptom?

**This is my lens's question, and the answer is: it fixes the right thing in the wrong place — and the right place is already built.**

The plan asks whether an operator can tell a correct empty inbox from a broken one. **The board already answers exactly that question, for exactly this section, with a mechanism built for exactly this defect.** `packages/board/src/contract/schema.ts:3163-3177`:

```
 * Whether the tracker could be asked at all — THREE answers, kept apart.
 * - `answered` — the host replied; `issues` is what it said, and an empty
 *   array honestly means there are none unplanned.
 * - `unsupported` — this host has no issue listing …
 * - `failed` — the question was asked and did not come back.
 *
 * COLLAPSING ANY TWO REBUILDS `an-outage-is-not-an-answer`. An empty list is a
 * claim about the tracker; a failed lookup is the absence of one, and a board
 * that renders the second as the first tells a reader their inbox is clear
 * using data it never received.
```

And the render sites exist. `AgentList.tsx:2064-2072` — the cell a reader lands on when the grid is empty:

```tsx
issues.length === 0 && broken.length === 0 && (
<li role="row" …>
  <span role="gridcell">
    {key === 'waiting-on-machine' && answer !== 'answered'
      ? HOST_ANSWER_HINT[answer]
      : 'none'}
  </span>
</li>
)
```

Its own comment (`:2048-2052`) states the principle this plan's report is a fresh instance of:

> `none` IS AN OBSERVATION, so it is only printed where one was made. In WAITING ON A MACHINE before the host has answered the grid is empty because nobody asked, and **the word for that is not the word for an empty answer — the whole defect**, in the one cell a reader lands on after opening the section.

**So: what does the board render today when the Jira inbox is correctly empty?** The literal string `none`, with no qualifier — because `issueAnswer === 'answered'` and `issues.length === 0` fall to the `: 'none'` arm. Header side, `:981`, the same: `countOf + issues.length > 0 ? shownLabel : emptyHint`, and `emptyHint` is section-specific **only for `waiting-on-machine`** (`:937-945`). WAITING ON YOU gets the generic hint.

**That is the finding.** The sibling section — WAITING ON A MACHINE — got a per-state hint (`HOST_ANSWER_HINT`, `host-notes.ts:232`: `unasked: 'not checked yet'`, `unreachable: 'could not reach the host'`) precisely so an empty grid states its own provenance. The issue section got the *failure* arm of the same treatment (`:2121`, `data-issue-error`) and **never got the `answered`-but-empty arm.** The plan's reporter walked into the one gap in a pattern the board otherwise applies consistently.

**Weighing the two remedies, which is my charge:**

| | a setup step | a line in the empty cell |
|---|---|---|
| reaches an operator who adopted before this ships | **no** | yes |
| reaches an operator who read the step in March and is confused in September | no | yes |
| reaches a second person opening a shared board | no | yes |
| survives a re-read at the moment of confusion | no — it is scrollback | yes — it is on screen |
| cost | a skill step, no code | `emptyHint` + the empty cell, one `issueAnswer`-aware branch |
| precedent | none for this | `an-outage-is-not-an-answer`, already shipped twice |

The setup step is read **once, by one person, at adoption, before any inbox exists to be confused by.** The symptom arrives weeks later, to whoever is looking at the board. The plan's own `Notes` concede the reporter *"had to run the JQL by hand to find out their setup was healthy"* — they were at the board, not at the setup transcript. A persistent on-screen reading answers them where they stood; a setup step answers them somewhere they will never look again.

**The plan anticipates this and its rebuttal does not survive its own precedent.** It argues a conditional step *"would be a diagnosis"* and that the reading is true whether empty or not. Correct, and an argument against a conditional **setup step** — not against an on-screen line. `HOST_ANSWER_HINT` is rendered conditionally on state and is not a diagnosis; it is a label on a reading. The board already distinguishes *stating what a cell means* from *diagnosing a fault*, and this plan's own framing does not.

**I am not arguing the setup step is wrong.** It is cheap and it is true. I am arguing it is insufficient alone, that the plan presents it as the whole answer, and that the durable half — the one the estate's own design principle already mandates — is filed nowhere. The plan's `What this does not do` names three things it declines. It does not name the board line, does not argue against it, and does not file it. A reader finishes this plan believing the question is closed.

**Verdict on this question: the fix addresses the symptom's messenger, not its venue.**

---

## 3. Does `Done when` contain a gate unsatisfiable by plumbing a value through?

**Yes — one, and it is genuine.**

> the default query in `plot-host.sh` is **unchanged**, pinned by asserting the line byte-for-byte

This cannot be satisfied by threading a value. It is a negative assertion over a file this plan does not touch, and it fails loudly if anyone widens the default while calling it documentation. It is the right gate for a plan whose whole claim is *changes no behaviour*.

**One caveat the implementer must resolve.** The nearest existing assertion is not byte-for-byte:

```
$ grep -rn "assignee = currentUser" test/
test/reconcile/host.test.mjs:2388:const JQL_UNSCOPED = 'assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC';
test/reconcile/host.test.mjs:2421:  assert.match(jql, /assignee = currentUser\(\)/);
```

`:2388` is the **pre-`${scope}`** string and `:2421` is a regex on one clause. Neither pins today's line. So this gate requires a *new* assertion, not the reuse of one — worth saying in the slice, or it will be marked satisfied by pointing at `:2421`.

**The other six clauses are prose-satisfiable** — "names both narrowings", "states that an empty inbox … is the expected reading", "is unconditional". Each is checkable only by a person reading the diff. Acceptable for a docs plan carrying one hard gate; worth naming that the load-bearing gate is the negative one.

`PLOT-UNASKED` is a real sweep — the skill already carries 7 (`grep -c`), so the requirement is live and mechanical.

---

## 4. What could I not verify, or find false?

**FALSE — and this is the amendment.** The plan states:

> Verified 2026-09-17: **it is named in no skill and no README.**

`PLOT_JIRA_JQL` — true, it appears in no skill file (`git grep PLOT_JIRA_JQL -- skills/` returns 5 hits, all inside `scripts/*.sh` comments, none in a `SKILL.md`). That half holds.

But the plan's *problem statement* is broader — *"adoption explains neither"* narrowing — and that half is false:

```
$ sed -n '56p' skills/plot/SKILL.md
`Ticket prefixes` … Set it when the tracker is a shared instance: the inbox's
default query scopes by assignee and by resolution, so without it a board can
show another team's tickets. …
```

**The hub skill names the assignee narrowing today, in those words.** So the gap is not *"neither narrowing is explained"*; it is *the two are explained in a file the adopter is not reading at setup, and never together, and never with the consequence spelled out.* That is still a real gap and still worth fixing — but the plan's premise as written overstates it, and an implementer taking `Done when` at face value ("names **both** narrowings — since naming only the project one leaves the reported symptom unexplained") will write a step duplicating `plot/SKILL.md:56` into a second file without noticing the first. That is the config-drift this repo's own skills warn against, in prose instead of keys.

**FALSE BY OMISSION, and worse — the setup skill's live Jira text is stale and inverts the truth.** `skills/plot-board-setup/SKILL.md:393-401`:

> **Warn when the key has no backend.** `plot-host.sh issue-list` resolves issues through the **Git host** — `github` or `bitbucket` — not through a separate tracker system. A `Tracker: jira` or `Tracker: linear` is recorded but unread: the board's inbox will show nothing until a backend for that tracker lands.
>
> > Recorded `Tracker: jira`. Note: no backend reads this yet … **until then, the inbox will be empty.**

Measured against the code:

```
$ grep -n "tracker_scheme" skills/plot/scripts/plot-host.sh
1618:tracker_scheme() {
3342:    if [ "$(tracker_scheme)" = "jira" ]; then
3520:    if [ "$(tracker_scheme)" = "jira" ]; then
3634:    [ "$(tracker_scheme)" = "jira" ] || exit 4
```

**The Jira backend exists and dispatches on `Tracker`, not on the git host.** `:3342`'s own comment says so: *"DISPATCHED ON `Tracker`, never on `backend()`: a Bitbucket repo tracking in Jira is the normal enterprise case."* The skill's paragraph describes a world that ended.

**This matters more than the step the plan proposes, and it is the same defect.** An adopter setting `Tracker: jira` is told by the setup skill, *in the very run this plan wants to add a step to*, that **the inbox will be empty and no backend reads this yet.** Then their inbox is empty. The skill has pre-supplied a wrong explanation for the exact symptom reported. Adding a correct step a few hundred lines away, while the wrong one stays, leaves an adopter with two contradictory statements and no way to choose. The stale text also tells them the key is inert, so they will not think to set `PLOT_JIRA_JQL` — the override this plan's step is built around.

**The plan does not mention this paragraph.** It is the strongest single piece of evidence that a step is needed *and* that a step alone is not the fix, and it is absent from a plan whose entire subject is what `/plot-board-setup` says about the Jira inbox.

**Unverifiable:** the Jira instance measurements (§1). Not a mark against the plan — no juror here can reach that instance — but it belongs in the record.

---

## 5. What has the VALUE lens noticed that the plan missed?

**a. The durable remedy is unfiled, and the plan's framing closes the question.** Covered in §2. This is the substance of `amend`: the plan should say, in `What this does not do`, that the board's empty-inbox cell states no provenance where `issueAnswer === 'answered'`, that `HOST_ANSWER_HINT` is the shipped pattern for exactly this, and that it is filed separately. Without that, the panel records this report as answered by a setup step, and the gap in `an-outage-is-not-an-answer`'s coverage stays invisible. **The minimum amendment is a named follow-up; the better one is folding the board line into this plan** — at which point `Type: docs` becomes wrong, which is the honest cost of the better answer and should be paid rather than avoided.

**b. The stale paragraph must be in scope.** §4. A plan adding a sentence about the Jira inbox to a skill that already contains a false sentence about the Jira inbox, and not fixing it, has not finished. This is a strict improvement in value for near-zero marginal cost: the implementer is already in the file.

**c. On merging with #930 — my charge asks directly, and I argue against.** They should stay separate, and the plan's own `Notes` slightly oversell the link.

The plan says *"Both show an operator an empty board"*. Read the code: they do not produce the same screen. #930 is a credentials refusal — `plot-host.sh:1703` errors, which drives `issueAnswer: 'failed'`, which renders `data-issue-error` with `issueNote` text (`AgentList.tsx:2121-2130`). This plan's case is `issueAnswer: 'answered'` with an empty array, which renders `none`. **The board already distinguishes them**, by the three-state mechanism in §2. An operator hitting #930 sees an amber line; an operator hitting this sees `none`. Same *emotion*, different *pixels*, different fix.

They also differ in kind: #930 is `Type: feature` and changes what the code reads; this is `Type: docs` and changes no byte. Merging would drag a docs change into a release-gated feature plan and lose the property this plan's one hard gate exists to protect.

**So: two plans, correctly.** What the pair is missing is not a merge — it is the **third** item neither files, (a) above, which is the one that makes the two distinguishable *on screen* rather than in a schema comment. That is the sibling both these plans actually have.

**d. A cheaper durable option, for completeness.** Short of a board change: `plot-host.sh issue-list` could emit the JQL it sent on stderr under a verbose flag, so a confused operator has a one-command answer. I do not recommend it over the board line — it needs the operator to already suspect the query, which is the thing they do not know to suspect. Recorded so the panel sees the option was weighed and rejected on the reporter's own evidence: they ran JQL by hand, so they could reach a CLI and still did not know what to ask it.

---

## Position rationale

Not `reject`: the problem is real, the query reading is correct, the precedent is honestly handled, the byte-for-byte gate is genuine, and the step is cheap and true.

Not `proceed`: the plan asserts a verification that is false (`named in no skill` — `plot/SKILL.md:56` names the assignee narrowing), it leaves a stale paragraph in the very skill it edits that tells adopters the Jira backend does not exist, and it presents a one-time setup sentence as the complete answer to a question the board's own shipped design principle says should be answered on screen.

**Amend to:** (1) correct the premise to *"explained in the hub skill, not at setup, and never together"*; (2) bring `SKILL.md:393-401` into scope — it is false and it pre-explains this exact symptom wrongly; (3) name the board's `answered`-and-empty cell as the durable half, either folded in or filed, so the panel does not record this report as closed by documentation.

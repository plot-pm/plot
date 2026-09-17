# ADVERSARY lens — round 2 — the-inbox-says-what-it-is-showing

Position: amend

The correction pass fixed the two things round 1 pointed at loudest and left standing, untouched, the one round-1 finding it explicitly *refused* — which it refused by checking lines nobody named. It also introduced a new claim that reads as a type-level proof and is a conflation of two different enums. A plan that says **"the finding is recorded as checked and refused rather than silently dropped"** while having checked the wrong file region is worse than one that dropped it silently: it now carries a written warrant against a true finding.

---

## 1. Was the refused finding rightly refused?

**No. The author checked lines nobody cited, and the finding is true.**

The plan's new Notes paragraph:

> **A round-1 juror reported a stale sentence in the setup skill and it is not one.** Checked 2026-09-17: `:220` and `:236` …

Round 1's `value.md` named its lines, and they are not those:

> **FALSE BY OMISSION, and worse — the setup skill's live Jira text is stale and inverts the truth.** `skills/plot-board-setup/SKILL.md:393-401`

**`:220` and `:236` are a different paragraph on a different subject.** They are the `Ticket prefixes` decline rule, and the author is right that they are true. They are also not what was reported. The refusal answers a claim nobody made.

The sentence actually reported, **unchanged on main today**:

```
$ sed -n '393,401p' skills/plot-board-setup/SKILL.md
**Warn when the key has no backend.** `plot-host.sh issue-list` resolves issues
through the **Git host** — `github` or `bitbucket` — not through a separate
tracker system. A `Tracker: jira` or `Tracker: linear` is recorded but unread:
the board's inbox will show nothing until a backend for that tracker lands.
When writing such a key, say so:

> Recorded `Tracker: jira`. Note: no backend reads this yet — the board's inbox
> sources issues from the git host, not from Jira. A Jira backend is planned;
> until then, the inbox will be empty.
```

Measured against the code it describes:

```
$ sed -n '3342,3349p' skills/plot/scripts/plot-host.sh
    if [ "$(tracker_scheme)" = "jira" ]; then
      # Jira, resolved through the REST API — DISPATCHED ON `Tracker`, never on
      # `backend()`: a Bitbucket repo tracking in Jira is the normal enterprise
      # case, so the git host is irrelevant here (see the Jira helpers up top).
```

Four independent falsehoods in that paragraph, each checkable:

| the skill says | the code does |
|---|---|
| "resolves issues through the **Git host**" | `:3342` dispatches on `tracker_scheme()`, i.e. on `Tracker` — its own comment says *"never on `backend()`"* |
| "`Tracker: jira` … is recorded but **unread**" | `tracker_scheme()` reads it at `:3342`, `:3520` and `:3634` |
| "until a backend for that tracker lands" | the Jira backend landed — `jira_require_config`, `tracker_projects`, the whole REST arm |
| "until then, the inbox **will be empty**" | it is not empty; it runs the JQL this very plan quotes |

And `:405` repeats it — *"Any other `Tracker` value is unread today"* — as does the failure-modes table at `:536`. **Three sites, not one.**

**This is not a nit for this plan specifically, and that is the adversarial point.** The plan's whole subject is *what `/plot-board-setup` tells an adopter about the Jira inbox*. The skill currently tells an adopter setting `Tracker: jira` — **in the same run, ~100 lines before where this plan's step lands** — that the inbox **will be empty** because no backend exists. Then the adopter's inbox is empty. **The skill has pre-supplied a wrong explanation for the exact symptom this plan exists to explain.** Adding a correct sentence downstream while the wrong one stands leaves an adopter holding two contradictory statements from one skill and no way to pick. Worse, the stale text says the key is inert, so the adopter has no reason to believe `PLOT_JIRA_JQL` does anything either — and `PLOT_JIRA_JQL` is what this plan's step is built around.

**The refusal must be withdrawn and `:393-401` (plus `:405` and the `:536` table row) brought into scope.** The implementer is already in the file; the marginal cost is a paragraph.

---

## 2. Did the amendment introduce a NEW false claim?

**Yes. The type argument is false as stated, and it is the load-bearing sentence of the new section.**

The plan, `:95-105`:

> **Its type says the omission was a decision, not an oversight**:
>
> ```ts
> export const HOST_ANSWER_HINT: Record<Exclude<HostAnswer, 'answered'>, string>
> ```
>
> `'answered'` is excluded by construction, so a hint for an answered-but-empty inbox is a change to that type and to every reader of it.

**The quoted line is exact:**

```
$ grep -n "export const HOST_ANSWER_HINT" packages/board/src/app/lib/agent-rows/host-notes.ts
232:export const HOST_ANSWER_HINT: Record<Exclude<HostAnswer, 'answered'>, string> = {
```

**The inference from it is not, because `HostAnswer` is not the inbox's type.** Two different enums:

```
$ grep -n "export type HostAnswer" packages/board/src/app/lib/agent-rows/host-notes.ts
204:export type HostAnswer = 'answered' | 'unasked' | 'unreachable';

$ grep -n "IssueAnswerSchema = " packages/board/src/contract/schema.ts
3177:export const IssueAnswerSchema = z.enum(['answered', 'unsupported', 'failed']);
```

`HostAnswer` is derived from **PR fields only**, and the function says so explicitly:

```
$ sed -n '213,219p' packages/board/src/app/lib/agent-rows/host-notes.ts
export function hostAnswer(
  fleet: Pick<Fleet, 'prAgeSeconds' | 'prError'>,
): HostAnswer {
  if (fleet.prAgeSeconds !== null) return 'answered';
  return fleet.prError ? 'unreachable' : 'unasked';
}
```

`Pick<Fleet, 'prAgeSeconds' | 'prError'>` — the parameter type **forbids** it from seeing `issueAnswer`. Its own docstring says the narrowing exists so a later edit cannot reach further.

**So the two types share only the word `answered` and overlap in no other member.** `unasked`/`unreachable` against `unsupported`/`failed`. `HostAnswer` describes the PR fetch; `IssueAnswer` describes the tracker.

**What follows for the plan's argument:**

- `Exclude<HostAnswer, 'answered'>` is not a decision about the **inbox** at all. It is a decision about the PR-fetch hint, where `answered` genuinely needs no hint because the PR rows are then present.
- A hint for an answered-but-empty **inbox** is therefore **not** "a change to that type and to every reader of it." It is a new, independent lookup keyed on `IssueAnswer` — or simply one branch in the existing cell. `HOST_ANSWER_HINT` need never be touched.
- **Which demolishes the cost argument the section rests on.** The plan uses the type to argue the board line is a `feature` plan with its own gates, and therefore that folding it in would make `Type: docs` false. That conclusion may still be right on other grounds — it is a `.tsx` change — but the reason the plan gives for it is not a reason. It reads as a type-level proof and is a misread of which enum governs.

**And the render-path claim in Notes is right about the two cases it names and wrong by omission about a third.** Verified:

```
$ sed -n '2064,2069p' packages/board/src/app/components/AgentList.tsx
                    {key === 'waiting-on-machine' && answer !== 'answered'
                      ? HOST_ANSWER_HINT[answer]
                      : 'none'}

$ sed -n '2122,2123p' packages/board/src/app/components/AgentList.tsx
              {key === 'waiting-on-you' && fleet.issueAnswer === 'failed' && issueNote(fleet) && (
                  data-issue-error
```

So: `failed` → amber `data-issue-error` line; `answered`-and-empty → bare `none`. **The plan's claim holds for those two.** But note the first guard is `key === 'waiting-on-machine'` — the `HOST_ANSWER_HINT` arm **cannot fire in the inbox's section at all**, which is `waiting-on-you`. The plan says the board "already distinguishes three inbox states and renders a bare `none` for this one". It renders a bare `none` for **two** of the three: `answered`-empty and `unsupported` both fall to `: 'none'`, since only `failed` has a render site.

```
$ grep -n "issueAnswer = " packages/board/src/server/fleet.ts
2252:    entry.issueAnswer = 'unsupported';
2258:    entry.issueAnswer = 'failed';
2323:    entry.issueAnswer = 'failed';
2352:    entry.issueAnswer = 'answered';
```

`unsupported` is a live, reachable state — `refreshIssues` sets it whenever the adapter answers `unaskable` — and it renders identically to a correct empty inbox. **The plan asserts the board "already tells them apart"; it tells two of three apart.** That strengthens the case for the follow-up the plan files, and the plan should state the gap as two states, not one, or the follow-up will be scoped to half of it.

---

## 3. Does `Done when` contain a gate nothing can satisfy?

**One clause is a real gate. One is satisfied before the branch is cut. One is false about the mechanism it invokes. Net: the gate set is weaker than it reads.**

**(a) The byte-for-byte pin — genuine, and it is the only one.** *"the default query in `plot-host.sh` is **unchanged**, pinned by asserting the line byte-for-byte."* A negative equality against a literal: no threading of a value satisfies it, and any widening of the default fails it. Correct gate for a plan claiming *changes no byte*.

**But round 1's two jurors gave opposite answers about whether it is new work, and both are half right.** `premise.md` said the gate "is a test it does not have to write, satisfied before the branch is cut." `value.md` said "this gate requires a *new* assertion, not the reuse of one." The file settles it:

```
$ sed -n '2388p;2427,2438p' test/reconcile/host.test.mjs
const JQL_UNSCOPED = 'assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC';
test('host: issue-list jira sends TODAY\'S query byte-for-byte when the key is absent', () => {
  …
  assert.equal(jqlOf(stub), JQL_UNSCOPED, 'an undeclared key changes nothing at all');
```

`premise` is right: an exact-equality pin exists and passes today. `value` is right that it pins the **unscoped** line only — `${scope}` empty. The **scoped** form the plan quotes at `:27` is asserted at `:2413-2425` by four separate `assert.match` regexes, never as one literal. **So the `Done when` is satisfied for half the query and not the other half, and neither juror said so.** The clause should name `host.test.mjs:2427` as the existing pin and say whether the scoped form needs one too — or an implementer writes a duplicate of a passing test and calls the gate met.

**(b) The `PLOT-UNASKED` clause is false about the sweep, and round 1 already proved it. The amendment did not touch it.** The plan still reads *"the skill carries its `PLOT-UNASKED` line, **which the estate-wide unattended sweep requires of every skill**"*. The sweep:

```
$ sed -n '115,119p' test/reconcile/unattended.test.mjs
    const declarations = text.match(/\*\*Unattended \(`PLOT_UNATTENDED=1`\)/g) || [];
    if (declarations.length === 0) continue;
    const disclosures = text.match(/PLOT-UNASKED:/g) || [];
    if (disclosures.length < declarations.length) {
```

`continue` on zero declarations. **It requires nothing of a skill that asks nothing** — the requirement is per declared shape. And the count is already balanced:

```
$ grep -c 'PLOT-UNASKED:' skills/plot-board-setup/SKILL.md          → 7
$ grep -c 'Unattended (`PLOT_UNATTENDED=1`)' skills/plot-board-setup/SKILL.md → 7
```

Seven and seven, green on main. The plan's own step is **explicitly unconditional** (`:70`, *"It is unconditional"*) — it asks nothing, declares no shape, owes no line. **So this clause is a gate that is (i) already satisfied, (ii) satisfied by work this plan does not do, and (iii) described by a rule that does not exist.** As written it invites bolting a spurious disclosure onto an unconditional paragraph. Round 1's `premise` said exactly this and the amendment ignored it while amending three paragraphs around it.

**(c) The remaining four clauses are prose.** *"names both narrowings"*, *"`PLOT_JIRA_JQL` is named with what it overrides"*, *"states that an empty inbox … is the expected reading"*, *"is unconditional"*. Each is checkable only by a person reading the diff.

**Is that strong enough to mean anything?** By this repo's own test — *"Can you answer 'Did I complete this?' without actually doing the work?"* — four of seven are rules. `pnpm test` is real but orthogonal: it passes on main and would pass on any prose this plan writes.

**My answer: weak but honestly weak, with one repairable hole.** A docs plan's gates being prose-shaped is structural, not a defect; there is no step-content assertion in this estate to join cheaply. What is not acceptable is a clause that **reads as mechanical and is not** — (b) is the one that will be marked green without a thought. Drop it or restate it as *the skill's 7 declarations and 7 disclosures stay balanced*, which is at least a thing a grep can check.

---

## 4. Anything both rounds have missed?

**a. The plan's `#850`-precedent claim is false and survived the correction pass.** Round 1's `premise` found it; the moderator then **re-asserted it as fact** in `panel.md`:

> the sibling plan genuinely shipped the project scope for #850 while leaving the assignee clause alone **deliberately**

```
$ grep -n -i 'deliberat' docs/plans/2026-09-09-jira-inbox-is-instance-wide-the.md
(no output)
```

Four mentions of the assignee clause in that plan, all descriptive (`:3`, `:29`, `:32`, `:34`). It never argues the clause should stay, never calls the choice deliberate, and never says *an inbox is a person's queue*. It calls the assignee scope one of the two things that are **insufficient**. **A juror found this, the moderator overturned it without evidence, and the amendment left `:52` intact.** That is the correction pass failing in the direction that matters: a finding does not become false by being summarised away. The argument the plan wants is available one file over — `plot-host.sh:3347` does say *"The inbox is 'my open tickets': assigned to me and unresolved"* — so the fix is to re-attribute, not to retreat.

**b. `resolution = EMPTY` is a third narrowing and the plan counts two, five times.** The title of its own design section is *"The default query narrows twice"*; `Done when` demands *"both narrowings — assignee and project"*. The query has three clauses, and the hub skill names the pair the plan omits:

```
$ sed -n '56p' skills/plot/SKILL.md
… the inbox's default query scopes by assignee and by resolution, so without it a board can show another team's tickets.
```

So an operator whose ticket was marked *Won't Do* — unresolved-false, gone from the inbox — is returned to exactly the confusion this plan exists to end, having been told there are two narrowings. `premise` raised this in round 1 as item (c); neither the moderator's summary nor the amendment carries it. The drafted step text at `:65-68` does say *"and unresolved"*, so the fix is to make the counting prose agree with the step it already has.

**c. The drafted step is false for the repository reading it.** `:65` says the inbox is *"scoped to `Ticket prefixes`"* — unconditionally.

```
$ bash skills/plot/scripts/plot-config.sh get "Ticket prefixes" "(unset)"
(unset)
```

With the key absent `$scope` is empty and there is **no** project narrowing. That is this repo, and every board that adopted before 2.16.0. The step as drafted tells that operator their inbox is project-scoped when it is instance-wide — the very misreading `#850` was filed for, inverted. One clause fixes it: *scoped to `Ticket prefixes` where that key is set, instance-wide where it is not.* `premise` raised this too, and the moderator's summary dropped it.

**d. `/plot-init` writes the same key and gets no sentence, and the plan does not say why.** The sibling's slice is named `feature/adoption-proposes-the-ticket-prefixes` for **both** skills, and `/plot-init` carries the key at `:203-236, :394, :730-734, :777-778`. `/plot-init` is where most adopters meet `Ticket prefixes` first. The honest reason to scope this to `/plot-board-setup` is probably *the board is where you see the empty inbox* — a good reason, unwritten. Round 1's `premise` raised it; the moderator dropped it.

**e. The pattern across a–d is the finding.** Four substantive round-1 items — the `#850` attribution, the third narrowing, the absent-key case, the `/plot-init` scope — were raised by one juror, omitted from the moderator's summary, and are absent from the amendment. The amendment tracks `panel.md` faithfully and `panel.md` dropped half of `premise.md`. **The correction pass corrected the summary, not the record.** For a panel whose stated purpose is that a verdict file names a position rather than averaging, a reconciliation that silently drops a juror's verified findings is the failure mode to name here.

**f. What is genuinely good and worth keeping.** The new `What this does not do` section is the right move: naming the unfiled board line stops this report being recorded as closed by documentation. The Notes correction — retracting *"both show one screen"* against the render path — is a plan correcting itself with evidence, and it is right. Neither survives as a reason to proceed while a–d stand, but neither should be lost in the next revision.

---

## 5. Would I implement from this plan as it stands?

**No — and the specific harm is that an implementer following it faithfully produces a worse skill than one who ignores it.**

Concretely, from today's text an implementer would:

1. Read the Notes, see the stale-sentence finding **recorded as checked and refused**, and leave `:393-401` standing — so the skill ships a step saying *the inbox shows your assigned tickets* about a hundred lines below a step saying *no backend reads this yet; the inbox will be empty*. Two statements from one skill, contradicting each other, about one feature. **This is the outcome the refusal directly causes**, and it is worse than never having raised the finding.
2. Write *"scoped to `Ticket prefixes`"* verbatim from `:65` and tell every unscoped board it is scoped.
3. Bolt a `PLOT-UNASKED` line onto an unconditional paragraph to satisfy a clause nothing requires.
4. Cite `#850` for a decision `#850` never made.

None of that is caught by `pnpm test`, and none of it is caught by the byte-for-byte pin, because none of it touches `plot-host.sh`.

**Not `reject`.** The problem is real, the query reading is exact, the routing is right, the byte-for-byte gate is genuine, and the amendment's honesty about the board being the better answer is the best thing in the plan.

**`amend`, five items, all cheap:**

1. **Withdraw the refusal.** Round 1 named `:393-401`, not `:220`/`:236`. That paragraph is false in four ways, plus `:405` and the `:536` table row. Bring all three into scope — the implementer is already in the file, and a plan adding a true sentence about the Jira inbox to a file holding a false one has not finished.
2. **Fix the type argument.** `HostAnswer` (`answered|unasked|unreachable`, PR-derived) is not `IssueAnswer` (`answered|unsupported|failed`). `Exclude<HostAnswer,'answered'>` says nothing about the inbox. Keep the conclusion if it holds on `.tsx` grounds; drop the false proof. And state the follow-up's scope as **two** unlabelled states — `answered`-empty and `unsupported` both render bare `none`.
3. **Restore the four dropped round-1 findings**: re-attribute the assignee argument to `plot-host.sh:3347` rather than to `#850`; count three narrowings; give the step its absent-key branch; say why `/plot-init` is out of scope.
4. **Repair the `PLOT-UNASKED` clause.** Name what the sweep actually requires, or drop it — as written it is already green and describes a rule that does not exist.
5. **Name `host.test.mjs:2427` as the existing pin** and say whether the scoped form needs one too.

Position rationale: the plan is one honest correction pass away from being implementable, and the pass it just had corrected the moderator's summary instead of the record.

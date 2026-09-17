# Premise lens — the-inbox-says-what-it-is-showing

Position: amend

Every citation in the plan is exact. Two of its supporting claims are not: the sibling plan never argues what the plan says it argues, and the `Done when` clause about the unattended sweep describes a requirement that does not exist in the form stated. Both are fixable in prose; neither touches the proposal itself.

---

## 1. Is the problem real, and stated correctly?

**Real. The line is quoted verbatim and the line number is exact.**

```
$ sed -n '3376p' skills/plot/scripts/plot-host.sh
      jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY${scope} ORDER BY created DESC}"
```

Character-for-character identical to the plan's fenced block, including `${scope}`. `grep -n PLOT_JIRA_JQL` over `plot-host.sh` returns exactly four hits — 211, 3350, 3373, 3376 — so 3376 is the only assignment and the rest are comments, as the plan says.

**Both narrowings are real, and `${scope}` is spliced not appended**, which the surrounding comment states explicitly (`:3369-3371`): *"THE CLAUSE IS SPLICED, NOT APPENDED … JQL requires ORDER BY to close the query"*. `$scope` is built at `:3366`:

```
scope=" AND project IN ($(printf '%s' "$projects" | paste -sd, - | sed 's/,/, /g'))"
```

**The two-line measurement table I cannot re-derive** — it is against a live Jira instance (QUAWEB) that this checkout cannot reach, and this repo declares no tracker at all:

```
$ bash skills/plot/scripts/plot-config.sh get "Ticket prefixes" "(unset)"
(unset)
$ bash skills/plot/scripts/plot-config.sh get "Tracker" "(unset)"
(unset)
```

The claim is nonetheless *consistent with the code*: with `Ticket prefixes` unset `$scope` is empty and the query is assignee+resolution only, so a reporter whose tickets are unassigned to them gets 0 while `project = QUAWEB AND statusCategory != Done` gets 10+. The mechanism needs no instance to believe. Flagged as unverifiable, not as doubted.

---

## 2. Is the proposed change the right fix, or does it fix a symptom?

**It is the right fix for the problem it actually states, and the plan is honest that the problem is documentation.**

The reported symptom — an empty inbox — has two possible fixes: change the query, or explain it. The plan explicitly declines the first and argues why (`### What this does not do`: *"It changes no behaviour, byte for byte"*). That is the correct call. The query is not wrong; `#850` deliberately made it narrower and `resolution = EMPTY` plus `assignee = currentUser()` is a defensible definition of *inbox*. What was missing is that nobody told the adopter.

**And the "where" is right.** The adopter reads `/plot-board-setup`, and the variable is documented in exactly the places an adopter never opens:

```
$ grep -rn 'PLOT_JIRA_JQL' skills/ --include='*.md'
(no output)
```

So the routing — explain it in the skill that performs adoption — targets the gap rather than the symptom.

**One reservation on the fix's reach, below in §5**: `/plot-init` also writes `Ticket prefixes` and is not in scope.

---

## 3. Does `Done when` contain a gate that plumbing cannot satisfy?

**Yes — one, and it is the byte-for-byte pin.** *"the default query in `plot-host.sh` is unchanged, pinned by asserting the line byte-for-byte"* cannot be satisfied by threading a value through: it is an equality against a literal, and any edit to the query fails it.

**But that gate already exists and is already green**, `test/reconcile/host.test.mjs:2428`:

```js
const JQL_UNSCOPED = 'assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC';
…
test('host: issue-list jira sends TODAY\'S query byte-for-byte when the key is absent', () => {
  …
  assert.equal(jqlOf(stub), JQL_UNSCOPED, 'an undeclared key changes nothing at all');
});
```

So the plan's strongest gate is a test it does not have to write, satisfied before the branch is cut. That is not a defect — a docs plan wanting to prove it changed no behaviour is right to point at the existing pin — but the `Done when` should **name the existing test** rather than read as new work, or an implementer will write a second copy of it.

**The remaining clauses are prose-shaped and weak.** *"names both narrowings"*, *"states that an empty inbox … is the expected reading"*, *"is unconditional"* — all satisfiable by a reviewer reading the paragraph, all satisfiable by writing the sentence badly. They are honest for a docs plan, and `/plot-board-setup` has no contract test today that a step-content assertion could join cheaply. I would not demand more; I would demand the sweep clause be fixed (§4), because it currently *reads* as a gate and is not one.

---

## 4. What could I not verify, or find false?

### FALSE (as stated): the sibling plan "left the assignee clause alone deliberately"

The plan asserts:

> `the-jira-inbox-is-scoped-to-this-repository` shipped the project narrowing for #850 … **It left the assignee clause alone deliberately**, and that decision is right: an inbox is a person's queue.

**The first half is true. The second half is not in the sibling plan.**

```
$ grep -n -i 'assignee\|currentUser\|person' docs/plans/2026-09-09-jira-inbox-is-instance-wide-the.md
3:… The default JQL scopes by person and by resolution and by nothing else …
29:jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC}"
32:`assignee = currentUser()` scopes by person. `resolution = EMPTY` scopes by state. Nothing scopes by repository …
34:**The scale of the defect is a property of the reader, not of the repository.** …
```

Four mentions, all descriptive. The sibling plan **never argues the assignee clause should stay**, never calls it deliberate, and never says *an inbox is a person's queue*. It calls the assignee scope one of the two things that are insufficient — *"scopes by person … Nothing scopes by repository"* — and then adds the third clause. The clause survived because the plan was about projects, not because anyone reasoned about persons.

Verified against status: the sibling really is `#850`, really shipped (`State: Released`, `Released: 2026-09-11, 2.16.0`), and really added `project IN (…)` — those parts are exact.

The nearest thing to the plan's claim is on the *script* side (`plot-host.sh:3347-3349`), which does argue the inbox is a person's queue:

> The inbox is "my open tickets": assigned to me and unresolved. That is the story's title — *my Jira tickets are in the inbox* — and it maps the board's "open tracker issues no plan references" onto the person reading the board.

**Why it matters for this plan specifically.** The section is titled *"The assignee clause stays, and that is the precedent"*, and its whole job is to say *this plan is not re-opening #850's decision, because #850 made one*. It did not make one. The plan is citing a precedent that does not exist to license not changing something — which is a weaker position than the one actually available: the assignee clause is argued in `plot-host.sh`'s own comment and in the story title, and this plan does not need a plan-level precedent at all. **Amend the attribution**: cite `plot-host.sh:3347` and the story `my-jira-tickets-are-in-the-inbox`, and drop the claim that #850 made the choice deliberately.

### FALSE (as stated): "the estate-wide unattended sweep requires a `PLOT-UNASKED` line of every skill"

The `Done when` reads:

> the skill carries its `PLOT-UNASKED` line, **which the estate-wide unattended sweep requires of every skill**

The sweep is `test/reconcile/unattended.test.mjs:108`, and it requires no such thing:

```js
test('every declared unattended shape carries a PLOT-UNASKED line', () => {
  for (const [name, text] of skillFiles()) {
    const declarations = text.match(/\*\*Unattended \(`PLOT_UNATTENDED=1`\)/g) || [];
    if (declarations.length === 0) continue;          // ← skills with no question are exempt
    const disclosures = text.match(/PLOT-UNASKED:/g) || [];
    if (disclosures.length < declarations.length) { … }
```

The requirement is **per declared unattended shape**, and a shape is declared only where the skill **asks a question**. `continue` on zero declarations exempts every skill that asks nothing.

**Two consequences, both against the plan:**

1. **The plan's own step asks nothing.** It is explicitly unconditional prose — *"it states the reading rather than asking a question"*, *"It is unconditional"*. A step that asks nothing declares no shape and therefore owes no `PLOT-UNASKED` line. Writing one would add a disclosure for a question that was never asked, which is the opposite of what the line is for (`unattended.test.mjs:110-113`: *"A shape without one is a skill that silently takes a default"*).

2. **The skill already carries seven of them** and already passes:

```
$ grep -c 'PLOT-UNASKED:' skills/plot-board-setup/SKILL.md
7
```
including the `Ticket prefixes` one at `:233`. So *"the skill carries its PLOT-UNASKED line"* is **already true on main**, before the branch exists.

This is the clause the rubric asked about in §3, and it is the one that most resembles a gate while being neither a gate nor new work. **Amend**: either drop the clause, or — if the step is reshaped into something that does ask — state which shape it declares. As written it invites an implementer to bolt a spurious disclosure onto an unconditional paragraph and call the gate met.

### VERIFIED TRUE

- **All four comment citations are exact**, to the line:
  - `plot-host.sh:211` — `#  (JQL overridable via PLOT_JIRA_JQL). There is`
  - `plot-host.sh:3350` — `# the board. \`PLOT_JIRA_JQL\` overrides it for a team that wants a wider or`
  - `plot-host.sh:3373` — `# PLOT_JIRA_JQL STILL WINS OVER BOTH. Teams worked around this bug with`
  - `plot-config.sh:111` — `#   inbox on upgrade. \`PLOT_JIRA_JQL\` overrides both.`
- **"Named in no skill and no README" — true, and stronger than stated.** Repo-wide `git grep` gives 8 files: two scripts, `CHANGELOG.md`, one `.plot/brief`, two plan files, one `docs/stories/…/DESIGN-issue.md`, one test. `grep -rn PLOT_JIRA_JQL skills/ --include='*.md'` returns nothing; no `README.md` anywhere contains it; no `docs/*.md` top-level file contains it.
  - Minor imprecision, in the plan's favour for honesty: the plan says *"and in one CHANGELOG entry"* — there is also `docs/stories/the-master-agent-holds-the-fleet/DESIGN-issue.md` (3 mentions) and `.plot/briefs/the-jira-jql-scopes-by-project.md`. Neither is a skill or a README, so the load-bearing claim survives; the enumeration is incomplete.
- **`/plot-board-setup` exists and the step fits.** `skills/plot-board-setup/SKILL.md`, 546 lines, five steps: `1. Probe` (:78), `2. Propose, then confirm` (:138), `3. Write the config` (:353), `4. Verify — the gate` (:426), `5. Summarise` (:498). *"after the board is verified"* places it at the end of 4 or inside 5. **Step 5 is the natural home** — it already ends by printing unconditional orientation the operator did not ask for (the `/plot-fleet --start` paragraph, added 2026-09-06 for the identical reason: *"this skill named it zero times, so an adopter learned the board and never learned that nothing was supervising"*). That is the precedent the plan should be citing, and it is a real one.

---

## 5. What has the plan missed?

**a. `/plot-init` writes the same key and gets no sentence.** The sibling plan's own changelog says *"`/plot-init` **and** `/plot-board-setup` propose the key"*, and its second slice is named `feature/adoption-proposes-the-ticket-prefixes` for both. `/plot-init` is where most adopters meet `Ticket prefixes` first. The plan scopes to `/plot-board-setup` alone without saying why — and the honest answer is probably *because the board is where you see the empty inbox*, which is a good answer that is not written down. Either state it or widen the slice.

**b. The reader most hurt is the one with no `Ticket prefixes` at all, and the step's draft misdescribes them.** The proposed wording says the inbox is *"scoped to `Ticket prefixes`"*. With the key absent — which is this very repo, and every pre-2.16.0 board — `$scope` is empty and there is **no** project narrowing. The step as drafted tells that operator their inbox is project-scoped when it is instance-wide. The plan's own `Done when` demands *"both narrowings"* be named; the drafted sentence names a narrowing that may not be in force. **The step needs the absent-key branch**, one clause: *scoped to `Ticket prefixes` where that key is set, instance-wide where it is not.*

**c. `resolution = EMPTY` is a third narrowing and the plan counts two.** The default filters by assignee, by project, **and by resolution**. A ticket assigned to the reader, in the right project, that someone marked *Won't Do* is unresolved-false and vanishes from the inbox. The reported symptom (0 against 10+) is most plausibly the assignee clause, so the emphasis is right — but *"the default query narrows twice"* is literally false, and an operator told *two* narrowings who then finds a resolved ticket missing is back to the same confusion this plan exists to end. The comment at `plot-host.sh:3347` gets it right: *"assigned to me **and unresolved**"*.

**d. The board renders the inbox and says nothing either.** The plan's own note observes that #930 and this are *"both an operator seeing an empty board"*. A setup step is read once, at adoption; the board is read daily, by people who never ran setup. The plan does not have to build a board affordance — its `Board impact: none` is a defensible scope — but it should name the gap it is leaving, because the next report of this symptom will come from someone who joined after adoption.

**e. Minor: `Sprint:` names `a-declared-agent-costs-what-it-costs`** — unverified against that sprint's MoSCoW tiers; outside this lens.


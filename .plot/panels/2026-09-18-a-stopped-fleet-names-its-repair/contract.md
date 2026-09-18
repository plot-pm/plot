# Juror: the contract

Lens: this plan changes what a script prints and what a domain type carries. Every other reader of those things, and what breaks.

Position: amend

## Summary

The plan's own contract claims are mostly RIGHT, and one is not — the one it treats as settled. The `summary:` line is safe to widen. The `SupervisorRun` optional field is safe. But the plan states the change as *"`supervisorState` answers a fourth value"*, and a fourth `SupervisorState` value is a **closed `z.enum`** at `schema.ts:3519` that is **cast, not parsed, client-side** and **written straight into a DOM attribute** at `FleetControls.tsx:360`. The plan's Done-when clauses name neither the schema nor the attribute, and the estate's own documented pattern says a board capability needs six touchpoints. That is an under-scope, not a wrong design — hence amend, not reject.

---

## 1. Who else parses the `summary:` line — the plan is RIGHT, and I could not refute it

Producer, one line:

```
skills/plot/scripts/plot-fleetctl.sh:363
  echo "summary: agents_running=$n_run agents_other=$n_other supervisor=$(supervisor_loaded && echo up || echo down)"
```

I searched `skills/ scripts/ packages/*/src packages/*/test docs/` for `summary:` and for `supervisor=`. The fleetctl summary line has exactly **two** readers on the estate, and NEITHER does a positional or field-count parse:

**Reader 1 — the board, a substring test:**

```
packages/board/src/server/supervisor-reading.ts:63
  const SUMMARY_PREFIX = 'summary:';
...:96
      summarised: run.stdout.includes(SUMMARY_PREFIX),
```

`includes()` on the bare prefix. A new field cannot break it. It is also the only thing the board keeps from stdout — `exitCode` and one boolean; the rest of `stdout` is discarded. (That matters for §4.)

**Reader 2 — the contract test, an anchored prefix match:**

```
test/reconcile/fleetctl.test.mjs:530
  assert.match(r.out, /^summary: agents_running=\d+ /m, 'the summary line the board reads is gone');
```

`agents_running` must stay FIRST and be followed by a space. A field appended after `supervisor=` passes; a field prepended before `agents_running=` fails this test. The plan does not say where the new field goes. **Minor amendment: state that the field is appended, not prepended.**

Every other `summary:` in the estate belongs to a different script (`plot-reap.sh:1045`, `plot-resolve-artifact.sh:129`, the reconcile-scan footer read by `plot-reconcile/SKILL.md:184`). None of them is this line. No `cut -f`, no `awk '{print $N}'`, no field count anywhere against it. **The plan's implicit claim that the summary line is safe to widen is CORRECT and I tried to break it.**

## 2. The optional `SupervisorRun` field — correct, and for a reason the plan does not give

`SupervisorRun` is a domain interface (`rules/supervisor-reading.ts:43`), not a Zod schema, so an optional field costs nothing at the type level. It travels to the verdict through a spread:

```
packages/board/src/server/fleet.ts:7079
  ? supervisorVerdict({ ...entry.supervisor, agentsRunning: liveAgents })
```

The spread carries any new field automatically — no call-site change needed. The plan's claim *"a board reading an older script behaves exactly as today"* holds, because `readSupervisor` builds the object literally (`supervisor-reading.ts:92-97`) and an absent field is `undefined`, which the plan pins to `down`. Good.

**But the plan under-describes the read.** `readSupervisor` today keeps only `code` and `stdout.includes('summary:')`. To carry the install state it must **parse a value out of stdout for the first time** — a new parsing responsibility in a function whose whole doc-comment argues it reads the exit code and treats stdout as a liveness proof only:

```
supervisor-reading.ts:60-66 (TSDoc on `summarised`)
  Read as the CORROBORATION of the exit code and never as a substitute for
  it: the code is the contract, this says the code was the script's and not
  a signal's.
```

Parsing a field out of that same line makes stdout a substitute for the code in one dimension. The design is defensible — the plan keeps the exit code as the up/down contract and adds an orthogonal fact — but this TSDoc is the contract the change contradicts in spirit, and the plan never mentions it. **Amendment: slice 1 must say it is amending that TSDoc, the way this estate amends `plot-host.sh`'s "READ and never write" line rather than quietly breaking it.** A partial read is also now possible (the line present but truncated mid-field); the plan should state that an unparseable field reads as absent → `down`, which is its own fallback rule.

## 3. "three callers read the exit code" — the number is NOT supported

The plan asserts: *"the exit code is unchanged, 0 loaded and 1 not, since it is the board's contract and three callers read it."*

I searched every invocation of `plot-fleetctl.sh --status` on the estate. What actually reads the exit code:

1. `packages/board/src/server/supervisor-reading.ts:95` — `exitCode: run.code`. A real programmatic caller.
2. `test/reconcile/fleetctl.test.mjs:536` — `assert.equal(r.status, 1, 'an unloaded supervisor must still exit 1')`. A test, not a caller.
3. `skills/plot-fleet/SKILL.md:102` — prose: *"Exit 0 means the supervisor is loaded, 1 means it is not, so a caller can gate on it without parsing prose."* A documented promise to a hypothetical caller, not a caller.
4. `skills/plot-fleet/README.md:107` — names `--status`'s exit code as what the test covers.

So: **one programmatic reader, one test, two documentation statements.** "Three callers" is not wrong in a way that changes the decision — keeping the exit code at 0/1 is right regardless — but it is a count the plan states as fact and the estate does not support. This repo rejects plans for resting on unmeasured numbers (the plan's own Notes cite `a-connector-declares-its-ceiling` for exactly that). **Amendment: drop the number or name the three.**

**And the under-scope the question anticipated is real, in the opposite direction from expected.** No caller *needs* the third state via the exit code — there is only one, and it is the board. But `skills/plot-fleet/SKILL.md:102`'s promise *"a caller can gate on it without parsing prose"* becomes **false for the new fact**: the install state is gate-able only by parsing the summary line. A skill sentence that now misdescribes its own script is the estate's named failure mode. **Amendment: slice 1 updates `skills/plot-fleet/SKILL.md` §2.**

## 4. THE STRONGEST FINDING — a fourth `SupervisorState` breaks a closed enum, a cast client, and a DOM attribute, and the plan names none of them

The plan's slice 1 Done-when says only: *"`supervisorState` answers a fourth value"* and *"`supervisorState` answers `down` when the field is absent, pinned by a test."* Slice 2 says only: *"`supervisorVerdict` gains the interrupted case."* Neither slice names a schema, a client, or a renderer.

**(a) The enum is closed and it is in the BOARD package, not the domain.**

```
packages/board/src/contract/schema.ts:3519
  state: z.enum(['up', 'down', 'unknown']),
```

The domain type is a union (`rules/supervisor-reading.ts:29`), but the wire type is this strict Zod enum. A verdict carrying a fourth state **fails `SupervisorSchema` parsing on the server**, where the payload IS parsed. This is a required, unnamed touchpoint in a package neither slice mentions.

**(b) The client CASTS, so the enum is the only guard — and it is on the wrong side.**

```
packages/board/src/app/App.tsx:241
  const data = (await res.json()) as Board | { error: string };
packages/board/src/app/App.tsx:281
  const data = (await res.json()) as Fleet | { error: string };
```

The estate documents this repeatedly (`sections.ts:286`, `:564`, `:617`: *"THE CAST GUARD. The client CASTS the fleet payload (`board as Board`)"*; `fleet.ts:7086`: *"a Zod `.default` never fires client-side"*). The panel prompt's premise about defaults is confirmed — **but for a new `state` value the consequence is not `undefined`, it is worse**: an added enum member silently widens the client's TypeScript type with no runtime check at all, so a renderer branching on `state` gets no compile error for a missing case unless it uses an exhaustive switch. `FleetAlert` does not switch on state at all (see (c)), so nothing fails loudly. The failure is silent and visual.

**(c) The state reaches the DOM verbatim, and a browser test reads that attribute.**

```
packages/board/src/app/components/FleetControls.tsx:360
  data-fleet-supervisor-state={supervisor.state}
```

and the test that reads it:

```
packages/board/test/integration/supervisor-badge.browser.test.ts:235
  expect(await badge.getAttribute('data-fleet-supervisor-state')).toBe('unknown');
```

So a fourth state becomes a fourth attribute value in the shipped artifact. Any selector or test keyed on `[data-fleet-supervisor-state="down"]` — which is the natural way to assert the STOPPED banner — stops matching an interrupted fleet. The plan's slice 2 promises *"one browser test that the badge shows it"* and says nothing about this attribute being the thing that identifies it.

**(d) `supervisorProminence` needs a case and the plan never says which.**

```
rules/supervisor-reading.ts:171-177
  const state = supervisorState(readings);
  if (state === 'unknown') return 'note';
  if (state === 'down' && readings.agentsRunning > 0) return 'alert';
  return 'quiet';
```

A fourth state falls through to `quiet` by default. An interrupted fleet with agents running is **exactly the measured 2026-09-09 failure** — work not happening — yet it would render `quiet`, which `FleetControls.tsx:356` maps to `text-slate-400`: grey, no `role="alert"`, and the detail sentence **not rendered at all** (`FleetControls.tsx:387`: `{loud && <span data-fleet-supervisor-detail…`). The repair the whole plan exists to print would be invisible unless `prominence` is `alert`.

**This is the finding.** The plan's stated goal is that the board print the right repair. Adding a state without deciding its prominence produces a board that prints the right repair **into a `title` attribute nobody hovers** — the precise failure `supervisor-reading.ts:108-113` records as costing an hour on 2026-09-09. The plan cites that measurement and then omits the field that governs it.

**Amendment (required): slice 2's Done-when must name `supervisorProminence`'s new case explicitly, and it must be `alert` when agents are running** — the same rule `down` already has, for the same reason. It must also name `SupervisorSchema`'s enum and the `data-fleet-supervisor-state` attribute as touchpoints.

## 5. "byte-identical" for `down` and `unknown` — testable, and already half-pinned

The claim is testable as stated and the existing tests are close to sufficient:

- `packages/domain/test/supervisor-reading.test.ts:145-161` pins `down`'s label, `6 agents are running`, `1 agent is running`, `nothing is being neglected`, `/plot-fleet --start`.
- `:136-142` pins `unknown`'s label, `could not ask`, `not the same fact`.
- `:165-171` pins `no slice will be picked up` across agent counts 0 and 3.

These are `toContain`, not equality, so they are NOT byte-identical locks — a reworded `down` detail that kept those fragments would pass. **Amendment: if "byte-identical" is the promised property, the test must be `toBe` on the full string, or the word should be dropped in favour of what the existing assertions actually guarantee.** As written the Done-when promises a property no existing test enforces and the plan does not say it is adding one.

**And there IS a cross-state test that a new label must survive:**

```
supervisor-reading.test.ts:188
  const INTERNAL = ['supervisor', 'supervised', 'unsupervised', 'registryd', 'launchd', 'launchctl'];
...:199-203
    expect(verdict.label.toLowerCase()).toContain('fleet');
    for (const word of INTERNAL) expect(verdict.label.toLowerCase()).not.toContain(word);
```

It iterates `everyReading` (`:190-195`) — a hand-listed array of FOUR readings. A fifth state **is not automatically covered**: the loop does not enumerate the type. So the plan's claim that the new sentence *"names a consequence and a repair and mentions no component"* is enforced by nothing unless the new reading is added to that array. **Amendment: slice 2 adds the interrupted reading to `everyReading`.**

Note this test checks `label` only, never `detail`. The plan's slice 2 wants the banner to name `launchctl bootstrap` — which is in `INTERNAL`. That is fine for `detail` and would **fail** if put in `label`. The plan does not distinguish the two fields. **Amendment: say the repair goes in `detail`, and that `label` keeps the fleet vocabulary.**

## 6. One gate the plan will meet without changes

`scripts/check-script-names.sh:82` — `ALLOWED=9`, counting whole-literal `plot-*.sh` strings outside `adapters/`. Its map already carries an entry for this file:

```
check-script-names.sh (ANSWERS map)
  plot-fleetctl.sh	no port answers this yet. It reads whether a supervisor is loaded; that is a `machine` question and the port has no op for it.
```

Slice 1 changes the script and slice 2 changes the rule; neither adds a new whole-literal script name, so the ratchet does not move. The prose mention `plot-fleetctl.sh --status` inside a sentence at `rules/supervisor-reading.ts:246` is explicitly excluded (`check-script-names.sh:51` names that exact line). **No action needed — recorded so the implementer does not rediscover it.**

## What would change my position to proceed

Slice 1 Done-when adds: the field is APPENDED after `supervisor=`; an unparseable field reads as absent; `skills/plot-fleet/SKILL.md` §2 is updated; the `summarised` TSDoc is amended rather than contradicted; the "three callers" number is named or dropped.

Slice 2 Done-when adds: `SupervisorSchema`'s `z.enum` gains the value; `supervisorProminence` gains a case and it is `alert` when agents run; the new reading joins `everyReading`; the repair goes in `detail` and `label` keeps the fleet vocabulary; the browser test keys on `data-fleet-supervisor-state`; and "byte-identical" is either backed by `toBe` assertions or replaced by what is actually pinned.

None of this changes the design. All of it is scope the plan currently leaves for the implementer to discover, and §4(d) is the piece whose omission would ship a fix that does not fix the reported problem.

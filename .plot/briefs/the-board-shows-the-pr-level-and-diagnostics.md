## Implementation brief — info-vs-warning-vs-error-and (wave: Banner)

- **Plan (canonical):** `docs/plans/2026-10-23-info-vs-warning-vs-error-and.md` on `main`
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2426 merged
- **Branch:** `bug/the-board-shows-the-pr-level-and-diagnostics` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This is the second of two slices. `bug/the-pr-status-has-a-level-and-a-cause`
(the Classification wave) is merged (PR #2437) — it shipped the domain value
this wave renders. Nothing else waits on this branch.

### What to build

`packages/domain/src/rules/pr-status.ts` (merged, exported from
`@plot-pm/domain`) now computes `prStatus(input): PrStatus` — `level: 'info' |
'warning' | 'error'`, `kind`, `cause` (the failure text with `plot-host`'s own
notices already stripped out), `backoffInSeconds`, `spenders`, and `notices:
HostNotice[]` (the `ignores --limit` / `page complete` lines, previously
spliced into the sentence). Today's board does not call it at all: the footer
still comes from `prNote` in `packages/board/src/app/lib/agent-rows/host-notes.ts:329`,
which switches on the older `hostErrorState` and string-concatenates one of
three sentences, one of which (`kind === null` fallthrough, `host-notes.ts:370`)
is exactly the measured bug — `` `PR data unavailable (${fleet.prError})` ``
splices the whole raw `plot-host` stderr, notices included, into the reader
sentence.

Wire `prStatus` into the render path:

1. **Call `prStatus` where `prNote` is called today** — `AgentList.tsx:897`,
   inside the status-list builder (not `StatusPanel.tsx` itself, which only
   renders `BoardStatus.text` — see decisions below for why the two cannot
   simply merge).
2. **Print the level and cause as one line**, then **render `notices` in an
   expandable view** instead of folding them into the sentence.
3. **One browser test per level** in
   `packages/board/test/integration/agents-tab.browser.test.ts`, extending
   the existing three `prNote` tests (outage/unreachable at line ~3848,
   rate-limited at ~3874, freshness-isolation at ~3899) rather than replacing
   their assertions — see Done when.

### Decisions the plan settles — do not re-derive them

**The classification is already built; this wave renders it, and must not
build a second one.** `prStatus`'s own doc comment says the same thing the
Classification brief said in reverse: "the component only prints what it
returns." If a case is missing, the fix is a Classification-side change
(report it), not a second detector in `host-notes.ts` or `AgentList.tsx`.

**`BoardStatus.tone` is a closed two-value union — `'rose' | 'amber'`
(`packages/domain/src/rules/default-branch.ts`, `BoardStatus` interface,
doc'd "`rose` for the whole view being gone, `amber` for a lesser state") —
and the domain's three `PrStatusLevel`s do not map onto it 1:1.** `StatusPanel.tsx`'s
`TONE` record (`StatusPanel.tsx:33`) has no third colour. Today's `pr-error`
status entry (`AgentList.tsx:899-904`) is hardcoded `tone: 'amber'` regardless
of severity, so an `error`-level reading (no PR data at all) currently looks
identical to a `warning`. Deciding whether `error` earns `rose` is this
wave's call, not a given — `rose`'s own doc comment ties it to "the whole
view being gone," which a PR-only failure is not (every other row still
renders). If you extend the union, it is a `packages/domain` change (the type
is declared there, re-exported by `StatusPanel.tsx`) and every existing
`rose`/`amber` caller stays unchanged. If you keep two tones and map `error`
to `rose` anyway, say so in the PR description as a deliberate reading of
"whole view" rather than leaving it implicit.

**`info` must keep meaning "no banner," not a new visible state.** `prNote`
returning `null` today means no `pr-error` status is pushed at all
(`AgentList.tsx:898`'s `if (prMessage)` guard) — the absent-when-healthy
contract `StatusPanel.tsx`'s own doc comment states ("ABSENT WHEN EMPTY...a
healthy board is not [watching], so it renders nothing at all"). Push a status
entry for `level === 'info'` only if you have a specific reason to show a
grey/neutral banner even when nothing is wrong — the plan's own table lists an
info example (`PRs from 09:41 · next refresh 09:55`) that reads like an
always-on freshness line, which is a different surface
(`StatusPanel.tsx`'s own doc comment names it: "the view-status line...
answers *how fresh is what I see?*... and stays at the foot," `StatusPanel.tsx:17-22`).
Conflating the two surfaces is explicitly the mistake
`bug/a-degraded-view-says-so-at-the-top` already corrected once (same file's
header comment). If `info` needs to show anywhere, the foot line is the
candidate location, not the status panel — report rather than improvise if
the plan's intent turns out to require touching that line too.

**`prNote` and `issueNote` are not one footer — do not combine them.**
`issueNote` is called separately, at `AgentList.tsx:2551`, inline inside the
"Waiting on you" issues group, gated on `fleet.issueAnswer === 'failed'` — a
different call site, different condition, different JSX location from the
`pr-error` status pushed at `AgentList.tsx:897`. The plan's own Open Questions
list "does `issueNote` take the same three levels" as unanswered, and the
Slices section names no branch for it. This wave touches only the PR path;
leave `issueNote` as it is.

**`intervalSeconds` — `prStatus`'s required input — has no source on the
wire today.** The server has `PR_REFRESH_MS = 60_000`
(`packages/board/src/server/fleet.ts:181`, milliseconds) and an internal
`prIntervalMs` field on a server-side type (`fleet.ts:717`, set from the
constant at `fleet.ts:2659`), but neither is serialized onto the `Fleet` Zod
schema (`packages/board/src/contract/schema.ts`) the client receives. Two
options, pick one and say which: (a) add `prIntervalMs` to the schema
(`z.number().nullable().default(null)`, matching the nullable-on-old-server
pattern every sibling field here already follows — `prNextInSeconds`,
`scanNextInSeconds`) and pass `prIntervalMs / 1000` into `prStatus`'s
`intervalSeconds`; or (b) hardcode the known constant client-side
(`60` seconds) since today only one value has ever shipped. (a) is more
correct if the interval can ever change per-board; (b) is less code for a
value that has not varied since `PR_REFRESH_MS` was introduced. The plan's own
Open Question ("fleet's PR refresh cadence or the board's poll interval")
is answered by `prStatus`'s doc comment — the fleet's refresh cadence, because
that is what `ageSeconds` dates (`prAgeSeconds` dates the host fetch, not the
git scan — `host-notes.ts`'s own `hostAnswer` doc comment already draws this
line and warns against conflating the two clocks).

**No existing `<details>` pattern in this codebase — two real candidates,
pick the one that fits a per-status disclosure, not a per-row one.**
`packages/board/src/app/lib/agent-rows/collapse.ts` backs section-header
folding with a `localStorage`-persisted `Set` (`readCollapsed`/
`writeCollapsed`), because that state survives a reload by design. A PR
footer's diagnostics are tied to the status currently shown in the pager
(`StatusPanel`'s own `index` state already resets when the stack changes,
`StatusPanel.tsx:160-163`), so persisting disclosure across reloads is very
likely the wrong model here — the closer precedent is
`packages/board/src/app/components/AgentPanelFacts.tsx`'s `CommandFact`
component (`AgentPanelFacts.tsx:260-293`): a local `useState(false)` toggle
with `aria-expanded` and a "Show more"/"Show less" `<button>`, no persistence.
If `StatusPanel` itself needs the toggle (rather than a wrapper the status
builder constructs), note that `StatusPanel`'s `BoardStatus.text` is a plain
string today (`default-branch.ts`'s `BoardStatus` interface) — carrying
`notices` through means either extending `BoardStatus` with an optional
`notices?: HostNotice[]` field (domain-side, since `BoardStatus` is declared
there) or rendering the diagnostics view as a second element beside
`StatusPanel` in `AgentList.tsx` rather than inside it. Either is defensible;
report which you chose and why in the PR description, since both touch a
type other call sites read (`defaultBranchStatus`, `scanHostNote`, the
`stale`/`scan-failed`/`shrink` entries all construct `BoardStatus` without a
`notices` field, so an optional field is additive and does not break them).

**Absent is not false, carried through unchanged.** `prStatus`'s own
contract: `cause`, `backoffInSeconds`, `spenders` and `notices` can each be
null/empty, meaning "not applicable" or "not known" — never render a null
backoff as "now" or a null spender count as zero. This is the same rule the
Classification brief stated and the domain's tests assert
(`pr-status.test.ts`, "a null spender count stays null, never zero").

### Done when

The plan's `## Done when` is implicit in its Design section and the issue's
own three-row table — these are the assertions a naive implementation would
otherwise skip:

- One browser test per level proves the banner text for that level —
  reusing or extending the existing fixtures in
  `agents-tab.browser.test.ts` (`fleet({ prAgeSeconds: null, prError: 'gh: 503' })`
  for error/outage at ~line 3848; `fleet({ prAgeSeconds: null, prError:
  <quota string>, prNextInSeconds: 480 })` for the quota/warning case at
  ~line 3874) plus at least one fresh-cache `info` fixture
  (`prAgeSeconds` small, `prError: null`) proving **no** `pr-error` status
  renders, matching the "absent when healthy" contract.
- A test proves the measured Bitbucket string
  (`BITBUCKET_NOTICES_ONLY` in `packages/domain/test/pr-status.test.ts`) no
  longer appears verbatim in the banner's visible text — the `ignores
  --limit` / `page complete` substrings must be absent from `[data-status-text]`
  and present only in the expandable diagnostics view.
- A test proves the 429-and-backoff case (`THROTTLED_FAILURE` +
  `nextInSeconds` in the same domain test file) shows a cause naming the
  failure and a backoff-end time in the banner sentence, where today's
  Motivation-section example showed neither.
- The existing `prNote`/`hostErrorState` tests that are not being replaced
  (e.g. "shows the WHOLE PR error, however long the path in it",
  ~line 3935) either still pass or are deliberately superseded — if `prNote`
  itself is deleted or its signature changes, say so in the PR description,
  since `issueNote` (`host-notes.ts:392`) and `scanHostNote` still read the
  older `hostErrorState`/`resetPhrase` helpers this wave does not touch.

Plus the repo's gates: a changeset is required (`'plot': patch` or `minor`
per CLAUDE.md's Versioning section, package `plot` or `@plot-pm/board`
depending which package's version moves — this slice touches
`packages/board`, so `@plot-pm/board` is the likely package). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the suites in the `CI suites` config key run in CI, and a
failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows
past its merge base — this slice is TypeScript/TSX-only and should not touch
shell, so this gate should pass with no action. If `BoardStatus` grows a
`notices` field, that is a `packages/domain/src/rules/default-branch.ts`
change and must keep the arrow-function style (CLAUDE.md § The Domain
Package) — it already uses arrows throughout.

Board impact is already declared in the plan's Changelog: footer wording and
a diagnostics view in `packages/board`, no change to plan format, template,
helper scripts or `docs/plans` layout — the Definition of Done's board-impact
consideration is pre-answered by the plan itself.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. Push the first real commit as soon as it
exists — do not wait for the whole slice to be done before the branch has a
claim and a commit history a reviewer can follow. Once the PR exists, append
`→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/board/src/app/components/AgentList.tsx` (the
status-list builder around line 897), `packages/board/src/app/components/StatusPanel.tsx`
(if the disclosure lives inside the panel), `packages/board/src/app/lib/agent-rows/host-notes.ts`
(`prNote` and friends — rewrite or retire as this wave decides), and
`packages/board/test/integration/agents-tab.browser.test.ts`. It may also
touch `packages/domain/src/rules/default-branch.ts` (`BoardStatus` interface)
and `packages/board/src/contract/schema.ts` (`prIntervalMs`, if option (a)
above is chosen) — both are shared types other call sites read, so a change
there is additive-only (new optional fields), never a removal or rename of
an existing one.

This branch does **not** own `packages/domain/src/rules/pr-status.ts` or
`packages/domain/test/pr-status.test.ts` — that is the Classification wave,
merged, and this wave only consumes its exports (`prStatus`, `prStatusLevel`,
`extractHostNotices`, `PrStatus`, `PrStatusLevel`, `HostNotice`, all
re-exported from `@plot-pm/domain`). If a gap is found in what the
Classification value returns, report it rather than patching
`pr-status.ts` from this branch — the file already shipped as its own
reviewed PR (#2437).

No other branch of this plan is pushed as of 2026-10-23 — verify with
`git ls-remote --heads origin 'bug/the-*'` before assuming that still holds.

If you find something the plan did not anticipate — in particular, if the
tone question (does `error` get a new `rose`-equivalent, or share `amber`)
or the disclosure-location question (inside `StatusPanel` vs. beside it)
turns out to need a design call bigger than this brief can settle — report
it rather than improvising a resolution that a reviewer would have to
re-derive from the diff.

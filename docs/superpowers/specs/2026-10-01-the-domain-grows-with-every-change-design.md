# The domain grows with every change

Design spec, agreed 2026-10-01. It states the gates that make every feature or change request grow the domain, in a DDD architecture of three explicit layers.

## Goal

A change designs a domain concept before it writes behaviour, and behaviour lands in the Domain or Application layer rather than in shell or in board server files. The three layers, Domain, Application and Services, become explicit over time, and each becomes its own package once its map is complete.

## Measured starting point

Measured on `main`, 2026-10-01:

- `packages/domain/src` holds about 33,600 lines of TypeScript: `entities` (28 files), `rules` (49), `transitions` (12), `workflows` (14), `ports` (19), `adapters` (42).
- The shipped shell estate (`skills/plot/scripts/*.sh`) holds 13,850 code lines; `packages/board/src/server` holds 13,714.
- 44 of 58 shipped `plot-*.sh` scripts are named by no domain adapter.
- Skills invoke a `plot-*.sh` by path 108 times and reach a controller 13 times.
- The Domain and Application directories hold 949 exports in 103 files; none links to a concept.
- The concept specs are 22 `DESIGN-*.md` files under `docs/stories/the-master-agent-holds-the-fleet/`.
- CI holds the inner boundary (the purity gate, the vendor gate, *One place reaches a script*) and two ratchets: *A script is named in an adapter* at 9 of 9, and *One place reaches a process* at 20 against an allowance of 28.
- On 2026-10-01 three changes put domain rules in shell and CI passed all three: the release-scope rule in `plot-fleet-scan.sh` (#1117, #1120), and a first draft of the free-agent check (#1124).

## The layers

| Layer | Holds | May import |
|---|---|---|
| Domain | entities, rules, transitions, and the ports rules need | `zod` and Domain code |
| Application | use cases, and the ports only use cases need | Domain |
| Services | adapters implementing ports (domain adapters, shell scripts, the HTTP server, the UI) and driving adapters (skills, `board/*.mjs` entries, `/api/*` routes) | Application and Domain |

An import points inward or stays in its layer. A port is an interface owned by the inner layer that needs it; Services hold only the adapters that implement ports.

## The concepts and the glossary

A **Concept** is a glossary entry: a name, a one-sentence definition, a **Layer**, and a **Concept status** of `implemented` or `planned`. The glossary is `docs/domain/`, one file per Concept, moved from the 22 `DESIGN-*.md` specs. Each file opens with:

```
# Slice
A Slice holds exactly one branch and belongs to one plan.
- Layer: Domain
- Concept status: implemented
```

A **Terms** list follows for the smaller words that belong to the Concept, then the design text. `docs/domain/README.md` lists names and links only. The story keeps links to the Concept files.

Code links to a Concept with `@concept <name>` in a module's top TSDoc. A file may name several Concepts, and an export may override its file's tag.

## Slice Kind

`SliceKind` is `implementation`, `concept` or `spike`, in `entities/`. A Slice is a discriminated union on it. A plan declares it with a `- **Kind:** <kind>` line under the slice heading; an absent line means `implementation`.

| Kind | Properties | Settled when |
|---|---|---|
| `implementation` | `Branch` (heading), `waits:`, `deferred:`, `PR` | its branches merge |
| `concept` | `Branch`, `Concept:`, `Layer:` | its branch merges with the Concept file, whose header agrees with the slice |
| `spike` | `Branch`, `Question:`, `Finding:` | `Finding:` is written; the branch may close unmerged |

A property outside the slice's kind is a parse finding. `Concept status` lives on the Concept file only. A Concept slice's `Layer:` is the plan's dated record of the decision; the Concept file is the living entry, and the two must agree when the slice merges.

The plan phase decides which kinds are dispatchable: `Design` dispatches `spike` and `concept` slices, and `Approved` dispatches every kind. Wave order is unchanged. The board shows a slice's kind beside its name when it is not `implementation`.

Plan Kind (`standard` or `tracer-bullet`) is a separate Concept, entered as `planned` in `docs/domain/plan.md` and designed by its own plan.

## The gates

### Gate A: the outside-domain budget

- **Counts:** non-comment code lines in shipped shell (`skills/plot/scripts/*.sh`) plus every `packages/board/src/server` file that `layers.json` does not assign to `domain` or `application`.
- **Excludes:** `packages/domain/src/adapters/`, tests, generated bundles, comments and blank lines.
- **Rule:** a change may not raise the count over its merge base. CI prints both counts and the files that grew. There is no escape marker: a change that must add Services code offsets it in the same change.
- **Starts at:** 27,564.
- **With it:** *One place reaches a process* tightens from 28 to its measured 20.

### Gate B: every Domain and Application file names a Concept (`check-concepts`)

1. A `@concept` tag names a file in `docs/domain/`.
2. A Concept's `Layer:` matches the layer `layers.json` gives every file tagged with it.
3. A Concept marked `implemented` is named by at least one tagged file; one marked `planned` is named by none.
4. A new file in the Domain or Application layer carries a tag. Untagged existing files form a ratchet starting at 103 that may only fall.
5. `docs/domain/README.md` lists exactly the Concept files present.

The plan template gains an optional `Concepts:` line in `## Status`, naming the Concepts a plan adds or changes.

### Gate C: imports point inward (`check-layers`)

- `layers.json` assigns each directory or file, by glob, to `domain`, `application`, `services` or `unassigned`.
- First map: `domain/src/{entities,rules,transitions}` → domain; `domain/src/workflows` → application; each port in `domain/src/ports` individually; `domain/src/adapters` → services; `packages/board/src/app` → services; `packages/board/src/server` → `unassigned`, file by file.
- The gate resolves every TypeScript import through the map and refuses an outward one. An `unassigned` file may import anything; the count of `unassigned` files is a ratchet that may only fall.
- The purity gate becomes the gate's first rule.
- A layer whose `unassigned` count reaches zero, and has passed the gate for two consecutive weeks, splits into its own workspace package (`@plot-pm/domain`, `@plot-pm/application`, `@plot-pm/services`); pnpm's dependency check then enforces its direction. Services may split further, for example into the board UI and HTTP server, the shell estate, and the adapters.

### Gate D: skills call controllers (`check-skill-calls`)

- Counts script invocations by path in `skills/*/SKILL.md` and the `.md` files a skill references; a name inside prose does not count, by the quote boundary `check-script-names.sh` uses.
- The count may not grow over the merge base. A new skill that calls a script fails.
- Migration order: lifecycle writes first (dispatch, approve, deliver, sprint state, release), then read scripts as each gains a `plot-ask.mjs` verb.
- `plot-controller-gate.sh` adds each script whose skill callers have moved to a controller.
- Starts at: 108.

## Rollout

Each step is one plan, and a plan that adds a Concept starts with its Concept slice once Slice Kind exists.

1. The glossary and gate B.
2. The layer map and gate C.
3. Gate A, and the spawn ratchet at 20.
4. Slice Kind, starting with a concept slice for `SliceKind`.
5. Gate D and its migration order.
6. Plan Kind and tracer bullets, the first Concept designed under all four gates.

Steps 1 to 3 change no behaviour. Step 4 is the first feature built under them.

## Testing

Every gate has a contract test in `test/reconcile/`, after `script-name-gate.test.mjs`: the repository's tree passes; a fixture tree carrying the violation fails and the output names it; a ratchet allowance above the measured count fails.

## Work in flight

- #1125 adds `scripts/check-state-inventory.mjs`. It is repository tooling under `scripts/`, which gate A does not count.
- The release-scope rule in `plot-fleet-scan.sh` (#1117, #1120) moves into `rules/` as gate A's first offset. The scan runs once per pass, so it keeps a duplicate held to the rule by a corpus test, per `docs/shell-and-domain.md`.

## Out of scope

- Plan Kind and tracer-bullet rules: their own plan.
- Rewriting the 44 scripts without an adapter: gate C's map and gate D's migration move them one change at a time.

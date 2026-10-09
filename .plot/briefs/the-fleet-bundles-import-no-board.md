## Implementation brief — the-fleet-runs-without-the-board (wave 1: The bundles stop importing the board)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-fleet-bundles-import-no-board` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave comes first. `feature/the-fleet-package-exists` moves the same entries into a new package and waits on this wave, because it cannot move modules that still import `board.ts`. Nothing else in the plan builds on this wave directly, and no sibling branch is pushed at dispatch (`git ls-remote` on 2026-10-09 listed none).

### What to build

`plot-registryd.mjs` and `plot-worker-loop.mjs` are built from `entry/registryd-main.ts` and `entry/worker-loop.ts`. Both import board modules, and those modules import more board modules. Measured 2026-10-09 with an esbuild metafile over each entry: 36 modules under `packages/board/src/server/` (outside `entry/`) feed `registryd-main.ts`, and 31 feed `worker-loop.ts`. The list includes `board.ts`, `fleet.ts`, `dispatch.ts`, `continue.ts`, `agent-panel.ts` and `controllers/caller.ts`. The fleet cannot become its own package while its entries pull in the board's graph.

The change cuts the edges that pull the graph in. Seven import sites, named in plan table *Build dependencies*:

- `registryd-main.ts:113` and `:54` take `readConfig` and `readConfigAsync` from `board.js`. These read a `## Plot Config` key through a script. Move them to a module with no board import.
- `registryd-main.ts:114` takes `continueOnDesk` from `continue.js`. Find what the supervisor needs from it and move that, or accept it as an injected function.
- `registryd-main.ts:53` takes `readFleetSettings` from `fleet-settings.js`, and `:96` takes `gatherReadingsAndRelease` from `release-claim.js`. The plan says both import `node:http`, so split the reader from the HTTP handler.
- `worker-loop.ts:75` takes the constant `CONTINUATION_NAME` from `continue.js`. `continue.ts:76` defines it. Move the constant to the domain or to a small module with no imports.
- The remaining `registryd-main.ts` imports (`registry.js`, `worker-question.js`, `escalations.js`, `supervisor.js`, `queue-reading.js`, `registryd.js`, `process-log.js`) are board files that may themselves import `board.ts` or `fleet.ts`. Follow each one with the metafile and cut the edge where it leaves the allowed set.

The done state: `registryd-main.ts` and `worker-loop.ts` import nothing from `packages/board/src/server/` outside `entry/`, directly or through another module. That matches plan section *Approach*, item 1. Nothing changes at runtime. The plan stays canonical; this brief orients.

### Decisions the plan settles — do not re-derive them

**The proof is the module graph, not the bundle text.** A test that greps the shipped bundle for `node:http` passes today without any change. Measured 2026-10-09: `plot-registryd.mjs` (498,831 bytes) and `plot-worker-loop.mjs` (1,456,545 bytes) hold zero `node:http` and zero `createServer`, because the bundler already dropped the unused exports. A grep for `buildBoard` also finds nothing, for the same reason. The shipped files are minified with `legalComments: 'none'`, so no `// src/server/board.ts` marker survives either. A bundle-text grep therefore cannot fail, and a test that cannot fail proves nothing.

**Use an esbuild metafile.** Build each entry again inside the test with `metafile: true` and the same options as `build.mjs:402-413` and `:430-440`. Assert that no key of `metafile.inputs` matches `^src/server/(?!entry/)` (adjust to the path form the metafile gives from the package directory). Name the offending input in the failure message. `worker-loop.ts` needs `external: ['@anthropic-ai/claude-agent-sdk']` in a test build, or the resolve fails, as it did in the 2026-10-09 measurement.

**The fix is the import graph, not a bundler flag.** Marking `node:http` external, wrapping a handler in a lazy `import()` or tree-shaking harder would pass a test and leave the dependency in the source. Waves 2–5 then move the same tangle into a new package. Split a module along the line between "reads or acts" and "answers an HTTP request". The HTTP handlers stay where they are and import the moved pieces back.

**Check the shipped file as well as the graph.** Besides the metafile test, read `skills/plot/scripts/board/plot-registryd.mjs` and `plot-worker-loop.mjs`, not `dist/`: the shipped copy is what a project runs, and `build.mjs:415` copies it, so a build can leave `dist/` fresh and the copy stale. Assert there is no `node:http` in either. That assertion is a guard, and the metafile is the proof.

**Out of scope.** `plot-ask.mjs` imports `board.js`, `estate.js` and `controllers/fleet-state.js` and stays that way until wave 4 replaces what `fleet-state.ts` reads. `plot-fleet-size.mjs` is already clean; include it in the test as a guard and do not edit it.

**The allowed set is `entry/` plus the domain.** Domain code arrives as `../domain/src/...` inputs. Do not widen the assertion to permit a board module "for now". A listed exception makes the next import free.

**`@plot-pm/domain` is the destination for pure logic; a small shared module is the destination for IO helpers.** The plan allows either for `CONTINUATION_NAME`, `readConfig` and the fleet-settings reader. Follow the layering rule in `CLAUDE.md`: a reader that touches the filesystem or runs a script belongs behind a port with an adapter, and a constant or a pure parse belongs in `rules/`. New domain code uses arrow functions and factual TSDoc. Do not rewrite the neighbouring `function` declarations in a board file that you only pass through.

**Keep the shipped bundle names and paths.** `plot-fleetctl.sh:117`, `plot-worker-loop.sh:15` and `plot-dispatch.sh:2409` launch them by path under `skills/plot/scripts/board/`. The next wave builds the same three names from a new package.

**Rules carried over unchanged:**

- Absent is not false. A config key that is missing returns its fallback, and a reader that cannot read returns that fallback, not an empty string that the caller reads as a decision.
- Read the exit code, not the emptiness of stdout.
- The fleet-settings reader is read fresh on every call and caches nothing (`fleet-settings.ts:180-186`). Keep that property when it moves; a second board process and the supervisor read the same file.

### P10 and #1307

The slice also verifies #1307, *Stopping the board kills every agent /api/continue started* (open on 2026-10-09). `continue.ts:1049-1101` re-parents the started loop so that `plot-boardctl.sh`'s `tree_pids` (`:174`) no longer finds it. That landed in `9c344e414` (#1351, 2026-10-08), and the issue stayed open.

Verify it in a sandbox repository, not in this one and not against the operator's board. Start a board, continue an agent under it with a stand-in `claude` (`packages/board/test/fixtures/fake-claude`), run `plot-boardctl.sh --stop`, and check the agent's pid with `kill -0`. Wait on that pid, not on a process name. Then act on the result:

- The agent survives: comment the evidence on #1307 and close it in the PR description.
- The agent dies: file what remains as a new issue linked from #1307, and say so in the PR. Do not fix `plot-boardctl.sh` in this branch; that is outside the slice.

Do not run `plot-boardctl.sh --stop` against any board you did not start yourself. The operator's board is not a fixture.

### Done when

The plan's slice line is the specification: `registryd-main.ts` and `worker-loop.ts` import nothing from `packages/board/src/server/` outside `entry/`; a bundle test proves no `node:http` and no `board.ts` code ships in either; #1307 is verified.

Assertions that exist because a naive implementation would pass without them:

- **The test names a module, not a string.** It reads the metafile's inputs and fails with the path of the first board module found. A `node:http` grep passes before the change, so it cannot show the change worked.
- **The test fails on the base.** Before you commit the cut, run the new test on the unmodified entries and see it fail with 36 and 31 inputs. A test never seen failing is not a test of this change. Then mutate one import back (`import { readConfig } from '../board.js'`) and see it fail again by name.
- **A transitive import counts.** Importing `release-claim.js` directly is not the only way back in; `release-claim.ts` imports `node:http` and may import a board file. The metafile covers transitive edges. A per-file source grep of the two entries does not.
- **The shipped names stay.** `plot-registryd.mjs`, `plot-worker-loop.mjs` and `plot-fleet-size.mjs` still build to `skills/plot/scripts/board/`, and `plot-fleet-size.mjs` has no board import before or after (plan table, last row but one).
- **Behaviour is unchanged.** The existing `packages/board/test/worker-loop-bundle.test.mjs` and the registryd tests pass unmodified. If one needs editing to pass, the cut changed behaviour.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.
- Add a changeset under `.changeset/`: package `'@plot-pm/board'` (or `plot` if the plan's bumps need skills), description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md`. Run `./scripts/check-changeset-packages.sh`.
- Do not commit rebuilt bundles. `main` builds them after each merge, and `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Run `pnpm build:board` to test, then restore the generated paths before you push.
- `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove shell elsewhere in the same change. The gate stores no number and has no override.
- The CI spawn ratchet (`ci.yml:333`, `allowed=28`) counts `spawn` and `execFile` in `packages/**/*.ts`. Moving a helper must not add a site; moving one that spawns should not raise the number.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, with `--draft` while the work moves. Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### The bundles stop importing the board` in the plan's `## Slices` section.

Push the first real commit as soon as it exists, so the claim shows work.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/registryd-main.ts` and `entry/worker-loop.ts` (import lines)
- the modules you move or split: `board.ts` (`readConfig`, `readConfigAsync`), `continue.ts` (`CONTINUATION_NAME`, and what `continueOnDesk` needs), `fleet-settings.ts`, `release-claim.ts`, and whichever of `registry.ts`, `supervisor.ts`, `escalations.ts`, `queue-reading.ts`, `registryd.ts`, `worker-question.ts` and `process-log.ts` the metafile names
- new files under `packages/domain/src/` for what moves there
- the new bundle test beside `packages/board/test/worker-loop-bundle.test.mjs`

This branch does not own, and must not edit:

- `packages/board/build.mjs` entries or output names (the next wave moves them)
- `plot-fleetctl.sh`, `plot-boardctl.sh`, `plot-worker-loop.sh`, `plot-dispatch.sh`
- `fleet.ts` logic: auto-dispatch, auto-delivery and the PR index write stay in the board until waves 4 and 5
- `CLAUDE.md`'s `plot-ask.mjs` sentence (wave 5 corrects it)

Branches in flight: none pushed for this plan on 2026-10-09. `one-agent-pass-costs-what-its` is approved and its first slice (`feature/the-pass-is-measured`) adds `scripts/measure-pass.mjs` and edits `docs/shell-and-domain.md`. It touches none of these files, but it measures `plot-worker-loop`, so keep the loop's behaviour unchanged here.

If you find something the plan did not anticipate — for example a cut that needs a behaviour change, or an import the metafile shows that no listed move removes — report it rather than improvising outside scope.

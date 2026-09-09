// Bundle the server + the built client into one self-contained artifact.
//
//   vite build   → dist/client/index.html   (single inlined HTML file)
//   node build.mjs → dist/board-server.mjs   (server with that HTML embedded)
//
// The artifact is then copied to skills/plot/scripts/board/board-server.mjs so
// the plot plugin ships a runnable, dependency-free board with no install step.
// This copy is what the release pipeline commits and CI diffs for freshness.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = path.join(here, 'dist/client/index.html');
if (!fs.existsSync(clientHtml)) {
  console.error('Missing dist/client/index.html — run `pnpm run build:client` first.');
  process.exit(1);
}

// The prose the generated module carries, held apart from the loop that fills
// it so the explanation a reader meets in `bundles.generated.ts` is readable
// here too. A generated file explaining itself is the only way its reader
// learns not to edit it.
const BUNDLES_HEADER = `/**
 * THE BUNDLES \`build.mjs\` EMITS — GENERATED, NEVER EDITED BY HAND.
 *
 * Written by \`packages/board/build.mjs\` from its own shipped-bundle
 * declarations, which are what an author writes when adding a bundle. Edit the
 * build; run \`pnpm build:board\`; this file follows.
 *
 * ## Why this file exists rather than a list in the contract
 *
 * The list was typed out in \`contract/schema.ts\` and drifted three times in one
 * evening — 9, then 10, then 11 entries against a build emitting one more each
 * time. Every drift surfaced as an UNRELATED branch's CI failing on a bundle it
 * never touched, which is the failure this removes: a bundle added in one PR
 * must not be able to fail another branch's CI.
 *
 * ## Why generated rather than derived at import time
 *
 * The contract is bundled INTO the artifacts it describes, and a bundle must not
 * read the repository to load. \`src/server/stuck.ts\` and \`src/server/resolver.ts\`
 * both consume this inside the served bundle, so the value has to be a
 * compile-time constant. Making the contract \`import('../../build.mjs')\` would
 * drag esbuild's config into the served bundle, which is the one thing this
 * change may not do.
 *
 * ## Why committed rather than ignored
 *
 * \`pnpm run typecheck\` runs \`tsc --noEmit\` with no build, and CI runs it BEFORE
 * \`build:board\`. An ignored file would fail typecheck on a fresh clone. Being
 * committed, its freshness is asserted by
 * \`test/reconcile/resolveartifact.test.mjs\`, which compares this file, the
 * shell's \`bundle_set\` and \`build.mjs\` as SETS — the same test that used to
 * assert somebody had remembered, now asserting the derivation ran.
 *
 * ## It is a bundle INPUT, not a bundle output
 *
 * So it carries no \`-merge\` mark. \`.gitattributes\` marks the twelve \`.mjs\`
 * artifacts, whose licence is a deterministic rebuild that overwrites whichever
 * side a merge kept. This is TypeScript source holding one sorted array; a
 * conflict here is a real conflict about which bundles exist, and reading it is
 * the correct resolution.
 */
export const BOARD_ARTIFACT_PATHS: readonly string[] = [
`;

// THE BUNDLE SET, DERIVED FROM THIS FILE AND WRITTEN FOR THE CONTRACT TO IMPORT.
//
// FIRST, before any esbuild call, because the contract it feeds is bundled INTO
// every artifact below. Generating afterwards would ship the previous run's set.
//
// The declarations below are the source — each binds a `shipped<Name>` const to
// a `path.join` of `here` and a repo-relative path — and that is what an author
// readers now derive from it rather than restating it — this generator,
// `scripts/check-bundle-attributes.sh`, and `plot-resolve-artifact.sh`'s
// `bundle_set()`. The contract used to be a fourth DEFINITION, typed out by
// hand, and it drifted three times in one evening: 9, then 10, then 11 entries
// against a build emitting one more each time. Each drift surfaced as an
// unrelated branch's CI failing on a bundle it never touched.
//
// It reads its own source rather than a list of the `shippedX` bindings. That
// is deliberate and is what makes the derivation total: a binding this file
// forgot to append to such a list would be invisible, which is the same defect
// one level down. The regex is the one the other two readers use, so a build
// that changes shape breaks all three together rather than silently blinding
// one — and finding nothing is a hard failure here for that reason.
const generatedBundles = path.join(here, 'src/contract/bundles.generated.ts');
{
  const source = fs.readFileSync(path.join(here, 'build.mjs'), 'utf8');
  const emitted = [
    ...new Set(
      [...source.matchAll(/shipped[A-Za-z]* = path\.join\([^)]*'\.\.\/\.\.\/([^']*)'\)/g)]
        .map((m) => m[1]),
    ),
  ].sort();
  if (emitted.length === 0) {
    console.error('No shipped bundles found in build.mjs — the derivation is blind.');
    // The shape is described in PIECES rather than spelled out. A complete
    // A complete declaration written anywhere in this file — including in a
    // comment ABOUT the derivation — is matched BY the derivation and lands
    // in the set as a bundle nothing emits. The pattern spans newlines, so a
    // wrapped comment matches too. Measured while writing this: two such
    // comments put `<path>` and an ellipsis into the derived set.
    console.error("It reads `const shipped<Name>` bound to a `path.join` of here and a repo-relative path.");
    console.error('Finding none means the build changed shape. Fix the derivation, not this file.');
    process.exit(1);
  }
  const generated = `${BUNDLES_HEADER}${emitted.map((b) => `  '${b}',\n`).join('')}];\n`;
  // Written only when it would CHANGE. `node --watch` serves the board during
  // development and restarts on any write under `src/`, so an unconditional
  // rewrite of a file inside the watched tree makes every build restart the
  // running board for a byte-identical result.
  if (!fs.existsSync(generatedBundles) || fs.readFileSync(generatedBundles, 'utf8') !== generated) {
    fs.writeFileSync(generatedBundles, generated);
  }
}

const distArtifact = path.join(here, 'dist/board-server.mjs');
const shippedArtifact = path.join(here, '../../skills/plot/scripts/board/board-server.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: distArtifact,
  loader: { '.html': 'text' },
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.mkdirSync(path.dirname(shippedArtifact), { recursive: true });
fs.copyFileSync(distArtifact, shippedArtifact);
fs.chmodSync(shippedArtifact, 0o755);

// The master agent's entry point: the same controller, reached without HTTP.
//
// A SECOND artifact rather than a flag on the first. `src/server/index.ts`
// binds a port at import time, so a skill asking a question through it would
// also start a server and have to be told to stop. Both bundles share every
// line below the controller and differ only in who calls it.
//
// No `.html` loader and no client build: this entry point serves no page, and
// bundling the inlined client into it would carry ~1 MB of markup into an
// artifact that prints JSON.
const askArtifact = path.join(here, 'dist/plot-ask.mjs');
const shippedAsk = path.join(here, '../../skills/plot/scripts/board/plot-ask.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: askArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(askArtifact, shippedAsk);
fs.chmodSync(shippedAsk, 0o755);

// The eligibility rule, reachable from the scan that needs it.
//
// A THIRD artifact rather than a verb on plot-ask.mjs, because plot-ask.mjs
// answers `board` and `fleet` by RUNNING plot-fleet-scan.sh — the script that
// would be asking. Separated, the scan calls a bundle that spawns nothing.
//
// It is also ~40x per scan on the 5 s pulse path, so the import cost is paid
// per plan; this entry pulls in the rule and its schema rather than the board.
const verdictsArtifact = path.join(here, 'dist/plot-verdicts.mjs');
const shippedVerdicts = path.join(here, '../../skills/plot/scripts/board/plot-verdicts.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/verdicts.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: verdictsArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(verdictsArtifact, shippedVerdicts);
fs.chmodSync(shippedVerdicts, 0o755);

// The move refusals, reachable from the migration that needs them.
//
// A FOURTH artifact, for the reason the third one gives: plot-ask.mjs answers
// by RUNNING plot-fleet-scan.sh, so a dispatcher asking it would be an artifact
// calling a script that calls the dispatcher.
//
// A BUNDLE rather than plot-reap.sh's inline heredoc, and the difference is the
// npm layout. The reaper imports packages/domain/src/rules/reapable.ts through
// a path derived from its own checkout; plot-dispatch.sh is vendored into the
// published package, where `packages/` does not exist, so that shape would make
// every migration report "the rule could not be asked" and keep every worktree.
const movableArtifact = path.join(here, 'dist/plot-movable.mjs');
const shippedMovable = path.join(here, '../../skills/plot/scripts/board/plot-movable.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/movable.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: movableArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(movableArtifact, shippedMovable);
fs.chmodSync(shippedMovable, 0o755);

// The lifecycle transition, reachable from the two scripts that write it.
//
// A FIFTH artifact, for the reason the third and fourth ones give: plot-ask.mjs
// answers by RUNNING plot-fleet-scan.sh, and the board's approve route SPAWNS
// plot-approve.sh — so a script asking it would be a script calling an artifact
// that calls the script.
//
// Vendored beside plot-approve.sh and plot-deliver.sh, which resolve it from
// their own $script_dir. Both are shipped in the published npm package, where
// `packages/` does not exist, so an inline import of the domain source would
// resolve only in the plot checkout.
const transitionArtifact = path.join(here, 'dist/plot-transition.mjs');
const shippedTransition = path.join(here, '../../skills/plot/scripts/board/plot-transition.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/transition.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: transitionArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(transitionArtifact, shippedTransition);
fs.chmodSync(shippedTransition, 0o755);

// Which prompt an agent runs, reachable from the loop that launches it.
//
// A SIXTH artifact, for the reason the third, fourth and fifth ones give:
// plot-ask.mjs answers by RUNNING plot-fleet-scan.sh, so a worker loop asking
// it which prompt to source would start a whole scan on its launch path.
//
// Vendored beside plot-worker-loop.sh, which resolves it from its own
// $script_dir. The loop is shipped in the published npm package, where
// `packages/` does not exist, so an inline import of the domain source would
// resolve only in the plot checkout — and every worker elsewhere would take the
// fallback prompt without anything saying it had.
const promptArtifact = path.join(here, 'dist/plot-prompt.mjs');
const shippedPrompt = path.join(here, '../../skills/plot/scripts/board/plot-prompt.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/prompt.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: promptArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(promptArtifact, shippedPrompt);
fs.chmodSync(shippedPrompt, 0o755);

// The task state, reachable from the classifier that answers it.
//
// A SEVENTH artifact, for the reason the third, fourth, fifth and sixth ones
// give: plot-ask.mjs answers by RUNNING plot-fleet-scan.sh, and that scan
// SOURCES plot-worker-state.sh — so the classifier asking it would be a script
// calling an artifact that calls the script.
//
// It is also once per branch on the 5 s pulse path, so the import cost is paid
// per branch; this entry pulls in one rule and no schema.
const taskArtifact = path.join(here, 'dist/plot-task.mjs');
const shippedTask = path.join(here, '../../skills/plot/scripts/board/plot-task.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/task.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: taskArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(taskArtifact, shippedTask);
fs.chmodSync(shippedTask, 0o755);

// The agent state, for the callers already in node.
//
// The same reason the seventh gives, and it is NOT on the hot path the seventh
// is: `docs/shell-and-domain.md` puts a script running once per agent per pass
// on the duplicating side, and `plot-worker-state.sh` is sourced by the agent's
// own loop. The shell keeps deciding for its five callers; this artifact is for
// the registry, which is in node already, and for the corpus test that holds
// the two answers together.
//
// BATCHED — one line per desk, one word per line — because the registry
// classifies every desk on the machine per pulse.
const agentStateArtifact = path.join(here, 'dist/plot-agent-state.mjs');
// ONE LINE, because the bundle-set derivation at the top of this file matches
// `shipped<Name> = path.join(...)` with `[^)]*` — which does not cross a
// newline. Wrapped for width, this binding was invisible to it and the artifact
// shipped outside the set that three readers check.
const shippedAgentState = path.join(here, '../../skills/plot/scripts/board/plot-agent-state.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/agent-state.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: agentStateArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(agentStateArtifact, shippedAgentState);
fs.chmodSync(shippedAgentState, 0o755);

// The supervisor: `plot-registryd`, one per repository.
//
// AN EIGHTH artifact rather than a flag on the board's, and the reason is
// lifetime rather than size. `index.ts` binds a port at import time, so a
// daemon flag on it would mean a supervisor that also serves a web page —
// two processes with different owners (launchd/systemd keeps this one alive,
// nothing keeps the board alive), different failure modes and different
// cadences, sharing one exit.
const registrydArtifact = path.join(here, 'dist/plot-registryd.mjs');
const shippedRegistryd = path.join(here, '../../skills/plot/scripts/board/plot-registryd.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/registryd-main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: registrydArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(registrydArtifact, shippedRegistryd);
fs.chmodSync(shippedRegistryd, 0o755);

// Did this branch's work land, reachable from the four scripts that gate on it.
//
// A NINTH artifact, for the reason the third through eighth ones give:
// plot-ask.mjs answers by RUNNING plot-fleet-scan.sh, and that scan sources
// plot-pr-merged.sh — so the gate asking it would be a script calling an
// artifact that calls the script.
//
// Vendored beside plot-pr-merged.sh, which resolves it from its own
// ${BASH_SOURCE[0]} directory. Its callers are shipped in the published npm
// package, where `packages/` does not exist, so an inline import of the domain
// source would resolve only in the plot checkout — and every gate would then
// answer "not merged", which keeps every worktree and every ref forever.
const landedArtifact = path.join(here, 'dist/plot-landed.mjs');
const shippedLanded = path.join(here, '../../skills/plot/scripts/board/plot-landed.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/landed.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: landedArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(landedArtifact, shippedLanded);
fs.chmodSync(shippedLanded, 0o755);

// THE DELTA, RENDERED WHERE THE RULE IS NOT. `pulseDelta` is a domain rule with
// its own tests; this artifact parses two readings, calls it, and composes
// sentences. Bundled for the same reason the ones above are: `plot-ask.mjs`
// answers by RUNNING plot-fleet-scan.sh, so the scan asking it for its own
// delta would be an artifact calling the script that called it.
//
// It needs the reading's schema — a previous pulse is a file another build may
// have written — so it is larger than the rule-only bundles beside it and still
// far short of the barrel, which re-exports every entity's validator.
const deltaArtifact = path.join(here, 'dist/plot-delta.mjs');
const shippedDelta = path.join(here, '../../skills/plot/scripts/board/plot-delta.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/delta.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: deltaArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(deltaArtifact, shippedDelta);
fs.chmodSync(shippedDelta, 0o755);

// What a story's plans say its standing is, reachable from the lint that reports it.
//
// A TENTH artifact, for the reason the third through ninth ones give:
// plot-ask.mjs answers by RUNNING plot-fleet-scan.sh, so a lint asking it would
// start a whole fleet scan per story to learn one story's standing.
//
// Vendored beside plot-story-lint.sh, which resolves it from its own
// $script_dir. That script is shipped in the published npm package, where
// `packages/` does not exist, so an inline import of the domain source would
// resolve only in the plot checkout — and the lint would go silent about drift
// everywhere else without saying it had.
const standingArtifact = path.join(here, 'dist/plot-standing.mjs');
const shippedStanding = path.join(here, '../../skills/plot/scripts/board/plot-standing.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/standing.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: standingArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(standingArtifact, shippedStanding);
fs.chmodSync(shippedStanding, 0o755);

// The eight branch states, reachable from the scan that reads them.
//
// AN ELEVENTH artifact, for the reason the third through tenth ones give:
// plot-ask.mjs answers by RUNNING plot-fleet-scan.sh, so the scan asking it for
// its own branch states would be an artifact calling the script that called it.
//
// ONCE PER PLAN on the 5 s pulse path — the same call site plot-verdicts.mjs
// already runs from — so the import cost is paid per plan and this entry pulls
// in one rule and no schema.
const branchStateArtifact = path.join(here, 'dist/plot-branch-state.mjs');
const shippedBranchState = path.join(here, '../../skills/plot/scripts/board/plot-branch-state.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/branch-state.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: branchStateArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(branchStateArtifact, shippedBranchState);
fs.chmodSync(shippedBranchState, 0o755);

// One sprint item's status, for plot-sprint-release.sh.
//
// ONCE PER OPERATOR COMMAND, which docs/shell-and-domain.md puts on the calling
// side: the script runs when /plot-release asks it, so 39 ms is free and the
// shell holds no copy of the rule. One invocation scores the whole sprint —
// stdin is one item per line — so the hop is paid once rather than 134 times.
const sprintScoreArtifact = path.join(here, 'dist/plot-sprint-score.mjs');
const shippedSprintScore = path.join(here, '../../skills/plot/scripts/board/plot-sprint-score.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/sprint-score.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: sprintScoreArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(sprintScoreArtifact, shippedSprintScore);
fs.chmodSync(shippedSprintScore, 0o755);

// What an adoption probe's readings propose, for /plot-init and
// /plot-board-setup.
//
// ONCE PER ADOPTION, which is the cheapest call this rule can have: a person
// runs the command and waits for it. Its own bundle rather than a verb on
// plot-ask.mjs — a caller asking what a repository proposes should not load the
// fleet controller — and tracked in git like the other fourteen, so an adopting
// repository that has the skills already has the bundle.
const proposeStackArtifact = path.join(here, 'dist/plot-propose-stack.mjs');
const shippedProposeStack = path.join(here, '../../skills/plot/scripts/board/plot-propose-stack.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/propose-stack.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: proposeStackArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(proposeStackArtifact, shippedProposeStack);
fs.chmodSync(shippedProposeStack, 0o755);

// The sprint lifecycle's write, for /plot-sprint's start, commit and close.
//
// ONCE PER TRANSITION, which is the cheapest call a rule can have: a person
// types `/plot-sprint <slug> start` and waits for it. Its own bundle rather
// than a verb on plot-ask.mjs, for the reason entry/transition.ts gives — that
// entry point answers `board` and `fleet` by RUNNING plot-fleet-scan.sh, so a
// script asking it for a transition would call an artifact that calls the
// script. This one spawns nothing: the sprint file arrives on stdin.
const sprintTransitionArtifact = path.join(here, 'dist/plot-sprint-transition.mjs');
const shippedSprintTransition = path.join(here, '../../skills/plot/scripts/board/plot-sprint-transition.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/sprint-transition.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: sprintTransitionArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(sprintTransitionArtifact, shippedSprintTransition);
fs.chmodSync(shippedSprintTransition, 0o755);

// The sprint's verdict on a release, for /plot-release's step 0.
//
// ONCE PER RELEASE, the cheapest call site a rule can have: a person types
// `/plot-release 2.16.0` and waits for it. Its own bundle rather than a verb on
// plot-ask.mjs, for the reason entry/sprint-transition.ts gives — that artifact
// answers `board` and `fleet` by RUNNING plot-fleet-scan.sh, so a script asking
// it for a verdict would call an artifact that calls a script. This one spawns
// nothing: plot-sprint-release.sh's JSON arrives on stdin.
const releaseGateArtifact = path.join(here, 'dist/plot-release-gate.mjs');
const shippedReleaseGate = path.join(here, '../../skills/plot/scripts/board/plot-release-gate.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/release-gate.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: releaseGateArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(releaseGateArtifact, shippedReleaseGate);
fs.chmodSync(shippedReleaseGate, 0o755);

// The one lifecycle move that runs backwards, for /plot-reject.
//
// ONCE PER REVERSAL, the same call site the sprint transition answers at. Its
// own bundle for the same reason: plot-ask.mjs answers `board` and `fleet` by
// RUNNING plot-fleet-scan.sh, so a script asking it for a transition would call
// an artifact that calls the script. This one spawns nothing — the plan file
// arrives on stdin.
//
// Returning a Delivered plan to Approved had NO script owning its write, where
// every forward move has one, so it was done by editing the `State:` line. That
// is the shortcut this slice closes.
const planUndeliverArtifact = path.join(here, 'dist/plot-plan-undeliver.mjs');
const shippedPlanUndeliver = path.join(here, '../../skills/plot/scripts/board/plot-plan-undeliver.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/plan-undeliver.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: planUndeliverArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(planUndeliverArtifact, shippedPlanUndeliver);
fs.chmodSync(shippedPlanUndeliver, 0o755);

// What adoption writes into a repository, for /plot-init.
//
// ONCE PER ADOPTION, the same call site plot-propose-stack.mjs answers at, and
// the CONTROLLER for the one command that writes into a repository Plot does not
// own. Its own bundle rather than a verb on plot-ask.mjs: an adopting repository
// has no board, no plans and no fleet to load, and this asks composeAdoption
// and spawns nothing.
const adoptArtifact = path.join(here, 'dist/plot-adopt.mjs');
const shippedAdopt = path.join(here, '../../skills/plot/scripts/board/plot-adopt.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/adopt.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: adoptArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(adoptArtifact, shippedAdopt);
fs.chmodSync(shippedAdopt, 0o755);

// What opening a slice's pull request writes, for the fleet and /plot-implement.
//
// ONCE PER SLICE PR, which is once per branch — the cheapest call site on the
// estate. Its own bundle for the reason the two above give: a shell asking
// plot-ask.mjs would call an artifact that runs plot-fleet-scan.sh, and opening
// a PR needs neither the fleet nor the board. This asks openSlicePr and spawns
// nothing; the readings arrive on stdin from the shell that took them.
const slicePrArtifact = path.join(here, 'dist/plot-slice-pr.mjs');
const shippedSlicePr = path.join(here, '../../skills/plot/scripts/board/plot-slice-pr.mjs');

await esbuild.build({
  entryPoints: [path.join(here, 'src/server/entry/slice-pr.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: slicePrArtifact,
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

fs.copyFileSync(slicePrArtifact, shippedSlicePr);
fs.chmodSync(shippedSlicePr, 0o755);

// Vendor Plot's plan-format helpers so the PUBLISHED npm package is standalone.
// board-server.mjs shells out (bash) to plot-config.sh + plot-plan-meta.sh,
// resolved at `resolve(dirname(artifact), '..')`. In the npm layout that is the
// package root (dist/..), where these scripts must live. Copied from their
// canonical home (skills/plot/scripts/) on every build, so the vendored copies
// cannot drift from source. Shipped via `files` in package.json; gitignored.
// (In the plot checkout layout the artifact sits in skills/plot/scripts/board/,
// so `../` already resolves to the real scripts — this copy is npm-only.)
// EVERY script the server spawns, not just the plan-format two. The list
// stood at two from 2026-07-14 (when the board spawned exactly those) until
// nine more spawns accumulated over six weeks — each commit correct in
// itself, none with reason to touch a package manifest. Nine releases
// shipped a board that answered `bash exited 127` and never became ready.
// A list nobody is prompted to update is one that falls behind, so a gate
// derives this from the server sources and fails on any difference.
const vendoredScripts = [
  'plot-agent-monitor.sh',
  // Sourced BY plot-agent-monitor.sh as a `$script_dir` sibling since the two
  // slice monitors merged on 2026-09-06 — the desk and the run are watched by
  // one loop now, and the run's half lives here. Missing, the merged monitor
  // does not crash: it reports that no build subject is attached and watches the
  // desk alone, which is the silent half-blindness the vendoring exists to
  // prevent. A gate derived from the server's own spawns cannot see a SOURCED
  // file, so it is listed by hand, exactly as `plot-budget.sh` below is.
  'plot-build-monitor.sh',
  // Sourced BY all three monitors as a `$script_dir` sibling — it is "the ONE
  // answer to is this monitor's subject still there?", and it is what ends a
  // monitor with its agent. It was on NO list, measured 2026-09-06, so the npm
  // layout has shipped without it: `plot_monitor_wait` is then undefined and the
  // `while` driving every monitor's loop fails on the first call, so a monitor
  // starts, takes one pass and exits — leaving a worker that reads as monitored
  // and is watched by nothing after its first second.
  'plot-monitor-subject.sh',
  'plot-approve.sh',
  // Sourced BY plot-host.sh as a `$here` sibling — the same shape as
  // `plot-transcript-quiet.sh` below, and the same failure. Missing, the source
  // prints one line to stderr and every budget function is then undefined:
  // `graphql_budget_spent` calls `budget_rate`, so in the npm layout every
  // `pr-state` would route on a `command not found`. The gate that derives this
  // list from the server's own spawns cannot see a SOURCED file, so it is
  // listed by hand and this comment says why.
  'plot-budget.sh',
  'plot-config.sh',
  // Sourced BY plot-dispatch.sh, plot-fleet-scan.sh and plot-reconcile-scan.sh
  // as a `$script_dir` sibling — three files already on this list, and the same
  // shape as `plot-budget.sh` and `plot-pr-merged.sh` above and below. Missing,
  // the source prints one line to stderr and `default_branch` is then undefined,
  // so `MAIN` is empty and every `origin/<main>` becomes `origin/` — the scan
  // reads no branch and the dispatcher refuses every slice. A gate derived from
  // the server's own spawns cannot see a SOURCED file, so it is listed by hand
  // and this comment says why.
  'plot-default-branch.sh',
  'plot-deliver.sh',
  'plot-dispatch.sh',
  'plot-fleet-scan.sh',
  'plot-host.sh',
  'plot-plan-meta.sh',
  // Sourced BY plot-reap.sh, plot-release-refs.sh and plot-dispatch.sh as a
  // `$script_dir` sibling — three files already on this list. It was NOT on it,
  // measured 2026-09-05, so the npm layout has shipped without it: the source
  // prints one line to stderr and `pr_merged` is then undefined, which every
  // caller reads through `||` as "not merged" — the safe direction, and a
  // reaper that keeps every worktree while saying nothing. A gate derived from
  // the server's own spawns cannot see a SOURCED file, so it is listed by hand
  // and this comment says why, exactly as `plot-budget.sh` above does.
  'plot-pr-merged.sh',
  'plot-reap.sh',
  'plot-release-refs.sh',
  'plot-resolve-artifact.sh',
  // The two monitors are vendored because plot-dispatch.sh STARTS them, not
  // because the server spawns them — they resolve as `$script_dir` siblings of
  // the dispatcher, so in the npm layout they must sit beside it. Missing, they
  // do not crash: start_worker passes an empty path and the wrapper starts an
  // UNMONITORED worker, which is the silent degradation the slice attaching
  // them exists to prevent. A gate derived from the server's own spawns cannot
  // see this one, so it is listed by hand and this comment says why.
  'plot-worker-monitor.sh',
  'plot-worker-state.sh',
  // Sourced BY plot-worker-monitor.sh as a `$script_dir` sibling, so it travels
  // with it or the monitor is blind. Missing, the monitor does not crash — its
  // guard answers `unavailable`, which is the honest word for a reader that is
  // not there — but every worker in the npm layout would then fall back to
  // `Worker bound` alone, silently, which is exactly the degradation the
  // comment above says the vendoring exists to prevent.
  'plot-transcript-quiet.sh',
  // Sourced BY plot-approve.sh, plot-deliver.sh and plot-dispatch.sh as a
  // `$script_dir` sibling — they spend their controller receipt through it on
  // their own exit 0. Missing, all three ABORT: the source line is
  // unconditional and `set -u` is on, so unlike the monitors above this is a
  // crash rather than a silent degradation. Listed by hand for the same reason
  // the monitors are — the server never spawns it, so no gate derived from the
  // server's own spawns can see it.
  'plot-state-receipt.sh',
];
for (const name of vendoredScripts) {
  const src = path.join(here, '../../skills/plot/scripts', name);
  const dest = path.join(here, name); // package root — matches scriptsDir resolution
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
}

const kb = (fs.statSync(shippedArtifact).size / 1024).toFixed(1);
const askKb = (fs.statSync(shippedAsk).size / 1024).toFixed(1);
const verdictsKb = (fs.statSync(shippedVerdicts).size / 1024).toFixed(1);
const movableKb = (fs.statSync(shippedMovable).size / 1024).toFixed(1);
const transitionKb = (fs.statSync(shippedTransition).size / 1024).toFixed(1);
const promptKb = (fs.statSync(shippedPrompt).size / 1024).toFixed(1);
const taskKb = (fs.statSync(shippedTask).size / 1024).toFixed(1);
const agentStateKb = (fs.statSync(shippedAgentState).size / 1024).toFixed(1);
const registrydKb = (fs.statSync(shippedRegistryd).size / 1024).toFixed(1);
const landedKb = (fs.statSync(shippedLanded).size / 1024).toFixed(1);
const deltaKb = (fs.statSync(shippedDelta).size / 1024).toFixed(1);
const standingKb = (fs.statSync(shippedStanding).size / 1024).toFixed(1);
const branchStateKb = (fs.statSync(shippedBranchState).size / 1024).toFixed(1);
const sprintScoreKb = (fs.statSync(shippedSprintScore).size / 1024).toFixed(1);
const proposeStackKb = (fs.statSync(shippedProposeStack).size / 1024).toFixed(1);
const sprintTransitionKb = (fs.statSync(shippedSprintTransition).size / 1024).toFixed(1);
const releaseGateKb = (fs.statSync(shippedReleaseGate).size / 1024).toFixed(1);
const planUndeliverKb = (fs.statSync(shippedPlanUndeliver).size / 1024).toFixed(1);
const adoptKb = (fs.statSync(shippedAdopt).size / 1024).toFixed(1);
const slicePrKb = (fs.statSync(shippedSlicePr).size / 1024).toFixed(1);
console.log(`Built board-server.mjs (${kb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-ask.mjs (${askKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-verdicts.mjs (${verdictsKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-movable.mjs (${movableKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-transition.mjs (${transitionKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-prompt.mjs (${promptKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-task.mjs (${taskKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-agent-state.mjs (${agentStateKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-registryd.mjs (${registrydKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-landed.mjs (${landedKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-delta.mjs (${deltaKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-standing.mjs (${standingKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-branch-state.mjs (${branchStateKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-sprint-score.mjs (${sprintScoreKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-propose-stack.mjs (${proposeStackKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-sprint-transition.mjs (${sprintTransitionKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-release-gate.mjs (${releaseGateKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-plan-undeliver.mjs (${planUndeliverKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-adopt.mjs (${adoptKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-slice-pr.mjs (${slicePrKb} KB) → skills/plot/scripts/board/`);
console.log(`Vendored ${vendoredScripts.join(', ')} → package root (npm standalone)`);

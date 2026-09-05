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
const registrydKb = (fs.statSync(shippedRegistryd).size / 1024).toFixed(1);
const landedKb = (fs.statSync(shippedLanded).size / 1024).toFixed(1);
console.log(`Built board-server.mjs (${kb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-ask.mjs (${askKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-verdicts.mjs (${verdictsKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-movable.mjs (${movableKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-transition.mjs (${transitionKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-prompt.mjs (${promptKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-task.mjs (${taskKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-registryd.mjs (${registrydKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-landed.mjs (${landedKb} KB) → skills/plot/scripts/board/`);
console.log(`Vendored ${vendoredScripts.join(', ')} → package root (npm standalone)`);

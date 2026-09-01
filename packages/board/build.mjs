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
  'plot-config.sh',
  'plot-deliver.sh',
  'plot-dispatch.sh',
  'plot-fleet-scan.sh',
  'plot-host.sh',
  'plot-plan-meta.sh',
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
console.log(`Built board-server.mjs (${kb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-ask.mjs (${askKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-verdicts.mjs (${verdictsKb} KB) → skills/plot/scripts/board/`);
console.log(`Built plot-movable.mjs (${movableKb} KB) → skills/plot/scripts/board/`);
console.log(`Vendored ${vendoredScripts.join(', ')} → package root (npm standalone)`);

// Bundles the fleet's four entries to packages/fleet/dist/.
//
// `packages/board/build.mjs` calls `buildFleetBundles` and copies each bundle
// to its shipped path under skills/plot/scripts/board/. The board's file keeps
// the `shipped*` declarations, because the gates derive the generated set from
// that file alone. `node build.mjs` in this package builds `dist/` only.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where each entry's bundle lands — read by both this file's own run and packages/board/build.mjs. */
export const registrydArtifact = path.join(here, 'dist/plot-registryd.mjs');
export const workerLoopArtifact = path.join(here, 'dist/plot-worker-loop.mjs');
export const fleetSizeArtifact = path.join(here, 'dist/plot-fleet-size.mjs');
export const promptArtifact = path.join(here, 'dist/plot-prompt.mjs');

const SHARED_OPTIONS = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
};

/**
 * Builds the four fleet bundles into this package's `dist/`.
 *
 * Creates `dist/` when it is absent and writes nothing outside it.
 *
 * @returns a promise that resolves when all four bundles are written, and
 *   rejects with esbuild's error when one fails to build.
 */
export const buildFleetBundles = async () => {
  fs.mkdirSync(path.join(here, 'dist'), { recursive: true });

  await esbuild.build({
    ...SHARED_OPTIONS,
    entryPoints: [path.join(here, 'src/server/entry/registryd-main.ts')],
    outfile: registrydArtifact,
  });

  // ONE OF TWO BUNDLES THAT CARRY `@anthropic-ai/claude-agent-sdk`, for the SDK
  // runner (`Agent runner: sdk`) — `board-server.mjs` is the other, for a
  // board role configured onto the same runner. Both exclude the SDK's
  // optional per-platform packages, which hold a 229-246 MB `claude` binary
  // each: the SDK runs the operator's `claude` from PATH instead. No other
  // bundle imports `agent-run-sdk.ts`, and
  // `test/worker-loop-bundle.test.mjs` proves `plot-registryd.mjs` and the
  // rest carry none of it.
  await esbuild.build({
    ...SHARED_OPTIONS,
    entryPoints: [path.join(here, 'src/server/entry/worker-loop.ts')],
    outfile: workerLoopArtifact,
    external: ['@anthropic-ai/claude-agent-sdk-*'],
    define: { PLOT_EMBEDDED: 'true' },
  });

  // A BUNDLE BECAUSE A SOURCE IMPORT CANNOT REACH A PLUGIN INSTALL. --start
  // imported rules/fleet-size.ts and entities/machine.ts as file:// sources.
  // Node 24 strips types, so the TypeScript was never the obstacle — the
  // SECOND import is: machine.ts opens with `import { z } from 'zod'`, which
  // an install with no node_modules cannot resolve. So this carries both
  // rules, zod bundled in; a bundle of fleetSize alone would import cleanly
  // and still fail, because headroomFor is the half that reaches zod.
  await esbuild.build({
    ...SHARED_OPTIONS,
    entryPoints: [path.join(here, 'src/server/entry/fleet-size.ts')],
    outfile: fleetSizeArtifact,
  });

  // Which prompt an agent runs. `plot-worker-loop.sh` resolves it from its own
  // directory; packages/board/build.mjs says why it is a bundle.
  await esbuild.build({
    ...SHARED_OPTIONS,
    entryPoints: [path.join(here, 'src/server/entry/prompt.ts')],
    outfile: promptArtifact,
  });
};

// Runs when invoked as `node build.mjs`, and not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFleetBundles();
  console.log('Built plot-registryd.mjs, plot-worker-loop.mjs, plot-fleet-size.mjs, plot-prompt.mjs → dist/');
}

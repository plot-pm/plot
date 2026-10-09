// Bundle the fleet's four entries to packages/fleet/dist/.
//
// Called two ways: standalone (`pnpm --filter @plot-pm/fleet build`) for a
// local check of this package in isolation, and from
// packages/board/build.mjs, which copies these artifacts on to their shipped
// destinations under skills/plot/scripts/board/. The board keeps its own
// `shipped*` declarations — the bundle-set derivation that writes
// `bundles.generated.ts` reads them from board/build.mjs's own source — and
// copies this package's dist output on to each shipped path; the
// `esbuild.build` CALLS, including the options that differ per bundle
// (worker-loop's `external`/`define`), live here.
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
 * Builds the three fleet bundles to this package's `dist/`. Idempotent and
 * safe to call from another package's build step — it creates `dist/` if
 * missing and writes nothing outside it.
 */
export async function buildFleetBundles() {
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

  // Which prompt an agent runs, reachable from the loop that launches it.
  // Vendored beside plot-worker-loop.sh, which resolves it from its own
  // $script_dir — see packages/board/build.mjs's call site for why this is a
  // bundle rather than a source import.
  await esbuild.build({
    ...SHARED_OPTIONS,
    entryPoints: [path.join(here, 'src/server/entry/prompt.ts')],
    outfile: promptArtifact,
  });
}

// Run directly (not imported) when invoked as `node build.mjs` / `pnpm build`.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFleetBundles();
  console.log('Built plot-registryd.mjs, plot-worker-loop.mjs, plot-fleet-size.mjs, plot-prompt.mjs → dist/');
}

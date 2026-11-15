import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

import { removeTree } from '../rm-tree.mjs';
import { productRoot } from './census-report.js';

/** The product modules the entry imports, by the specifier it imports them under. */
const PRODUCT_MODULES: Record<string, string> = {
  'census-product:fleetd': 'packages/fleet/src/server/entry/registryd-main.ts',
  'census-product:clock': 'packages/domain/src/adapters/clock/clock-system.ts',
  'census-product:fleet-clock': 'packages/fleet/src/shared/fleet-clock.ts',
};

export type FleetdEntry = {
  /** The file to run with `node`: a launcher that imports the bundle. */
  launcher: string;
  /** Removes the build directory by its exact `mkdtempSync` name. */
  remove: () => void;
};

/**
 * Bundles `fleetd-census-entry.ts` with fleetd's `run` taken from `product`,
 * into a fresh `mkdtempSync` directory.
 *
 * The launcher is a second file because `registryd-main.ts` starts its own
 * daemon when `process.argv[1]` is the file that holds it; the launcher keeps
 * `argv[1]` away from the bundle.
 *
 * @param product - the checkout whose fleetd runs; `productRoot()` by default.
 * @returns the launcher path and its cleanup.
 */
export const buildFleetdEntry = async (product: string = productRoot()): Promise<FleetdEntry> => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-census-entry-'));
  try {
    await esbuild.build({
      entryPoints: [fileURLToPath(new URL('./fleetd-census-entry.ts', import.meta.url))],
      outfile: join(dir, 'fleetd-census.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: true,
      logLevel: 'silent',
      plugins: [
        {
          name: 'census-product',
          setup: (build) => {
            build.onResolve({ filter: /^census-product:/ }, (args) => {
              const rel = PRODUCT_MODULES[args.path];
              if (rel === undefined) return { errors: [{ text: `process census: no product module ${args.path}` }] };
              return { path: join(product, rel) };
            });
          },
        },
      ],
    });
    const launcher = join(dir, 'launch.mjs');
    writeFileSync(launcher, "process.setSourceMapsEnabled(true);\nawait import('./fleetd-census.mjs');\n");
    return { launcher, remove: () => removeTree(dir) };
  } catch (e) {
    removeTree(dir);
    throw e;
  }
};

// `the-fleet-bundles-import-no-board`: `registryd-main.ts` and `worker-loop.ts`
// must import nothing from the board, directly or transitively, so the
// fleet's entries can live in their own package without carrying the board's
// graph (`board.ts`, `fleet.ts`, `dispatch.ts`, `continue.ts`,
// `agent-panel.ts`, `controllers/caller.ts`, …).
//
// A GREP OF THE SHIPPED BUNDLE PROVES NOTHING. Both bundles already ship with
// zero `node:http` and zero `createServer` — the minifier drops the unused
// exports, and `legalComments: 'none'` strips the `// src/server/board.ts`
// markers that would let a grep find the source file. This test instead
// re-builds each entry with `metafile: true` and reads which SOURCE FILES
// esbuild actually pulled in, the same options `build.mjs` uses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD_ROOT = path.join(HERE, '..');

/** A board-side input is any path esbuild resolved under `packages/board/`. */
const BOARD_INPUT = /packages\/board\//;

/**
 * Builds one entry with a metafile and returns the board-side inputs it
 * pulled in, so a failure can name the first offending module rather than
 * report a bare count.
 *
 * @param entry - the entry file, relative to the package root.
 * @param extra - esbuild options the real build passes for this entry
 *   (`external`, `define`), so a test build resolves the same way.
 * @returns the board-side input paths, in the order esbuild reports them.
 */
const boardInputsFor = async (entry, extra = {}) => {
  const result = await esbuild.build({
    entryPoints: [path.join(BOARD_ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    metafile: true,
    outfile: path.join(BOARD_ROOT, 'dist/_entry-module-graph-scratch.mjs'),
    ...extra,
  });
  return Object.keys(result.metafile.inputs).filter((key) => BOARD_INPUT.test(key));
};

describe('the fleet entries import nothing from the board outside entry/', () => {
  it('registryd-main.ts pulls in no board module', async () => {
    const found = await boardInputsFor('src/server/entry/registryd-main.ts');
    assert.deepEqual(found, [], `registryd-main.ts still imports: ${found.join(', ')}`);
  });

  it('worker-loop.ts pulls in no board module', async () => {
    const found = await boardInputsFor('src/server/entry/worker-loop.ts', {
      external: ['@anthropic-ai/claude-agent-sdk-*'],
      define: { PLOT_EMBEDDED: 'true' },
    });
    assert.deepEqual(found, [], `worker-loop.ts still imports: ${found.join(', ')}`);
  });

  it('fleet-size.ts stays clean — a guard, not part of this slice', async () => {
    const found = await boardInputsFor('src/server/entry/fleet-size.ts');
    assert.deepEqual(found, [], `fleet-size.ts imports: ${found.join(', ')}`);
  });
});
